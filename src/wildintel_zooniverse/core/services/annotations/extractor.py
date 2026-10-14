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


class AnnotationsExtractor:
    """Each classification's choices, as (Trapper name, answers) pairs —
    those with 0 or more than k_max choices discarded — plus the most common
    number of choices per classification (k)."""

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

    def run(self, classifications: list[ClassificationInfo]) -> list[Any]:
        """[(k, subject id, [(name, answers), ...])] — or [] when every
        classification was discarded (wildintel-tools crashed there, on
        max() of nothing)."""
        choices = []
        k_list = []
        sid = None
        for classification in classifications:
            matches = self.extract_matches(str(classification.annotations))
            if len(matches) == 0 or len(matches) > self.k_max:
                logger.debug("Discarding a classification of %s: %s matches (k_max=%s)",
                             classification.sid, len(matches), self.k_max)
                continue
            k_list.append(len(matches))
            sid = classification.sid
            choices.extend((self.trapper_name(choice), ast.literal_eval(answers)) for choice, answers in matches)
        if not k_list:
            return []
        k_majority = max(m for m in multimode(k_list) if m <= self.k_max)
        return [(k_majority, sid, choices)]
