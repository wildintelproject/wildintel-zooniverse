"""Reading ids from what a user loads or pastes — the same rules as the web
app's frontend/src/lib/mediaIds.ts, for the command-line app:
  - a plain list — one per line, or separated by commas, spaces, "|"…;
  - a CSV/TSV with a header: its id column ("media_id", "mediaID",
    "media_ids"… or "subject_id", "subject_ids"… — "|"-separated lists too);
  - a JSON array of ids, or of objects with one (media_id / subject_id,
    subject_ids) — or a report of the app's: for media ids, the validation
    report's missing images; for subject ids, its subjects with metadata
    issues, or an Update metadata log's subjects."""
from __future__ import annotations

import json
import re
from typing import Literal

IdKind = Literal["media", "subject"]

_COLUMNS: dict[str, tuple[str, ...]] = {
    "media": ("media_id", "mediaid", "media_ids", "media"),
    "subject": ("subject_id", "subjectid", "subject_ids", "subject"),
}
_REPORT_KEYS: dict[str, tuple[str, ...]] = {"media": ("missing",), "subject": ("metadata_issues", "subjects")}


def parse_ids(text: str, kind: IdKind) -> tuple[list[int], int]:
    """The ids, unique and sorted, and how many tokens weren't ids."""
    trimmed = text.strip()
    if not trimmed:
        return [], 0
    if trimmed[0] in "[{":
        parsed = _parse_json(trimmed, kind)
        if parsed is not None:
            return parsed
    lines = trimmed.splitlines()
    header = [h.strip().strip('"').lower() for h in re.split(r"[,;\t]", lines[0])]
    column = next((i for i, h in enumerate(header) if h in _COLUMNS[kind]), None)
    if column is not None:
        tokens = []
        for line in lines[1:]:
            cells = re.split(r"[,;\t]", line)
            if column < len(cells):
                tokens += cells[column].replace('"', "").split("|")
        return _collect(tokens)
    return _collect(re.split(r"[\s,;|]+", trimmed))


def _collect(tokens: list[str]) -> tuple[list[int], int]:
    ids: set[int] = set()
    ignored = 0
    for token in (t.strip() for t in tokens):
        if not token:
            continue
        if token.isdigit():
            ids.add(int(token))
        else:
            ignored += 1
    return sorted(ids), ignored


def _parse_json(text: str, kind: IdKind) -> tuple[list[int], int] | None:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    items: list = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        key = next((k for k in _REPORT_KEYS[kind] if isinstance(data.get(k), list)), None)
        items = data[key] if key else []
    field = "media_id" if kind == "media" else "subject_id"
    tokens: list[str] = []
    for item in items:
        if isinstance(item, (int, str)):
            tokens.append(str(item))
        elif isinstance(item, dict) and field in item:
            tokens.append(str(item[field]))
        elif isinstance(item, dict) and kind == "subject" and isinstance(item.get("subject_ids"), list):
            tokens += [str(i) for i in item["subject_ids"]]
        else:
            tokens.append("?")
    return _collect(tokens)
