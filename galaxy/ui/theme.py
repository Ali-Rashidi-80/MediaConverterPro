"""Qt stylesheets and theme palettes."""
from galaxy_fonts import FONT_SCALES, font_css_roles

THEME_PALETTES = {
    "dark_cyan": {
        "bg": "#08080d", "bg_alt": "#0e0e14", "sidebar": "#0c0c12",
        "surface": "#12121a", "surface_hover": "#1a2430", "surface_elevated": "#1e2a32",
        "border": "#2a3640", "border_soft": "#1e2a32",
        "accent": "#00bcd4", "accent_bright": "#4dd0e1", "accent_glow": "#00e5ff",
        "accent_dark": "#00838f", "accent_muted": "rgba(0,188,212,0.12)",
        "text": "#eceff1", "text_secondary": "#90a4ae", "text_muted": "#607d8b",
        "text_on_accent": "#001015", "success": "#00e676", "danger": "#ff5252",
        "warning": "#ffb74d", "tooltip_bg": "#1a2430", "tooltip_border": "#00bcd4",
        "tooltip_text": "#f5f5f5", "highlight": "#00e5ff",
    },
    "dark_purple": {
        "bg": "#0a0810", "bg_alt": "#100e18", "sidebar": "#0e0c16",
        "surface": "#16141f", "surface_hover": "#221e2e", "surface_elevated": "#2a2438",
        "border": "#3d3550", "border_soft": "#2a2438",
        "accent": "#7c4dff", "accent_bright": "#b388ff", "accent_glow": "#d1c4e9",
        "accent_dark": "#651fff", "accent_muted": "rgba(124,77,255,0.14)",
        "text": "#ede7f6", "text_secondary": "#b39ddb", "text_muted": "#7e57c2",
        "text_on_accent": "#ffffff", "success": "#69f0ae", "danger": "#ff5252",
        "warning": "#ffd740", "tooltip_bg": "#1e1a28", "tooltip_border": "#7c4dff",
        "tooltip_text": "#f3e5f5", "highlight": "#d1c4e9",
    },
    "light": {
        "bg": "#f7f9fc", "bg_alt": "#eef2f7", "sidebar": "#ffffff",
        "surface": "#ffffff", "surface_hover": "#f1f5f9", "surface_elevated": "#e2e8f0",
        "border": "#cbd5e0", "border_soft": "#e2e8f0",
        "accent": "#0d9488", "accent_bright": "#2dd4bf", "accent_glow": "#0f766e",
        "accent_dark": "#0f766e", "accent_muted": "rgba(13,148,136,0.12)",
        "text": "#1e293b", "text_secondary": "#475569", "text_muted": "#64748b",
        "text_on_accent": "#ffffff", "success": "#059669", "danger": "#dc2626",
        "warning": "#d97706", "tooltip_bg": "#1e293b", "tooltip_border": "#14b8a6",
        "tooltip_text": "#f8fafc", "highlight": "#0d9488",
    },
}


def _pal(theme_id):
    return THEME_PALETTES.get(theme_id, THEME_PALETTES["dark_cyan"])

