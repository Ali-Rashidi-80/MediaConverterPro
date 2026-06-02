"""Typography and bundled font registration."""
from __future__ import annotations

from unittest.mock import patch

import galaxy_fonts
import pytest


def test_font_scales_defined():
    assert "small" in galaxy_fonts.FONT_SCALES
    assert "medium" in galaxy_fonts.FONT_SCALES
    assert "large" in galaxy_fonts.FONT_SCALES
    for scale in galaxy_fonts.FONT_SCALES.values():
        assert "base" in scale and "title" in scale


def test_fonts_directory_exists():
    path = galaxy_fonts.fonts_directory()
    assert path.endswith("fonts")


def test_register_bundled_fonts_idempotent(monkeypatch):
    monkeypatch.setattr(galaxy_fonts, "_fonts_registered", False)
    monkeypatch.setattr(galaxy_fonts, "_loaded_families", set())
    with patch.object(galaxy_fonts.QFontDatabase, "addApplicationFont", return_value=0):
        with patch("galaxy_fonts.glob.glob", return_value=[]):
            first = galaxy_fonts.register_bundled_fonts()
            second = galaxy_fonts.register_bundled_fonts()
    assert first is False
    assert second is False


def test_ui_font_stack_fa_and_en(monkeypatch):
    monkeypatch.setattr(galaxy_fonts, "register_bundled_fonts", lambda: False)
    monkeypatch.setattr(galaxy_fonts, "_pick_family", lambda c: "TestFont")
    fa_stack = galaxy_fonts.ui_font_stack("fa")
    en_stack = galaxy_fonts.ui_font_stack("en")
    assert "sans-serif" in fa_stack
    assert "sans-serif" in en_stack


@pytest.mark.ui
def test_make_qfont_returns_valid_font(qapp):
    with patch.object(galaxy_fonts, "register_bundled_fonts", return_value=False):
        with patch.object(galaxy_fonts, "primary_ui_family", return_value="Arial"):
            font = galaxy_fonts.make_qfont("fa", "medium")
    assert font.pointSize() > 0 or font.pixelSize() > 0


@pytest.mark.ui
def test_configure_app_typography_sets_font(qapp, monkeypatch):
    monkeypatch.setattr(galaxy_fonts, "register_bundled_fonts", lambda: False)
    monkeypatch.setattr(galaxy_fonts, "primary_ui_family", lambda lang: "Arial")
    galaxy_fonts.configure_app_typography(qapp, "fa", "medium")
    assert qapp.font().family()
