"""logging_setup, and the settings page's General section / log download."""
import logging

import pytest
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from wildintel_zooniverse.web.main import app
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    from wildintel_zooniverse.core import config

    monkeypatch.delenv("WILDINTEL_ZOONIVERSE_WEB_LOG_LEVEL", raising=False)
    config.save_settings(config.Settings())
    root_level = logging.getLogger().level
    yield
    config.save_settings(config.Settings())
    logging.getLogger().setLevel(root_level)


def _flush():
    for handler in logging.getLogger().handlers:
        handler.flush()


def test_the_log_goes_to_a_file_next_to_settings_toml():
    from wildintel_zooniverse.core import config
    from wildintel_zooniverse.core import logging_setup

    logging_setup.configure()
    logging.getLogger("services.test").warning("something to find later")
    _flush()

    assert logging_setup.log_file() == config.get_logs_dir() / "wildintel-zooniverse.log"
    assert config.get_logs_dir().parent == config.DEFAULT_CONFIG_FILE.parent
    assert "something to find later" in logging_setup.log_file().read_text(encoding="utf-8")


def test_configuring_twice_doesnt_log_twice():
    from wildintel_zooniverse.core import logging_setup

    logging_setup.configure()
    logging_setup.configure()
    ours = [h for h in logging.getLogger().handlers if getattr(h, "_wildintel_zooniverse", False)]
    assert len(ours) == 2  # console + file


def test_panoptes_clients_own_console_handler_is_dropped():
    from wildintel_zooniverse.core import logging_setup

    stray = logging.StreamHandler()
    logging.getLogger().addHandler(stray)  # what logging.basicConfig() adds
    logging_setup.configure()
    assert stray not in logging.getLogger().handlers


def test_saving_the_settings_changes_the_level_on_the_fly():
    from wildintel_zooniverse.core import logging_setup

    logging_setup.configure()
    assert logging.getLogger().level == logging.INFO

    settings = _client().get("/api/settings").json()
    settings["GENERAL"]["log_level"] = "DEBUG"
    _client().put("/api/settings", json=settings)
    assert logging.getLogger().level == logging.DEBUG
    # The libraries' byte-level chatter stays at INFO.
    assert logging.getLogger("httpcore").level == logging.INFO

    settings["GENERAL"]["log_level"] = "WARNING"
    _client().put("/api/settings", json=settings)
    assert logging.getLogger().level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING


def test_the_environment_overrides_the_settings_page(monkeypatch):
    from wildintel_zooniverse.core import logging_setup

    monkeypatch.setenv("WILDINTEL_ZOONIVERSE_WEB_LOG_LEVEL", "debug")
    assert logging_setup.effective_level() == "DEBUG"
    general = _client().get("/api/settings").json()["GENERAL"]
    assert general["log_level"] == "INFO"
    assert general["log_level_override"] == "DEBUG"


def test_the_settings_say_where_the_log_is():
    from wildintel_zooniverse.core import logging_setup

    general = _client().get("/api/settings").json()["GENERAL"]
    assert general == {"log_level": "INFO", "log_file": str(logging_setup.log_file()), "log_level_override": None}


def test_an_unknown_level_is_a_422():
    settings = _client().get("/api/settings").json()
    settings["GENERAL"]["log_level"] = "VERBOSE"
    assert _client().put("/api/settings", json=settings).status_code == 422


def test_the_log_can_be_downloaded():
    from wildintel_zooniverse.core import logging_setup

    logging_setup.configure()
    logging.getLogger("services.test").warning("in the download")
    _flush()
    response = _client().get("/api/settings/log")
    assert response.status_code == 200
    assert "in the download" in response.text
    assert 'filename="wildintel-zooniverse.log"' in response.headers["content-disposition"]


def test_health_checks_stay_out_of_the_access_log_unless_debugging():
    from wildintel_zooniverse.core import logging_setup

    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1:1", "GET", "/api/health", "1.1", 200), None)
    health_filter = logging_setup._HealthCheckFilter()
    logging_setup.apply_level("INFO")
    assert not health_filter.filter(record)
    logging_setup.apply_level("DEBUG")
    assert health_filter.filter(record)


def test_debugging_says_whether_to_log_tracebacks():
    from wildintel_zooniverse.core import logging_setup

    logging_setup.apply_level("INFO")
    assert logging_setup.debugging() is False
    logging_setup.apply_level("DEBUG")
    assert logging_setup.debugging() is True


def test_the_log_can_be_cleared_and_logging_goes_on():
    from wildintel_zooniverse.core import logging_setup

    logging_setup.configure()
    logging.getLogger("services.test").warning("before clearing")
    _flush()
    rotated = logging_setup.log_file().with_name(logging_setup.log_file().name + ".1")
    rotated.write_text("an old rotated copy", encoding="utf-8")

    response = _client().delete("/api/settings/log")

    assert response.json() == {"deleted": 2}
    assert not rotated.exists()
    logging.getLogger("services.test").warning("after clearing")
    _flush()
    text = logging_setup.log_file().read_text(encoding="utf-8")
    assert "before clearing" not in text
    assert "Log cleared (2 file(s) deleted)" in text
    assert "after clearing" in text
