"""/api/upload — Trapper and panoptes-client are faked (no network)."""
import json
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
import requests
from fastapi.testclient import TestClient

SELECTION = {
    "url": "https://trapper.example.org/",
    "research_project": {"pk": 2, "name": "Doñana"},
    "classification_project": {"pk": 10, "name": "Main CP"},
    "collection": {"pk": 33, "name": "R0033"},
    "deployments": [{"pk": 4, "deployment_id": "R0033-DONA_0001_A"}],
    "all_deployments": True,
}
DESTINATION = {
    "project": {"id": 30567, "name": "European Camera Trap Project", "slug": "wildintel/european"},
    "subject_set_name": "Doñana_2_R0033_33_2026-09",
}
BODY = {"trapper": {"username": "alice", "password": "s3cret"}, "zooniverse": {"username": "bob", "password": "pw"}}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _ndjson(response):
    return [json.loads(line) for line in response.text.splitlines()]


def _session(destination=True) -> str:
    from wildintel_zooniverse.core.services import session_store

    task_id = session_store.new_task_id()
    session_store.write_selection_phase(task_id, task="upload", source_type="trapper", selection=SELECTION)
    session_store.write_criteria_phase(task_id, criteria={"max_interval": 60, "images_per_sequence": 5,
                                                          "only_classified": True, "remove_middle_humans": True,
                                                          "remove_middle_vehicles": False})
    if destination:
        session_store.write_destination_phase(task_id, destination=DESTINATION)
    return task_id


def _media(media_id, minute, url="https://trapper.example.org/media/{}.jpg"):
    return SimpleNamespace(mediaID=media_id, deploymentID="R0033-DONA_0001_A", timestamp=datetime(2024, 9, 4, 12, minute),
                           filePublic=True, filePath=url.format(media_id) if url else None, fileName=f"IMG_{media_id}.JPG")


@pytest.fixture
def fake_trapper():
    client = MagicMock()
    client.classification_projects.get_all_project_collections.return_value = SimpleNamespace(results=[
        SimpleNamespace(pk=99, collection_pk=33),
    ])
    client.classification_media.where_project_media.side_effect = lambda *a, **k: iter([_media(1, 0), _media(2, 10)])
    client.classification_results.where_project_results.side_effect = lambda *a, **k: iter([
        SimpleNamespace(mediaID=1, observationType="animal"), SimpleNamespace(mediaID=2, observationType="animal"),
    ])
    with patch("wildintel_zooniverse.core.services.trapper_service._client", return_value=client) as factory:
        yield SimpleNamespace(client=client, factory=factory)


@pytest.fixture
def fake_panoptes():
    from wildintel_zooniverse.core.services import zooniverse_service

    zooniverse_service._clients.clear()
    with patch.object(zooniverse_service, "Panoptes"), patch.object(zooniverse_service, "SubjectSet") as subject_set:
        subject_set.where.side_effect = lambda **_: iter([
            SimpleNamespace(id="7", display_name="Other", set_member_subjects_count=1),
            SimpleNamespace(id="8", display_name=DESTINATION["subject_set_name"], set_member_subjects_count=40),
        ])
        yield subject_set
    zooniverse_service._clients.clear()


@pytest.fixture(autouse=True)
def instant_dry_runs(monkeypatch):
    """No simulated delay per step, but for the one test about it."""
    from wildintel_zooniverse.core.services import upload_service

    monkeypatch.setattr(upload_service, "DRY_RUN_STEP_DELAY", 0)


@pytest.fixture
def instant_retries():
    """3 attempts per step, no wait between them — set as the settings page
    would."""
    from wildintel_zooniverse.core import config

    settings = config.load_settings()
    settings.TRAPPER.download_attempts = settings.ZOONIVERSE.upload_attempts = 3
    settings.TRAPPER.download_retry_delay = settings.ZOONIVERSE.upload_retry_delay = 0
    config.save_settings(settings)
    yield
    config.save_settings(config.Settings())


def _images(lines):
    """The image events, by media id — the workers finish in any order."""
    return sorted((line for line in lines if line["type"] == "image"), key=lambda line: line["media_id"])


