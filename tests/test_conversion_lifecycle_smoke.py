"""Honest end-to-end lifecycle tests: real ImageWorker, real file I/O, real UI state.

No mocked success/failure outcomes — only deterministic worker settings (sequential slots).
"""
from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import patch

import pytest
from galaxy.ui.pages.image import ImagePage
from galaxy.workers import image_task as image_task_mod
from galaxy.workers.task_queue import ConversionTaskQueue
from PIL import Image
from PySide6.QtWidgets import QMessageBox


def _sequential_image_worker(monkeypatch) -> None:
    monkeypatch.setattr(
        "galaxy.workers.image_worker.compute_slots",
        lambda *a, **k: 1,
    )
    monkeypatch.setattr(
        "galaxy.workers.image_worker.get_system_profile",
        lambda: None,
    )


def _wait_idle(qtbot, page: ImagePage, timeout: int = 30000) -> None:
    """Wait until UI unlocks and the QThread ref is cleared (honest finish race)."""
    qtbot.waitUntil(lambda: not page.is_busy(), timeout=timeout)
    qtbot.waitUntil(
        lambda: page.worker is None or not page.worker.isRunning(),
        timeout=min(10000, timeout),
    )
    if page.worker is not None and not page.worker.isRunning():
        page._on_worker_thread_exited()


@pytest.mark.ui
def test_image_full_cycle_unlocks_start_and_writes_output(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        _wait_idle(qtbot, page, timeout=30000)

    assert not page._conversion_running
    assert not page._starting_conversion
    assert page.worker is None
    assert page.btn_run.isEnabled()
    assert page.btn_run.text() == page.tr("btn.start")
    assert page._row_status_key(0) == "success"

    out_dir = Path(galaxy_window.output_dir)
    outputs = list(out_dir.glob("*"))
    assert outputs, "conversion must produce at least one output file"
    assert any(p.stat().st_size > 0 for p in outputs)


@pytest.mark.ui
def test_image_rerun_after_all_success_second_output(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    paths, is_rerun = page._collect_run_paths()
    assert is_rerun is True
    assert paths == [str(sample_jpg)]
    assert page.btn_run.toolTip() == page.tr("btn.start_rerun_tip")
    first_mtime = max(p.stat().st_mtime for p in Path(galaxy_window.output_dir).glob("*"))

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    assert page._row_status_key(0) == "success"
    assert page.btn_run.isEnabled()
    second_mtime = max(p.stat().st_mtime for p in Path(galaxy_window.output_dir).glob("*"))
    assert second_mtime >= first_mtime


@pytest.mark.ui
def test_stop_during_conversion_restores_start_button(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    original = image_task_mod.convert_image_task

    def slow_convert(*args, **kwargs):
        time.sleep(0.8)
        return original(*args, **kwargs)

    monkeypatch.setattr(
        "galaxy.workers.image_worker.convert_image_task",
        slow_convert,
    )

    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])
    page.start_process()
    qtbot.waitUntil(lambda: page._conversion_running, timeout=5000)
    qtbot.waitUntil(lambda: page._row_status_key(0) == "working", timeout=5000)
    page.stop_process()
    qtbot.waitUntil(lambda: not page.is_busy(), timeout=20000)

    assert page.btn_run.isEnabled()
    assert page.btn_run.text() == page.tr("btn.start")
    assert page._row_status_key(0) == "cancelled"


@pytest.mark.ui
def test_stop_click_disables_stop_button_until_finished(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    original = image_task_mod.convert_image_task

    def slow_convert(*args, **kwargs):
        time.sleep(0.5)
        return original(*args, **kwargs)

    monkeypatch.setattr("galaxy.workers.image_worker.convert_image_task", slow_convert)

    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])
    page.start_process()
    qtbot.waitUntil(lambda: page._conversion_running, timeout=5000)
    page.stop_process()
    assert page._stop_pending
    assert not page.btn_stop.isEnabled()
    qtbot.waitUntil(lambda: not page.is_busy(), timeout=20000)
    assert page.btn_run.isEnabled()


@pytest.mark.ui
def test_clear_list_blocked_while_starting(qtbot, galaxy_window, tmp_path):
    page: ImagePage = galaxy_window.stack.widget(0)
    f = tmp_path / "block.jpg"
    f.write_bytes(b"\xff\xd8\xff\xd9")
    page.process_new_files([str(f)])
    page._starting_conversion = True
    page.clear_list()
    assert len(page.file_paths) == 1
    assert page.table_widget.rowCount() == 1


@pytest.mark.ui
def test_add_file_during_starting_queued_and_enqueued_on_sync(
    qtbot, galaxy_window, tmp_path,
):
    page: ImagePage = galaxy_window.stack.widget(0)
    f1 = tmp_path / "one.jpg"
    f2 = tmp_path / "two.jpg"
    f1.write_bytes(b"\xff\xd8\xff\xd9")
    f2.write_bytes(b"\xff\xd8\xff\xd9")
    page.process_new_files([str(f1)])
    page._starting_conversion = True
    page._task_queue = ConversionTaskQueue([str(f1)])
    page.process_new_files([str(f2)])
    assert page._row_status_key(1) == "queued"
    assert page._task_queue.total == 2
    assert page._task_queue.pending_count() == 2
    synced = page._sync_file_paths_into_task_queue()
    assert synced == []


