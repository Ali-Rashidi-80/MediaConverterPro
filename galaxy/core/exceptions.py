"""Domain exceptions."""


class FFmpegNotFoundError(Exception):
    pass


class ConversionError(Exception):
    pass


class ProcessCleanupError(Exception):
    pass


class ValidationError(Exception):
    pass


class PathSecurityError(Exception):
    pass


class OutputDirError(OSError):
    """Raised when output directory is invalid or not writable (use `code` with i18n)."""

    __slots__ = ("code", "path")

    def __init__(self, code: str, path: str):
        self.code = code
        self.path = path
        super().__init__(code)
