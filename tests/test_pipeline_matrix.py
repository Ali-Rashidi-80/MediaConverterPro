"""Parametrized pipeline matrix — all presets and accel backends."""
from __future__ import annotations

import pytest
from galaxy.services.ffmpeg_pipeline import PipelineTier, pick_pipeline_tier, resolve_accel_mode
from galaxy.services.hw_probe import AccelBackend
from galaxy_i18n import VIDEO_PRESET_KEYS

PRESET_EXPECT_CPU = {"fast_copy"}


@pytest.mark.parametrize("preset", VIDEO_PRESET_KEYS)
def test_video_preset_tier_sanity(preset, nvidia_profile):
    settings = {"video_preset": preset, "format": "mp4", "codec": "H.264", "accel_mode": "nvidia"}
    tier, backend = pick_pipeline_tier(settings, nvidia_profile)
    if preset in PRESET_EXPECT_CPU:
        assert tier == PipelineTier.COPY
    else:
        assert tier in (PipelineTier.TIER1, PipelineTier.TIER2, PipelineTier.CPU)


@pytest.mark.parametrize(
    "mode,profile_key,expected",
    [
        ("auto", "nvidia", AccelBackend.NVIDIA),
        ("cpu", "nvidia", AccelBackend.CPU),
        ("nvidia", "nvidia", AccelBackend.NVIDIA),
    ],
)
def test_resolve_accel_mode(mode, profile_key, expected, nvidia_profile):
    backend = resolve_accel_mode({"accel_mode": mode}, nvidia_profile)
    assert backend == expected


def test_webm_vp9_always_cpu(nvidia_profile):
    tier, backend = pick_pipeline_tier({"format": "webm", "codec": "VP9"}, nvidia_profile)
    assert tier == PipelineTier.CPU
    assert backend == AccelBackend.CPU


def test_amd_profile_tier2_on_rotate(amd_profile):
    tier, backend = pick_pipeline_tier(
        {"video_preset": "youtube", "codec": "H.264", "accel_mode": "amd", "rotate": 180},
        amd_profile,
    )
    assert tier == PipelineTier.TIER2
    assert backend == AccelBackend.AMD