@pytest.mark.ui
def test_clear_list_after_finish_resets_start_button(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    page.clear_list()
    assert page.file_paths == []
    assert not page.btn_run.isEnabled()
    assert page.btn_run.text() == page.tr("btn.start")
    assert page.lbl_local_status.text() == page.tr("status.ready")


@pytest.mark.ui
def test_mixed_batch_start_only_retries_non_success(galaxy_window, tmp_path):
    page: ImagePage = galaxy_window.stack.widget(0)
    ok = tmp_path / "ok.jpg"
    bad = tmp_path / "bad.jpg"
    ok.write_bytes(b"\xff\xd8\xff\xd9")
    bad.write_bytes(b"\xff\xd8\xff\xd9")
    page.file_paths = [str(ok), str(bad)]
    page.table_widget.setRowCount(2)
    page._set_row_status(0, "success")
    page._set_row_status(1, "fail")
    paths, is_rerun = page._collect_run_paths()
    assert paths == [str(bad)]
    assert is_rerun is False
    assert not page._all_rows_success()


@pytest.mark.ui
def test_stop_then_start_again_completes(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: page._conversion_running, timeout=5000)
        page.stop_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=20000)
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    assert page.btn_run.isEnabled()
    assert page._row_status_key(0) == "success"


@pytest.mark.ui
def test_settings_disabled_during_conversion_reenabled_after(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: page._conversion_running, timeout=5000)
        assert not page.settings_group.isEnabled()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    assert page.settings_group.isEnabled()
    assert page.btn_reset.isEnabled()


@pytest.mark.ui
def test_add_file_during_active_conversion_gets_queued(
    qtbot, galaxy_window, sample_jpg, tmp_path, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    original = image_task_mod.convert_image_task

    def slow_convert(*args, **kwargs):
        time.sleep(0.35)
        return original(*args, **kwargs)

    monkeypatch.setattr("galaxy.workers.image_worker.convert_image_task", slow_convert)

    page: ImagePage = galaxy_window.stack.widget(0)
    f2 = tmp_path / "second.jpg"
    Image.new("RGB", (32, 24), color=(200, 50, 50)).save(f2, "JPEG", quality=90)
    page.process_new_files([str(sample_jpg)])
    page.start_process()
    qtbot.waitUntil(lambda: page._conversion_running, timeout=5000)
    page.process_new_files([str(f2)])
    assert page._row_status_key(1) == "queued"
    assert page._task_queue is not None
    assert page._task_queue.total >= 2

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=45000)

    assert page._row_status_key(0) == "success"
    assert page._row_status_key(1) == "success"
    assert list(Path(galaxy_window.output_dir).glob("*.jpg"))


@pytest.mark.ui
def test_footer_badge_idle_after_finish(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    idle_text = galaxy_window.i18n.t("footer.perf_idle")
    page.process_new_files([str(sample_jpg)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    assert galaxy_window.lbl_perf.text() == idle_text


@pytest.mark.ui
def test_double_start_while_running_starts_single_worker(
    qtbot, galaxy_window, sample_jpg, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    page.process_new_files([str(sample_jpg)])
    page.start_process()
    first_worker = page.worker
    page.start_process()
    assert page.worker is first_worker
    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)


@pytest.mark.ui
def test_mixed_batch_e2e_retries_only_failed_file(
    qtbot, galaxy_window, sample_jpg, tmp_path, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    bad = tmp_path / "corrupt.jpg"
    bad.write_bytes(b"NOT_A_REAL_JPEG_FILE")
    page.process_new_files([str(sample_jpg), str(bad)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    assert page._row_status_key(0) == "success"
    assert page._row_status_key(1) == "fail"
    paths, is_rerun = page._collect_run_paths()
    assert paths == [str(bad)]
    assert is_rerun is False

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=30000)

    assert page._row_status_key(0) == "success"
    assert page._row_status_key(1) == "fail"
    assert page.btn_run.isEnabled()


@pytest.mark.ui
def test_two_file_batch_both_success_and_two_outputs(
    qtbot, galaxy_window, sample_jpg, tmp_path, monkeypatch,
):
    _sequential_image_worker(monkeypatch)
    page: ImagePage = galaxy_window.stack.widget(0)
    f2 = tmp_path / "companion.jpg"
    Image.new("RGB", (40, 30), color=(80, 160, 40)).save(f2, "JPEG", quality=90)
    page.process_new_files([str(sample_jpg), str(f2)])

    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.start_process()
        qtbot.waitUntil(lambda: not page.is_busy(), timeout=45000)

    assert page._row_status_key(0) == "success"
    assert page._row_status_key(1) == "success"
    outputs = list(Path(galaxy_window.output_dir).glob("*"))
    assert len(outputs) >= 2
    assert all(p.stat().st_size > 0 for p in outputs)
