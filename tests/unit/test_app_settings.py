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


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    """Points the config files (default, extra ones, active pointer) at a temp dir."""
    from wildintel_zooniverse.core import config

    monkeypatch.setattr(config, "DEFAULT_CONFIG_FILE", tmp_path / "settings.toml")
    monkeypatch.setattr(config, "CONFIGS_DIR", tmp_path / "configs")
    monkeypatch.setattr(config, "ACTIVE_CONFIG_POINTER", tmp_path / "active-config")
    config.save_settings(config.Settings())
    return tmp_path


def test_lists_the_default_config_as_the_active_one(config_dir):
    assert _client().get("/api/settings/configs").json() == [
        {"id": "default", "name": "Default config", "path": str(config_dir / "settings.toml"), "active": True},
    ]


def test_a_new_config_has_the_default_values_and_is_not_activated(config_dir):
    client = _client()
    assert client.put("/api/settings", json=_body()).status_code == 200

    configs = client.post("/api/settings/configs", json={"name": "Project B"}).json()

    assert [(c["id"], c["active"]) for c in configs] == [("default", True), ("project-b", False)]
    assert (config_dir / "configs" / "project-b.toml").is_file()
    assert client.get("/api/settings").json()["SEQUENCES"]["max_interval"] == 120  # the default config's own edit
    client.post("/api/settings/configs/project-b/activate")
    assert client.get("/api/settings").json()["SEQUENCES"]["max_interval"] != 120  # the new one starts from defaults


def test_saving_goes_to_the_active_config_only(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "B"})
    client.post("/api/settings/configs/b/activate")

    client.put("/api/settings", json=_body())

    assert "max_interval = 120" in (config_dir / "configs" / "b.toml").read_text(encoding="utf-8")
    assert "max_interval = 120" not in (config_dir / "settings.toml").read_text(encoding="utf-8")


def test_two_configs_with_the_same_name_get_different_ids(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "Same"})
    configs = client.post("/api/settings/configs", json={"name": "Same"}).json()

    assert [c["id"] for c in configs] == ["default", "same", "same-2"]


def test_a_config_needs_a_usable_name_and_an_existing_id_to_activate(config_dir):
    client = _client()

    assert client.post("/api/settings/configs", json={"name": "  !! "}).status_code == 400
    assert client.post("/api/settings/configs/nope/activate").status_code == 404
    assert client.get("/api/settings/configs/nope/download").status_code == 404


def test_a_missing_active_config_falls_back_to_the_default_one(config_dir):
    client = _client()
    client.post("/api/settings/configs", json={"name": "B"})
    client.post("/api/settings/configs/b/activate")
    (config_dir / "configs" / "b.toml").unlink()

    assert [(c["id"], c["active"]) for c in client.get("/api/settings/configs").json()] == [("default", True)]


def test_a_config_can_be_downloaded_and_its_folder_opened(config_dir, monkeypatch):
    from wildintel_zooniverse.web.api.routers import app_settings

    client = _client()
    client.post("/api/settings/configs", json={"name": "B"})

    response = client.get("/api/settings/configs/b/download")
    assert response.status_code == 200
    assert "b.toml" in response.headers["content-disposition"]
    assert response.text == (config_dir / "configs" / "b.toml").read_text(encoding="utf-8")

    opened = []
    monkeypatch.setattr(app_settings, "open_folder", opened.append)
    assert client.post("/api/settings/configs/default/open-folder").json() == {"ok": True}
    assert client.post("/api/settings/configs/b/open-folder").json() == {"ok": True}
    assert opened == [config_dir, config_dir / "configs"]
