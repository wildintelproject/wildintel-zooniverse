"""Each workflow's mapping from its Zooniverse choices to Trapper names — data,
not behaviour: the one extractor (extractor.py) takes the mapping of the
workflow it reads. A choice not listed is "unknown"."""
from __future__ import annotations

# The choices every workflow has.
COMMON = {
    "NOANIMAL": "blank",
    "HUMANORVEHICLE": "human",
    "OTHERSPECIES": "animal",
    "UNRECOGNIZABLE": "unknown",
}

# Workflows 29186 (Doñana National Park) and 17553 (IberianCameraTrapR1_1_2_3).
DONANA = {
    **COMMON,
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

# Workflow 29187 (Tatra National Park).
TATRA = {
    **COMMON,
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
