"""About / help page — guide, system status, quick actions."""
import os

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)

from galaxy.core.constants import APP_NAME, APP_VERSION, HEIF_SUPPORTED
from galaxy.core.paths import get_bundle_dir, is_frozen
from galaxy.core.utils import ensure_writable_dir, get_desktop_path
from galaxy.services.ffmpeg import FFmpegEngine, find_ffmpeg_path, verify_ffmpeg
from galaxy.services.hw_probe import get_system_profile
from galaxy.ui.help_content import build_help_html
from galaxy.ui.layout_direction import apply_layout_direction
from galaxy.ui.widgets import make_page_header, set_tip


class AboutPage(QWidget):
    SETTINGS_PAGE_INDEX = 3

    def __init__(self, parent_window=None):
        super().__init__()
        self.parent_window = parent_window
        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 20)
        root.setSpacing(14)

        header, self.lbl_title, self.lbl_sub = make_page_header("", "")
        root.addWidget(header)

        self.hero = QFrame()
        self.hero.setObjectName("AboutHero")
        hero_lay = QHBoxLayout(self.hero)
        hero_lay.setContentsMargins(18, 16, 18, 16)
        hero_lay.setSpacing(16)

        hero_text = QVBoxLayout()
        hero_text.setSpacing(4)
        self.lbl_hero_name = QLabel(APP_NAME)
        self.lbl_hero_name.setObjectName("AboutHeroTitle")
        self.lbl_hero_ver = QLabel(APP_VERSION)
        self.lbl_hero_ver.setObjectName("AboutHeroVersion")
        self.lbl_hero_tagline = QLabel()
        self.lbl_hero_tagline.setObjectName("AboutHeroTagline")
        self.lbl_hero_tagline.setWordWrap(True)
        hero_text.addWidget(self.lbl_hero_name)
        hero_text.addWidget(self.lbl_hero_ver)
        hero_text.addWidget(self.lbl_hero_tagline)
        hero_lay.addLayout(hero_text, 1)

        self.lbl_ready = QLabel()
        self.lbl_ready.setObjectName("AboutReadyOk")
        self.lbl_ready.setWordWrap(True)
        self.lbl_ready.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            if self._rtl() else Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter
        )
        hero_lay.addWidget(self.lbl_ready, 1)

        root.addWidget(self.hero)

        scroll = QScrollArea()
        self._scroll_area = scroll
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.browser = QTextBrowser()
        self.browser.setOpenExternalLinks(True)
        self.browser.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setWidget(self.browser)
        root.addWidget(scroll, 1)

        action_bar = QFrame()
        action_bar.setObjectName("AboutActionBar")
        act_lay = QHBoxLayout(action_bar)
        act_lay.setContentsMargins(0, 4, 0, 0)
        act_lay.setSpacing(10)

        self.btn_open = QPushButton()
        self.btn_open.setObjectName("GhostBtn")
        self.btn_open.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_open.clicked.connect(self._open_output_folder)

        self.btn_settings = QPushButton()
        self.btn_settings.setObjectName("GhostBtn")
        self.btn_settings.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_settings.clicked.connect(self._go_settings)

        self.btn_refresh = QPushButton()
        self.btn_refresh.setObjectName("GhostBtn")
        self.btn_refresh.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_refresh.clicked.connect(self._refresh_all)

        act_lay.addWidget(self.btn_open)
        act_lay.addWidget(self.btn_settings)
        act_lay.addWidget(self.btn_refresh)
        act_lay.addStretch()
        root.addWidget(action_bar)

        self.retranslate_ui()

    def _rtl(self) -> bool:
        if self.parent_window and hasattr(self.parent_window, "i18n"):
            return self.parent_window.i18n.is_rtl()
        return True

    def tr(self, key, **kw):
        if self.parent_window and hasattr(self.parent_window, "i18n"):
            return self.parent_window.i18n.t(key, **kw)
        return key

    def retranslate_ui(self):
        self.lbl_title.setText(self.tr("page.help.title"))
        self.lbl_sub.setText(self.tr("page.help.sub"))
        self.lbl_hero_name.setText(self.tr("app.name"))
        self.lbl_hero_ver.setText(APP_VERSION)
        self.lbl_hero_tagline.setText(self.tr("app.subtitle"))
        self.btn_open.setText(self.tr("help.btn_open_output"))
        self.btn_settings.setText(self.tr("help.btn_settings"))
        self.btn_refresh.setText(self.tr("help.btn_refresh"))
        set_tip(self.btn_open, self.tr("help.btn_open_output"))
        set_tip(self.btn_settings, self.tr("help.btn_settings"))
        set_tip(self.btn_refresh, self.tr("help.btn_refresh"))
        align = (
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            if self._rtl() else Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter
        )
        self.lbl_ready.setAlignment(align)
        apply_layout_direction(self, self._rtl())
        self.refresh_content()

    def _system_state(self):
        theme_id = "dark_cyan"
        out_dir = os.path.join(get_desktop_path(), "GalaxyOutput")
        mode_key = "simple"
        if self.parent_window:
            theme_id = self.parent_window.settings.get("theme", "dark_cyan")
            out_dir = self.parent_window.output_dir
            mode_key = self.parent_window.settings.get("ui_mode", "simple")
        mode = self.tr("mode.pro") if mode_key == "professional" else self.tr("mode.simple")

        out_ok = True
        try:
            ensure_writable_dir(out_dir)
        except OSError:
            out_ok = False

        ffmpeg_path = find_ffmpeg_path()
        ff_ok, _ = verify_ffmpeg(ffmpeg_path)
        ff_ver = FFmpegEngine.get_version(ffmpeg_path) if ffmpeg_path else "—"
        bundled = bool(
            ffmpeg_path and is_frozen()
            and ffmpeg_path.startswith(get_bundle_dir())
        )
        return {
            "theme_id": theme_id,
            "out_dir": out_dir,
            "out_ok": out_ok,
            "ff_ok": ff_ok,
            "ff_ver": ff_ver,
            "ff_path": ffmpeg_path,
            "bundled_ffmpeg": bundled,
            "heic_ok": HEIF_SUPPORTED,
            "mode": mode,
            "all_ok": out_ok and ff_ok,
        }

    def refresh_content(self):
        if not self.parent_window:
            return
        state = self._system_state()
        i18n = self.parent_window.i18n

        if state["all_ok"]:
            self.lbl_ready.setText(self.tr("help.hero_ready"))
            self.lbl_ready.setObjectName("AboutReadyOk")
        else:
            self.lbl_ready.setText(self.tr("help.hero_issue"))
            self.lbl_ready.setObjectName("AboutReadyWarn")
        self.lbl_ready.style().unpolish(self.lbl_ready)
        self.lbl_ready.style().polish(self.lbl_ready)

        html = build_help_html(
            i18n,
            state["theme_id"],
            out_dir=state["out_dir"],
            out_ok=state["out_ok"],
            ff_ok=state["ff_ok"],
            ff_ver=state["ff_ver"],
            ff_path=state["ff_path"],
            heic_ok=state["heic_ok"],
            mode=state["mode"],
            bundled_ffmpeg=state["bundled_ffmpeg"],
            hw_profile=self._hw_profile(),
        )
        self.browser.setHtml(html)

    def _open_output_folder(self):
        if not self.parent_window:
            return
        path = self.parent_window.output_dir
        if os.path.isdir(path):
            QDesktopServices.openUrl(QUrl.fromLocalFile(path))

    def _go_settings(self):
        if not self.parent_window:
            return
        self.parent_window.navigate_to_page(self.SETTINGS_PAGE_INDEX)

    def _hw_profile(self):
        if self.parent_window and hasattr(self.parent_window, 'get_system_profile'):
            return self.parent_window.get_system_profile(refresh=True)
        try:
            return get_system_profile(refresh=True)
        except Exception:
            return None

    def _refresh_all(self):
        if not self.parent_window:
            return
        if hasattr(self.parent_window, "_warm_hw_probe"):
            self.parent_window._warm_hw_probe()
        elif hasattr(self.parent_window, "get_system_profile"):
            self.parent_window.get_system_profile(refresh=True)
        if hasattr(self.parent_window, "_update_engine_status"):
            self.parent_window._update_engine_status()
        self.refresh_content()
