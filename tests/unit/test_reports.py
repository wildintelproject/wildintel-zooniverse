"""The reports: what a Recorder makes of a run's events, and the /api/reports router."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from wildintel_zooniverse.core.services import report_service
from wildintel_zooniverse.core.services.report_service import Recorder, ReportError


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


def test_a_stopped_run_is_saved_as_stopped():
    rec = Recorder("download_subject_sets", {"subject_set_ids": [1]})
    rec.feed({"type": "subject_set", "id": 1, "name": "Kittehs", "total": 3, "folder": "/dl"})
    rec.feed({"type": "subject", "subject_set_id": 1, "subject_id": 7, "file_name": "7.jpg", "status": "failed", "detail": "reset"})
    report = read(rec.save())
    assert report["status"] == "stopped"
    assert report["title"] == "Download of subject sets — Kittehs"
    assert report["entries"] == [{"subject_set_id": 1, "subject_id": 7, "file_name": "7.jpg", "detail": "reset"}]
    assert report["totals"]["failed"] == 1


def test_a_failed_run_keeps_what_it_did_and_the_error():
    rec = Recorder("update_metadata", {"dry_run": False})
    rec.feed({"type": "subjects", "id": 8, "name": "Set", "total": 2})
    rec.feed({"type": "subject", "subject_id": 1, "media_id": 5, "status": "updated", "changes": [{"field": "a", "old": "x", "new": "y"}]})
    rec.fail("Zooniverse went away")
    report = read(rec.save())
    assert (report["status"], report["error"]) == ("error", "Zooniverse went away")
    assert report["totals"]["updated"] == 1 and report["title"].startswith("Update of metadata")


def test_a_run_that_never_started_leaves_nothing():
    assert Recorder("validation", {}).save() is None
    assert report_service.list_reports() == []


def test_validation_findings_become_entries():
    rec = Recorder("validation", {"subject_set_id": 8})
    rec.feed({
        "type": "report", "subject_set": {"id": 8, "name": "Set"}, "subjects": 4, "media": 3, "uploaded": [],
        "duplicated": [{"media_id": 5, "subject_ids": [1, 2]}], "unmatched": [3],
        "metadata_issues": [{"subject_id": 4, "media_id": 6, "issues": ["missing fields: a", "b: expected"]}],
        "compared": True, "expected": 4, "missing": [{"media_id": 9, "deployment_id": "D", "file_name": "9.jpg"}],
        "extra": [{"media_id": 5, "subject_ids": [1, 2]}], "deployments": [],
    })
    rec.feed({"type": "done"})
    report = read(rec.save())
    assert report["status"] == "done" and report["title"] == "Validation against Trapper — Set"
    assert report["totals"] == {"subjects": 4, "media": 3, "duplicated": 1, "unmatched": 1, "metadata_issues": 1,
                                "expected": 4, "missing": 1, "extra": 1}
    assert {e["issue"] for e in report["entries"]} == {
        "duplicated image", "no Trapper media id", "metadata", "missing from the subject set", "not in the Trapper selection"}
    assert "1 2" in report_service.to_csv(report)


def test_entries_are_capped_but_counted(monkeypatch):
    monkeypatch.setattr(report_service, "MAX_ENTRIES", 2)
    rec = Recorder("download_subject_sets", {})
    for i in range(5):
        rec.feed({"type": "subject", "subject_set_id": 1, "subject_id": i, "status": "failed"})
    report = read(rec.save())
    assert len(report["entries"]) == 2 and report["entries_total"] == 5


def read(report_id):
    return report_service.read(report_id)


def test_the_router_lists_reads_downloads_and_deletes():
    rec = Recorder("download_subject_sets", {})
    rec.feed({"type": "done", "downloaded": 1, "existing": 0, "failed": 0, "filtered_out": 0, "output_dir": "/dl"})
    report_id = rec.save()
    client = _client()

    assert [r["id"] for r in client.get("/api/reports").json()] == [report_id]
    assert "entries" not in client.get("/api/reports").json()[0]
    assert client.get(f"/api/reports/{report_id}").json()["outputs"] == {"folder": "/dl"}
    json_file = client.get(f"/api/reports/{report_id}/download")
    assert json_file.headers["content-disposition"] == f'attachment; filename="{report_id}.json"'
    assert client.get(f"/api/reports/{report_id}/download?format=xml").status_code == 400
    assert client.get("/api/reports/not-a-report").status_code == 404
    assert client.delete(f"/api/reports/{report_id}").status_code == 200
    assert client.delete(f"/api/reports/{report_id}").status_code == 404


def test_old_reports_can_be_deleted():
    old = {"kind": "validation", "title": "Old", "created_at": (datetime.now(timezone.utc) - timedelta(days=90)).isoformat(),
           "parameters": {}, "totals": {}, "outputs": {}, "entries": [], "entries_total": 0}
    report_service.save(old)
    Recorder("validation", {}).feed({"type": "done"})
    new = Recorder("validation", {})
    new.feed({"type": "done"})
    new.save()
    assert _client().delete("/api/reports?older_than_days=60").json() == {"deleted": 1}
    assert len(report_service.list_reports()) == 1


def test_a_report_that_isnt_one_is_refused():
    with pytest.raises(ReportError):
        report_service.read("../../etc/passwd")
