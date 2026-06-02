"""Worker append_tasks during conversion."""
from __future__ import annotations

from galaxy.workers.image_worker import ImageWorker
from galaxy.workers.media_worker import MediaWorker
from galaxy.workers.task_queue import ConversionTaskQueue


def test_media_worker_append_tasks(tmp_path, app_settings):
    queue = ConversionTaskQueue(["a.mp4"])
    worker = MediaWorker(queue, str(tmp_path), {"format": "mp4"}, app_settings=app_settings)
    added = worker.append_tasks(["b.mp4", "a.mp4"])
    assert added == ["b.mp4"]
    assert queue.total == 2


def test_image_worker_append_tasks(tmp_path, app_settings):
    queue = ConversionTaskQueue(["a.jpg"])
    worker = ImageWorker(queue, str(tmp_path), {"format": "png"}, app_settings=app_settings)
    added = worker.append_tasks(["b.jpg"])
    assert added == ["b.jpg"]
    assert queue.total == 2
