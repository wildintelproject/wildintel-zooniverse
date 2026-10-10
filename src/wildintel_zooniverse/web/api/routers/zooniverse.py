"""FastAPI router — Zooniverse destination (connection -> project -> subject
set), and downloading subject sets (the Utils page). No server-side
session: every endpoint resolves credentials fresh (see
services.zooniverse_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import TypeVar

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from panoptes_client.panoptes import PanoptesAPIException

from wildintel_zooniverse.core.schemas.requests import (
    DownloadSubjectSetsRequest, LookupSubjectsRequest, SubjectSetPageRequest, SubjectSetsRequest, WorkflowExportRequest,
    WorkflowsRequest, ZooniverseCredentials,
)
from wildintel_zooniverse.core.services import subject_download_service, subjects_service, zooniverse_service
from wildintel_zooniverse.core.services.annotations import registry
from wildintel_zooniverse.core.services.id_lists import IdLists
from wildintel_zooniverse.core.logging_setup import debugging

router = APIRouter(prefix="/api/zooniverse", tags=["zooniverse"])
logger = logging.getLogger(__name__)

T = TypeVar("T")


def _http_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, PanoptesAPIException) and "invalid email or password" in str(exc).lower():
        return HTTPException(401, "Incorrect Zooniverse username or password.")
    if isinstance(exc, requests.ConnectionError):
        return HTTPException(502, f"Could not connect to Zooniverse: {exc}")
    if isinstance(exc, requests.Timeout):
        return HTTPException(504, f"Timed out connecting to Zooniverse: {exc}")
    return HTTPException(400, str(exc))


def _resolve(req: ZooniverseCredentials) -> tuple[str, str]:
    try:
        return zooniverse_service.resolve_credentials(req.username, req.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _call(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except Exception as exc:
        logger.warning("Zooniverse call failed: %s", exc, exc_info=debugging())
        raise _http_exc(exc) from exc


@router.get("/config")
def get_config() -> dict:
    """Saved Zooniverse username — never the password itself."""
    return zooniverse_service.get_connection_defaults()


@router.post("/test-connection")
def test_connection(req: ZooniverseCredentials) -> dict:
    """Checks the credentials, and saves them to settings.toml once they work."""
    username, password = _resolve(req)
    result = _call(lambda: zooniverse_service.test_connection(username, password))
    zooniverse_service.save_credentials(username, password)
    return result


@router.post("/projects")
def projects(req: ZooniverseCredentials) -> dict:
    username, password = _resolve(req)
    return {"results": _call(lambda: zooniverse_service.list_projects(username, password))}


@router.post("/subject-sets")
def subject_sets(req: SubjectSetsRequest) -> dict:
    username, password = _resolve(req)
    return {"results": _call(lambda: zooniverse_service.list_subject_sets(username, password, req.project_id))}


@router.post("/workflows")
def workflows(req: WorkflowsRequest) -> dict:
    """The project's workflows — "exportable" when the app knows how to
    turn its classifications into observations (services.annotations)."""
    username, password = _resolve(req)
    results = _call(lambda: zooniverse_service.list_workflows(username, password, req.project_id))
    return {"results": [{**w, "exportable": registry.supported(w["id"])} for w in results]}


@router.post("/workflow-export")
def workflow_export(req: WorkflowExportRequest) -> dict:
    """The workflow's latest classifications export, if any — its state, when
    it was requested, when its file was made and whether a request is
    pending (never its download URL)."""
    username, password = _resolve(req)
    export = _call(lambda: zooniverse_service.classifications_export(username, password, req.workflow_id))
    return {"export": export and {k: export[k] for k in ("state", "pending", "updated_at", "file_date")}}


@router.post("/subjects/lookup")
def lookup_subjects(req: LookupSubjectsRequest) -> dict:
    """Subjects by id — the Subjects utility (wildintel-tools' subjects)."""
    username, password = _resolve(req)
    return _call(lambda: subjects_service.lookup((username, password), req.subject_ids))


@router.post("/subjects/page")
def subject_set_page(req: SubjectSetPageRequest) -> dict:
    """One page of a subject set's subjects — the Subjects utility."""
    username, password = _resolve(req)
    return _call(lambda: subjects_service.page((username, password), req.subject_set_id, req.page))


@router.get("/download-defaults")
def download_defaults() -> dict:
    return {"output_dir": str(subject_download_service.default_output_dir())}


@router.post("/download-subject-sets")
def download_subject_sets(req: DownloadSubjectSetsRequest) -> StreamingResponse:
    """Downloads the subject sets' images to a folder, as NDJSON (see
    subject_download_service.download_stream for its lines), then {"type":
    "error", "detail": ...} if something fails midway. A missing subject
    set, a folder that can't be created, or bad credentials, is still a
    plain HTTP error. The request going away (Stop) stops the download."""
    username, password = _resolve(req)
    output_dir = Path(req.output_dir).expanduser() if req.output_dir and req.output_dir.strip() else (
        subject_download_service.default_output_dir()
    )
    try:
        events = subject_download_service.download_stream(
            (username, password), req.subject_set_ids, output_dir, overwrite=req.overwrite,
            subjects=IdLists.of(req.include_subjects, req.exclude_subjects),
        )
    except OSError as exc:
        raise HTTPException(400, f"Can't use the folder {output_dir}: {exc}") from exc
    except Exception as exc:
        logger.warning("Zooniverse call failed: %s", exc, exc_info=debugging())
        raise _http_exc(exc) from exc

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("Subject set download failed midway: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": _http_exc(exc).detail}) + "\n"
        finally:
            events.close()

    return StreamingResponse(lines(), media_type="application/x-ndjson")
