"""MediaWorker stop — must terminate FFmpeg subprocesses."""
from __future__ import annotations

from unittest.mock import MagicMock

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