def test_dry_run_streams_every_kept_image_and_records_the_result(fake_trapper, fake_panoptes):
    from wildintel_zooniverse.core.services import session_store

    task_id = _session()
    response = _client().post("/api/upload/dry-run", json={**BODY, "task_id": task_id})

    assert response.headers["content-type"].startswith("application/x-ndjson")
    lines = _ndjson(response)
    assert [line for line in lines if line["type"] not in ("image", "step")] == [
        {"type": "start", "dry_run": True, "subject_set": {"name": DESTINATION["subject_set_name"], "id": 8, "exists": True}},
        {"type": "fetching", "deployment_id": "R0033-DONA_0001_A"},
        {"type": "deployment", "deployment_id": "R0033-DONA_0001_A", "images": 2, "candidates": 2, "sequences": 2,
         "removed_middle": 0, "selected": 2, "filtered_out": 0},
        {"type": "done", "dry_run": True, "uploaded": 2, "skipped": 0, "failed": 0, "filtered_out": 0},
    ]
    assert _images(lines) == [
        {"type": "image", "media_id": 1, "deployment_id": "R0033-DONA_0001_A",
         "file_name": "1_x_IMG_1.JPG", "status": "uploaded", "subject_id": None},
        {"type": "image", "media_id": 2, "deployment_id": "R0033-DONA_0001_A",
         "file_name": "2_x_IMG_2.JPG", "status": "uploaded", "subject_id": None},
    ]
    # The session's own Trapper URL, since the request left it blank.
    fake_trapper.factory.assert_called_with("https://trapper.example.org/", "alice", "s3cret")
    fake_panoptes.where.assert_called_with(project_id=30567)
    fake_panoptes.return_value.save.assert_not_called()
    manifest = session_store.read_manifest(task_id)
    assert manifest["phase"] == "destination"
    assert manifest["last_dry_run"]["uploaded"] == 2
    assert manifest["last_dry_run"]["subject_set_id"] == 8
    assert session_store.read_uploaded(task_id) == set()


def test_each_image_says_when_its_download_and_its_upload_start(fake_trapper, fake_panoptes):
    lines = _ndjson(_client().post("/api/upload/dry-run", json={**BODY, "task_id": _session()}))

    for media_id in (1, 2):
        own = [(line["type"], line.get("step")) for line in lines if line.get("media_id") == media_id]
        assert own == [("step", "download"), ("step", "upload"), ("image", None)]
    step = next(line for line in lines if line["type"] == "step" and line["media_id"] == 1)
    assert (step["file_name"], step["deployment_id"]) == ("1_x_IMG_1.JPG", "R0033-DONA_0001_A")


def test_each_simulated_step_takes_a_while_so_it_can_be_seen(tmp_path: Path, monkeypatch):
    import time

    from wildintel_zooniverse.core.services import upload_service

    monkeypatch.setattr(upload_service, "DRY_RUN_STEP_DELAY", 0.2)
    started = time.monotonic()
    [event] = _run_pipeline(upload_service.DryRunTransfer(), tmp_path)
    assert event["status"] == "uploaded"
    assert time.monotonic() - started >= 0.4  # download + upload


def test_dry_run_says_when_the_subject_set_would_be_created(fake_trapper, fake_panoptes):
    fake_panoptes.where.side_effect = lambda **_: iter([])
    lines = _ndjson(_client().post("/api/upload/dry-run", json={**BODY, "task_id": _session()}))
    assert lines[0]["subject_set"] == {"name": DESTINATION["subject_set_name"], "id": None, "exists": False}


def test_dry_run_fails_an_image_without_a_file_url(fake_trapper, fake_panoptes, instant_retries):
    fake_trapper.client.classification_media.where_project_media.side_effect = lambda *a, **k: iter([
        _media(1, 0), _media(2, 10, url=None),
    ])

    lines = _ndjson(_client().post("/api/upload/dry-run", json={**BODY, "task_id": _session()}))

    failed = _images(lines)[1]
    assert (failed["status"], failed["step"]) == ("failed", "download")
    assert "no file URL" in failed["detail"]
    assert lines[-1] == {"type": "done", "dry_run": True, "uploaded": 1, "skipped": 0, "failed": 1, "filtered_out": 0}


