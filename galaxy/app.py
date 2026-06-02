"""Application entry point."""
import logging
import multiprocessing
import os
import sys

from galaxy_fonts import configure_app_typography, register_bundled_fonts
from galaxy_i18n import I18n
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QMessageBox

from galaxy.core.constants import APP_NAME, APP_VERSION
from galaxy.core.logging_config import setup_logging
from galaxy.services.settings import SettingsManager
from galaxy.ui.main_window import GalaxyWindow


def main():
    if multiprocessing.current_process().name != "MainProcess":
        return

    os.environ.setdefault("QT_AUTO_SCREEN_SCALE_FACTOR", "1")
    os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "1")
    try:
        QApplication.setHighDpiScaleFactorRoundingPolicy(
            Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    except AttributeError:
        pass

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationVersion(APP_VERSION)
    app.setStyle("Fusion")
    prefs = SettingsManager.load()
    lang = prefs.get('language', 'fa')
    register_bundled_fonts()
    configure_app_typography(app, lang, prefs.get('font_size', 'medium'))
    direction = Qt.LayoutDirection.RightToLeft if lang == 'fa' else Qt.LayoutDirection.LeftToRight
    app.setLayoutDirection(direction)
    setup_logging()

    try:
        win = GalaxyWindow()
        win.show()
        sys.exit(app.exec())
    except Exception as exc:
        logging.critical("Fatal startup error: %s", exc, exc_info=True)
        i18n = I18n(prefs.get('language', 'fa'))
        QMessageBox.critical(None, i18n.t('startup.error'),
                             i18n.t('startup.error_msg', err=exc))
        sys.exit(1)
