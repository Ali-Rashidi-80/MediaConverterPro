"""Smoke-import every application module."""
from __future__ import annotations

import importlib
import pkgutil

import galaxy
import pytest


def _galaxy_modules():
    prefix = galaxy.__name__ + "."
    for mod in pkgutil.walk_packages(galaxy.__path__, prefix):
        if mod.name.endswith(".__pycache__"):
            continue
        yield mod.name


TOP_LEVEL = (
    "galaxy_i18n",
    "galaxy_fonts",
    "galaxy_ultimate",
)


@pytest.mark.parametrize("name", list(_galaxy_modules()) + list(TOP_LEVEL))
def test_import_module(name: str):
    importlib.import_module(name)
