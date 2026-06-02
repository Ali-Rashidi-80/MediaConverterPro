"""Image conversion page."""
from galaxy_i18n import (
    IMAGE_FMT_KEYS,
    IMAGE_QUALITY_KEYS,
    IMAGE_QUALITY_VAL,
    IMAGE_SIZE_KEYS,
    IMAGE_SIZE_VAL,
    ROTATE_DEG,
    ROTATE_SIMPLE_KEYS,
    fill_combo_keys,
    fill_combo_texts,
)
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QCheckBox, QGridLayout, QLabel, QSlider, QWidget

from galaxy.ui.base_page import BasePage
from galaxy.ui.widgets import FormComboBox, add_form_row, make_advanced_group, make_hint, set_tip


class ImagePage(BasePage):
    PAGE_ID = 'image'

    def __init__(self, parent):
        super().__init__("image", "*.jpg *.jpeg *.png *.webp *.bmp *.heic *.tiff *.tif *.gif", parent)
        self._field_labels = {}
        main = QWidget()
        grid = QGridLayout(main)
        grid.setSpacing(12)
        self.c_fmt = FormComboBox()
        self.c_fmt.addItems(IMAGE_FMT_KEYS)
        self.c_qual = FormComboBox()
        self.c_size = FormComboBox()
        self._field_labels['format'] = add_form_row(grid, 0, "", self.c_fmt, "")
        self._field_labels['quality'] = add_form_row(grid, 1, "", self.c_qual, "")
        self._field_labels['size'] = add_form_row(grid, 2, "", self.c_size, "")
        self._hint_main = make_hint("")
        grid.addWidget(self._hint_main, 3, 0, 1, 2)
        self.sets_layout.addWidget(main)
        adv, adv_grid = make_advanced_group()
        self.advanced_group = adv
        self.c_rot = FormComboBox()
        self.chk_flip_h = QCheckBox()
        self.chk_flip_v = QCheckBox()
        self.chk_gray = QCheckBox()
        self.s_qual = QSlider(Qt.Orientation.Horizontal)
        self.s_qual.setRange(10, 100)
        self.s_qual.setValue(85)
        self.l_qual = QLabel("85%")
        self.l_qual.setObjectName("MonoLabel")
        self.s_qual.valueChanged.connect(lambda v: self.l_qual.setText(f"{v}%"))
        self._field_labels['rotate'] = add_form_row(adv_grid, 0, "", self.c_rot, "")
        adv_grid.addWidget(self.chk_flip_h, 1, 0, 1, 2)
        adv_grid.addWidget(self.chk_flip_v, 2, 0, 1, 2)
        adv_grid.addWidget(self.chk_gray, 3, 0, 1, 2)
        self._field_labels['fine'] = add_form_row(adv_grid, 4, "", self.s_qual, "", span=1)
        adv_grid.addWidget(self.l_qual, 4, 2)
        self.sets_layout.addWidget(adv)

    def retranslate_page(self):
        i18n = self.parent_window.i18n
        fill_combo_texts(self.c_fmt, IMAGE_FMT_KEYS)
        fill_combo_keys(self.c_qual, IMAGE_QUALITY_KEYS, i18n, 'imgq', 'good')
        fill_combo_keys(self.c_size, IMAGE_SIZE_KEYS, i18n, 'size', 'original')
        fill_combo_keys(self.c_rot, ROTATE_SIMPLE_KEYS, i18n, 'rotate', 'none')
        fl = {
            'format': (self.tr('field.format'), self.tr('tip.format.image')),
            'quality': (self.tr('field.quality'), self.tr('tip.quality.image')),
            'size': (self.tr('field.size'), self.tr('tip.size')),
            'rotate': (self.tr('field.rotate'), self.tr('tip.rotate')),
            'fine': (self.tr('field.fine_quality'), self.tr('tip.fine_quality')),
        }
        for k, lbl in self._field_labels.items():
            t, tip = fl[k]
            lbl.setText(t)
            set_tip(lbl, tip)
        set_tip(self.c_fmt, self.tr('tip.format.image'))
        set_tip(self.c_qual, self.tr('tip.quality.image'))
        set_tip(self.c_size, self.tr('tip.size'))
        set_tip(self.c_rot, self.tr('tip.rotate'))
        set_tip(self.s_qual, self.tr('tip.fine_quality'))
        self._hint_main.setText(self.tr('hint.image_adv'))
        self.advanced_group.setTitle(self.tr('settings.advanced'))
        set_tip(self.advanced_group, self.tr('settings.advanced_tip'))
        self.chk_flip_h.setText(self.tr('chk.flip_h'))
        self.chk_flip_v.setText(self.tr('chk.flip_v'))
        self.chk_gray.setText(self.tr('chk.gray'))
        set_tip(self.chk_flip_h, self.tr('tip.chk.flip_h'))
        set_tip(self.chk_flip_v, self.tr('tip.chk.flip_v'))
        set_tip(self.chk_gray, self.tr('tip.chk.gray'))

    def get_settings(self):
        fmt = self.c_fmt.currentText().lower()
        adv = self._advanced_enabled()
        quality = IMAGE_QUALITY_VAL.get(self.c_qual.currentData() or 'good', 85)
        if adv:
            quality = self.s_qual.value()
        rot_key = self.c_rot.currentData() or 'none'
        return {
            'format': 'jpg' if fmt == 'jpeg' else fmt,
            'quality': quality,
            'resize': IMAGE_SIZE_VAL.get(self.c_size.currentData() or 'original', 100),
            'rotate': ROTATE_DEG.get(rot_key, 0) if adv else 0,
            'flip_h': self.chk_flip_h.isChecked() if adv else False,
            'flip_v': self.chk_flip_v.isChecked() if adv else False,
            'grayscale': self.chk_gray.isChecked() if adv else False,
        }
