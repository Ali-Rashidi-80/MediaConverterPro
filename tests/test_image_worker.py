"""ImageWorker tests using pytest-qt waitSignal."""
from __future__ import annotations

import pytest
from galaxy.workers.image_worker import ImageWorker


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
        [str(sample_jpg)], str(temp_output), {"format": "png"}, app_settings,
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
    worker = ImageWorker([], str(temp_output), {}, app_settings)
    with qtbot.waitSignal(worker.finished_all, timeout=5000):
        worker.start()


@pytest.mark.ui
def test_image_worker_bad_output_dir(qtbot, sample_jpg, temp_output, app_settings, monkeypatch):
    monkeypatch.setattr(
        "galaxy.workers.image_worker.ensure_writable_dir",
        lambda p: (_ for _ in ()).throw(OSError("denied")),
    )
    worker = ImageWorker([str(sample_jpg)], str(temp_output), {}, app_settings)
    msgs = []
    worker.log_signal.connect(msgs.append)
    with qtbot.waitSignal(worker.finished_all, timeout=5000):
        worker.start()
    assert msgs
