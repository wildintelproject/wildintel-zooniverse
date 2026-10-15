"""wildintel-tools' AnnotationsVoter subclasses, ported as they are: from an
extractor's output, the observations a subject gets."""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from statistics import median
from typing import Any, Optional

from wildintel_zooniverse.core.services.annotations.models import Zoo2TrapperObservation


class AnnotationsVoter:
    @staticmethod
    def run(observations: list[Any]) -> Optional[list[Zoo2TrapperObservation]]:
        raise NotImplementedError


# What NOANIMAL is called once extracted: wildintel-tools' voters skipped
# "NOANIMAL" when k > 1, a name that never reached them — so "no animal"
# votes were always counted.
BLANK = "blank"
# Humans' scientific name, the same for every workflow (wildintel-tools'
# 29187 voter wrote "Homo Sapiens").
HOMO_SAPIENS = "Homo sapiens"
# Names that are an observation type, not a species: no scientific name.
OBSERVATION_TYPES = {"animal", "human", "vehicle", "blank", "unclassified", "unknown"}


class SpeciesVoter(AnnotationsVoter):
    """The vote every workflow shares: the k most voted species, each with
    the median of its HOWMANY answers as count, and its probability: its
    votes over its votes plus the next species' in the ranking. The next one
    counts even when it is not kept, so a single species voted against
    another one is not a certainty; and species that share a photo don't
    penalise each other (6 cows, 4 birds and 2 horses: the birds' 4 / (4 + 2),
    not what the cows left).

    What differs between workflows is only how a tie is broken: _rank."""

    @staticmethod
    def _rank(species_count: Counter) -> list[tuple[str, int]]:
        raise NotImplementedError

    # HOWMANY answers that are a range, not a number: their lower bound.
    # "1150" is the "11-50" option (it is NOT 1150 animals), "51" is "51+",
    # "11ORMORE" is the old "11 or more" option.
    HOWMANY_RANGES = {"1150": 11, "51": 51, "11ORMORE": 11}

    @classmethod
    def _howmany_value(cls, val) -> Optional[int]:
        if val is None:
            return None
        val = str(val).strip().upper()
        if val in cls.HOWMANY_RANGES:
            return cls.HOWMANY_RANGES[val]
        return int(val) if val.isdigit() else None

    @classmethod
    def _group_howmany(cls, user_opinions: list) -> defaultdict:
        species_howmany = defaultdict(list)
        for species, attrs in user_opinions:
            species_howmany[species].append(cls._howmany_value(attrs.get("HOWMANY")))
        return species_howmany

    @staticmethod
    def _howmany_median(species_howmany: defaultdict, species: str) -> Optional[int]:
        valid = [x for x in species_howmany[species] if x is not None]
        return math.ceil(median(valid)) if valid else None

    @staticmethod
    def _confidence(idx: int, votes: int, ranking: list) -> float:
        if idx + 1 < len(ranking):
            return votes / (votes + ranking[idx + 1][1])
        return 1.0

    @staticmethod
    def _to_observation(species: str, count: Optional[int], confidence: float, sid) -> Zoo2TrapperObservation:
        observation_type = "animal"
        if species.lower() in OBSERVATION_TYPES:
            observation_type = species.lower()
            species = HOMO_SAPIENS if observation_type == "human" else ""
        return Zoo2TrapperObservation(
            observationType=observation_type,
            scientificName=species,
            classificationProbability=round(confidence, 4),
            count=count,
            observationComments=f"Automatically classified by Zooniverse for subject {sid} with confidence {confidence:.2f}",
        )

    @classmethod
    def run(cls, observations: list[Any]) -> Optional[list[Zoo2TrapperObservation]]:
        if not observations:
            return None
        k, sid, user_opinions = observations[0]
        species_howmany = cls._group_howmany(user_opinions)
        # If k > 1 (volunteers saw several species), "no animal" can't be one of
        # them: its votes leave the ranking (neither kept nor "next").
        species_count = Counter(species for species, _ in user_opinions if not (k > 1 and species == BLANK))
        k = max(1, k)
        ranking = cls._rank(species_count)[: k + 1]  # the one after the last kept only sets its probability
        return [
            cls._to_observation(species, cls._howmany_median(species_howmany, species), cls._confidence(idx, votes, ranking), sid)
            for idx, (species, votes) in enumerate(ranking[:k])
        ]


class Workflow29186AnnotationsVoter(SpeciesVoter):
    """Workflow 29186 (Doñana National Park): a tie goes to the species
    voted first. wildintel-tools kept k+1 species, so a single stray vote
    became an observation of its own."""

    @staticmethod
    def _rank(species_count: Counter) -> list[tuple[str, int]]:
        return species_count.most_common()


class Workflow17553AnnotationsVoter(Workflow29186AnnotationsVoter):
    """Workflow 17553 — 29186's voter (wildintel-tools' own couldn't be
    imported: it imported from a "trapper_zooniverse" package)."""


class Workflow29187AnnotationsVoter(SpeciesVoter):
    """Workflow 29187 (Tatra National Park): a tie goes to the species
    first in alphabetical order."""

    @staticmethod
    def _rank(species_count: Counter) -> list[tuple[str, int]]:
        return sorted(species_count.items(), key=lambda x: (-x[1], x[0]))


class Workflow31813AnnotationsVoter(Workflow29187AnnotationsVoter):
    """Workflow 31813 (Oder Delta) — 29187's voter: a tie goes to the species
    first in alphabetical order, so the same votes always give the same result."""
