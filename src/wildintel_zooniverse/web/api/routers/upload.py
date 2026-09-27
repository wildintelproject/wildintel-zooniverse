"""FastAPI router — uploading a session's images to Zooniverse, for real
or as a dry run (see services.upload_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from panoptes_client.panoptes import PanoptesAPIException

from wildintel_zooniverse.web.api.routers import trapper, zooniverse
from wildintel_zooniverse.core.schemas.requests import UploadRunRequest
from wildintel_zooniverse.core.services import upload_service
from wildintel_zooniverse.core.logging_setup import debugging

router = APIRouter(prefix="/api/upload", tags=["upload"])
logger = logging.getLogger(__name__)


def _http_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, (PanoptesAPIException, requests.RequestException)):
        return zooniverse._http_exc(exc)
    return trapper._http_exc(exc)


def _stream(req: UploadRunRequest, *, dry_run: bool) -> StreamingResponse:
    try:
        run = upload_service.load_run(req.task_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    trapper_creds = trapper._resolve(req.trapper.model_copy(update={"url": req.trapper.url or run.selection.url}))
    zooniverse_creds = zooniverse._resolve(req.zooniverse)
    try:
        events = upload_service.run_stream(
            run, trapper_creds, zooniverse_creds, dry_run=dry_run, skip_in_subject_set=req.skip_in_subject_set,
        )
    except Exception as exc:
        logger.warning("Upload failed to start: %s", exc, exc_info=debugging())
        raise _http_exc(exc) from exc

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("Upload failed midway: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": _http_exc(exc).detail}) + "\n"
        finally:
            # Stops the workers when the client goes away mid-stream.
            events.close()

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.post("/dry-run")
def dry_run(req: UploadRunRequest) -> StreamingResponse:
    """Runs the upload without uploading anything, as NDJSON (see
    upload_service.run_stream for its lines), then {"type": "error",
    "detail": ...} if something fails midway (the 200 is already sent by
    then). A missing session, destination or credentials, or a failing
    connection, is still a plain HTTP error."""
    return _stream(req, dry_run=True)


@router.post("/start")
def start(req: UploadRunRequest) -> StreamingResponse:
    """Uploads the session's images for real — the same stream as the dry
    run. Images an earlier run of this session uploaded are skipped; the
    request going away (Stop) stops the upload."""
    return _stream(req, dry_run=False)
