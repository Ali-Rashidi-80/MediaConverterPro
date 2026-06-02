"""ImageWorker parallel path with mocked ThreadPoolExecutor."""
from __future__ import annotations

import shutil
from unittest.mock import MagicMock, patch

import pytest
from galaxy.workers.image_worker import ImageWorker
from galaxy.workers.task_queue import ConversionTaskQueue


class _DoneFuture:
    def __init__(self, result):
        self._result = result

    def result(self):
        return self._result


@pytest.mark.ui
def test_image_worker_parallel_pool(qtbot, sample_jpg, temp_output, app_settings, monkeypatch):
    monkeypatch.setattr(
        "galaxy.workers.image_worker.compute_slots",
        lambda s, j: 2,
    )
    monkeypatch.setattr("galaxy.workers.image_worker.get_system_profile", lambda: None)

    img2 = temp_output / "two.jpg"
    shutil.copy(sample_jpg, img2)

    worker = ImageWorker(
        ConversionTaskQueue([str(sample_jpg), str(img2)]),
        str(temp_output),
        {"format": "png"},
        app_settings,
    )

    mock_pool = MagicMock()

    def submit(fn, *args):
        return _DoneFuture(fn(*args))

    mock_pool.submit.side_effect = submit

    def fake_wait(futures, **kwargs):
        if not futures:
            return (set(), set())
        fut = next(iter(futures))
        return ({fut}, set())

    with patch("galaxy.workers.image_worker.ThreadPoolExecutor", return_value=mock_pool):
        with patch("galaxy.workers.image_worker.wait", side_effect=fake_wait):
            statuses = []
            worker.file_status_signal.connect(lambda p, s: statuses.append(s))
            with qtbot.waitSignal(worker.finished_all, timeout=10000):
                worker.start()

    assert statuses.count("success") == 2
    mock_pool.shutdown.assert_called()
