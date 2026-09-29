"""Which images of a deployment get uploaded to Zooniverse — the same
selection wildintel-tools' TrapperZooniverseConnector makes
(_generate_zoo_images_from_media_map and its helpers), as pure functions:

  1. Candidates: images whose file is public and, with only_classified, that
     have at least one observation other than "unclassified".
  2. Sequences: a deployment's candidates, sorted by timestamp, split
     wherever two consecutive images are more than max_interval seconds apart.
  3. Middle-sequence filter: images with a "human" (and, optionally,
     "vehicle") observation are removed from every sequence but the first
     and the last — the camera being set up and collected. A sequence left
     empty is dropped. With 2 sequences or fewer, nothing is removed.
  4. Collapse empty sequences: with collapse_empty_sequences, a sequence
     (any of them, not just the middle ones) left with more than one image,
     all with no detection (NO_DETECTION_OBSERVATION_TYPES: "empty" or
     Camtrap DP's own "blank"), is reduced to its second image.
  5. Sampling: each sequence keeps images_per_sequence images, evenly spaced
     (first and last always included); shorter ones are kept whole.

Only remove_middle_vehicles is new here — wildintel-tools filters humans
alone. collapse_empty_sequences is wildintel-tools' own too.

With detail=True, select_deployment also says what became of every
sequence and image — wildintel-tools' analyze-sequences, but with the very
criteria the upload uses (see SequenceDetail)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from itertools import pairwise

from wildintel_zooniverse.core.schemas.requests import UploadCriteria


@dataclass
class Candidate:
    media_id: int
    deployment_id: str
    timestamp: datetime
    public: bool
    # Every observation type the image has in the classification project.
    observation_types: set[str] = field(default_factory=set)
    # Where its file is downloaded from, and its original name.
    file_url: str | None = None
    file_name: str | None = None


# What became of a candidate image, in its sequence.
UPLOADED = "uploaded"
NOT_SAMPLED = "not_sampled"      # the sequence has more than images_per_sequence
REMOVED_HUMAN = "removed_human"  # a middle sequence's image with a human
REMOVED_VEHICLE = "removed_vehicle"
COLLAPSED_EMPTY = "collapsed_empty"  # an all-"empty" sequence's image but its second


@dataclass
class SequenceDetail:
    number: int
    start: datetime
    end: datetime
    # Every candidate of the sequence, by time, with what became of it.
    images: list[tuple[Candidate, str]]

    def to_dict(self) -> dict:
        by_status: dict[str, list[int]] = {
            UPLOADED: [], NOT_SAMPLED: [], REMOVED_HUMAN: [], REMOVED_VEHICLE: [], COLLAPSED_EMPTY: [],
        }
        for image, status in self.images:
            by_status[status].append(image.media_id)
        return {
            "number": self.number, "start": self.start.isoformat(), "end": self.end.isoformat(),
            "duration_s": round((self.end - self.start).total_seconds()),
            "images": len(self.images),
            # Every media id, in time order, whatever became of it — the
            # per-status lists below are each internally in time order too,
            # but grouped, so they can't be used to show the sequence as it
            # actually happened.
            "order": [image.media_id for image, _ in self.images],
            **by_status,
        }


@dataclass
class DeploymentSelection:
    deployment_id: str
    # Its images in the collection, before any criterion.
    images: int = 0
    candidates: int = 0
    sequences: int = 0
    removed_middle: int = 0
    selected: list[Candidate] = field(default_factory=list)
    # With detail: every sequence, in time order.
    sequences_detail: list[SequenceDetail] | None = None

    def summary(self) -> dict:
        return {
            "deployment_id": self.deployment_id, "images": self.images, "candidates": self.candidates,
            "sequences": self.sequences, "removed_middle": self.removed_middle, "selected": len(self.selected),
        }


def is_candidate(c: Candidate, criteria: UploadCriteria) -> bool:
    if not c.public:
        return False
    return not criteria.only_classified or bool(c.observation_types - {"unclassified"})


def split_sequences(candidates: list[Candidate], max_interval: int) -> list[list[Candidate]]:
    ordered = sorted(candidates, key=lambda c: c.timestamp)
    if not ordered:
        return []
    sequences = [[ordered[0]]]
    for prev, curr in pairwise(ordered):
        if (curr.timestamp - prev.timestamp).total_seconds() <= max_interval:
            sequences[-1].append(curr)
        else:
            sequences.append([curr])
    return sequences


def filter_middle_sequences(sequences: list[list[Candidate]], removed_types: set[str]) -> list[list[Candidate]]:
    if not removed_types or len(sequences) <= 2:
        return sequences
    middle = ([c for c in seq if not c.observation_types & removed_types] for seq in sequences[1:-1])
    return [sequences[0], *(seq for seq in middle if seq), sequences[-1]]


def sample_sequence(sequence: list[Candidate], n: int) -> list[Candidate]:
    if len(sequence) <= n:
        return sequence
    step = (len(sequence) - 1) / (n - 1) if n > 1 else 0
    return [sequence[round(i * step)] for i in range(n)]


# wildintel-tools' own collapse_empty_sequences only checked for "empty" —
# Camtrap DP's own observationType vocabulary (what AI classifiers such as
# YOLO/DeepFaune actually write into Trapper) uses "blank" for the same
# thing instead, so both count.
NO_DETECTION_OBSERVATION_TYPES = {"empty", "blank"}


def collapse_empty_sequence(sequence: list[Candidate]) -> list[Candidate]:
    """A sequence of more than one image, every one of them with no
    detection (NO_DETECTION_OBSERVATION_TYPES), is reduced to its second
    image — applied to every sequence, not just the middle ones."""
    if len(sequence) > 1 and all(c.observation_types & NO_DETECTION_OBSERVATION_TYPES for c in sequence):
        return [sequence[1]]
    return sequence


def _removed_as(c: Candidate, removed_types: set[str]) -> str | None:
    found = c.observation_types & removed_types
    if not found:
        return None
    return REMOVED_HUMAN if "human" in found else REMOVED_VEHICLE


def select_deployment(
    deployment_id: str, images: list[Candidate], criteria: UploadCriteria, *, detail: bool = False,
) -> DeploymentSelection:
    result = DeploymentSelection(deployment_id=deployment_id, images=len(images))
    candidates = [c for c in images if is_candidate(c, criteria)]
    result.candidates = len(candidates)

    sequences = split_sequences(candidates, criteria.max_interval)
    result.sequences = len(sequences)

    removed_types = {t for t, on in (("human", criteria.remove_middle_humans), ("vehicle", criteria.remove_middle_vehicles)) if on}
    # The same as filter_middle_sequences + sample_sequence, sequence by
    # sequence, so each image's fate can be told.
    filtering = bool(removed_types) and len(sequences) > 2
    details: list[SequenceDetail] = []
    removed = 0
    for i, seq in enumerate(sequences):
        middle = filtering and 0 < i < len(sequences) - 1
        fate = {c.media_id: (_removed_as(c, removed_types) if middle else None) for c in seq}
        remaining = [c for c in seq if fate[c.media_id] is None]
        if criteria.collapse_empty_sequences:
            collapsed = collapse_empty_sequence(remaining)
            if collapsed is not remaining:
                kept_id = collapsed[0].media_id
                for c in remaining:
                    if c.media_id != kept_id:
                        fate[c.media_id] = COLLAPSED_EMPTY
                remaining = collapsed
        removed += len(seq) - len(remaining)
        sampled = sample_sequence(remaining, criteria.images_per_sequence) if remaining else []
        result.selected.extend(sampled)
        if detail:
            kept = {c.media_id for c in sampled}
            details.append(SequenceDetail(
                number=i + 1, start=seq[0].timestamp, end=seq[-1].timestamp,
                images=[(c, fate[c.media_id] or (UPLOADED if c.media_id in kept else NOT_SAMPLED)) for c in seq],
            ))
    result.removed_middle = removed
    if detail:
        result.sequences_detail = details
    return result
