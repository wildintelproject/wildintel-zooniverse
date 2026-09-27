"""wildintel-zooniverse's own settings.toml — Trapper and Zooniverse
connection defaults, how uploads download and upload images, and the
sequence criteria new runs start from, kept in
the user's config directory (editable on the app's settings page).

Same approach as wildintel-publisher's own config.py: a Pydantic model
validated from what Dynaconf reads, written back with Dynaconf's TOML
loader. Created with defaults the first time it's read."""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

import platformdirs
from dynaconf import Dynaconf, loaders
from pydantic import BaseModel, Field

APP_NAME = "wildintel-zooniverse"
DEFAULT_CONFIG_FILE = Path(platformdirs.user_config_dir(APP_NAME)) / "settings.toml"


def get_app_documents_dir() -> Path:
    return Path(platformdirs.user_documents_dir()) / APP_NAME


def get_logs_dir() -> Path:
    """Where the app's log files go — next to settings.toml (see
    logging_setup)."""
    return DEFAULT_CONFIG_FILE.parent / "logs"


def get_sessions_dir() -> Path:
    """Where in-progress and interrupted wizard runs persist — see
    services.session_store."""
    return get_app_documents_dir() / "sessions"


LogLevel = Literal["ERROR", "WARNING", "INFO", "DEBUG"]


class GeneralSettings(BaseModel):
    log_level: LogLevel = Field(
        default="INFO",
        description="How much the app logs, to the console and its log file. (GENERAL.log_level)",
    )


class TrapperSettings(BaseModel):
    base_url: Optional[str] = Field(default=None, description="Trapper server URL. (TRAPPER.base_url)")
    user_name: Optional[str] = Field(default=None, description="Trapper username. (TRAPPER.user_name)")
    user_password: Optional[str] = Field(
        default=None, description="Trapper password. (TRAPPER.user_password)", json_schema_extra={"secret": True},
    )


    # How images are downloaded from Trapper during an upload — the defaults
    # are wildintel-tools' own. Retries back off exponentially from
    # download_retry_delay (see services.upload_service.RetryPolicy).
    download_workers: int = Field(default=4, ge=1, le=32, description="Images downloaded at once. (TRAPPER.download_workers)")
    download_attempts: int = Field(default=5, ge=1, le=20, description="Attempts per download. (TRAPPER.download_attempts)")
    download_retry_delay: int = Field(
        default=15, ge=0, le=3600, description="Seconds before the first retry of a download. (TRAPPER.download_retry_delay)",
    )


class ZooniverseSettings(BaseModel):
    user_name: Optional[str] = Field(default=None, description="Zooniverse username. (ZOONIVERSE.user_name)")
    user_password: Optional[str] = Field(
        default=None, description="Zooniverse password. (ZOONIVERSE.user_password)", json_schema_extra={"secret": True},
    )
    # The same, for uploading them to Zooniverse.
    upload_workers: int = Field(default=4, ge=1, le=32, description="Images uploaded at once. (ZOONIVERSE.upload_workers)")
    upload_attempts: int = Field(default=5, ge=1, le=20, description="Attempts per upload. (ZOONIVERSE.upload_attempts)")
    upload_retry_delay: int = Field(
        default=30, ge=0, le=3600, description="Seconds before the first retry of an upload. (ZOONIVERSE.upload_retry_delay)",
    )
    # Exporting classifications to Trapper (see
    # services.classifications_export_service) — wildintel-tools' own
    # ZOONIVERSE_CONNECTOR defaults.
    export_classified_by: str = Field(
        default="zooniverse@wildintel-project.org",
        description="Who the exported observations are classified by. (ZOONIVERSE.export_classified_by)",
    )
    export_max_file_size_mb: float = Field(
        default=1.5, gt=0, le=1000,
        description="Largest CSV to import into Trapper, in MB — bigger exports are split. (ZOONIVERSE.export_max_file_size_mb)",
    )


class SequencesSettings(BaseModel):
    """The upload criteria a new wizard run starts from (see
    schemas.requests.UploadCriteria and services.sampling) — each run can
    still change its own. The defaults are wildintel-tools' own."""

    max_interval: int = Field(default=90, ge=1, description="Max. seconds between images of a sequence. (SEQUENCES.max_interval)")
    images_per_sequence: int = Field(default=5, ge=1, description="Images kept from each sequence. (SEQUENCES.images_per_sequence)")
    only_classified: bool = Field(default=True, description="Only images with a real observation. (SEQUENCES.only_classified)")
    remove_middle_humans: bool = Field(default=True, description="Remove humans from middle sequences. (SEQUENCES.remove_middle_humans)")
    remove_middle_vehicles: bool = Field(
        default=False, description="Remove vehicles from middle sequences. (SEQUENCES.remove_middle_vehicles)",
    )


class Settings(BaseModel):
    GENERAL: GeneralSettings = Field(default_factory=GeneralSettings)
    TRAPPER: TrapperSettings = Field(default_factory=TrapperSettings)
    ZOONIVERSE: ZooniverseSettings = Field(default_factory=ZooniverseSettings)
    SEQUENCES: SequencesSettings = Field(default_factory=SequencesSettings)


def _ensure_config_file(config_file: Path) -> None:
    if config_file.exists():
        return
    config_file.parent.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(str(config_file), Settings().model_dump(mode="json", exclude_none=True), merge=False)


def load_settings(config_file: Path = DEFAULT_CONFIG_FILE) -> Settings:
    _ensure_config_file(config_file)
    dynaconf_settings = Dynaconf(settings_files=[str(config_file)], envvar_prefix="WILDINTEL_ZOONIVERSE")
    return Settings.model_validate(dynaconf_settings.to_dict())


def save_settings(settings: Settings, config_file: Path = DEFAULT_CONFIG_FILE) -> None:
    config_file.parent.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(str(config_file), settings.model_dump(mode="json", exclude_none=True), merge=False)
