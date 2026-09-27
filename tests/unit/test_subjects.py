"""/api/zooniverse/subjects — the Subjects utility. panoptes-client is faked."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

CREDS = {"username": "bob", "password": "pw"}
TRAPPER = "https://trapper.example.org"


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _subject(sid, media_id=None, sets=(8,)):
    metadata = {"Filename": f"{media_id}_x_D_x_IMG.JPG"} if media_id else {"Filename": "IMG.JPG"}
    raw = {"links": {"subject_sets": [str(s) for s in sets]}, "created_at": "2026-03-01T10:00:00Z"}
    return SimpleNamespace(id=str(sid), locations=[{"image/jpeg": f"https://panoptes/{sid}.jpeg"}], metadata=metadata, raw=raw)


@pytest.fixture
def fake_subject():
    from wildintel_zooniverse.core.services import zooniverse_service

    zooniverse_service._clients.clear()
    with patch.object(zooniverse_service, "Panoptes"), patch.object(zooniverse_service, "Subject") as subject:
        yield subject
    zooniverse_service._clients.clear()


def test_subjects_are_looked_up_by_id_with_their_trapper_image(fake_subject):
    fake_subject.where.side_effect = lambda **kw: iter([_subject(502, media_id=7), _subject(501)])

    result = _client().post("/api/zooniverse/subjects/lookup", json={**CREDS, "subject_ids": [501, 502, 999, 501]}).json()

    fake_subject.where.assert_called_once_with(id="501,502,999", page_size=3)
    assert [s["id"] for s in result["subjects"]] == [501, 502]  # in the order asked for
    assert result["subjects"][1] == {
        "id": 502, "images": ["https://panoptes/502.jpeg"], "metadata": {"Filename": "7_x_D_x_IMG.JPG"},
        "subject_sets": [8], "created_at": "2026-03-01T10:00:00Z", "media_id": 7,
    }
    assert result["subjects"][0]["media_id"] is None
    assert result["not_found"] == [999]


def test_many_ids_are_looked_up_a_hundred_at_a_time(fake_subject):
    fake_subject.where.side_effect = lambda **kw: iter([])
    _client().post("/api/zooniverse/subjects/lookup", json={**CREDS, "subject_ids": list(range(1, 251))})
    assert [call.kwargs["page_size"] for call in fake_subject.where.call_args_list] == [100, 100, 50]


def test_a_subject_set_is_browsed_a_page_at_a_time(fake_subject):
    paginator = SimpleNamespace(
        object_list=["raw-1", "raw-2"], etag="e", meta={"page": 2, "page_count": 3, "count": 120},
        object_class=lambda raw, etag: _subject(int(raw.split("-")[1]) + 600, media_id=int(raw.split("-")[1])),
    )
    fake_subject.where.return_value = paginator

    result = _client().post("/api/zooniverse/subjects/page", json={**CREDS, "subject_set_id": 8, "page": 2}).json()

    fake_subject.where.assert_called_once_with(subject_set_id=8, page=2, page_size=50)
    assert (result["page"], result["page_count"], result["count"], result["page_size"]) == (2, 3, 120, 50)
    assert [(s["id"], s["media_id"]) for s in result["subjects"]] == [(601, 1), (602, 2)]


def test_no_ids_is_a_422():
    assert _client().post("/api/zooniverse/subjects/lookup", json={**CREDS, "subject_ids": []}).status_code == 422
