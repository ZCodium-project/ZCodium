# REFORMAT — Apply Design to an Existing Document

> **Prerequisites.** Read [`html-pdf-spec.md`](html-pdf-spec.md) for the
> mechanical contract (page geometry, page-break rules, CJK cascade) and
> [`design-guide.md`](design-guide.md) for palette / typography choices.

REFORMAT is for taking an existing prose document (markdown, plain text, or
text-native PDF) and re-rendering it as a clean PDF report. It is **not** for
turning a markdown table of numbers into charts — for chart-heavy reports
switch to CREATE with `data-viz-report` (or write custom HTML).

---

## 1. Pipeline

```
source.md / .txt / .pdf / .html
        │
        │  reformat_parse.py
        │  ─ markdown-it-py renders body to HTML fragment
        │  ─ lifts the first H1 as document title
        │  ─ injects into templates/reformat-default/skeleton.html
        ▼
   page.html  (self-contained, single file)
        │
        │  render_html.cjs (Playwright Chromium)
        ▼
   report.pdf
```

One command runs the whole chain:

```bash
bash scripts/make.sh reformat \
  --input doc.md --out report.pdf \
  --title "My Report" --author "Jane Doe" \
  --accent "#0a7488"
```

---

## 2. Input formats

| Extension | Path | Notes |
|---|---|---|
| `.md` / `.markdown` | markdown-it (CommonMark + GFM table + strikethrough + linkify) | Best supported |
| `.txt` | Treated as markdown (paragraphs separated by blank lines) | OK for flat prose |
| `.pdf` | `pdftotext -layout` → markdown-ish text | Requires `poppler` (`brew install poppler`); two-column / scanned PDFs garble — use the READ route ([`read-guide.md`](read-guide.md)) first |
| `.html` / `.htm` | `<body>` extracted, used as `<!-- BODY_HTML -->` directly | Bypasses markdown-it; useful when you already have clean HTML |

If you have an image-only / scanned PDF, REFORMAT cannot help directly. Use
the READ route ([`read-guide.md`](read-guide.md)) to extract clean text via
vision first, then pipe the markdown into REFORMAT.

---

## 3. The default template

[`templates/reformat-default/`](../templates/reformat-default/) is auto-applied
when you don't pass `--template`. It is a clean A4 portrait layout:

- Cover: 4 px accent top rule + eyebrow ("REPORT · 2026-04-22") + H1 title +
  subtitle + author/date footer
- Body: page-breaking H1 (each section starts a new page), left-ruled H2,
  unadorned H3, accent-headed zebra tables, code blocks with monospace +
  light tint background, blockquotes with accent left border

