"""build_video_command integration-style tests."""
from __future__ import annotations

from galaxy.services.ffmpeg import find_ffmpeg_path
from galaxy.services.ffmpeg_pipeline import PipelineTier, build_video_command
from galaxy.services.hw_probe import BackendCaps, SystemProfile


def _profile() -> SystemProfile:
    p = SystemProfile(cpu_count=8, recommended_backend="nvidia")
    p.backends["nvidia"] = BackendCaps(
        encoders=["h264_nvenc", "hevc_nvenc"],
        filters=["scale_cuda"],
    )
    return p


def test_build_remux_command():
    ffmpeg = find_ffmpeg_path() or "ffmpeg"
    cmd, tier, backend = build_video_command(
        ffmpeg, "in.mp4", "out.mp4",
        {"copy_streams": True, "format": "mp4", "video_preset": "fast_copy"},
        _profile(),
    )
    assert tier == PipelineTier.COPY
    assert "-c" in cmd and "copy" in cmd
    assert cmd[-1] == "out.mp4"


def test_build_youtube_nvenc_command():
    ffmpeg = find_ffmpeg_path() or "ffmpeg"
    cmd, tier, _ = build_video_command(
        ffmpeg, "in.mp4", "out.mp4",
        {"format": "mp4", "video_preset": "youtube", "codec": "H.264", "accel_mode": "nvidia"},
        _profile(),
    )
    assert tier in (PipelineTier.TIER1, PipelineTier.TIER2)
    joined = " ".join(cmd)
    assert "nvenc" in joined or "libx264" in joined


def test_build_force_cpu_skips_nvenc():
    ffmpeg = find_ffmpeg_path() or "ffmpeg"
    cmd, tier, backend = build_video_command(
        ffmpeg, "in.mp4", "out.mp4",
        {"format": "mp4", "video_preset": "youtube", "accel_mode": "nvidia"},
        _profile(),
        force_cpu=True,
    )
    assert tier == PipelineTier.CPU
    assert "nvenc" not in " ".join(cmd).lower() or backend.value == "cpu"
