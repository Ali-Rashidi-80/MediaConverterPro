"""Application settings page."""
from galaxy_i18n import (
    ACCEL_MODE_KEYS,
    FONT_KEYS,
    LANG_KEYS,
    NVENC_PRESET_KEYS,
    PARALLEL_MODE_KEYS,
    QUALITY_PROFILE_KEYS,
    THEME_KEYS,
    UI_MODE_KEYS,
    fill_combo_keys,
)
from PySide6.QtWidgets import (
    QCheckBox,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from galaxy.services.hw_probe import AccelBackend, get_system_profile
from galaxy.services.settings import DEFAULT_SETTINGS, SettingsManager
from galaxy.ui.widgets import FormComboBox, add_form_row, make_hint, make_page_header, set_tip


class SettingsPage(QWidget):
    def __init__(self, parent_window):
        super().__init__()
        self.parent_window = parent_window
        self._field_labels = {}
        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 24)
        root.setSpacing(16)
        header, self.lbl_title, self.lbl_sub = make_page_header("", "")
        root.addWidget(header)

        card = QGroupBox()
        self.card = card
        grid = QGridLayout(card)
        grid.setSpacing(14)

        self.c_lang = FormComboBox()
        self._field_labels['lang'] = add_form_row(grid, 0, "", self.c_lang, "")

        self.c_theme = FormComboBox()
        self._field_labels['theme'] = add_form_row(grid, 1, "", self.c_theme, "")

        self.c_font = FormComboBox()
        self._field_labels['font'] = add_form_row(grid, 2, "", self.c_font, "")

        self.c_mode = FormComboBox()
        self._field_labels['mode'] = add_form_row(grid, 3, "", self.c_mode, "")

        self.chk_steps = QCheckBox()
        grid.addWidget(self.chk_steps, 4, 0, 1, 2)

        self._hint = make_hint("")
        grid.addWidget(self._hint, 5, 0, 1, 2)

        btn_row = QHBoxLayout()
        self.btn_reset = QPushButton()
        self.btn_reset.setObjectName("GhostBtn")
        self.btn_reset.clicked.connect(self._reset_defaults)
        btn_row.addWidget(self.btn_reset)
        btn_row.addStretch()
        grid.addLayout(btn_row, 6, 0, 1, 2)

        root.addWidget(card)

        self.perf_card = QGroupBox()
        perf_grid = QGridLayout(self.perf_card)
        perf_grid.setSpacing(14)

        self.c_parallel = FormComboBox()
        self._field_labels['parallel'] = add_form_row(perf_grid, 0, "", self.c_parallel, "")

        self.spin_max_parallel = QSpinBox()
        self.spin_max_parallel.setRange(0, 16)
        self.spin_max_parallel.setSpecialValueText(self.tr('value.auto'))
        self._field_labels['maxpar'] = add_form_row(perf_grid, 1, "", self.spin_max_parallel, "")

        self.c_accel = FormComboBox()
        self._field_labels['accel'] = add_form_row(perf_grid, 2, "", self.c_accel, "")

        self.c_nvenc = FormComboBox()
        self._field_labels['nvenc'] = add_form_row(perf_grid, 3, "", self.c_nvenc, "")

        self.spin_cpu_threads = QSpinBox()
        self.spin_cpu_threads.setRange(0, 64)
        self.spin_cpu_threads.setSpecialValueText(self.tr('value.auto'))
        self._field_labels['cput'] = add_form_row(perf_grid, 4, "", self.spin_cpu_threads, "")

        self.c_qprof = FormComboBox()
        self._field_labels['qprof'] = add_form_row(perf_grid, 5, "", self.c_qprof, "")

        self._perf_hint = make_hint("")
        perf_grid.addWidget(self._perf_hint, 6, 0, 1, 2)

        root.addWidget(self.perf_card)
        root.addStretch()

        for w in (
            self.c_lang, self.c_theme, self.c_font, self.c_mode, self.chk_steps,
            self.c_parallel, self.spin_max_parallel, self.c_accel, self.c_nvenc,
            self.spin_cpu_threads, self.c_qprof,
        ):
            if hasattr(w, 'currentIndexChanged'):
                w.currentIndexChanged.connect(self._on_change)
            elif hasattr(w, 'valueChanged'):
                w.valueChanged.connect(self._on_change)
            elif hasattr(w, 'toggled'):
                w.toggled.connect(self._on_change)

        self.retranslate_ui()

    def tr(self, key, **kw):
        return self.parent_window.i18n.t(key, **kw)

    def apply_ui_preferences(self, settings):
        is_pro = settings.get('ui_mode') == 'professional'
        self.perf_card.setVisible(is_pro)

    def retranslate_ui(self):
        current = self._collect() if self.c_lang.count() else dict(self.parent_window.settings)
        i18n = self.parent_window.i18n
        self.lbl_title.setText(self.tr('page.settings.title'))
        self.lbl_sub.setText(self.tr('page.settings.sub'))
        self.card.setTitle(self.tr('settings.appearance'))
        self.perf_card.setTitle(self.tr('settings.performance'))
        fill_combo_keys(self.c_lang, LANG_KEYS, i18n, 'lang', i18n.lang)
        fill_combo_keys(self.c_theme, THEME_KEYS, i18n, 'theme', 'dark_cyan')
        fill_combo_keys(self.c_font, FONT_KEYS, i18n, 'font', 'medium')
        fill_combo_keys(self.c_mode, UI_MODE_KEYS, i18n, 'ui', 'simple')
        fill_combo_keys(self.c_parallel, PARALLEL_MODE_KEYS, i18n, 'parallel', 'smart')
        fill_combo_keys(self.c_nvenc, NVENC_PRESET_KEYS, i18n, 'nvenc', 'p4')
        fill_combo_keys(self.c_qprof, QUALITY_PROFILE_KEYS, i18n, 'qprof', 'balanced')
        self._sync_accel_availability()
        self.spin_max_parallel.setSpecialValueText(self.tr('value.auto'))
        self.spin_cpu_threads.setSpecialValueText(self.tr('value.auto'))
        fl = {
            'lang': (self.tr('settings.language'), self.tr('tip.language')),
            'theme': (self.tr('settings.theme'), self.tr('tip.theme')),
            'font': (self.tr('settings.font'), self.tr('tip.font')),
            'mode': (self.tr('settings.ui_mode'), self.tr('tip.ui_mode')),
            'parallel': (self.tr('settings.parallel_mode'), self.tr('tip.parallel_mode')),
            'maxpar': (self.tr('settings.max_parallel'), self.tr('tip.max_parallel')),
            'accel': (self.tr('settings.accel_mode'), self.tr('tip.accel_mode')),
            'nvenc': (self.tr('settings.nvenc_preset'), self.tr('tip.nvenc_preset')),
            'cput': (self.tr('settings.cpu_threads'), self.tr('tip.cpu_threads')),
            'qprof': (self.tr('settings.quality_profile'), self.tr('tip.quality_profile')),
        }
        for k, lbl in self._field_labels.items():
            t, tip = fl[k]
            lbl.setText(t)
            set_tip(lbl, tip)
        set_tip(self.c_lang, self.tr('tip.language'))
        set_tip(self.c_theme, self.tr('tip.theme'))
        set_tip(self.c_font, self.tr('tip.font'))
        set_tip(self.c_mode, self.tr('tip.ui_mode'))
        self.chk_steps.setText(self.tr('chk.show_steps'))
        set_tip(self.chk_steps, self.tr('tip.show_steps'))
        self._hint.setText(self.tr('settings.hint_apply'))
        self._perf_hint.setText(self.tr('settings.hint_apply'))
        self.btn_reset.setText(self.tr('settings.reset'))
        set_tip(self.btn_reset, self.tr('tip.reset'))
        self.apply_ui_preferences(self.parent_window.settings)
        self.load_from_settings(current)

    def _profile(self):
        if self.parent_window and hasattr(self.parent_window, 'get_system_profile'):
            return self.parent_window.get_system_profile()
        try:
            return get_system_profile()
        except Exception:
            return None

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
        nvidia_ok = bool(profile and profile.backend_available(AccelBackend.NVIDIA))
        self.c_nvenc.setEnabled(nvidia_ok)
        if not nvidia_ok:
            set_tip(self.c_nvenc, self.tr('tip.nvenc_unavailable'))
        else:
            set_tip(self.c_nvenc, self.tr('tip.nvenc_preset'))

    def load_from_settings(self, settings):
        def _set(combo, val):
            if combo.count() == 0:
                return
            for i in range(combo.count()):
                if combo.itemData(i) == val:
                    combo.blockSignals(True)
                    combo.setCurrentIndex(i)
                    combo.blockSignals(False)
                    return
            combo.blockSignals(True)
            combo.setCurrentIndex(0)
            combo.blockSignals(False)
        _set(self.c_lang, settings.get('language', 'fa'))
        _set(self.c_theme, settings.get('theme', 'dark_cyan'))
        _set(self.c_font, settings.get('font_size', 'medium'))
        _set(self.c_mode, settings.get('ui_mode', 'simple'))
        self.chk_steps.blockSignals(True)
        self.chk_steps.setChecked(settings.get('show_steps', True))
        self.chk_steps.blockSignals(False)
        _set(self.c_parallel, settings.get('parallel_mode', 'smart'))
        self.spin_max_parallel.blockSignals(True)
        self.spin_max_parallel.setValue(int(settings.get('max_parallel_jobs') or 0))
        self.spin_max_parallel.blockSignals(False)
        _set(self.c_accel, settings.get('accel_mode', 'auto'))
        _set(self.c_nvenc, settings.get('nvenc_preset', 'p4'))
        self.spin_cpu_threads.blockSignals(True)
        self.spin_cpu_threads.setValue(int(settings.get('cpu_threads') or 0))
        self.spin_cpu_threads.blockSignals(False)
        _set(self.c_qprof, settings.get('quality_profile', 'balanced'))

    def _collect(self):
        return {
            'language': self.c_lang.currentData() or 'fa',
            'theme': self.c_theme.currentData() or 'dark_cyan',
            'font_size': self.c_font.currentData() or 'medium',
            'ui_mode': self.c_mode.currentData() or 'simple',
            'show_steps': self.chk_steps.isChecked(),
            'parallel_mode': self.c_parallel.currentData() or 'smart',
            'max_parallel_jobs': self.spin_max_parallel.value(),
            'accel_mode': self.c_accel.currentData() or 'auto',
            'nvenc_preset': self.c_nvenc.currentData() or 'p4',
            'cpu_threads': self.spin_cpu_threads.value(),
            'quality_profile': self.c_qprof.currentData() or 'balanced',
        }

    def _on_change(self, *_):
        lang_changed = self.c_lang.currentData() != self.parent_window.settings.get('language')
        self.parent_window.settings.update(self._collect())
        self.parent_window.settings['output_dir'] = self.parent_window.output_dir
        SettingsManager.save(self.parent_window.settings)
        if lang_changed:
            self.parent_window.retranslate_app()
        else:
            self.parent_window.apply_preferences()

    def _reset_defaults(self):
        defaults = dict(DEFAULT_SETTINGS)
        defaults['output_dir'] = self.parent_window.output_dir
        self.parent_window.settings.update(defaults)
        SettingsManager.save(self.parent_window.settings)
        self.retranslate_ui()
        self.load_from_settings(defaults)
        self.parent_window.retranslate_app()
