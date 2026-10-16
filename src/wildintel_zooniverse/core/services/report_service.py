"""The reports: a record of what a run of the Utils tasks (update metadata, validation, download of subject sets,
export of classifications) found and did — what the screen shows of it, kept so it can be looked at, downloaded
or deleted afterwards.

A report is a JSON file in config.get_reports_dir():

    {"id", "kind": "update_metadata" | "validation" | "download_subject_sets" | "export_classifications",
     "title", "created_at", "finished_at", "status": "done" | "stopped" | "error", "error"?,
     "parameters": {...}, "totals": {label: number}, "outputs": {label: text},
     "entries": [{...}, ...], "entries_total": N}

`parameters` says what was asked (never a password); `totals` are the counts the screen shows; `outputs` where
the run left its files; `entries` the rows worth keeping — the changes made, the problems found, the failures —
at most MAX_ENTRIES of them (`entries_total` counts them all). The same file gives the CSV.

A Recorder is fed the events of a run's stream, as they go by, and writes the report when the stream ends — also
when it is stopped or fails, so what was done up to then is kept."""
from __future__ import annotations

import csv
import io
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from wildintel_zooniverse.core import config

logger = logging.getLogger(__name__)

KINDS = ("update_metadata", "validation", "download_subject_sets", "export_classifications")
# Entries kept in a report — the counts cover them all.
MAX_ENTRIES = 20000

_ID = re.compile(r"^\d{8}-\d{6}_(update_metadata|validation|download_subject_sets|export_classifications)(-\d+)?$")


class ReportError(ValueError):
    """A report that isn't there, or isn't a report's id — reported to the user."""


def selection_parameters(selection: Any) -> dict:
    """What a Trapper selection says of itself, for a report's parameters."""
    return {
        "trapper": selection.url, "research_project": selection.research_project.name,
        "classification_project": selection.classification_project.name, "collection": selection.collection.name,
        "deployments": len(selection.deployments), "all_deployments": selection.all_deployments,
    }


def lists_parameters(include: list[int] | None, exclude: list[int]) -> dict:
    """The subject lists of a run: how many ids in each."""
    return {"only_subjects": None if include is None else len(include), "never_subjects": len(exclude)}


# ── recording ────────────────────────────────────────────────────────────────

