"""Upload of a session's images to Zooniverse — wildintel-tools'
TrapperZooniverseConnector.upload_collection.

Deployment by deployment, in the selection's order: its images are fetched
from Trapper and sampled (as the preview does), then each kept image goes
through its own download -> upload -> delete: a pool of download threads
hands each file to a pool of upload threads as soon as it's on disk (see
_Pipeline). Never "download everything, then upload": only the images in
flight are ever on disk, and whatever was uploaded before a failure stays
uploaded. How many threads each pool has, and how each step retries, is
set on the settings page (TransferSettings).

Each step retries with tenacity (exponential backoff), as wildintel-tools
does — a failure left after the last attempt fails that image alone, and
the run goes on with the next. Each image uploaded is recorded in the
session (session_store.append_uploaded) right away, by its worker, so
running the upload again — after a Stop, a crash, or to retry failures —
skips it instead of creating a second subject.

A dry run goes through exactly the same pipeline with DryRunTransfer: every
read is real (the images are fetched from Trapper and sampled, the subject
set is looked up), but the download and the upload are simulated — nothing
is written to disk or to Zooniverse, and nothing is recorded as uploaded."""
from __future__ import annotations

import logging
import queue
import tempfile
import threading
import time
from collections import Counter
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx
import requests
from panoptes_client.panoptes import PanoptesAPIException

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core.schemas.requests import TrapperSelection, UploadCriteria, ZooniverseDestination
from wildintel_zooniverse.core.services import session_store, trapper_service, zooniverse_service
from wildintel_zooniverse.core.services.retry import RetryPolicy, download_retryable
from wildintel_zooniverse.core.services.id_lists import IdLists
from wildintel_zooniverse.core.services.sampling import Candidate
from wildintel_zooniverse.core.logging_setup import debugging

logger = logging.getLogger(__name__)

LICENSE = "http://creativecommons.org/licenses/by-nc/4.0/legalcode"
# How long each simulated step of a dry run takes — so the files in flight
# can actually be seen go by.
DRY_RUN_STEP_DELAY = 1.0


@dataclass(frozen=True)
class TransferSettings:
    download_workers: int
    download_retry: RetryPolicy
    upload_workers: int
    upload_retry: RetryPolicy

    @classmethod
    def from_config(cls) -> TransferSettings:
        settings = config.load_settings()
        trapper, zoo = settings.TRAPPER, settings.ZOONIVERSE
        return cls(
            download_workers=trapper.download_workers,
            download_retry=RetryPolicy.from_delay(trapper.download_attempts, trapper.download_retry_delay),
            upload_workers=zoo.upload_workers,
            upload_retry=RetryPolicy.from_delay(zoo.upload_attempts, zoo.upload_retry_delay),
        )

# wildintel-tools' own: Zooniverse errors retrying can't fix...
_PERMANENT_KEYWORDS = ("maximum", "quota", "limit", "not authorized", "forbidden")
# ...and an expired session, fixed by logging in again.
_AUTH_KEYWORDS = ("logged in", "must be logged", "log in", "unauthorized", "unauthenticated")


def upload_retryable(exc: BaseException) -> bool:
    if isinstance(exc, PanoptesAPIException):
        return not any(kw in str(exc).lower() for kw in _PERMANENT_KEYWORDS)
    return isinstance(exc, requests.RequestException)


# The upload's own whitelist/blacklist of Trapper media ids — applied
# after sampling, as wildintel-tools' --media / --exclude-media are.
MediaLists = IdLists


@dataclass
class UploadRun:
    """What a session says to upload, and where."""

    task_id: str
    selection: TrapperSelection
    criteria: UploadCriteria
    destination: ZooniverseDestination
    media_lists: MediaLists = MediaLists()


def load_run(task_id: str) -> UploadRun:
    """Raises:
        LookupError: no session with that task_id.
        ValueError: the session hasn't reached the destination step yet.
    """
    manifest = session_store.read_manifest(task_id)
    if manifest is None:
        raise LookupError(f"Session {task_id} not found.")
    if not manifest.get("destination"):
        raise ValueError("Choose the Zooniverse destination before uploading.")
    return UploadRun(
        task_id=task_id,
        selection=TrapperSelection.model_validate(manifest["selection"]),
        criteria=UploadCriteria.model_validate(manifest.get("criteria") or {}),
        destination=ZooniverseDestination.model_validate(manifest["destination"]),
        media_lists=MediaLists.from_manifest(manifest.get("media_lists")),
    )


def zoo_filename(image: Candidate) -> str:
    """wildintel-tools' own — the media id leads, so an uploaded subject can
    be traced back to its Trapper media."""
    return f"{image.media_id}_x_{image.deployment_id}_x_{image.file_name}"


