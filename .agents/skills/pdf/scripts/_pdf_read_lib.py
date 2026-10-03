"""Shared helpers for read_pdf_vision.py — page-spec parsing, output spill,
stderr progress, range coalescing.

Originally written for three read_pdf_* scripts; ptot and ocr have since been
replaced by inline cookbook recipes in SKILL.md, leaving vision as the only
consumer. Kept under the same name and module path because the helpers are
generic read-side concerns (not vision-specific) — a future cookbook helper
script could pick them up.

Stdlib-only on purpose: every consumer should be able to
`from _pdf_read_lib import ...` without pulling in a heavyweight dep tree.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Iterable

DEFAULT_MAX_STDOUT_BYTES = 2 * 1024


class PagesParseError(ValueError):
    pass


def parse_pages(raw: str | None) -> list[int] | None:
    """Parse "1-10" / "1,3,5" / "1-3,7,10-15" / "all" / None.

    Returns sorted, deduped, 1-based page numbers; or None for "all".
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s or s.lower() == "all":
        return None
    out: set[int] = set()
    for seg_raw in s.replace(" ", ",").split(","):
        seg = seg_raw.strip()
        if not seg:
            continue
        if "-" in seg:
            parts = seg.split("-")
            if len(parts) != 2:
                raise PagesParseError(f'Invalid page range "{seg}"')
            try:
                lo, hi = int(parts[0]), int(parts[1])
            except ValueError as e:
                raise PagesParseError(f'Invalid page range "{seg}"') from e
            if lo < 1 or hi < 1 or lo > hi:
                raise PagesParseError(f'Invalid page range "{seg}"')
            out.update(range(lo, hi + 1))
        else:
            try:
                n = int(seg)
            except ValueError as e:
                raise PagesParseError(f'Invalid page number "{seg}"') from e
            if n < 1:
                raise PagesParseError(f'Invalid page number "{seg}"')
            out.add(n)
    return sorted(out)


def validate_pages(pages: Iterable[int], total_pages: int) -> None:
    for p in pages:
        if p > total_pages:
            raise PagesParseError(
                f"Page {p} is out of range (PDF has {total_pages} pages)"
            )


def clamp_pages(pages: Iterable[int], total_pages: int) -> tuple[list[int], list[int]]:
    """Split a requested page list into (kept, dropped).

    `kept`    — pages within [1, total_pages]
    `dropped` — pages beyond total_pages

    Used by callers that prefer "trim to what's actually there" over a hard
    failure when the user / model asked for pages past the end of the PDF
    (a common failure mode: the model guesses 36 pages on a 10-page paper).
    """
    kept: list[int] = []
    dropped: list[int] = []
    for p in pages:
        (kept if p <= total_pages else dropped).append(p)
    return kept, dropped


def format_pages(pages: list[int]) -> str:
    """Compress a sorted page list — [1,2,3,7,10,11,12] → "1-3,7,10-12"."""
    if not pages:
        return ""
    groups: list[str] = []
    start = pages[0]
    prev = start
    for cur in pages[1:]:
        if cur == prev + 1:
            prev = cur
            continue
        groups.append(str(start) if start == prev else f"{start}-{prev}")
        start = cur
        prev = cur
    groups.append(str(start) if start == prev else f"{start}-{prev}")
    return ",".join(groups)


def cache_dir() -> Path:
    """Return ~/.cache/mavis/pdf-out/ — the spill destination for outputs
    larger than --max-stdout-bytes (default 2 KB). Lives under $HOME so it
    survives across runs and stays on the user's data partition.
    """
    return Path.home() / ".cache" / "mavis" / "pdf-out"


