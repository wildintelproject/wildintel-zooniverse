"""The Subjects utility — wildintel-tools' subjects command: Zooniverse
subjects looked up by id, or a subject set's, a page at a time — each with
the Trapper image it is (services.subject_media)."""
from __future__ import annotations

from wildintel_zooniverse.core.services import zooniverse_service
from wildintel_zooniverse.core.services.subject_media import media_id_of

PAGE_SIZE = 50


def _with_media(subject: dict) -> dict:
    return {**subject, "media_id": media_id_of(subject["metadata"])}


def lookup(zooniverse: tuple[str, str], subject_ids: list[int]) -> dict:
    """The subjects found, and the ids that weren't (no such subject, or not
    visible to the user)."""
    found = [_with_media(s) for s in zooniverse_service.lookup_subjects(*zooniverse, subject_ids)]
    found_ids = {s["id"] for s in found}
    # In the order asked for — each id by its first appearance.
    order = {sid: i for i, sid in enumerate(dict.fromkeys(subject_ids))}
    return {
        "subjects": sorted(found, key=lambda s: order.get(s["id"], 0)),
        "not_found": [sid for sid in dict.fromkeys(subject_ids) if sid not in found_ids],
    }


def page(zooniverse: tuple[str, str], subject_set_id: int, number: int) -> dict:
    result = zooniverse_service.subject_set_page(*zooniverse, subject_set_id, number, PAGE_SIZE)
    return {**result, "subjects": [_with_media(s) for s in result["subjects"]], "page_size": PAGE_SIZE}
