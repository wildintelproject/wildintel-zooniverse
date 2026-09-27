"""Which extractor and voter each Zooniverse workflow uses — wildintel-tools
found them by class name (Workflow<id>AnnotationExtractor/…Voter); here
they're listed. A workflow not listed can't be exported: its choices mean
nothing to the app."""
from __future__ import annotations

from wildintel_zooniverse.core.services.annotations.extractor import (
    AnnotationsExtractor, Workflow17553AnnotationExtractor, Workflow29186AnnotationExtractor,
    Workflow29187AnnotationExtractor,
)
from wildintel_zooniverse.core.services.annotations.voter import (
    AnnotationsVoter, Workflow17553AnnotationsVoter, Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter,
)

WORKFLOWS: dict[int, tuple[type[AnnotationsExtractor], type[AnnotationsVoter], str]] = {
    17553: (Workflow17553AnnotationExtractor, Workflow17553AnnotationsVoter, "IberianCameraTrapR1_1_2_3"),
    29186: (Workflow29186AnnotationExtractor, Workflow29186AnnotationsVoter, "Doñana National Park"),
    29187: (Workflow29187AnnotationExtractor, Workflow29187AnnotationsVoter, "Tatra National Park"),
}


def supported(workflow_id: int) -> bool:
    return workflow_id in WORKFLOWS


def extractor_and_voter(workflow_id: int) -> tuple[AnnotationsExtractor, type[AnnotationsVoter]]:
    """Raises:
        ValueError: the workflow has no extractor/voter.
    """
    if workflow_id not in WORKFLOWS:
        raise ValueError(
            f"Workflow {workflow_id} can't be exported: there's no extractor/voter for it "
            f"(only {', '.join(map(str, WORKFLOWS))})."
        )
    extractor, voter, _ = WORKFLOWS[workflow_id]
    return extractor(), voter
