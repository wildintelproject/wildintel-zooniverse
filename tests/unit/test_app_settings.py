"""/api/settings — the settings page's own view of settings.toml."""
import pytest
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean_settings():
    from wildintel_zooniverse.core import config

    config.save_settings(config.Settings())
    yield
    config.save_settings(config.Settings())


def _body(**overrides):
    body = {
        "TRAPPER": {"base_url": "https://trapper.example.org", "user_name": "alice", "user_password": "s3cret",
                    "download_workers": 6, "download_attempts": 3, "download_retry_delay": 10},
        "ZOONIVERSE": {"user_name": "bob", "user_password": "pw",
                       "upload_workers": 2, "upload_attempts": 7, "upload_retry_delay": 45},
        "SEQUENCES": {"max_interval": 120, "images_per_sequence": 3, "only_classified": False,
                      "remove_middle_humans": True, "remove_middle_vehicles": True},
    }
    for section, values in overrides.items():
        body[section] = {**body[section], **values}
    return body


def test_defaults_are_wildintel_tools_own_and_never_show_a_password():
    data = _client().get("/api/settings").json()
    assert data["TRAPPER"] == {"base_url": None, "user_name": None, "has_password": False,
                               "download_workers": 4, "download_attempts": 5, "download_retry_delay": 15}
    assert data["ZOONIVERSE"] == {"user_name": None, "has_password": False,
                                  "upload_workers": 4, "upload_attempts": 5, "upload_retry_delay": 30,
                                  "export_classified_by": "zooniverse@wildintel-project.org",
                                  "export_max_file_size_mb": 1.5}
    assert data["SEQUENCES"] == {"max_interval": 90, "images_per_sequence": 5, "only_classified": True,
                                 "remove_middle_humans": True, "remove_middle_vehicles": False,
                                 "collapse_empty_sequences": False}


def test_saving_writes_settings_toml():
    from wildintel_zooniverse.core import config

    response = _client().put("/api/settings", json=_body())

    assert response.json()["TRAPPER"]["has_password"] is True
    assert "user_password" not in response.json()["TRAPPER"]
    saved = config.load_settings()
    assert (saved.TRAPPER.download_workers, saved.TRAPPER.user_password) == (6, "s3cret")
    assert (saved.ZOONIVERSE.upload_attempts, saved.ZOONIVERSE.upload_retry_delay) == (7, 45)
    assert (saved.SEQUENCES.max_interval, saved.SEQUENCES.remove_middle_vehicles) == (120, True)


def test_a_blank_password_keeps_the_saved_one():
    from wildintel_zooniverse.core import config

    client = _client()
    client.put("/api/settings", json=_body())
    client.put("/api/settings", json=_body(TRAPPER={"user_password": "", "download_workers": 8},
                                           ZOONIVERSE={"user_password": None}))

    saved = config.load_settings()
    assert (saved.TRAPPER.user_password, saved.TRAPPER.download_workers) == ("s3cret", 8)
    assert saved.ZOONIVERSE.user_password == "pw"


def test_out_of_range_numbers_are_a_422_and_not_saved():
    from wildintel_zooniverse.core import config

    response = _client().put("/api/settings", json=_body(TRAPPER={"download_workers": 0}))
    assert response.status_code == 422
    assert config.load_settings().TRAPPER.download_workers == 4


def test_uploads_use_the_saved_settings():
    from wildintel_zooniverse.core.services import upload_service

    _client().put("/api/settings", json=_body())
    settings = upload_service.TransferSettings.from_config()
    assert (settings.download_workers, settings.upload_workers) == (6, 2)
    assert settings.download_retry == upload_service.RetryPolicy(attempts=3, min_wait=10, max_wait=160)
    assert settings.upload_retry == upload_service.RetryPolicy(attempts=7, min_wait=45, max_wait=720)
