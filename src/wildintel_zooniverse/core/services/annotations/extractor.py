"""wildintel-tools' AnnotationsExtractor — one class for every workflow, which
gets the workflow's own mapping of Zooniverse choices to Trapper names
(mappings.py)."""
from __future__ import annotations

import ast
import logging
import re
from collections.abc import Mapping
from statistics import multimode
from typing import Any

from wildintel_zooniverse.core.services.annotations.models import ClassificationInfo

logger = logging.getLogger(__name__)


# Trapper name of Zooniverse's "NOANIMAL" (mappings.COMMON).
BLANK = "blank"
# Attributes of a ClassificationInfo that may identify the volunteer.
USER_ATTRS = ("user_name", "user_id", "user")


class AnnotationsExtractor:
    """Each classification's choices, as (Trapper name, answers) pairs, plus
    the most common number of choices per classification (k). Discarded:
      - classifications with 0 or more than k_max choices;
      - contradictory ones: "no animal" together with a species;
      - a volunteer's repeats of the same photo (only the first valid one
        counts), so nobody can vote twice, e.g. when a photo was uploaded to
        Zooniverse twice, or accounts that classify the same photo 100+ times.
    The order of the classifications is their created_at when they have it.
    NOTE: dedup only works across subjects (re-uploads) if the caller groups
    the classifications by PHOTO (file name / Trapper media id), not by sid."""

    def __init__(self, zoo_to_trapper: Mapping[str, str], k_max: int = 3):
        """zoo_to_trapper: the workflow's own mapping (see mappings.py) —
        a choice it doesn't list is "unknown"."""
        self.zoo_to_trapper = zoo_to_trapper
        self.k_max = k_max

    def trapper_name(self, choice: str) -> str:
        return self.zoo_to_trapper.get(choice, "unknown")

    def extract_matches(self, annotations_str: str) -> list:
        pattern = r"'choice':\s*'([^']+)'.*?'answers':\s*(\{[^}]*\})"
        return re.findall(pattern, annotations_str)

    @staticmethod
    def user_of(classification) -> Any:
        for attr in USER_ATTRS:
            user = getattr(classification, attr, None)
            if user not in (None, ""):
                return user
        return None

    def run(self, classifications: list[ClassificationInfo]) -> list[Any]:
        """[(k, subject id, [(name, answers), ...])] — or [] when every
        classification was discarded (wildintel-tools crashed there, on
        max() of nothing)."""
        if all(getattr(c, "created_at", None) is not None for c in classifications):
            classifications = sorted(classifications, key=lambda c: str(c.created_at))
        choices = []
        k_list = []
        sid = None
        seen_users = set()
        for classification in classifications:
            matches = self.extract_matches(str(classification.annotations))
            if len(matches) == 0 or len(matches) > self.k_max:
                logger.debug("Discarding a classification of %s: %s matches (k_max=%s)",
                             classification.sid, len(matches), self.k_max)
                continue
            names = [self.trapper_name(choice) for choice, _ in matches]
            if len(names) > 1 and BLANK in names:
                logger.debug("Discarding a contradictory classification of %s: %s", classification.sid, names)
                continue
            user = self.user_of(classification)
            if user is not None:
                if user in seen_users:
                    logger.debug("Discarding a repeat of %s by %s", classification.sid, user)
                    continue
                seen_users.add(user)
            k_list.append(len(matches))
            sid = classification.sid
            choices.extend((name, ast.literal_eval(answers)) for name, (_, answers) in zip(names, matches))
        if not k_list:
            return []
        k_majority = max(m for m in multimode(k_list) if m <= self.k_max)
        return [(k_majority, sid, choices)]
