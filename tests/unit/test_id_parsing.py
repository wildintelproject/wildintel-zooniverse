"""core.id_parsing — the same rules as the frontend's mediaIds.ts."""
import json

from wildintel_zooniverse.core.id_parsing import parse_ids


def test_a_plain_list_however_separated():
    assert parse_ids("12\n7, 9 ;12|3\n\nabc", "media") == ([3, 7, 9, 12], 1)


def test_a_csv_id_column_also_pipe_separated():
    csv = "deploymentID,sequence_n,media_ids,duration_s\nR1-A,1,10|11,40\nR1-A,2,12,5\n"
    assert parse_ids(csv, "media") == ([10, 11, 12], 0)
    assert parse_ids("subject_id,media\n501,1\n502,2\n", "subject")[0] == [501, 502]


def test_json_lists_and_the_apps_reports():
    assert parse_ids('[3, "4", {"media_id": 5}]', "media")[0] == [3, 4, 5]
    report = json.dumps({"missing": [{"media_id": 8}, {"media_id": 2}], "metadata_issues": [{"subject_id": 9}]})
    assert parse_ids(report, "media")[0] == [2, 8]
    assert parse_ids(report, "subject")[0] == [9]
    assert parse_ids(json.dumps({"subjects": [{"subject_id": 12}]}), "subject")[0] == [12]
    assert parse_ids('[{"subject_ids": [3, 4]}]', "subject")[0] == [3, 4]


def test_nothing():
    assert parse_ids("  ", "media") == ([], 0)
