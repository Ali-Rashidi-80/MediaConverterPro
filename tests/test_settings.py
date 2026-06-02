"""Settings persistence and migration tests."""
from __future__ import annotations

import json
from pathlib import Path

from galaxy.services.settings import DEFAULT_SETTINGS, PERF_DEFAULTS, SettingsManager


def test_perf_defaults_no_removed_keys():
    assert "nvenc_lookahead" not in PERF_DEFAULTS
    assert "accel_device" not in PERF_DEFAULTS


def test_default_settings_has_required_keys():
    for key in ("language", "theme", "parallel_mode", "accel_mode", "output_dir"):
        assert key in DEFAULT_SETTINGS


def test_load_migrates_legacy_use_gpu(monkeypatch, tmp_path: Path):
    cfg = tmp_path / "settings.json"
    cfg.write_text(json.dumps({"use_gpu": True, "language": "fa"}), encoding="utf-8")
    monkeypatch.setattr(SettingsManager, "_path", str(cfg))
    data = SettingsManager.load()
    assert data["accel_mode"] == "nvidia"


def test_save_roundtrip(monkeypatch, tmp_path: Path):
    cfg = tmp_path / "settings.json"
    monkeypatch.setattr(SettingsManager, "_path", str(cfg))
    payload = dict(DEFAULT_SETTINGS)
    payload["language"] = "en"
    payload["parallel_mode"] = "parallel"
    SettingsManager.save(payload)
    loaded = SettingsManager.load()
    assert loaded["language"] == "en"
    assert loaded["parallel_mode"] == "parallel"
