"""What each Zooniverse workflow uses to be exported: its mapping of
choices to Trapper names (mappings.py) and its voter (voter.py) — wildintel-tools
found them by class name (Workflow<id>AnnotationExtractor/…Voter); here
they're listed. A workflow not listed can't be exported: its choices mean
nothing to the app."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from wildintel_zooniverse.core.services.annotations import mappings
from wildintel_zooniverse.core.services.annotations.extractor import AnnotationsExtractor
from wildintel_zooniverse.core.services.annotations.voter import (
    AnnotationsVoter, Workflow17553AnnotationsVoter, Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter,
    Workflow31813AnnotationsVoter,
)


@dataclass(frozen=True)
class Workflow:
    name: str
    mapping: Mapping[str, str]
    voter: type[AnnotationsVoter]


WORKFLOWS: dict[int, Workflow] = {
    17553: Workflow("IberianCameraTrapR1_1_2_3", mappings.DONANA, Workflow17553AnnotationsVoter),
    29186: Workflow("Doñana National Park", mappings.DONANA, Workflow29186AnnotationsVoter),
    29187: Workflow("Tatra National Park", mappings.TATRA, Workflow29187AnnotationsVoter),
    31813: Workflow("Oder Delta", mappings.ODER_DELTA, Workflow31813AnnotationsVoter),
}


def supported(workflow_id: int) -> bool:
    return workflow_id in WORKFLOWS


def extractor_and_voter(workflow_id: int) -> tuple[AnnotationsExtractor, type[AnnotationsVoter]]:
    """Raises:
        ValueError: the workflow has no mapping/voter.
    """
    if workflow_id not in WORKFLOWS:
        raise ValueError(
            f"Workflow {workflow_id} can't be exported: there's no mapping/voter for it "
            f"(only {', '.join(map(str, WORKFLOWS))})."
        )
    workflow = WORKFLOWS[workflow_id]
    return AnnotationsExtractor(workflow.mapping), workflow.voter
