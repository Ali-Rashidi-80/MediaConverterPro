"""Main application window."""
import logging
import os

from galaxy_fonts import configure_app_typography
from galaxy_i18n import I18n
from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from galaxy.core.constants import APP_NAME, APP_VERSION
from galaxy.core.exceptions import OutputDirError
from galaxy.core.paths import get_application_path, get_bundle_dir, is_frozen, resource_path
from galaxy.core.utils import ensure_writable_dir, get_desktop_path
from galaxy.services.ffmpeg import find_ffmpeg_path, verify_ffmpeg
from galaxy.services.hw_probe import get_system_profile
from galaxy.services.settings import SettingsManager
from galaxy.ui.base_page import BasePage
from galaxy.ui.layout_direction import apply_layout_direction
from galaxy.ui.pages import AboutPage, AudioPage, ImagePage, SettingsPage, VideoPage
from galaxy.ui.theme import build_stylesheet
from galaxy.ui.widgets import set_tip


class GalaxyWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.settings = SettingsManager.load()
        self.setWindowTitle(f"{APP_NAME} — {APP_VERSION}")
        self.resize(1280, 860)
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        icon_path = resource_path('icon.ico') or os.path.join(get_application_path(), 'icon.ico')
        if icon_path and os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        default_out = os.path.join(get_desktop_path(), "GalaxyOutput")
        saved_out = self.settings.get('output_dir', '')
        if saved_out and os.path.isdir(saved_out):
            self.output_dir = saved_out
        else:
            self.output_dir = default_out
        try:
            ensure_writable_dir(self.output_dir)
        except OSError:
            self.output_dir = os.path.join(os.path.expanduser("~"), "GalaxyOutput")
            ensure_writable_dir(self.output_dir)
        self.settings['output_dir'] = self.output_dir
        self.i18n = I18n(self.settings.get('language', 'fa'))
        self.system_profile = None

        self.init_ui()
        self.retranslate_app()
        self._warm_hw_probe()

    def _warm_hw_probe(self):
        try:
            self.system_profile = get_system_profile()
            if self.system_profile:
                from galaxy.services.job_scheduler import GlobalGpuSemaphore
                GlobalGpuSemaphore.configure(
                    self.system_profile.recommended_parallel.gpu_slots
                )
        except Exception:
            self.system_profile = None

    def get_system_profile(self, refresh: bool = False):
        if refresh or self.system_profile is None:
            try:
                self.system_profile = get_system_profile(refresh=refresh)
            except Exception:
                pass
        return self.system_profile

    def set_pipeline_badge(self, text: str | None = None):
        """Legacy/simple badge — tier text only."""
        if not hasattr(self, 'lbl_perf'):
            return
        if text:
            self.lbl_perf.setText(text)
        else:
            self.lbl_perf.setText(self.i18n.t('footer.perf_idle'))
        self.lbl_perf.setVisible(True)

    def set_conversion_badge(
        self,
        *,
        active: bool = False,
        encoder_label: str | None = None,
        done: int = 0,
        total: int = 0,
        tier_key: str | None = None,
    ):
        if not hasattr(self, 'lbl_perf'):
            return
        if not active:
            self.lbl_perf.setText(self.i18n.t('footer.perf_idle'))
            self.lbl_perf.setVisible(True)
            return
        tier = ""
        if tier_key:
            if tier_key.startswith('full_gpu'):
                tier = self.i18n.t('pipeline.full_gpu')
            elif tier_key.startswith('encode_gpu'):
                tier = self.i18n.t('pipeline.encode_only')
            elif tier_key == 'copy':
                tier = self.i18n.t('pipeline.copy')
            else:
                tier = self.i18n.t('pipeline.cpu')
        enc = encoder_label or self.i18n.t('pipeline.cpu')
        prog = f"{done}/{total}" if total > 0 else ""
        self.lbl_perf.setText(self.i18n.t('footer.perf_active', enc=enc, prog=prog, tier=tier))
        self.lbl_perf.setToolTip(self.lbl_perf.text())
        self.lbl_perf.setVisible(True)

    def apply_preferences(self):
        theme = self.settings.get('theme', 'dark_cyan')
        font_key = self.settings.get('font_size', 'medium')
        lang = self.settings.get('language', 'fa')
        self.setStyleSheet(build_stylesheet(theme, font_key, lang))
        app = QApplication.instance()
        if app:
            configure_app_typography(app, lang, font_key)
        for i in range(self.stack.count()):
            w = self.stack.widget(i)
            if isinstance(w, BasePage):
                w.apply_ui_preferences(self.settings)
            elif hasattr(w, 'apply_ui_preferences'):
                w.apply_ui_preferences(self.settings)
        if hasattr(self, "about_page"):
            self.about_page.refresh_content()
        self.set_pipeline_badge()
        apply_layout_direction(self, self.i18n.is_rtl())

    def navigate_to_page(self, index: int):
        if index < 0 or index >= self.stack.count():
            return
        self.sidebar.blockSignals(True)
        self.sidebar.setCurrentRow(index)
        self.sidebar.blockSignals(False)
        self.change_page(index)

    def retranslate_app(self):
        self.i18n.set_lang(self.settings.get('language', 'fa'))
        direction = Qt.LayoutDirection.RightToLeft if self.i18n.is_rtl() else Qt.LayoutDirection.LeftToRight
        self.setLayoutDirection(direction)
        app = QApplication.instance()
        if app:
            app.setLayoutDirection(direction)
        self.lbl_brand_sub.setText(self.i18n.t('app.subtitle'))
        if hasattr(self, 'lbl_brand'):
            self.lbl_brand.setText(self.i18n.t('app.name'))
        nav = [
            ('nav.image', 'nav.tip.image', '🖼️'),
            ('nav.video', 'nav.tip.video', '🎬'),
            ('nav.audio', 'nav.tip.audio', '🎵'),
            ('nav.settings', 'nav.tip.settings', '⚙️'),
            ('nav.help', 'nav.tip.help', '📖'),
        ]
        for i, (key, tip_key, icon) in enumerate(nav):
            item = self.sidebar.item(i)
            if item:
                item.setText(f"{icon}{self.i18n.t(key)}")
                item.setToolTip(self.i18n.t(tip_key))
        self.btn_path.setText(self.i18n.t('footer.change_path'))
        set_tip(self.btn_path, self.i18n.t('footer.change_path_tip'))
        set_tip(self.lbl_path, self.i18n.t('footer.path_tip'))
        for i in range(self.stack.count()):
            w = self.stack.widget(i)
            if hasattr(w, 'retranslate_ui'):
                w.retranslate_ui()
        self.apply_preferences()
        self.update_path_label()
        self._update_engine_status()
        apply_layout_direction(self, self.i18n.is_rtl())

    def _update_engine_status(self):
        ff_path = find_ffmpeg_path()
        ok, detail = verify_ffmpeg(ff_path)
        if ok:
            self.lbl_engine.setText(self.i18n.t('engine.ok'))
            self.lbl_engine.setObjectName("EngineOk")
            tip = detail
            if ff_path:
                tip += f"\n{ff_path}"
                if is_frozen() and ff_path.startswith(get_bundle_dir()):
                    tip += f"\n{self.i18n.t('engine.bundled')}"
            self.lbl_engine.setToolTip(tip)
        else:
            self.lbl_engine.setText(self.i18n.t('engine.bad'))
            self.lbl_engine.setObjectName("EngineBad")
            tip = self.i18n.t(detail) if detail.startswith('engine.') else detail
            self.lbl_engine.setToolTip(f"{tip}\n{self.i18n.t('engine.bad_tip')}")
        self.lbl_engine.style().unpolish(self.lbl_engine)
        self.lbl_engine.style().polish(self.lbl_engine)

    def init_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0,0,0,0); main_layout.setSpacing(0)

        sidebar_wrap = QFrame()
        sidebar_wrap.setObjectName("SidebarBrand")
        sidebar_wrap.setFixedWidth(260)
        sb_lay = QVBoxLayout(sidebar_wrap)
        sb_lay.setContentsMargins(16, 20, 16, 16)
        brand = QLabel(APP_NAME)
        brand.setObjectName("BrandTitle")
        self.lbl_brand = brand
        self.lbl_brand_sub = QLabel()
        self.lbl_brand_sub.setObjectName("BrandSub")
        sb_lay.addWidget(brand)
        sb_lay.addWidget(self.lbl_brand_sub)

        self.sidebar = QListWidget()
        self.sidebar.setObjectName("Sidebar")
        for _ in range(5):
            self.sidebar.addItem("")
        sb_lay.addWidget(self.sidebar, 1)
        main_layout.addWidget(sidebar_wrap)

        content_box = QWidget()
        content_layout = QVBoxLayout(content_box)
        content_layout.setContentsMargins(0,0,0,0)
        content_layout.setSpacing(0)

        self.stack = QStackedWidget()
        self.stack.addWidget(ImagePage(self))
        self.stack.addWidget(VideoPage(self))
        self.stack.addWidget(AudioPage(self))
        self.settings_page = SettingsPage(self)
        self.stack.addWidget(self.settings_page)
        self.about_page = AboutPage(self)
        self.stack.addWidget(self.about_page)
        content_layout.addWidget(self.stack)

        footer = QFrame()
        footer.setObjectName("FooterBar")
        foot_lay = QHBoxLayout(footer)
        self.lbl_path = QLabel()
        self.lbl_path.setObjectName("FooterPath")
        self.lbl_path.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)
        self.update_path_label()

        self.lbl_engine = QLabel()
        self.lbl_engine.setFixedWidth(170)

        self.lbl_perf = QLabel()
        self.lbl_perf.setObjectName("FooterPerf")
        self.lbl_perf.setFixedWidth(280)

        self.btn_path = QPushButton()
        self.btn_path.setFixedWidth(180)
        self.btn_path.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_path.clicked.connect(self.change_output)

        foot_lay.addWidget(self.lbl_path, 1)
        foot_lay.addWidget(self.lbl_engine)
        foot_lay.addWidget(self.lbl_perf)
        foot_lay.addWidget(self.btn_path)
        content_layout.addWidget(footer)

        main_layout.addWidget(content_box)

        self.sidebar.currentRowChanged.connect(self.change_page)
        self.sidebar.setCurrentRow(0)

    def change_page(self, index):
        if index < 0 or not hasattr(self, 'stack'):
            return
        self.stack.setCurrentIndex(index)
        if index == 4 and hasattr(self, "about_page"):
            self.about_page.refresh_content()

    def update_path_label(self):
        text = self.i18n.t('footer.output', name=os.path.basename(self.output_dir))
        self.lbl_path.setText(text)
        self.lbl_path.setToolTip(self.output_dir)

    def change_output(self):
        d = QFileDialog.getExistingDirectory(self, self.i18n.t('dlg.output_dir'), self.output_dir)
        if d:
            try:
                ensure_writable_dir(d)
                self.output_dir = d
                self.settings['output_dir'] = d
                SettingsManager.save(self.settings)
                self.update_path_label()
                if hasattr(self, 'about_page'):
                    self.about_page.refresh_content()
            except OutputDirError as e:
                QMessageBox.critical(
                    self, self.i18n.t('dlg.path_err'),
                    self.i18n.t('dlg.path_err_msg', err=self.i18n.t(e.code, path=e.path)),
                )
            except OSError as e:
                QMessageBox.critical(self, self.i18n.t('dlg.path_err'),
                                     self.i18n.t('dlg.path_err_msg', err=e))

    def closeEvent(self, event):
        logging.info("Initiating PySide6 graceful cleanup...")
        for i in range(self.stack.count()):
            widget = self.stack.widget(i)
            if hasattr(widget, 'worker') and widget.worker and widget.worker.isRunning():
                try:
                    widget.worker.stop()
                    widget.worker.wait(5000)
                except Exception as e:
                    logging.error(f"Error stopping worker: {e}")
        event.accept()