def test_dry_run_reports_a_trapper_failure_midway_as_its_last_line(fake_trapper, fake_panoptes):
    from trapper_client import err

    fake_trapper.client.classification_media.where_project_media.side_effect = err.ServerError("boom")
    lines = _ndjson(_client().post("/api/upload/dry-run", json={**BODY, "task_id": _session()}))
    assert [line["type"] for line in lines] == ["start", "fetching", "error"]
    assert lines[-1]["detail"] == "boom"


def test_dry_run_of_a_session_without_destination_is_a_400():
    response = _client().post("/api/upload/dry-run", json={**BODY, "task_id": _session(destination=False)})
    assert response.status_code == 400
    assert "destination" in response.json()["detail"]


def test_dry_run_of_an_unknown_session_is_a_404():
    assert _client().post("/api/upload/dry-run", json={**BODY, "task_id": "nope"}).status_code == 404


@pytest.fixture
def fake_zooniverse_upload(monkeypatch):
    """The real upload with its network edges faked: downloads write a few
    bytes, create_subject records what it got."""
    from wildintel_zooniverse.core.services import upload_service, zooniverse_service

    created = []

    def download(self, image, path):
        if not image.file_url:
            raise ValueError("no file URL")
        path.write_bytes(b"jpeg")

    def create_subject(client, project_id, subject_set_id, path, metadata):
        assert path.read_bytes() == b"jpeg"
        created.append((project_id, subject_set_id, path.name, metadata))
        return f"9{len(created)}"

    monkeypatch.setattr(upload_service.ZooniverseTransfer, "download", download)
    monkeypatch.setattr(zooniverse_service, "new_client", lambda username, password: MagicMock())
    monkeypatch.setattr(zooniverse_service, "create_subject", create_subject)
    return created


def test_upload_creates_a_subject_per_image_and_records_each(fake_trapper, fake_panoptes, fake_zooniverse_upload):
    from wildintel_zooniverse.core.services import session_store

    task_id = _session()
    lines = _ndjson(_client().post("/api/upload/start", json={**BODY, "task_id": task_id}))

    assert lines[0] == {"type": "start", "dry_run": False,
                        "subject_set": {"name": DESTINATION["subject_set_name"], "id": 8, "exists": True}}
    assert [(e["media_id"], e["status"]) for e in _images(lines)] == [(1, "uploaded"), (2, "uploaded")]
    assert lines[-1] == {"type": "done", "dry_run": False, "uploaded": 2, "skipped": 0, "failed": 0, "filtered_out": 0}
    assert sorted(name for _, _, name, _ in fake_zooniverse_upload) == [
        "1_x_IMG_1.JPG", "2_x_IMG_2.JPG",
    ]
    assert {(project, subject_set) for project, subject_set, _, _ in fake_zooniverse_upload} == {(30567, 8)}
    assert session_store.read_uploaded(task_id) == {1, 2}
    manifest = session_store.read_manifest(task_id)
    assert manifest["phase"] == "done"
    assert manifest["upload"]["subject_set_id"] == 8


def test_upload_creates_the_subject_set_when_there_is_none(fake_trapper, fake_panoptes, fake_zooniverse_upload):
    fake_panoptes.where.side_effect = lambda **_: iter([])
    fake_panoptes.return_value.id = "55"

    lines = _ndjson(_client().post("/api/upload/start", json={**BODY, "task_id": _session()}))

    assert lines[0]["subject_set"] == {"name": DESTINATION["subject_set_name"], "id": 55, "exists": False}
    fake_panoptes.return_value.save.assert_called_once()
    assert fake_panoptes.return_value.display_name == DESTINATION["subject_set_name"]


