"""Theme and stylesheet smoke tests."""
from __future__ import annotations

import pytest
from galaxy.ui.theme import build_stylesheet


@pytest.mark.parametrize("theme", ["dark_cyan", "dark_purple", "light"])
@pytest.mark.parametrize("lang", ["fa", "en"])
@pytest.mark.ui
def test_build_stylesheet_contains_footer_perf(qapp, theme, lang):
    css = build_stylesheet(theme, "medium", lang)
    assert "FooterPerf" in css
    assert "QMainWindow" in css
