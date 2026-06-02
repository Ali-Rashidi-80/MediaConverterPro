# -*- mode: python ; coding: utf-8 -*-
# Galaxy Media Pro — Single portable EXE (onefile + UPX)
import os
import sys

block_cipher = None
ROOT = os.path.abspath(SPECPATH)

ffmpeg_name = 'ffmpeg.exe' if sys.platform.startswith('win') else 'ffmpeg'
ffmpeg_path = os.path.join(ROOT, ffmpeg_name)

binaries = []
if os.path.isfile(ffmpeg_path):
    binaries.append((ffmpeg_path, '.'))
else:
    raise SystemExit(f'[ERROR] {ffmpeg_name} required for portable build.')

datas = []
icon_path = os.path.join(ROOT, 'icon.ico')
if os.path.isfile(icon_path):
    datas.append((icon_path, '.'))
fonts_dir = os.path.join(ROOT, 'fonts')
if os.path.isdir(fonts_dir):
    datas.append((fonts_dir, 'fonts'))

a = Analysis(
    [os.path.join(ROOT, 'galaxy_ultimate.py')],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=[
        'galaxy.app',
        'galaxy.core.constants',
        'galaxy.core.exceptions',
        'galaxy.core.paths',
        'galaxy.core.utils',
        'galaxy.core.logging_config',
        'galaxy.services.ffmpeg',
        'galaxy.services.settings',
        'galaxy.services.hw_probe',
        'galaxy.services.ffmpeg_pipeline',
        'galaxy.services.job_scheduler',
        'galaxy.workers.image_worker',
        'galaxy.workers.image_task',
        'galaxy.workers.media_worker',
        'galaxy.workers.worker_i18n',
        'galaxy.workers.task_queue',
        'galaxy.ui.layout_direction',
        'galaxy.ui.theme',
        'galaxy.ui.help_content',
        'galaxy.ui.widgets',
        'galaxy.ui.base_page',
        'galaxy.ui.main_window',
        'galaxy.ui.pages.image',
        'galaxy.ui.pages.video',
        'galaxy.ui.pages.audio',
        'galaxy.ui.pages.settings',
        'galaxy.ui.pages.about',
        'galaxy_i18n',
        'galaxy_fonts',
        'pillow_heif',
        'PIL',
        'PIL.Image',
        'PIL.JpegImagePlugin',
        'PIL.PngImagePlugin',
        'PIL.WebPImagePlugin',
        'PIL.BmpImagePlugin',
        'PIL.TiffImagePlugin',
        'PIL.GifImagePlugin',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'pandas', 'scipy', 'PyQt6', 'PyQt5'],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, cipher=block_cipher)

# فایل‌هایی که نباید UPX شوند (ffmpeg و DLLهای حساس)
UPX_SKIP = [
    'ffmpeg.exe', 'ffmpeg',
    'Qt6Core.dll', 'Qt6Gui.dll', 'Qt6Widgets.dll', 'Qt6Network.dll',
    'python3.dll', 'python314.dll',
    'vcruntime140.dll', 'vcruntime140_1.dll',
    'libcrypto', 'libssl',
]

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='GalaxyMediaPro_Portable',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=UPX_SKIP,
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path if os.path.isfile(icon_path) else None,
)
