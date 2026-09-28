"""/api/trapper — the Trapper client itself is faked (no network)."""
import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from trapper_client import err

CREDS = {"url": "https://trapper.example.org/", "username": "alice", "password": "s3cret"}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _deployment(pk, deployment_id, location_id="LOC"):
    return SimpleNamespace(
        pk=pk, deployment_id=deployment_id, location_id=location_id,
        start_date=datetime(2024, 9, 4, 13, 10), end_date=datetime(2024, 11, 4, 14, 28),
    )


@pytest.fixture
def fake_trapper():
    client = MagicMock()
    client.research_projects.get.return_value = SimpleNamespace(pagination=SimpleNamespace(count=2))
    client.research_projects.where.return_value = iter([
        SimpleNamespace(pk=2, name="Doñana", acronym="DONA"),
        SimpleNamespace(pk=1, name="Białowieża", acronym=None),
    ])
    client.classification_projects.where.return_value = iter([SimpleNamespace(pk=10, name="Main CP", is_active=True)])
    client.classification_projects.get_all_project_collections.return_value = SimpleNamespace(results=[
        SimpleNamespace(pk=99, collection_pk=33, name="R0033", status="Public",
                        total_count=100, classified_count=80, approved_count=70),
    ])
    client.deployments.by_collection_with_counts.return_value = [
        (_deployment(5, "R0033-DONA_0007_B"), 200), (_deployment(4, "r0033-dona_0001_a"), 150),
    ]
    with patch("wildintel_zooniverse.core.services.trapper_service._client", return_value=client) as factory:
        yield SimpleNamespace(client=client, factory=factory)


def test_test_connection_lists_projects_and_saves_the_credentials(fake_trapper):
    from wildintel_zooniverse.core import config

    response = _client().post("/api/trapper/test-connection", json=CREDS)

    assert response.json() == {"ok": True, "research_projects_count": 2}
    fake_trapper.factory.assert_called_with("https://trapper.example.org/", "alice", "s3cret")
    saved = config.load_settings().TRAPPER
    assert (saved.base_url, saved.user_name, saved.user_password) == ("https://trapper.example.org/", "alice", "s3cret")
    config_response = _client().get("/api/trapper/config").json()
    assert config_response == {"base_url": "https://trapper.example.org/", "user_name": "alice", "has_password": True}


def test_blank_password_reuses_the_saved_one(fake_trapper):
    _client().post("/api/trapper/test-connection", json=CREDS)
    _client().post("/api/trapper/research-projects", json={**CREDS, "password": ""})
    fake_trapper.factory.assert_called_with("https://trapper.example.org/", "alice", "s3cret")


def test_research_projects_sorted_by_name(fake_trapper):
    results = _client().post("/api/trapper/research-projects", json=CREDS).json()["results"]
    assert [p["name"] for p in results] == ["Białowieża", "Doñana"]


def test_classification_projects_of_a_research_project(fake_trapper):
    results = _client().post("/api/trapper/classification-projects", json={**CREDS, "research_project_pk": 2}).json()
    assert results == {"results": [{"pk": 10, "name": "Main CP", "is_active": True}]}
    fake_trapper.client.classification_projects.where.assert_called_once_with(research_project=2, page_size=200)


def test_collections_use_the_collection_pk_and_counts(fake_trapper):
    results = _client().post("/api/trapper/collections", json={**CREDS, "classification_project_pk": 10}).json()["results"]
    assert results == [{
        "pk": 33, "name": "R0033", "status": "Public",
        "total_count": 100, "classified_count": 80, "approved_count": 70,
    }]


def test_deployments_are_the_research_projects_own_with_images_in_the_collection(fake_trapper):
    response = _client().post("/api/trapper/deployments", json={**CREDS, "research_project_pk": 2, "collection_pk": 33})
    results = response.json()["results"]

    assert [(d["deployment_id"], d["image_count"]) for d in results] == [("r0033-dona_0001_a", 150), ("R0033-DONA_0007_B", 200)]
    assert results[0]["start_date"] == "2024-09-04T13:10:00"
    fake_trapper.client.deployments.by_collection_with_counts.assert_called_once_with(
        33, research_project=2, page_size=200,
    )


def test_wrong_credentials_are_a_401(fake_trapper):
    fake_trapper.client.research_projects.get.side_effect = err.UnauthorizedError("nope")
    response = _client().post("/api/trapper/test-connection", json={**CREDS, "password": "wrong"})
    assert response.status_code == 401
    assert "Incorrect Trapper username or password" in response.json()["detail"]


def test_missing_credentials_are_a_400():
    from wildintel_zooniverse.core import config

    config.save_settings(config.Settings())
    response = _client().post("/api/trapper/research-projects", json={"url": "https://x"})
    assert response.status_code == 400
    assert "username, password" in response.json()["detail"]


def _media(media_id, deployment_id, minute, public=True):
    return SimpleNamespace(mediaID=media_id, deploymentID=deployment_id,
                           timestamp=datetime(2024, 9, 4, 12, minute), filePublic=public,
                           filePath=f"https://trapper.example.org/media/{media_id}.jpg", fileName=f"IMG_{media_id}.JPG")


def _obs(media_id, observation_type):
    return SimpleNamespace(mediaID=media_id, observationType=observation_type)


