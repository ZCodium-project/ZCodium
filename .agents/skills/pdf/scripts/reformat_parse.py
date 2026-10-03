#!/usr/bin/env python3
"""
reformat_parse.py — Parse a markdown / text / PDF / HTML source into a
self-contained .html file ready for `render_html.cjs`.

Input formats (auto-detected by extension):
  .md / .markdown   — Markdown (markdown-it-py with GFM table + strikethrough)
  .txt              — Plain text (treated as a sequence of paragraphs)
  .pdf              — pdftotext -layout (requires poppler) → markdown-ish
  .html / .htm      — Pass-through body extraction (<body>…</body>)

Output: a single HTML file (templates/<template>/skeleton.html with
placeholders filled). Hand it to `node scripts/render_html.cjs`.

Usage:
    python3 reformat_parse.py --input doc.md --out page.html
    python3 reformat_parse.py --input doc.md --out page.html \
        --title "Q3 Review" --subtitle "FY26" --author "Jane" --date 2026-04-22 \
        --accent "#0066cc" --template default

Exit codes: 0 success, 1 bad args, 2 dep missing, 3 parse error
"""

import argparse
import importlib
import importlib.util
import re
import shutil
import subprocess
import sys
from datetime import date as _date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPTS_DIR.parent
TEMPLATES_DIR = SKILL_ROOT / "templates"


# ── Dependency bootstrap ──────────────────────────────────────────────────────
def ensure_deps() -> None:
    missing = []
    if importlib.util.find_spec("markdown_it") is None:
        missing.append("markdown-it-py")
    if not missing:
        return
    print(f"  Installing missing Python packages: {missing}", file=sys.stderr)
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--break-system-packages", "-q", *missing]
    )


ensure_deps()
from markdown_it import MarkdownIt  # noqa: E402


# ── Source readers ────────────────────────────────────────────────────────────
def read_source(path: Path) -> str:
    """Return markdown-ish text content for any supported input format."""
    suffix = path.suffix.lower()
    if suffix in (".md", ".markdown", ".txt"):
        return path.read_text(encoding="utf-8")
    if suffix == ".pdf":
        if shutil.which("pdftotext") is None:
            sys.exit(
                "error: pdftotext not found — install poppler "
                "(brew install poppler / apt install poppler-utils) "
                "or convert the PDF to .md upstream."
            )
        out = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            check=True,
            capture_output=True,
            text=True,
        )
        return out.stdout
    if suffix in (".html", ".htm"):
        # Pass-through: extract <body> if present, otherwise use the whole file.
        text = path.read_text(encoding="utf-8")
        m = re.search(r"<body[^>]*>(.*?)</body>", text, flags=re.S | re.I)
        return m.group(1) if m else text
    sys.exit(f"error: unsupported input format: {suffix}")


def is_html_source(path: Path) -> bool:
    return path.suffix.lower() in (".html", ".htm")


# ── Markdown → HTML ───────────────────────────────────────────────────────────
def md_to_html(text: str) -> str:
    md = (
        MarkdownIt("commonmark", {"breaks": False, "html": False, "linkify": True})
        .enable("table")
        .enable("strikethrough")
    )
    return md.render(text)


def infer_title_and_body(html: str, fallback_title: str) -> tuple[str, str]:
    """If the first element is <h1>, lift it as the document title."""
    m = re.match(r"\s*<h1[^>]*>(.*?)</h1>\s*", html, flags=re.S | re.I)
    if m:
        title = re.sub(r"<[^>]+>", "", m.group(1)).strip()
        body = html[m.end():]
        return title, body
    return fallback_title, html


# ── Template loading + placeholder fill ───────────────────────────────────────
def load_template(template_name: str) -> str:
    path = TEMPLATES_DIR / f"reformat-{template_name}" / "skeleton.html"
    if not path.exists():
        # Allow bare directory name as well.
        path = TEMPLATES_DIR / template_name / "skeleton.html"
    if not path.exists():
        sys.exit(
            f"error: reformat template not found: {template_name} "
            f"(tried {TEMPLATES_DIR}/reformat-{template_name}/skeleton.html)"
        )
    return path.read_text(encoding="utf-8")


def fill(template: str, **values: str) -> str:
    out = template
    for key, val in values.items():
        token = f"<!-- {key.upper()} -->"
        out = out.replace(token, val if val is not None else "")
    return out


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="Parse markdown/text/pdf → HTML")
    ap.add_argument("--input", required=True, help="Source file (.md / .txt / .pdf / .html)")
    ap.add_argument("--out", required=True, help="Output HTML path")
    ap.add_argument("--title", default="", help="Document title (default: first H1 or filename)")
    ap.add_argument("--subtitle", default="", help="Subtitle (cover line 2)")
    ap.add_argument("--author", default="", help="Author")
    ap.add_argument("--date", default="", help="Date (default: today)")
    ap.add_argument("--accent", default="#1d4ed8", help="Accent color (CSS hex)")
    ap.add_argument("--template", default="default", help="reformat-* template slug")
    args = ap.parse_args()

    src = Path(args.input)
    if not src.exists():
        sys.exit(f"error: input not found: {src}")

    raw = read_source(src)

    # If source is HTML, treat it as already-rendered body; otherwise render
    # markdown.
    body_html = raw if is_html_source(src) else md_to_html(raw)

    fallback_title = src.stem.replace("_", " ").replace("-", " ").strip().title()
    title, body_html = infer_title_and_body(body_html, args.title or fallback_title)

    template = load_template(args.template)
    page = fill(
        template,
        title=title,
        subtitle=args.subtitle,
        author=args.author,
        date=args.date or _date.today().isoformat(),
        accent=args.accent,
        body_html=body_html,
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(f"  OK Parsed → {out}  (title: {title!r}, {len(body_html):,} chars body)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(3)
