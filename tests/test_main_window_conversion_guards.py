"""Main window guards while conversion tabs are busy."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from galaxy.ui.pages.image import ImagePage
from PySide6.QtCore import QThread
from PySide6.QtWidgets import QMessageBox


@pytest.mark.ui
def test_change_output_blocked_while_converting(qtbot, galaxy_window, monkeypatch):
    called = {"dir": False}

    def fake_dialog(*_args, **_kwargs):
        called["dir"] = True
        return ""

    monkeypatch.setattr(
        "galaxy.ui.main_window.QFileDialog.getExistingDirectory",
        fake_dialog,
    )
    page: ImagePage = galaxy_window.stack.widget(0)
    page._conversion_running = True
    monkeypatch.setattr(QMessageBox, "warning", lambda *a, **k: None)
    galaxy_window.change_output()
    assert called["dir"] is False


@pytest.mark.ui
def test_change_output_blocked_while_starting(qtbot, galaxy_window, monkeypatch):
    called = {"dir": False}

    def fake_dialog(*_args, **_kwargs):
        called["dir"] = True
        return ""

    monkeypatch.setattr(
        "galaxy.ui.main_window.QFileDialog.getExistingDirectory",
        fake_dialog,
    )
    page: ImagePage = galaxy_window.stack.widget(0)
    page._starting_conversion = True
    monkeypatch.setattr(QMessageBox, "warning", lambda *a, **k: None)
    galaxy_window.change_output()
    assert called["dir"] is False


@pytest.mark.ui
def test_any_base_page_busy_includes_starting(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page._starting_conversion = True
    assert galaxy_window._any_base_page_busy()


@pytest.mark.ui
def test_close_event_joins_running_worker_when_ui_idle(qtbot, galaxy_window):
    """After finish flags clear, a still-running QThread must still be stop+waited on close."""
    page: ImagePage = galaxy_window.stack.widget(0)
    page._conversion_running = False
    page._starting_conversion = False
    mock_worker = MagicMock()
    running = {"v": True}

    def is_running():
        return running["v"]

    def wait(_timeout=None):
        running["v"] = False
        return True

    mock_worker.isRunning.side_effect = is_running
    mock_worker.wait.side_effect = wait
    page.worker = mock_worker

    galaxy_window.closeEvent(MagicMock())

    mock_worker.stop.assert_called()
    mock_worker.wait.assert_called()
    assert page.worker is None
    assert not page.is_busy()


@pytest.mark.ui
def test_shutdown_retains_worker_ref_if_still_running_after_terminate(qtbot, galaxy_window):
    """force_reset must not null a QThread that is still running after terminate timeout."""
    page: ImagePage = galaxy_window.stack.widget(0)
    page._conversion_running = True
    mock_worker = MagicMock()
    mock_worker.isRunning.return_value = True
    mock_worker.wait.return_value = False  # join / terminate wait both fail
    page.worker = mock_worker

    page.shutdown_conversion_workers(wait_ms=10, terminate_ms=10)

    mock_worker.stop.assert_called()
    mock_worker.terminate.assert_called()
    assert page.worker is mock_worker
    assert not page.is_busy()


@pytest.mark.ui
def test_force_reset_does_not_drop_running_worker_ref(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page._conversion_running = True
    mock_worker = MagicMock()
    mock_worker.isRunning.return_value = True
    page.worker = mock_worker

    page.force_reset_conversion_ui()

    assert page.worker is mock_worker
    assert not page.is_busy()


@pytest.mark.ui
def test_on_finished_keeps_worker_ref_while_thread_running(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("a.jpg")
    page._conversion_running = True
    mock_worker = MagicMock(spec=QThread)
    mock_worker.isRunning.return_value = True
    page.worker = mock_worker
    with patch.object(QMessageBox, "exec", return_value=QMessageBox.StandardButton.Ok):
        page.on_finished()
    assert page.worker is mock_worker
    assert not page._conversion_running
    # Simulated thread exit must clear the retained ref.
    mock_worker.isRunning.return_value = False
    page._on_worker_thread_exited()
    assert page.worker is None
