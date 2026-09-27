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


class Workflow29186AnnotationsVoter(AnnotationsVoter):
    """Workflow 29186 (Doñana National Park): the k most voted species, each
    with the median of its HOWMANY answers as count. wildintel-tools kept
    k+1, so a single stray vote became an observation of its own."""

    @staticmethod
    def run(observations: list[Any]) -> Optional[list[Zoo2TrapperObservation]]:
        if not observations:
            return None

        species_howmany = defaultdict(list)
        k, sid, user_opinions = observations[0]
        for species, attrs in user_opinions:
            val = attrs.get("HOWMANY")
            species_howmany[species].append(int(val) if val is not None and str(val).isdigit() else None)

        # If k > 1 (volunteers saw several species), "no animal" isn't counted.
        species_count = Counter(species for species, _ in user_opinions if not (k > 1 and species == BLANK))
        top_k_species = species_count.most_common()[: max(1, k)]

        result = []
        for idx, (species, votes) in enumerate(top_k_species):
            valid_howmany = [x for x in species_howmany[species] if x is not None]
            howmany_median = math.ceil(median(valid_howmany)) if valid_howmany else None

            votes_next = top_k_species[idx + 1][1] if idx + 1 < len(top_k_species) else None
            confidence = 1.0 if votes_next is None or votes_next <= 0 else votes / (votes + votes_next)

            if species == HOMO_SAPIENS:
                observation_type = "human"
            elif species in ["vehicle", "blank", "unclassified", "unknown"]:
                observation_type = species
                species = ""
            elif species == "animal":
                observation_type = "animal"
                species = ""
            else:
                observation_type = "animal"

            result.append(Zoo2TrapperObservation(
                observationType=observation_type,
                scientificName=species,
                count=howmany_median,
                observationComments=f"Automatically classified by Zooniverse for subject {sid} with confidence {confidence:.2f}",
            ))
        return result


class Workflow17553AnnotationsVoter(Workflow29186AnnotationsVoter):
    """Workflow 17553 — 29186's voter (wildintel-tools' own couldn't be
    imported: it imported from a "trapper_zooniverse" package), but with
    humans voted as humans: the extractor names HUMANORVEHICLE "human",
    which 29186's voter makes an animal called "human". Renamed "Homo
    sapiens" first, it takes that voter's own human branch — the votes
    count the same."""

    @staticmethod
    def run(observations: list[Any]) -> Optional[list[Zoo2TrapperObservation]]:
        renamed = [
            (k, sid, [(HOMO_SAPIENS if species == "human" else species, attrs) for species, attrs in opinions])
            for k, sid, opinions in observations
        ]
        return Workflow29186AnnotationsVoter.run(renamed)


class Workflow29187AnnotationsVoter(AnnotationsVoter):
    """Workflow 29187 (Tatra National Park): the k most voted species, each
    with the median of its HOWMANY answers, and a confidence chained over
    the ranking."""

    @staticmethod
    def _group_howmany(user_opinions: list) -> defaultdict:
        species_howmany = defaultdict(list)
        for species, attrs in user_opinions:
            val = attrs.get("HOWMANY")
            species_howmany[species].append(int(val) if val is not None and str(val).isdigit() else None)
        return species_howmany

    @staticmethod
    def _top_k_species(user_opinions: list, k: int) -> list[tuple[str, int]]:
        species_count = Counter(species for species, _ in user_opinions if not (k > 1 and species == BLANK))
        return sorted(species_count.items(), key=lambda x: (-x[1], x[0]))[:k]

    @staticmethod
    def _howmany_median(species_howmany: defaultdict, species: str) -> Optional[int]:
        valid = [x for x in species_howmany[species] if x is not None]
        return math.ceil(median(valid)) if valid else None

    @staticmethod
    def _confidences(idx: int, votes: int, top_k_species: list, accumulated_conf: float) -> tuple[float, float]:
        if idx + 1 < len(top_k_species):
            votes_next = top_k_species[idx + 1][1]
            pre_conf = votes / (votes + votes_next)
        else:
            pre_conf = 1.0
        return pre_conf, pre_conf * (1.0 - accumulated_conf)

    @staticmethod
    def _to_observation(species: str, count: Optional[int], pre_conf: float, confidence: float, sid) -> Zoo2TrapperObservation:
        observation_type = "animal"
        if species.lower() in ["animal", "human", "vehicle", "blank", "unclassified", "unknown"]:
            observation_type = species
            species = "" if species.lower() != "human" else HOMO_SAPIENS
        return Zoo2TrapperObservation(
            observationType=observation_type,
            scientificName=species,
            count=count,
            observationComments=f"Automatically classified by Zooniverse for subject {sid} with confidences {pre_conf:.2f} {confidence:.2f}",
        )

    @staticmethod
    def run(observations: list[Any]) -> Optional[list[Zoo2TrapperObservation]]:
        if not observations:
            return None
        k, sid, user_opinions = observations[0]
        cls = Workflow29187AnnotationsVoter
        species_howmany = cls._group_howmany(user_opinions)
        result = []
        accumulated_conf = 0.0
        top_k = cls._top_k_species(user_opinions, k)
        for idx, (species, votes) in enumerate(top_k):
            pre_conf, confidence = cls._confidences(idx, votes, top_k, accumulated_conf)
            accumulated_conf += confidence
            result.append(cls._to_observation(species, cls._howmany_median(species_howmany, species), pre_conf, confidence, sid))
        return result
