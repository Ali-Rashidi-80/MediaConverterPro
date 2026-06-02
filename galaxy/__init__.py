"""Galaxy Media Pro application package."""
from galaxy.core.constants import APP_NAME, APP_VERSION

__all__ = ["APP_NAME", "APP_VERSION", "GalaxyWindow", "main"]


def __getattr__(name):
    """Lazy imports — safe for PyInstaller analysis (no Qt at package load)."""
    if name == "GalaxyWindow":
        from galaxy.ui.main_window import GalaxyWindow
        return GalaxyWindow
    if name == "main":
        from galaxy.app import main
        return main
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
