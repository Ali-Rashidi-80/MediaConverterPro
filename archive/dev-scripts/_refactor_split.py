"""One-time splitter — run from project root, then delete."""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "galaxy_ultimate.py")
lines = open(SRC, encoding="utf-8").readlines()


def chunk(a, b):
    return "".join(lines[a - 1 : b])


MODULES = {
    "galaxy/core/constants.py": """\"\"\"Application constants.\"\"\"
""" + chunk(42, 57),
    "galaxy/core/exceptions.py": """\"\"\"Domain exceptions.\"\"\"
""" + chunk(62, 66),
    "galaxy/core/paths.py": """\"\"\"Path resolution for dev and PyInstaller bundles.\"\"\"
import os
import sys

""" + chunk(71, 111),
    "galaxy/core/utils.py": """\"\"\"Shared utilities.\"\"\"
import os
import subprocess

from galaxy.core.constants import AUDIO_CONTAINER_EXT

""" + chunk(113, 166),
}

os.makedirs(os.path.join(ROOT, "galaxy", "core"), exist_ok=True)
for path, content in MODULES.items():
    full = os.path.join(ROOT, path.replace("/", os.sep))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    print("wrote", path)

print("done partial — continue manually")
