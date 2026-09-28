"""services.sampling — the same image selection wildintel-tools makes."""
from datetime import datetime, timedelta

from wildintel_zooniverse.core.schemas.requests import UploadCriteria
from wildintel_zooniverse.core.services.sampling import Candidate, sample_sequence, select_deployment, split_sequences

T0 = datetime(2024, 9, 4, 12, 0)


def _img(media_id, seconds, *types, public=True):
    return Candidate(media_id=media_id, deployment_id="D1", timestamp=T0 + timedelta(seconds=seconds),
                     public=public, observation_types=set(types))


def _ids(candidates):
    return [c.media_id for c in candidates]


def test_sequences_split_where_the_gap_exceeds_max_interval():
    images = [_img(3, 200, "animal"), _img(1, 0, "animal"), _img(2, 90, "animal"), _img(4, 291, "animal")]
    assert [_ids(s) for s in split_sequences(images, 90)] == [[1, 2], [3], [4]]


def test_sampling_keeps_evenly_spaced_images_including_first_and_last():
    seq = [_img(i, i) for i in range(10)]
    assert _ids(sample_sequence(seq, 5)) == [0, 2, 4, 7, 9]
    assert _ids(sample_sequence(seq, 1)) == [0]
    assert _ids(sample_sequence(seq[:3], 5)) == [0, 1, 2]


def test_unclassified_and_non_public_images_are_not_candidates():
    images = [_img(1, 0, "animal"), _img(2, 1, "unclassified"), _img(3, 2), _img(4, 3, "animal", public=False)]
    result = select_deployment("D1", images, UploadCriteria())
    assert (result.images, result.candidates, _ids(result.selected)) == (4, 1, [1])

    everything_public = select_deployment("D1", images, UploadCriteria(only_classified=False))
    assert _ids(everything_public.selected) == [1, 2, 3]


def _deployment_with_people():
    # 4 sequences: setup (human), animal+human, vehicle, collection (human).
    return [
        _img(1, 0, "human"),
        _img(2, 1000, "animal"), _img(3, 1001, "human"),
        _img(4, 2000, "vehicle"),
        _img(5, 3000, "human"),
    ]


def test_humans_are_removed_only_from_middle_sequences_and_vehicles_kept_by_default():
    result = select_deployment("D1", _deployment_with_people(), UploadCriteria())
    assert _ids(result.selected) == [1, 2, 4, 5]
    assert (result.sequences, result.removed_middle) == (4, 1)


def test_vehicles_too_when_asked_and_empty_middle_sequences_are_dropped():
    result = select_deployment("D1", _deployment_with_people(), UploadCriteria(remove_middle_vehicles=True))
    assert _ids(result.selected) == [1, 2, 5]
    assert result.removed_middle == 2


def test_nothing_is_removed_with_two_sequences_or_fewer():
    images = [_img(1, 0, "human"), _img(2, 1000, "vehicle")]
    result = select_deployment("D1", images, UploadCriteria(remove_middle_vehicles=True))
    assert _ids(result.selected) == [1, 2]


def test_empty_sequences_are_kept_whole_by_default():
    images = [_img(1, 0, "empty"), _img(2, 10, "empty"), _img(3, 20, "empty")]
    result = select_deployment("D1", images, UploadCriteria())
    assert _ids(result.selected) == [1, 2, 3]


def test_collapse_empty_sequences_reduces_an_all_empty_sequence_to_its_second_image():
    # First sequence: all "empty" — collapsed even though it's not a middle
    # one. Second: a single "animal" image, its own sequence.
    images = [_img(1, 0, "empty"), _img(2, 10, "empty"), _img(3, 20, "empty"), _img(4, 1000, "animal")]
    result = select_deployment("D1", images, UploadCriteria(collapse_empty_sequences=True))
    assert _ids(result.selected) == [2, 4]


