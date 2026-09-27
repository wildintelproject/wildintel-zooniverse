"""FastAPI router — exporting Zooniverse classifications as a Trapper
observations CSV (the "Retrieve classifications" task; see
services.classifications_export_service), and importing it into Trapper
(services.trapper_import_service)."""
from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from wildintel_zooniverse.core import config
from wildintel_zooniverse.web.api.routers import trapper, upload, zooniverse
from wildintel_zooniverse.core.schemas.requests import ExportClassificationsRequest, ImportToTrapperRequest
from wildintel_zooniverse.core.services import classifications_export_service, trapper_import_service
from wildintel_zooniverse.core.logging_setup import debugging

router = APIRouter(prefix="/api/export", tags=["export"])
logger = logging.getLogger(__name__)


@router.get("/defaults")
def defaults() -> dict:
    zoo = config.load_settings().ZOONIVERSE
    return {
        "output_dir": str(classifications_export_service.default_output_dir()),
        "classified_by": zoo.export_classified_by,
        "max_file_size_mb": zoo.export_max_file_size_mb,
    }


@router.post("/classifications")
def export_classifications(req: ExportClassificationsRequest) -> StreamingResponse:
    """Writes the workflow's classifications as a Trapper observations CSV,
    as NDJSON (see classifications_export_service.export_stream for its
    lines), then {"type": "error", "detail": ...} if something fails
    midway. A workflow the app can't export, bad credentials, a failing
    connection or a folder that can't be created is still a plain HTTP
    error."""
    zoo_creds = zooniverse._resolve(req)
    t = req.trapper
    url, username, password = trapper._resolve(t.model_copy(update={"url": t.url or t.selection.url}))
    source = classifications_export_service.TrapperSource(url, username, password, t.selection)
    output_dir = Path(req.output_dir).expanduser() if req.output_dir and req.output_dir.strip() else (
        classifications_export_service.default_output_dir()
    )
    try:
        events = classifications_export_service.export_stream(
            zoo_creds, req.workflow_id, source, output_dir,
            regenerate=req.regenerate, save_zoo_annotations=req.save_zoo_annotations,
            classified_by=(req.classified_by or "").strip() or None, max_file_size_mb=req.max_file_size_mb,
        )
    except OSError as exc:
        raise HTTPException(400, f"Can't use the folder {output_dir}: {exc}") from exc
    except Exception as exc:
        logger.warning("Export failed to start: %s", exc, exc_info=debugging())
        raise upload._http_exc(exc) from exc

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("Export failed midway: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": upload._http_exc(exc).detail}) + "\n"
        finally:
            events.close()

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.post("/import")
def import_to_trapper(req: ImportToTrapperRequest) -> StreamingResponse:
    """Imports the CSVs into Trapper, one after another, as NDJSON (see
    trapper_import_service.import_stream for its lines). A file that isn't
    a CSV, bad credentials or a project that can't be reached is a plain
    HTTP error; a file Trapper refuses is reported, and the rest still go."""
    try:
        files = trapper_import_service.check_files(req.files)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    url, username, password = trapper._resolve(req)
    try:
        events = trapper_import_service.import_stream(
            (url, username, password), req.classification_project_id, files, approve=req.approve,
        )
    except Exception as exc:
        logger.warning("Trapper import failed to start: %s", exc, exc_info=debugging())
        raise upload._http_exc(exc) from exc

    def lines() -> Iterator[str]:
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:
            logger.warning("Trapper import failed midway: %s", exc, exc_info=debugging())
            yield json.dumps({"type": "error", "detail": upload._http_exc(exc).detail}) + "\n"
        finally:
            events.close()

    return StreamingResponse(lines(), media_type="application/x-ndjson")
