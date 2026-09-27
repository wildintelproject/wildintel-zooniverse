from fastapi.testclient import TestClient

SELECTION = {
    "url": "https://trapper.example.org",
    "research_project": {"pk": 2, "name": "Doñana"},
    "classification_project": {"pk": 10, "name": "Main CP"},
    "collection": {"pk": 33, "name": "R0033"},
    "deployments": [{"pk": 4, "deployment_id": "R0033-DONA_0001_A"}],
    "all_deployments": False,
}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def test_saving_a_selection_creates_a_resumable_session_without_credentials():
    client = _client()
    saved = client.post("/api/sessions/selection", json={"selection": SELECTION}).json()

    assert saved["phase"] == "selected" and saved["task"] == "upload" and saved["source_type"] == "trapper"
    listed = client.get("/api/sessions").json()
    assert saved["task_id"] in [s["task_id"] for s in listed]
    session = next(s for s in listed if s["task_id"] == saved["task_id"])
    assert session["selection"]["collection"]["name"] == "R0033"
    assert "password" not in str(session) and "username" not in str(session)


def test_saving_again_updates_the_same_session():
    client = _client()
    first = client.post("/api/sessions/selection", json={"selection": SELECTION}).json()
    changed = {**SELECTION, "all_deployments": True}
    second = client.post("/api/sessions/selection", json={"task_id": first["task_id"], "selection": changed}).json()

    assert second["task_id"] == first["task_id"]
    assert second["created_at"] == first["created_at"]
    assert second["selection"]["all_deployments"] is True


def test_a_selection_needs_at_least_one_deployment():
    response = _client().post("/api/sessions/selection", json={"selection": {**SELECTION, "deployments": []}})
    assert response.status_code == 422


def test_saving_the_criteria_moves_the_session_on_and_a_new_selection_keeps_them():
    client = _client()
    saved = client.post("/api/sessions/selection", json={"selection": SELECTION}).json()
    filtered = client.post("/api/sessions/criteria", json={
        "task_id": saved["task_id"], "criteria": {"max_interval": 120, "remove_middle_vehicles": True},
    }).json()

    assert filtered["phase"] == "filtered"
    assert filtered["criteria"] == {
        "max_interval": 120, "images_per_sequence": 5, "only_classified": True,
        "remove_middle_humans": True, "remove_middle_vehicles": True,
    }
    reselected = client.post("/api/sessions/selection", json={"task_id": saved["task_id"], "selection": SELECTION}).json()
    assert reselected["phase"] == "selected" and reselected["criteria"]["max_interval"] == 120


def test_criteria_need_an_existing_session_and_valid_values():
    client = _client()
    assert client.post("/api/sessions/criteria", json={"task_id": "nope", "criteria": {}}).status_code == 404
    saved = client.post("/api/sessions/selection", json={"selection": SELECTION}).json()
    bad = client.post("/api/sessions/criteria", json={"task_id": saved["task_id"], "criteria": {"images_per_sequence": 0}})
    assert bad.status_code == 422


DESTINATION = {
    "project": {"id": 30567, "name": "European Camera Trap Project", "slug": "wildintel/european"},
    "subject_set_name": "Doñana_14_R0033_33_2026-09",
}


def test_saving_the_destination_moves_the_session_on_without_credentials():
    client = _client()
    saved = client.post("/api/sessions/selection", json={"selection": SELECTION}).json()
    client.post("/api/sessions/criteria", json={"task_id": saved["task_id"], "criteria": {}})
    placed = client.post("/api/sessions/destination", json={"task_id": saved["task_id"], "destination": DESTINATION}).json()

    assert placed["phase"] == "destination"
    assert placed["destination"] == DESTINATION
    assert placed["criteria"]["images_per_sequence"] == 5
    assert "password" not in str(placed)


def test_a_destination_needs_an_existing_session_and_a_subject_set_name():
    client = _client()
    assert client.post("/api/sessions/destination", json={"task_id": "nope", "destination": DESTINATION}).status_code == 404
    saved = client.post("/api/sessions/selection", json={"selection": SELECTION}).json()
    bad = client.post("/api/sessions/destination", json={
        "task_id": saved["task_id"], "destination": {**DESTINATION, "subject_set_name": ""},
    })
    assert bad.status_code == 422


def test_discarding_a_session_removes_it():
    client = _client()
    saved = client.post("/api/sessions/selection", json={"selection": SELECTION}).json()
    client.delete(f"/api/sessions/{saved['task_id']}")
    assert saved["task_id"] not in [s["task_id"] for s in client.get("/api/sessions").json()]
