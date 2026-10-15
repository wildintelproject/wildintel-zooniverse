"""The ported extractors and voters (services.annotations)."""


def _opinions(*species, k=1):
    return [(k, 42, [(s, {"HOWMANY": "1"}) for s in species])]


def test_17553_votes_humans_as_humans():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow17553AnnotationsVoter

    [obs] = Workflow17553AnnotationsVoter.run(_opinions("human", "human", "human"))
    assert (obs.observationType, obs.scientificName, obs.count) == ("human", "Homo sapiens", 1)


def test_17553_counts_the_votes_as_29186_does():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow17553AnnotationsVoter, Workflow29186AnnotationsVoter

    opinions = _opinions("human", "human", "Vulpes vulpes", k=2)
    ours = Workflow17553AnnotationsVoter.run(opinions)
    theirs = Workflow29186AnnotationsVoter.run(opinions)
    assert [o.observationComments for o in ours] == [o.observationComments for o in theirs]
    assert [(o.observationType, o.scientificName) for o in ours] == [("human", "Homo sapiens"), ("animal", "Vulpes vulpes")]


def test_every_workflow_votes_the_same_way_but_for_ties():
    from wildintel_zooniverse.core.services.annotations.voter import (
        Workflow17553AnnotationsVoter, Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter,
    )

    opinions = _opinions("human", "human", "Vulpes vulpes", "Vulpes vulpes", "Vulpes vulpes", "Sus scrofa", k=2)
    results = [
        [o.model_dump() for o in voter.run(opinions)]
        for voter in (Workflow17553AnnotationsVoter, Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter)
    ]
    assert results[0] == results[1] == results[2]
    assert [(o["observationType"], o["scientificName"]) for o in results[0]] == [("animal", "Vulpes vulpes"), ("human", "Homo sapiens")]
    assert [o["classificationProbability"] for o in results[0]] == [0.6, 0.6667]


def test_a_species_voted_against_another_is_not_a_certainty_even_when_only_one_is_kept():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29186AnnotationsVoter

    [obs] = Workflow29186AnnotationsVoter.run(_opinions("Vulpes vulpes", "Vulpes vulpes", "Vulpes vulpes", "Sus scrofa", k=1))
    assert obs.classificationProbability == 0.75
    [alone] = Workflow29186AnnotationsVoter.run(_opinions("Vulpes vulpes", "Vulpes vulpes", k=1))
    assert alone.classificationProbability == 1.0


def test_every_workflow_knows_the_observation_types():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter

    for voter in (Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter):
        for name in ("animal", "human", "vehicle", "blank", "unclassified", "unknown"):
            [obs] = voter.run(_opinions(name, name))
            assert obs.observationType == name
            assert obs.scientificName == ("Homo sapiens" if name == "human" else "")


def test_ties_are_broken_by_each_workflow_its_own_way():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter

    opinions = _opinions("Vulpes vulpes", "Cervus elaphus")
    assert [o.scientificName for o in Workflow29186AnnotationsVoter.run(opinions)] == ["Vulpes vulpes"]
    assert [o.scientificName for o in Workflow29187AnnotationsVoter.run(opinions)] == ["Cervus elaphus"]


def test_every_listed_workflow_has_an_extractor_and_voter():
    from wildintel_zooniverse.core.services.annotations import registry

    for workflow_id in registry.WORKFLOWS:
        extractor, voter = registry.extractor_and_voter(workflow_id)
        assert voter.run(extractor.run([])) is None


def test_29186_keeps_the_k_most_voted_species_not_k_plus_one():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow17553AnnotationsVoter, Workflow29186AnnotationsVoter

    # One species seen per classification (k=1): a stray vote isn't an
    # observation of its own.
    for voter in (Workflow29186AnnotationsVoter, Workflow17553AnnotationsVoter):
        observations = voter.run(_opinions("Cervus elaphus", "Cervus elaphus", "Dama dama"))
        assert [o.scientificName for o in observations] == ["Cervus elaphus"]
    # Two species per classification (k=2): both.
    observations = Workflow29186AnnotationsVoter.run(_opinions("Cervus elaphus", "Dama dama", "Cervus elaphus", "Dama dama", k=2))
    assert sorted(o.scientificName for o in observations) == ["Cervus elaphus", "Dama dama"]


def test_no_animal_votes_dont_count_when_several_species_were_seen():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter

    # "blank" (NOANIMAL) outvotes the fox, but with k=2 it isn't counted.
    opinions = _opinions("blank", "blank", "blank", "Vulpes vulpes", "Meles meles", k=2)
    for voter in (Workflow29186AnnotationsVoter, Workflow29187AnnotationsVoter):
        assert sorted(o.scientificName for o in voter.run(opinions)) == ["Meles meles", "Vulpes vulpes"]
    # With k=1 it's a vote like any other.
    [obs] = Workflow29186AnnotationsVoter.run(_opinions("blank", "blank", "Vulpes vulpes"))
    assert obs.observationType == "blank"