PREVIEW_SELECTION = {
    "url": CREDS["url"],
    "research_project": {"pk": 2, "name": "Doñana"},
    "classification_project": {"pk": 10, "name": "Main CP"},
    "collection": {"pk": 33, "name": "R0033"},
    "deployments": [{"pk": 4, "deployment_id": "R0033-DONA_0001_A"}],
    "all_deployments": False,
}


def _ndjson(response):
    return [json.loads(line) for line in response.text.splitlines()]


def test_upload_preview_streams_what_the_criteria_keep_deployment_by_deployment(fake_trapper):
    media = {
        4: [_media(1, "R0033-DONA_0001_A", 0), _media(2, "R0033-DONA_0001_A", 10),
            _media(3, "R0033-DONA_0001_A", 20), _media(4, "R0033-DONA_0001_A", 30),
            _media(6, "R0033-DONA_0001_A", 40, public=False)],
        5: [_media(5, "R0033-DONA_0007_B", 0)],
    }
    observations = {
        4: [_obs(1, "human"), _obs(2, "human"), _obs(3, "unclassified"), _obs(4, "animal"), _obs(6, "animal")],
        5: [_obs(5, "animal")],
    }
    fake_trapper.client.classification_media.where_project_media.side_effect = lambda cp, deployment, **_: iter(media[deployment])
    fake_trapper.client.classification_results.where_project_results.side_effect = (
        lambda cp, deployment, **_: iter(observations[deployment])
    )
    selection = {**PREVIEW_SELECTION, "deployments": [
        {"pk": 4, "deployment_id": "R0033-DONA_0001_A"}, {"pk": 5, "deployment_id": "R0033-DONA_0007_B"},
    ]}

    response = _client().post("/api/trapper/upload-preview", json={**CREDS, "selection": selection, "criteria": {"max_interval": 60}})

    # R0033-DONA_0001_A: candidates 1, 2, 4 — one sequence each; 2 is a
    # middle one with a human.
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert _ndjson(response) == [
        {"type": "deployment", "deployment_id": "R0033-DONA_0001_A", "images": 5, "candidates": 3, "sequences": 3,
         "removed_middle": 1, "selected": 2},
        {"type": "deployment", "deployment_id": "R0033-DONA_0007_B", "images": 1, "candidates": 1, "sequences": 1,
         "removed_middle": 0, "selected": 1},
        {"type": "done"},
    ]
    for pk in (4, 5):
        fake_trapper.client.classification_media.where_project_media.assert_any_call(
            10, collection=99, deployment=pk, private_human="False", private_vehicle="False", page_size=1000,
        )
        fake_trapper.client.classification_results.where_project_results.assert_any_call(
            10, collection=99, deployment=pk, page_size=1000,
        )


def test_upload_preview_reports_a_trapper_failure_midway_as_its_last_line(fake_trapper):
    def media(cp, deployment, **_):
        if deployment == 5:
            raise err.ServerError("boom")
        return iter([_media(1, "R0033-DONA_0001_A", 0)])

    fake_trapper.client.classification_media.where_project_media.side_effect = media
    fake_trapper.client.classification_results.where_project_results.side_effect = lambda cp, deployment, **_: iter([])
    selection = {**PREVIEW_SELECTION, "deployments": [
        {"pk": 4, "deployment_id": "R0033-DONA_0001_A"}, {"pk": 5, "deployment_id": "R0033-DONA_0007_B"},
    ]}

    lines = _ndjson(_client().post("/api/trapper/upload-preview", json={**CREDS, "selection": selection, "criteria": {}}))

    assert [line["type"] for line in lines] == ["deployment", "error"]
    assert lines[-1]["detail"] == "boom"


def test_upload_preview_of_a_collection_not_in_the_project_is_a_400(fake_trapper):
    selection = {**PREVIEW_SELECTION, "collection": {"pk": 777, "name": "Other"}}
    response = _client().post("/api/trapper/upload-preview", json={**CREDS, "selection": selection, "criteria": {}})
    assert response.status_code == 400
    assert "not in classification project" in response.json()["detail"]


def test_upload_preview_details_each_deployments_sequences_when_asked(fake_trapper):
    fake_trapper.client.classification_media.where_project_media.side_effect = lambda *a, **k: iter([
        _media(1, "R0033-DONA_0001_A", 0), _media(2, "R0033-DONA_0001_A", 1),
    ])
    fake_trapper.client.classification_results.where_project_results.side_effect = lambda *a, **k: iter([
        _obs(1, "animal"), _obs(2, "animal"),
    ])
    body = {**CREDS, "selection": PREVIEW_SELECTION, "criteria": {"max_interval": 60}}

    plain = _ndjson(_client().post("/api/trapper/upload-preview", json=body))
    assert "sequence_detail" not in plain[0]

    [deployment, done] = _ndjson(_client().post("/api/trapper/upload-preview", json={**body, "detail": True}))
    assert deployment["selected"] == 2
    assert deployment["sequence_detail"] == [{
        "number": 1, "start": "2024-09-04T12:00:00", "end": "2024-09-04T12:01:00", "duration_s": 60,
        "images": 2, "order": [1, 2], "uploaded": [1, 2], "not_sampled": [], "removed_human": [], "removed_vehicle": [],
        "collapsed_empty": [],
    }]
    assert done == {"type": "done"}
