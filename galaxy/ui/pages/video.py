"""Video conversion page."""
from galaxy_i18n import (
    ACCEL_MODE_KEYS,
    CODEC_KEYS,
    CODEC_MAP,
    CRF_BY_QUALITY,
    ENC_SPEED_KEYS,
    ENC_SPEED_MAP,
    FPS_KEYS,
    QUALITY_KEYS,
    ROTATE_DEG,
    ROTATE_KEYS,
    VIDEO_FMT_KEYS,
    VIDEO_PRESET_KEYS,
    VIDEO_PRESET_VAL,
    fill_combo_keys,
    fill_combo_texts,
)
from PySide6.QtWidgets import QCheckBox, QGridLayout, QLineEdit, QWidget

from galaxy.services.ffmpeg_pipeline import pick_pipeline_tier, tier_label
from galaxy.services.hw_probe import AccelBackend, get_system_profile
from galaxy.ui.base_page import BasePage
from galaxy.ui.widgets import FormComboBox, add_form_row, make_advanced_group, make_hint, set_tip


class VideoPage(BasePage):
    PAGE_ID = 'video'

    def __init__(self, parent):
        super().__init__("video",
            "*.mp4 *.mkv *.avi *.mov *.webm *.flv *.ts *.m4v *.3gp *.mpeg *.mpg *.wmv *.mts", parent)
        self._field_labels = {}
        main = QWidget()
        grid = QGridLayout(main)
        grid.setSpacing(12)
        self.c_fmt = FormComboBox()
        self.c_fmt.addItems(VIDEO_FMT_KEYS)
        self.c_preset = FormComboBox()
        self.c_qual = FormComboBox()
        self._field_labels['format'] = add_form_row(grid, 0, "", self.c_fmt, "")
        self._field_labels['use'] = add_form_row(grid, 1, "", self.c_preset, "")
        self._field_labels['vqual'] = add_form_row(grid, 2, "", self.c_qual, "")
        self._hint_main = make_hint("")
        grid.addWidget(self._hint_main, 3, 0, 1, 2)
        self.sets_layout.addWidget(main)
        adv, g2 = make_advanced_group()
        self.advanced_group = adv
        self.c_cod = FormComboBox()
        self.c_enc_preset = FormComboBox()
        self.c_rot = FormComboBox()
        self.c_fps = FormComboBox()
        self.c_accel = FormComboBox()
        self.e_trim_start = QLineEdit()
        self.e_trim_start.setObjectName("MonoField")
        self.e_trim_end = QLineEdit()
        self.e_trim_end.setObjectName("MonoField")
        self.chk_denoise = QCheckBox()
        self.chk_sharpen = QCheckBox()
        self.chk_no_audio = QCheckBox()
        self.chk_no_subs = QCheckBox()
        self._field_labels['codec'] = add_form_row(g2, 0, "", self.c_cod, "")
        self._field_labels['speed'] = add_form_row(g2, 1, "", self.c_enc_preset, "")
        self._field_labels['rotate'] = add_form_row(g2, 2, "", self.c_rot, "")
        self._field_labels['fps'] = add_form_row(g2, 3, "", self.c_fps, "")
        self._field_labels['t0'] = add_form_row(g2, 4, "", self.e_trim_start, "")
        self._field_labels['t1'] = add_form_row(g2, 5, "", self.e_trim_end, "")
        self._field_labels['accel'] = add_form_row(g2, 6, "", self.c_accel, "")
        g2.addWidget(self.chk_denoise, 7, 0)
        g2.addWidget(self.chk_sharpen, 7, 1)
        g2.addWidget(self.chk_no_audio, 8, 0)
        g2.addWidget(self.chk_no_subs, 8, 1)
        self.sets_layout.addWidget(adv)
        self.c_fmt.currentTextChanged.connect(self._sync_video_ui)
        self.c_preset.currentIndexChanged.connect(self._sync_video_ui)
        self.c_preset.currentIndexChanged.connect(self._sync_pipeline_hint)
        self.c_fmt.currentIndexChanged.connect(self._sync_pipeline_hint)
        self.c_cod.currentIndexChanged.connect(self._sync_pipeline_hint)
        self.c_accel.currentIndexChanged.connect(self._sync_pipeline_hint)
        self.chk_denoise.toggled.connect(self._sync_pipeline_hint)
        self.chk_sharpen.toggled.connect(self._sync_pipeline_hint)

    def retranslate_page(self):
        i18n = self.parent_window.i18n
        fill_combo_texts(self.c_fmt, VIDEO_FMT_KEYS)
        fill_combo_keys(self.c_preset, VIDEO_PRESET_KEYS, i18n, 'vpreset', 'original')
        fill_combo_keys(self.c_qual, QUALITY_KEYS, i18n, 'quality', 'good')
        fill_combo_keys(self.c_cod, CODEC_KEYS, i18n, 'codec', 'auto')
        fill_combo_keys(self.c_enc_preset, ENC_SPEED_KEYS, i18n, 'enc', 'medium')
        fill_combo_keys(self.c_rot, ROTATE_KEYS, i18n, 'rotate', 'none')
        fill_combo_keys(self.c_fps, FPS_KEYS, i18n, 'fps', 'original')
        self._sync_accel_availability()
        fl = {
            'format': (self.tr('field.format'), self.tr('tip.format.video')),
            'use': (self.tr('field.use_case'), self.tr('tip.use_case')),
            'vqual': (self.tr('field.video_quality'), self.tr('tip.video_quality')),
            'codec': (self.tr('field.codec'), self.tr('tip.codec')),
            'speed': (self.tr('field.enc_speed'), self.tr('tip.enc_speed')),
            'rotate': (self.tr('field.rotate'), self.tr('tip.rotate')),
            'fps': (self.tr('field.fps'), self.tr('tip.fps')),
            't0': (self.tr('field.trim_start'), self.tr('tip.trim_start')),
            't1': (self.tr('field.trim_end'), self.tr('tip.trim_end')),
            'accel': (self.tr('field.accel'), self.tr('tip.accel')),
        }
        for k, lbl in self._field_labels.items():
            t, tip = fl[k]
            lbl.setText(t)
            set_tip(lbl, tip)
        set_tip(self.c_fmt, self.tr('tip.format.video'))
        set_tip(self.c_preset, self.tr('tip.use_case'))
        set_tip(self.c_qual, self.tr('tip.video_quality'))
        set_tip(self.c_cod, self.tr('tip.codec'))
        set_tip(self.c_enc_preset, self.tr('tip.enc_speed'))
        set_tip(self.c_rot, self.tr('tip.rotate'))
        set_tip(self.c_fps, self.tr('tip.fps'))
        set_tip(self.e_trim_start, self.tr('tip.trim_start'))
        set_tip(self.e_trim_end, self.tr('tip.trim_end'))
        set_tip(self.c_accel, self.tr('tip.accel'))
        self._hint_main.setText(self.tr('hint.video_adv'))
        self.advanced_group.setTitle(self.tr('settings.advanced'))
        set_tip(self.advanced_group, self.tr('settings.advanced_tip'))
        self.chk_denoise.setText(self.tr('chk.denoise'))
        self.chk_sharpen.setText(self.tr('chk.sharpen'))
        self.chk_no_audio.setText(self.tr('chk.no_audio'))
        self.chk_no_subs.setText(self.tr('chk.no_subs'))
        set_tip(self.chk_denoise, self.tr('tip.chk.denoise'))
        set_tip(self.chk_sharpen, self.tr('tip.chk.sharpen'))
        set_tip(self.chk_no_audio, self.tr('tip.chk.no_audio'))
        set_tip(self.chk_no_subs, self.tr('tip.chk.no_subs'))
        self.e_trim_start.setPlaceholderText(self.tr('placeholder.trim_start'))
        self.e_trim_end.setPlaceholderText(self.tr('placeholder.trim_end'))
        self._sync_video_ui()
        self._sync_pipeline_hint()

    def _profile(self):
        if self.parent_window and hasattr(self.parent_window, 'get_system_profile'):
            return self.parent_window.get_system_profile()
        try:
            return get_system_profile()
        except Exception:
            return None

    def _merged_settings(self):
        s = self.get_settings()
        if self.parent_window:
            for k in ('accel_mode', 'nvenc_preset', 'quality_profile', 'parallel_mode'):
                if k not in s and k in self.parent_window.settings:
                    s[k] = self.parent_window.settings[k]
        return s

    def _sync_accel_availability(self):
        profile = self._profile()
        i18n = self.parent_window.i18n
        current = self.c_accel.currentData() or 'auto'
        self.c_accel.blockSignals(True)
        self.c_accel.clear()
        for key in ACCEL_MODE_KEYS:
            if key in ('nvidia', 'amd', 'intel') and profile:
                try:
                    if not profile.backend_available(AccelBackend(key)):
                        continue
                except Exception:
                    continue
            self.c_accel.addItem(i18n.t(f'accel.{key}'), key)
        idx = self.c_accel.findData(current)
        if idx >= 0:
            self.c_accel.setCurrentIndex(idx)
        elif self.c_accel.count():
            self.c_accel.setCurrentIndex(0)
        self.c_accel.blockSignals(False)

    def _sync_video_ui(self, *_):
        preset_key = self.c_preset.currentData() or 'original'
        is_copy = preset_key == 'fast_copy'
        fmt = self.c_fmt.currentText()
        self.c_qual.setEnabled(not is_copy)
        self.c_cod.setEnabled(not is_copy and fmt not in ["GIF", "WEBM"])
        if fmt == "WEBM":
            idx = self.c_cod.findData('vp9')
            if idx >= 0:
                self.c_cod.setCurrentIndex(idx)
        self._sync_pipeline_hint()

    def _sync_pipeline_hint(self, *_):
        if self.worker and self.worker.isRunning():
            return
        try:
            profile = self._profile()
            tier, backend = pick_pipeline_tier(self._merged_settings(), profile)
            key = tier_label(tier, backend)
            mapping = {
                'copy': 'pipeline.copy',
                'cpu': 'pipeline.cpu',
            }
            if key.startswith('full_gpu'):
                text = self.tr('pipeline.full_gpu')
            elif key.startswith('encode_gpu'):
                text = self.tr('pipeline.encode_only')
            else:
                text = self.tr(mapping.get(key, 'pipeline.cpu'))
            self.lbl_pipeline.setText(text)
            self.lbl_pipeline.setVisible(True)
        except Exception:
            self.lbl_pipeline.setVisible(False)

    def update_pipeline_hint(self):
        self._sync_pipeline_hint()

    def get_settings(self):
        preset_key = self.c_preset.currentData() or 'original'
        adv = self._advanced_enabled()
        fps_key = self.c_fps.currentData() or 'original'
        fps = int(fps_key) if str(fps_key).isdigit() else 0
        rot_key = self.c_rot.currentData() or 'none'
        cod_key = self.c_cod.currentData() or 'auto'
        enc_key = self.c_enc_preset.currentData() or 'medium'
        settings = {
            'format': self.c_fmt.currentText().lower(),
            'codec': CODEC_MAP.get(cod_key, 'H.264') if adv else 'H.264',
            'video_preset': VIDEO_PRESET_VAL.get(preset_key, preset_key),
            'copy_streams': preset_key == 'fast_copy',
            'crf': CRF_BY_QUALITY.get(self.c_qual.currentData() or 'good', 23),
            'enc_preset': ENC_SPEED_MAP.get(enc_key, 'medium') if adv else 'medium',
            'rotate': ROTATE_DEG.get(rot_key, 0) if adv else 0,
            'fps': fps if adv else 0,
            'trim_start': self.e_trim_start.text().strip() if adv else '',
            'trim_end': self.e_trim_end.text().strip() if adv else '',
            'denoise': self.chk_denoise.isChecked() if adv else False,
            'sharpen': self.chk_sharpen.isChecked() if adv else False,
            'strip_audio': self.chk_no_audio.isChecked() if adv else False,
            'strip_subs': self.chk_no_subs.isChecked() if adv else False,
        }
        if adv:
            accel = self.c_accel.currentData() or 'auto'
            if accel != 'auto':
                settings['accel_mode'] = accel
        return settings
