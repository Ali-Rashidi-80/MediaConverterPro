"""Settings page UI collect/load roundtrip."""
from __future__ import annotations

import pytest


@pytest.mark.ui
def test_settings_collect_matches_load(galaxy_window):
    page = galaxy_window.settings_page
    galaxy_window.settings.update({
        "language": "en",
        "parallel_mode": "parallel",
        "max_parallel_jobs": 3,
        "accel_mode": "cpu",
        "nvenc_preset": "p6",
        "cpu_threads": 4,
        "quality_profile": "quality",
        "ui_mode": "professional",
    })
    page.load_from_settings(galaxy_window.settings)
    collected = page._collect()
    assert collected["language"] == "en"
    assert collected["parallel_mode"] == "parallel"
    assert collected["max_parallel_jobs"] == 3
    assert collected["accel_mode"] == "cpu"
    assert collected["nvenc_preset"] == "p6"
    assert collected["cpu_threads"] == 4
    assert collected["quality_profile"] == "quality"


@pytest.mark.ui
def test_settings_nvenc_disabled_without_nvidia(galaxy_window, monkeypatch):
    from galaxy.services.hw_probe import SystemProfile

    monkeypatch.setattr(
        "galaxy.ui.pages.settings.get_system_profile",
        lambda: SystemProfile(cpu_count=4, recommended_backend="cpu"),
    )
    page = galaxy_window.settings_page
    page._sync_accel_availability()
    assert not page.c_nvenc.isEnabled()
