"""Importing an export's observation CSVs into Trapper — wildintel-tools'
export --upload, through Trapper's API (the SDK's
classification_results.import_classifications,
POST media_classification/api/classifications/import/) instead of filling
its web form with a browser (TrapperNavigator).

With wildintel-tools' own options: only *Import expert classifications* —
rows with classificationMethod=human, updating each _id's observation — no
AI classifications, no bounding boxes, and not approved unless asked.

One file at a time, in order. Trapper may run an import in the
background (Celery): its answer then carries a task id, not a result."""
from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

from wildintel_zooniverse.core.logging_setup import debugging
from wildintel_zooniverse.core.services import trapper_service

logger = logging.getLogger(__name__)


def check_files(paths: list[str]) -> list[Path]:
    """Raises:
        ValueError: a path that isn't an existing .csv file.
    """
    files = [Path(p).expanduser() for p in paths]
    for f in files:
        if f.suffix.lower() != ".csv" or not f.is_file():
            raise ValueError(f"Not a CSV file: {f}")
    return files


def import_stream(
    trapper: tuple[str, str, str], classification_project_id: int, files: list[Path], *, approve: bool = False,
) -> Iterator[dict]:
    """The import's events, as the router streams them:
      - {"type": "file", "path", "index", "total"}: a file's upload starts.
      - {"type": "imported", "path", "message", "task_id"}: Trapper took it —
        "task_id" when it imports it in the background.
      - {"type": "failed", "path", "detail"}: Trapper refused it (e.g.
        invalid rows) or couldn't be reached — the next files still go.
      - {"type": "done", "imported", "failed"}.

    The connection is checked right away (errors raise here)."""
    client = trapper_service.client(*trapper)
    # Connection and access to the project, up front — one light query.
    client.classification_projects.get_project_collections(classification_project_id, page=1, page_size=1)
    logger.info("Importing %d CSV file(s) into Trapper classification project %s (approve=%s)",
                len(files), classification_project_id, approve)

    def events() -> Iterator[dict]:
        imported = failed = 0
        for index, path in enumerate(files, start=1):
            yield {"type": "file", "path": str(path), "index": index, "total": len(files)}
            try:
                result = client.classification_results.import_classifications(
                    project_id=classification_project_id, file=path,
                    approve=approve, import_bboxes=False,
                    import_expert_classifications=True, import_ai_classifications=False,
                )
            except Exception as exc:
                failed += 1
                logger.warning("Importing %s into Trapper failed: %s", path.name, exc, exc_info=debugging())
                yield {"type": "failed", "path": str(path), "detail": str(exc)}
                continue
            data = getattr(result, "data", None)
            message = getattr(data, "message", None)
            task_id = getattr(data, "task_id", None)
            imported += 1
            logger.info("%s imported into Trapper: %s%s", path.name, message or "ok",
                        f" (task {task_id})" if task_id else "")
            yield {"type": "imported", "path": str(path), "message": message, "task_id": task_id}
        logger.info("Trapper import finished: %d imported, %d failed", imported, failed)
        yield {"type": "done", "imported": imported, "failed": failed}

    return events()
