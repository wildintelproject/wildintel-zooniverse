"""FastAPI router — validation & audit of a Zooniverse subject set (the
Utils page; see services.validation_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from wildintel_zooniverse.web.api.routers import trapper, upload, zooniverse
from wildintel_zooniverse.core.schemas.requests import ValidateSubjectSetRequest
from wildintel_zooniverse.core.services import validation_service
from wildintel_zooniverse.core.logging_setup import debugging

router = APIRouter(prefix="/api/validation", tags=["validation"])
logger = logging.getLogger(__name__)


@router.post("/subject-set")
def validate_subject_set(req: ValidateSubjectSetRequest) -> StreamingResponse:
    """Validates the subject set, as NDJSON (see
    validation_service.validate_stream for its lines), then {"type":
    "error", "detail": ...} if something fails midway. A missing subject
    set, bad credentials or a failing connection is still a plain HTTP
    error."""
    zoo_creds = zooniverse._resolve(req)
    comparison = None
    if req.trapper is not None:
        t = req.trapper
        url, username, password = trapper._resolve(t.model_copy(update={"url": t.url or t.selection.url}))
        comparison = validation_service.TrapperComparison(url, username, password, t.selection, t.criteria)
    try:
        events = validation_service.validate_stream(zoo_creds, req.subject_set_id, comparison)
    except Exception as exc:
        logger.warning("Validation failed to start: %s", exc, exc_info=debugging())
        raise upload._http_exc(exc) from exc

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("Validation failed midway: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": upload._http_exc(exc).detail}) + "\n"
        finally:
            events.close()

    return StreamingResponse(lines(), media_type="application/x-ndjson")
