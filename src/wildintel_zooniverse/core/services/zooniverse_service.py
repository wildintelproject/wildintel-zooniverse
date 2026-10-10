"""Zooniverse integration — thin wrapper around panoptes-client, the same
library wildintel-tools' ZooniverseClient uses.

Like services.trapper_service, no server-side session: every call takes
fresh credentials, falling back to settings.toml's ZOONIVERSE section for
whatever the request left blank (the password never goes back to the
frontend).

panoptes-client keeps "the" connection per thread (Panoptes._local is a
threading.local), and FastAPI runs each request on any thread of its pool —
so a client logged in on one thread is useless on the next. Instead, one
logged-in client per set of credentials is kept here, and each call makes
it the current one for its own thread (Panoptes is a context manager for
that). An upload's worker threads each get a client of their own
(new_client), so they never refresh the same token at once."""
from __future__ import annotations

import logging
import threading
from email.utils import parsedate_to_datetime
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx

from panoptes_client import Panoptes, Project, Subject, SubjectSet, User, Workflow
from panoptes_client.panoptes import PanoptesAPIException

from wildintel_zooniverse.core import config

logger = logging.getLogger(__name__)

_lock = threading.Lock()
# Logged-in clients, by (username, password).
_clients: dict[tuple[str, str], Panoptes] = {}


def new_client(username: str, password: str) -> Panoptes:
    """A client of its own, logged in — raises PanoptesAPIException on wrong
    credentials."""
    logger.debug("Logging in to Zooniverse as %s", username)
    return Panoptes(username=username, password=password)


@contextmanager
def _connected(username: str, password: str) -> Iterator[Panoptes]:
    with _lock:
        client = _clients.get((username, password))
        if client is None:
            client = _clients[(username, password)] = new_client(username, password)
    with client:
        yield client


def get_connection_defaults() -> dict:
    zoo = config.load_settings().ZOONIVERSE
    return {"user_name": zoo.user_name, "has_password": bool(zoo.user_password)}


def resolve_credentials(username: str | None, password: str | None) -> tuple[str, str]:
    """Raises:
        ValueError: naming whatever is still missing after the fallback.
    """
    zoo = config.load_settings().ZOONIVERSE
    resolved = (username or zoo.user_name, password or zoo.user_password)
    missing = [name for name, value in zip(("username", "password"), resolved) if not value]
    if missing:
        raise ValueError(f"Missing Zooniverse {', '.join(missing)} — provide it, or save it in the configuration first.")
    return resolved  # type: ignore[return-value]


def save_credentials(username: str, password: str) -> None:
    settings = config.load_settings()
    settings.ZOONIVERSE.user_name = username
    settings.ZOONIVERSE.user_password = password
    config.save_settings(settings)


def test_connection(username: str, password: str) -> dict:
    with _connected(username, password):
        me = User.me()
        return {"ok": True, "login": me.login, "display_name": me.display_name}


def list_projects(username: str, password: str) -> list[dict]:
    """The projects the user can upload to — those they own or collaborate on."""
    with _connected(username, password):
        projects = Project.where(current_user_roles="owner,collaborator")
        return sorted(
            ({"id": int(p.id), "display_name": p.display_name, "slug": p.slug} for p in projects),
            key=lambda p: p["display_name"].lower(),
        )


def list_subject_sets(username: str, password: str, project_id: int) -> list[dict]:
    with _connected(username, password):
        return sorted(
            (
                {"id": int(s.id), "display_name": s.display_name, "subjects_count": s.set_member_subjects_count}
                for s in SubjectSet.where(project_id=project_id)
            ),
            key=lambda s: s["display_name"].lower(),
        )


def find_subject_set(username: str, password: str, project_id: int, name: str) -> dict | None:
    """The project's subject set with exactly this name — the one an upload
    adds its subjects to — or None if the upload would create it."""
    with _connected(username, password):
        for s in SubjectSet.where(project_id=project_id):
            if s.display_name == name:
                return {"id": int(s.id), "display_name": s.display_name, "subjects_count": s.set_member_subjects_count}
    return None


def get_or_create_subject_set(username: str, password: str, project_id: int, name: str) -> tuple[int, bool]:
    """The project's subject set with this name, created if there's none —
    its id, and whether it existed already."""
    existing = find_subject_set(username, password, project_id, name)
    if existing is not None:
        return existing["id"], True
    with _connected(username, password):
        subject_set = SubjectSet()
        subject_set.links.project = project_id
        subject_set.display_name = name
        subject_set.save()
        logger.info("Subject set %r created in project %s (#%s)", name, project_id, subject_set.id)
        return int(subject_set.id), False


