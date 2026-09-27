"""The running version — the release's own (_version.py, written by the
release workflow from its tag), else the installed package's, else "dev"."""
from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version as _pkg_version


def current_version() -> str:
    try:
        from wildintel_zooniverse._version import __version__
        return __version__
    except ImportError:
        pass
    try:
        return _pkg_version("wildintel-zooniverse")
    except PackageNotFoundError:
        return "dev"
