#!/usr/bin/env python3
"""Extract review comments (annotations) from PPTX files.

Parses the Open XML package directly using zipfile + ElementTree.
Phase 1: classic comments support.

Usage:
    python extract_comments.py <path_to_pptx>
    python extract_comments.py <path_to_pptx> --slides 1,3,5
    python extract_comments.py <path_to_pptx> --range 2-4
    python extract_comments.py <path_to_pptx> --search "keyword" [--ignore-case]
    python extract_comments.py <path_to_pptx> --format json

Works with Python >= 3.7, zero external dependencies.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class CommentRecord:
    slide_number: int
    kind: str  # "classic"
    author_id: str | None
    author_name: str | None
    author_initials: str | None
    created_at: str | None
    comment_id: str | None
    parent_id: str | None
    text: str
    part_name: str


# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def local_name(tag: str) -> str:
    """Strip namespace URI, returning only the local element name."""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def find_children_by_local_name(elem: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in elem if local_name(child.tag) == name]


def first_child_text(elem: ET.Element, name: str) -> str | None:
    for child in elem:
        if local_name(child.tag) == name:
            return (child.text or "").strip() or None
    return None


def collect_all_text(elem: ET.Element) -> str:
    """Recursively collect all text content under an element."""
    parts: list[str] = []
    if elem.text:
        parts.append(elem.text)
    for child in elem:
        parts.append(collect_all_text(child))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


# ---------------------------------------------------------------------------
# Package reader
# ---------------------------------------------------------------------------

def read_xml(zf: zipfile.ZipFile, entry: str) -> ET.Element | None:
    """Read and parse an XML entry from the ZIP, returning None on failure."""
    try:
        with zf.open(entry) as f:
            return ET.parse(f).getroot()
    except (KeyError, ET.ParseError) as exc:
        print(f"Warning: could not parse {entry}: {exc}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Author lookup
# ---------------------------------------------------------------------------

def build_classic_author_map(
    zf: zipfile.ZipFile,
) -> dict[str, tuple[str | None, str | None]]:
    """Return {authorId_str: (name, initials)} from ppt/commentAuthors.xml."""
    author_map: dict[str, tuple[str | None, str | None]] = {}
    root = read_xml(zf, "ppt/commentAuthors.xml")
    if root is None:
        return author_map
    for child in root:
        if local_name(child.tag) == "cmAuthor":
            aid = child.get("id")
            if aid is not None:
                author_map[aid] = (child.get("name"), child.get("initials"))
    return author_map


# ---------------------------------------------------------------------------
# Relationship resolver
# ---------------------------------------------------------------------------

# Relationship types that point to classic comment parts
_CLASSIC_COMMENT_REL_TYPES = {
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
    "http://schemas.microsoft.com/office/2011/relationships/comments",
}


def resolve_comment_parts(
    zf: zipfile.ZipFile, slide_entry: str
) -> list[tuple[str, str]]:
    """Return [(resolved_part_path, rel_type)] for comment-related rels of a slide."""
    rels_entry = (
        posixpath.dirname(slide_entry)
        + "/_rels/"
        + posixpath.basename(slide_entry)
        + ".rels"
    )
    root = read_xml(zf, rels_entry)
    if root is None:
        return []

    results: list[tuple[str, str]] = []
    for rel in root:
        if local_name(rel.tag) != "Relationship":
            continue
        rel_type = rel.get("Type", "")
        target = rel.get("Target", "")
        if not target:
            continue

        is_comment_rel = any(rt in rel_type for rt in _CLASSIC_COMMENT_REL_TYPES)
        if not is_comment_rel:
            continue

        # resolve relative target against slide directory
        if not target.startswith("/"):
            resolved = posixpath.normpath(
                posixpath.join(posixpath.dirname(slide_entry), target)
            )
        else:
            resolved = target.lstrip("/")

        results.append((resolved, rel_type))

    return results


# ---------------------------------------------------------------------------
# Classic comment parser
# ---------------------------------------------------------------------------

def parse_classic_comments(
    zf: zipfile.ZipFile,
    part_name: str,
    slide_number: int,
    author_map: dict[str, tuple[str | None, str | None]],
) -> list[CommentRecord]:
    root = read_xml(zf, part_name)
    if root is None:
        return []

    records: list[CommentRecord] = []
    for child in root:
        if local_name(child.tag) != "cm":
            continue

        author_id = child.get("authorId")
        author_name: str | None = None
        author_initials: str | None = None
        if author_id is not None and author_id in author_map:
            author_name, author_initials = author_map[author_id]

        # comment text lives in a <p:text> child (or similar local name "text")
        text = first_child_text(child, "text")
        if text is None:
            # fallback: try collecting all text recursively
            text = collect_all_text(child).strip()

        records.append(
            CommentRecord(
                slide_number=slide_number,
                kind="classic",
                author_id=author_id,
                author_name=author_name,
                author_initials=author_initials,
                created_at=child.get("dt"),
                comment_id=child.get("idx"),
                parent_id=None,
                text=text,
                part_name=part_name,
            )
        )
    return records


# ---------------------------------------------------------------------------
# Slide enumeration
# ---------------------------------------------------------------------------

_SLIDE_ENTRY_RE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")


def enumerate_slides(zf: zipfile.ZipFile) -> list[tuple[int, str]]:
    """Return sorted [(slide_number, entry_path)] for all slides in the package."""
    slides: list[tuple[int, str]] = []
    for entry in zf.namelist():
        m = _SLIDE_ENTRY_RE.match(entry)
        if m:
            slides.append((int(m.group(1)), entry))
    slides.sort(key=lambda x: x[0])
    return slides


# ---------------------------------------------------------------------------
# Main extraction
# ---------------------------------------------------------------------------

def extract_comments(pptx_path: str) -> list[CommentRecord]:
    """Extract all classic comments from a PPTX file."""
    with zipfile.ZipFile(pptx_path, "r") as zf:
        author_map = build_classic_author_map(zf)
        slides = enumerate_slides(zf)
        all_records: list[CommentRecord] = []
        for slide_number, slide_entry in slides:
            comment_parts = resolve_comment_parts(zf, slide_entry)
            for part_path, _rel_type in comment_parts:
                records = parse_classic_comments(
                    zf, part_path, slide_number, author_map
                )
                all_records.extend(records)
    return all_records


# ---------------------------------------------------------------------------
# Slide filtering
# ---------------------------------------------------------------------------

def parse_slide_numbers(raw: str) -> set[int]:
    nums: set[int] = set()
    for chunk in raw.split(","):
        v = chunk.strip()
        if not v:
            continue
        if not v.isdigit():
            raise ValueError(
                f'Invalid slide number "{v}". Use comma-separated positive integers.'
            )
        n = int(v)
        if n < 1:
            raise ValueError("Slide numbers must be >= 1.")
        nums.add(n)
    if not nums:
        raise ValueError("At least one slide number must be provided.")
    return nums


def parse_slide_range(raw: str) -> tuple[int, int]:
    m = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", raw)
    if not m:
        raise ValueError('Invalid range format. Use "start-end", for example "2-4".')
    start, end = int(m.group(1)), int(m.group(2))
    if start < 1 or end < 1:
        raise ValueError("Slide range values must be >= 1.")
    if start > end:
        raise ValueError("Slide range start must be <= end.")
    return start, end


def filter_records(
    records: list[CommentRecord],
    selected_numbers: set[int] | None,
    selected_range: tuple[int, int] | None,
    search: str | None,
    ignore_case: bool,
) -> list[CommentRecord]:
    filtered = records

    if selected_numbers is not None:
        filtered = [r for r in filtered if r.slide_number in selected_numbers]
    elif selected_range is not None:
        start, end = selected_range
        filtered = [r for r in filtered if start <= r.slide_number <= end]

    if search is not None:
        if ignore_case:
            q = search.casefold()
            filtered = [r for r in filtered if q in r.text.casefold()]
        else:
            filtered = [r for r in filtered if search in r.text]

    return filtered


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

def group_by_slide(
    records: list[CommentRecord], include_empty: bool, total_slides: int
) -> list[tuple[int, list[CommentRecord]]]:
    """Group records by slide number; optionally include empty slides."""
    from collections import OrderedDict

    grouped: dict[int, list[CommentRecord]] = OrderedDict()
    if include_empty:
        for n in range(1, total_slides + 1):
            grouped[n] = []
    for r in records:
        grouped.setdefault(r.slide_number, []).append(r)
    return list(grouped.items())


def format_text(
    records: list[CommentRecord], include_empty: bool, total_slides: int
) -> str:
    groups = group_by_slide(records, include_empty, total_slides)
    if not groups:
        return "No comments found."

    lines: list[str] = []
    for slide_num, comments in groups:
        lines.append(f"=== Slide {slide_num} ===")
        if not comments:
            lines.append("(no comments)")
            lines.append("")
            continue
        for c in comments:
            author = c.author_name or c.author_id or "Unknown"
            time_str = c.created_at or "unknown time"
            idx_str = f"idx={c.comment_id}" if c.comment_id else ""
            meta_parts = [author, time_str, c.kind]
            if idx_str:
                meta_parts.append(idx_str)
            meta = " | ".join(meta_parts)
            lines.append(f"- [{meta}]")
            lines.append(f"  {c.text}")
            lines.append("")
    return "\n".join(lines)


def format_json(
    records: list[CommentRecord], include_empty: bool, total_slides: int
) -> str:
    groups = group_by_slide(records, include_empty, total_slides)
    slides_out = []
    for slide_num, comments in groups:
        slide_obj: dict = {"slideNumber": slide_num, "comments": []}
        for c in comments:
            slide_obj["comments"].append(
                {
                    "kind": c.kind,
                    "authorName": c.author_name,
                    "authorInitials": c.author_initials,
                    "createdAt": c.created_at,
                    "commentId": c.comment_id,
                    "text": c.text,
                }
            )
        slides_out.append(slide_obj)
    return json.dumps({"slides": slides_out}, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract review comments (annotations) from PPTX files."
    )
    parser.add_argument("pptx_path", help="Path to the PPTX file.")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument(
        "--slides", help='Only inspect these slide numbers, e.g. "1,3,5".'
    )
    selection.add_argument(
        "--range", dest="slide_range", help='Continuous slide range, e.g. "2-4".'
    )
    parser.add_argument(
        "--search", help="Only show comments whose text matches this keyword."
    )
    parser.add_argument(
        "--ignore-case", action="store_true", help="Make search case-insensitive."
    )
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="Output format (default: text).",
    )
    parser.add_argument(
        "--include-empty",
        action="store_true",
        help="Include slides that have no comments in the output.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    pptx_path = args.pptx_path

    # validate file
    try:
        if not zipfile.is_zipfile(pptx_path):
            print("Failed to inspect PPTX comments: not a valid ZIP/PPTX file.", file=sys.stderr)
            return 1
    except (OSError, FileNotFoundError) as exc:
        print(f"Failed to inspect PPTX comments: {exc}", file=sys.stderr)
        return 1

    try:
        records = extract_comments(pptx_path)
    except Exception as exc:
        print(f"Failed to inspect PPTX comments: {exc}", file=sys.stderr)
        return 1

    # determine total slide count for --include-empty
    try:
        with zipfile.ZipFile(pptx_path, "r") as zf:
            total_slides = len(enumerate_slides(zf))
    except Exception:
        total_slides = max((r.slide_number for r in records), default=0)

    # apply filters
    try:
        selected_numbers = parse_slide_numbers(args.slides) if args.slides else None
        selected_range = (
            parse_slide_range(args.slide_range) if args.slide_range else None
        )
        records = filter_records(
            records, selected_numbers, selected_range, args.search, args.ignore_case
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    # output
    if args.format == "json":
        print(format_json(records, args.include_empty, total_slides))
    else:
        output = format_text(records, args.include_empty, total_slides)
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