class Recorder:
    """Collects a run's events into a report, and saves it with save() — once, when the run ends."""

    def __init__(self, kind: str, parameters: dict) -> None:
        assert kind in KINDS, kind
        self.kind = kind
        self.parameters = parameters
        self.created_at = datetime.now(timezone.utc)
        self.totals: dict[str, int] = {}
        self.outputs: dict[str, str] = {}
        self.entries: list[dict] = []
        self.entries_total = 0
        self.name = ""
        self.names: list[str] = []
        self.finished = False
        self.error: str | None = None
        self.events = 0
        self._counts: dict[str, int] = {}

    # --- feeding

    def feed(self, event: dict) -> None:
        """Takes in one event of the run's stream. Never raises: a report that can't be made mustn't stop the run."""
        try:
            self.events += 1
            getattr(self, f"_feed_{self.kind}")(event)
        except Exception:  # pragma: no cover - defensive
            logger.warning("Could not record a %s event for the report", self.kind, exc_info=True)

    def fail(self, detail: str) -> None:
        self.error = detail

    def _entry(self, entry: dict) -> None:
        self.entries_total += 1
        if len(self.entries) < MAX_ENTRIES:
            self.entries.append(entry)

    def _feed_update_metadata(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "subjects":
            self.name = event.get("name", "")
            self.totals["subjects"] = event.get("total", 0)
        elif kind == "subject":
            status = event["status"]
            self._counts[status] = self._counts.get(status, 0) + 1
            if status == "failed":
                self._entry({"subject_id": event["subject_id"], "media_id": event.get("media_id"), "status": status,
                             "field": "", "old": "", "new": "", "detail": event.get("detail", "")})
            else:
                for change in event.get("changes", []):
                    self._entry({"subject_id": event["subject_id"], "media_id": event.get("media_id"), "status": status,
                                 "field": change["field"], "old": change.get("old"), "new": change["new"], "detail": ""})
        elif kind == "done":
            self.finished = True
            self.parameters["dry_run"] = event.get("dry_run", self.parameters.get("dry_run"))
            for key in ("unchanged", "unmatched", "not_found", "would_update", "updated", "failed", "filtered_out"):
                self.totals[key] = event.get(key, 0)

    def _feed_validation(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "subjects":
            self.name = event.get("name", "")
        elif kind == "report":
            self.name = self.name or event["subject_set"]["name"]
            t = self.totals
            t["subjects"], t["media"] = event["subjects"], event["media"]
            t["duplicated"], t["unmatched"] = len(event["duplicated"]), len(event["unmatched"])
            t["metadata_issues"] = len(event["metadata_issues"])
            for item in event["duplicated"]:
                self._entry({"issue": "duplicated image", "media_id": item["media_id"], "subject_ids": item["subject_ids"]})
            for subject_id in event["unmatched"]:
                self._entry({"issue": "no Trapper media id", "subject_ids": [subject_id]})
            for item in event["metadata_issues"]:
                self._entry({"issue": "metadata", "media_id": item.get("media_id"), "subject_ids": [item["subject_id"]],
                             "detail": "; ".join(item["issues"])})
            if event.get("compared"):
                self.parameters["compared"] = True
                t["expected"], t["missing"], t["extra"] = event["expected"], len(event["missing"]), len(event["extra"])
                for item in event["missing"]:
                    self._entry({"issue": "missing from the subject set", "media_id": item["media_id"],
                                 "deployment_id": item["deployment_id"], "detail": item["file_name"]})
                for item in event["extra"]:
                    self._entry({"issue": "not in the Trapper selection", "media_id": item["media_id"], "subject_ids": item["subject_ids"]})
        elif kind == "done":
            self.finished = True

    def _feed_download_subject_sets(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "subject_set":
            self.names.append(event.get("name", ""))
            self.totals["images"] = self.totals.get("images", 0) + event.get("total", 0)
        elif kind == "subject":
            self._counts[event["status"]] = self._counts.get(event["status"], 0) + 1
            if event["status"] == "failed":
                self._entry({"subject_set_id": event["subject_set_id"], "subject_id": event["subject_id"],
                             "file_name": event.get("file_name", ""), "detail": event.get("detail", "")})
        elif kind == "done":
            self.finished = True
            for key in ("downloaded", "existing", "failed", "filtered_out"):
                self.totals[key] = event.get(key, 0)
            self.outputs["folder"] = event.get("output_dir", "")

    def _feed_export_classifications(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "done":
            self.finished = True
            self.name = event["workflow"]["name"]
            t = self.totals
            t["subjects"], t["images"], t["exported"] = event["subjects"], event["trapper_media"], event["exported"]
            t["observations"], t["rows"] = event["observations"], event["rows"]
            for reason, n in event["skipped"].items():
                t[f"skipped_{reason}"] = n
                if n:
                    self._entry({"kind": "not exported", "what": reason, "count": n,
                                 "detail": " ".join(str(i) for i in event.get("samples", {}).get(reason, [])[:10])})
            files = list(event["files"]) + [f for f in (event.get("zoo_annotations_file"), event.get("raw_export_file")) if f]
            for f in files:
                self._entry({"kind": "file", "what": Path(f["path"]).name, "count": f.get("rows", ""), "detail": f"{f['bytes']} bytes"})
            self.outputs["folder"] = event.get("run_dir") or event.get("output_dir") or ""

    # --- saving

    @property
    def status(self) -> str:
        return "error" if self.error else "done" if self.finished else "stopped"

    def title(self) -> str:
        if self.kind == "update_metadata":
            return f"{'Dry run' if self.parameters.get('dry_run', True) else 'Update'} of metadata — {self.name or 'subject set'}"
        if self.kind == "validation":
            return f"Validation{' against Trapper' if self.parameters.get('compared') else ''} — {self.name or 'subject set'}"
        if self.kind == "download_subject_sets":
            shown = ", ".join(self.names[:3]) + ("…" if len(self.names) > 3 else "")
            return f"Download of subject sets — {shown or 'no subject set'}"
        return f"Export of classifications — {self.name or 'workflow'}"

    def report(self) -> dict:
        totals = dict(self.totals)
        for status, n in self._counts.items():
            totals.setdefault(status, n)
        report = {
            "kind": self.kind, "title": self.title(), "created_at": self.created_at.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(), "status": self.status,
            "parameters": self.parameters, "totals": totals, "outputs": self.outputs,
            "entries": self.entries, "entries_total": self.entries_total,
        }
        if self.error:
            report["error"] = self.error
        return report

    def save(self) -> str | None:
        """Writes the report — nothing if the run never got going. Never raises."""
        if self.events == 0 and not self.error:
            return None
        try:
            return save(self.report())
        except Exception:
            logger.warning("Could not save the report of a %s run", self.kind, exc_info=True)
            return None


# ── the files ────────────────────────────────────────────────────────────────

def save(report: dict, root: Path | None = None) -> str:
    """Writes the report to the reports folder and returns its id — also set in the report."""
    root = root or config.get_reports_dir()
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_id, n = f"{stamp}_{report['kind']}", 1
    while (root / f"{report_id}.json").exists():
        n += 1
        report_id = f"{stamp}_{report['kind']}-{n}"
    report["id"] = report_id
    tmp = root / f"{report_id}.json.tmp"
    tmp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(root / f"{report_id}.json")
    return report_id


def _path(report_id: str, root: Path | None) -> Path:
    if not _ID.match(report_id):
        raise ReportError(f"'{report_id}' isn't a report.")
    path = (root or config.get_reports_dir()) / f"{report_id}.json"
    if not path.is_file():
        raise ReportError(f"There is no report '{report_id}'.")
    return path


def read(report_id: str, root: Path | None = None) -> dict:
    """Raises:
        ReportError: it isn't a report's id, or there is no such report.
    """
    return json.loads(_path(report_id, root).read_text(encoding="utf-8"))


def list_reports(root: Path | None = None) -> list[dict]:
    """What each report says of itself, newest first — without its entries."""
    root = root or config.get_reports_dir()
    out = []
    for path in sorted(root.glob("*.json"), reverse=True) if root.is_dir() else []:
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append({k: report.get(k) for k in ("id", "kind", "title", "created_at", "finished_at", "status", "totals", "entries_total")})
    return out


def delete(report_id: str, root: Path | None = None) -> None:
    _path(report_id, root).unlink()


def delete_older_than(days: int, root: Path | None = None) -> int:
    """Deletes the reports older than `days` days, and says how many."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    gone = 0
    for item in list_reports(root):
        try:
            if datetime.fromisoformat(item["created_at"]) < cutoff:
                delete(item["id"], root)
                gone += 1
        except (TypeError, ValueError, ReportError):
            continue
    return gone


def to_csv(report: dict) -> str:
    """One row per entry; the columns are the fields the entries have, in the order they first appear."""
    columns: list[str] = []
    for entry in report["entries"]:
        columns.extend(k for k in entry if k not in columns)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(columns)
    for entry in report["entries"]:
        writer.writerow([" ".join(map(str, v)) if isinstance(v := entry.get(c, ""), list) else ("" if v is None else v) for c in columns])
    return out.getvalue()