def subject_metadata(trapper_url: str, image: Candidate) -> dict:
    """wildintel-tools' own subject metadata (_build_metadata_from_trapper),
    as its update_subject_metadata leaves it: image_name — and "Filename",
    which create_subject copies from it — is the zoo_filename, not the
    original name, since that's how a subject is traced back to its Trapper
    media when its classifications are retrieved (the media id leads it).
    upload_collection itself still set the original name there, which
    update_subject_metadata was written to fix afterwards."""
    return trapper_metadata(trapper_url, image.media_id, zoo_filename(image))


def trapper_metadata(trapper_url: str, media_id: int, image_name: str) -> dict:
    """A subject's metadata for a Trapper media — also what validation
    expects to find (services.validation_service)."""
    base = trapper_url.rstrip("/") + "/"
    media = f"{base}storage/resource/media/{media_id}"
    return {
        "external_id": f"{base}:media:{media_id}",
        "preview": f"{media}/pfile/",
        "link": f"{media}/file/",
        "thumbnail": f"{media}/tfile/",
        "origin": base,
        "license": LICENSE,
        "image_name": image_name,
    }


class Transfer(Protocol):
    """Called from several threads at once."""

    def download(self, image: Candidate, path: Path) -> None: ...

    def upload(self, path: Path, metadata: dict) -> str | None:
        """Returns the new subject's id — None when nothing was uploaded."""

    def close(self) -> None: ...


class DryRunTransfer:
    """Simulates both steps, each taking DRY_RUN_STEP_DELAY — only checks
    there's something to transfer."""

    def download(self, image: Candidate, path: Path) -> None:
        if not image.file_url:
            raise ValueError(f"Media {image.media_id} has no file URL in Trapper.")
        time.sleep(DRY_RUN_STEP_DELAY)

    def upload(self, path: Path, metadata: dict) -> str | None:
        time.sleep(DRY_RUN_STEP_DELAY)
        return None

    def close(self) -> None:
        pass


