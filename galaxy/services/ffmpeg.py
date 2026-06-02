"""FFmpeg discovery and command building."""
import logging
import os
import re
import shutil
import subprocess

from galaxy.core.paths import resource_path
from galaxy.core.utils import get_startupinfo


def find_ffmpeg_path():
    binary_name = 'ffmpeg.exe' if os.name == 'nt' else 'ffmpeg'
    bundled = resource_path(binary_name)
    if bundled and os.path.isfile(bundled):
        return bundled
    system = shutil.which(binary_name)
    if system:
        return system
    return None

def verify_ffmpeg(ffmpeg_path):
    if not ffmpeg_path:
        return False, "engine.err_not_found"
    try:
        result = subprocess.run(
            [ffmpeg_path, '-version'], capture_output=True, text=True,
            timeout=8, startupinfo=get_startupinfo(), encoding='utf-8', errors='replace'
        )
        if result.returncode == 0:
            ver = (result.stdout or result.stderr or '').splitlines()
            return True, ver[0] if ver else 'OK'
        return False, "engine.err_no_response"
    except Exception as exc:
        return False, str(exc)[:80]

# ---------------------------------------------------------
# 🎬 FFmpeg Engine — موتور حرفه‌ای ساخت دستور
# ---------------------------------------------------------
class FFmpegEngine:
    VIDEO_PRESETS = {
        'original': {'crf': 23, 'preset': 'medium'},
        'youtube': {'scale': '1920:1080', 'crf': 18, 'preset': 'slow', 'fps': 30, 'audio_bitrate': '192k', 'ar': 48000},
        'instagram': {'scale': '1080:1920', 'crf': 23, 'preset': 'medium', 'fps': 30},
        'mobile': {'scale': '1280:720', 'crf': 28, 'preset': 'fast'},
        'web': {'scale': '854:480', 'crf': 28, 'preset': 'faster'},
        'archive': {'crf': 18, 'preset': 'slow'},
        'fast_copy': {'copy': True},
    }

    @staticmethod
    def run_probe(ffmpeg_path, file_path):
        try:
            cmd = [ffmpeg_path, '-hide_banner', '-i', file_path]
            result = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stdin=subprocess.DEVNULL, startupinfo=get_startupinfo(),
                                    text=True, timeout=120, encoding='utf-8', errors='replace')
            return (result.stderr or '') + (result.stdout or '')
        except Exception as e:
            logging.debug(f"Probe error: {e}")
            return ''

    @staticmethod
    def get_duration(probe_text):
        match = re.search(r"Duration: (\d{1,3}):(\d{2}):(\d{2})\.(\d{2})", probe_text)
        if match:
            h, m, s = map(int, match.groups()[:3])
            return max(h * 3600 + m * 60 + s, 1)
        return 10

    @staticmethod
    def get_version(ffmpeg_path):
        try:
            r = subprocess.run([ffmpeg_path, '-version'], capture_output=True, text=True,
                               timeout=10, startupinfo=get_startupinfo())
            first = (r.stdout or r.stderr or '').splitlines()
            return first[0] if first else 'Unknown'
        except Exception:
            return 'Unknown'

    @staticmethod
    def list_encoders(ffmpeg_path, pattern=''):
        try:
            r = subprocess.run([ffmpeg_path, '-hide_banner', '-encoders'],
                               capture_output=True, text=True, timeout=15,
                               startupinfo=get_startupinfo(), encoding='utf-8', errors='replace')
            lines = [ln.strip() for ln in (r.stdout or '').splitlines() if ln.strip().startswith('V') or ln.strip().startswith('A')]
            if pattern:
                lines = [ln for ln in lines if pattern in ln]
            return lines[:40]
        except Exception:
            return []

    @staticmethod
    def has_nvenc(ffmpeg_path):
        enc = FFmpegEngine.list_encoders(ffmpeg_path, 'nvenc')
        return any('h264_nvenc' in e or 'hevc_nvenc' in e for e in enc)

    @staticmethod
    def parse_timecode(value):
        value = (value or '').strip()
        if not value:
            return None
        if re.match(r'^\d+$', value):
            return int(value)
        m = re.match(r'^(\d{1,2}):(\d{2}):(\d{2})$', value)
        if m:
            h, mn, s = map(int, m.groups())
            return h * 3600 + mn * 60 + s
        return None

    @staticmethod
    def build_video_filters(settings):
        preset = FFmpegEngine.VIDEO_PRESETS.get(settings.get('video_preset', 'original'), {})
        filters = []
        rotate = settings.get('rotate', 0)
        if rotate == 90:
            filters.append('transpose=1')
        elif rotate == 180:
            filters.extend(['transpose=1', 'transpose=1'])
        elif rotate == 270:
            filters.append('transpose=2')

        scale = settings.get('scale') or preset.get('scale')
        if scale and scale != 'original':
            filters.append(f'scale={scale}:flags=lanczos')

        fps = settings.get('fps') or preset.get('fps')
        if fps and str(fps) != '0':
            filters.append(f'fps={fps}')

        if settings.get('denoise'):
            filters.append('hqdn3d=4:3:6:4.5')
        if settings.get('sharpen'):
            filters.append('unsharp=5:5:1.0:5:5:0.0')
        if settings.get('grayscale'):
            filters.append('format=gray')

        return ','.join(filters) if filters else None

    @staticmethod
    def append_input_options(cmd, settings):
        start = FFmpegEngine.parse_timecode(settings.get('trim_start'))
        end = FFmpegEngine.parse_timecode(settings.get('trim_end'))
        if start is not None:
            cmd.extend(['-ss', str(start)])
        if end is not None and start is not None:
            cmd.extend(['-t', str(max(end - start, 1))])
        elif end is not None:
            cmd.extend(['-t', str(end)])

    @staticmethod
    def append_video_options(cmd, settings, target_fmt, ffmpeg_path=None, profile=None, force_cpu=False):
        from galaxy.services.ffmpeg_pipeline import append_video_encode_options
        from galaxy.services.hw_probe import get_system_profile
        if profile is None:
            try:
                profile = get_system_profile()
            except Exception:
                profile = None
        append_video_encode_options(cmd, settings, target_fmt, ffmpeg_path, profile, force_cpu=force_cpu)

    @staticmethod
    def append_audio_options(cmd, settings, target_fmt):
        cmd.extend(['-vn'])
        use_bitrate = settings.get('bitrate', '')
        ar = settings.get('sample_rate', 0)
        ac = settings.get('channels', 0)

        if target_fmt == 'mp3':
            cmd.extend(['-c:a', 'libmp3lame'])
            if use_bitrate and re.match(r'^\d+k?$', use_bitrate):
                cmd.extend(['-b:a', use_bitrate if use_bitrate.endswith('k') else f'{use_bitrate}k'])
            else:
                cmd.extend(['-q:a', '2'])
        elif target_fmt in ['aac', 'm4a']:
            cmd.extend(['-c:a', 'aac'])
            cmd.extend(['-b:a', use_bitrate if use_bitrate else '192k'])
        elif target_fmt == 'wav':
            cmd.extend(['-c:a', 'pcm_s16le'])
        elif target_fmt == 'flac':
            cmd.extend(['-c:a', 'flac'])
        elif target_fmt == 'ogg':
            cmd.extend(['-c:a', 'libvorbis', '-q:a', '6'])
        elif target_fmt == 'opus':
            cmd.extend(['-c:a', 'libopus', '-b:a', '128k'])
        elif target_fmt == 'wma':
            cmd.extend(['-c:a', 'wmav2', '-b:a', use_bitrate or '192k'])
        elif target_fmt == 'alac':
            cmd.extend(['-c:a', 'alac'])

        if ar:
            cmd.extend(['-ar', str(ar)])
        if ac:
            cmd.extend(['-ac', str(ac)])
        if settings.get('normalize'):
            cmd.extend(['-af', 'loudnorm=I=-14:TP=-1.5:LRA=11'])
        elif settings.get('volume', 100) != 100:
            vol = settings.get('volume', 100) / 100.0
            cmd.extend(['-af', f'volume={vol:.2f}'])
