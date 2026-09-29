"""Session-directory primitives — the same design wildintel-publisher's own
web backend uses (services/session_store.py there).

A "session" is one wizard run's own persistent directory under
get_sessions_dir()/<task_id>, holding a session.json manifest. Writers merge
their own section into whatever's already on disk, so no phase ever erases
another's. "phase" says how far the run got — only the literal "done" means
the whole run finished (its directory is then removed); anything else is
offered back on the "resume?" screen.

Phases so far (upload task, Trapper source):
  - "selected": the Trapper images to upload (research project,
    classification project, collection, deployments) are chosen — see
    write_selection_phase.
  - "filtered": the criteria choosing which of those images get uploaded
    (sequences, sampling, middle-sequence filters) are set too — see
    write_criteria_phase.
  - "destination": the Zooniverse project and subject set they go to are
    chosen too — see write_destination_phase.
  - "uploading": the upload itself has started (see write_upload_phase)
    and didn't finish cleanly yet — stopped, or with failed images. Each
    image uploaded is recorded in uploaded.jsonl the moment it is (see
    append_uploaded), so running it again skips them: Zooniverse would
    otherwise get them twice. Once every image is uploaded, the phase is
    "done".

A dry run of the upload (see services.upload_service) doesn't change the
phase; its outcome is kept under "last_dry_run" (write_dry_run_result).

Each deployment's images and observations, as fetched from Trapper, are
cached under trapper_cache/<deployment pk>.json the first time this session
asks for them (Preview, Analyze sequences, or the upload itself — see
services.trapper_service.selections_stream) — read_deployment_cache/
write_deployment_cache. Changing the criteria alone (sequence gap, humans/
vehicles removed, …) never needs Trapper again for the rest of the session;
only a new selection (a fresh task_id) does.

Never writes credentials: Trapper's username/password are scrubbed by the
caller before anything reaches this module, so resuming always asks for
them again."""
from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from wildintel_zooniverse.core import config


def new_task_id() -> str:
    return str(uuid.uuid4())


def session_dir(task_id: str) -> Path:
    return config.get_sessions_dir() / task_id


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_manifest(task_id: str) -> dict[str, Any] | None:
    path = session_dir(task_id) / "session.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def write_manifest(task_id: str, manifest: dict[str, Any]) -> None:
    """Atomic write (.tmp + replace), so a crash never leaves a half-written
    session.json behind."""
    d = session_dir(task_id)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "session.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / "session.json")


def write_selection_phase(task_id: str, *, task: str, source_type: str, selection: dict) -> dict[str, Any]:
    """Creates or updates a session once the images to work on are chosen.
    `selection` must already be secret-free."""
    existing = read_manifest(task_id) or {}
    manifest = {
        **existing,
        "task_id": task_id,
        "created_at": existing.get("created_at") or now_iso(),
        "updated_at": now_iso(),
        "phase": "selected",
        "status": "done",
        "error": None,
        "task": task,
        "source_type": source_type,
        "selection": selection,
    }
    write_manifest(task_id, manifest)
    return manifest


def write_criteria_phase(task_id: str, *, criteria: dict) -> dict[str, Any]:
    """Raises:
        LookupError: no session with that task_id.
    """
    existing = read_manifest(task_id)
    if existing is None:
        raise LookupError(f"Session {task_id} not found.")
    manifest = {**existing, "updated_at": now_iso(), "phase": "filtered", "criteria": criteria}
    write_manifest(task_id, manifest)
    return manifest


def write_destination_phase(task_id: str, *, destination: dict) -> dict[str, Any]:
    """Raises:
        LookupError: no session with that task_id.
    """
    existing = read_manifest(task_id)
    if existing is None:
        raise LookupError(f"Session {task_id} not found.")
    manifest = {**existing, "updated_at": now_iso(), "phase": "destination", "destination": destination}
    write_manifest(task_id, manifest)
    return manifest


