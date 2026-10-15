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
    the median of its HOWMANY answers as count, and a probability chained
    over the ranking (each species' share against the next one in the
    ranking, scaled by what the ones before it left). The next one counts
    even when it is not kept, so a single species voted against another one
    is not a certainty.

    What differs between workflows is only how a tie is broken: _rank."""

    @staticmethod
    def _rank(species_count: Counter) -> list[tuple[str, int]]:
        raise NotImplementedError

    @staticmethod
    def _group_howmany(user_opinions: list) -> defaultdict:
        species_howmany = defaultdict(list)
        for species, attrs in user_opinions:
            val = attrs.get("HOWMANY")
            species_howmany[species].append(int(val) if val is not None and str(val).isdigit() else None)
        return species_howmany

    @staticmethod
    def _howmany_median(species_howmany: defaultdict, species: str) -> Optional[int]:
        valid = [x for x in species_howmany[species] if x is not None]
        return math.ceil(median(valid)) if valid else None

    @staticmethod
    def _confidences(idx: int, votes: int, ranking: list, accumulated_conf: float) -> tuple[float, float]:
        if idx + 1 < len(ranking):
            votes_next = ranking[idx + 1][1]
            pre_conf = votes / (votes + votes_next)
        else:
            pre_conf = 1.0
        return pre_conf, pre_conf * (1.0 - accumulated_conf)

    @staticmethod
    def _to_observation(species: str, count: Optional[int], pre_conf: float, confidence: float, sid) -> Zoo2TrapperObservation:
        observation_type = "animal"
        if species.lower() in OBSERVATION_TYPES:
            observation_type = species.lower()
            species = HOMO_SAPIENS if observation_type == "human" else ""
        return Zoo2TrapperObservation(
            observationType=observation_type,
            scientificName=species,
            classificationProbability=round(confidence, 4),
            count=count,
            observationComments=f"Automatically classified by Zooniverse for subject {sid} with confidences {pre_conf:.2f} {confidence:.2f}",
        )

    @classmethod
    def run(cls, observations: list[Any]) -> Optional[list[Zoo2TrapperObservation]]:
        if not observations:
            return None
        k, sid, user_opinions = observations[0]
        species_howmany = cls._group_howmany(user_opinions)
        # If k > 1 (volunteers saw several species), "no animal" isn't counted.
        species_count = Counter(species for species, _ in user_opinions if not (k > 1 and species == BLANK))
        k = max(1, k)
        ranking = cls._rank(species_count)[: k + 1]  # the one after the last kept only sets its probability
        result = []
        accumulated_conf = 0.0
        for idx, (species, votes) in enumerate(ranking[:k]):
            pre_conf, confidence = cls._confidences(idx, votes, ranking, accumulated_conf)
            accumulated_conf += confidence
            result.append(cls._to_observation(species, cls._howmany_median(species_howmany, species), pre_conf, confidence, sid))
        return result


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
