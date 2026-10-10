"""Exporting Zooniverse classifications as Trapper observations — the CSV
half of wildintel-tools' export (TrapperZooniverseConnector.
upload_annotations). Importing that CSV into Trapper isn't done here yet:
it's imported by hand, in Trapper's classification import page.

  1. The workflow's classifications export is downloaded — the latest one,
     or a new one made first — and each row's volunteers' answers grouped
     by subject. A subject's Trapper media id comes from its metadata
     (inside the export's subject_data): its Filename/image_name prefix, or
     external_id — wildintel-tools only read the file name, so older
     uploads, named after the original file, were skipped.
  2. The Trapper selection's observations are fetched, deployment by
     deployment: the media each one belongs to, and its _id.
  3. Each subject's classifications go through the workflow's extractor
     and voter (services.annotations) — its observations — and each goes
     into the CSV once per Trapper observation of its media, with that
     observation's _id: the one Trapper's import updates.
  4. The CSV is written — split into _part001, _part002… files when bigger
     than the configured size — plus, optionally, the volunteers' raw
     answers ("zoo_annotations_…").

Subjects whose media isn't in the Trapper selection are skipped — a
workflow's export has every subject set's classifications."""
from __future__ import annotations

import contextlib
import csv
import io
import json
import logging
import threading
import time
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core.schemas.requests import TrapperSelection
from wildintel_zooniverse.core.services import trapper_service, zooniverse_service
from wildintel_zooniverse.core.services.annotations import registry
from wildintel_zooniverse.core.services.annotations.models import ClassificationInfo
from wildintel_zooniverse.core.services.subject_media import media_id_of

logger = logging.getLogger(__name__)

# wildintel-tools' own columns — the ones Trapper's import reads.
CSV_FIELDS = ["observationType", "scientificName", "count", "classifiedBy", "classificationMethod", "observationComments", "_id"]
ZOO_CSV_FIELDS = ["subject_id", "k_majority", "scientific_name", "answers"]
# How long to wait for a new classifications export — Zooniverse queues
# them, and big workflows have taken hours.
EXPORT_TIMEOUT_S = 6 * 60 * 60
EXPORT_POLL_S = 5
# Seconds between "still generating" events: they keep the response (and
# whatever proxy or browser sits on it) from going idle for hours.
EXPORT_HEARTBEAT_S = 30
# Failed lookups in a row while waiting before giving up — a lost login or a
# dead connection, not a hiccup.
EXPORT_MAX_POLL_ERRORS = 5
# Progress events every this many export rows / subjects.
ROWS_EVERY = 5000
SUBJECTS_EVERY = 500
# Subject ids kept per kind of skipped subject, for the report.
SAMPLE_SIZE = 200

SKIP_REASONS = ("not_in_trapper", "no_media_id", "no_valid_classifications", "no_decision")


def default_output_dir() -> Path:
    """The settings' export folder, or "exports" in the app's documents."""
    saved = (config.load_settings().ZOONIVERSE.export_output_dir or "").strip()
    return Path(saved).expanduser() if saved else config.get_app_documents_dir() / "exports"


@dataclass
class TrapperSource:
    url: str
    username: str
    password: str
    selection: TrapperSelection


# ── The classifications export ──────────────────────────────────────────

def parse_subject_ids(value: str | None) -> list[int]:
    """wildintel-tools' own (_parse_subject_ids): "123", "123,456",
    "[123, 456]"…"""
    v = (value or "").strip()
    if not v:
        return []
    if "," in v:
        parts = [p.strip() for p in v.split(",") if p.strip()]
    elif v.startswith("[") and v.endswith("]"):
        try:
            parts = [str(x).strip() for x in json.loads(v.replace("'", '"'))]
        except json.JSONDecodeError:
            parts = [v.strip("[] \t\n'\"")]
    else:
        parts = [v]
    ids = []
    for p in parts:
        digits = p if p.isdigit() else "".join(ch for ch in p if ch.isdigit())
        if digits:
            ids.append(int(digits))
    return ids


