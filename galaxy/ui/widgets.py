"""Reusable UI widget factories."""
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
)


class FormComboBox(QComboBox):
    """Combo box tuned for forms inside QScrollArea (popup + wheel)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setMinimumContentsLength(8)
        self.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)

    def wheelEvent(self, event):
        if self.hasFocus():
            super().wheelEvent(event)
        else:
            event.ignore()

    def showPopup(self):
        super().showPopup()
        view = self.view()
        if not view:
            return
        popup = view.window()
        if popup is None or popup is self.window():
            return
        pos = self.mapToGlobal(self.rect().bottomLeft())
        popup.setMinimumWidth(max(self.width(), 220))
        popup.move(pos)


def make_page_header(title, subtitle):
    wrap = QFrame()
    wrap.setObjectName("PageHeader")
    lay = QVBoxLayout(wrap)
    lay.setContentsMargins(0, 0, 0, 8)
    lay.setSpacing(4)
    t = QLabel(title)
    t.setObjectName("PageTitle")
    s = QLabel(subtitle)
    s.setObjectName("PageSubtitle")
    s.setWordWrap(True)
    lay.addWidget(t)
    lay.addWidget(s)
    return wrap, t, s

def make_steps_guide(steps, arrow='◂'):
    box = QFrame()
    box.setObjectName("StepsGuide")
    lay = QHBoxLayout(box)
    lay.setContentsMargins(14, 12, 14, 12)
    lay.setSpacing(8)
    for i, step in enumerate(steps, 1):
        step_row = QHBoxLayout()
        step_row.setSpacing(8)
        badge = QFrame()
        badge.setObjectName("StepBadge")
        badge_lay = QVBoxLayout(badge)
        badge_lay.setContentsMargins(0, 0, 0, 0)
        num = QLabel(str(i))
        num.setObjectName("StepBadgeNum")
        num.setAlignment(Qt.AlignmentFlag.AlignCenter)
        badge_lay.addWidget(num)
        lbl = QLabel(step)
        lbl.setObjectName("StepLabel")
        step_row.addWidget(badge)
        step_row.addWidget(lbl)
        lay.addLayout(step_row)
        if i < len(steps):
            arrow_lbl = QLabel(arrow)
            arrow_lbl.setObjectName("StepArrow")
            lay.addWidget(arrow_lbl)
    lay.addStretch()
    return box

def set_tip(widget, text):
    """تولتیپ کامل — فقط متن غیرخالی."""
    if widget and text and str(text).strip():
        widget.setToolTip(str(text).strip())
        try:
            widget.setToolTipDuration(10000)
        except AttributeError:
            pass

def make_field_label(text, tip=""):
    lbl = QLabel(text)
    lbl.setObjectName("FieldLabel")
    if tip:
        set_tip(lbl, tip)
    return lbl

def make_hint(text):
    lbl = QLabel(text)
    lbl.setObjectName("HintLabel")
    lbl.setWordWrap(True)
    return lbl

def add_form_row(grid, row, label, widget, tip, span=1):
    lbl = make_field_label(label, tip)
    set_tip(widget, tip)
    grid.addWidget(lbl, row, 0)
    grid.addWidget(widget, row, 1, 1, span)
    return lbl

def make_advanced_group(title=""):
    grp = QGroupBox(title)
    grp.setCheckable(True)
    grp.setChecked(False)
    grp.setObjectName("AdvancedGroup")
    set_tip(grp, "")
    lay = QGridLayout(grp)
    lay.setSpacing(12)
    return grp, lay

class DropZoneFrame(QFrame):
    clicked = Signal()

    def __init__(self, i18n=None):
        super().__init__()
        self._i18n = i18n
        self._enabled = True
        self.setObjectName("DropZone")
        self.setMinimumHeight(110)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        lay = QVBoxLayout(self)
        lay.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.setSpacing(6)
        self.icon_lbl = QLabel()
        self.icon_lbl.setObjectName("DropZoneText")
        self.hint_lbl = QLabel()
        self.hint_lbl.setObjectName("DropZoneHint")
        lay.addWidget(self.icon_lbl)
        lay.addWidget(self.hint_lbl)
        self.retranslate(i18n)

    def set_interactive(self, enabled: bool):
        self._enabled = enabled
        self.setCursor(
            Qt.CursorShape.PointingHandCursor if enabled else Qt.CursorShape.ArrowCursor
        )

    def mousePressEvent(self, event):
        if self._enabled and event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
            event.accept()
            return
        super().mousePressEvent(event)

    def retranslate(self, i18n=None):
        if i18n:
            self._i18n = i18n
        if not self._i18n:
            return
        t = self._i18n
        active = self.property("dragOver")
        self.icon_lbl.setText(t.t('drop.over') if active else t.t('drop.title'))
        self.hint_lbl.setText(t.t('drop.hint'))
        set_tip(self, t.t('drop.tip'))

    def set_drag_over(self, active):
        self.setProperty("dragOver", active)
        self.style().unpolish(self)
        self.style().polish(self)
        if self._i18n:
            self.icon_lbl.setText(self._i18n.t('drop.over') if active else self._i18n.t('drop.title'))

def make_drop_zone(i18n=None):
    return DropZoneFrame(i18n)
