"""Trapper integration — thin wrapper around wildintel-trapper-sdk (module
trapper_client), WildINTEL's own Trapper SDK, the same one
wildintel-publisher's web app uses.

No server-side session: every call builds its own TrapperClient from fresh
credentials, falling back to settings.toml's TRAPPER section for whatever
the request left blank (the password is never sent back to the frontend).

The navigation mirrors wildintel-tools' own "zooniverse wizard import":
research project -> classification project -> collection -> deployments.
A collection's deployments are the research project's own that actually
have images in it (the SDK's deployments.by_collection_with_counts) —
stricter than wildintel-tools' "deployment_id starts with <collection>-"
rule, which also lists deployments named after the collection that have
no images in it at all (35 of 58 for collection R0005 on
wildintel-trap.uhu.es)."""
from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from datetime import datetime

from trapper_client import TrapperClient

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core.schemas.requests import TrapperSelection, UploadCriteria
from wildintel_zooniverse.core.services import sampling, session_store

logger = logging.getLogger(__name__)

# Page size for every listing — the SDK's where() walks every page lazily,
# this is only the batch size.
LIST_PAGE_SIZE = 200
# Batch size for a deployment's media and observations — far more rows.
# Trapper's media endpoint ignores it and returns every row in one page.
MEDIA_PAGE_SIZE = 1000


def _client(url: str, username: str, password: str) -> TrapperClient:
    logger.debug("Trapper client for %s as %s", url, username)
    return TrapperClient(base_url=url.rstrip("/"), user_name=username, user_password=password)


def client(url: str, username: str, password: str) -> TrapperClient:
    """A Trapper client, for services doing more than listing."""
    return _client(url, username, password)


def get_connection_defaults() -> dict:
    settings = config.load_settings()
    return {
        "base_url": settings.TRAPPER.base_url,
        "user_name": settings.TRAPPER.user_name,
        "has_password": bool(settings.TRAPPER.user_password),
    }


def resolve_credentials(url: str | None, username: str | None, password: str | None) -> tuple[str, str, str]:
    """Raises:
        ValueError: naming whatever is still missing after the fallback.
    """
    trapper = config.load_settings().TRAPPER
    resolved = (url or trapper.base_url, username or trapper.user_name, password or trapper.user_password)
    missing = [name for name, value in zip(("URL", "username", "password"), resolved) if not value]
    if missing:
        raise ValueError(f"Missing Trapper {', '.join(missing)} — provide it, or save it in the configuration first.")
    return resolved  # type: ignore[return-value]


def save_credentials(url: str, username: str, password: str) -> None:
    settings = config.load_settings()
    settings.TRAPPER.base_url = url
    settings.TRAPPER.user_name = username
    settings.TRAPPER.user_password = password
    config.save_settings(settings)


def test_connection(url: str, username: str, password: str) -> dict:
    """Checks the credentials with a single one-item page of research
    projects — its pagination still says how many there are."""
    result = _client(url, username, password).research_projects.get(page=1, page_size=1)
    return {"ok": True, "research_projects_count": result.pagination.count}


def list_research_projects(url: str, username: str, password: str) -> list[dict]:
    projects = _client(url, username, password).research_projects.where(page_size=LIST_PAGE_SIZE)
    return sorted(
        ({"pk": p.pk, "name": p.name or f"#{p.pk}", "acronym": p.acronym} for p in projects),
        key=lambda p: p["name"].lower(),
    )


def list_classification_projects(url: str, username: str, password: str, research_project_pk: int) -> list[dict]:
    projects = _client(url, username, password).classification_projects.where(
        research_project=research_project_pk, page_size=LIST_PAGE_SIZE,
    )
    return sorted(
        ({"pk": p.pk, "name": p.name, "is_active": p.is_active} for p in projects),
        key=lambda p: p["name"].lower(),
    )


def list_collections(url: str, username: str, password: str, classification_project_pk: int) -> list[dict]:
    collections = _client(url, username, password).classification_projects.get_all_project_collections(
        classification_project_pk, page_size=LIST_PAGE_SIZE,
    )
    return sorted(
        (
            {
                # The collection's own pk — the classification project's
                # entry for it has a pk of its own too.
                "pk": c.collection_pk, "name": c.name, "status": c.status,
                "total_count": c.total_count, "classified_count": c.classified_count,
                "approved_count": c.approved_count,
            }
            for c in collections.results
        ),
        key=lambda c: c["name"].lower(),
    )


def _iso(value) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else value


