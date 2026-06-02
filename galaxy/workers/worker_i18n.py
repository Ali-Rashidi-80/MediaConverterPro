"""Lightweight i18n helper for background workers (no Qt dependency)."""


class WorkerI18n:
    def __init__(self, lang: str = "fa"):
        from galaxy_i18n import I18n
        self._i18n = I18n(lang if lang in ("fa", "en") else "fa")

    def t(self, key: str, **kwargs) -> str:
        return self._i18n.t(key, **kwargs)
