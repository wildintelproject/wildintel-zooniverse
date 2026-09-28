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

# The Windows build has hung more than once inside PyInstaller's own isolated
# subprocess calls (collect_submodules, and find_binary_dependencies's "import
# every collected package to catch add_dll_directory side effects" pass) —
# neither logs which package/call is in flight, even at --log-level DEBUG, so
# a hang gives no clue where. Trace every such call on Windows so the next one
# does.
if sys.platform == "win32":
    import PyInstaller.isolated._parent as _isolated_parent

    _original_call = _isolated_parent.Python.call

    def _traced_call(self, function, *args, **kwargs):
        print(f"[isolated] -> {function.__name__}{args!r}", flush=True)
        result = _original_call(self, function, *args, **kwargs)
        print(f"[isolated] <- {function.__name__} done", flush=True)
        return result

    _isolated_parent.Python.call = _traced_call

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
    excludes=["pytest", "tkinter"],
)
pyz = PYZ(a.pure)

if ONEDIR:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=NAME, console=True)
    coll = COLLECT(exe, a.binaries, a.datas, name=NAME)
else:
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name=NAME, console=True)
