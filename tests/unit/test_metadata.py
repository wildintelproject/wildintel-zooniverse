"""/api/metadata/update — Zooniverse and Trapper are faked (no network)."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

TRAPPER = "https://trapper.example.org"
SELECTION = {
    "url": TRAPPER,
    "research_project": {"pk": 2, "name": "Doñana"},
    "classification_project": {"pk": 10, "name": "Main CP"},
    "collection": {"pk": 33, "name": "R0033"},
    "deployments": [{"pk": 4, "deployment_id": "R0033-DONA_0001_A"}],
    "all_deployments": True,
}
BODY = {"username": "bob", "password": "pw", "subject_set_id": 8,
        "trapper": {"username": "alice", "password": "s3cret", "selection": SELECTION}}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _ndjson(response):
    return [json.loads(line) for line in response.text.splitlines()]


def _right(media_id):
    from wildintel_zooniverse.core.services import metadata_service

    return metadata_service.expected_metadata(TRAPPER, media_id, "R0033-DONA_0001_A", f"IMG_{media_id}.JPG")


# 101: already right. 102: an old upload — original Filename, http URLs.
# 103: no media id. 104: a media not in the Trapper selection.
SUBJECTS = [
    {"id": 101, "metadata": _right(1)},
    {"id": 102, "metadata": {**_right(2), "Filename": "IMG_2.JPG", "image_name": "IMG_2.JPG",
                             "link": "http://trapper.example.org/storage/resource/media/2/file/", "#extra": "kept"}},
    {"id": 103, "metadata": {"Filename": "IMG_0003.JPG"}},
    {"id": 104, "metadata": {"external_id": f"{TRAPPER}/:media:77"}},
]


@pytest.fixture
def fake(monkeypatch):
    from wildintel_zooniverse.core.services import metadata_service, zooniverse_service

    saved = []
    monkeypatch.setattr(zooniverse_service, "subject_set_info", lambda u, p, ss_id: (
        {"id": 8, "display_name": "Doñana R0033", "subjects_count": 4}
    ))
    monkeypatch.setattr(zooniverse_service, "iter_subjects", lambda u, p, ss_id: iter(
        {**s, "url": None, "file_name": ""} for s in SUBJECTS
    ))
    monkeypatch.setattr(zooniverse_service, "new_client", lambda u, p: MagicMock())
    monkeypatch.setattr(zooniverse_service, "update_subject_metadata", lambda client, sid, changes: saved.append((sid, changes)))
    monkeypatch.setattr(metadata_service.UpdateSettings, "from_config", classmethod(
        lambda cls: cls(workers=2, retry=metadata_service.RetryPolicy(attempts=2, min_wait=0, max_wait=0)),
    ))
    client = MagicMock()
    client.classification_projects.get_all_project_collections.return_value = SimpleNamespace(results=[
        SimpleNamespace(pk=99, collection_pk=33),
    ])
    # Trapper spells the deployment in lower case — the selection's own wins.
    client.classification_media.where_project_media.side_effect = lambda *a, **k: iter(
        SimpleNamespace(mediaID=m, deploymentID="r0033-dona_0001_a", fileName=f"IMG_{m}.JPG") for m in (1, 2, 3)
    )
    with patch("wildintel_zooniverse.core.services.trapper_service._client", return_value=client):
        yield saved


def _subjects(lines):
    return {e["subject_id"]: e for e in lines if e["type"] == "subject"}


def test_a_dry_run_reports_every_change_without_saving_any(fake):
    lines = _ndjson(_client().post("/api/metadata/update", json=BODY))

    assert [e["type"] for e in lines[:3]] == ["trapper", "deployment", "subjects"]
    assert lines[1] == {"type": "deployment", "deployment_id": "R0033-DONA_0001_A", "media": 3}
    subjects = _subjects(lines)
    assert {sid: e["status"] for sid, e in subjects.items()} == {
        101: "unchanged", 102: "would_update", 103: "unmatched", 104: "not_found",
    }
    assert subjects[102]["changes"] == [
        {"field": "link", "old": "http://trapper.example.org/storage/resource/media/2/file/",
         "new": f"{TRAPPER}/storage/resource/media/2/file/"},
        {"field": "image_name", "old": "IMG_2.JPG", "new": "2_x_R0033-DONA_0001_A_x_IMG_2.JPG"},
        {"field": "Filename", "old": "IMG_2.JPG", "new": "2_x_R0033-DONA_0001_A_x_IMG_2.JPG"},
    ]
    assert lines[-1] == {"type": "done", "dry_run": True, "unchanged": 1, "unmatched": 1, "not_found": 1,
                         "would_update": 1, "updated": 0, "failed": 0, "filtered_out": 0}
    assert fake == []


def test_updating_saves_only_the_fields_that_differ(fake):
    lines = _ndjson(_client().post("/api/metadata/update", json={**BODY, "dry_run": False}))

    assert _subjects(lines)[102]["status"] == "updated"
    assert fake == [(102, {
        "link": f"{TRAPPER}/storage/resource/media/2/file/",
        "image_name": "2_x_R0033-DONA_0001_A_x_IMG_2.JPG",
        "Filename": "2_x_R0033-DONA_0001_A_x_IMG_2.JPG",
    })]
    assert lines[-1]["updated"] == 1


def test_a_failed_update_is_retried_then_reported(fake, monkeypatch):
    import requests

    from wildintel_zooniverse.core.services import zooniverse_service

    calls = []

    def failing(client, sid, changes):
        calls.append(sid)
        raise requests.ConnectionError("reset")

    monkeypatch.setattr(zooniverse_service, "update_subject_metadata", failing)
    lines = _ndjson(_client().post("/api/metadata/update", json={**BODY, "dry_run": False}))

    assert (_subjects(lines)[102]["status"], _subjects(lines)[102]["detail"]) == ("failed", "reset")
    assert calls == [102, 102]
    assert lines[-1]["failed"] == 1


@pytest.mark.parametrize(("metadata", "expected"), [
    ({"Filename": "12_x_D_x_IMG.JPG", "external_id": "x:99"}, 12),
    ({"Filename": "IMG.JPG", "image_name": "13_x_D_x_IMG.JPG"}, 13),
    ({"Filename": "IMG.JPG", "external_id": f"{TRAPPER}/:media:14"}, 14),
    ({"Filename": "IMG.JPG"}, None),
])
def test_media_ids_are_read_as_wildintel_tools_update_metadata_does(metadata, expected):
    from wildintel_zooniverse.core.services import metadata_service

    assert metadata_service.media_id_of(metadata) == expected


def test_the_whole_metadata_is_assigned_so_panoptes_saves_it():
    from wildintel_zooniverse.core.services import zooniverse_service

    subject = MagicMock(metadata={"#extra": "kept", "link": "old"})
    client = MagicMock()
    with patch.object(zooniverse_service, "Subject") as subject_cls:
        subject_cls.find.return_value = subject
        zooniverse_service.update_subject_metadata(client, 102, {"link": "new"})

    subject_cls.find.assert_called_once_with(102)
    assert subject.metadata == {"#extra": "kept", "link": "new"}
    subject.save.assert_called_once()
    client.__enter__.assert_called_once()


def test_subject_lists_choose_which_subjects_are_updated(fake):
    lines = _ndjson(_client().post("/api/metadata/update", json={
        **BODY, "dry_run": False, "include_subjects": [101, 102, 103], "exclude_subjects": [103],
    }))

    assert {sid: e["status"] for sid, e in _subjects(lines).items()} == {
        101: "unchanged", 102: "updated", 103: "filtered_out", 104: "filtered_out",
    }
    assert lines[-1]["filtered_out"] == 2
    assert [sid for sid, _ in fake] == [102]
