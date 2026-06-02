"""MediaWorker audio-path and stop behavior."""
from __future__ import annotations

import pytest
from galaxy.workers.media_worker import MediaWorker
from galaxy.workers.task_queue import ConversionTaskQueue


def test_build_audio_command(tmp_path, app_settings):
    worker = MediaWorker(ConversionTaskQueue([]), str(tmp_path), {"format": "mp3"}, mode="audio", app_settings=app_settings)
    src = tmp_path / "in.wav"
    src.write_bytes(b"RIFF")
    out = tmp_path / "out.mp3"
    cmd, tier, backend = worker._build_command("ffmpeg.exe", str(src), str(out), None)
    assert "libmp3lame" in " ".join(cmd) or "-c:a" in cmd
    assert tier.value == "cpu"
    assert backend is None


def test_stop_sets_not_running(tmp_path, app_settings):
    worker = MediaWorker(ConversionTaskQueue(["x.mp4"]), str(tmp_path), {}, app_settings=app_settings)
    worker.stop()
    assert worker.is_running is False
    assert worker.queue.is_stopped()


@pytest.mark.parametrize("lang,expected_substr", [("en", "Done"), ("fa", "پایان")])
def test_worker_i18n_file_ok_message(tmp_path, lang, expected_substr):
    from galaxy.workers.worker_i18n import WorkerI18n

    msg = WorkerI18n(lang).t("status.file_ok", name="x.mp4")
    assert expected_substr in msg or "x.mp4" in msg
