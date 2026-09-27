"""FastAPI router — health check and version info."""
from __future__ import annotations

from fastapi import APIRouter

from wildintel_zooniverse.core.version import current_version

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/api/version")
def version() -> dict:
    return {"current": current_version()}
