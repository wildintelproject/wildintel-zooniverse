# PyInstaller spec — the one every platform builds with (see the release
# workflow and `wzcli package build`). Run from the repository's root, after
# building the frontend (frontend/dist):
#
#   uv run pyinstaller wildintel-zooniverse.spec              # one file (.exe, .dmg)
#   WZ_ONEDIR=1 uv run pyinstaller wildintel-zooniverse.spec  # a folder (AppImage)
#
# The frontend is bundled as "static" (see main._static_dir).
import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

ONEDIR = os.environ.get("WZ_ONEDIR") == "1"
NAME = "wildintel-zooniverse"
FRONTEND_DIST = Path(SPECPATH) / "frontend" / "dist"
if not (FRONTEND_DIST / "index.html").is_file():
    raise SystemExit(f"{FRONTEND_DIST} has no build — run `npm run build` in frontend/ first.")

hiddenimports = [
    *collect_submodules("uvicorn"),
    *collect_submodules("fastapi"),
    *collect_submodules("starlette"),
    *collect_submodules("dynaconf"),
    *collect_submodules("trapper_client"),
    *collect_submodules("panoptes_client"),
    *collect_submodules("wildintel_zooniverse"),
    # The command-line app: rich loads some of its modules lazily.
    *collect_submodules("rich"),
    "anyio._backends._asyncio",
    "platformdirs",
    "pydantic_settings",
]

datas = [(str(FRONTEND_DIST), "static")]
for package in ("wildintel-zooniverse", "wildintel-trapper-sdk", "panoptes-client"):
    try:
        datas += copy_metadata(package)
    except Exception:  # not installed as a distribution — nothing to copy
        pass

a = Analysis(
    ["src/wildintel_zooniverse/web/app_entry.py"],
    pathex=["src"],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["pytest", "tkinter"],
)
pyz = PYZ(a.pure)

if ONEDIR:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=NAME, console=True)
    coll = COLLECT(exe, a.binaries, a.datas, name=NAME)
else:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name=NAME, console=True)
