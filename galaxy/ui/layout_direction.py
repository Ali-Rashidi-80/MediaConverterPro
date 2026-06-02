"""RTL/LTR layout direction — scrollbars mirror per language."""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QAbstractScrollArea, QScrollArea, QWidget


def layout_direction(rtl: bool) -> Qt.LayoutDirection:
    return Qt.LayoutDirection.RightToLeft if rtl else Qt.LayoutDirection.LeftToRight


def apply_layout_direction(root: QWidget | None, rtl: bool):
    """Set direction on scroll areas so vertical bars sit left (fa) / right (en)."""
    if root is None:
        return
    direction = layout_direction(rtl)
    for area in root.findChildren(QAbstractScrollArea):
        area.setLayoutDirection(direction)
        try:
            vbar = area.verticalScrollBar()
            hbar = area.horizontalScrollBar()
            if vbar:
                vbar.setLayoutDirection(direction)
            if hbar:
                hbar.setLayoutDirection(direction)
        except AttributeError:
            pass
    for area in root.findChildren(QScrollArea):
        area.setLayoutDirection(direction)
