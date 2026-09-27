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


def test_29186_still_votes_humans_as_wildintel_tools_did():
    # Left as ported — only 17553 was fixed.
    from wildintel_zooniverse.core.services.annotations.voter import Workflow29186AnnotationsVoter

    [obs] = Workflow29186AnnotationsVoter.run(_opinions("human"))
    assert (obs.observationType, obs.scientificName) == ("animal", "human")


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
