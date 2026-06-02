"""Path resolution for dev and PyInstaller bundles."""
import os
import sys

_PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECT_ROOT = os.path.dirname(_PKG_ROOT)


def is_frozen():
    return getattr(sys, 'frozen', False)


def get_exe_dir():
    """پوشهٔ EXE (برای فایل‌های کنار برنامه)."""
    if is_frozen():
        return os.path.dirname(os.path.abspath(sys.executable))
    return _PROJECT_ROOT


def get_bundle_dir():
    """پوشهٔ منابع داخلی باندل (_MEIPASS در onefile یا پوشه exe در onedir)."""
    if is_frozen():
        return getattr(sys, '_MEIPASS', get_exe_dir())
    return _PROJECT_ROOT


def resource_path(filename):
    """یافتن فایل باندل‌شده: ffmpeg، icon و ..."""
    search_dirs = []
    if is_frozen():
        meipass = getattr(sys, '_MEIPASS', None)
        if meipass:
            search_dirs.append(meipass)
        exe_dir = get_exe_dir()
        search_dirs.append(exe_dir)
        internal = os.path.join(exe_dir, '_internal')
        if os.path.isdir(internal):
            search_dirs.append(internal)
    else:
        search_dirs.append(_PROJECT_ROOT)
    seen = set()
    for base in search_dirs:
        if not base or base in seen:
            continue
        seen.add(base)
        candidate = os.path.join(base, filename)
        if os.path.isfile(candidate):
            return os.path.normpath(candidate)
    return None


def get_application_path():
    return get_exe_dir()
