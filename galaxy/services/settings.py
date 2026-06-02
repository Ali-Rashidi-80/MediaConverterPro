"""Persistent application settings."""
import json
import logging
import os

from galaxy_i18n import LANG_KEYS

PERF_DEFAULTS = {
    "parallel_mode": "smart",
    "max_parallel_jobs": 0,
    "accel_mode": "auto",
    "cpu_threads": 0,
    "nvenc_preset": "p4",
    "quality_profile": "balanced",
}

DEFAULT_SETTINGS = {
    "theme": "dark_cyan",
    "font_size": "medium",
    "ui_mode": "simple",
    "show_steps": True,
    "language": "fa",
    "output_dir": "",
    **PERF_DEFAULTS,
}

_ALL_KEYS = tuple(DEFAULT_SETTINGS.keys())


class SettingsManager:
    _path = os.path.join(os.path.expanduser("~"), ".galaxy_converter", "settings.json")

    @classmethod
    def load(cls):
        data = dict(DEFAULT_SETTINGS)
        try:
            if os.path.isfile(cls._path):
                with open(cls._path, encoding="utf-8") as f:
                    saved = json.load(f)
                if isinstance(saved, dict):
                    for k in _ALL_KEYS:
                        if k in saved:
                            data[k] = saved[k]
                    if saved.get("output_dir"):
                        data["output_dir"] = saved["output_dir"]
                    if saved.get("language") in LANG_KEYS:
                        data["language"] = saved["language"]
                    cls._migrate_legacy_gpu(saved, data)
        except (OSError, json.JSONDecodeError, TypeError) as e:
            logging.warning("Could not load settings: %s", e)
        return data

    @staticmethod
    def _migrate_legacy_gpu(saved: dict, data: dict) -> None:
        if "accel_mode" in saved:
            return
        if saved.get("use_gpu") is True:
            data["accel_mode"] = "nvidia"

    @classmethod
    def save(cls, data):
        try:
            os.makedirs(os.path.dirname(cls._path), exist_ok=True)
            payload = {k: data.get(k, DEFAULT_SETTINGS[k]) for k in _ALL_KEYS}
            if data.get("output_dir"):
                payload["output_dir"] = data["output_dir"]
            with open(cls._path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logging.error("Could not save settings: %s", e)
