"""Update metadata of a Zooniverse subject set's subjects from Trapper —
wildintel-tools' update-metadata (TrapperZooniverseConnector.
update_subject_metadata), e.g. for subjects uploaded by older tools.

Each subject's Trapper media id is read from its metadata as wildintel-tools
does (Filename, then image_name, "<media id>_x_…"; then external_id,
"…:<media id>"), and its metadata is set to what an upload would set today
(upload_service.trapper_metadata, plus Filename) — only the fields that
differ, the rest of its metadata kept.

Unlike wildintel-tools, the file name comes from the Trapper selection's
own media (one query per deployment, not one per subject), with its real
deployment id — wildintel-tools guessed it from the resource name's first
"-"-separated part, which for "R0033-DONA_0001_A" is just "R0033".

A dry run goes through every subject and reports exactly what it would
change, without changing anything."""
from __future__ import annotations

import logging
import queue
import re
import threading
from collections import Counter
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core.schemas.requests import TrapperSelection
from wildintel_zooniverse.core.services import trapper_service, zooniverse_service
from wildintel_zooniverse.core.services.id_lists import IdLists
from wildintel_zooniverse.core.services.retry import RetryPolicy
from wildintel_zooniverse.core.services.upload_service import trapper_metadata, upload_retryable
from wildintel_zooniverse.core.logging_setup import debugging

logger = logging.getLogger(__name__)

_NAME_RE = re.compile(r"^(\d+)_x_")
_EXTERNAL_ID_RE = re.compile(r":(\d+)$")


def media_id_of(metadata: dict) -> int | None:
    """wildintel-tools' own (_get_trapper_resource_id_from_subjec)."""
    for key in ("Filename", "filename", "image_name"):
        value = metadata.get(key)
        if isinstance(value, str) and (match := _NAME_RE.match(value)):
            return int(match.group(1))
    value = metadata.get("external_id")
    if isinstance(value, str) and (match := _EXTERNAL_ID_RE.search(value.strip())):
        return int(match.group(1))
    return None


def expected_metadata(trapper_url: str, media_id: int, deployment_id: str, file_name: str) -> dict:
    zoo_name = f"{media_id}_x_{deployment_id}_x_{file_name}"
    return {**trapper_metadata(trapper_url, media_id, zoo_name), "Filename": zoo_name}


def changes_for(current: dict, expected: dict) -> list[dict]:
    return [
        {"field": field, "old": current.get(field), "new": value}
        for field, value in expected.items() if current.get(field) != value
    ]


@dataclass(frozen=True)
class UpdateSettings:
    workers: int
    retry: RetryPolicy

    @classmethod
    def from_config(cls) -> UpdateSettings:
        zoo = config.load_settings().ZOONIVERSE
        return cls(workers=zoo.upload_workers, retry=RetryPolicy.from_delay(zoo.upload_attempts, zoo.upload_retry_delay))


@dataclass
class TrapperSource:
    url: str
    username: str
    password: str
    selection: TrapperSelection


class _Updater:
    """Saves subjects' new metadata on a thread pool, each thread with a
    Zooniverse client of its own. Each submitted subject ends up as exactly
    one "subject" event in `events` — unless stopped first."""

    def __init__(self, credentials: tuple[str, str], settings: UpdateSettings):
        self._credentials = credentials
        self._settings = settings
        self._local = threading.local()
        self._cancel = threading.Event()
        self._pool = ThreadPoolExecutor(settings.workers, thread_name_prefix="metadata")
        self.events: queue.Queue[dict] = queue.Queue()

    def submit(self, event: dict, changes: dict) -> None:
        self._pool.submit(self._update, event, changes)

    def close(self) -> None:
        self._cancel.set()
        self._pool.shutdown(wait=True, cancel_futures=True)

    def _save(self, subject_id: int, changes: dict) -> None:
        client = getattr(self._local, "client", None)
        if client is None:
            client = self._local.client = zooniverse_service.new_client(*self._credentials)
        zooniverse_service.update_subject_metadata(client, subject_id, changes)

    def _update(self, event: dict, changes: dict) -> None:
        try:
            self._settings.retry.call(self._save, event["subject_id"], changes, retry_if=upload_retryable, cancel=self._cancel)
        except Exception as exc:
            logger.warning("Updating subject %s failed: %s", event["subject_id"], exc, exc_info=debugging())
            self.events.put({**event, "status": "failed", "detail": str(exc)})
        else:
            self.events.put({**event, "status": "updated"})