def test_collapse_empty_sequences_leaves_mixed_sequences_alone():
    images = [_img(1, 0, "empty"), _img(2, 10, "animal"), _img(3, 20, "empty")]
    result = select_deployment("D1", images, UploadCriteria(collapse_empty_sequences=True))
    assert _ids(result.selected) == [1, 2, 3]


def test_a_single_image_empty_sequence_is_not_collapsed():
    images = [_img(1, 0, "empty"), _img(2, 1000, "animal")]
    result = select_deployment("D1", images, UploadCriteria(collapse_empty_sequences=True))
    assert _ids(result.selected) == [1, 2]


def test_collapse_runs_on_what_remains_after_middle_humans_vehicles_are_removed():
    images = [
        _img(1, 0, "animal"),  # first sequence, kept whole
        _img(2, 1000, "human"), _img(3, 1001, "empty"), _img(4, 1002, "empty"),  # middle: human removed, then all empty
        _img(5, 2000, "animal"),  # last sequence, kept whole
    ]
    result = select_deployment("D1", images, UploadCriteria(collapse_empty_sequences=True))
    assert _ids(result.selected) == [1, 4, 5]


def _fates(result):
    return [{k: d.to_dict()[k] for k in ("number", "images", "uploaded", "not_sampled", "removed_human", "removed_vehicle")}
            for d in result.sequences_detail]


def test_detail_says_what_became_of_every_image_of_every_sequence():
    # Three sequences: the middle one has a human and a vehicle, and six
    # images — two per sequence are kept.
    images = [
        _img(1, 0, "animal"), _img(2, 10, "animal"),
        _img(10, 1000, "animal"), _img(11, 1010, "human"), _img(12, 1020, "animal", "vehicle"),
        _img(13, 1030, "animal"), _img(14, 1040, "animal"), _img(15, 1050, "animal"),
        _img(20, 5000, "human"),
    ]
    criteria = UploadCriteria(images_per_sequence=2, remove_middle_vehicles=True)
    result = select_deployment("D1", images, criteria, detail=True)

    assert _fates(result) == [
        {"number": 1, "images": 2, "uploaded": [1, 2], "not_sampled": [], "removed_human": [], "removed_vehicle": []},
        {"number": 2, "images": 6, "uploaded": [10, 15], "not_sampled": [13, 14], "removed_human": [11], "removed_vehicle": [12]},
        {"number": 3, "images": 1, "uploaded": [20], "not_sampled": [], "removed_human": [], "removed_vehicle": []},
    ]
    sequence = result.sequences_detail[1].to_dict()
    assert (sequence["start"], sequence["end"], sequence["duration_s"]) == (
        (T0 + timedelta(seconds=1000)).isoformat(), (T0 + timedelta(seconds=1050)).isoformat(), 50,
    )
    # The same selection as without detail.
    plain = select_deployment("D1", images, criteria)
    assert (_ids(plain.selected), plain.removed_middle) == (_ids(result.selected), result.removed_middle) == ([1, 2, 10, 15, 20], 2)
    assert plain.sequences_detail is None


def test_detail_reports_collapsed_empty_images():
    images = [_img(1, 0, "empty"), _img(2, 10, "empty"), _img(3, 20, "empty"), _img(4, 1000, "animal")]
    result = select_deployment("D1", images, UploadCriteria(collapse_empty_sequences=True), detail=True)
    first = result.sequences_detail[0].to_dict()
    assert (first["uploaded"], first["collapsed_empty"]) == ([2], [1, 3])


def test_a_middle_sequence_left_empty_is_still_listed():
    images = [_img(1, 0, "animal"), _img(2, 1000, "human"), _img(3, 5000, "animal")]
    result = select_deployment("D1", images, UploadCriteria(), detail=True)
    assert [d.to_dict()["uploaded"] for d in result.sequences_detail] == [[1], [], [3]]
    assert result.sequences_detail[1].to_dict()["removed_human"] == [2]
