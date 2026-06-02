"""UI interaction tests with qtbot."""
from __future__ import annotations

import pytest
from galaxy.ui.pages.image import ImagePage
from galaxy.ui.pages.video import VideoPage
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QComboBox


@pytest.mark.ui
def test_video_combo_selection_changes(qtbot, galaxy_window):
    video: VideoPage = galaxy_window.stack.widget(1)
    combo: QComboBox = video.c_fmt
    assert combo.count() > 1
    combo.setCurrentIndex(1)
    qtbot.wait(50)
    assert combo.currentIndex() == 1


@pytest.mark.ui
def test_image_page_has_format_combo(qtbot, galaxy_window):
    page: ImagePage = galaxy_window.stack.widget(0)
    assert page.c_fmt.count() >= 3


@pytest.mark.ui
def test_settings_language_combo_has_fa_en(qtbot, galaxy_window):
    combo = galaxy_window.settings_page.c_lang
    langs = {combo.itemData(i) for i in range(combo.count())}
    assert langs >= {"fa", "en"}


@pytest.mark.ui
def test_nav_sidebar_selects_pages(qtbot, galaxy_window):
    for row in range(galaxy_window.sidebar.count()):
        galaxy_window.sidebar.setCurrentRow(row)
        qtbot.wait(30)
        assert galaxy_window.stack.currentIndex() == row


@pytest.mark.ui
def test_stop_button_visible_when_converting(qtbot, galaxy_window):
    galaxy_window.show()
    galaxy_window.stack.setCurrentIndex(0)
    qtbot.wait(50)
    page: ImagePage = galaxy_window.stack.widget(0)
    page.file_paths.append("dummy.jpg")
    page._conversion_running = True
    page._sync_action_buttons()
    qtbot.wait(20)
    assert page.btn_stop.isVisible()
    assert page.btn_stop.isEnabled()
    assert not page.btn_run.isEnabled()
    from galaxy.ui.widgets import FormComboBox

    combo = FormComboBox()
    combo.addItems(["A", "B", "C"])
    qtbot.addWidget(combo)
    assert combo.focusPolicy() == Qt.FocusPolicy.StrongFocus