def test_upload_again_skips_what_was_already_uploaded(fake_trapper, fake_panoptes, fake_zooniverse_upload):
    from wildintel_zooniverse.core.services import session_store

    task_id = _session()
    session_store.append_uploaded(task_id, media_id=1, subject_id="91")

    lines = _ndjson(_client().post("/api/upload/start", json={**BODY, "task_id": task_id}))

    assert [(e["media_id"], e["status"]) for e in _images(lines)] == [(1, "skipped"), (2, "uploaded")]
    assert lines[-1] == {"type": "done", "dry_run": False, "uploaded": 1, "skipped": 1, "failed": 0, "filtered_out": 0}
    assert len(fake_zooniverse_upload) == 1


def test_upload_with_failures_stays_resumable(fake_trapper, fake_panoptes, fake_zooniverse_upload, instant_retries):
    from wildintel_zooniverse.core.services import session_store

    fake_trapper.client.classification_media.where_project_media.side_effect = lambda *a, **k: iter([
        _media(1, 0), _media(2, 10, url=None),
    ])
    task_id = _session()

    lines = _ndjson(_client().post("/api/upload/start", json={**BODY, "task_id": task_id}))

    assert lines[-1]["failed"] == 1
    manifest = session_store.read_manifest(task_id)
    assert manifest["phase"] == "uploading"
    assert manifest["upload"]["failed"] == 1
    assert [s["task_id"] for s in session_store.list_sessions()].count(task_id) == 1


class FlakyTransfer:
    """Fails the first `failures` calls of each step with `errors`."""

    def __init__(self, failures, download_error=httpx.ConnectError("no route"),
                 upload_error=requests.ConnectionError("reset")):
        self.failures = failures
        self.errors = {"download": download_error, "upload": upload_error}
        self.calls = {"download": 0, "upload": 0}

    def _step(self, name):
        self.calls[name] += 1
        if self.calls[name] <= self.failures:
            raise self.errors[name]

    def download(self, image, path):
        self._step("download")

    def upload(self, path, metadata):
        self._step("upload")
        return "123"

    def close(self):
        pass


def _candidate(media_id=1, file_url="https://x/1.jpg"):
    from wildintel_zooniverse.core.services.sampling import Candidate

    return Candidate(media_id=media_id, deployment_id="D", timestamp=datetime(2024, 1, 1), public=True,
                     file_url=file_url, file_name=f"IMG_{media_id}.JPG")


def _settings(attempts=3, download_workers=1, upload_workers=1):
    from wildintel_zooniverse.core.services import upload_service

    policy = upload_service.RetryPolicy(attempts=attempts, min_wait=0, max_wait=0)
    return upload_service.TransferSettings(download_workers, policy, upload_workers, policy)


def _run_pipeline(transfer, tmp_path, images=None, settings=None, on_uploaded=None):
    from wildintel_zooniverse.core.services import upload_service

    images = images or [_candidate()]
    pipeline = upload_service._Pipeline(transfer, settings or _settings(), tmp_path, "https://t", on_uploaded)
    try:
        for image in images:
            pipeline.submit(image)
        events = []
        while len(events) < len(images):
            event = pipeline.events.get(timeout=5)
            if event["type"] == "image":
                events.append(event)
        return sorted(events, key=lambda e: e["media_id"])
    finally:
        pipeline.close()


def test_each_step_is_retried_until_it_works(tmp_path: Path):
    transfer = FlakyTransfer(failures=2)
    recorded = []
    [event] = _run_pipeline(transfer, tmp_path, on_uploaded=lambda media_id, subject_id: recorded.append((media_id, subject_id)))
    assert (event["status"], event["subject_id"]) == ("uploaded", "123")
    assert transfer.calls == {"download": 3, "upload": 3}
    assert recorded == [(1, "123")]


def test_a_step_still_failing_after_every_attempt_fails_the_image(tmp_path: Path):
    transfer = FlakyTransfer(failures=3)
    [event] = _run_pipeline(transfer, tmp_path)
    assert (event["status"], event["step"], event["detail"]) == ("failed", "download", "no route")
    assert transfer.calls == {"download": 3, "upload": 0}


def test_a_missing_file_is_not_retried(tmp_path: Path):
    not_found = httpx.HTTPStatusError("404", request=httpx.Request("GET", "https://x"),
                                      response=httpx.Response(404))
    transfer = FlakyTransfer(failures=1, download_error=not_found)
    assert _run_pipeline(transfer, tmp_path)[0]["status"] == "failed"
    assert transfer.calls["download"] == 1


