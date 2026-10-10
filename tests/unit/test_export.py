"""/api/export — Zooniverse (and its export download) and Trapper are faked
(no network)."""
import csv
import io
import json
from datetime import datetime, timezone
from contextlib import contextmanager
from pathlib import Path
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


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def _ndjson(response):
    return [json.loads(line) for line in response.text.splitlines()]


def _annotation(*choices):
    return json.dumps([{"task": "T0", "value": [
        {"choice": c, "answers": {"HOWMANY": n} if n else {}, "filters": {}} for c, n in choices
    ]}])


def _row(cid, sid, subject_meta, *choices, workflow=29186):
    return {
        "classification_id": str(cid), "user_name": f"u{cid}", "user_id": str(cid), "workflow_id": str(workflow),
        "annotations": _annotation(*choices), "subject_data": json.dumps({str(sid): {"retired": None, **subject_meta}}),
        "subject_ids": str(sid),
    }


# 501 (media 1): three volunteers see 2 red deer. 502: media 2, not in the
# Trapper selection. 503: no media id. 504 (media 3): every classification
# empty. 505 (media 4, an old upload: external_id only): a fox.
ROWS = [
    _row(1, 501, {"Filename": "1_x_D_x_IMG_1.JPG"}, ("REDDEER", "2")),
    _row(2, 501, {"Filename": "1_x_D_x_IMG_1.JPG"}, ("REDDEER", "2")),
    _row(3, 501, {"Filename": "1_x_D_x_IMG_1.JPG"}, ("REDDEER", "3")),
    _row(4, 502, {"Filename": "2_x_D_x_IMG_2.JPG"}, ("REDFOX", "1")),
    _row(5, 503, {"Filename": "IMG_0003.JPG"}, ("REDFOX", "1")),
    _row(6, 504, {"Filename": "3_x_D_x_IMG_3.JPG"}),
    _row(7, 505, {"Filename": "IMG_4.JPG", "external_id": f"{TRAPPER}/:media:4"}, ("REDFOX", "1")),
    _row(8, 506, {"Filename": "1_x_D_x_IMG_1.JPG"}, ("REDFOX", "1"), workflow=99),  # another workflow
]


def _export_info(state, updated_at, file_date, url) -> dict:
    return {"state": state, "pending": state not in ("ready", "finished"), "updated_at": updated_at,
            "file_date": file_date, "url": url}


def _export_csv() -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(ROWS[0]))
    writer.writeheader()
    writer.writerows(ROWS)
    return buf.getvalue()


@pytest.fixture
def fake(monkeypatch):
    from wildintel_zooniverse.core.services import classifications_export_service as service
    from wildintel_zooniverse.core.services import zooniverse_service

    state = SimpleNamespace(exports=[_export_info("ready", "2026-09-20T10:00:00Z", "2026-09-20T10:00:00+00:00", "https://zoo/export.csv")],
                            generated=0, downloaded=[])

    def current(u, p, wf, strict=False):
        return state.exports[0] if len(state.exports) == 1 else state.exports.pop(0)

    def generate(u, p, wf):
        state.generated += 1

    @contextmanager
    def stream(method, url, **_):
        state.downloaded.append(url)
        text = _export_csv()
        yield SimpleNamespace(headers={"content-length": str(len(text))}, raise_for_status=lambda: None,
                              iter_lines=lambda: iter(text.splitlines()))

    monkeypatch.setattr(zooniverse_service, "workflow_name", lambda u, p, wf: "Doñana National Park")
    monkeypatch.setattr(zooniverse_service, "classifications_export", current)
    monkeypatch.setattr(zooniverse_service, "generate_classifications_export", generate)
    monkeypatch.setattr(service.httpx, "stream", stream)
    monkeypatch.setattr(service, "EXPORT_POLL_S", 0)

    client = MagicMock()
    client.classification_projects.get_all_project_collections.return_value = SimpleNamespace(results=[
        SimpleNamespace(pk=99, collection_pk=33),
    ])
    # Media 1 has two observations in Trapper; 3 and 4, one each.
    client.classification_results.where_project_results.side_effect = lambda *a, **k: iter([
        SimpleNamespace(mediaID=1, id=10), SimpleNamespace(mediaID=1, id=11),
        SimpleNamespace(mediaID=3, id=30), SimpleNamespace(mediaID=4, id=40),
    ])
    with patch("wildintel_zooniverse.core.services.trapper_service._client", return_value=client):
        state.trapper = client
        yield state


