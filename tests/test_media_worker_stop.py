"""MediaWorker stop — must terminate FFmpeg subprocesses and interrupt GPU waits."""
from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock

from galaxy.services.hw_probe import BackendCaps, SystemProfile
from galaxy.services.job_scheduler import GlobalGpuSemaphore
from galaxy.workers.media_worker import MediaWorker
from galaxy.workers.task_queue import ConversionTaskQueue


def test_stop_terminates_registered_processes(tmp_path, app_settings):
    worker = MediaWorker(
        ConversionTaskQueue([]), str(tmp_path), {"format": "mp4"}, app_settings=app_settings,
    )
    proc = MagicMock()
    worker._register_process(proc)
    worker.stop()
    proc.terminate.assert_called_once()
    assert worker.is_running is False
    assert worker.queue.is_stopped()


def test_stop_clears_pending_queue(tmp_path, app_settings):
    queue = ConversionTaskQueue(["a.mp4", "b.mp4"])
    worker = MediaWorker(queue, str(tmp_path), {}, app_settings=app_settings)
    worker.stop()
    assert queue.pending_count() == 0
    assert queue.is_stopped()


def test_finish_file_emits_cancelled_when_stopped(tmp_path, app_settings):
    queue = ConversionTaskQueue(["clip.mp4"])
    queue.take_next()
    queue.request_stop()
    worker = MediaWorker(queue, str(tmp_path), {"format": "mp4"}, app_settings=app_settings)
    statuses = []
    worker.file_status_signal.connect(lambda p, s: statuses.append((p, s)))
    worker._finish_file("clip.mp4", False, "stopped")
    assert statuses == [("clip.mp4", "cancelled")]
    assert queue.completed == 1


def test_acquire_gpu_interruptible_returns_false_when_stopped(tmp_path, app_settings):
    """Stop must interrupt a blocked GPU semaphore wait (not wait full 300s)."""
    GlobalGpuSemaphore.configure(1)
    assert GlobalGpuSemaphore.acquire(timeout=0.01)  # hold the only slot
    worker = MediaWorker(
        ConversionTaskQueue([]), str(tmp_path), {"format": "mp4"}, mode="video",
        app_settings=app_settings,
    )
    worker.is_running = True

    def stop_soon():
        time.sleep(0.15)
        worker.is_running = False

    threading.Thread(target=stop_soon, daemon=True).start()
    t0 = time.perf_counter()
    got = worker._acquire_gpu_interruptible(timeout=300.0, slice_timeout=0.05)
    elapsed = time.perf_counter() - t0
    GlobalGpuSemaphore.release()
    assert got is False
    assert elapsed < 2.0, f"stop must interrupt GPU wait quickly, took {elapsed:.2f}s"


def test_convert_one_returns_stopped_when_gpu_acquire_interrupted(
    tmp_path, app_settings, monkeypatch,
):
    profile = SystemProfile(cpu_count=4, recommended_backend="nvidia")
    profile.backends["nvidia"] = BackendCaps(encoders=["h264_nvenc"], filters=["scale_cuda"])

    src = tmp_path / "clip.mp4"
    src.write_bytes(b"\x00")
    worker = MediaWorker(
        ConversionTaskQueue([str(src)]),
        str(tmp_path),
        {"format": "mp4", "video_preset": "youtube", "accel_mode": "nvidia"},
        mode="video",
        app_settings=app_settings,
    )
    worker.is_running = True
    monkeypatch.setattr(worker, "get_duration", lambda *_: 1.0)

    def stop_during_acquire(*_a, **_k):
        worker.is_running = False
        return False

    monkeypatch.setattr(worker, "_acquire_gpu_interruptible", stop_during_acquire)
    _path, ok, msg, *_rest = worker._convert_one("ffmpeg.exe", profile, str(src), 0, 1, 1)
    assert ok is False
    assert msg == "stopped"
