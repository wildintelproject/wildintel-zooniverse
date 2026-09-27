"""The command-line app — the core's services are faked (no network): these
check the commands turn their options into the same calls the web app
makes, and render what comes back."""
import json
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from wildintel_zooniverse.cli.app import app
from wildintel_zooniverse.core import config
from wildintel_zooniverse.core.schemas.requests import TrapperSelection
from wildintel_zooniverse.core.services import (
    session_store, subject_download_service, trapper_service, upload_service, validation_service, zooniverse_service,
)

runner = CliRunner()

RESEARCH_PROJECTS = [{"pk": 2, "name": "Doñana", "acronym": "DON"}]
CLASSIFICATION_PROJECTS = [{"pk": 10, "name": "Main CP", "is_active": True}]
COLLECTIONS = [{"pk": 33, "name": "R0033", "status": "ok", "total_count": 3, "classified_count": 3, "approved_count": 0}]
DEPLOYMENTS = [
    {"pk": 4, "deployment_id": "R0033-DONA_0001_A", "location_id": "L1", "image_count": 2, "start_date": None, "end_date": None},
    {"pk": 5, "deployment_id": "R0033-DONA_0002_A", "location_id": "L2", "image_count": 1, "start_date": None, "end_date": None},
]
SELECTION = ["33", "--rp", "2", "--cp", "10"]


@pytest.fixture(autouse=True)
def accounts():
    settings = config.Settings()
    settings.TRAPPER.base_url, settings.TRAPPER.user_name, settings.TRAPPER.user_password = "https://trapper.example.org/", "alice", "s3cret"
    settings.ZOONIVERSE.user_name, settings.ZOONIVERSE.user_password = "bob", "pw"
    config.save_settings(settings)
    yield
    config.save_settings(config.Settings())


@pytest.fixture
def fake_trapper():
    with patch.object(trapper_service, "list_research_projects", return_value=RESEARCH_PROJECTS), \
         patch.object(trapper_service, "list_classification_projects", return_value=CLASSIFICATION_PROJECTS), \
         patch.object(trapper_service, "list_collections", return_value=COLLECTIONS), \
         patch.object(trapper_service, "list_deployments", return_value=DEPLOYMENTS):
        yield


def _summary(deployment_id, selected, detail=None):
    summary = {"deployment_id": deployment_id, "images": selected + 1, "candidates": selected, "sequences": 1,
               "removed_middle": 0, "selected": selected}
    return {**summary, "sequence_detail": detail} if detail is not None else summary


# ── Basics ────────────────────────────────────────────────────────────────────

def test_version():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.output.strip()


def test_config_set_validates_and_hides_passwords():
    assert runner.invoke(app, ["config", "set", "SEQUENCES.max_interval", "120"]).exit_code == 0
    assert config.load_settings().SEQUENCES.max_interval == 120
    assert runner.invoke(app, ["config", "set", "SEQUENCES.max_interval", "zero"]).exit_code == 1
    assert runner.invoke(app, ["config", "set", "NOPE.field", "1"]).exit_code == 1

    shown = runner.invoke(app, ["config", "show"]).output
    assert "s3cret" not in shown
    assert "(saved)" in shown


def test_missing_credentials_say_how_to_set_them():
    config.save_settings(config.Settings())
    result = runner.invoke(app, ["trapper", "research-projects"])
    assert result.exit_code == 1
    assert "config set TRAPPER" in " ".join(result.output.split())


def test_service_errors_are_a_message_not_a_traceback(fake_trapper):
    with patch.object(trapper_service, "list_research_projects", side_effect=RuntimeError("Trapper is down")):
        result = runner.invoke(app, ["trapper", "research-projects"])
    assert result.exit_code == 1
    assert "Trapper is down" in result.output
    assert "Traceback" not in result.output


# ── The selection ─────────────────────────────────────────────────────────────

def test_estimate_upload_resolves_the_selection_and_the_settings_criteria(fake_trapper):
    calls = {}

    def preview(url, user, password, selection, criteria, *, detail):
        calls.update(selection=selection, criteria=criteria, detail=detail)
        return iter([_summary(d.deployment_id, 2) for d in selection.deployments])

    with patch.object(trapper_service, "preview_stream", side_effect=preview):
        result = runner.invoke(app, ["estimate-upload", *SELECTION, "--ed", "R0033-DONA_0002_A", "--n-images-seq", "3"])
    assert result.exit_code == 0, result.output
    selection: TrapperSelection = calls["selection"]
    assert [d.pk for d in selection.deployments] == [4]
    assert selection.all_deployments is False
    assert calls["criteria"].images_per_sequence == 3
    assert calls["criteria"].max_interval == config.load_settings().SEQUENCES.max_interval
    assert calls["detail"] is False
    assert "R0033-DONA_0001_A" in result.output