def write_dry_run_result(task_id: str, *, result: dict) -> dict[str, Any]:
    """Records how the last dry run went — without moving the phase, since
    nothing was actually uploaded.

    Raises:
        LookupError: no session with that task_id.
    """
    existing = read_manifest(task_id)
    if existing is None:
        raise LookupError(f"Session {task_id} not found.")
    manifest = {**existing, "updated_at": now_iso(), "last_dry_run": result}
    write_manifest(task_id, manifest)
    return manifest


def write_media_lists(task_id: str, *, include: list[int] | None, exclude: list[int]) -> dict[str, Any]:
    """The upload's own media lists (see upload_service.MediaLists) — without
    moving the phase.

    Raises:
        LookupError: no session with that task_id.
    """
    existing = read_manifest(task_id)
    if existing is None:
        raise LookupError(f"Session {task_id} not found.")
    manifest = {
        **existing, "updated_at": now_iso(),
        "media_lists": {"include": sorted(set(include)) if include is not None else None, "exclude": sorted(set(exclude))},
    }
    write_manifest(task_id, manifest)
    return manifest


def write_upload_phase(task_id: str, *, upload: dict, done: bool = False) -> dict[str, Any]:
    """Merges `upload` into the session's own "upload" section — "done"
    once every image is uploaded, "uploading" until then.

    Raises:
        LookupError: no session with that task_id.
    """
    existing = read_manifest(task_id)
    if existing is None:
        raise LookupError(f"Session {task_id} not found.")
    manifest = {
        **existing, "updated_at": now_iso(), "phase": "done" if done else "uploading",
        "upload": {**(existing.get("upload") or {}), **upload},
    }
    write_manifest(task_id, manifest)
    return manifest


_uploaded_lock = threading.Lock()


def append_uploaded(task_id: str, *, media_id: int, subject_id: str) -> None:
    """Records one uploaded image — called by each upload worker right after
    Zooniverse accepts it, so it's kept even if the run is stopped."""
    line = json.dumps({"media_id": media_id, "subject_id": subject_id, "at": now_iso()}) + "\n"
    with _uploaded_lock, (session_dir(task_id) / "uploaded.jsonl").open("a", encoding="utf-8") as f:
        f.write(line)


def read_uploaded(task_id: str) -> set[int]:
    """The media ids already uploaded in this session. A line cut short by a
    crash is ignored."""
    path = session_dir(task_id) / "uploaded.jsonl"
    if not path.is_file():
        return set()
    ids = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            ids.add(int(json.loads(line)["media_id"]))
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            continue
    return ids


def list_sessions() -> list[dict[str, Any]]:
    """Every session left on disk whose phase isn't "done", newest first —
    a "done" one left behind by a crash is cleaned up here."""
    root = config.get_sessions_dir()
    if not root.is_dir():
        return []
    sessions = []
    for entry in root.iterdir():
        manifest = read_manifest(entry.name)
        if manifest is None:
            continue
        if manifest.get("phase") == "done":
            shutil.rmtree(entry, ignore_errors=True)
            continue
        sessions.append(manifest)
    return sorted(sessions, key=lambda m: m.get("updated_at") or m.get("created_at") or "", reverse=True)


def discard_session(task_id: str) -> None:
    shutil.rmtree(session_dir(task_id), ignore_errors=True)


def read_deployment_cache(task_id: str, deployment_pk: int) -> list[dict] | None:
    """A deployment's images and observations, as trapper_service last
    fetched them for this session — None if it hasn't been, yet.

    Kept separate from session.json (which stays small and is re-read
    often): a deployment's own file, since a big one (hundreds of thousands
    of images) would otherwise bloat every manifest read/write."""
    path = session_dir(task_id) / "trapper_cache" / f"{deployment_pk}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def write_deployment_cache(task_id: str, deployment_pk: int, images: list[dict]) -> None:
    """Raises:
        OSError: the session's directory couldn't be created/written to.
    """
    d = session_dir(task_id) / "trapper_cache"
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{deployment_pk}.json.tmp"
    tmp.write_text(json.dumps(images), encoding="utf-8")
    tmp.replace(d / f"{deployment_pk}.json")
