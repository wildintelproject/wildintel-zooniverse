"""wildintel-zooniverse's own settings.toml — Trapper and Zooniverse
connection defaults, how uploads download and upload images, and the
sequence criteria new runs start from, kept in
the user's config directory (editable on the app's settings page).

Same approach as wildintel-publisher's own config.py: a Pydantic model
validated from what Dynaconf reads, written back with Dynaconf's TOML
loader. Created with defaults the first time it's read."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Literal, Optional

import platformdirs
from dynaconf import Dynaconf, loaders
from pydantic import BaseModel, Field

APP_NAME = "wildintel-zooniverse"
DEFAULT_CONFIG_FILE = Path(platformdirs.user_config_dir(APP_NAME)) / "settings.toml"
# More settings files besides the default one: every .toml in CONFIGS_DIR.
# Which one is in use is named by ACTIVE_CONFIG_POINTER (see active_config_file).
CONFIGS_DIR = DEFAULT_CONFIG_FILE.parent / "configs"
ACTIVE_CONFIG_POINTER = DEFAULT_CONFIG_FILE.parent / "active-config"
DEFAULT_CONFIG_ID = "default"


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
    collapse_empty_sequences: bool = Field(
        default=False,
        description="Reduce sequences with only 'empty' images to their second image. (SEQUENCES.collapse_empty_sequences)",
    )


class Settings(BaseModel):
    GENERAL: GeneralSettings = Field(default_factory=GeneralSettings)
    TRAPPER: TrapperSettings = Field(default_factory=TrapperSettings)
    ZOONIVERSE: ZooniverseSettings = Field(default_factory=ZooniverseSettings)
    SEQUENCES: SequencesSettings = Field(default_factory=SequencesSettings)


class ConfigInfo(BaseModel):
    """One settings file the user can switch to — see list_configs."""
    id: str
    name: str
    path: str
    active: bool


def _config_path(config_id: str) -> Path:
    return DEFAULT_CONFIG_FILE if config_id == DEFAULT_CONFIG_ID else CONFIGS_DIR / f"{config_id}.toml"


def _config_ids() -> list[str]:
    extra = sorted(p.stem for p in CONFIGS_DIR.glob("*.toml")) if CONFIGS_DIR.is_dir() else []
    return [DEFAULT_CONFIG_ID, *(config_id for config_id in extra if config_id != DEFAULT_CONFIG_ID)]


def active_config_id() -> str:
    """The id of the config in use: the one ACTIVE_CONFIG_POINTER names, or
    the default one if it's missing, empty or names a file that's gone."""
    try:
        config_id = ACTIVE_CONFIG_POINTER.read_text(encoding="utf-8").strip()
    except OSError:
        return DEFAULT_CONFIG_ID
    return config_id if config_id in _config_ids() else DEFAULT_CONFIG_ID


def active_config_file() -> Path:
    """The settings file load_settings()/save_settings() work on when not
    given one explicitly."""
    return _config_path(active_config_id())


def list_configs() -> list[ConfigInfo]:
    active = active_config_id()
    return [
        ConfigInfo(
            id=config_id, name="Default config" if config_id == DEFAULT_CONFIG_ID else config_id,
            path=str(_config_path(config_id)), active=config_id == active,
        )
        for config_id in _config_ids()
    ]


def create_config(name: str) -> str:
    """Writes a new config file with the default values — named after `name`
    (made file-name safe, and unique among the existing ones) — and returns
    its id. It doesn't become the active one.

    Raises:
        ValueError: if `name` has no letters or digits to name a file after.
    """
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    if not base:
        raise ValueError("A config needs a name with at least one letter or digit.")
    existing = set(_config_ids())
    config_id, suffix = base, 2
    while config_id in existing:
        config_id, suffix = f"{base}-{suffix}", suffix + 1
    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(
        str(_config_path(config_id)), Settings().model_dump(mode="json", exclude_none=True), merge=False,
    )
    return config_id


def set_active_config(config_id: str) -> None:
    """Raises:
        KeyError: if there's no config with that id.
    """
    if config_id not in _config_ids():
        raise KeyError(config_id)
    ACTIVE_CONFIG_POINTER.parent.mkdir(parents=True, exist_ok=True)
    ACTIVE_CONFIG_POINTER.write_text(config_id, encoding="utf-8")


def config_file_for(config_id: str) -> Path:
    """Raises:
        KeyError: if there's no config with that id.
    """
    if config_id not in _config_ids():
        raise KeyError(config_id)
    return _config_path(config_id)


def _ensure_config_file(config_file: Path) -> None:
    if config_file.exists():
        return
    config_file.parent.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(str(config_file), Settings().model_dump(mode="json", exclude_none=True), merge=False)


def load_settings(config_file: Optional[Path] = None) -> Settings:
    config_file = config_file or active_config_file()
    _ensure_config_file(config_file)
    dynaconf_settings = Dynaconf(settings_files=[str(config_file)], envvar_prefix="WILDINTEL_ZOONIVERSE")
    return Settings.model_validate(dynaconf_settings.to_dict())


def save_settings(settings: Settings, config_file: Optional[Path] = None) -> None:
    config_file = config_file or active_config_file()
    config_file.parent.mkdir(parents=True, exist_ok=True)
    loaders.toml_loader.write(str(config_file), settings.model_dump(mode="json", exclude_none=True), merge=False)
