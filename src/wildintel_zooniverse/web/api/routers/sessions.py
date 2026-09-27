"""FastAPI router — wizard sessions (see services.session_store)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from wildintel_zooniverse.core.schemas.requests import SaveCriteriaRequest, SaveDestinationRequest, SaveMediaListsRequest, SaveSelectionRequest
from wildintel_zooniverse.core.services import session_store

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
def list_sessions() -> list[dict]:
    """Unfinished runs, newest first — offered on startup to resume."""
    return session_store.list_sessions()


@router.post("/selection")
def save_selection(req: SaveSelectionRequest) -> dict:
    """Saves the chosen images (Trapper selection) into this run's session,
    creating it on the first call."""
    task_id = req.task_id or session_store.new_task_id()
    return session_store.write_selection_phase(
        task_id, task=req.task, source_type=req.source_type, selection=req.selection.model_dump(),
    )


@router.post("/criteria")
def save_criteria(req: SaveCriteriaRequest) -> dict:
    """Saves the upload criteria into an existing session."""
    try:
        return session_store.write_criteria_phase(req.task_id, criteria=req.criteria.model_dump())
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/destination")
def save_destination(req: SaveDestinationRequest) -> dict:
    """Saves the Zooniverse destination into an existing session."""
    try:
        return session_store.write_destination_phase(req.task_id, destination=req.destination.model_dump())
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/media-lists")
def save_media_lists(req: SaveMediaListsRequest) -> dict:
    """Saves the upload's whitelist/blacklist of Trapper media ids."""
    try:
        return session_store.write_media_lists(req.task_id, include=req.include, exclude=req.exclude)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/{task_id}")
def discard(task_id: str) -> dict:
    session_store.discard_session(task_id)
    return {"status": "discarded"}
