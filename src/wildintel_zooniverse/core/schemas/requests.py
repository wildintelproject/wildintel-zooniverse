"""Request/response models for the web API."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class TrapperCredentials(BaseModel):
    # Any of these left blank falls back to settings.toml (see
    # services.trapper_service.resolve_credentials).
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class ClassificationProjectsRequest(TrapperCredentials):
    research_project_pk: int


class CollectionsRequest(TrapperCredentials):
    classification_project_pk: int


class DeploymentsRequest(TrapperCredentials):
    research_project_pk: int
    # The collection's own pk (Trapper's collection_pk) — its deployments are
    # the research project's own with images in it.
    collection_pk: int


class NamedRef(BaseModel):
    pk: int
    name: str


class DeploymentRef(BaseModel):
    pk: int
    deployment_id: str
    # How many of its images are in the collection.
    image_count: Optional[int] = None


class TrapperSelection(BaseModel):
    """The Trapper images a run works on — never holds credentials."""

    url: str
    research_project: NamedRef
    classification_project: NamedRef
    collection: NamedRef
    deployments: list[DeploymentRef] = Field(min_length=1)
    # Whether every deployment of the collection was chosen (vs. a subset).
    all_deployments: bool


class SaveSelectionRequest(BaseModel):
    # The session a previous save for this same wizard run already created
    # (going Back and changing the selection) — None mints a new one.
    task_id: Optional[str] = None
    task: Literal["upload"] = "upload"
    source_type: Literal["trapper"] = "trapper"
    selection: TrapperSelection


class UploadCriteria(BaseModel):
    """Which of the selection's images get uploaded — see services.sampling.
    The defaults are wildintel-tools' own."""

    # Seconds between two consecutive images that still keep them in the
    # same sequence.
    max_interval: int = Field(default=90, ge=1)
    # Images kept from each sequence, evenly spaced.
    images_per_sequence: int = Field(default=5, ge=1)
    # Only images with an observation other than "unclassified".
    only_classified: bool = True
    # Remove images with humans / vehicles from every sequence but a
    # deployment's first and last.
    remove_middle_humans: bool = True
    remove_middle_vehicles: bool = False
    # A sequence left with only "empty" images (after the removals above) is
    # reduced to its second image — wildintel-tools' own.
    collapse_empty_sequences: bool = False


class UploadPreviewRequest(TrapperCredentials):
    selection: TrapperSelection
    criteria: UploadCriteria
    # Also each deployment's sequences and what became of each image —
    # much more data, only when asked for.
    detail: bool = False
    # This session's own task_id, if it has one yet (it does from the
    # Selection step on) — each deployment's images/observations are then
    # cached for the rest of the session, so tweaking the criteria and
    # previewing again doesn't ask Trapper for them a second time.
    task_id: Optional[str] = None


class SaveCriteriaRequest(BaseModel):
    task_id: str
    criteria: UploadCriteria


class SaveMediaListsRequest(BaseModel):
    task_id: str
    # Only these Trapper media ids are uploaded — None: no such list.
    include: Optional[list[int]] = None
    # These never are.
    exclude: list[int] = Field(default_factory=list)


class ZooniverseCredentials(BaseModel):
    # Either left blank falls back to settings.toml (see
    # services.zooniverse_service.resolve_credentials).
    username: Optional[str] = None
    password: Optional[str] = None


class SubjectSetsRequest(ZooniverseCredentials):
    project_id: int


class DownloadSubjectSetsRequest(ZooniverseCredentials):
    subject_set_ids: list[int] = Field(min_length=1)
    # Blank: the app's own downloads folder (see
    # services.subject_download_service.default_output_dir).
    output_dir: Optional[str] = None
    # Download again images already in the folder.
    overwrite: bool = False
    # Only these subjects (None: no such list), never these.
    include_subjects: Optional[list[int]] = None
    exclude_subjects: list[int] = Field(default_factory=list)


class ZooniverseProjectRef(BaseModel):
    id: int
    name: str
    slug: str


class ZooniverseDestination(BaseModel):
    """Where a run's images go — never holds credentials."""

    project: ZooniverseProjectRef
    # As wildintel-tools does: a subject set of the project with this name is
    # reused (subjects are added to it); otherwise one is created.
    subject_set_name: str = Field(min_length=1)


class SaveDestinationRequest(BaseModel):
    task_id: str
    destination: ZooniverseDestination


class UploadRunRequest(BaseModel):
    task_id: str
    # Blank fields fall back to settings.toml, as everywhere else — and
    # Trapper's URL to the session's own.
    trapper: TrapperCredentials = Field(default_factory=TrapperCredentials)
    zooniverse: ZooniverseCredentials = Field(default_factory=ZooniverseCredentials)
    # Also skip the images already in the subject set, whoever uploaded
    # them — slow: its subjects are listed first, 100 per request.
    skip_in_subject_set: bool = False


class ValidationTrapper(TrapperCredentials):
    """The Trapper images a subject set is compared with — as for an upload.
    The URL falls back to the selection's own."""

    selection: TrapperSelection
    criteria: UploadCriteria


class ValidateSubjectSetRequest(ZooniverseCredentials):
    subject_set_id: int
    # None: only the subject set's own checks (duplicates, unmatched,
    # metadata fields), no comparison with Trapper.
    trapper: Optional[ValidationTrapper] = None


class MetadataTrapper(TrapperCredentials):
    """The Trapper images the subjects' metadata is rebuilt from. The URL
    falls back to the selection's own."""

    selection: TrapperSelection


class UpdateMetadataRequest(ZooniverseCredentials):
    subject_set_id: int
    trapper: MetadataTrapper
    # Only report what would change (the default — it's the safe one).
    dry_run: bool = True
    # Only these subjects (None: no such list), never these.
    include_subjects: Optional[list[int]] = None
    exclude_subjects: list[int] = Field(default_factory=list)


class WorkflowsRequest(ZooniverseCredentials):
    project_id: int


class WorkflowExportRequest(ZooniverseCredentials):
    workflow_id: int


class ExportClassificationsRequest(ZooniverseCredentials):
    workflow_id: int
    # The Trapper images whose observations the classifications update.
    trapper: MetadataTrapper
    # Blank: the app's own exports folder.
    output_dir: Optional[str] = None
    # Make a new classifications export first, instead of the latest one.
    regenerate: bool = False
    # Also save the volunteers' raw answers.
    save_zoo_annotations: bool = True
    # Blank: the settings' own.
    classified_by: Optional[str] = None
    max_file_size_mb: Optional[float] = Field(default=None, gt=0)


class ImportToTrapperRequest(TrapperCredentials):
    """An export's observation CSVs, into the classification project they
    were made for. The URL falls back to settings.toml's."""

    classification_project_id: int
    files: list[str] = Field(min_length=1)
    # Mark the imported classifications as approved (wildintel-tools didn't).
    approve: bool = False


class LookupSubjectsRequest(ZooniverseCredentials):
    subject_ids: list[int] = Field(min_length=1, max_length=5000)


class SubjectSetPageRequest(ZooniverseCredentials):
    subject_set_id: int
    page: int = Field(default=1, ge=1)