def _load_json(value: str | None, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        try:
            return json.loads(value.replace("'", '"'))
        except json.JSONDecodeError:
            return default




@dataclass
class SubjectClassifications:
    media_id: int | None
    classifications: list[ClassificationInfo]


def group_rows(rows: Iterator[dict], workflow_id: int) -> dict[int, SubjectClassifications]:
    """The export's rows, grouped by subject — wildintel-tools'
    AnnotationsComponent.get_by_workflow."""
    subjects: dict[int, SubjectClassifications] = {}
    for row in rows:
        if row.get("workflow_id") and str(row["workflow_id"]) != str(workflow_id):
            continue
        subject_data = _load_json(row.get("subject_data"), {})
        annotations = _load_json(row.get("annotations"), [])
        for sid in parse_subject_ids(row.get("subject_ids")):
            data = subject_data.get(str(sid)) or {}
            retired = (data.get("retired") or {}).get("retirement_reason") if isinstance(data.get("retired"), dict) else None
            name = next((data[k] for k in ("filename", "Filename", "file_name", "name", "display_name") if data.get(k)), None)
            entry = subjects.get(sid)
            if entry is None:
                entry = subjects[sid] = SubjectClassifications(media_id_of(data), [])
            entry.classifications.append(ClassificationInfo(
                classification_id=row.get("classification_id"), user_name=row.get("user_name"),
                user_id=row.get("user_id"), subject_name=name, retired=retired is not None,
                retirement_reason=retired, annotations=annotations if isinstance(annotations, list) else [], sid=sid,
            ))
    return subjects


# ── The CSVs ────────────────────────────────────────────────────────────

def write_csv(rows: list[dict], path: Path, fields: list[str], max_size_mb: float | None) -> list[dict]:
    """Writes the rows — split into path_part001.csv, _part002… when they'd
    be bigger than max_size_mb (wildintel-tools' own estimate: bytes per row
    from a sample of 200). Returns each file's path and row count."""
    def write(chunk: list[dict], dest: Path) -> dict:
        with dest.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            writer.writerows(chunk)
        return {"path": str(dest), "rows": len(chunk), "bytes": dest.stat().st_size}

    if not rows or max_size_mb is None:
        return [write(rows, path)]

    sample = rows[: min(200, len(rows))]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields)
    writer.writeheader()
    writer.writerows(sample)
    text = buf.getvalue()
    header_bytes = len(text.split("\n")[0].encode("utf-8")) + 1
    bytes_per_row = (len(text.encode("utf-8")) - header_bytes) / len(sample)
    rows_per_chunk = max(1, int((max_size_mb * 1024 * 1024 - header_bytes) / bytes_per_row))
    if len(rows) <= rows_per_chunk:
        return [write(rows, path)]
    return [
        write(rows[start:start + rows_per_chunk], path.with_name(f"{path.stem}_part{i:03d}{path.suffix}"))
        for i, start in enumerate(range(0, len(rows), rows_per_chunk), start=1)
    ]


def observation_rows(decisions, observation_ids: list[int], classified_by: str) -> list[dict]:
    """Each voted observation once per Trapper observation of the media —
    wildintel-tools' own."""
    return [
        {
            "observationType": d.observationType, "scientificName": d.scientificName, "count": d.count,
            "classifiedBy": classified_by, "classificationMethod": "human",
            "observationComments": d.observationComments, "_id": obs_id,
        }
        for d in decisions for obs_id in observation_ids
    ]


def zoo_rows(extracted: list) -> list[dict]:
    return [
        {"subject_id": sid, "k_majority": k, "scientific_name": name,
         "answers": json.dumps(answers) if isinstance(answers, dict) else str(answers)}
        for k, sid, choices in extracted for name, answers in choices
    ]


def has_file(export: dict | None) -> bool:
    """Whether the export can be downloaded: its file is there (or, with no
    way to tell, Zooniverse says it's done)."""
    return bool(export and export.get("url") and (export.get("file_date") or not export["pending"]))


def file_date_of(export: dict) -> str | None:
    return export.get("file_date") or export["updated_at"]


def recent(export: dict) -> bool:
    """Whether the export was requested less than Zooniverse's cooldown ago."""
    try:
        requested = datetime.fromisoformat(export["updated_at"].replace("Z", "+00:00"))
    except (AttributeError, KeyError, ValueError):
        return False
    return (datetime.now(timezone.utc) - requested).total_seconds() < zooniverse_service.EXPORT_COOLDOWN_S


def is_newer(current: dict, previous: dict | None) -> bool:
    """Whether the export is a new one, not the `previous` file again: its
    file was made at another time, or Zooniverse finished it since."""
    if not has_file(previous):
        return True
    if current.get("file_date") and current["file_date"] != previous.get("file_date"):
        return True
    return not current["pending"] and current["updated_at"] != previous["updated_at"]


# ── The run ─────────────────────────────────────────────────────────────