def _export(tmp_path, **body):
    return _ndjson(_client().post("/api/export/classifications", json={
        "username": "bob", "password": "pw", "workflow_id": 29186,
        "trapper": {"username": "alice", "password": "s3cret", "selection": SELECTION},
        "output_dir": str(tmp_path), **body,
    }))


def _read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_writes_the_observations_csv_trapper_imports(fake, tmp_path: Path):
    lines = _export(tmp_path)

    assert lines[0] == {"type": "export", "state": "ready", "updated_at": "2026-09-20T10:00:00+00:00"}
    assert {"type": "classifications_done", "rows": 8, "subjects": 5} in lines
    assert {"type": "deployment", "deployment_id": "R0033-DONA_0001_A", "media": 3, "observations": 4} in lines
    done = lines[-1]
    assert done["type"] == "done"
    assert (done["subjects"], done["exported"], done["observations"], done["rows"]) == (5, 2, 2, 3)
    assert done["trapper_media"] == 3  # the images with observations in the selection
    assert done["skipped"] == {"not_in_trapper": 1, "no_media_id": 1, "no_valid_classifications": 1, "no_decision": 0}
    assert done["samples"] == {"not_in_trapper": [502], "no_media_id": [503], "no_valid_classifications": [504]}
    assert done["trapper_import_url"] == f"{TRAPPER}/media_classification/classification/import/"
    assert fake.generated == 0
    fake.trapper.classification_results.where_project_results.assert_called_once_with(
        10, collection=99, deployment=4, camtrapdp="False", page_size=1000,
    )

    [observations] = done["files"]
    assert Path(observations["path"]).name.startswith("observations_wf29186_cp10_col33_")
    rows = _read(observations["path"])
    assert list(rows[0]) == ["observationType", "scientificName", "count", "classifiedBy", "classificationMethod",
                             "observationComments", "_id"]
    assert [(r["_id"], r["scientificName"], r["count"], r["classifiedBy"]) for r in rows] == [
        ("10", "Cervus elaphus", "2", "zooniverse@wildintel-project.org"),
        ("11", "Cervus elaphus", "2", "zooniverse@wildintel-project.org"),
        ("40", "Vulpes vulpes", "1", "zooniverse@wildintel-project.org"),
    ]
    assert rows[0]["observationComments"] == "Automatically classified by Zooniverse for subject 501 with confidence 1.00"

    zoo = _read(done["zoo_annotations_file"]["path"])
    assert [(r["subject_id"], r["scientific_name"], r["answers"]) for r in zoo][:2] == [
        ("501", "Cervus elaphus", '{"HOWMANY": "2"}'), ("501", "Cervus elaphus", '{"HOWMANY": "2"}'),
    ]


def test_a_new_export_is_made_and_waited_for_when_asked(fake, tmp_path: Path):
    old = _export_info("ready", "2026-09-20T10:00:00Z", "2026-09-20T10:00:00+00:00", "https://zoo/export.csv")
    fake.exports = [
        old, old,
        _export_info("creating", "2026-09-26T08:00:00Z", "2026-09-20T10:00:00+00:00", "https://zoo/export.csv"),
        _export_info("ready", "2026-09-26T09:00:00Z", "2026-09-26T09:00:00+00:00", "https://zoo/new.csv"),
    ]
    lines = _export(tmp_path, regenerate=True, save_zoo_annotations=False, classified_by="me@example.org")

    assert fake.generated == 1
    assert lines[:2] == [
        {"type": "export", "state": "generating", "updated_at": None},
        {"type": "export", "state": "ready", "updated_at": "2026-09-26T09:00:00+00:00"},
    ]
    assert fake.downloaded == ["https://zoo/new.csv"]
    done = lines[-1]
    assert done["zoo_annotations_file"] is None
    assert {r["classifiedBy"] for r in _read(done["files"][0]["path"])} == {"me@example.org"}