class ZooniverseTransfer:
    """Downloads the file from Trapper (public URL — no login needed, as in
    wildintel-tools), then creates its subject with the worker thread's own
    Zooniverse client."""

    def __init__(self, credentials: tuple[str, str], project_id: int, subject_set_id: int):
        self._credentials = credentials
        self._project_id = project_id
        self._subject_set_id = subject_set_id
        self._local = threading.local()
        self._http = httpx.Client(timeout=httpx.Timeout(60, connect=15), follow_redirects=True)

    def download(self, image: Candidate, path: Path) -> None:
        if not image.file_url:
            raise ValueError(f"Media {image.media_id} has no file URL in Trapper.")
        with self._http.stream("GET", image.file_url) as response:
            response.raise_for_status()
            with path.open("wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)

    def upload(self, path: Path, metadata: dict) -> str | None:
        client = getattr(self._local, "client", None)
        if client is None:
            client = self._local.client = zooniverse_service.new_client(*self._credentials)
        try:
            return zooniverse_service.create_subject(client, self._project_id, self._subject_set_id, path, metadata)
        except PanoptesAPIException as exc:
            if any(kw in str(exc).lower() for kw in _AUTH_KEYWORDS):
                logger.warning("Zooniverse session expired (%s) — logging in again before retrying.", exc, exc_info=debugging())
                self._local.client = None
            raise

    def close(self) -> None:
        self._http.close()


def _image_event(image: Candidate) -> dict:
    return {"type": "image", "media_id": image.media_id, "deployment_id": image.deployment_id,
            "file_name": zoo_filename(image)}


class _Pipeline:
    """Each image's download -> upload -> delete, on two thread pools: a
    download thread hands the file to the upload pool as soon as it's on
    disk, and goes on with the next download. Each submitted image ends up
    as exactly one "image" event in `events` — unless the run is stopped
    first — after a "step" event as each of its steps starts.

    At most download_workers + upload_workers files are on disk at once: a
    download waits for a free slot, so downloads outpacing uploads never
    pile files up.

    close() stops it: images not started are dropped, retries still waiting
    give up, and the images in flight finish — recorded if uploaded."""

    def __init__(
        self, transfer: Transfer, settings: TransferSettings, workdir: Path, trapper_url: str,
        on_uploaded: Callable[[int, str], None] | None = None,
    ):
        self._transfer = transfer
        self._settings = settings
        self._workdir = workdir
        self._trapper_url = trapper_url
        self._on_uploaded = on_uploaded
        self._cancel = threading.Event()
        self._slots = threading.Semaphore(settings.download_workers + settings.upload_workers)
        self._downloads = ThreadPoolExecutor(settings.download_workers, thread_name_prefix="download")
        self._uploads = ThreadPoolExecutor(settings.upload_workers, thread_name_prefix="upload")
        self.events: queue.Queue[dict] = queue.Queue()

    def submit(self, image: Candidate) -> None:
        self._downloads.submit(self._download, image)

    def close(self) -> None:
        self._cancel.set()
        # Downloads first: one finishing now still hands its file over.
        self._downloads.shutdown(wait=True, cancel_futures=True)
        self._uploads.shutdown(wait=True, cancel_futures=True)

    def _download(self, image: Candidate) -> None:
        while not self._slots.acquire(timeout=0.5):
            if self._cancel.is_set():
                return
        path = self._workdir / zoo_filename(image)
        self.events.put({**_image_event(image), "type": "step", "step": "download"})
        logger.debug("↓ media %s (%s) from %s", image.media_id, image.deployment_id, image.file_url)
        try:
            self._settings.download_retry.call(
                self._transfer.download, image, path, retry_if=download_retryable, cancel=self._cancel,
            )
            logger.debug("↓ media %s done%s", image.media_id,
                         f" ({path.stat().st_size} bytes)" if path.exists() else "")
            self._uploads.submit(self._upload, image, path)
        except Exception as exc:
            path.unlink(missing_ok=True)
            self._slots.release()
            if isinstance(exc, RuntimeError) and self._cancel.is_set():
                return  # the upload pool is shut down — the run was stopped
            logger.warning("Download of media %s failed: %s", image.media_id, exc, exc_info=debugging())
            self.events.put({**_image_event(image), "status": "failed", "step": "download", "detail": str(exc)})

    def _upload(self, image: Candidate, path: Path) -> None:
        self.events.put({**_image_event(image), "type": "step", "step": "upload"})
        logger.debug("↑ media %s as %s", image.media_id, path.name)
        try:
            subject_id = self._settings.upload_retry.call(
                self._transfer.upload, path, subject_metadata(self._trapper_url, image),
                retry_if=upload_retryable, cancel=self._cancel,
            )
            if subject_id is not None and self._on_uploaded is not None:
                self._on_uploaded(image.media_id, subject_id)
        except Exception as exc:
            logger.warning("Upload of media %s failed: %s", image.media_id, exc, exc_info=debugging())
            self.events.put({**_image_event(image), "status": "failed", "step": "upload", "detail": str(exc)})
        else:
            logger.debug("↑ media %s done — subject %s", image.media_id, subject_id)
            self.events.put({**_image_event(image), "status": "uploaded", "subject_id": subject_id})
        finally:
            path.unlink(missing_ok=True)
            self._slots.release()


# A "checking" event every this many subjects listed.
CHECK_PROGRESS_EVERY = 100


def run_stream(
    run: UploadRun, trapper: tuple[str, str, str], zooniverse: tuple[str, str], *, dry_run: bool,
    skip_in_subject_set: bool = False, settings: TransferSettings | None = None,
) -> Iterator[dict]:
    """The run's events, as the router streams them:
      - {"type": "start", ...}: the subject set the images go to — "exists"
        says whether it did before the run. A real run creates it if not; a
        dry run leaves its id null then.
      - With skip_in_subject_set, and the subject set already there:
        {"type": "checking", "done", "total"} as its subjects are listed —
        slow: Zooniverse lists them 100 at a time — then
        {"type": "checked", "media"}: how many Trapper images it has.
      - {"type": "fetching", "deployment_id": ...}: a deployment's images
        are being fetched from Trapper — they're uploaded before the next
        one's are fetched.
      - {"type": "deployment", ...}: its counts (as the preview's), once
        they're fetched and sampled — "selected" is how many it uploads,
        after the session's media lists ("filtered_out": how many they
        left out).
      - {"type": "step", "step": "download" | "upload", ...}: an image's
        download, or its upload, has just started — so what's in flight
        can be shown.
      - {"type": "image", ...}: one per image kept, as each finishes (not in
        order: several at once) — "uploaded", "skipped" (with its "reason":
        "session", uploaded by an earlier run of this session, or
        "subject_set", already in the subject set) or "failed" (with the
        step and why).
      - {"type": "done", ...}: this run's totals — also saved into the
        session.

    Trapper and Zooniverse are checked right away (errors raise here); only
    the per-deployment work is deferred to the iterator. Closing the
    iterator (the client went away, or pressed Stop) stops it — see
    _Pipeline.close.

    `settings` defaults to the settings page's own, read when the run
    starts."""
    settings = settings or TransferSettings.from_config()
    destination = run.destination
    selections = trapper_service.selections_stream(*trapper, run.selection, run.criteria)
    if dry_run:
        existing = zooniverse_service.find_subject_set(*zooniverse, destination.project.id, destination.subject_set_name)
        subject_set_id, exists = (existing["id"] if existing else None), existing is not None
        transfer: Transfer = DryRunTransfer()
    else:
        subject_set_id, exists = zooniverse_service.get_or_create_subject_set(
            *zooniverse, destination.project.id, destination.subject_set_name,
        )
        transfer = ZooniverseTransfer(zooniverse, destination.project.id, subject_set_id)
        session_store.write_upload_phase(run.task_id, upload={
            "subject_set_id": subject_set_id, "started_at": session_store.now_iso(), "finished_at": None,
        })
    already_uploaded = session_store.read_uploaded(run.task_id)
    if run.media_lists.include is not None or run.media_lists.exclude:
        logger.info("Media lists: %s whitelisted, %d blacklisted",
                    len(run.media_lists.include) if run.media_lists.include is not None else "no whitelist —",
                    len(run.media_lists.exclude))
    logger.info(
        "%s of session %s: %d deployments → project %s, subject set %r (%s) — %d already uploaded; "
        "%d download / %d upload threads",
        "Dry run" if dry_run else "Upload", run.task_id, len(run.selection.deployments), destination.project.id,
        destination.subject_set_name, f"#{subject_set_id}" if exists else "new", len(already_uploaded),
        settings.download_workers, settings.upload_workers,
    )
    trapper_url = trapper[0]

    def record(media_id: int, subject_id: str) -> None:
        session_store.append_uploaded(run.task_id, media_id=media_id, subject_id=subject_id)

    def events() -> Iterator[dict]:
        yield {
            "type": "start", "dry_run": dry_run,
            "subject_set": {"name": destination.subject_set_name, "id": subject_set_id, "exists": exists},
        }
        lists = run.media_lists
        in_subject_set: set[int] = set()
        if skip_in_subject_set and exists:
            yield from _list_subject_set_media(zooniverse, subject_set_id, in_subject_set)
        counts: Counter[str] = Counter()
        with tempfile.TemporaryDirectory(prefix="wildintel-zooniverse-") as tmp:
            pipeline = _Pipeline(transfer, settings, Path(tmp), trapper_url, None if dry_run else record)
            try:
                pending = iter(selections)
                for d in run.selection.deployments:
                    yield {"type": "fetching", "deployment_id": d.deployment_id}
                    deployment = next(pending)
                    images = [c for c in deployment.selected if lists.keeps(c.media_id)]
                    filtered_out = len(deployment.selected) - len(images)
                    counts["filtered_out"] += filtered_out
                    yield {"type": "deployment", **deployment.summary(), "selected": len(images), "filtered_out": filtered_out}
                    submitted = 0
                    for image in images:
                        reason = ("session" if image.media_id in already_uploaded
                                  else "subject_set" if image.media_id in in_subject_set else None)
                        if reason:
                            counts["skipped"] += 1
                            yield {**_image_event(image), "status": "skipped", "reason": reason}
                            continue
                        pipeline.submit(image)
                        submitted += 1
                    while submitted:
                        event = pipeline.events.get()
                        if event["type"] == "image":
                            counts[event["status"]] += 1
                            submitted -= 1
                        yield event
            finally:
                pipeline.close()
                transfer.close()

        totals = {"uploaded": counts["uploaded"], "skipped": counts["skipped"], "failed": counts["failed"],
                  "filtered_out": counts["filtered_out"]}
        result = {"finished_at": session_store.now_iso(), **totals, "subject_set_id": subject_set_id}
        if dry_run:
            session_store.write_dry_run_result(run.task_id, result=result)
        else:
            session_store.write_upload_phase(run.task_id, upload=result, done=totals["failed"] == 0)
        logger.info("%s of session %s finished: %s", "Dry run" if dry_run else "Upload", run.task_id, totals)
        yield {"type": "done", "dry_run": dry_run, **totals}

    return events()


def _list_subject_set_media(zooniverse: tuple[str, str], subject_set_id: int, media: set[int]) -> Iterator[dict]:
    """Fills `media` with the Trapper images already in the subject set —
    whoever uploaded them (wildintel-tools, another session…) — yielding
    progress: listing a subject set is slow, 100 subjects per request."""
    from wildintel_zooniverse.core.services.subject_media import media_id_of  # its modules import this one

    total = zooniverse_service.subject_set_info(*zooniverse, subject_set_id)["subjects_count"]
    logger.info("Listing subject set %s's %d subjects, to skip the images already in it", subject_set_id, total)
    started = time.monotonic()
    yield {"type": "checking", "done": 0, "total": total}
    done = 0
    for subject in zooniverse_service.iter_subjects(*zooniverse, subject_set_id):
        if (media_id := media_id_of(subject["metadata"])) is not None:
            media.add(media_id)
        done += 1
        if done % CHECK_PROGRESS_EVERY == 0:
            yield {"type": "checking", "done": done, "total": total}
    logger.info("Subject set %s: %d subjects, %d Trapper images, listed in %.0f s",
                subject_set_id, done, len(media), time.monotonic() - started)
    yield {"type": "checked", "subjects": done, "media": len(media)}
