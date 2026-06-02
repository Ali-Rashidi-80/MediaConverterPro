"""Path resolution for dev and frozen bundles."""
from __future__ import annotations

import os
import sys

from galaxy.core import paths


def test_is_frozen_false_in_dev():
    assert paths.is_frozen() is False


def test_get_exe_dir_points_to_project_root(monkeypatch):
    monkeypatch.setattr(paths, "is_frozen", lambda: False)
    root = paths.get_exe_dir()
    assert os.path.isdir(root)
    assert os.path.isfile(os.path.join(root, "galaxy_ultimate.py"))


def test_get_bundle_dir_dev_equals_project_root(monkeypatch):
    monkeypatch.setattr(paths, "is_frozen", lambda: False)
    assert paths.get_bundle_dir() == paths.get_exe_dir()


def test_resource_path_finds_ffmpeg_or_none(monkeypatch):
    monkeypatch.setattr(paths, "is_frozen", lambda: False)
    result = paths.resource_path("galaxy_ultimate.py")
    assert result and os.path.isfile(result)


def test_resource_path_missing_returns_none(monkeypatch):
    monkeypatch.setattr(paths, "is_frozen", lambda: False)
    assert paths.resource_path("__no_such_file_xyz__.bin") is None


def test_frozen_paths_use_meipass(monkeypatch, tmp_path):
    fake_exe = tmp_path / "GalaxyMediaPro.exe"
    fake_exe.write_bytes(b"")
    meipass = tmp_path / "_MEIPASS"
    meipass.mkdir()
    asset = meipass / "icon.ico"
    asset.write_bytes(b"ico")

    monkeypatch.setattr(paths, "is_frozen", lambda: True)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(fake_exe), raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(meipass), raising=False)

    assert paths.get_exe_dir() == str(fake_exe.parent)
    assert paths.get_bundle_dir() == str(meipass)
    assert paths.resource_path("icon.ico") == str(asset)
    assert paths.get_application_path() == str(fake_exe.parent)

