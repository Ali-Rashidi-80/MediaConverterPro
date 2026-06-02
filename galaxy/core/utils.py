"""Shared utilities."""
import os
import subprocess

from galaxy.core.constants import AUDIO_CONTAINER_EXT
from galaxy.core.exceptions import OutputDirError


def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024: return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"

def get_startupinfo():
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        return startupinfo
    return None

def get_desktop_path():
    candidates = [
        os.path.join(os.path.expanduser("~"), "Desktop"),
        os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop"),
        os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"),
    ]
    for path in candidates:
        if path and os.path.isdir(path):
            return path
    fallback = os.path.join(os.path.expanduser("~"), "GalaxyOutput")
    os.makedirs(fallback, exist_ok=True)
    return fallback

def parse_format_extensions(formats_filter):
    extensions = []
    for part in formats_filter.split():
        part = part.strip().lower()
        if part.startswith('*.'):
            extensions.append(part[1:])
        elif part.startswith('.'):
            extensions.append(part)
    return tuple(extensions)

def file_has_extension(filepath, extensions):
    lower_path = filepath.lower()
    return any(lower_path.endswith(ext) for ext in extensions)

def resolve_output_path(output_dir, file_path, name, target_fmt):
    effective_ext = AUDIO_CONTAINER_EXT.get(target_fmt, target_fmt)
    save_path = os.path.join(output_dir, f"{name}.{effective_ext}")
    if os.path.normpath(file_path) == os.path.normpath(save_path):
        save_path = os.path.join(output_dir, f"{name}_converted.{effective_ext}")
    return save_path

def ensure_writable_dir(path):
    if os.path.isfile(path):
        raise OutputDirError("err.output_not_dir", path)
    os.makedirs(path, exist_ok=True)
    if not os.path.isdir(path):
        raise OutputDirError("err.output_not_dir", path)
    if not os.access(path, os.W_OK):
        raise OutputDirError("err.output_no_write", path)
