"""ImageWorker tests using pytest-qt waitSignal."""
from __future__ import annotations

import pytest
from galaxy.workers.image_worker import ImageWorker
from galaxy.workers.task_queue import ConversionTaskQueue


@pytest.mark.ui
def test_image_worker_sequential_success(qtbot, sample_jpg, temp_output, app_settings, monkeypatch):
    monkeypatch.setattr(
        "galaxy.workers.image_worker.compute_slots",
        lambda settings, job: 1,
    )
    monkeypatch.setattr(
        "galaxy.workers.image_worker.get_system_profile",
        lambda: None,
    )
    worker = ImageWorker(
        ConversionTaskQueue([str(sample_jpg)]), str(temp_output), {"format": "png"}, app_settings,
    )
    logs = []
    statuses = []
    worker.log_signal.connect(logs.append)
    worker.file_status_signal.connect(lambda p, s: statuses.append((p, s)))
    with qtbot.waitSignal(worker.finished_all, timeout=15000):
        worker.start()
    assert any(s == "success" for _, s in statuses)
    assert worker.progress_signal  # smoke — signal exists


@pytest.mark.ui
def test_image_worker_empty_tasks_finishes(qtbot, temp_output, app_settings):
    worker = ImageWorker(ConversionTaskQueue([]), str(temp_output), {}, app_settings)
    with qtbot.waitSignal(worker.finished_all, timeout=5000):
        worker.start()


@pytest.mark.ui
def test_image_worker_bad_output_dir(qtbot, sample_jpg, temp_output, app_settings, monkeypatch):
    monkeypatch.setattr(
        "galaxy.workers.image_worker.ensure_writable_dir",
        lambda p: (_ for _ in ()).throw(OSError("denied")),
    )
    worker = ImageWorker(ConversionTaskQueue([str(sample_jpg)]), str(temp_output), {}, app_settings)
    msgs = []
    worker.log_signal.connect(msgs.append)
    with qtbot.waitSignal(worker.finished_all, timeout=5000):
        worker.start()
    assert msgs


def test_handle_result_cancelled_on_stop(tmp_path, app_settings):
    queue = ConversionTaskQueue(["photo.jpg"])
    queue.take_next()
    queue.request_stop()
    worker = ImageWorker(queue, str(tmp_path), {"format": "png"}, app_settings)
    statuses = []
    worker.file_status_signal.connect(lambda p, s: statuses.append((p, s)))
    worker._handle_result("photo.jpg", False, "stopped")
    assert statuses == [("photo.jpg", "cancelled")]
    assert queue.completed == 1
