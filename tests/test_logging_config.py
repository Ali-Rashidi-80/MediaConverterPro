"""Central logging configuration."""
from __future__ import annotations

import logging

from galaxy.core.logging_config import setup_logging


def test_setup_logging_idempotent(monkeypatch, tmp_path):
    log_dir = tmp_path / "logs"
    monkeypatch.setattr(
        "galaxy.core.logging_config.os.path.expanduser",
        lambda _: str(log_dir),
    )
    setup_logging()
    setup_logging()
    root = logging.getLogger()
    assert root.handlers
    assert any(isinstance(h, logging.FileHandler) for h in root.handlers)
    assert any(isinstance(h, logging.StreamHandler) for h in root.handlers)


def test_setup_logging_creates_log_file(monkeypatch, tmp_path):
    log_dir = tmp_path / "home"
    monkeypatch.setattr(
        "galaxy.core.logging_config.os.path.expanduser",
        lambda _: str(log_dir),
    )
    root = logging.getLogger()
    root.handlers.clear()
    setup_logging()
    log_file = log_dir / ".galaxy_converter" / "galaxy_converter.log"
    assert log_file.is_file()