def test_a_zooniverse_quota_error_is_not_retried(tmp_path: Path):
    from panoptes_client.panoptes import PanoptesAPIException

    transfer = FlakyTransfer(failures=1, upload_error=PanoptesAPIException("Subject limit reached"))
    [event] = _run_pipeline(transfer, tmp_path)
    assert (event["status"], event["step"]) == ("failed", "upload")
    assert transfer.calls["upload"] == 1


class RecordingTransfer:
    """Writes each download to disk, and tracks how many threads are in
    each step — and how many files are on disk — at once."""

    def __init__(self, upload_delay=0.0):
        import threading

        self.lock = threading.Lock()
        self.upload_delay = upload_delay
        self.active = {"download": 0, "upload": 0}
        self.peak = {"download": 0, "upload": 0, "files": 0}
        self.files = 0

    def _enter(self, step):
        with self.lock:
            self.active[step] += 1
            self.peak[step] = max(self.peak[step], self.active[step])

    def _leave(self, step):
        with self.lock:
            self.active[step] -= 1

    def download(self, image, path):
        import time

        self._enter("download")
        time.sleep(0.01)
        path.write_bytes(b"jpeg")
        with self.lock:
            self.files += 1
            self.peak["files"] = max(self.peak["files"], self.files)
        self._leave("download")

    def upload(self, path, metadata):
        import time

        self._enter("upload")
        assert path.read_bytes() == b"jpeg"
        time.sleep(self.upload_delay)
        with self.lock:
            self.files -= 1
        self._leave("upload")
        return f"s{path.name}"

    def close(self):
        pass


def test_downloads_and_uploads_run_on_pools_of_their_own_size(tmp_path: Path):
    transfer = RecordingTransfer(upload_delay=0.02)
    images = [_candidate(i) for i in range(1, 25)]

    events = _run_pipeline(transfer, tmp_path, images, _settings(download_workers=3, upload_workers=2))

    assert [e["status"] for e in events] == ["uploaded"] * 24
    assert transfer.peak["download"] <= 3
    assert transfer.peak["upload"] == 2
    # Downloads outpace uploads here, but never pile up more files than
    # both pools together.
    assert transfer.peak["files"] <= 5
    assert list(tmp_path.iterdir()) == []


def test_a_stopped_pipeline_gives_up_waiting_to_retry(tmp_path: Path):
    import time

    from wildintel_zooniverse.core.services import upload_service

    slow = upload_service.RetryPolicy(attempts=5, min_wait=60, max_wait=60)
    transfer = FlakyTransfer(failures=5)
    pipeline = upload_service._Pipeline(
        transfer, upload_service.TransferSettings(1, slow, 1, slow), tmp_path, "https://t",
    )
    pipeline.submit(_candidate())
    time.sleep(0.1)  # the first attempt failed; it now waits 60 s to retry
    started = time.monotonic()
    pipeline.close()
    assert time.monotonic() - started < 5
    assert transfer.calls["download"] == 1


def test_subject_metadata_is_wildintel_tools_own():
    from wildintel_zooniverse.core.services import upload_service

    metadata = upload_service.subject_metadata("https://trapper.example.org", _candidate())
    assert metadata == {
        "external_id": "https://trapper.example.org/:media:1",
        "preview": "https://trapper.example.org/storage/resource/media/1/pfile/",
        "link": "https://trapper.example.org/storage/resource/media/1/file/",
        "thumbnail": "https://trapper.example.org/storage/resource/media/1/tfile/",
        "origin": "https://trapper.example.org/",
        "license": "http://creativecommons.org/licenses/by-nc/4.0/legalcode",
        "image_name": "1_x_IMG_1.JPG",
    }


