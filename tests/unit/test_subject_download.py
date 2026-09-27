"""/api/zooniverse/download-subject-sets — Zooniverse and the image
downloads themselves are faked (no network)."""
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

CREDS = {"username": "alice", "password": "s3cret"}

SUBJECT_SETS = {
    8: {"id": 8, "display_name": "Doñana R0033 / 2026-09", "subjects_count": 2},
    9: {"id": 9, "display_name": "Kittehs", "subjects_count": 1},
}
SUBJECTS = {
    8: [{"id": 101, "url": "https://panoptes/101.jpeg", "file_name": "101_1_x_D_x_IMG_1.JPG"},
        {"id": 102, "url": "https://panoptes/102.jpeg", "file_name": "102_2_x_D_x_IMG_2.JPG"}],
    9: [{"id": 201, "url": "https://panoptes/201.jpeg", "file_name": "201_cat.jpg"}],
}


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _ndjson(response):
    return [json.loads(line) for line in response.text.splitlines()]


@pytest.fixture
def fake_zooniverse(monkeypatch):
    """Subject sets and their subjects from the tables above; each download
    writes the URL's bytes — or fails, for URLs listed in `failing`."""
    from panoptes_client.panoptes import PanoptesAPIException

    from wildintel_zooniverse.core.services import subject_download_service, zooniverse_service

    failing: dict[str, Exception] = {}
    fetched = []

    def info(username, password, ss_id):
        if ss_id not in SUBJECT_SETS:
            raise PanoptesAPIException(f"Could not find subject_set with id='{ss_id}'")
        return SUBJECT_SETS[ss_id]

    def fetch(self, url, part):
        fetched.append(url)
        if url in failing:
            part.write_bytes(b"trunc")
            raise failing[url]
        part.write_bytes(url.encode())

    monkeypatch.setattr(zooniverse_service, "subject_set_info", info)
    monkeypatch.setattr(zooniverse_service, "iter_subjects", lambda u, p, ss_id: iter(SUBJECTS[ss_id]))
    monkeypatch.setattr(subject_download_service._Downloader, "_fetch", fetch)
    monkeypatch.setattr(subject_download_service.DownloadSettings, "from_config", classmethod(
        lambda cls: cls(workers=2, retry=subject_download_service.RetryPolicy(attempts=2, min_wait=0, max_wait=0)),
    ))
    return type("Fake", (), {"failing": failing, "fetched": fetched})


def _download(tmp_path, **body):
    return _ndjson(_client().post("/api/zooniverse/download-subject-sets", json={
        **CREDS, "subject_set_ids": [8, 9], "output_dir": str(tmp_path), **body,
    }))


def test_each_subject_set_goes_into_a_folder_of_its_own(fake_zooniverse, tmp_path: Path):
    lines = _download(tmp_path)

    sets = [line for line in lines if line["type"] == "subject_set"]
    assert sets == [
        {"type": "subject_set", "id": 8, "name": "Doñana R0033 / 2026-09", "total": 2,
         "folder": str(tmp_path / "8_Doñana_R0033_2026-09")},
        {"type": "subject_set", "id": 9, "name": "Kittehs", "total": 1, "folder": str(tmp_path / "9_Kittehs")},
    ]
    done = [(e["subject_set_id"], e["subject_id"], e["status"]) for e in lines if e["type"] == "subject"]
    assert sorted(done) == [(8, 101, "downloaded"), (8, 102, "downloaded"), (9, 201, "downloaded")]
    # Every subject of a set is done before the next set starts.
    assert lines.index(sets[1]) > max(i for i, e in enumerate(lines) if e.get("subject_set_id") == 8)
    assert lines[-1] == {"type": "done", "downloaded": 3, "existing": 0, "failed": 0, "filtered_out": 0, "output_dir": str(tmp_path)}
    assert (tmp_path / "8_Doñana_R0033_2026-09" / "101_1_x_D_x_IMG_1.JPG").read_bytes() == b"https://panoptes/101.jpeg"
    assert sorted(p.name for p in (tmp_path / "9_Kittehs").iterdir()) == ["201_cat.jpg"]


def test_each_download_says_when_it_starts(fake_zooniverse, tmp_path: Path):
    lines = _download(tmp_path, subject_set_ids=[9])
    assert [(e["type"], e.get("status")) for e in lines if e.get("subject_id") == 201] == [
        ("step", None), ("subject", "downloaded"),
    ]


