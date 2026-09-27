"""FastAPI router — updating a subject set's metadata from Trapper (the
Utils page; see services.metadata_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from wildintel_zooniverse.web.api.routers import trapper, upload, zooniverse
from wildintel_zooniverse.core.schemas.requests import UpdateMetadataRequest
from wildintel_zooniverse.core.services import metadata_service
from wildintel_zooniverse.core.services.id_lists import IdLists
from wildintel_zooniverse.core.logging_setup import debugging

router = APIRouter(prefix="/api/metadata", tags=["metadata"])
logger = logging.getLogger(__name__)


@router.post("/update")
def update_metadata(req: UpdateMetadataRequest) -> StreamingResponse:
    """Updates — or, as a dry run (the default), only reports what it would
    change in — the subject set's metadata, as NDJSON (see
    metadata_service.update_stream for its lines), then {"type": "error",
    "detail": ...} if something fails midway. The request going away (Stop)
    stops it."""
    zoo_creds = zooniverse._resolve(req)
    t = req.trapper
    url, username, password = trapper._resolve(t.model_copy(update={"url": t.url or t.selection.url}))
    source = metadata_service.TrapperSource(url, username, password, t.selection)
    try:
        events = metadata_service.update_stream(
            zoo_creds, req.subject_set_id, source, dry_run=req.dry_run,
            subjects=IdLists.of(req.include_subjects, req.exclude_subjects),
        )
    except Exception as exc:
        logger.warning("Metadata update failed to start: %s", exc, exc_info=debugging())
        raise upload._http_exc(exc) from exc

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("Metadata update failed midway: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": upload._http_exc(exc).detail}) + "\n"
        finally:
            events.close()

    return StreamingResponse(lines(), media_type="application/x-ndjson")
