"""wildintel-tools' own models (zooniverse/Schemas.py)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ClassificationInfo(BaseModel):
    """One volunteer's classification of a subject."""

    classification_id: Optional[str]
    user_name: Optional[str]
    user_id: Optional[str]
    annotations: list[Any] = Field(default_factory=list)
    subject_name: Optional[str]
    retired: bool = False
    retirement_reason: Optional[str] = None
    sid: int


class Zoo2TrapperObservation(BaseModel):
    """One observation voted from the volunteers' classifications."""

    observationType: Literal["animal", "human", "vehicle", "blank", "unclassified", "unknown"]
    scientificName: Optional[str] = None
    count: Optional[int] = None
    countNew: Optional[int] = None
    lifeStage: Optional[str] = None
    sex: Optional[str] = None
    behavior: Optional[str] = None
    individualID: Optional[str] = None
    observationTags: Optional[str] = None
    observationComments: Optional[str] = None