def create_subject(client: Panoptes, project_id: int, subject_set_id: int, path: Path, metadata: dict) -> str:
    """Uploads one image as a new subject of the subject set, as
    wildintel-tools does — with the given client (a worker thread's own).
    Returns the subject's id."""
    with client:
        subject = Subject()
        subject.links.project = project_id
        subject.metadata["Filename"] = metadata.get("image_name") or path.name
        # external_id goes in the metadata only: panoptes-client never sends
        # a Subject's own external_id (not one of its _edit_attributes) —
        # wildintel-tools set it to no effect.
        subject.metadata.update(metadata)
        subject.add_location(str(path))
        subject.save()
        SubjectSet.find(subject_set_id).add(subject)
        logger.debug("Subject %s created from %s, in subject set %s", subject.id, path.name, subject_set_id)
        return str(subject.id)


# Subjects per page when listing a subject set — the API's default is 20.
SUBJECTS_PAGE_SIZE = 100


def subject_set_info(username: str, password: str, subject_set_id: int) -> dict:
    """Raises:
        PanoptesAPIException: no such subject set (or no access to it).
    """
    with _connected(username, password):
        s = SubjectSet.find(subject_set_id)
        return {"id": int(s.id), "display_name": s.display_name, "subjects_count": s.set_member_subjects_count}


def iter_subjects(username: str, password: str, subject_set_id: int) -> Iterator[dict]:
    """A subject set's subjects, page by page as they're iterated — each its
    id, image URL, file name (see subject_file_name) and metadata."""
    client = _client_for(username, password)
    with client:
        subjects = Subject.where(subject_set_id=subject_set_id, page_size=SUBJECTS_PAGE_SIZE)
    for subject in _iter_with(client, subjects):
        url = _image_url(subject.locations)
        metadata = subject.metadata or {}
        yield {"id": int(subject.id), "url": url, "file_name": subject_file_name(subject.id, metadata, url), "metadata": metadata}


def _client_for(username: str, password: str) -> Panoptes:
    with _connected(username, password) as client:
        return client


def _iter_with(client: Panoptes, items: Iterator) -> Iterator:
    """Iterates a lazy panoptes listing with `client` current for each page
    fetch — the caller's thread may change between items (a streaming
    response), and panoptes keeps its current client per thread."""
    iterator = iter(items)
    while True:
        with client:
            try:
                item = next(iterator)
            except StopIteration:
                return
        yield item


def _image_url(locations: list | None) -> str | None:
    for location in locations or []:
        for mime, url in location.items():
            if mime.startswith("image/"):
                return url
    return None


# wildintel-tools' own (SubjectsComponent.download): where a subject's
# original file name may be.
_NAME_KEYS = ("Filename", "filename", "file_name", "name", "display_name")


def subject_file_name(subject_id, metadata: dict, url: str | None) -> str:
    """wildintel-tools' own download name: "{subject id}_{original name}" —
    the original name from the metadata, or the URL's last part."""
    original = next((str(metadata[k]) for k in _NAME_KEYS if metadata.get(k)), None)
    if original is None:
        original = (url or "").rstrip("/").rsplit("/", 1)[-1] or "image"
    return f"{subject_id}_{Path(original).name}"


def update_subject_metadata(client: Panoptes, subject_id: int, changes: dict) -> None:
    """Merges `changes` into the subject's metadata — with the given client
    (a worker thread's own). The whole dict is assigned: panoptes-client
    only saves attributes that were set, so changing it in place (as
    wildintel-tools' update_one_metadata does) would save nothing."""
    with client:
        subject = Subject.find(subject_id)
        subject.metadata = {**(subject.metadata or {}), **changes}
        subject.save()
        logger.debug("Subject %s metadata updated: %s", subject_id, ", ".join(changes))


def list_workflows(username: str, password: str, project_id: int) -> list[dict]:
    with _connected(username, password):
        return sorted(
            ({"id": int(w.id), "display_name": w.display_name, "active": bool(getattr(w, "active", True))}
             for w in Workflow.where(project_id=project_id)),
            key=lambda w: w["display_name"].lower(),
        )