def test_images_already_in_the_subject_set_can_be_skipped(fake_trapper, fake_panoptes, fake_zooniverse_upload, monkeypatch):
    from wildintel_zooniverse.core.services import upload_service, zooniverse_service

    monkeypatch.setattr(upload_service, "CHECK_PROGRESS_EVERY", 1)
    monkeypatch.setattr(zooniverse_service, "subject_set_info", lambda u, p, ss_id: (
        {"id": ss_id, "display_name": DESTINATION["subject_set_name"], "subjects_count": 2}
    ))
    # Media 1 is there already — uploaded by wildintel-tools (external_id
    # only) — and so is an unrelated image.
    monkeypatch.setattr(zooniverse_service, "iter_subjects", lambda u, p, ss_id: iter([
        {"id": 501, "url": None, "file_name": "", "metadata": {"external_id": "https://trapper.example.org/:media:1"}},
        {"id": 502, "url": None, "file_name": "", "metadata": {"Filename": "IMG_9.JPG"}},
    ]))

    lines = _ndjson(_client().post("/api/upload/start", json={**BODY, "task_id": _session(), "skip_in_subject_set": True}))

    assert [line for line in lines if line["type"] in ("checking", "checked")] == [
        {"type": "checking", "done": 0, "total": 2},
        {"type": "checking", "done": 1, "total": 2},
        {"type": "checking", "done": 2, "total": 2},
        {"type": "checked", "subjects": 2, "media": 1},
    ]
    assert [(e["media_id"], e["status"], e.get("reason")) for e in _images(lines)] == [
        (1, "skipped", "subject_set"), (2, "uploaded", None),
    ]
    assert len(fake_zooniverse_upload) == 1


def test_the_subject_set_isnt_listed_unless_asked(fake_trapper, fake_panoptes, fake_zooniverse_upload, monkeypatch):
    from wildintel_zooniverse.core.services import zooniverse_service

    def listing(*_):
        raise AssertionError("the subject set was listed")

    monkeypatch.setattr(zooniverse_service, "iter_subjects", listing)
    lines = _ndjson(_client().post("/api/upload/start", json={**BODY, "task_id": _session()}))
    assert lines[-1]["uploaded"] == 2
    assert not [line for line in lines if line["type"] == "checking"]


def _lists(task_id, include=None, exclude=()):
    response = _client().post("/api/sessions/media-lists", json={"task_id": task_id, "include": include, "exclude": list(exclude)})
    assert response.status_code == 200
    return response.json()


def test_a_whitelist_uploads_only_those_images(fake_trapper, fake_panoptes, fake_zooniverse_upload):
    task_id = _session()
    assert _lists(task_id, include=[2, 99])["media_lists"] == {"include": [2, 99], "exclude": []}

    lines = _ndjson(_client().post("/api/upload/start", json={**BODY, "task_id": task_id}))

    deployment = next(line for line in lines if line["type"] == "deployment")
    assert (deployment["selected"], deployment["filtered_out"]) == (1, 1)
    assert [(e["media_id"], e["status"]) for e in _images(lines)] == [(2, "uploaded")]
    assert lines[-1] == {"type": "done", "dry_run": False, "uploaded": 1, "skipped": 0, "failed": 0, "filtered_out": 1}


def test_a_blacklist_never_uploads_those_and_wins_over_the_whitelist(fake_trapper, fake_panoptes, fake_zooniverse_upload):
    task_id = _session()
    _lists(task_id, include=[1, 2], exclude=[2])

    lines = _ndjson(_client().post("/api/upload/dry-run", json={**BODY, "task_id": task_id}))

    assert [e["media_id"] for e in _images(lines)] == [1]
    assert lines[-1]["filtered_out"] == 1


def test_the_lists_stay_in_the_session_and_can_be_cleared():
    from wildintel_zooniverse.core.services import session_store

    task_id = _session()
    _lists(task_id, include=[3, 1, 3], exclude=[5])
    assert session_store.read_manifest(task_id)["media_lists"] == {"include": [1, 3], "exclude": [5]}
    assert session_store.read_manifest(task_id)["phase"] == "destination"
    _lists(task_id)
    assert session_store.read_manifest(task_id)["media_lists"] == {"include": None, "exclude": []}


def test_media_lists_of_an_unknown_session_are_a_404():
    assert _client().post("/api/sessions/media-lists", json={"task_id": "nope"}).status_code == 404
