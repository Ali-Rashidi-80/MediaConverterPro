"""Audio conversion page."""
from galaxy_i18n import (
    AUDIO_BITRATE,
    AUDIO_FMT_KEYS,
    AUDIO_QUALITY_KEYS,
    CHANNEL_KEYS,
    SAMPLE_RATE_KEYS,
    fill_combo_keys,
    fill_combo_texts,
)
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QCheckBox, QGridLayout, QLabel, QLineEdit, QSlider, QWidget

from galaxy.ui.base_page import BasePage
from galaxy.ui.widgets import FormComboBox, add_form_row, make_advanced_group, make_hint, set_tip


class AudioPage(BasePage):
    PAGE_ID = 'audio'

    def __init__(self, parent):
        super().__init__("audio",
            "*.mp3 *.wav *.aac *.flac *.ogg *.m4a *.wma *.opus *.aiff *.mp4 *.mkv *.ts", parent)
        self._field_labels = {}
        main = QWidget()
        g1 = QGridLayout(main)
        g1.setSpacing(12)
        self.c_fmt = FormComboBox()
        self.c_fmt.addItems(AUDIO_FMT_KEYS)
        self.c_qual = FormComboBox()
        self._field_labels['format'] = add_form_row(g1, 0, "", self.c_fmt, "")
        self._field_labels['aqual'] = add_form_row(g1, 1, "", self.c_qual, "")
        self._hint_main = make_hint("")
        g1.addWidget(self._hint_main, 2, 0, 1, 2)
        self.sets_layout.addWidget(main)
        adv, g2 = make_advanced_group()
        self.advanced_group = adv
        self.c_rate = FormComboBox()
        self.c_channels = FormComboBox()
        self.s_vol = QSlider(Qt.Orientation.Horizontal)
        self.s_vol.setRange(50, 200)
        self.s_vol.setValue(100)
        self.l_vol = QLabel("100%")
        self.l_vol.setObjectName("MonoLabel")
        self.s_vol.valueChanged.connect(lambda v: self.l_vol.setText(f"{v}%"))
        self.chk_norm = QCheckBox()
        self.e_trim_start = QLineEdit()
        self.e_trim_start.setObjectName("MonoField")
        self.e_trim_end = QLineEdit()
        self.e_trim_end.setObjectName("MonoField")
        self._field_labels['rate'] = add_form_row(g2, 0, "", self.c_rate, "")
        self._field_labels['ch'] = add_form_row(g2, 1, "", self.c_channels, "")
        self._field_labels['vol'] = add_form_row(g2, 2, "", self.s_vol, "")
        g2.addWidget(self.l_vol, 2, 2)
        g2.addWidget(self.chk_norm, 3, 0, 1, 2)
        self._field_labels['t0'] = add_form_row(g2, 4, "", self.e_trim_start, "")
        self._field_labels['t1'] = add_form_row(g2, 5, "", self.e_trim_end, "")
        self.sets_layout.addWidget(adv)
        self.c_fmt.currentTextChanged.connect(self._sync_qual_state)

    def retranslate_page(self):
        i18n = self.parent_window.i18n
        fill_combo_texts(self.c_fmt, AUDIO_FMT_KEYS)
        fill_combo_keys(self.c_qual, AUDIO_QUALITY_KEYS, i18n, 'aq', 'good')
        fill_combo_keys(self.c_rate, SAMPLE_RATE_KEYS, i18n, 'sr', 'original')
        fill_combo_keys(self.c_channels, CHANNEL_KEYS, i18n, 'ch', 'original')
        fl = {
            'format': (self.tr('field.format'), self.tr('tip.format.audio')),
            'aqual': (self.tr('field.audio_quality'), self.tr('tip.audio_quality')),
            'rate': (self.tr('field.sample_rate'), self.tr('tip.sample_rate')),
            'ch': (self.tr('field.channels'), self.tr('tip.channels')),
            'vol': (self.tr('field.volume'), self.tr('tip.volume')),
            't0': (self.tr('field.trim_start'), self.tr('tip.trim_start')),
            't1': (self.tr('field.trim_end'), self.tr('tip.trim_end')),
        }
        for k, lbl in self._field_labels.items():
            t, tip = fl[k]
            lbl.setText(t)
            set_tip(lbl, tip)
        set_tip(self.c_fmt, self.tr('tip.format.audio'))
        set_tip(self.c_qual, self.tr('tip.audio_quality'))
        set_tip(self.c_rate, self.tr('tip.sample_rate'))
        set_tip(self.c_channels, self.tr('tip.channels'))
        set_tip(self.s_vol, self.tr('tip.volume'))
        set_tip(self.e_trim_start, self.tr('tip.trim_start'))
        set_tip(self.e_trim_end, self.tr('tip.trim_end'))
        self._hint_main.setText(self.tr('hint.audio_adv'))
        self.advanced_group.setTitle(self.tr('settings.advanced'))
        set_tip(self.advanced_group, self.tr('settings.advanced_tip'))
        self.chk_norm.setText(self.tr('chk.normalize'))
        set_tip(self.chk_norm, self.tr('tip.chk.normalize'))
        self.e_trim_start.setPlaceholderText(self.tr('placeholder.trim_start'))
        self.e_trim_end.setPlaceholderText(self.tr('placeholder.trim_end'))
        self._sync_qual_state(self.c_fmt.currentText())

    def _sync_qual_state(self, fmt_text):
        lossless = fmt_text in ["WAV", "FLAC", "ALAC"]
        self.c_qual.setEnabled(not lossless)

    def get_settings(self):
        adv = self._advanced_enabled()
        sr_key = self.c_rate.currentData() or 'original'
        ch_key = self.c_channels.currentData() or 'original'
        sr = {'44100': 44100, '48000': 48000}.get(str(sr_key), 0)
        ch = {'mono': 1, 'stereo': 2}.get(str(ch_key), 0)
        return {
            'format': self.c_fmt.currentText().lower(),
            'bitrate': AUDIO_BITRATE.get(self.c_qual.currentData() or 'good', '192k'),
            'sample_rate': sr if adv else 0,
            'channels': ch if adv else 0,
            'volume': self.s_vol.value() if adv else 100,
            'normalize': self.chk_norm.isChecked() if adv else False,
            'trim_start': self.e_trim_start.text().strip() if adv else '',
            'trim_end': self.e_trim_end.text().strip() if adv else '',
        }
