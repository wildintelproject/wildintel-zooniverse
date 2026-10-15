"""/api/zooniverse — panoptes-client itself is faked (no network)."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from panoptes_client.panoptes import PanoptesAPIException

CREDS = {"username": "alice", "password": "s3cret"}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


@pytest.fixture
def fake_panoptes():
    from wildintel_zooniverse.core.services import zooniverse_service

    zooniverse_service._clients.clear()
    with (
        patch.object(zooniverse_service, "Panoptes") as panoptes,
        patch.object(zooniverse_service, "User") as user,
        patch.object(zooniverse_service, "Project") as project,
        patch.object(zooniverse_service, "SubjectSet") as subject_set,
    ):
        user.me.return_value = SimpleNamespace(login="alice", display_name="Alice")
        project.where.return_value = iter([
            SimpleNamespace(id="30567", display_name="European Camera Trap Project", slug="wildintel/european"),
            SimpleNamespace(id="12188", display_name="Iberian Camera Trap Project", slug="aicensusuhu/iberian"),
        ])
        subject_set.where.return_value = iter([
            SimpleNamespace(id="2", display_name="Kittehs", set_member_subjects_count=30),
            SimpleNamespace(id="1", display_name="DONA_24_14_R0036_45_2026-03", set_member_subjects_count=86878),
        ])
        yield SimpleNamespace(panoptes=panoptes, project=project, subject_set=subject_set)
    zooniverse_service._clients.clear()


def test_test_connection_saves_the_credentials_without_exposing_the_password(fake_panoptes):
    response = _client().post("/api/zooniverse/test-connection", json=CREDS)

    assert response.json() == {"ok": True, "login": "alice", "display_name": "Alice"}
    fake_panoptes.panoptes.assert_called_once_with(username="alice", password="s3cret")
    assert _client().get("/api/zooniverse/config").json() == {"user_name": "alice", "has_password": True}


def test_testing_without_saving_leaves_the_settings_alone(fake_panoptes):
    from wildintel_zooniverse.core import config

    config.save_settings(config.Settings())
    response = _client().post("/api/zooniverse/test-connection?save=false", json=CREDS)

    assert response.json() == {"ok": True, "login": "alice", "display_name": "Alice"}
    assert _client().get("/api/zooniverse/config").json() == {"user_name": None, "has_password": False}


def test_logs_in_again_only_when_the_credentials_change(fake_panoptes):
    client = _client()
    client.post("/api/zooniverse/test-connection", json=CREDS)
    client.post("/api/zooniverse/projects", json={**CREDS, "password": ""})  # the saved one
    assert fake_panoptes.panoptes.call_count == 1
    client.post("/api/zooniverse/projects", json={**CREDS, "username": "bob"})
    assert fake_panoptes.panoptes.call_count == 2


def test_projects_are_the_ones_the_user_can_edit_sorted_by_name(fake_panoptes):
    results = _client().post("/api/zooniverse/projects", json=CREDS).json()["results"]

    assert [p["id"] for p in results] == [30567, 12188]
    assert results[0] == {"id": 30567, "display_name": "European Camera Trap Project", "slug": "wildintel/european"}
    fake_panoptes.project.where.assert_called_once_with(current_user_roles="owner,collaborator")


def test_subject_sets_of_a_project_with_their_subject_counts(fake_panoptes):
    results = _client().post("/api/zooniverse/subject-sets", json={**CREDS, "project_id": 30567}).json()["results"]

    assert results == [
        {"id": 1, "display_name": "DONA_24_14_R0036_45_2026-03", "subjects_count": 86878},
        {"id": 2, "display_name": "Kittehs", "subjects_count": 30},
    ]
    fake_panoptes.subject_set.where.assert_called_once_with(project_id=30567)


def test_wrong_credentials_are_a_401_and_not_remembered(fake_panoptes):
    fake_panoptes.panoptes.side_effect = PanoptesAPIException("Invalid email or password.")
    response = _client().post("/api/zooniverse/test-connection", json={**CREDS, "password": "wrong"})

    assert response.status_code == 401
    assert "Incorrect Zooniverse username or password" in response.json()["detail"]
    from wildintel_zooniverse.core.services import zooniverse_service
    assert zooniverse_service._clients == {}


def test_missing_credentials_are_a_400():
    from wildintel_zooniverse.core import config

    config.save_settings(config.Settings())
    response = _client().post("/api/zooniverse/projects", json={"username": "alice"})
    assert response.status_code == 400
    assert "Missing Zooniverse password" in response.json()["detail"]


def test_every_call_makes_the_logged_in_client_its_threads_own(fake_panoptes):
    # panoptes-client keeps the current client per thread, and each request
    # may run on any thread of FastAPI's pool.
    client = _client()
    client.post("/api/zooniverse/projects", json=CREDS)
    client.post("/api/zooniverse/subject-sets", json={**CREDS, "project_id": 30567})
    assert fake_panoptes.panoptes.call_count == 1
    assert fake_panoptes.panoptes.return_value.__enter__.call_count == 2


def _listing(monkeypatch, pages):
    """iter_subjects over a fake panoptes listing: each item of `pages` is a subject, or an exception raised by that next()."""
    from contextlib import nullcontext
    from types import SimpleNamespace

    from wildintel_zooniverse.core.services import retry, zooniverse_service

    class Listing:
        def __init__(self):
            self.todo = list(pages)

        def __iter__(self):
            return self

        def __next__(self):
            if not self.todo:
                raise StopIteration
            item = self.todo[0]
            if isinstance(item, Exception):
                self.todo.pop(0)  # like panoptes: asking again repeats the request, which then works
                raise item
            return self.todo.pop(0)

    monkeypatch.setattr(zooniverse_service, "_client_for", lambda u, p: nullcontext())
    monkeypatch.setattr(zooniverse_service.Subject, "where", lambda **kw: Listing())
    monkeypatch.setattr(zooniverse_service, "_listing_policy", lambda: retry.RetryPolicy(attempts=3, min_wait=0, max_wait=0))
    return zooniverse_service, SimpleNamespace


def _subject(sid):
    from types import SimpleNamespace
    return SimpleNamespace(id=str(sid), locations=[], metadata={"Filename": f"{sid}_x.jpg"})


def test_a_page_zooniverse_fails_to_give_is_asked_for_again(monkeypatch):
    from panoptes_client.panoptes import PanoptesAPIException

    zoo, _ = _listing(monkeypatch, [_subject(1), PanoptesAPIException("Received HTTP status code 502 from API"), _subject(2)])
    assert [s["id"] for s in zoo.iter_subjects("u", "p", 8)] == [1, 2]


def test_a_listing_gives_up_after_the_attempts_and_never_retries_a_4xx(monkeypatch):
    from panoptes_client.panoptes import PanoptesAPIException

    zoo, _ = _listing(monkeypatch, [PanoptesAPIException("Received HTTP status code 502 from API")] * 3 + [_subject(1)])
    import pytest
    with pytest.raises(PanoptesAPIException, match="502"):
        list(zoo.iter_subjects("u", "p", 8))

    zoo, _ = _listing(monkeypatch, [PanoptesAPIException("Received HTTP status code 404 from API"), _subject(1)])
    with pytest.raises(PanoptesAPIException, match="404"):
        list(zoo.iter_subjects("u", "p", 8))
