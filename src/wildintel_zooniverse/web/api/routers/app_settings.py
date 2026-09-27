"""FastAPI router — the app's own settings.toml (see config.py), edited on
the settings page. Passwords never go back to the frontend: each section
says whether one is saved instead, and saving a blank one keeps it."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from wildintel_zooniverse.core import config
from wildintel_zooniverse.core import logging_setup

router = APIRouter(prefix="/api/settings", tags=["settings"])

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
