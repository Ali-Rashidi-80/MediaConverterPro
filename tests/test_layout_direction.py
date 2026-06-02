"""RTL/LTR layout direction helpers."""
from __future__ import annotations

import pytest
from galaxy.ui.layout_direction import apply_layout_direction, layout_direction
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QScrollArea, QWidget


@pytest.mark.ui
def test_layout_direction_values():
    assert layout_direction(True) == Qt.LayoutDirection.RightToLeft
    assert layout_direction(False) == Qt.LayoutDirection.LeftToRight


@pytest.mark.ui
def test_apply_layout_direction_on_scroll_area(qapp):
    root = QWidget()
    area = QScrollArea(root)
    apply_layout_direction(root, rtl=True)
    assert area.layoutDirection() == Qt.LayoutDirection.RightToLeft
    apply_layout_direction(root, rtl=False)
    assert area.layoutDirection() == Qt.LayoutDirection.LeftToRight
    root.close()


def test_apply_layout_direction_none_is_noop():
    apply_layout_direction(None, rtl=True)
