"""
Server settings for the WildINTEL Zooniverse web backend (not to be confused
with config.py, the app's own settings.toml).

Priority order (highest to lowest):
  1. Environment variables                 WILDINTEL_ZOONIVERSE_WEB_PORT=9000 uvicorn main:app
  2. ~/.config/wildintel_zooniverse_web/.env
  3. <directory of this module>/.env

Example .env
------------
WILDINTEL_ZOONIVERSE_WEB_PORT=8768
WILDINTEL_ZOONIVERSE_WEB_LOG_LEVEL=INFO
"""
import logging
from pathlib import Path

from platformdirs import user_config_dir
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_files() -> tuple[Path, ...]:
    """Ascending priority: later files win."""
    return (
        Path(__file__).parent / ".env",
        Path(user_config_dir("wildintel_zooniverse_web")) / ".env",
    )


class ServerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_prefix="WILDINTEL_ZOONIVERSE_WEB_",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
    )

    # One above wildintel-publisher's own defaults (8767/5174), so both
    # apps can run side by side.
    port: int = 8768
    log_level: str = "INFO"
    cors_origins: list[str] = [
        "http://localhost:5175",
        "http://localhost",
        "http://localhost:8768",
    ]

    @field_validator("log_level")
    @classmethod
    def _valid_log_level(cls, v: str) -> str:
        level = v.upper()
        if level not in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
            raise ValueError(f"Invalid log level: {v!r}")
        return level


settings = ServerSettings()


def configure_logging() -> None:
    """Console + log file, at the settings page's level (see logging_setup).
    `log_level` here is only uvicorn's own, in development (wzcli)."""
    from wildintel_zooniverse.core import logging_setup

    logging_setup.configure()