def hash_content(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def maybe_spill_to_file(content: str, ext: str, max_stdout_bytes: int) -> str:
    """If content > threshold, spill to ~/.cache/mavis/pdf-out/<hash>.<ext>
    and return a wrapper (markdown banner or JSON envelope) with preview.
    """
    total_bytes = len(content.encode("utf-8"))
    if max_stdout_bytes == 0 or total_bytes <= max_stdout_bytes:
        return content

    d = cache_dir()
    d.mkdir(parents=True, exist_ok=True)
    target = d / f"{hash_content(content)}.{ext}"
    target.write_text(content, encoding="utf-8")

    # Slice by bytes (CJK-safe via 'ignore' on incomplete tail).
    buf = content.encode("utf-8")
    preview = buf[:max_stdout_bytes].decode("utf-8", errors="ignore")
    preview_bytes = len(preview.encode("utf-8"))

    if ext == "json":
        return (
            json.dumps(
                {
                    "truncated": True,
                    "totalBytes": total_bytes,
                    "outputFile": str(target),
                    "previewBytes": preview_bytes,
                    "preview": preview,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        )
    # markdown
    return "\n".join(
        [
            "<!-- mavis-pdf: output truncated, full text spilled to disk -->",
            f"> ⚠ Full output: **{total_bytes:,} bytes** → `{target}`",
            f"> Showing first **{preview_bytes:,} bytes** below.",
            "> Read the file with `cat` / `grep`, or re-run with narrower `--pages`.",
            "",
            preview,
        ]
    )


def add_common_args(p: argparse.ArgumentParser) -> None:
    """Common --input / --pages / --json / --max-stdout-bytes flags."""
    p.add_argument(
        "--input", required=True, help="Path to the PDF file (required)."
    )
    p.add_argument(
        "--pages",
        default=None,
        help='Pages to read: "1-20", "1,3,5", "1-3,7,10-15", or "all" (default).',
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Output structured JSON instead of Markdown.",
    )
    p.add_argument(
        "--max-stdout-bytes",
        type=int,
        default=DEFAULT_MAX_STDOUT_BYTES,
        help=(
            f"If output exceeds this many bytes, spill the full text to "
            f"~/.cache/mavis/pdf-out/<hash>.{{md,json}} and only print a "
            f"preview + path to stdout. Set 0 to disable. "
            f"(default {DEFAULT_MAX_STDOUT_BYTES})"
        ),
    )


def emit(content: str, ext: str, max_stdout_bytes: int) -> None:
    """Write content (after optional spill) to stdout."""
    out = maybe_spill_to_file(content, ext, max_stdout_bytes)
    sys.stdout.write(out)
    if not out.endswith("\n"):
        sys.stdout.write("\n")


def info(msg: str) -> None:
    """Stderr progress line — not part of the structured output."""
    sys.stderr.write(f"  {msg}\n")
    sys.stderr.flush()


def warn(msg: str) -> None:
    sys.stderr.write(f"  ⚠ {msg}\n")
    sys.stderr.flush()


def die(msg: str, code: int = 1) -> None:
    sys.stderr.write(f"  ✖ {msg}\n")
    sys.stderr.flush()
    sys.exit(code)


def resolve_pages_or_exit(raw: str | None, total_pages: int) -> list[int]:
    """Parse a `--pages` spec and clamp it to the PDF's actual page count.

    Behaviour:
      - parse failure (malformed range)        → die() with the parse error
      - "all" / None                           → return [1..total_pages]
      - some requested pages exceed the total  → drop them, warn() once,
                                                 keep the rest
      - every requested page exceeds the total → die() (nothing to do)
    """
    try:
        parsed = parse_pages(raw)
    except PagesParseError as e:
        die(str(e))
    if parsed is None:
        return list(range(1, total_pages + 1))
    kept, dropped = clamp_pages(parsed, total_pages)
    if dropped:
        warn(
            f"Requested pages out of range (PDF has {total_pages} pages); "
            f"dropping {format_pages(dropped)}, keeping {format_pages(kept) or '(none)'}"
        )
    if not kept:
        die(
            f"No requested pages fall within the PDF's {total_pages} pages "
            f"(requested: {format_pages(parsed)})"
        )
    return kept


def resolve_input_or_exit(path: str) -> Path:
    p = Path(path).expanduser().resolve()
    if not p.is_file():
        die(f"File not found: {p}")
    return p


# Coalesce a page list into contiguous spans — used by the vision script to
# batch (lo, hi) ranges to pdf2image instead of one render call per page.
def to_ranges(pages: list[int]) -> list[tuple[int, int]]:
    if not pages:
        return []
    ranges: list[tuple[int, int]] = []
    start = pages[0]
    prev = start
    for cur in pages[1:]:
        if cur == prev + 1:
            prev = cur
            continue
        ranges.append((start, prev))
        start = cur
        prev = cur
    ranges.append((start, prev))
    return ranges


# Sanity: callers should always run with python3 ≥ 3.9 (matches macOS default).
def _ensure_py39() -> None:
    if sys.version_info < (3, 9):
        die(f"Python 3.9+ required, got {sys.version_info[:2]}")


_ensure_py39()
