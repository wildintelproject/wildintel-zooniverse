"""/api/export/import — Trapper is faked (no network)."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from trapper_client import err

CREDS = {"url": "https://trapper.example.org", "username": "alice", "password": "s3cret"}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _ndjson(response):
    return [json.loads(line) for line in response.text.splitlines()]


@pytest.fixture
def csvs(tmp_path: Path):
    files = []
    for i in (1, 2):
        f = tmp_path / f"observations_part00{i}.csv"
        f.write_text("observationType,_id\nanimal,10\n", encoding="utf-8")
        files.append(f)
    return files


@pytest.fixture
def fake_trapper():
    client = MagicMock()
    client.classification_results.import_classifications.return_value = SimpleNamespace(
        data=SimpleNamespace(message="Import scheduled", task_id="abc-123"),
    )
    with patch("wildintel_zooniverse.core.services.trapper_service._client", return_value=client) as factory:
        yield SimpleNamespace(client=client, factory=factory)


def test_imports_each_csv_as_wildintel_tools_did(fake_trapper, csvs):
    lines = _ndjson(_client().post("/api/export/import", json={
        **CREDS, "classification_project_id": 10, "files": [str(f) for f in csvs],
    }))

    assert lines == [
        {"type": "file", "path": str(csvs[0]), "index": 1, "total": 2},
        {"type": "imported", "path": str(csvs[0]), "message": "Import scheduled", "task_id": "abc-123"},
        {"type": "file", "path": str(csvs[1]), "index": 2, "total": 2},
        {"type": "imported", "path": str(csvs[1]), "message": "Import scheduled", "task_id": "abc-123"},
        {"type": "done", "imported": 2, "failed": 0},
    ]
    # Only expert classifications, no bboxes, not approved — wildintel-tools' own.
    fake_trapper.client.classification_results.import_classifications.assert_any_call(
        project_id=10, file=csvs[0], approve=False, import_bboxes=False,
        import_expert_classifications=True, import_ai_classifications=False,
    )
    fake_trapper.factory.assert_called_with("https://trapper.example.org", "alice", "s3cret")


def test_approving_is_optional(fake_trapper, csvs):
    _client().post("/api/export/import", json={
        **CREDS, "classification_project_id": 10, "files": [str(csvs[0])], "approve": True,
    })
    assert fake_trapper.client.classification_results.import_classifications.call_args.kwargs["approve"] is True


def test_a_refused_file_doesnt_stop_the_rest(fake_trapper, csvs):
    fake_trapper.client.classification_results.import_classifications.side_effect = [
        err.APIError("Invalid rows: _id 10 not found"), SimpleNamespace(data=SimpleNamespace(message="ok", task_id=None)),
    ]
    lines = _ndjson(_client().post("/api/export/import", json={
        **CREDS, "classification_project_id": 10, "files": [str(f) for f in csvs],
    }))
    assert lines[1] == {"type": "failed", "path": str(csvs[0]), "detail": "Invalid rows: _id 10 not found"}
    assert lines[3]["type"] == "imported"
    assert lines[-1] == {"type": "done", "imported": 1, "failed": 1}


def test_only_existing_csv_files(fake_trapper, tmp_path: Path):
    other = tmp_path / "notes.txt"
    other.write_text("x")
    for path in (str(tmp_path / "missing.csv"), str(other)):
        response = _client().post("/api/export/import", json={**CREDS, "classification_project_id": 10, "files": [path]})
        assert response.status_code == 400
        assert "Not a CSV file" in response.json()["detail"]
    fake_trapper.client.classification_results.import_classifications.assert_not_called()


def test_wrong_credentials_are_an_error_before_anything_is_imported(fake_trapper, csvs):
    fake_trapper.client.classification_projects.get_project_collections.side_effect = err.UnauthorizedError("401")
    response = _client().post("/api/export/import", json={
        **CREDS, "classification_project_id": 10, "files": [str(csvs[0])],
    })
    assert response.status_code == 401
    fake_trapper.client.classification_results.import_classifications.assert_not_called()
