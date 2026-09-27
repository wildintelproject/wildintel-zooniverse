"""Validation & audit of a Zooniverse subject set — wildintel-tools'
check-subject-set, check-missing-media, check-duplicated-media,
check-unmatched-subjects and check_metadata, in one pass. Its subjects are
read straight from Zooniverse, not from a subjects export CSV.

On its own, the subject set is checked for:
  - unmatched subjects: no Trapper media id can be read from their
    metadata (external_id or origin, "…:media:<id>"),
  - duplicated media: a media id in more than one subject,
  - metadata issues: a required field missing — and, compared with Trapper,
    a field that isn't what an upload would set (image_name aside, as
    wildintel-tools does: older uploads named it differently).

Compared with a Trapper collection (its selection and criteria, as for an
upload), also for:
  - missing media: images an upload would send that aren't in it,
  - extra media: images in it an upload wouldn't send,
with the expected/uploaded/missing counts per deployment."""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass

from wildintel_zooniverse.core.schemas.requests import TrapperSelection, UploadCriteria
from wildintel_zooniverse.core.services import trapper_service, zooniverse_service
from wildintel_zooniverse.core.services.upload_service import trapper_metadata

logger = logging.getLogger(__name__)

# wildintel-tools' own.
REQUIRED_METADATA_FIELDS = ("external_id", "preview", "link", "thumbnail", "origin", "license", "image_name")
_MEDIA_ID_RE = re.compile(r":media:(\d+)\s*$")
# A "progress" event every this many subjects listed.
PROGRESS_EVERY = 100


def media_id_of(metadata: dict) -> int | None:
    """wildintel-tools' own (_media_id_from_subject_row): from origin, then
    external_id."""
    for key in ("origin", "external_id"):
        match = _MEDIA_ID_RE.search(str(metadata.get(key) or "").strip())
        if match:
            return int(match.group(1))
    return None


def metadata_issues(metadata: dict, media_id: int | None, trapper_url: str | None) -> list[str]:
    issues = []
    missing = [f for f in REQUIRED_METADATA_FIELDS if not metadata.get(f)]
    if missing:
        issues.append(f"missing fields: {', '.join(missing)}")
    if media_id is not None and trapper_url:
        for field, expected in trapper_metadata(trapper_url, media_id, "").items():
            if field != "image_name" and metadata.get(field, "") != expected:
                issues.append(f"{field}: expected '{expected}', got '{metadata.get(field, '')}'")
    return issues


@dataclass
class TrapperComparison:
    url: str
    username: str
    password: str
    selection: TrapperSelection
    criteria: UploadCriteria


def validate_stream(
    zooniverse: tuple[str, str], subject_set_id: int, trapper: TrapperComparison | None = None,
) -> Iterator[dict]:
    """The validation's events, as the router streams them:
      - {"type": "subjects", "total"}: listing the subject set's subjects
        starts — "total" is Zooniverse's own count;
        {"type": "progress", "phase": "subjects", "done"} as they're listed.
      - With Trapper: {"type": "trapper", "total"} (deployments), then
        {"type": "deployment", ...} with each one's counts, as fetched.
      - {"type": "report", ...}: the findings (see _report), then
        {"type": "done"}.

    The subject set, and Trapper's connection and collection, are checked
    right away (errors raise here)."""
    subject_set = zooniverse_service.subject_set_info(*zooniverse, subject_set_id)
    selections = (
        trapper_service.selections_stream(trapper.url, trapper.username, trapper.password, trapper.selection, trapper.criteria)
        if trapper else None
    )

    def events() -> Iterator[dict]:
        yield {"type": "subjects", "id": subject_set["id"], "name": subject_set["display_name"],
               "total": subject_set["subjects_count"]}
        by_media: dict[int, list[int]] = defaultdict(list)
        unmatched: list[int] = []
        issues: list[dict] = []
        listed = 0
        for subject in zooniverse_service.iter_subjects(*zooniverse, subject_set_id):
            media_id = media_id_of(subject["metadata"])
            if media_id is None:
                unmatched.append(subject["id"])
            else:
                by_media[media_id].append(subject["id"])
            found = metadata_issues(subject["metadata"], media_id, trapper.url if trapper else None)
            if found:
                issues.append({"subject_id": subject["id"], "media_id": media_id, "issues": found})
            listed += 1
            if listed % PROGRESS_EVERY == 0:
                yield {"type": "progress", "phase": "subjects", "done": listed}
        yield {"type": "progress", "phase": "subjects", "done": listed}

        expected: dict[int, dict] = {}
        deployment_ids: list[str] = []
        if selections is not None:
            yield {"type": "trapper", "total": len(trapper.selection.deployments)}
            for deployment in selections:
                yield {"type": "deployment", **deployment.summary()}
                deployment_ids.append(deployment.deployment_id)
                for image in deployment.selected:
                    # The selection's own deployment id — Trapper's media may
                    # spell it in another case.
                    expected[image.media_id] = {
                        "media_id": image.media_id, "deployment_id": deployment.deployment_id, "file_name": image.file_name,
                    }

        report = _report(subject_set, listed, by_media, unmatched, issues, expected if trapper else None, deployment_ids)
        logger.info(
            "Subject set %s validated: %d subjects, %d duplicated, %d unmatched, %d metadata issues%s",
            subject_set_id, listed, len(report["duplicated"]), len(report["unmatched"]), len(report["metadata_issues"]),
            f", {len(report['missing'])} missing, {len(report['extra'])} extra" if trapper else "",
        )
        yield report
        yield {"type": "done"}

    return events()


def _report(
    subject_set: dict, subjects: int, by_media: dict[int, list[int]], unmatched: list[int], issues: list[dict],
    expected: dict[int, dict] | None, deployment_ids: list[str],
) -> dict:
    report = {
        "type": "report",
        "subject_set": {"id": subject_set["id"], "name": subject_set["display_name"]},
        "subjects": subjects,
        "media": len(by_media),
        # wildintel-tools' uploaded_media: every Trapper image in the subject
        # set, with its subject(s).
        "uploaded": [{"media_id": m, "subject_ids": s} for m, s in sorted(by_media.items())],
        "duplicated": [{"media_id": m, "subject_ids": s} for m, s in sorted(by_media.items()) if len(s) > 1],
        "unmatched": sorted(unmatched),
        "metadata_issues": sorted(issues, key=lambda i: i["subject_id"]),
        "compared": expected is not None,
    }
    if expected is None:
        return report
    missing = [expected[m] for m in sorted(expected.keys() - by_media.keys())]
    extra = [{"media_id": m, "subject_ids": by_media[m]} for m in sorted(by_media.keys() - expected.keys())]
    per_deployment = {d: {"deployment_id": d, "expected": 0, "uploaded": 0, "missing": 0} for d in deployment_ids}
    for image in expected.values():
        row = per_deployment[image["deployment_id"]]
        row["expected"] += 1
        row["uploaded" if image["media_id"] in by_media else "missing"] += 1
    return {
        **report,
        "expected": len(expected),
        "missing": missing,
        "extra": extra,
        # In the selection's order.
        "deployments": list(per_deployment.values()),
    }
