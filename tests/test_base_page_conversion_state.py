"""Conversion action-bar state (start/stop) must not depend on QThread.isRunning()."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from galaxy.ui.pages.image import ImagePage
from galaxy.ui.pages.video import VideoPage
from galaxy.workers.task_queue import ConversionTaskQueue
from PySide6.QtCore import QThread
from PySide6.QtWidgets import QMessageBox


@pytest.fixture
def _no_finish_dialog():
    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        yield


@pytest.mark.ui
def test_is_converting_ignores_qthread_running(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = False
    mock_worker = MagicMock(spec=QThread)
    mock_worker.isRunning.return_value = True
    page.worker = mock_worker
    assert not page._is_converting()


@pytest.mark.ui
def test_on_finished_restores_start_when_thread_still_running(qtbot, galaxy_window, _no_finish_dialog):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = True
    page.worker = None
    page.on_finished()
    qtbot.wait(20)
    assert not page._conversion_running
    assert page.btn_run.isEnabled()
    assert page.btn_run.text() == page.tr("btn.start")


@pytest.mark.ui
def test_clear_list_after_finish_does_not_stick_converting(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = False
    mock_worker = MagicMock(spec=QThread)
    mock_worker.isRunning.return_value = True
    page.worker = mock_worker
    page.clear_list()
    qtbot.wait(20)
    assert page.btn_run.text() != page.tr("status.converting")
    assert not page.btn_run.isEnabled()


@pytest.mark.ui
def test_refresh_stats_does_not_clobber_converting_status(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = True
    page.lbl_local_status.setText(page.tr("status.converting"))
    page._refresh_stats()
    qtbot.wait(10)
    assert page.lbl_local_status.text() == page.tr("status.converting")


@pytest.mark.ui
def test_thread_exit_before_finished_slot_still_finishes(qtbot, galaxy_window, _no_finish_dialog):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = True
    page._success_count = 1
    page._fail_count = 0
    page._on_worker_thread_exited()
    qtbot.wait(20)
    assert not page._conversion_running
    assert page.btn_run.isEnabled()


@pytest.mark.ui
def test_late_pipeline_signal_ignored_after_finish(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.lbl_pipeline.setText("KEEP")
    page.lbl_pipeline.setVisible(True)
    page._conversion_running = False
    page._on_pipeline_update("cpu")
    qtbot.wait(10)
    assert page.lbl_pipeline.text() == "KEEP"


@pytest.mark.ui
def test_late_file_status_ignored_after_finish(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = False
    page._success_count = 0
    page._track_file_result("a.jpg", "success")
    assert page._success_count == 0


@pytest.mark.ui
def test_sibling_tab_still_converting(qtbot, galaxy_window):
    image: ImagePage = galaxy_window.stack.widget(0)
    video: VideoPage = galaxy_window.stack.widget(1)
    image._conversion_running = True
    assert video._sibling_pages_busy()


@pytest.mark.ui
def test_force_reset_clears_stuck_flags(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = True
    page._starting_conversion = True
    page._stop_pending = True
    page.force_reset_conversion_ui()
    qtbot.wait(10)
    assert not page.is_busy()
    assert page.btn_run.isEnabled()


@pytest.mark.ui
def test_files_added_during_starting_append_to_queue(qtbot, galaxy_window, tmp_path):
    page: ImagePage = galaxy_window.stack.widget(0)
    f1 = tmp_path / "a.jpg"
    f2 = tmp_path / "b.jpg"
    f1.write_bytes(b"\xff\xd8\xff")
    f2.write_bytes(b"\xff\xd8\xff")
    page.file_paths = [str(f1)]
    page.table_widget.setRowCount(1)
    page._set_row_status(0, "pending")
    page._starting_conversion = True
    page._conversion_running = False
    page._task_queue = ConversionTaskQueue([str(f1)])
    page.process_new_files([str(f2)])
    qtbot.wait(10)
    assert str(f2) in page.file_paths
    assert page._row_status_key(1) == "queued"
    assert page._task_queue.total == 2
    assert page._task_queue.pending_count() == 2


@pytest.mark.ui
def test_sync_queue_picks_up_files_added_before_worker_start(qtbot, galaxy_window, tmp_path):
    page: ImagePage = galaxy_window.stack.widget(0)
    f1 = tmp_path / "a.jpg"
    f2 = tmp_path / "c.jpg"
    f1.write_bytes(b"\xff\xd8\xff")
    f2.write_bytes(b"\xff\xd8\xff")
    page.file_paths = [str(f1), str(f2)]
    page.table_widget.setRowCount(2)
    page._set_row_status(0, "queued")
    page._set_row_status(1, "queued")
    page._task_queue = ConversionTaskQueue([str(f1)])
    synced = page._sync_file_paths_into_task_queue()
    assert str(f2) in synced
    assert page._task_queue.total == 2


@pytest.mark.ui
def test_start_locked_while_preparing(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._starting_conversion = True
    page._sync_action_buttons()
    assert not page.btn_run.isEnabled()
    assert page.btn_run.text() == page.tr("btn.start")


@pytest.mark.ui
def test_stop_without_worker_invokes_finish(qtbot, galaxy_window, _no_finish_dialog):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = True
    page.worker = None
    page.stop_process()
    qtbot.wait(20)
    assert not page._conversion_running
    assert page.btn_run.isEnabled()


@pytest.mark.ui
def test_on_finished_idempotent(qtbot, galaxy_window, _no_finish_dialog):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = True
    page._success_count = 1
    page._fail_count = 0
    page.on_finished()
    page.on_finished()
    qtbot.wait(20)
    assert not page._conversion_running
    assert page.btn_run.isEnabled()