def list_deployments(url: str, username: str, password: str, research_project_pk: int, collection_pk: int) -> list[dict]:
    """The research project's deployments with images in the collection,
    each with how many it has there."""
    pairs = _client(url, username, password).deployments.by_collection_with_counts(
        collection_pk, research_project=research_project_pk, page_size=LIST_PAGE_SIZE,
    )
    return sorted(
        (
            {
                "pk": d.pk, "deployment_id": d.deployment_id or f"#{d.pk}", "location_id": d.location_id,
                "start_date": _iso(d.start_date), "end_date": _iso(d.end_date), "image_count": count,
            }
            for d, count in pairs
        ),
        key=lambda d: d["deployment_id"].lower(),
    )


def _collection_link_pk(client: TrapperClient, classification_project_pk: int, collection_pk: int) -> int:
    """The classification project's own pk for its entry of the collection —
    what its media and observations endpoints filter by."""
    links = client.classification_projects.get_all_project_collections(classification_project_pk, page_size=LIST_PAGE_SIZE)
    for link in links.results:
        if link.collection_pk == collection_pk:
            return link.pk
    raise ValueError(f"Collection {collection_pk} is not in classification project {classification_project_pk}.")


def _candidate_to_dict(c: sampling.Candidate) -> dict:
    return {
        "media_id": c.media_id, "deployment_id": c.deployment_id, "timestamp": c.timestamp.isoformat(),
        "public": c.public, "observation_types": sorted(c.observation_types),
        "file_url": c.file_url, "file_name": c.file_name,
    }


def _candidate_from_dict(d: dict) -> sampling.Candidate:
    return sampling.Candidate(
        media_id=d["media_id"], deployment_id=d["deployment_id"], timestamp=datetime.fromisoformat(d["timestamp"]),
        public=d["public"], observation_types=set(d["observation_types"]),
        file_url=d.get("file_url"), file_name=d.get("file_name"),
    )


def _fetch_deployment(client: TrapperClient, cp_pk: int, link_pk: int, deployment_pk: int) -> list[sampling.Candidate]:
    """One deployment's images in the collection, each with its observation
    types.

    private_human/private_vehicle=False, as wildintel-tools asks: Trapper
    would otherwise mark images with humans/vehicles non-public (no
    downloadable URL) — the middle-sequence filter decides about them."""
    started = time.monotonic()
    by_media: dict[int, sampling.Candidate] = {}
    for m in client.classification_media.where_project_media(
        cp_pk, collection=link_pk, deployment=deployment_pk,
        private_human="False", private_vehicle="False", page_size=MEDIA_PAGE_SIZE,
    ):
        by_media[m.mediaID] = sampling.Candidate(
            media_id=m.mediaID, deployment_id=m.deploymentID, timestamp=m.timestamp, public=m.filePublic,
            file_url=str(m.filePath) if m.filePath else None, file_name=m.fileName,
        )

    for obs in client.classification_results.where_project_results(
        cp_pk, collection=link_pk, deployment=deployment_pk, page_size=MEDIA_PAGE_SIZE,
    ):
        candidate = by_media.get(obs.mediaID)
        if candidate is not None and obs.observationType:
            candidate.observation_types.add(obs.observationType)
    logger.debug("Deployment %s: %d images fetched from Trapper in %.1f s",
                 deployment_pk, len(by_media), time.monotonic() - started)
    return list(by_media.values())


def _fetch_deployment_cached(
    client: TrapperClient, cp_pk: int, link_pk: int, deployment_pk: int, task_id: str | None,
) -> list[sampling.Candidate]:
    """_fetch_deployment, through this session's own cache (see
    session_store.read_deployment_cache) when task_id is given: a deployment's
    images and observations don't change while its criteria are tweaked and
    re-previewed, or between the Filters step and the upload itself, so
    Trapper is only asked once per deployment per session."""
    if task_id:
        cached = session_store.read_deployment_cache(task_id, deployment_pk)
        if cached is not None:
            logger.debug("Deployment %s: %d images from this session's cache", deployment_pk, len(cached))
            return [_candidate_from_dict(c) for c in cached]

    images = _fetch_deployment(client, cp_pk, link_pk, deployment_pk)
    if task_id:
        session_store.write_deployment_cache(task_id, deployment_pk, [_candidate_to_dict(c) for c in images])
    return images


