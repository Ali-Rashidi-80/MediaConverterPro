"""FFmpeg pipeline routing tests."""
from __future__ import annotations

from galaxy.services.ffmpeg_pipeline import (
    AccelBackend,
    PipelineTier,
    pick_pipeline_tier,
    resolve_accel_mode,
    tier_label,
)
from galaxy.services.hw_probe import BackendCaps, SystemProfile


def _nvidia_profile() -> SystemProfile:
    p = SystemProfile(cpu_count=8, recommended_backend="nvidia")
    p.backends["nvidia"] = BackendCaps(
        encoders=["h264_nvenc", "hevc_nvenc"],
        filters=["scale_cuda"],
    )
    return p


def test_copy_preset_is_copy_tier():
    tier, backend = pick_pipeline_tier({"copy_streams": True, "video_preset": "fast_copy"}, _nvidia_profile())
    assert tier == PipelineTier.COPY
    assert backend == AccelBackend.CPU


def test_vp9_forces_cpu():
    tier, backend = pick_pipeline_tier({"format": "webm", "codec": "VP9"}, _nvidia_profile())
    assert tier == PipelineTier.CPU
    assert backend == AccelBackend.CPU


def test_youtube_on_nvidia_is_gpu_tier():
    tier, backend = pick_pipeline_tier(
        {"video_preset": "youtube", "codec": "H.264", "accel_mode": "nvidia"},
        _nvidia_profile(),
    )
    assert tier in (PipelineTier.TIER1, PipelineTier.TIER2)
    assert backend == AccelBackend.NVIDIA


def test_rotate_forces_tier2():
    tier, _ = pick_pipeline_tier(
        {"video_preset": "youtube", "codec": "H.264", "accel_mode": "nvidia", "rotate": 90},
        _nvidia_profile(),
    )
    assert tier == PipelineTier.TIER2


def test_tier_label_mapping():
    assert tier_label(PipelineTier.COPY, AccelBackend.CPU) == "copy"
    assert tier_label(PipelineTier.TIER1, AccelBackend.NVIDIA).startswith("full_gpu")


def test_resolve_accel_unavailable_backend_falls_back_cpu():
    p = SystemProfile(recommended_backend="nvidia")
    backend = resolve_accel_mode({"accel_mode": "nvidia"}, p)
    assert backend == AccelBackend.CPU