All multi-page REFORMAT outputs must include clickable TOC/index navigation.
When the source already has a TOC, preserve or rebuild it as real internal
links. When the source has headings but no TOC, generate a visible TOC from the
heading structure before rendering. The TOC rows must link to stable heading or
section IDs in the generated HTML; do not ship a flat prose PDF with only page
numbers or plain text headings. See
[`html-pdf-spec.md §3.4`](html-pdf-spec.md#34-clickable-toc--index-links).

If you want a different layout (sidebar TOC, two-column body, tighter cover),
duplicate the directory:

```bash
cp -r templates/reformat-default templates/reformat-<your-slug>
$EDITOR templates/reformat-<your-slug>/skeleton.html
bash scripts/make.sh reformat --input doc.md --out r.pdf --template <your-slug>
```

Each `reformat-*` template must keep the placeholder names
`<!-- TITLE -->`, `<!-- SUBTITLE -->`, `<!-- AUTHOR -->`, `<!-- DATE -->`,
`<!-- ACCENT -->`, `<!-- BODY_HTML -->`. `reformat_parse.py` only knows about
those.

---

## 4. CLI options

```text
bash scripts/make.sh reformat --input <file> --out <pdf>
                              [--title T]              cover H1 (default: lifted from source's first H1, or filename)
                              [--subtitle S]           cover line 2
                              [--author A]             cover meta — author
                              [--date YYYY-MM-DD]      cover meta — date (default: today)
                              [--accent "#HEX"]        accent color (default: #1d4ed8)
                              [--template <slug>]      reformat-* template (default: default)
                              [--wait <ms>]            extra render settle (default 800)
                              [--keep-html]            preserve intermediate HTML (debug)
```

The `--wait` flag is rarely needed — the default template has no Chart.js or
heavy JS. Use `--keep-html` when you want to inspect what was passed to the
renderer.

---

## 5. Title-lifting behavior

By default, `reformat_parse.py` looks for the first `<h1>` in the rendered
HTML and lifts its inner text into the cover title. This means a typical
markdown file like:

```markdown
# Q3 Strategy Review

This document covers ...

## Section 1
...
```

… will produce a cover with title "Q3 Strategy Review" and a body that starts
at "## Section 1" (the H1 is removed from body since it's redundant with the
cover).

To **disable** this lift (keep the H1 visible in the body), pass `--title`
explicitly:

```bash
bash scripts/make.sh reformat --input doc.md --out r.pdf --title "Different Title"
```

In that case the source's `# Q3 Strategy Review` stays in the body, and the
cover shows "Different Title".

---

## 6. Re-skinning the accent

The default `--accent #1d4ed8` (indigo) is generic. Match the topic per
[design-guide.md palette table](design-guide.md#mood--base-palette):

| Topic | Accent |
|---|---|
| Engineering / hardware | `#0066cc` |
| Healthcare / wellness | `#0a7488` |
| Sustainability / ESG | `#3f7d3f` |
| Finance | `#0c8a5d` |
| Creative / portfolio | `#7c3aed` |
| Industrial / energy | `#d4621a` |

The accent drives the cover top rule, H1 underline, H2 left rule, table
header background, link border, blockquote left border. Re-skinning it
re-themes the whole document.

---

## 7. When NOT to use REFORMAT

REFORMAT renders prose. It does **not** add charts, KPI cards, status pills,
versus comparisons, or any of the visual primitives in
`data-viz-report`. If the user's source has tables of numbers and they
explicitly asked for a "data report" or "可视化报告":

| Source signal | What to do |
|---|---|
| Markdown with 3+ tables of numbers, "可视化", "图表" | **CREATE** with `data-viz-report` — hand-author HTML, drop chart cards |
| Markdown with KPI grid, "面板", "dashboard" | **CREATE** with `data-viz-report` |
| Plain markdown article (one user post, blog, memo) | **REFORMAT** with `default` |
| Multiple articles to merge | **CREATE** with `multi-article-aggregator` |
| Multi-country / multi-jurisdiction prose | **CREATE** with `multilang-research-report` |
| Restaurant menu | **CREATE** with `bilingual-menu-premium` |
| 2-page brand identity | **CREATE** with `brand-guide-2page` |

Trying to "reformat" a data-heavy markdown gives you a pretty document
without any chart — usually not what the user wanted.

---

## 8. Verification

```bash
# 1. Run reformat
bash scripts/make.sh reformat --input doc.md --out r.pdf --keep-html

# 2. Sanity checks
pdfinfo r.pdf | grep Pages
pdftotext -layout r.pdf - | head -40
ls -lh r.pdf            # should be > 50 KB for a real report

# 3. Eyeball
open r.pdf
# Click at least 3 TOC/index entries (or all entries when fewer than 3) and
# confirm they jump to the intended pages.

# 4. Confirm navigation exists; pdftotext alone cannot prove clickability
python3 - <<'PY'
from pypdf import PdfReader
r = PdfReader('r.pdf')
annots = sum(len(p.get('/Annots') or []) for p in r.pages)
outline = getattr(r, 'outline', [])
print({'link_annotations_or_widgets': annots, 'outline_items': len(outline) if isinstance(outline, list) else 'present'})
PY

# 5. If something is off, inspect the intermediate HTML
ls /var/folders/.../pdfgen-reformat.*/page.html   # printed by --keep-html
```

If the output is suspiciously small (< 5 KB), `render_html.cjs` exits with
code 3 and a JSON error — usually a JS error in the source HTML or a missing
font / image.

---

## 9. Pitfalls

- **Title lift surprises you.** If your source's first H1 isn't the document
  title (e.g. it's "Introduction"), pass `--title` explicitly.
- **Tables overflow.** Markdown tables inherit the source's column width. If
  the resulting table is too wide, edit the source markdown to use shorter
  cell content or convert to a list of bullets.
- **PDF source is image-only.** `pdftotext` returns empty. Use the READ
  route ([`read-guide.md`](read-guide.md)) with vision to extract first,
  save as `.md`, then reformat.
- **TOC is plain text.** Markdown headings rendered correctly, but the PDF has
  no clickable navigation. Generate a TOC from the heading tree, add stable
  anchor IDs, and verify the final PDF links/outline before delivery.
- **Mixed CJK + Latin without spaces.** markdown-it does the right thing but
  the system font cascade is what makes characters render correctly; see
  [html-pdf-spec.md §4](html-pdf-spec.md#4-typography).
- **HTML source with inline `<script>`.** REFORMAT pass-through respects it;
  the renderer waits for `networkidle`. If the script depends on a CDN that
  fails, the body won't update — vendor the script next to the HTML.