def test_humans_are_homo_sapiens_in_every_workflow():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow17553AnnotationsVoter, Workflow29187AnnotationsVoter

    for voter in (Workflow17553AnnotationsVoter, Workflow29187AnnotationsVoter):
        [obs] = voter.run(_opinions("human", "human"))
        assert (obs.observationType, obs.scientificName) == ("human", "Homo sapiens")


def test_the_extractor_maps_a_choice_with_the_workflows_own_mapping():
    from wildintel_zooniverse.core.services.annotations import registry
    from wildintel_zooniverse.core.services.annotations.extractor import AnnotationsExtractor

    assert registry.extractor_and_voter(29186)[0].trapper_name("IBERIANLYNX") == "Lynx pardinus"
    assert registry.extractor_and_voter(29187)[0].trapper_name("BROWNBEAR") == "Ursus arctos"
    # Not in the workflow's mapping: unknown.
    assert registry.extractor_and_voter(29187)[0].trapper_name("IBERIANLYNX") == "unknown"
    assert AnnotationsExtractor({}).trapper_name("REDDEER") == "unknown"


def test_oder_delta_maps_every_choice_of_its_workflow():
    from wildintel_zooniverse.core.services.annotations import registry
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29187AnnotationsVoter

    extractor, voter = registry.extractor_and_voter(31813)
    assert issubclass(voter, Workflow29187AnnotationsVoter)
    assert extractor.trapper_name("FELISSP") == "Felis"
    assert extractor.trapper_name("VEHICLE") == "vehicle"
    assert extractor.trapper_name("CERVIDREDROEDEER") == "Cervidae"
    assert extractor.trapper_name("EUROPEANBADGER") == "Meles meles"
    # 27 choices: the 4 common ones plus 23 of its own.
    assert len(registry.WORKFLOWS[31813].mapping) == 27


def test_species_sharing_a_photo_dont_penalise_each_other():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29186AnnotationsVoter

    opinions = _opinions(*["Bos taurus"] * 6, *["Aves"] * 4, *["Equus caballus"] * 2, k=3)
    result = Workflow29186AnnotationsVoter.run(opinions)
    # Each one's votes against the next one's — the birds' 4 / (4 + 2), not what the cows left.
    assert [(o.scientificName, o.classificationProbability) for o in result] == [
        ("Bos taurus", 0.6), ("Aves", 0.6667), ("Equus caballus", 1.0),
    ]


def _info(cid, *choices, user=None, created_at=None, sid=1):
    from wildintel_zooniverse.core.services.annotations.models import ClassificationInfo

    annotations = [{"task": "T0", "value": [{"choice": c, "answers": {}, "filters": {}} for c in choices]}]
    return ClassificationInfo(classification_id=str(cid), user_name=user, user_id=None, annotations=annotations,
                              subject_name=None, sid=sid, created_at=created_at)


def _extractor():
    from wildintel_zooniverse.core.services.annotations import registry

    return registry.extractor_and_voter(29186)[0]


def test_a_contradictory_classification_is_discarded():
    # "No animal" together with a species can't be: that classification doesn't count.
    [(k, _, choices)] = _extractor().run([_info(1, "NOANIMAL", "REDFOX", user="a"), _info(2, "REDFOX", user="b")])
    assert (k, [name for name, _ in choices]) == (1, ["Vulpes vulpes"])


def test_a_volunteer_counts_once_with_their_first_valid_classification():
    classifications = [
        _info(1, user="a"),                       # no choices: not valid, doesn't use up their vote
        _info(2, "REDFOX", user="a"),
        _info(3, "REDDEER", user="a"),            # a repeat
        _info(4, "NOANIMAL", "REDDEER", user="b"),  # contradictory: doesn't use up theirs either
        _info(5, "REDDEER", user="b"),
        _info(6, "REDFOX"),                       # unknown volunteer: stays
        _info(7, "REDFOX"),
    ]
    [(_, _, choices)] = _extractor().run(classifications)
    assert [name for name, _ in choices] == ["Vulpes vulpes", "Cervus elaphus", "Vulpes vulpes", "Vulpes vulpes"]


def test_classifications_are_taken_in_the_order_they_were_made():
    classifications = [
        _info(1, "REDDEER", user="a", created_at="2026-10-02T10:00:00 UTC"),
        _info(2, "REDFOX", user="a", created_at="2026-10-01T10:00:00 UTC"),
    ]
    [(_, _, choices)] = _extractor().run(classifications)
    assert [name for name, _ in choices] == ["Vulpes vulpes"]  # a's first, by its date


def test_howmany_ranges_count_their_lower_bound_not_their_digits():
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29186AnnotationsVoter

    def counted(*answers):
        opinions = [(1, 42, [("Bos taurus", {"HOWMANY": a}) for a in answers])]
        return Workflow29186AnnotationsVoter.run(opinions)[0].count

    assert counted("1150") == 11   # the "11-50" option, not 1.150 animals
    assert counted("51") == 51
    assert counted("11ORMORE") == 11
    assert counted("3", "5") == 4  # a number is still a number
