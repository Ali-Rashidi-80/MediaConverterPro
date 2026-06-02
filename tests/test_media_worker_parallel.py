"""MediaWorker parallel path — ThreadPool (no process spawn) + main-thread signals."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from galaxy.workers.media_worker import MediaWorker
from galaxy.workers.task_queue import ConversionTaskQueue


class _DoneFuture:
    def __init__(self, result):
        self._result = result

    def result(self):
        return self._result


@pytest.mark.ui
def test_media_worker_parallel_uses_thread_pool(qtbot, tmp_path, app_settings, monkeypatch):
    monkeypatch.setattr(
        "galaxy.workers.media_worker.compute_slots",
        lambda s, j: 2,
    )
    monkeypatch.setattr("galaxy.workers.media_worker.get_system_profile", lambda: None)
    monkeypatch.setattr(
        MediaWorker,
        "get_ffmpeg_path",
        lambda self: "ffmpeg.exe",
    )
    pipeline_calls = {"n": 0}

    def fake_convert(self, ffmpeg_cmd, profile, file_path, idx, total, slots, emit_progress=True):
        pipeline_calls["n"] += 1
        key = "cpu" if pipeline_calls["n"] == 1 else None
        return (file_path, True, "out.mp4", key, False)

    monkeypatch.setattr(MediaWorker, "_convert_one", fake_convert)

    queue = ConversionTaskQueue([str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")])
    worker = MediaWorker(queue, str(tmp_path), {"format": "mp4"}, mode="video", app_settings=app_settings)

    mock_pool = MagicMock()
    mock_pool.submit.side_effect = lambda fn, *a, **k: _DoneFuture(fn(*a, **k))

    pipeline_keys = []
    worker.pipeline_signal.connect(pipeline_keys.append)
    statuses = []
    worker.file_status_signal.connect(lambda p, s: statuses.append(s))

    with patch("galaxy.workers.media_worker.ThreadPoolExecutor", return_value=mock_pool):
        with patch("galaxy.workers.media_worker.wait") as mock_wait:
            def fake_wait(futures, **kwargs):
                if not futures:
                    return (set(), set())
                fut = next(iter(futures))
                return ({fut}, set())

            mock_wait.side_effect = fake_wait
            with qtbot.waitSignal(worker.finished_all, timeout=10000):
                worker.start()

    assert statuses.count("success") == 2
    assert pipeline_keys == ["cpu"]
    mock_pool.shutdown.assert_called()


def test_media_worker_no_process_pool_import():
    import galaxy.workers.image_worker as iw
    import galaxy.workers.media_worker as mw

    assert "ProcessPoolExecutor" not in open(mw.__file__, encoding="utf-8").read()
    assert "ProcessPoolExecutor" not in open(iw.__file__, encoding="utf-8").read()
