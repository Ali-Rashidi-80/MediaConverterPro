"""Application entry guards and public API smoke."""
from __future__ import annotations

import galaxy_ultimate
from galaxy import app as app_module


def test_mainprocess_guard_skips_worker_spawn(monkeypatch):
    qapp_called = {"n": 0}

    def fake_qapp(*args, **kwargs):
        qapp_called["n"] += 1
        raise AssertionError("QApplication should not start in worker process")

    class _FakeProcess:
        name = "SpawnProcess-1"

    monkeypatch.setattr(app_module, "QApplication", fake_qapp)
    monkeypatch.setattr(app_module.multiprocessing, "current_process", lambda: _FakeProcess())
    app_module.main()
    assert qapp_called["n"] == 0


def test_galaxy_ultimate_exports_public_api():
    required = (
        "APP_NAME",
        "APP_VERSION",
        "GalaxyWindow",
        "main",
        "MediaWorker",
        "ImageWorker",
        "SettingsManager",
        "find_ffmpeg_path",
    )
    for name in required:
        assert hasattr(galaxy_ultimate, name), name
