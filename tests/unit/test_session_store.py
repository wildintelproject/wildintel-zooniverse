"""services.session_store — the deployment cache (see trapper_service's own
tests for the /api/trapper/upload-preview integration)."""
from wildintel_zooniverse.core.services import session_store


def test_deployment_cache_round_trips():
    task_id = session_store.new_task_id()
    assert session_store.read_deployment_cache(task_id, 4) is None

    images = [{"media_id": 1, "deployment_id": "D1", "timestamp": "2024-09-04T12:00:00",
              "public": True, "observation_types": ["animal"], "file_url": None, "file_name": "IMG_1.JPG"}]
    session_store.write_deployment_cache(task_id, 4, images)

    assert session_store.read_deployment_cache(task_id, 4) == images
    # A different deployment, or a different session, has no cache of its own.
    assert session_store.read_deployment_cache(task_id, 5) is None
    assert session_store.read_deployment_cache(session_store.new_task_id(), 4) is None


def test_writing_the_cache_again_replaces_it():
    task_id = session_store.new_task_id()
    session_store.write_deployment_cache(task_id, 4, [{"media_id": 1}])
    session_store.write_deployment_cache(task_id, 4, [{"media_id": 2}])
    assert session_store.read_deployment_cache(task_id, 4) == [{"media_id": 2}]


def test_a_corrupted_cache_file_reads_as_missing():
    task_id = session_store.new_task_id()
    session_store.write_deployment_cache(task_id, 4, [{"media_id": 1}])
    (session_store.session_dir(task_id) / "trapper_cache" / "4.json").write_text("not json", encoding="utf-8")
    assert session_store.read_deployment_cache(task_id, 4) is None