def update_stream(
    zooniverse: tuple[str, str], subject_set_id: int, trapper: TrapperSource, *, dry_run: bool,
    subjects: IdLists = IdLists(), settings: UpdateSettings | None = None,
) -> Iterator[dict]:
    """The run's events, as the router streams them:
      - {"type": "trapper", "total"}: the Trapper selection's media are
        fetched, then {"type": "deployment", "deployment_id", "media"} for
        each deployment.
      - {"type": "subjects", "id", "name", "total"}: going through the
        subject set's subjects starts.
      - {"type": "subject", "subject_id", "media_id", "status", "changes"}
        per subject — "filtered_out" (left out by the subject lists —
        wildintel-tools' --white-list / --black-list), "unchanged" (already right), "unmatched" (no media id
        in its metadata), "not_found" (its media isn't in the Trapper
        selection), "would_update" (dry run), "updated" or "failed" (and
        why). "changes": each field's old and new value.
      - {"type": "done", ...}: how many of each.

    The subject set and Trapper's connection and collection are checked
    right away (errors raise here)."""
    settings = settings or UpdateSettings.from_config()
    logger.info("%s of subject set %s from Trapper collection %s",
                "Metadata dry run" if dry_run else "Metadata update", subject_set_id, trapper.selection.collection.pk)
    subject_set = zooniverse_service.subject_set_info(*zooniverse, subject_set_id)
    index_stream = trapper_service.media_index_stream(trapper.url, trapper.username, trapper.password, trapper.selection)

    def events() -> Iterator[dict]:
        yield {"type": "trapper", "total": len(trapper.selection.deployments)}
        media: dict[int, tuple[str, str]] = {}
        for deployment_id, deployment_media in index_stream:
            media.update(deployment_media)
            yield {"type": "deployment", "deployment_id": deployment_id, "media": len(deployment_media)}

        yield {"type": "subjects", "id": subject_set["id"], "name": subject_set["display_name"],
               "total": subject_set["subjects_count"]}
        counts: Counter[str] = Counter()
        updater = None if dry_run else _Updater(zooniverse, settings)
        pending = 0

        def settle(event: dict) -> dict:
            nonlocal pending
            counts[event["status"]] += 1
            pending -= 1
            return event

        try:
            for subject in zooniverse_service.iter_subjects(*zooniverse, subject_set_id):
                if not subjects.keeps(subject["id"]):
                    counts["filtered_out"] += 1
                    yield {"type": "subject", "subject_id": subject["id"], "media_id": None, "changes": [],
                           "status": "filtered_out"}
                    continue
                metadata = subject["metadata"]
                media_id = media_id_of(metadata)
                event = {"type": "subject", "subject_id": subject["id"], "media_id": media_id, "changes": []}
                if media_id is None:
                    status = "unmatched"
                elif media_id not in media:
                    status = "not_found"
                else:
                    changes = changes_for(metadata, expected_metadata(trapper.url, media_id, *media[media_id]))
                    event["changes"] = changes
                    if not changes:
                        status = "unchanged"
                    elif dry_run:
                        status = "would_update"
                    else:
                        updater.submit(event, {c["field"]: c["new"] for c in changes})
                        pending += 1
                        status = None
                if status is not None:
                    counts[status] += 1
                    yield {**event, "status": status}
                if updater is not None:
                    while True:
                        try:
                            yield settle(updater.events.get_nowait())
                        except queue.Empty:
                            break
            while pending:
                yield settle(updater.events.get())
        finally:
            if updater is not None:
                updater.close()

        logger.info("%s of subject set %s finished: %s",
                    "Metadata dry run" if dry_run else "Metadata update", subject_set_id, dict(counts))
        yield {
            "type": "done", "dry_run": dry_run,
            **{s: counts[s] for s in ("unchanged", "unmatched", "not_found", "would_update", "updated", "failed", "filtered_out")},
        }

    return events()