def selections_stream(
    url: str, username: str, password: str, selection: TrapperSelection, criteria: UploadCriteria,
    *, detail: bool = False, task_id: str | None = None,
) -> Iterator[sampling.DeploymentSelection]:
    """The images the criteria keep of each chosen deployment, one
    deployment at a time as soon as it's fetched.

    Asked deployment by deployment, never the whole collection at once: a
    large one (R0038, ~876,000 images) takes Trapper longer than the
    client's timeout to return in a single response. One at a time: a few
    of these queries at once and Trapper answers 500.

    With task_id, each deployment's raw images/observations are cached for
    the rest of the session (see _fetch_deployment_cached) — only the
    selection step (a fresh task_id) fetches them from Trapper again.

    The connection and the collection are checked right away (errors raise
    here); only the per-deployment fetching is deferred to the iterator."""
    client = _client(url, username, password)
    cp_pk = selection.classification_project.pk
    link_pk = _collection_link_pk(client, cp_pk, selection.collection.pk)

    def selections() -> Iterator[sampling.DeploymentSelection]:
        for d in selection.deployments:
            images = _fetch_deployment_cached(client, cp_pk, link_pk, d.pk, task_id)
            chosen = sampling.select_deployment(d.deployment_id, images, criteria, detail=detail)
            logger.debug("Deployment %s: %s", d.deployment_id, chosen.summary())
            yield chosen

    return selections()


def preview_stream(
    url: str, username: str, password: str, selection: TrapperSelection, criteria: UploadCriteria,
    *, detail: bool = False, task_id: str | None = None,
) -> Iterator[dict]:
    """How many images of each chosen deployment the criteria keep, one
    summary per deployment as soon as it's counted — see selections_stream.
    With detail, each also lists its sequences and what became of each
    image (sampling.SequenceDetail) — wildintel-tools' analyze-sequences."""
    selections = selections_stream(url, username, password, selection, criteria, detail=detail, task_id=task_id)

    def summaries() -> Iterator[dict]:
        for s in selections:
            summary = s.summary()
            if detail:
                summary["sequence_detail"] = [d.to_dict() for d in s.sequences_detail or []]
            yield summary

    return summaries()


def media_index_stream(url: str, username: str, password: str, selection: TrapperSelection) -> Iterator[tuple[str, dict[int, tuple[str, str]]]]:
    """Every image of each chosen deployment — not only those an upload
    keeps — as (deployment_id, {media id: (deployment id, file name)}), one
    deployment at a time. What a subject's Filename is rebuilt from (see
    services.metadata_service).

    The deployment id is the selection's own: Trapper's media may spell it
    in another case. The connection and the collection are checked right
    away (errors raise here)."""
    client = _client(url, username, password)
    cp_pk = selection.classification_project.pk
    link_pk = _collection_link_pk(client, cp_pk, selection.collection.pk)

    def index() -> Iterator[tuple[str, dict[int, tuple[str, str]]]]:
        for d in selection.deployments:
            media = client.classification_media.where_project_media(
                cp_pk, collection=link_pk, deployment=d.pk,
                private_human="False", private_vehicle="False", page_size=MEDIA_PAGE_SIZE,
            )
            index = {m.mediaID: (d.deployment_id, m.fileName) for m in media}
            logger.debug("Deployment %s: %d media names fetched from Trapper", d.deployment_id, len(index))
            yield d.deployment_id, index

    return index()


def observation_index_stream(url: str, username: str, password: str, selection: TrapperSelection) -> Iterator[tuple[str, dict[int, list[int]]]]:
    """Each chosen deployment's observations in the classification project,
    as (deployment_id, {media id: [observation _id, ...]}), one deployment
    at a time — the observations an export of Zooniverse classifications
    updates (see services.classifications_export_service). In Trapper's
    own format (camtrapdp=False), the one that carries each row's _id.

    The connection and the collection are checked right away (errors raise
    here)."""
    client = _client(url, username, password)
    cp_pk = selection.classification_project.pk
    link_pk = _collection_link_pk(client, cp_pk, selection.collection.pk)

    def index() -> Iterator[tuple[str, dict[int, list[int]]]]:
        for d in selection.deployments:
            by_media: dict[int, list[int]] = {}
            for obs in client.classification_results.where_project_results(
                cp_pk, collection=link_pk, deployment=d.pk, camtrapdp="False", page_size=MEDIA_PAGE_SIZE,
            ):
                by_media.setdefault(obs.mediaID, []).append(obs.id)
            logger.debug("Deployment %s: observations of %d media fetched from Trapper", d.deployment_id, len(by_media))
            yield d.deployment_id, by_media

    return index()