def workflow_name(username: str, password: str, workflow_id: int) -> str:
    """Raises:
        PanoptesAPIException: no such workflow (or no access to it).
    """
    with _connected(username, password):
        return Workflow.find(workflow_id).display_name


# Zooniverse makes one classifications export per workflow every 24 hours.
EXPORT_COOLDOWN_S = 24 * 60 * 60
EXPORT_DONE_STATES = ("ready", "finished")


def _file_date(url: str) -> str | None:
    """When the file at the export's URL was made (its Last-Modified), or None
    if it isn't there."""
    try:
        response = httpx.head(url, timeout=20, follow_redirects=True)
        response.raise_for_status()
        modified = response.headers.get("last-modified")
        return parsedate_to_datetime(modified).isoformat() if modified else None
    except (httpx.HTTPError, TypeError, ValueError):
        return None


def classifications_export(username: str, password: str, workflow_id: int, *, strict: bool = False) -> dict | None:
    """The workflow's latest classifications export — or None if it has none
    yet:
      - "state": Zooniverse's, "ready"/"finished" once done — not to be
        trusted alone: it can stay "creating" for days with the file there.
      - "pending": a request that hasn't (as far as "state" says) finished.
      - "updated_at": when the request was made (or finished).
      - "file_date": when the file the "url" points to was made — the
        previous export's while a new one is pending — or None if there is no
        file. The export can be downloaded if it has one.
      - "url": the file's, signed (it expires).
    Zooniverse answers an error when there is none, so by default any API
    error reads as "none yet"; `strict` raises it instead (to tell it from a
    lost login while waiting)."""
    with _connected(username, password):
        try:
            description = Workflow.find(workflow_id).describe_export("classifications")
        except PanoptesAPIException:
            if strict:
                raise
            return None
    media = (description.get("media") or [None])[0]
    if not media:
        return None
    state = (media.get("metadata") or {}).get("state")
    url = media.get("src")
    return {
        "state": state,
        "pending": state not in EXPORT_DONE_STATES,
        "updated_at": media.get("updated_at") or media.get("created_at"),
        "file_date": _file_date(url) if url else None,
        "url": url,
    }


def generate_classifications_export(username: str, password: str, workflow_id: int) -> None:
    """Asks Zooniverse for a new classifications export — it takes a while
    to be ready (see classifications_export)."""
    with _connected(username, password):
        Workflow.find(workflow_id).generate_export("classifications")


# Subjects asked for per request when looking them up by id.
LOOKUP_CHUNK = 100


def _subject_dict(subject) -> dict:
    raw = getattr(subject, "raw", {}) or {}
    locations = [url for loc in (subject.locations or []) for url in loc.values()]
    return {
        "id": int(subject.id),
        "images": locations,
        "metadata": subject.metadata or {},
        "subject_sets": [int(i) for i in (raw.get("links") or {}).get("subject_sets") or []],
        "created_at": raw.get("created_at"),
    }


def lookup_subjects(username: str, password: str, subject_ids: list[int]) -> list[dict]:
    """The subjects with these ids — those that exist and the user can see
    (wildintel-tools' subjects command) — LOOKUP_CHUNK per request."""
    ids = list(dict.fromkeys(subject_ids))
    found: list[dict] = []
    with _connected(username, password):
        for start in range(0, len(ids), LOOKUP_CHUNK):
            chunk = ids[start:start + LOOKUP_CHUNK]
            found += [_subject_dict(s) for s in Subject.where(id=",".join(map(str, chunk)), page_size=len(chunk))]
    logger.debug("Looked up %d subject(s): %d found", len(ids), len(found))
    return found


def subject_set_page(username: str, password: str, subject_set_id: int, page: int, page_size: int) -> dict:
    """One page of a subject set's subjects, and how many there are."""
    with _connected(username, password):
        paginator = Subject.where(subject_set_id=subject_set_id, page=page, page_size=page_size)
        # This page's own subjects only — iterating the paginator would go
        # on fetching the next pages.
        subjects = [_subject_dict(paginator.object_class(raw, etag=paginator.etag)) for raw in paginator.object_list]
        meta = paginator.meta or {}
    return {
        "subjects": subjects, "page": int(meta.get("page") or page),
        "page_count": int(meta.get("page_count") or 1), "count": int(meta.get("count") or len(subjects)),
    }
