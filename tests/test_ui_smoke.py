"""Qt UI smoke tests — window creation, pages, combo population."""
from __future__ import annotations

import pytest
from galaxy.ui.pages.audio import AudioPage
from galaxy.ui.pages.image import ImagePage
from galaxy.ui.pages.video import VideoPage
from PySide6.QtWidgets import QComboBox

pytestmark = pytest.mark.ui


def _page(window, index: int):
    return window.stack.widget(index)


def test_window_stack_has_five_pages(galaxy_window):
    assert galaxy_window.stack.count() == 5
    assert isinstance(_page(galaxy_window, 0), ImagePage)
    assert isinstance(_page(galaxy_window, 1), VideoPage)
    assert isinstance(_page(galaxy_window, 2), AudioPage)
    assert galaxy_window.settings_page is _page(galaxy_window, 3)


def test_video_format_combo_populated(galaxy_window):
    video: VideoPage = _page(galaxy_window, 1)
    combo = video.c_fmt
    assert isinstance(combo, QComboBox)
    assert combo.count() >= 5


def test_settings_accel_combo_has_auto(galaxy_window):
    combo = galaxy_window.settings_page.c_accel
    data = [combo.itemData(i) for i in range(combo.count())]
    assert "auto" in data


def test_footer_badge_api(galaxy_window):
    galaxy_window.set_conversion_badge(
        active=True, encoder_label="NVENC p4", done=1, total=3, tier_key="encode_gpu_nvidia",
    )
    assert "NVENC" in galaxy_window.lbl_perf.text()
    assert "1/3" in galaxy_window.lbl_perf.text()
    galaxy_window.set_conversion_badge(active=False)
    assert galaxy_window.lbl_perf.text()


def test_pipeline_hint_on_video_page(galaxy_window):
    video: VideoPage = _page(galaxy_window, 1)
    video.update_pipeline_hint()
    assert video.lbl_pipeline.text()