def test_an_old_file_is_used_even_if_zooniverse_still_says_creating(fake, tmp_path: Path):
    fake.exports = [_export_info("creating", "2026-10-02T08:48:01Z", "2026-10-02T07:57:08+00:00", "https://zoo/old.csv")]
    lines = _export(tmp_path)

    assert fake.generated == 0
    assert lines[0] == {"type": "export", "state": "ready", "updated_at": "2026-10-02T07:57:08+00:00"}
    assert fake.downloaded == ["https://zoo/old.csv"]


def test_a_request_made_today_is_waited_for_not_repeated(fake, tmp_path: Path):
    now = datetime.now(timezone.utc).isoformat()
    fake.exports = [
        _export_info("creating", now, None, None),
        _export_info("ready", now, now, "https://zoo/new.csv"),
    ]
    lines = _export(tmp_path)

    assert fake.generated == 0
    assert lines[:2] == [
        {"type": "export", "state": "generating", "updated_at": None},
        {"type": "export", "state": "ready", "updated_at": now},
    ]


def test_a_request_that_never_finished_is_made_again(fake, tmp_path: Path):
    fake.exports = [
        _export_info("creating", "2026-10-02T08:48:01Z", None, None),
        _export_info("ready", "2026-10-09T09:00:00Z", "2026-10-09T09:00:00+00:00", "https://zoo/new.csv"),
    ]
    lines = _export(tmp_path)

    assert fake.generated == 1
    assert fake.downloaded == ["https://zoo/new.csv"]
    assert lines[1] == {"type": "export", "state": "ready", "updated_at": "2026-10-09T09:00:00+00:00"}


def test_a_workflow_it_cant_vote_is_a_400(fake, tmp_path: Path):
    lines = _client().post("/api/export/classifications", json={
        "username": "bob", "password": "pw", "workflow_id": 12345,
        "trapper": {"username": "alice", "password": "s3cret", "selection": SELECTION}, "output_dir": str(tmp_path),
    })
    assert lines.status_code == 400
    assert "12345" in lines.json()["detail"]


def test_big_csvs_are_split(tmp_path: Path):
    from wildintel_zooniverse.core.services import classifications_export_service as service

    rows = [{"a": "x" * 100, "b": i} for i in range(100)]
    files = service.write_csv(rows, tmp_path / "obs.csv", ["a", "b"], max_size_mb=0.002)  # ~2 KB

    assert len(files) > 1
    assert [Path(f["path"]).name for f in files][:2] == ["obs_part001.csv", "obs_part002.csv"]
    assert sum(f["rows"] for f in files) == 100
    assert all(f["bytes"] <= 2200 for f in files)


@pytest.mark.parametrize(("value", "expected"), [
    ("123", [123]), ("123,456", [123, 456]), ("[123, 456]", [123, 456]), ("['7']", [7]), ("", []), (None, []),
])
def test_subject_ids_are_parsed_as_wildintel_tools_does(value, expected):
    from wildintel_zooniverse.core.services import classifications_export_service as service

    assert service.parse_subject_ids(value) == expected


def test_workflows_say_which_can_be_exported(monkeypatch):
    from wildintel_zooniverse.core.services import zooniverse_service

    monkeypatch.setattr(zooniverse_service, "list_workflows", lambda u, p, pid: [
        {"id": 29186, "display_name": "Doñana", "active": True}, {"id": 5, "display_name": "Other", "active": False},
    ])
    results = _client().post("/api/zooniverse/workflows", json={"username": "bob", "password": "pw", "project_id": 1}).json()
    assert [(w["id"], w["exportable"]) for w in results["results"]] == [(29186, True), (5, False)]