def test_an_unknown_deployment_is_an_error(fake_trapper):
    result = runner.invoke(app, ["estimate-upload", *SELECTION, "--d", "R9999"])
    assert result.exit_code == 1
    assert "R9999" in result.output


def test_analyze_sequences_writes_the_csv(fake_trapper, tmp_path):
    sequence = {"number": 1, "start": "2024-09-04T12:00:00", "end": "2024-09-04T12:01:00", "duration_s": 60, "images": 3,
                "uploaded": [1, 2], "not_sampled": [3], "removed_human": [], "removed_vehicle": []}
    out = tmp_path / "seq.csv"
    with patch.object(trapper_service, "preview_stream", return_value=iter([_summary("R0033-DONA_0001_A", 2, [sequence])])):
        result = runner.invoke(app, ["analyze-sequences", *SELECTION, "--d", "4", "-o", str(out)])
    assert result.exit_code == 0, result.output
    lines = out.read_text().splitlines()
    assert lines[0].startswith("deploymentID,sequence_n")
    assert lines[1] == "R0033-DONA_0001_A,1,3,1|2,2024-09-04T12:00:00,2024-09-04T12:01:00,60,3,,"


# ── import ────────────────────────────────────────────────────────────────────

def _upload_events(dry_run, failed=0):
    yield {"type": "start", "dry_run": dry_run, "subject_set": {"name": "SS", "id": None, "exists": False}}
    yield {"type": "fetching", "deployment_id": "R0033-DONA_0001_A"}
    yield {"type": "deployment", **_summary("R0033-DONA_0001_A", 1), "filtered_out": 1}
    yield {"type": "step", "step": "download", "deployment_id": "R0033-DONA_0001_A", "media_id": 1, "file_name": "a.jpg"}
    yield {"type": "image", "deployment_id": "R0033-DONA_0001_A", "media_id": 1, "file_name": "a.jpg",
           "status": "failed" if failed else "uploaded", "step": "upload", "detail": "boom" if failed else None}
    yield {"type": "done", "dry_run": dry_run, "uploaded": 1 - failed, "skipped": 0, "failed": failed, "filtered_out": 1}


def test_import_creates_a_session_with_the_media_lists(fake_trapper, tmp_path):
    whitelist = tmp_path / "ids.txt"
    whitelist.write_text("1\n2\nnot-an-id\n")
    runs = []

    def run_stream(run, trapper, zoo, *, dry_run, skip_in_subject_set):
        runs.append((run, trapper, zoo, dry_run, skip_in_subject_set))
        return _upload_events(dry_run)

    projects = [{"id": 30567, "display_name": "European", "slug": "wildintel/european"}]
    with patch.object(zooniverse_service, "list_projects", return_value=projects), \
         patch.object(upload_service, "run_stream", side_effect=run_stream):
        result = runner.invoke(app, ["import", *SELECTION, "--d", "4", "--project", "30567", "--m", f"@{whitelist}",
                                     "--em", "2", "--dry-run"])
    assert result.exit_code == 0, result.output
    run, trapper, zoo, dry_run, skip = runs[0]
    assert dry_run is True and skip is False
    assert trapper == ("https://trapper.example.org/", "alice", "s3cret") and zoo == ("bob", "pw")
    assert run.destination.subject_set_name.startswith("Doñana_2_R0033_33_")
    assert run.media_lists.include == {1, 2} and run.media_lists.exclude == {2}
    assert session_store.read_manifest(run.task_id)["destination"]["project"]["id"] == 30567
    assert "1 value(s) that aren't ids" in result.output
    assert "would be uploaded" in result.output


def test_import_needs_confirmation_and_offers_to_resume(fake_trapper):
    projects = [{"id": 30567, "display_name": "European", "slug": "wildintel/european"}]
    with patch.object(zooniverse_service, "list_projects", return_value=projects), \
         patch.object(upload_service, "run_stream", side_effect=lambda *a, **k: _upload_events(False, failed=1)) as stream:
        declined = runner.invoke(app, ["import", *SELECTION, "--project", "30567", "--subject-set", "Mine"], input="n\n")
        assert declined.exit_code == 0 and not stream.called

        result = runner.invoke(app, ["import", *SELECTION, "--project", "30567", "--subject-set", "Mine", "--yes"])
    assert result.exit_code == 0, result.output
    assert stream.call_args.args[0].destination.subject_set_name == "Mine"
    assert "boom" in result.output
    assert "--resume" in result.output


