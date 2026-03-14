"""
Run backend release gates:
1) Read-only Firestore schema health check
2) Backend pytest suite

Usage:
  conda run -n py311 python backend/scripts/run_release_gates.py
"""

from __future__ import annotations

import subprocess
import sys


def _run(cmd: list[str]) -> int:
    print(f"\n$ {' '.join(cmd)}")
    proc = subprocess.run(cmd)
    return int(proc.returncode)


def main() -> int:
    checks = [
        [sys.executable, "backend/scripts/schema_health_check.py"],
        [sys.executable, "-m", "pytest", "backend/tests"],
    ]

    for cmd in checks:
        code = _run(cmd)
        if code != 0:
            return code

    print("\nAll release gates passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
