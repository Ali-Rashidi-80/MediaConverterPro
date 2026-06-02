#!/usr/bin/env python3
"""Full QA gate — compile, lint, type-check, security, unit+integration tests, acceptance."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _run(cmd: list[str], timeout: int = 600) -> dict:
    t0 = time.perf_counter()
    try:
        r = subprocess.run(
            cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        elapsed = round(time.perf_counter() - t0, 2)
        return {
            "cmd": " ".join(cmd),
            "ok": r.returncode == 0,
            "exit_code": r.returncode,
            "elapsed_sec": elapsed,
            "stdout_tail": (r.stdout or "")[-3000:],
            "stderr_tail": (r.stderr or "")[-2000:],
        }
    except subprocess.TimeoutExpired:
        return {"cmd": " ".join(cmd), "ok": False, "error": "timeout"}
    except FileNotFoundError as exc:
        return {"cmd": " ".join(cmd), "ok": False, "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Galaxy Media Pro full QA gate")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Include integration tests (real FFmpeg encode/probe)",
    )
    args = parser.parse_args()
    py = sys.executable
    checks: list[dict] = []

    sources = list((ROOT / "galaxy").rglob("*.py"))
    sources += [ROOT / "galaxy_i18n.py", ROOT / "galaxy_fonts.py", ROOT / "galaxy_ultimate.py"]
    sources += list((ROOT / "tests").rglob("*.py"))
    compile_fail = []
    for src in sources:
        r = subprocess.run([py, "-m", "py_compile", str(src)], capture_output=True)
        if r.returncode != 0:
            compile_fail.append(str(src.relative_to(ROOT)))
    checks.append({"name": "py_compile", "ok": not compile_fail, "failures": compile_fail})

    ruff = _run([
        py, "-m", "ruff", "check",
        "galaxy", "galaxy_i18n.py", "galaxy_fonts.py", "galaxy_ultimate.py", "tools", "tests",
    ])
    ruff["name"] = "ruff"
    checks.append(ruff)

    mypy = _run([py, "-m", "mypy", "galaxy", "galaxy_i18n.py", "galaxy_fonts.py", "--config-file", "pyproject.toml"])
    mypy["name"] = "mypy"
    checks.append(mypy)

    bandit = _run([py, "-m", "bandit", "-r", "galaxy", "tools", "-q", "-c", "pyproject.toml"])
    bandit["name"] = "bandit"
    checks.append(bandit)

    unit = _run([
        py, "-m", "pytest", "tests", "-q", "--tb=no",
        "-m", "not integration",
        "--cov=galaxy", "--cov=galaxy_i18n",
        "--cov-fail-under=65",
    ])
    unit["name"] = "pytest_unit"
    checks.append(unit)

    integration = _run([
        py, "-m", "pytest", "tests", "-q", "--tb=short",
        "-m", "integration",
    ])
    integration["name"] = "pytest_integration"
    integration["informational"] = not args.full
    checks.append(integration)

    ff = _run([py, "tools/verify_ffmpeg_caps.py"])
    ff["name"] = "verify_ffmpeg_caps"
    checks.append(ff)

    bm = _run([py, "tools/benchmark_matrix.py"])
    bm["name"] = "benchmark_matrix"
    checks.append(bm)

    blocking = [c for c in checks if not c.get("informational") and not c.get("ok")]
    report = {
        "mode": "full" if args.full else "unit",
        "checks": [{k: v for k, v in c.items() if k not in ("stdout_tail", "stderr_tail")} for c in checks],
        "blocking_failures": [c.get("name", c.get("cmd", "?")) for c in blocking],
        "verdict": "PASS" if not blocking else "FAIL",
        "strategy": {
            "unit": "mock/subprocess-free logic, pytest-qt UI smoke, parametrized pipeline matrix",
            "integration": "real FFmpeg remux/encode + ffprobe (pytest -m integration)",
            "manual": "multi-tab GPU, driver matrix, large files, portable EXE smoke",
        },
        "honest_note": (
            "Industry practice (pytest-qt + mocked subprocess + separate integration tier) "
            "maximizes regression safety but cannot prove 100% bug-free quality."
        ),
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if not blocking else 1


if __name__ == "__main__":
    raise SystemExit(main())