def test_images_already_there_are_skipped_unless_overwriting(fake_zooniverse, tmp_path: Path):
    folder = tmp_path / "9_Kittehs"
    folder.mkdir()
    (folder / "201_cat.jpg").write_bytes(b"old")

    lines = _download(tmp_path, subject_set_ids=[9])
    assert lines[-1]["existing"] == 1
    assert (folder / "201_cat.jpg").read_bytes() == b"old"
    assert fake_zooniverse.fetched == []

    lines = _download(tmp_path, subject_set_ids=[9], overwrite=True)
    assert lines[-1]["downloaded"] == 1
    assert (folder / "201_cat.jpg").read_bytes() == b"https://panoptes/201.jpeg"


def test_a_failed_download_leaves_no_partial_file(fake_zooniverse, tmp_path: Path):
    fake_zooniverse.failing["https://panoptes/102.jpeg"] = httpx.ConnectError("reset")

    lines = _download(tmp_path, subject_set_ids=[8])

    failed = [e for e in lines if e.get("status") == "failed"]
    assert [(e["subject_id"], e["detail"]) for e in failed] == [(102, "reset")]
    assert fake_zooniverse.fetched.count("https://panoptes/102.jpeg") == 2  # retried
    assert sorted(p.name for p in (tmp_path / "8_Doñana_R0033_2026-09").iterdir()) == ["101_1_x_D_x_IMG_1.JPG"]
    assert lines[-1]["failed"] == 1


def test_an_unknown_subject_set_is_an_error_before_anything_downloads(fake_zooniverse, tmp_path: Path):
    response = _client().post("/api/zooniverse/download-subject-sets", json={
        **CREDS, "subject_set_ids": [8, 77], "output_dir": str(tmp_path),
    })
    assert response.status_code == 400
    assert "77" in response.json()["detail"]
    assert fake_zooniverse.fetched == []


def test_the_default_folder_is_the_apps_own():
    from wildintel_zooniverse.core import config

    response = _client().get("/api/zooniverse/download-defaults").json()
    assert response == {"output_dir": str(config.get_app_documents_dir() / "downloads")}


@pytest.mark.parametrize(("metadata", "url", "expected"), [
    ({"Filename": "1_x_D_x_IMG_1.JPG"}, "https://p/a.jpeg", "5_1_x_D_x_IMG_1.JPG"),
    ({"filename": "sub/dir/cat.jpg"}, "https://p/a.jpeg", "5_cat.jpg"),
    ({}, "https://panoptes-uploads.zooniverse.org/subject_location/abc.jpeg", "5_abc.jpeg"),
])
def test_file_names_are_wildintel_tools_own(metadata, url, expected):
    from wildintel_zooniverse.core.services import zooniverse_service

    assert zooniverse_service.subject_file_name(5, metadata, url) == expected


def test_subjects_are_listed_100_a_page_with_their_image_and_file_name():
    from types import SimpleNamespace
    from unittest.mock import patch

    from wildintel_zooniverse.core.services import zooniverse_service

    zooniverse_service._clients.clear()
    subjects = [
        SimpleNamespace(id="101", locations=[{"image/jpeg": "https://p/101.jpeg"}], metadata={"Filename": "IMG_1.JPG"}),
        SimpleNamespace(id="102", locations=[], metadata={}),
    ]
    with patch.object(zooniverse_service, "Panoptes"), patch.object(zooniverse_service, "Subject") as subject:
        subject.where.return_value = iter(subjects)
        listed = list(zooniverse_service.iter_subjects("alice", "s3cret", 8))
    zooniverse_service._clients.clear()

    subject.where.assert_called_once_with(subject_set_id=8, page_size=100)
    assert listed == [
        {"id": 101, "url": "https://p/101.jpeg", "file_name": "101_IMG_1.JPG", "metadata": {"Filename": "IMG_1.JPG"}},
        {"id": 102, "url": None, "file_name": "102_image", "metadata": {}},
    ]


def test_subject_lists_choose_which_subjects_are_downloaded(fake_zooniverse, tmp_path: Path):
    # Only 101 and 201 — but never 201.
    lines = _download(tmp_path, include_subjects=[101, 201], exclude_subjects=[201])

    statuses = sorted((e["subject_id"], e["status"]) for e in lines if e["type"] == "subject")
    assert statuses == [(101, "downloaded"), (102, "filtered_out"), (201, "filtered_out")]
    assert fake_zooniverse.fetched == ["https://panoptes/101.jpeg"]
    assert (lines[-1]["downloaded"], lines[-1]["filtered_out"]) == (1, 2)
