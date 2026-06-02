"""MediaWorker unit tests (no real FFmpeg encode)."""
from __future__ import annotations

import pytest
from galaxy.services.ffmpeg_pipeline import PipelineTier
from galaxy.services.hw_probe import AccelBackend, BackendCaps, SystemProfile
from galaxy.workers.media_worker import MediaWorker


def _nvidia_profile() -> SystemProfile:
    p = SystemProfile(cpu_count=8, recommended_backend="nvidia")
    p.backends["nvidia"] = BackendCaps(encoders=["h264_nvenc"], filters=["scale_cuda"])
    return p


@pytest.fixture
def worker(tmp_path):
    return MediaWorker(
        tasks=[],
        output_dir=str(tmp_path),
        settings={"format": "mp4", "accel_mode": "nvidia", "nvenc_preset": "p4"},
        mode="video",
        app_settings={"language": "en", "parallel_mode": "smart"},
    )


def test_extract_ffmpeg_error_finds_error_line(worker):
    stderr = "frame=100\n[h264_nvenc] Error: invalid preset\n"
    msg = worker._extract_ffmpeg_error(stderr)
    assert "invalid preset" in msg.lower()


def test_extract_ffmpeg_error_empty(worker):
    assert worker._extract_ffmpeg_error("") == worker._i18n.t("err.ffmpeg_empty")


def test_extract_ffmpeg_error_generic(worker):
    stderr = "frame=1\ntime=00:00:01.00\nsome trailing note\n"
    msg = worker._extract_ffmpeg_error(stderr)
    assert msg == "some trailing note"


def test_encoder_label_nvenc(worker):
    label = worker._encoder_label(_nvidia_profile(), worker.settings)
    assert label == "NVENC p4"


def test_encoder_label_cpu_for_audio(tmp_path):
    w = MediaWorker([], str(tmp_path), {}, mode="audio", app_settings={"language": "en"})
    assert w._encoder_label(None, {}) == "CPU"


def test_build_command_video_includes_ffmpeg_and_output(worker, tmp_path):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"\x00")
    out = tmp_path / "out.mp4"
    cmd, tier, backend = worker._build_command(
        "ffmpeg.exe", str(src), str(out), _nvidia_profile(), settings=worker.settings
    )
    assert cmd[0] == "ffmpeg.exe"
    assert cmd[-1] == str(out)
    assert tier in (PipelineTier.TIER1, PipelineTier.TIER2, PipelineTier.CPU)
    if tier in (PipelineTier.TIER1, PipelineTier.TIER2):
        assert backend == AccelBackend.NVIDIA


def test_emit_batch_progress_monotonic(worker):
    worker._files_done = 0
    seen = []

    def capture(val):
        seen.append(val)

    worker.progress_signal.connect(capture)
    worker.batch_progress_signal.connect(lambda d, t: None)
    worker._emit_batch_progress(4)
    worker._emit_batch_progress(4)
    assert len(seen) == 2
    assert seen[1] > seen[0]
    assert seen[-1] <= 99


def test_gpu_fallback_releases_semaphore_before_cpu_retry(worker, tmp_path, monkeypatch):
    """GPU sem must not stay held during CPU fallback retry."""
    from galaxy.services.job_scheduler import GlobalGpuSemaphore

    GlobalGpuSemaphore.configure(1)
    profile = _nvidia_profile()
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"\x00")
    worker.tasks = [str(src)]
    worker.settings.update({"format": "mp4", "video_preset": "youtube", "accel_mode": "nvidia"})

    acquire_count = 0
    release_count = 0
    real_acquire = GlobalGpuSemaphore.acquire
    real_release = GlobalGpuSemaphore.release

    def counting_acquire(timeout=None):
        nonlocal acquire_count
        acquire_count += 1
        return real_acquire(timeout=timeout)

    def counting_release():
        nonlocal release_count
        release_count += 1
        return real_release()

    monkeypatch.setattr(GlobalGpuSemaphore, "acquire", counting_acquire)
    monkeypatch.setattr(GlobalGpuSemaphore, "release", counting_release)
    monkeypatch.setattr(worker, "get_ffmpeg_path", lambda: "ffmpeg.exe")
    monkeypatch.setattr(worker, "get_duration", lambda *_: 10.0)

    calls = {"gpu": 0, "cpu": 0}

    def fake_run(cmd, duration_sec, file_index, total_files, progress_base=0, progress_span=100):
        if "nvenc" in " ".join(cmd):
            calls["gpu"] += 1
            return 1, "Error: nvenc failed"
        calls["cpu"] += 1
        out_path = cmd[-1]
        with open(out_path, "wb") as fh:
            fh.write(b"ok")
        return 0, ""

    monkeypatch.setattr(worker, "_run_ffmpeg", fake_run)

    path, ok, msg = worker._convert_one("ffmpeg.exe", profile, str(src), 0, 1, 1)
    assert ok, msg
    assert calls["gpu"] == 1 and calls["cpu"] == 1
    assert acquire_count == 1
    assert release_count >= 1