def test_the_export_folder_is_the_settings_when_it_has_one(tmp_path: Path, monkeypatch):
    from wildintel_zooniverse.core import config
    from wildintel_zooniverse.core.services import classifications_export_service as service

    assert service.default_output_dir() == config.get_app_documents_dir() / "exports"

    settings = config.load_settings()
    settings.ZOONIVERSE.export_output_dir = str(tmp_path / "mine")
    monkeypatch.setattr(config, "load_settings", lambda: settings)
    assert service.default_output_dir() == tmp_path / "mine"


def test_the_export_folder_can_be_opened(tmp_path: Path, monkeypatch):
    from wildintel_zooniverse.core.services import classifications_export_service as service
    from wildintel_zooniverse.web.api.routers import export as router

    opened = []
    monkeypatch.setattr(service, "default_output_dir", lambda: tmp_path)
    monkeypatch.setattr(router, "open_folder", opened.append)

    response = _client().post("/api/export/open-folder")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "path": str(tmp_path)}
    assert opened == [tmp_path]


def test_a_missing_export_folder_is_reported(tmp_path: Path, monkeypatch):
    from wildintel_zooniverse.core.services import classifications_export_service as service

    monkeypatch.setattr(service, "default_output_dir", lambda: tmp_path / "nope")
    response = _client().post("/api/export/open-folder")

    assert response.status_code == 500
    assert "nope" in response.json()["detail"]


def test_every_export_writes_into_a_folder_of_its_own(fake, tmp_path: Path):
    done = _export(tmp_path)[-1]

    run_dir = Path(done["run_dir"])
    assert run_dir.parent == tmp_path
    assert run_dir.name.startswith("wf29186_cp10_col33_")
    assert done["output_dir"] == str(tmp_path)
    assert {Path(f["path"]).parent for f in done["files"]} == {run_dir}
    assert Path(done["zoo_annotations_file"]["path"]).parent == run_dir
    # Zooniverse's own CSV only when asked.
    assert done["raw_export_file"] is None
    assert sorted(p.name for p in run_dir.iterdir() if p.name.startswith("zooniverse_classifications")) == []


def test_zooniverses_own_csv_can_be_kept_too(fake, tmp_path: Path):
    done = _export(tmp_path, save_raw_export=True)[-1]

    raw = Path(done["raw_export_file"]["path"])
    assert raw.parent == Path(done["run_dir"])
    assert raw.name.startswith("zooniverse_classifications_wf29186_")
    assert _read(raw) == ROWS  # the export as it came
    assert done["raw_export_file"]["bytes"] == raw.stat().st_size


def test_a_half_downloaded_raw_csv_is_not_kept(fake, tmp_path: Path, monkeypatch):
    from wildintel_zooniverse.core.services import classifications_export_service as service

    def failing(method, url, **_):
        @contextmanager
        def stream():
            def lines():
                yield "classification_id,user_name"
                raise OSError("connection lost")
            yield SimpleNamespace(headers={}, raise_for_status=lambda: None, iter_lines=lines)
        return stream()

    monkeypatch.setattr(service.httpx, "stream", failing)
    lines = _export(tmp_path, save_raw_export=True)

    assert lines[-1]["type"] == "error"
    assert list(tmp_path.iterdir()) == []  # no folder, no partial file


def test_only_the_export_folder_and_what_is_in_it_can_be_opened(tmp_path: Path, monkeypatch):
    from wildintel_zooniverse.core.services import classifications_export_service as service
    from wildintel_zooniverse.web.api.routers import export as router

    opened = []
    mine = tmp_path / "wf1_cp2_col3_x"
    mine.mkdir()
    monkeypatch.setattr(service, "default_output_dir", lambda: tmp_path)
    monkeypatch.setattr(router, "open_folder", opened.append)

    assert _client().post("/api/export/open-folder", json={"path": str(mine)}).status_code == 200
    assert opened == [mine.resolve()]
    outside = _client().post("/api/export/open-folder", json={"path": str(tmp_path.parent)})
    assert outside.status_code == 400
    assert opened == [mine.resolve()]
