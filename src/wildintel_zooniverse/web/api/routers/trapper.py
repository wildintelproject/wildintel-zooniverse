"""FastAPI router — Trapper navigation (research project -> classification
project -> collection -> deployments). No server-side session: every
endpoint resolves credentials fresh (see services.trapper_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from typing import TypeVar

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from trapper_client import err

from wildintel_zooniverse.core.schemas.requests import (
    ClassificationProjectsRequest, CollectionsRequest, DeploymentsRequest, TrapperCredentials, UploadPreviewRequest,
)
from wildintel_zooniverse.core.services import trapper_service
from wildintel_zooniverse.core.logging_setup import debugging

router = APIRouter(prefix="/api/trapper", tags=["trapper"])
logger = logging.getLogger(__name__)

T = TypeVar("T")


def _http_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, err.UnauthorizedError):
        return HTTPException(401, "Incorrect Trapper username or password.")
    if isinstance(exc, err.ForbiddenError):
        return HTTPException(403, "You don't have permission to access this Trapper resource.")
    if isinstance(exc, err.NotFoundError):
        return HTTPException(404, "Trapper resource not found.")
    if isinstance(exc, httpx.ConnectError):
        return HTTPException(502, f"Could not connect to the Trapper server: {exc}")
    if isinstance(exc, httpx.TimeoutException):
        return HTTPException(504, f"Timed out connecting to the Trapper server: {exc}")
    return HTTPException(400, str(exc))


def _resolve(req: TrapperCredentials) -> tuple[str, str, str]:
    try:
        return trapper_service.resolve_credentials(req.url, req.username, req.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _call(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except Exception as exc:
        logger.warning("Trapper call failed: %s", exc, exc_info=debugging())
        raise _http_exc(exc) from exc


@router.get("/config")
def get_config() -> dict:
    """Saved Trapper connection defaults — never the password itself."""
    return trapper_service.get_connection_defaults()


@router.post("/test-connection")
def test_connection(req: TrapperCredentials) -> dict:
    """Checks the credentials, and saves them to settings.toml once they
    work — so they needn't be retyped."""
    url, username, password = _resolve(req)
    result = _call(lambda: trapper_service.test_connection(url, username, password))
    trapper_service.save_credentials(url, username, password)
    return result


@router.post("/research-projects")
def research_projects(req: TrapperCredentials) -> dict:
    url, username, password = _resolve(req)
    return {"results": _call(lambda: trapper_service.list_research_projects(url, username, password))}


@router.post("/classification-projects")
def classification_projects(req: ClassificationProjectsRequest) -> dict:
    url, username, password = _resolve(req)
    return {"results": _call(
        lambda: trapper_service.list_classification_projects(url, username, password, req.research_project_pk),
    )}


@router.post("/collections")
def collections(req: CollectionsRequest) -> dict:
    url, username, password = _resolve(req)
    return {"results": _call(
        lambda: trapper_service.list_collections(url, username, password, req.classification_project_pk),
    )}


@router.post("/deployments")
def deployments(req: DeploymentsRequest) -> dict:
    url, username, password = _resolve(req)
    return {"results": _call(
        lambda: trapper_service.list_deployments(url, username, password, req.research_project_pk, req.collection_pk),
    )}


@router.post("/upload-preview")
def upload_preview(req: UploadPreviewRequest) -> StreamingResponse:
    """How many of the selection's images the upload criteria keep, as
    NDJSON: one {"type": "deployment", ...counts} line per deployment as
    soon as it's counted, then {"type": "done"} — or {"type": "error",
    "detail": ...} if Trapper fails midway (the 200 is already sent by then).
    A bad connection or collection is still a plain HTTP error."""
    url, username, password = _resolve(req)
    summaries = _call(lambda: trapper_service.preview_stream(
        url, username, password, req.selection, req.criteria, detail=req.detail,
    ))

    def lines() -> Iterator[str]:
        try:
            for summary in summaries:
                yield json.dumps({"type": "deployment", **summary}) + "\n"
        except Exception as exc:
            logger.warning("Trapper call failed: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": _http_exc(exc).detail}) + "\n"
            return
        yield json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")