def build_stylesheet(theme_id="dark_cyan", font_key="medium", lang="fa"):
    p = _pal(theme_id)
    f = FONT_SCALES.get(font_key, FONT_SCALES["medium"])
    is_light = theme_id == "light"
    rtl = lang == 'fa'
    row_hover = "rgba(13,148,136,0.12)" if is_light else "rgba(0,188,212,0.10)"
    row_sel = "rgba(13,148,136,0.18)" if is_light else p["accent_muted"]
    tip_color = p.get("tooltip_text", "#ffffff")
    hi = p.get("highlight", p["accent_glow"])
    pad_side = "padding-right" if rtl else "padding-left"
    group_bg = p['surface'] if is_light else p['bg_alt']
    fonts = font_css_roles(lang)
    title_align = "top right" if rtl else "top left"
    sidebar_sel = f"border-{'right' if rtl else 'left'}: 3px solid {p['accent']};"
    # RTL: vertical scrollbar on the left | LTR: on the right
    scroll_v_margin = "margin: 4px 0 4px 2px;" if rtl else "margin: 4px 2px 4px 0;"
    scroll_h_margin = "margin: 0 0 2px 0;" if rtl else "margin: 0 0 2px 0;"

    return f"""
QMainWindow, QDialog {{ background-color: {p['bg']}; }}
QWidget {{
    font-family: {fonts['ui']};
    font-size: {f['base']}px; color: {p['text']};
}}
QToolTip {{
    background-color: {p['tooltip_bg']}; color: {tip_color};
    border: 1px solid {p['tooltip_border']}; padding: 10px 14px;
    font-family: {fonts['tooltip']}; font-size: {f['caption']}px;
    font-weight: normal; border-radius: 10px;
}}

/* ── سایدبار ── */
QFrame#SidebarBrand {{
    background: {p['sidebar']}; border-{'left' if rtl else 'right'}: 1px solid {p['border_soft']};
}}
QLabel#BrandTitle {{
    font-family: {fonts['display']}; font-size: {f['brand']}px; font-weight: 800;
    color: {p['text']}; letter-spacing: 0.3px;
}}
QLabel#BrandSub {{ color: {p['text_secondary']}; font-size: {f['label']}px; }}
QListWidget#Sidebar {{ background: transparent; border: none; outline: none; padding: 8px 6px; }}
QListWidget#Sidebar::item {{
    height: 50px; {pad_side}: 14px; color: {p['text_secondary']};
    font-weight: 600; font-size: {f['base']}px; margin: 3px 6px;
    border-radius: 10px; border: 1px solid transparent;
}}
QListWidget#Sidebar::item:hover {{
    background: {p['accent_muted']}; color: {p['text']};
    border-color: {p['border']};
}}
QListWidget#Sidebar::item:selected {{
    background: {p['accent_muted']}; color: {hi};
    {sidebar_sel} font-weight: 700;
}}

/* ── هدر و راهنما ── */
QFrame#PageHeader {{ border-bottom: 1px solid {p['border_soft']}; padding-bottom: 4px; }}
QLabel#PageTitle {{
    font-family: {fonts['display']}; font-size: {f['title']}px; font-weight: 800; color: {p['text']};
}}
QLabel#PageSubtitle {{ color: {p['text_secondary']}; font-size: {f['label']}px; }}

QFrame#StepsGuide {{
    background: {p['surface']}; border: 1px solid {p['border_soft']}; border-radius: 12px;
    {'border-bottom: 2px solid ' + p['border_soft'] + ';' if is_light else ''}
}}
QFrame#StepBadge {{
    background: {p['accent_muted']}; border: 1px solid {p['border']};
    border-radius: 8px; min-width: 26px; max-width: 26px; min-height: 26px; max-height: 26px;
}}
QLabel#StepBadgeNum {{ color: {p['accent']}; font-weight: 800; font-size: {f['caption']}px; }}
QLabel#StepLabel {{ color: {p['text_secondary']}; font-size: {f['caption']}px; font-weight: 600; }}
QLabel#StepArrow {{ color: {p['border']}; padding: 0 4px; }}

/* ── Drop Zone ── */
QFrame#DropZone {{
    background: {p['accent_muted']}; border: 2px dashed {p['border']};
    border-radius: 16px;
}}
QFrame#DropZone:hover {{
    border-color: {p['accent']}; background: {p['surface_hover']};
}}
QFrame#DropZone[dragOver="true"] {{
    border-color: {p['accent_glow']}; border-style: solid;
    background: {p['accent_muted']};
}}
QLabel#DropZoneText {{ color: {hi}; font-size: {f['base'] + 2}px; font-weight: 700; }}
QLabel#DropZoneHint {{ color: {p['text_secondary']}; font-size: {f['base'] - 2}px; }}

/* ── فرم ── */
QLabel#FieldLabel {{ color: {p['text']}; font-weight: 600; font-size: {f['label']}px; min-width: 130px; }}
QLabel#HintLabel {{ color: {p['text_secondary']}; font-size: {f['caption']}px; padding: 4px 0 8px 0; }}
QLabel#MonoLabel, QLabel#FooterPath {{
    font-family: {fonts['mono']}; font-size: {f['mono']}px;
}}
QLineEdit#MonoField {{
    font-family: {fonts['mono']}; font-size: {f['mono']}px;
}}
QLabel#StatusLabel {{
    color: {p['text_secondary']}; font-weight: 600; padding: 12px 16px;
    background: {p['surface']}; border: 1px solid {p['border_soft']}; border-radius: 10px;
}}
QLabel#FooterPath {{ color: {p['accent']}; font-weight: 700; }}
QLabel#EngineOk {{ color: {p['success']}; font-weight: 700; }}
QLabel#EngineBad {{ color: {p['danger']}; font-weight: 700; }}

QComboBox, QLineEdit, QSpinBox {{
    background: {p['surface']}; border: 1px solid {p['border']}; border-radius: 10px;
    padding: 10px 14px; color: {p['text']}; min-height: 22px; min-width: 200px;
}}
QComboBox:hover, QLineEdit:hover, QSpinBox:hover {{
    border-color: {p['accent']}; background: {p['surface_hover']};
}}
QComboBox:focus, QLineEdit:focus, QSpinBox:focus {{ border-color: {p['accent_glow']}; }}
QComboBox:disabled, QLineEdit:disabled {{ color: {p['text_muted']}; background: {p['bg_alt']}; }}
QComboBox::drop-down {{ border: none; width: 30px; }}
QComboBox::down-arrow {{ image: none; border-left: 5px solid transparent; border-right: 5px solid transparent;
    border-top: 6px solid {p['accent']}; margin-right: 10px; }}
QComboBox QAbstractItemView {{
    background: {p['surface']}; border: 1px solid {p['accent']}; padding: 6px;
    selection-background-color: {p['accent']}; selection-color: {p['text_on_accent']};
    outline: none;
}}
QComboBox QAbstractItemView::item {{ min-height: 32px; padding: 4px 8px; border-radius: 6px; }}
QComboBox QAbstractItemView::item:hover {{ background: {p['accent_muted']}; }}

QCheckBox {{ spacing: 10px; color: {p['text']}; font-size: {f['base'] - 1}px; }}
QCheckBox:hover {{ color: {hi}; }}
QCheckBox::indicator {{
    width: 20px; height: 20px; border-radius: 5px;
    border: 1px solid {p['border']}; background: {p['surface']};
}}
QCheckBox::indicator:hover {{ border-color: {p['accent']}; }}
QCheckBox::indicator:checked {{ background: {p['accent']}; border-color: {p['accent_glow']}; }}

QGroupBox {{
    border: 1px solid {p['border_soft']}; border-radius: 14px;
    margin-top: 18px; padding: 18px 14px 14px 14px;
    background: {group_bg}; font-weight: 700; color: {p['accent']};
}}
QGroupBox::title {{ subcontrol-origin: margin; subcontrol-position: {title_align}; padding: 0 10px; }}
QGroupBox#AdvancedGroup {{ color: {p['text_secondary']}; font-size: {f['base'] - 2}px; }}
QGroupBox#AdvancedGroup:checked {{ border-color: {p['accent']}; color: {p['accent']}; }}
QGroupBox#AdvancedGroup::indicator {{ width: 18px; height: 18px; }}

/* ── دکمه‌ها ── */
QPushButton {{
    background: {p['surface_hover']}; color: {p['text']};
    border: 1px solid {p['border']}; border-radius: 10px;
    padding: 10px 20px; font-weight: 600; font-size: {f['button']}px; min-height: 22px;
}}
QPushButton:hover {{
    background: {p['surface_elevated']}; border-color: {p['accent']}; color: {hi};
}}
QPushButton:pressed {{ background: {p['bg_alt']}; }}
QPushButton:disabled {{ color: {p['text_muted']}; background: {p['bg_alt']}; border-color: {p['border_soft']}; }}

QPushButton#PrimaryBtn {{
    background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {p['accent_glow']}, stop:1 {p['accent_dark']});
    color: {p['text_on_accent']}; font-size: {f['base'] + 1}px; font-weight: 800; border: none;
    min-height: 30px;
}}
QPushButton#PrimaryBtn:hover {{
    background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {p['accent_bright']}, stop:1 {p['accent']});
    color: {p['text_on_accent']};
}}
QPushButton#PrimaryBtn:pressed {{ background: {p['accent_dark']}; }}
QPushButton#PrimaryBtn:disabled {{ background: {p['border']}; color: {p['text_muted']}; }}

QPushButton#DangerBtn {{
    background: rgba(255,82,82,0.10); color: {p['danger']};
    border: 1px solid rgba(255,82,82,0.35); font-weight: 700;
}}
QPushButton#DangerBtn:enabled {{
    background: {p['danger']}; color: #fff; border-color: {p['danger']};
}}
QPushButton#DangerBtn:hover {{ background: #ff1744; color: #fff; border-color: #ff1744; }}
QPushButton#DangerBtn:disabled {{ background: {p['bg_alt']}; color: {p['text_muted']}; border-color: {p['border_soft']}; font-weight: 600; }}

QPushButton#GhostBtn {{
    background: transparent; border: 1px dashed {p['border']}; color: {p['text_secondary']};
}}
QPushButton#GhostBtn:hover {{
    border-style: solid; border-color: {p['accent']}; color: {p['accent']}; background: {p['accent_muted']};
}}

QPushButton#SettingsApplyBtn {{
    background: {p['accent']}; color: {p['text_on_accent']}; border: none; font-weight: 800;
}}
QPushButton#SettingsApplyBtn:hover {{ background: {p['accent_glow']}; }}

/* ── جدول ── */
QTableWidget {{
    background: {p['bg_alt']}; border: 1px solid {p['border_soft']};
    border-radius: 12px; alternate-background-color: {p['surface']};
    gridline-color: {p['border_soft']}; color: {p['text']}; outline: none;
}}
QTableWidget::item {{ padding: 10px 8px; border: none; }}
QTableWidget::item:hover {{ background: {row_hover}; }}
QTableWidget::item:selected {{ background: {row_sel}; color: {p['text']}; }}
QHeaderView::section {{
    background: {p['surface']}; color: {p['accent']}; padding: 12px 10px;
    font-weight: 700; border: none; border-bottom: 2px solid {p['border']};
}}

QProgressBar {{
    background: {p['surface']}; border: 1px solid {p['border']}; border-radius: 10px;
    text-align: center; color: {p['text']}; font-weight: 700; min-height: 28px;
}}
QProgressBar::chunk {{
    background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {p['accent']}, stop:1 {p['accent_glow']});
    border-radius: 8px;
}}

QSlider::groove:horizontal {{ height: 8px; background: {p['border_soft']}; border-radius: 4px; }}
QSlider::handle:horizontal {{
    background: {p['accent_glow']}; width: 20px; margin: -8px 0; border-radius: 10px;
    border: 2px solid {p['accent_dark']};
}}
QSlider::handle:horizontal:hover {{ background: {p['accent_bright']}; border-color: {p['accent_glow']}; }}
QSlider::sub-page:horizontal {{ background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {p['accent_dark']}, stop:1 {p['accent']}); border-radius: 4px; }}

QScrollBar:vertical {{ background: transparent; width: 10px; {scroll_v_margin} }}
QScrollBar::handle:vertical {{ background: {p['border']}; min-height: 40px; border-radius: 5px; }}
QScrollBar::handle:vertical:hover {{ background: {p['accent']}; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
QScrollBar:horizontal {{ background: transparent; height: 10px; {scroll_h_margin} }}
QScrollBar::handle:horizontal {{ background: {p['border']}; min-width: 40px; border-radius: 5px; }}
QScrollBar::handle:horizontal:hover {{ background: {p['accent']}; }}
QScrollArea {{ background: transparent; border: none; }}
QAbstractScrollArea {{ background: transparent; }}
QFrame#FooterBar {{ background: {p['bg_alt']}; border-top: 1px solid {p['border_soft']}; padding: 8px 12px; }}

QMenu {{
    background: {p['surface']}; color: {p['text']}; border: 1px solid {p['border']};
    border-radius: 8px; padding: 6px;
}}
QMenu::item {{ padding: 10px 28px; border-radius: 6px; }}
QMenu::item:selected {{ background: {p['accent']}; color: {p['text_on_accent']}; }}

QMessageBox {{ background: {p['surface']}; }}
QMessageBox QLabel {{ color: {p['text']}; min-width: 340px; font-size: {f['base']}px; }}
QMessageBox QPushButton {{
    background: {p['accent']}; color: {p['text_on_accent']}; padding: 8px 22px;
    font-weight: 700; border-radius: 8px; min-width: 90px; border: none;
}}
QMessageBox QPushButton:hover {{ background: {p['accent_glow']}; }}

QTextBrowser {{ background: transparent; border: none; color: {p['text']}; }}

/* ── صفحه راهنما ── */
QFrame#AboutHero {{
    background: {p['surface']}; border: 1px solid {p['border_soft']};
    border-radius: 14px;
}}
QLabel#AboutHeroTitle {{
    font-family: {fonts['display']}; font-size: {f['brand']}px; font-weight: 800; color: {p['text']};
}}
QLabel#AboutHeroVersion {{
    font-family: {fonts['mono']}; font-size: {f['mono']}px; color: {p['accent']}; font-weight: 700;
}}
QLabel#AboutHeroTagline {{ color: {p['text_secondary']}; font-size: {f['label']}px; }}
QLabel#AboutReadyOk {{ color: {p['success']}; font-weight: 700; font-size: {f['label']}px; }}
QLabel#AboutReadyWarn {{ color: {p['warning']}; font-weight: 700; font-size: {f['label']}px; }}
QFrame#AboutActionBar {{ padding-top: 4px; }}

/* ── نوار عملیات تبدیل (ثابت پایین صفحه) ── */
QFrame#ConversionActionBar {{
    background: {p['surface']}; border-top: 2px solid {p['border']};
    padding: 14px 24px 16px 24px;
}}
QLabel#ActionBarStatus {{
    color: {p['text_secondary']}; font-size: {f['label']}px; font-weight: 600;
    padding: 0 0 6px 0;
}}
QFrame#FileToolbar {{
    background: {p['bg_alt']}; border: 1px solid {p['border_soft']};
    border-radius: 12px; padding: 4px;
}}
QLabel#SectionLabel {{
    color: {p['accent']}; font-weight: 700; font-size: {f['label']}px;
    padding: 4px 0 2px 0;
}}
QPushButton#SecondaryBtn {{
    background: {p['accent_muted']}; color: {p['accent']};
    border: 1px solid {p['accent']}; font-weight: 700;
}}
QPushButton#SecondaryBtn:hover {{
    background: {p['accent']}; color: {p['text_on_accent']};
}}
QPushButton#SecondaryBtn:disabled {{
    background: {p['bg_alt']}; color: {p['text_muted']}; border-color: {p['border_soft']};
}}

QLabel#FooterPerf {{
    color: {p['accent']}; font-weight: 600; font-size: {f['label']}px;
    padding: 0 8px;
}}
"""

def build_menu_stylesheet(theme_id="dark_cyan"):
    p = _pal(theme_id)
    return f"""
QMenu {{ background: {p['surface']}; color: {p['text']}; border: 1px solid {p['border']}; padding: 6px; }}
QMenu::item {{ padding: 10px 28px; border-radius: 6px; }}
QMenu::item:selected {{ background: {p['accent']}; color: {p['text_on_accent']}; }}
"""

STYLESHEET = None  # lazy — use build_stylesheet() or attribute access below


def __getattr__(name):
    if name == "STYLESHEET":
        return build_stylesheet()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
