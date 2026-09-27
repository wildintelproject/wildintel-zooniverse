"""Downloading Zooniverse subject sets' images to this computer —
wildintel-tools' download_ss (SubjectSetsComponent.download).

Each subject set goes into a folder of its own under the chosen one,
"{id}_{name}", each image named "{subject id}_{original name}" (see
zooniverse_service.subject_file_name) — so a file already there is skipped
unless overwriting: running it again only downloads what's missing.

Subject sets are done one after another, their subjects listed page by
page while the first ones already download, several at once (the
Zooniverse settings' parallel transfers). Each download retries with
tenacity, as uploads do; a file is written as ".part" and renamed once
complete, so a stopped download never leaves a truncated image behind."""
from __future__ import annotations

import logging
import queue
import re
import threading
from collections import Counter
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import httpx

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core.services import zooniverse_service
from wildintel_zooniverse.core.services.id_lists import IdLists
from wildintel_zooniverse.core.services.retry import RetryPolicy, download_retryable
from wildintel_zooniverse.core.logging_setup import debugging

logger = logging.getLogger(__name__)


def default_output_dir() -> Path:
    return config.get_app_documents_dir() / "downloads"


@dataclass(frozen=True)
class DownloadSettings:
    workers: int
    retry: RetryPolicy

    @classmethod
    def from_config(cls) -> DownloadSettings:
        zoo = config.load_settings().ZOONIVERSE
        return cls(workers=zoo.upload_workers, retry=RetryPolicy.from_delay(zoo.upload_attempts, zoo.upload_retry_delay))


def folder_name(subject_set: dict) -> str:
    safe = re.sub(r"[^\w.-]+", "_", subject_set["display_name"] or "").strip("_")
    return f"{subject_set['id']}_{safe}" if safe else str(subject_set["id"])


class _Downloader:
    """Downloads subjects on a thread pool; each submitted one ends up as
    exactly one "subject" event in `events` (after a "step" event if it's
    actually downloaded) — unless stopped first."""

    def __init__(self, settings: DownloadSettings, overwrite: bool):
        self._settings = settings
        self._overwrite = overwrite
        self._cancel = threading.Event()
        self._http = httpx.Client(timeout=httpx.Timeout(60, connect=15), follow_redirects=True)
        self._pool = ThreadPoolExecutor(settings.workers, thread_name_prefix="subject-download")
        self.events: queue.Queue[dict] = queue.Queue()

    def submit(self, subject_set_id: int, subject: dict, folder: Path) -> None:
        self._pool.submit(self._download, subject_set_id, subject, folder)

    def close(self) -> None:
        self._cancel.set()
        self._pool.shutdown(wait=True, cancel_futures=True)
        self._http.close()

    def _fetch(self, url: str, part: Path) -> None:
        with self._http.stream("GET", url) as response:
            response.raise_for_status()
            with part.open("wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)

    def _download(self, subject_set_id: int, subject: dict, folder: Path) -> None:
        event = {"type": "subject", "subject_set_id": subject_set_id, "subject_id": subject["id"],
                 "file_name": subject["file_name"]}
        target = folder / subject["file_name"]
        if target.exists() and not self._overwrite:
            self.events.put({**event, "status": "existing"})
            return
        if not subject["url"]:
            self.events.put({**event, "status": "failed", "detail": "The subject has no image."})
            return
        self.events.put({**event, "type": "step"})
        part = target.with_name(target.name + ".part")
        try:
            self._settings.retry.call(self._fetch, subject["url"], part, retry_if=download_retryable, cancel=self._cancel)
            part.replace(target)
        except Exception as exc:
            part.unlink(missing_ok=True)
            logger.warning("Download of subject %s failed: %s", subject["id"], exc, exc_info=debugging())
            self.events.put({**event, "status": "failed", "detail": str(exc)})
        else:
            self.events.put({**event, "status": "downloaded"})


def download_stream(
    zooniverse: tuple[str, str], subject_set_ids: list[int], output_dir: Path, *, overwrite: bool = False,
    subjects: IdLists = IdLists(), settings: DownloadSettings | None = None,
) -> Iterator[dict]:
    """The download's events, as the router streams them:
      - {"type": "subject_set", "id", "name", "total", "folder"}: it starts
        — "total" is Zooniverse's own subject count for it.
      - {"type": "step", ...}: a subject's image starts downloading.
      - {"type": "subject", ...}: one per subject — "downloaded",
        "existing" (already in the folder, skipped), "filtered_out" (left
        out by the subject lists — wildintel-tools' --white-list /
        --exclude-subjects) or "failed" (and why).
      - {"type": "done", ...}: the totals.

    The subject sets and the folder are checked right away (errors raise
    here). Closing the iterator stops the download: subjects not started are
    dropped, retries still waiting give up."""
    settings = settings or DownloadSettings.from_config()
    subject_sets = [zooniverse_service.subject_set_info(*zooniverse, ss_id) for ss_id in subject_set_ids]
    output_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading subject sets %s into %s (overwrite=%s, %d threads)",
                subject_set_ids, output_dir, overwrite, settings.workers)

    def events() -> Iterator[dict]:
        counts: Counter[str] = Counter()
        downloader = _Downloader(settings, overwrite)
        pending = 0

        def settle(event: dict) -> dict:
            nonlocal pending
            if event["type"] == "subject":
                counts[event["status"]] += 1
                pending -= 1
            return event

        try:
            for subject_set in subject_sets:
                folder = output_dir / folder_name(subject_set)
                folder.mkdir(exist_ok=True)
                yield {
                    "type": "subject_set", "id": subject_set["id"], "name": subject_set["display_name"],
                    "total": subject_set["subjects_count"], "folder": str(folder),
                }
                for subject in zooniverse_service.iter_subjects(*zooniverse, subject_set["id"]):
                    if not subjects.keeps(subject["id"]):
                        counts["filtered_out"] += 1
                        yield {"type": "subject", "subject_set_id": subject_set["id"], "subject_id": subject["id"],
                               "file_name": subject["file_name"], "status": "filtered_out"}
                        continue
                    downloader.submit(subject_set["id"], subject, folder)
                    pending += 1
                    # What finished meanwhile, while the listing goes on.
                    while True:
                        try:
                            yield settle(downloader.events.get_nowait())
                        except queue.Empty:
                            break
                # This subject set's last ones, before the next is listed.
                while pending:
                    yield settle(downloader.events.get())
        finally:
            downloader.close()
        logger.info("Subject set download finished: %s", dict(counts))
        yield {
            "type": "done", "downloaded": counts["downloaded"], "existing": counts["existing"],
            "failed": counts["failed"], "filtered_out": counts["filtered_out"], "output_dir": str(output_dir),
        }

    return events()
