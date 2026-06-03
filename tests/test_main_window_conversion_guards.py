"""Main window guards while conversion tabs are busy."""
from __future__ import annotations

import pytest
from galaxy.ui.pages.image import ImagePage
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
def test_any_base_page_busy_includes_starting(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    page._starting_conversion = True
    assert galaxy_window._any_base_page_busy()
