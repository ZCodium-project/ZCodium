"""Tiny CLI helpers shared across the MiniMax PDF skill scripts.

Each entry-point script in ``scripts/`` builds its argparse parser
through :func:`make_parser` so the help output, default ``--quiet`` /
``--verbose`` flags, and exit-code conventions stay uniform. The
``emit`` / ``warn`` / ``fail`` helpers funnel all chatter through a
single place so we can later switch to ``logging`` if needed.
"""

from __future__ import annotations

import argparse
import sys


def make_parser(prog: str, description: str) -> argparse.ArgumentParser:
    """Build a parser pre-loaded with the project-wide flags."""
    parser = argparse.ArgumentParser(prog=prog, description=description)
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress informational output (warnings and errors still print).",
    )
    return parser


def emit(msg: str, *, quiet: bool = False) -> None:
    """Print an informational message unless ``--quiet`` is in effect."""
    if not quiet:
        print(msg)


def warn(msg: str) -> None:
    """Print a warning to stderr; never silenced by ``--quiet``."""
    print(f"WARN: {msg}", file=sys.stderr)


def fail(msg: str, code: int = 1) -> None:
    """Print an error to stderr and exit with a non-zero status."""
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)
