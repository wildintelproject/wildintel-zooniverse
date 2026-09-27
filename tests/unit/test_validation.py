"""/api/validation — Zooniverse and Trapper are faked (no network)."""
import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

TRAPPER = "https://trapper.example.org"
CREDS = {"username": "bob", "password": "pw"}
SELECTION = {
    "url": TRAPPER,
    "research_project": {"pk": 2, "name": "Doñana"},
    "classification_project": {"pk": 10, "name": "Main CP"},
    "collection": {"pk": 33, "name": "R0033"},
    "deployments": [{"pk": 4, "deployment_id": "R0033-DONA_0001_A"}, {"pk": 5, "deployment_id": "R0033-DONA_0002_B"}],
    "all_deployments": True,
}
COMPARE = {"username": "alice", "password": "s3cret", "selection": SELECTION, "criteria": {"max_interval": 60}}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _ndjson(response):
    return [json.loads(line) for line in response.text.splitlines()]


def _metadata(media_id, **overrides):
    from wildintel_zooniverse.core.services.upload_service import trapper_metadata

    return {**trapper_metadata(TRAPPER, media_id, f"{media_id}_x_D_x_IMG.JPG"), "Filename": "x", **overrides}


# Subject set 8: media 1 (twice), media 2, media 9 (not expected), one
# subject with no media id, and one with a wrong link.
SUBJECTS = [
    {"id": 101, "metadata": _metadata(1)},
    {"id": 102, "metadata": _metadata(1)},
    {"id": 103, "metadata": _metadata(2, link="https://elsewhere/2")},
    {"id": 104, "metadata": _metadata(9)},
    {"id": 105, "metadata": {"Filename": "IMG_0001.JPG"}},
]


def _media(media_id, minute, deployment="R0033-DONA_0001_A"):
    return SimpleNamespace(mediaID=media_id, deploymentID=deployment, timestamp=datetime(2024, 9, 4, 12, minute),
                           filePublic=True, filePath=f"{TRAPPER}/m/{media_id}.jpg", fileName=f"IMG_{media_id}.JPG")


@pytest.fixture
def fake(monkeypatch):
    from wildintel_zooniverse.core.services import zooniverse_service

    monkeypatch.setattr(zooniverse_service, "subject_set_info", lambda u, p, ss_id: (
        {"id": 8, "display_name": "Doñana R0033", "subjects_count": 5}
    ))
    monkeypatch.setattr(zooniverse_service, "iter_subjects", lambda u, p, ss_id: iter(
        {**s, "url": None, "file_name": ""} for s in SUBJECTS
    ))
    client = MagicMock()
    client.classification_projects.get_all_project_collections.return_value = SimpleNamespace(results=[
        SimpleNamespace(pk=99, collection_pk=33),
    ])
    # Deployment 4: media 1, 2, 3 — one sequence each, all kept. Trapper
    # spells its deployment id in lower case. Deployment 5: nothing.
    media = {4: [_media(1, 0, "r0033-dona_0001_a"), _media(2, 10, "r0033-dona_0001_a"), _media(3, 20, "r0033-dona_0001_a")],
             5: []}
    client.classification_media.where_project_media.side_effect = lambda cp, deployment, **_: iter(media[deployment])
    client.classification_results.where_project_results.side_effect = lambda cp, deployment, **_: iter(
        SimpleNamespace(mediaID=m.mediaID, observationType="animal") for m in media[deployment]
    )
    with patch("wildintel_zooniverse.core.services.trapper_service._client", return_value=client) as factory:
        yield factory


def test_the_subject_set_on_its_own(fake):
    lines = _ndjson(_client().post("/api/validation/subject-set", json={**CREDS, "subject_set_id": 8}))

    assert lines[0] == {"type": "subjects", "id": 8, "name": "Doñana R0033", "total": 5}
    assert lines[1] == {"type": "progress", "phase": "subjects", "done": 5}
    assert lines[-1] == {"type": "done"}
    report = lines[-2]
    assert report["type"] == "report"
    assert (report["subjects"], report["media"], report["compared"]) == (5, 3, False)
    assert report["duplicated"] == [{"media_id": 1, "subject_ids": [101, 102]}]
    assert report["uploaded"] == [
        {"media_id": 1, "subject_ids": [101, 102]}, {"media_id": 2, "subject_ids": [103]}, {"media_id": 9, "subject_ids": [104]},
    ]
    assert report["unmatched"] == [105]
    # Without Trapper, only missing fields are metadata issues.
    assert [(i["subject_id"], i["issues"]) for i in report["metadata_issues"]] == [
        (105, ["missing fields: external_id, preview, link, thumbnail, origin, license, image_name"]),
    ]
    assert "missing" not in report
    fake.assert_not_called()


def test_compared_with_what_an_upload_would_send(fake):
    lines = _ndjson(_client().post("/api/validation/subject-set", json={
        **CREDS, "subject_set_id": 8, "trapper": COMPARE,
    }))

    assert [line["type"] for line in lines] == ["subjects", "progress", "trapper", "deployment", "deployment", "report", "done"]
    assert lines[2] == {"type": "trapper", "total": 2}
    report = lines[-2]
    assert (report["compared"], report["expected"]) == (True, 3)
    assert report["missing"] == [{"media_id": 3, "deployment_id": "R0033-DONA_0001_A", "file_name": "IMG_3.JPG"}]
    assert report["extra"] == [{"media_id": 9, "subject_ids": [104]}]
    assert report["deployments"] == [
        {"deployment_id": "R0033-DONA_0001_A", "expected": 3, "uploaded": 2, "missing": 1},
        {"deployment_id": "R0033-DONA_0002_B", "expected": 0, "uploaded": 0, "missing": 0},
    ]
    assert [(i["subject_id"], i["issues"]) for i in report["metadata_issues"]][0] == (
        103, [f"link: expected '{TRAPPER}/storage/resource/media/2/file/', got 'https://elsewhere/2'"],
    )
    # The selection's own Trapper URL, since none was given.
    fake.assert_called_with(TRAPPER, "alice", "s3cret")


def test_a_trapper_failure_midway_is_the_last_line(fake):
    from trapper_client import err

    fake.return_value.classification_media.where_project_media.side_effect = err.ServerError("boom")
    lines = _ndjson(_client().post("/api/validation/subject-set", json={
        **CREDS, "subject_set_id": 8, "trapper": COMPARE,
    }))
    assert lines[-1] == {"type": "error", "detail": "boom"}


def test_an_unknown_subject_set_is_an_error(fake, monkeypatch):
    from panoptes_client.panoptes import PanoptesAPIException

    from wildintel_zooniverse.core.services import zooniverse_service

    def missing(u, p, ss_id):
        raise PanoptesAPIException("Could not find subject_set with id='77'")

    monkeypatch.setattr(zooniverse_service, "subject_set_info", missing)
    response = _client().post("/api/validation/subject-set", json={**CREDS, "subject_set_id": 77})
    assert response.status_code == 400
    assert "77" in response.json()["detail"]


@pytest.mark.parametrize(("metadata", "expected"), [
    ({"external_id": f"{TRAPPER}/:media:42"}, 42),
    ({"origin": "https://t/:media:7 ", "external_id": f"{TRAPPER}/:media:42"}, 7),
    ({"origin": f"{TRAPPER}/", "external_id": "nope"}, None),
    ({}, None),
])
def test_media_ids_are_read_as_wildintel_tools_does(metadata, expected):
    from wildintel_zooniverse.core.services import validation_service

    assert validation_service.media_id_of(metadata) == expected
