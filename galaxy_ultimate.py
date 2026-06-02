"""Galaxy Media Pro — backward-compatible entry point for PyInstaller and scripts."""
from galaxy import APP_NAME, APP_VERSION, GalaxyWindow, main
from galaxy.core.constants import AUDIO_CONTAINER_EXT, HEIF_SUPPORTED
from galaxy.core.exceptions import (
    ConversionError,
    FFmpegNotFoundError,
    PathSecurityError,
    ProcessCleanupError,
    ValidationError,
)
from galaxy.core.paths import (
    get_application_path,
    get_bundle_dir,
    get_exe_dir,
    is_frozen,
    resource_path,
)
from galaxy.core.utils import (
    ensure_writable_dir,
    file_has_extension,
    format_size,
    get_desktop_path,
    get_startupinfo,
    parse_format_extensions,
    resolve_output_path,
)
from galaxy.services.ffmpeg import FFmpegEngine, find_ffmpeg_path, verify_ffmpeg
from galaxy.services.settings import DEFAULT_SETTINGS, SettingsManager
from galaxy.ui.base_page import BasePage
from galaxy.ui.pages import AboutPage, AudioPage, ImagePage, SettingsPage, VideoPage
from galaxy.ui.theme import STYLESHEET, THEME_PALETTES, build_menu_stylesheet, build_stylesheet
from galaxy.ui.widgets import DropZoneFrame, make_drop_zone
from galaxy.workers import ImageWorker, MediaWorker

__all__ = [
    "APP_NAME",
    "APP_VERSION",
    "HEIF_SUPPORTED",
    "AUDIO_CONTAINER_EXT",
    "FFmpegNotFoundError",
    "ConversionError",
    "ProcessCleanupError",
    "ValidationError",
    "PathSecurityError",
    "is_frozen",
    "get_exe_dir",
    "get_bundle_dir",
    "resource_path",
    "get_application_path",
    "format_size",
    "get_startupinfo",
    "get_desktop_path",
    "parse_format_extensions",
    "file_has_extension",
    "resolve_output_path",
    "ensure_writable_dir",
    "find_ffmpeg_path",
    "verify_ffmpeg",
    "FFmpegEngine",
    "DEFAULT_SETTINGS",
    "SettingsManager",
    "THEME_PALETTES",
    "build_stylesheet",
    "build_menu_stylesheet",
    "STYLESHEET",
    "ImageWorker",
    "MediaWorker",
    "BasePage",
    "ImagePage",
    "VideoPage",
    "AudioPage",
    "SettingsPage",
    "AboutPage",
    "DropZoneFrame",
    "make_drop_zone",
    "GalaxyWindow",
    "main",
]

if __name__ == "__main__":
    main()
