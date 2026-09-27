"""wildintel-tools' AnnotationsExtractor and its per-workflow subclasses —
species names mapped from each workflow's own Zooniverse choices."""
from __future__ import annotations

import ast
import logging
import re
from statistics import multimode
from typing import Any

from wildintel_zooniverse.core.services.annotations.models import ClassificationInfo

logger = logging.getLogger(__name__)


class AnnotationsExtractor:
    """Each classification's choices, as (Trapper name, answers) pairs —
    those with 0 or more than k_max choices discarded — plus the most common
    number of choices per classification (k)."""

    zoo_to_trapper: dict[str, str] = {}

    def __init__(self, k_max: int = 3):
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


class Workflow29186AnnotationExtractor(AnnotationsExtractor):
    """Workflow 29186 (Doñana National Park)."""

    zoo_to_trapper = {
        "NOANIMAL": "blank",
        "HUMANORVEHICLE": "human",
        "OTHERSPECIES": "animal",
        "UNRECOGNIZABLE": "unknown",

        "REDDEER": "Cervus elaphus",
        "REDFOX": "Vulpes vulpes",
        "WILDBOAR": "Sus scrofa",
        "CERVIDREDORFALLOWDEER": "Cervidae",
        "COMMONGENET": "Genetta genetta",
        "COW": "Bos taurus",
        "EGYPTIANMONGOOSE": "Herpestes ichneumon",
        "EUROPEANBADGER": "Meles meles",
        "EUROPEANRABBIT": "Oryctolagus cuniculus",
        "FALLOWDEER": "Dama dama",
        "HORSE": "Equus caballus",
        "IBERIANHARE": "Lepus granatensis",
        "IBERIANLYNX": "Lynx pardinus",
        "LEPORIDRABBITORHARE": "Leporidae",
        "BIRD": "Aves",
        "DOMESTICDOG": "Canis familiaris",
    }


class Workflow17553AnnotationExtractor(Workflow29186AnnotationExtractor):
    """Workflow 17553 (IberianCameraTrapR1_1_2_3) — the same as 29186."""


class Workflow29187AnnotationExtractor(AnnotationsExtractor):
    """Workflow 29187 (Tatra National Park)."""

    zoo_to_trapper = {
        "NOANIMAL": "blank",
        "HUMANORVEHICLE": "human",
        "OTHERSPECIES": "animal",
        "UNRECOGNIZABLE": "unknown",

        "REDDEER": "Cervus elaphus",
        "ROEDEER": "Capreolus capreolus",
        "CERVIDREDORROEDEER": "Cervidae",
        "REDFOX": "Vulpes vulpes",
        "REDSQUIRREL": "Sciurus vulgaris",
        "BROWNBEAR": "Ursus arctos",
        "PINEMARTEN": "Martes martes",
        "MARTENPINEORSTONEMARTEN": "Martes",
        "STONEMARTEN": "Martes foina",
        "CHAMOIS": "Rupicapra rupicapra",
        "EURASIANLYNX": "Lynx lynx",
        "WOLF": "Canis lupus",
        "EUROPEANBADGER": "Meles meles",
        "MARMOT": "Marmota marmota",
        "WILDBOAR": "Sus scrofa",
        "EUROPEANHARE": "Lepus europaeus",
        "DOMESTICDOG": "Canis familiaris",
        "DOMESTICCAT": "Felis catus",
        "STOAT": "Mustela erminea",
        "WEASEL": "Mustela nivalis",
        "MUSTELID": "Mustelidae",
        "BIRDGENERAL": "Aves",
    }
