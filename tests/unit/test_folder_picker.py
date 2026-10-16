"""services.folder_picker — the actual dialog tools are all mocked, so
these never pop a real window."""
from unittest.mock import MagicMock, patch

import pytest

from wildintel_zooniverse.core.services import folder_picker as fp


def _run(returncode: int, stdout: str = "", stderr: str = "") -> MagicMock:
    return MagicMock(returncode=returncode, stdout=stdout, stderr=stderr)


# ── Linux ────────────────────────────────────────────────────────────────────

def test_linux_prefers_zenity_and_returns_the_chosen_path():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Linux"), \
         patch("wildintel_zooniverse.core.services.folder_picker.shutil.which", side_effect=lambda name: "/usr/bin/zenity" if name == "zenity" else None), \
         patch("wildintel_zooniverse.core.services.folder_picker.subprocess.run", return_value=_run(0, "/home/me/DONA_01\n")) as run:
        assert fp.pick_folder("Pick one") == "/home/me/DONA_01"
    assert run.call_args[0][0][0] == "zenity"


def test_linux_falls_back_to_kdialog_when_zenity_is_missing():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Linux"), \
         patch("wildintel_zooniverse.core.services.folder_picker.shutil.which", side_effect=lambda name: "/usr/bin/kdialog" if name == "kdialog" else None), \
         patch("wildintel_zooniverse.core.services.folder_picker.subprocess.run", return_value=_run(0, "/home/me/DONA_01\n")) as run:
        assert fp.pick_folder("Pick one") == "/home/me/DONA_01"
    assert run.call_args[0][0][0] == "kdialog"


def test_linux_cancelling_returns_none():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Linux"), \
         patch("wildintel_zooniverse.core.services.folder_picker.shutil.which", return_value="/usr/bin/zenity"), \
         patch("wildintel_zooniverse.core.services.folder_picker.subprocess.run", return_value=_run(1)):
        assert fp.pick_folder() is None


def test_linux_raises_when_no_dialog_tool_is_installed():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Linux"), \
         patch("wildintel_zooniverse.core.services.folder_picker.shutil.which", return_value=None):
        with pytest.raises(fp.FolderPickerUnavailable):
            fp.pick_folder()


# ── macOS ────────────────────────────────────────────────────────────────────

def test_macos_uses_osascript():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Darwin"), \
         patch("wildintel_zooniverse.core.services.folder_picker.subprocess.run", return_value=_run(0, "/Users/me/DONA_01\n")) as run:
        assert fp.pick_folder("Pick one") == "/Users/me/DONA_01"
    assert run.call_args[0][0][0] == "osascript"


def test_macos_cancelling_returns_none():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Darwin"), \
         patch("wildintel_zooniverse.core.services.folder_picker.subprocess.run", return_value=_run(1)):
        assert fp.pick_folder() is None


# ── Windows ──────────────────────────────────────────────────────────────────

def test_windows_uses_powershell():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Windows"), \
         patch("wildintel_zooniverse.core.services.folder_picker.subprocess.run", return_value=_run(0, "C:\\me\\DONA_01\r\n")) as run:
        assert fp.pick_folder("Pick one") == "C:\\me\\DONA_01"
    assert run.call_args[0][0][0] == "powershell"


def test_windows_failure_raises():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Windows"), \
         patch("wildintel_zooniverse.core.services.folder_picker.subprocess.run", return_value=_run(1, stderr="boom")):
        with pytest.raises(fp.FolderPickerUnavailable, match="boom"):
            fp.pick_folder()


def test_unsupported_platform_raises():
    with patch("wildintel_zooniverse.core.services.folder_picker.platform.system", return_value="Plan9"):
        with pytest.raises(fp.FolderPickerUnavailable):
            fp.pick_folder()
