# PyInstaller spec — the one every platform builds with (see the release
# workflow and `wzcli package build`). Run from the repository's root, after
# building the frontend (frontend/dist):
#
#   uv run pyinstaller wildintel-zooniverse.spec              # one file (.exe, .dmg)
#   WZ_ONEDIR=1 uv run pyinstaller wildintel-zooniverse.spec  # a folder (AppImage)
#
# The frontend is bundled as "static" (see main._static_dir).
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

# find_binary_dependencies (build_main.py) imports every collected package
# in an isolated subprocess, to catch dynamic library search path changes —
# that subprocess is a plain, unfrozen Python using the real build venv,
# where python-magic is still installed, so importing panoptes_client
# reaches its own `try: import magic`, which hangs on Windows searching for
# libmagic.dll (Windows has no such library — see magic/loader.py). Excluding
# magic from the bundle (below) doesn't help *here*, only in the frozen exe.
#
# Piggyback on PyInstaller's own Qt-bindings suppression: find_binary_dependencies's
# setup() sets sys.modules[name] = None for each suppressed name in the
# isolated child before importing each collected package — add magic to that
# list too, so its import fails fast there, which panoptes_client.subject
# already treats as "not available" (falls back to mimetypes).
if sys.platform == "win32":
    import PyInstaller.isolated._parent as _isolated_parent

    _original_call = _isolated_parent.Python.call

    def _suppress_magic_in_setup(self, function, *args, **kwargs):
        if (
            function.__name__ == "setup" and getattr(function, "__module__", None) == "PyInstaller.building.build_main"
            and args
        ):
            args = ([*args[0], "magic"], *args[1:])
        return _original_call(self, function, *args, **kwargs)

    _isolated_parent.Python.call = _suppress_magic_in_setup

ONEDIR = os.environ.get("WZ_ONEDIR") == "1"
NAME = "wildintel-zooniverse"
FRONTEND_DIST = Path(SPECPATH) / "frontend" / "dist"
if not (FRONTEND_DIST / "index.html").is_file():
    raise SystemExit(f"{FRONTEND_DIST} has no build — run `npm run build` in frontend/ first.")

# panoptes_client's own collect_submodules("panoptes_client") makes
# PyInstaller import it in an isolated subprocess to walk it — which hangs
# indefinitely on Windows CI runners (never on Linux/macOS; cause unknown).
# It's a flat package (one "tests" subpackage, not needed here), so a static
# list sidesteps the import entirely — regenerate with:
#   python -c "from PyInstaller.utils.hooks import collect_submodules as c; print(sorted(m for m in c('panoptes_client') if not m.startswith('panoptes_client.tests')))"
PANOPTES_CLIENT_SUBMODULES = [
    "panoptes_client",
    "panoptes_client.aggregation",
    "panoptes_client.caesar",
    "panoptes_client.classification",
    "panoptes_client.collection",
    "panoptes_client.collection_role",
    "panoptes_client.exportable",
    "panoptes_client.inaturalist",
    "panoptes_client.organization",
    "panoptes_client.panoptes",
    "panoptes_client.project",
    "panoptes_client.project_preferences",
    "panoptes_client.project_role",
    "panoptes_client.set_member_subject",
    "panoptes_client.subject",
    "panoptes_client.subject_set",
    "panoptes_client.subject_workflow_status",
    "panoptes_client.user",
    "panoptes_client.utils",
    "panoptes_client.workflow",
    "panoptes_client.workflow_version",
]

hiddenimports = [
    *collect_submodules("uvicorn"),
    *collect_submodules("fastapi"),
    *collect_submodules("starlette"),
    *collect_submodules("dynaconf"),
    *collect_submodules("trapper_client"),
    *PANOPTES_CLIENT_SUBMODULES,
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
    # magic (python-magic, panoptes-client's optional dependency): panoptes_client.subject
    # already falls back to mimetypes when it's missing (an ImportError) — excluding it
    # avoids libmagic's own DLL search hanging PyInstaller's Windows build (Windows has no
    # libmagic; see magic/loader.py's win32 candidates, tried one by one with ctypes.CDLL).
    excludes=["pytest", "tkinter", "magic"],
)
pyz = PYZ(a.pure)

if ONEDIR:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=NAME, console=True)
    coll = COLLECT(exe, a.binaries, a.datas, name=NAME)
else:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name=NAME, console=True)
