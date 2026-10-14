"""Importing an export's observation CSVs into Trapper — wildintel-tools'
export --upload, through Trapper's API (the SDK's
classification_results.import_classifications,
POST media_classification/api/classifications/import/) instead of filling
its web form with a browser (TrapperNavigator).

With wildintel-tools' own options: only *Import expert classifications* —
rows with classificationMethod=human, which Trapper turns into new observations of each
_id (replacing the media's previous ones) — no
AI classifications, no bounding boxes, and not approved unless asked.

One file at a time, in order. Trapper may run an import in the
background (Celery): its answer then carries a task id, not a result."""
from __future__ import annotations

import csv
import logging
import re
from collections import Counter
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


def catalog_species(client) -> set[str] | None:
    """The latin names in Trapper's species catalog — None if it can't be
    read (the check is then skipped)."""
    try:
        names = {sp.latin_name for sp in client.species.where(page_size=500) if getattr(sp, "latin_name", None)}
    except Exception as exc:
        logger.warning("Couldn't read Trapper's species catalog, not checking the CSVs' species: %s", exc)
        return None
    return names or None


def unknown_species(path: Path, catalog: set[str]) -> Counter:
    """The CSV's scientific names that aren't in the catalog, with their
    rows: Trapper's import rejects them (and, when it doesn't say so
    properly, answers a 500)."""
    with path.open(newline="", encoding="utf-8") as f:
        names = Counter(row.get("scientificName") or "" for row in csv.DictReader(f))
    return Counter({name: n for name, n in names.items() if name and name not in catalog})


def short_error(exc: Exception) -> str:
    """The error as one readable line: Trapper's unhandled errors come as a
    whole HTML page."""
    text = str(exc)
    if "<html" in text.lower() or "<!doctype" in text.lower():
        status = re.search(r"status (\d+)", text)
        return (f"Trapper failed with an internal error{f' (HTTP {status[1]})' if status else ''}, not a validation "
                "message — usually a row it can't handle, e.g. a scientificName missing from the project's species. "
                "Check the CSV and Trapper's log.")
    return text if len(text) <= 500 else text[:500] + "…"


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
        catalog = catalog_species(client)
        for index, path in enumerate(files, start=1):
            yield {"type": "file", "path": str(path), "index": index, "total": len(files)}
            unknown = unknown_species(path, catalog) if catalog else None
            if unknown:
                failed += 1
                detail = ("Not imported: species missing from Trapper's catalog — "
                          + ", ".join(f"{name} ({n} rows)" for name, n in unknown.most_common()))
                logger.warning("%s not imported into Trapper: %s", path.name, detail)
                yield {"type": "failed", "path": str(path), "detail": detail}
                continue
            try:
                result = client.classification_results.import_classifications(
                    project_id=classification_project_id, file=path,
                    approve=approve, import_bboxes=False,
                    import_expert_classifications=True, import_ai_classifications=False,
                )
            except Exception as exc:
                failed += 1
                logger.warning("Importing %s into Trapper failed: %s", path.name, exc, exc_info=debugging())
                yield {"type": "failed", "path": str(path), "detail": short_error(exc)}
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
