# Galaxy Media Pro — typography roles, bundled fonts, rendering quality
"""Cross-platform font stacks with role-based hierarchy (UI / display / mono)."""
from __future__ import annotations

import glob
import logging
import os
import platform
import sys

from PySide6.QtGui import QFont, QFontDatabase

# Type scale — Major Third (~1.25) from 15px base (medium)
FONT_SCALES = {
    "small": {
        "base": 13, "caption": 11, "label": 12, "button": 12,
        "title": 22, "brand": 18, "mono": 12, "pt": 9,
    },
    "medium": {
        "base": 15, "caption": 12, "label": 13, "button": 14,
        "title": 26, "brand": 20, "mono": 13, "pt": 10,
    },
    "large": {
        "base": 17, "caption": 13, "label": 15, "button": 16,
        "title": 30, "brand": 22, "mono": 14, "pt": 11,
    },
}

_fonts_registered = False
_loaded_families: set[str] = set()


def _app_root():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.executable)))
    try:
        from galaxy.core.paths import _PROJECT_ROOT
        return _PROJECT_ROOT
    except ImportError:
        return os.path.dirname(os.path.abspath(__file__))


def fonts_directory():
    return os.path.join(_app_root(), "fonts")


def _pick_family(candidates):
    db = QFontDatabase()
    for name in candidates:
        clean = name.strip("'\"")
        if db.hasFamily(clean):
            return clean
    for name in candidates:
        clean = name.strip("'\"")
        if clean in _loaded_families:
            return clean
    return candidates[0].strip("'\"") if candidates else "sans-serif"


def register_bundled_fonts():
    """Load all bundled .ttf files from fonts/ once."""
    global _fonts_registered, _loaded_families
    if _fonts_registered:
        return bool(_loaded_families)
    _fonts_registered = True
    fonts_dir = fonts_directory()
    patterns = [
        os.path.join(fonts_dir, "*.ttf"),
        os.path.join(fonts_dir, "*.otf"),
    ]
    loaded = 0
    for pattern in patterns:
        for path in sorted(glob.glob(pattern)):
            fid = QFontDatabase.addApplicationFont(path)
            if fid >= 0:
                loaded += 1
                _loaded_families.update(QFontDatabase.applicationFontFamilies(fid))
            else:
                logging.warning("Could not load font: %s", path)
    if loaded:
        logging.info("Bundled fonts loaded: %s files, families: %s",
                       loaded, ", ".join(sorted(_loaded_families)))
    return bool(_loaded_families)


def persian_ui_family():
    register_bundled_fonts()
    return _pick_family(["Vazirmatn", "Vazir", "LMU Vazir", "Tahoma", "Segoe UI", "Arial"])


def ui_font_stack(lang="fa"):
    """Body, labels, combos — primary reading font."""
    register_bundled_fonts()
    if lang == "fa":
        fa = persian_ui_family()
        return f"'{fa}', 'Tahoma', 'Segoe UI', sans-serif"
    if platform.system() == "Darwin":
        return "'-apple-system', 'SF Pro Text', 'Helvetica Neue', sans-serif"
    if platform.system() == "Linux":
        return "'Ubuntu', 'Cantarell', 'Noto Sans', 'DejaVu Sans', sans-serif"
    en = _pick_family(["Segoe UI", "Tahoma", "Arial"])
    return f"'{en}', 'Tahoma', 'Arial', sans-serif"


def display_font_stack(lang="fa"):
    """Headlines, brand, page titles."""
    register_bundled_fonts()
    if lang == "fa":
        fa = persian_ui_family()
        return f"'{fa}', 'Tahoma', sans-serif"
    if platform.system() == "Darwin":
        return "'SF Pro Display', '-apple-system', 'Helvetica Neue', sans-serif"
    if platform.system() == "Linux":
        return "'Ubuntu', 'Cantarell', 'Noto Sans', sans-serif"
    en = _pick_family(["Segoe UI", "Tahoma"])
    return f"'{en}', 'Segoe UI', 'Tahoma', sans-serif"


def mono_font_stack():
    """Paths, times, sizes, numeric readouts."""
    register_bundled_fonts()
    bundled = _pick_family(["Consolas", "Cascadia Mono", "Courier New"])
    if platform.system() == "Darwin":
        return f"'{bundled}', 'SF Mono', 'Menlo', monospace"
    if platform.system() == "Linux":
        return f"'{bundled}', 'Ubuntu Mono', 'DejaVu Sans Mono', monospace"
    return f"'{bundled}', 'Consolas', 'Courier New', monospace"


def font_css_roles(lang="fa"):
    ui = ui_font_stack(lang)
    return {"ui": ui, "display": display_font_stack(lang), "mono": mono_font_stack(), "tooltip": ui}


def primary_ui_family(lang="fa"):
    register_bundled_fonts()
    if lang == "fa":
        return persian_ui_family()
    if platform.system() == "Darwin":
        return _pick_family(["-apple-system", "SF Pro Text", "Helvetica Neue"])
    if platform.system() == "Linux":
        return _pick_family(["Ubuntu", "Cantarell", "Noto Sans"])
    return _pick_family(["Segoe UI", "Tahoma", "Arial"])


def make_qfont(lang="fa", font_key="medium", weight=QFont.Weight.Normal):
    scale = FONT_SCALES.get(font_key, FONT_SCALES["medium"])
    font = QFont(primary_ui_family(lang), scale["pt"])
    font.setWeight(weight)
    font.setStyleStrategy(QFont.StyleStrategy.PreferAntialias)
    if platform.system() == "Windows":
        font.setHintingPreference(QFont.HintingPreference.PreferFullHinting)
    else:
        font.setHintingPreference(QFont.HintingPreference.PreferDefaultHinting)
    return font


def make_mono_qfont(font_key="medium"):
    scale = FONT_SCALES.get(font_key, FONT_SCALES["medium"])
    family = _pick_family(["Consolas", "Cascadia Mono", "Courier New", "monospace"])
    font = QFont(family, scale["mono"])
    font.setStyleStrategy(QFont.StyleStrategy.PreferAntialias)
    return font


def configure_app_typography(app, lang="fa", font_key="medium"):
    """Global font + rendering quality for native widgets and dialogs."""
    register_bundled_fonts()
    app.setFont(make_qfont(lang, font_key, QFont.Weight.Normal))


def system_font_family(lang="fa"):
    return ui_font_stack(lang)
