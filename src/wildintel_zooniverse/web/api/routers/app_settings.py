"""FastAPI router — the app's own settings.toml (see config.py), edited on
the settings page. Passwords never go back to the frontend: each section
says whether one is saved instead, and saving a blank one keeps it."""
from __future__ import annotations

import platform
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core import logging_setup

router = APIRouter(prefix="/api/settings", tags=["settings"])


def open_folder(path: Path) -> None:
    """Opens `path` in the OS's file manager. This is a local, single-user
    tool: the backend runs on the same machine as the browser using it."""
    if not path.is_dir():
        raise FileNotFoundError(f"{path} is not a directory.")
    system = platform.system()
    command = ["open", str(path)] if system == "Darwin" else ["explorer", str(path)] if system == "Windows" else ["xdg-open", str(path)]
    subprocess.Popen(command, start_new_session=True)


class NewConfigRequest(BaseModel):
    name: str

_SECTIONS = ("TRAPPER", "ZOONIVERSE")


def _public(settings: config.Settings) -> dict:
    data = settings.model_dump(mode="json")
    for section in _SECTIONS:
        data[section]["has_password"] = bool(data[section].pop("user_password"))
    # Read-only: where the log goes, and whether the environment overrides
    # the level set here.
    data["GENERAL"]["log_file"] = str(logging_setup.log_file())
    data["GENERAL"]["log_level_override"] = logging_setup.env_override()
    return data


@router.get("")
def get_settings() -> dict:
    return _public(config.load_settings())


@router.put("")
def save_settings(new: config.Settings) -> dict:
    """Replaces every setting — except a password left blank, which keeps
    the saved one. Blank URL/usernames are cleared."""
    current = config.load_settings()
    for section in _SECTIONS:
        new_section, current_section = getattr(new, section), getattr(current, section)
        if not new_section.user_password:
            new_section.user_password = current_section.user_password
        for field in ("base_url", "user_name"):
            if hasattr(new_section, field) and not getattr(new_section, field):
                setattr(new_section, field, None)
    config.save_settings(new)
    logging_setup.apply_level(logging_setup.effective_level())
    return _public(new)


@router.get("/log")
def download_log() -> FileResponse:
    """The current log file — to attach to a bug report."""
    path = logging_setup.log_file()
    if not path.is_file():
        raise HTTPException(404, "There's no log file yet.")
    return FileResponse(path, media_type="text/plain", filename=path.name)


@router.delete("/log")
def delete_log() -> dict:
    """Deletes the log file and its rotated copies — logging goes on, into a
    new one."""
    return {"deleted": logging_setup.clear_log()}


@router.get("/configs")
def get_configs() -> list[dict]:
    """Every settings file the user can switch to, the one in use flagged."""
    return [c.model_dump() for c in config.list_configs()]


@router.post("/configs")
def add_config(req: NewConfigRequest) -> list[dict]:
    """Writes a new settings file with the default values (it doesn't become
    the active one) and returns the updated list."""
    try:
        config.create_config(req.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return get_configs()


@router.post("/configs/{config_id}/activate")
def activate_config(config_id: str) -> list[dict]:
    """Makes `config_id` the settings file the whole app reads and saves."""
    try:
        config.set_active_config(config_id)
    except KeyError:
        raise HTTPException(404, f"There's no config {config_id!r}.") from None
    return get_configs()


def _existing_config_file(config_id: str) -> Path:
    try:
        path = config.config_file_for(config_id)
    except KeyError:
        raise HTTPException(404, f"There's no config {config_id!r}.") from None
    if not path.is_file():
        raise HTTPException(404, "There's no settings file yet.")
    return path


@router.get("/configs/{config_id}/download")
def download_config(config_id: str) -> FileResponse:
    """The settings file itself, as saved — passwords included, since it's a
    backup of the file; it's the user's own file, on their own machine."""
    path = _existing_config_file(config_id)
    return FileResponse(path, media_type="application/toml", filename=path.name)


@router.post("/configs/{config_id}/open-folder")
def open_config_folder(config_id: str) -> dict:
    """Opens the directory holding that settings file in the OS's file manager."""
    path = _existing_config_file(config_id)
    try:
        open_folder(path.parent)
    except Exception as exc:
        raise HTTPException(500, f"Could not open the folder: {exc}") from exc
    return {"ok": True}