def export_stream(
    zooniverse: tuple[str, str], workflow_id: int, trapper: TrapperSource, output_dir: Path, *,
    regenerate: bool = False, save_zoo_annotations: bool = True, save_raw_export: bool = False,
    classified_by: str | None = None, max_file_size_mb: float | None = None,
) -> Iterator[dict]:
    """The export's events, as the router streams them:
      - {"type": "export", "state", "updated_at"}: the classifications
        export — "generating" while a new one is made, then "ready".
      - {"type": "classifications", "rows", "bytes", "total_bytes"}: as it
        downloads; then {"type": "classifications_done", "rows", "subjects"}.
      - {"type": "trapper", "total"}, then {"type": "deployment",
        "deployment_id", "media", "observations"} per deployment.
      - {"type": "subjects", "total"}, then {"type": "progress", "done"} as
        subjects are voted.
      - {"type": "done", ...}: the files written, and the counts — see the
        end of events().

    Everything an export writes goes into a folder of its own inside
    `output_dir`, named after the workflow, the collection and the time
    (run_dir); with `save_raw_export`, Zooniverse's own classifications CSV
    among it.

    The workflow (and that it can be exported), Trapper's connection and
    collection, and the folder are checked right away (errors raise
    here). Closing the iterator stops it, nothing written."""
    zoo = config.load_settings().ZOONIVERSE
    classified_by = classified_by or zoo.export_classified_by
    max_file_size_mb = max_file_size_mb if max_file_size_mb is not None else zoo.export_max_file_size_mb

    extractor, voter = registry.extractor_and_voter(workflow_id)
    workflow = zooniverse_service.workflow_name(*zooniverse, workflow_id)
    observations_stream = trapper_service.observation_index_stream(
        trapper.url, trapper.username, trapper.password, trapper.selection,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Exporting workflow %s (%s) against Trapper collection %s into %s (regenerate=%s)",
                workflow_id, workflow, trapper.selection.collection.pk, output_dir, regenerate)
    cancel = threading.Event()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    sel = trapper.selection
    run_dir = output_dir / f"wf{workflow_id}_cp{sel.classification_project.pk}_col{sel.collection.pk}_{stamp}"

    def export_url() -> Iterator[dict | str]:
        """The events while the export is found (or made), then its URL."""
        current = zooniverse_service.classifications_export(*zooniverse, workflow_id)
        if not (regenerate or current is None) and has_file(current):
            # Zooniverse's "state" isn't trusted: a file there is the export.
            yield {"type": "export", "state": "ready", "updated_at": file_date_of(current)}
            yield current["url"]
            return

        previous = current
        # A request made less than a day ago is waited for, not repeated —
        # Zooniverse wouldn't take another. An older one that never finished
        # is asked again.
        if current is None or not (current["pending"] and recent(current)):
            zooniverse_service.generate_classifications_export(*zooniverse, workflow_id)
        yield {"type": "export", "state": "generating", "updated_at": None}
        started = time.monotonic()
        deadline = started + EXPORT_TIMEOUT_S
        last_beat = started
        errors = 0
        while True:
            try:
                current = zooniverse_service.classifications_export(*zooniverse, workflow_id, strict=True)
                errors = 0
            except Exception as exc:
                errors += 1
                logger.warning("Looking up the export failed (%d/%d): %s", errors, EXPORT_MAX_POLL_ERRORS, exc)
                if errors >= EXPORT_MAX_POLL_ERRORS:
                    raise
                current = None
            if current and has_file(current) and is_newer(current, previous):
                break
            now = time.monotonic()
            if now > deadline:
                raise TimeoutError(f"Zooniverse didn't have the export ready in {EXPORT_TIMEOUT_S // 3600} hours — try again later.")
            if now - last_beat >= EXPORT_HEARTBEAT_S:
                last_beat = now
                yield {"type": "export", "state": "generating", "updated_at": None}
            if cancel.wait(EXPORT_POLL_S):
                return
        yield {"type": "export", "state": "ready", "updated_at": file_date_of(current)}
        yield current["url"]

    def events() -> Iterator[dict]:
        url = None
        for item in export_url():
            if isinstance(item, str):
                url = item
            else:
                yield item

        # 1. The classifications, grouped by subject a chunk of rows at a
        # time — progress in between.
        subjects: dict[int, SubjectClassifications] = {}
        rows = 0
        downloaded = 0
        raw_path = run_dir / f"zooniverse_classifications_wf{workflow_id}_{stamp}.csv"
        raw = None
        if save_raw_export:
            run_dir.mkdir(parents=True, exist_ok=True)
            raw = raw_path.open("w", encoding="utf-8", newline="")
        completed = False
        try:
            with httpx.stream("GET", url, timeout=httpx.Timeout(120, connect=15), follow_redirects=True) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length") or 0) or None

                def lines() -> Iterator[str]:
                    nonlocal downloaded
                    for line in response.iter_lines():
                        downloaded += len(line.encode("utf-8")) + 1
                        if raw:
                            raw.write(line + "\n")
                        yield line

                chunk: list[dict] = []
                for row in csv.DictReader(lines()):
                    chunk.append(row)
                    rows += 1
                    if len(chunk) >= ROWS_EVERY:
                        _merge_all(subjects, group_rows(iter(chunk), workflow_id))
                        chunk = []
                        yield {"type": "classifications", "rows": rows, "bytes": downloaded, "total_bytes": total}
                _merge_all(subjects, group_rows(iter(chunk), workflow_id))
            completed = True
        finally:
            if raw:
                raw.close()
                if not completed:
                    # Stopped or failed midway: a half file isn't kept.
                    raw_path.unlink(missing_ok=True)
                    with contextlib.suppress(OSError):
                        run_dir.rmdir()
        yield {"type": "classifications_done", "rows": rows, "subjects": len(subjects)}

        # 2. Trapper's observations.
        yield {"type": "trapper", "total": len(trapper.selection.deployments)}
        observations: dict[int, list[int]] = {}
        for deployment_id, by_media in observations_stream:
            for media_id, ids in by_media.items():
                observations[media_id] = list(dict.fromkeys(observations.get(media_id, []) + ids))
            yield {"type": "deployment", "deployment_id": deployment_id, "media": len(by_media),
                   "observations": sum(len(ids) for ids in by_media.values())}

        # 3. Voting.
        yield {"type": "subjects", "total": len(subjects)}
        counts: Counter[str] = Counter()
        samples: dict[str, list[int]] = defaultdict(list)
        csv_rows: list[dict] = []
        raw_rows: list[dict] = []
        for done, (sid, entry) in enumerate(sorted(subjects.items()), start=1):
            reason = None
            if entry.media_id is None:
                reason = "no_media_id"
            elif entry.media_id not in observations:
                reason = "not_in_trapper"
            else:
                extracted = extractor.run(entry.classifications)
                decisions = voter.run(extracted) if extracted else None
                if not extracted:
                    reason = "no_valid_classifications"
                elif not decisions:
                    reason = "no_decision"
                else:
                    csv_rows.extend(observation_rows(decisions, observations[entry.media_id], classified_by))
                    raw_rows.extend(zoo_rows(extracted))
                    counts["exported"] += 1
                    counts["observations"] += len(decisions)
            if reason:
                counts[reason] += 1
                if len(samples[reason]) < SAMPLE_SIZE:
                    samples[reason].append(sid)
            if done % SUBJECTS_EVERY == 0:
                yield {"type": "progress", "done": done}
        yield {"type": "progress", "done": len(subjects)}

        # 4. The files.
        path = run_dir / f"observations_wf{workflow_id}_cp{sel.classification_project.pk}_col{sel.collection.pk}_{stamp}.csv"
        if csv_rows or raw is not None:
            run_dir.mkdir(parents=True, exist_ok=True)
        files = write_csv(csv_rows, path, CSV_FIELDS, max_file_size_mb) if csv_rows else []
        logger.info("Workflow %s exported: %d of %d subjects, %d CSV rows in %d file(s) — skipped %s",
                    workflow_id, counts["exported"], len(subjects), len(csv_rows), len(files),
                    {r: counts[r] for r in SKIP_REASONS if counts[r]})
        zoo_file = None
        if save_zoo_annotations and raw_rows:
            zoo_file = write_csv(raw_rows, path.with_name(f"zoo_annotations_{path.name}"), ZOO_CSV_FIELDS, None)[0]

        yield {
            "type": "done",
            "workflow": {"id": workflow_id, "name": workflow},
            "subjects": len(subjects), "trapper_media": len(observations), "exported": counts["exported"],
            "observations": counts["observations"], "rows": len(csv_rows),
            "skipped": {reason: counts[reason] for reason in SKIP_REASONS},
            "samples": {reason: samples[reason] for reason in SKIP_REASONS if samples[reason]},
            "files": files, "zoo_annotations_file": zoo_file,
            "raw_export_file": {"path": str(raw_path), "bytes": raw_path.stat().st_size} if save_raw_export else None,
            "output_dir": str(output_dir), "run_dir": str(run_dir) if run_dir.is_dir() else None,
            "trapper_import_url": trapper.url.rstrip("/") + "/media_classification/classification/import/",
        }

    def guarded() -> Iterator[dict]:
        try:
            yield from events()
        finally:
            cancel.set()

    return guarded()


def _merge_all(subjects: dict[int, SubjectClassifications], more: dict[int, SubjectClassifications]) -> None:
    for sid, entry in more.items():
        current = subjects.get(sid)
        if current is None:
            subjects[sid] = entry
        else:
            current.classifications.extend(entry.classifications)
            current.media_id = current.media_id or entry.media_id
