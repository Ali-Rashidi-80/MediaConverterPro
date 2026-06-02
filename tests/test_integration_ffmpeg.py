"""Real FFmpeg integration tests — run with: pytest -m integration."""
from __future__ import annotations

import subprocess

import pytest
from galaxy.services.ffmpeg import FFmpegEngine, verify_ffmpeg
from galaxy.services.ffmpeg_pipeline import PipelineTier, build_video_command
from galaxy.workers.image_task import convert_image_task

pytestmark = pytest.mark.integration


def test_verify_bundled_ffmpeg(ffmpeg_path):
    ok, msg = verify_ffmpeg(ffmpeg_path)
    assert ok, msg


def test_probe_tiny_video(ffmpeg_path, tiny_mp4):
    text = FFmpegEngine.run_probe(ffmpeg_path, str(tiny_mp4))
    assert "Duration:" in text or tiny_mp4.name in text


def test_remux_copy_integration(ffmpeg_path, tiny_mp4, temp_output, nvidia_profile):
    out = temp_output / "copy.mp4"
    cmd, tier, _ = build_video_command(
        ffmpeg_path, str(tiny_mp4), str(out),
        {"copy_streams": True, "format": "mp4", "video_preset": "fast_copy"},
        nvidia_profile,
    )
    assert tier == PipelineTier.COPY
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-500:]
    assert out.is_file() and out.stat().st_size > 100


def test_image_jpg_integration(ffmpeg_path, sample_jpg, temp_output):
    path, ok, msg = convert_image_task(str(sample_jpg), str(temp_output), {"format": "jpg", "quality": 90})
    assert ok, msg
    out = temp_output / msg
    assert out.stat().st_size > 50


def test_cpu_encode_integration(ffmpeg_path, tiny_mp4, temp_output, nvidia_profile, ffprobe):
    out = temp_output / "cpu.mp4"
    cmd, tier, _ = build_video_command(
        ffmpeg_path, str(tiny_mp4), str(out),
        {"format": "mp4", "video_preset": "mobile", "codec": "H.264", "accel_mode": "cpu"},
        nvidia_profile,
        force_cpu=True,
    )
    assert tier == PipelineTier.CPU
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stderr[-800:]
    codec = ffprobe(out, "codec_name")
    assert codec
    assert out.stat().st_size > 200
