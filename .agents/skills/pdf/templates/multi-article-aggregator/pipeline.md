# Cowork pipeline (pseudocode + key code blocks)

> This route has no single-file skeleton. Copy this document and
> implement the nine steps below. Each step ships with a Python skeleton
> (playwright + pypdf + reportlab).

## 0. Input

```json
// posts_list.json
[
  {
    "url": "https://example.com/blog/post-1",
    "title": "Article Title",
    "date": "2026-01-12",
    "author": "Author Name",
    "category": "category-slug",
    "slug": "post-1"
  }
]
```

## 1. Fetch + clean DOM

```python
import asyncio
from playwright.async_api import async_playwright

HIDE_CSS = """
nav, header, footer, [class*="nav_"], [class*="footer"],
[class*="related"], [class*="share"], [class*="cookie"],
[class*="newsletter"], iframe, video,
[style*="padding-bottom:56%"] { display: none !important; }
svg, [class*="icon"] { max-width: 64px; max-height: 64px; }
"""

async def fetch_clean(url: str, out_pdf: str) -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1024, "height": 1366})
        await page.goto(url, wait_until="networkidle", timeout=60_000)

        # Inject hide CSS, wait for fonts + images, scroll to load lazy content
        await page.add_style_tag(content=HIDE_CSS)
        await page.evaluate("document.fonts.ready")
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(1800)
        await page.evaluate("Promise.all(Array.from(document.images).map(i => i.complete ? null : new Promise(r => i.onload = r)))")

        await page.pdf(
            path=out_pdf,
            format="A4",
            margin={"top": "16mm", "bottom": "16mm", "left": "16mm", "right": "16mm"},
            print_background=True,
        )
        await browser.close()
```

## 2. Per-article render (loop)

```python
import json
from pathlib import Path

posts = json.loads(Path("posts_list.json").read_text())
for i, post in enumerate(posts, 1):
    out = f"data/article-{i:02d}-{post['slug']}.pdf"
    asyncio.run(fetch_clean(post["url"], out))
    post["pdf_path"] = out
    post["pages"] = page_count(out)
```

## 3. Compute page offsets (mock pass)

```python
def page_count(pdf_path: str) -> int:
    from pypdf import PdfReader
    return len(PdfReader(pdf_path).pages)

mock_toc_pages = 1  # initial guess: TOC fits in 1 page
running = mock_toc_pages + 1
for post in posts:
    post["start_page_mock"] = running
    running += post["pages"]
```

## 4. TOC pass 1 (render with mock numbers, measure its own page count)

```python
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm

def build_toc(out_path: str, posts: list, page_field: str) -> int:
    """Render TOC to out_path; return page count (1 or 2)."""
    c = canvas.Canvas(out_path, pagesize=A4)
    width, height = A4
    margin_l = 22 * mm
    margin_t = 22 * mm
    y = height - margin_t

    c.setFont("Helvetica-Bold", 22)
    c.drawString(margin_l, y, "Table of Contents")
    y -= 14 * mm

    c.setFont("Helvetica-Oblique", 11)
    c.drawString(margin_l, y, f"{len(posts)} articles - compiled {today_iso()}")
    y -= 12 * mm

    # Group by category, then iterate
    by_cat: dict[str, list] = {}
    for p in posts:
        by_cat.setdefault(p.get("category", "_"), []).append(p)

    for cat, group in by_cat.items():
        c.setFont("Helvetica-Bold", 12)
        c.drawString(margin_l, y, cat)
        y -= 7 * mm
        for j, p in enumerate(group, 1):
            c.setFont("Helvetica", 10.5)
            title_str = f"{j}. {p['title']}"
            c.drawString(margin_l + 4 * mm, y, title_str[:80])
            page_num = str(p[page_field])
            c.drawRightString(width - margin_l, y, page_num)
            # dot leader
            c.setStrokeGray(0.6)
            c.setDash(1, 2)
            c.line(margin_l + 4 * mm + (len(title_str[:80]) * 5),
                   y - 1, width - margin_l - 8 * mm, y - 1)
            c.setDash()
            y -= 6 * mm
            if y < 30 * mm:
                c.showPage()
                y = height - margin_t

    c.save()
    return page_count(out_path)
```

Run pass 1:

```python
toc_pages_v1 = build_toc("data/_toc_v1.pdf", posts, page_field="start_page_mock")
```

## 5. Merge pass 1

```python
from pypdf import PdfWriter, PdfReader

def merge(out: str, parts: list[str]) -> None:
    w = PdfWriter()
    for f in parts:
        for p in PdfReader(f).pages:
            w.add_page(p)
    with open(out, "wb") as fp:
        w.write(fp)

merge("data/_combined_v1.pdf", ["data/_toc_v1.pdf"] + [p["pdf_path"] for p in posts])
```

## 6. Compute true page numbers (real TOC pages + cumulative article pages)

```python
running = toc_pages_v1 + 1
for post in posts:
    post["start_page_real"] = running
    running += post["pages"]
```

## 7. TOC pass 2 + merge pass 2

```python
toc_pages_v2 = build_toc("data/_toc_v2.pdf", posts, page_field="start_page_real")
assert toc_pages_v2 == toc_pages_v1, "TOC page count drifted; rerun pass-1 with corrected mock"

merge("output/final.pdf", ["data/_toc_v2.pdf"] + [p["pdf_path"] for p in posts])
```

## 8. Add outline / link annotations (optional)

```python
from pypdf import PdfWriter, PdfReader

def add_outlines(in_pdf: str, out_pdf: str, posts: list) -> None:
    r = PdfReader(in_pdf)
    w = PdfWriter()
    for p in r.pages:
        w.add_page(p)
    for post in posts:
        w.add_outline_item(post["title"], post["start_page_real"] - 1)  # 0-indexed
    with open(out_pdf, "wb") as fp:
        w.write(fp)

add_outlines("output/final.pdf", "output/final-with-outline.pdf", posts)
```

## 9. (Optional) Strip per-article trailing blank pages

```python
def strip_trailing_blanks(pdf: str, out: str, threshold: float = 0.9) -> int:
    """Return how many trailing pages were dropped (sparse < threshold% white)."""
    # Render each page to PNG via pdftoppm, count white-pixel ratio, drop tail.
    # Skipped here — see m16 reports/strip_manifest.json for the full algorithm.
    ...
```

After this step, **recompute offsets** and **rerun steps 4-7** because
the page count shifted.

---

## Checklist

- [ ] `posts_list.json` carries at least url / title / slug.
- [ ] Each `data/article-*.pdf` exists.
- [ ] `data/_toc_v1.pdf` page count == `data/_toc_v2.pdf` page count
      (otherwise rerun pass 1).
- [ ] `pdfinfo output/final.pdf | grep Pages` equals
      `toc_pages + sum(article pages)`.
- [ ] `pdfinfo output/final-with-outline.pdf` shows N outline entries.
- [ ] Spot-check five random TOC entries; the link jumps to the right
      first page of the right article.