def test_import_resumes_a_session():
    task_id = session_store.new_task_id()
    selection = {"url": "https://other-trapper.example.org/", "research_project": {"pk": 2, "name": "D"},
                 "classification_project": {"pk": 10, "name": "C"}, "collection": {"pk": 33, "name": "R0033"},
                 "deployments": [{"pk": 4, "deployment_id": "R0033-DONA_0001_A"}], "all_deployments": True}
    session_store.write_selection_phase(task_id, task="upload", source_type="trapper", selection=selection)
    session_store.write_destination_phase(task_id, destination={
        "project": {"id": 1, "name": "P", "slug": "p"}, "subject_set_name": "SS"})
    with patch.object(upload_service, "run_stream", side_effect=lambda *a, **k: _upload_events(False)) as stream:
        result = runner.invoke(app, ["import", "--resume", task_id, "--yes"])
    assert result.exit_code == 0, result.output
    run, trapper = stream.call_args.args[:2]
    assert run.task_id == task_id
    # The session's own Trapper server.
    assert trapper[0] == "https://other-trapper.example.org/"

    assert runner.invoke(app, ["import", "--resume", "nope"]).exit_code == 1


# ── Utils ─────────────────────────────────────────────────────────────────────

def test_download_ss_passes_the_subject_lists(tmp_path):
    def download(zoo, ids, folder, *, overwrite, subjects):
        assert ids == [5, 6] and folder == tmp_path and overwrite is True
        assert subjects.include == {1} and subjects.exclude == {9}
        yield {"type": "subject_set", "id": 5, "name": "SS", "total": 1, "folder": str(tmp_path / "5")}
        yield {"type": "subject", "subject_set_id": 5, "subject_id": 1, "file_name": "a.jpg", "status": "downloaded"}
        yield {"type": "done", "downloaded": 1, "existing": 0, "failed": 0, "filtered_out": 0, "output_dir": str(tmp_path)}

    with patch.object(subject_download_service, "download_stream", side_effect=download):
        result = runner.invoke(app, ["download_ss", "5,6", "-o", str(tmp_path), "--overwrite", "--wl", "1", "--bl", "9"])
    assert result.exit_code == 0, result.output
    assert "1 downloaded" in result.output


def test_update_metadata_asks_unless_dry_run(fake_trapper):
    events = [
        {"type": "subjects", "id": 5, "name": "SS", "total": 1},
        {"type": "subject", "subject_id": 1, "media_id": 7, "status": "would_update",
         "changes": [{"field": "#fileName", "old": None, "new": "a.jpg"}]},
        {"type": "done"},
    ]
    with patch("wildintel_zooniverse.core.services.metadata_service.update_stream", return_value=iter(events)) as stream:
        declined = runner.invoke(app, ["update-metadata", "5", "--rp", "2", "--cp", "10", "-c", "33"], input="n\n")
        assert declined.exit_code == 0 and not stream.called
        result = runner.invoke(app, ["update-metadata", "5", "--rp", "2", "--cp", "10", "-c", "33", "--dry-run"])
    assert result.exit_code == 0, result.output
    assert stream.call_args.kwargs["dry_run"] is True
    assert "#fileName" in result.output and "1 would update" in result.output


def _report(**extra):
    return {"type": "report", "subject_set": {"id": 5, "name": "SS"}, "subjects": 3, "media": 2,
            "uploaded": [{"media_id": 1, "subject_ids": [10, 11]}, {"media_id": 2, "subject_ids": [12]}],
            "duplicated": [{"media_id": 1, "subject_ids": [10, 11]}], "unmatched": [], "metadata_issues": [],
            "compared": False, **extra}


def test_check_duplicated_media_writes_its_report(tmp_path):
    out = tmp_path / "dup.json"
    with patch.object(validation_service, "validate_stream", return_value=iter([_report(), {"type": "done"}])) as stream:
        result = runner.invoke(app, ["check-duplicated-media", "5", "-o", str(out)])
    assert result.exit_code == 0, result.output
    assert stream.call_args.args[2] is None
    assert json.loads(out.read_text())["duplicated"] == [{"media_id": 1, "subject_ids": [10, 11]}]


def test_check_missing_media_report_is_a_media_list(fake_trapper, tmp_path):
    missing = [{"media_id": 3, "deployment_id": "R0033-DONA_0001_A", "file_name": "c.jpg"}]
    report = _report(compared=True, expected=3, missing=missing, extra=[],
                     deployments=[{"deployment_id": "R0033-DONA_0001_A", "expected": 3, "uploaded": 2, "missing": 1}])
    out = tmp_path / "missing.json"
    with patch.object(validation_service, "validate_stream", return_value=iter([report, {"type": "done"}])) as stream:
        result = runner.invoke(app, ["check-missing-media", "5", "--rp", "2", "--cp", "10", "-c", "33", "-o", str(out)])
    assert result.exit_code == 0, result.output
    assert stream.call_args.args[2].selection.collection.pk == 33

    from wildintel_zooniverse.core.id_parsing import parse_ids
    # What import --media @FILE reads.
    assert parse_ids(out.read_text(), "media") == ([3], 0)
