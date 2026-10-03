# reformat-default

> The default template for `bash make.sh reformat`. Takes any markdown / text /
> PDF input, renders the prose into a clean A4 portrait report. **No charts, no
> KPI cards** — for visual-heavy reports, use a CREATE template (e.g.
> `data-viz-report`) instead of REFORMAT.

## 1. When to use

- **EN keywords**: reformat, restyle, markdown to PDF, document conversion,
  prose report, make this look good
- **CN keywords**: 重排版、转 PDF、markdown 转 PDF、把这个文档变好看
- **Sample user asks**:
  - "把这个 .md 文件转成 PDF。"
  - "Reformat my markdown notes into a clean PDF."
  - "我有一份 PDF 文档，重新排版一下。"

This template is **automatically selected** when the user runs
`bash make.sh reformat` without `--template`. Other reformat-* templates can be
added in the same `templates/` directory and selected via `--template <slug>`.

## 2. Pipeline

`scripts/reformat_parse.py` does:

```
source.md           markdown-it-py            placeholder fill
or .txt or .pdf  ─►  → HTML fragment    ─►   skeleton.html → page.html
```

Then `scripts/render_html.cjs` renders `page.html` → `report.pdf` via
Playwright (Chromium headless).

## 3. Document shape

- **A4 portrait**, 18 mm vertical / 16 mm horizontal margins
- **Cover page**: 4 px accent rule on top + eyebrow + H1 title + optional
  subtitle + author/date meta block at the bottom
- **Body**: prose with rendered Markdown — H1/H2/H3, paragraphs, lists,
  blockquotes, code blocks, GFM tables, images
- Each H1 starts a new page (except the very first). H2 has a left rule. H3 is
  unadorned.
- Tables are accent-headed, zebra-striped, `page-break-inside: avoid`.

## 4. Visual params

**Palette** (neutral / general — re-skin per topic via `--accent`):
- Ink `#1a1a1a` body / `#444` secondary / `#666` tertiary / `#999` muted
- Rule `#e5e5e5` / Hairline `#efefef` / Mute `#f7f7f7`
- Accent **`<!-- ACCENT -->`** (defaults to `#1d4ed8` indigo from `make.sh`)
- Code block bg `#f4f4f6`, inline code text `#c7254e`

**Typography**:
- Body 10.5 pt / line-height 1.65
- Cover H1 32 pt 700, body H1 22 pt 700, H2 15 pt 700, H3 12 pt 600
- Code 9 pt SF Mono / Menlo / Consolas

**@page**:
```css
@page { size: A4 portrait; margin: 18mm 16mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
```

## 5. Skeleton

See [`skeleton.html`](skeleton.html) (~150 lines, single self-contained
file).

**Quick start**:
```bash
# One-shot via make.sh (recommended)
bash scripts/make.sh reformat \
  --input mydoc.md --out mydoc.pdf \
  --title "My Document" --author "Jane Doe" --accent "#0a7488"

# Or two-step manually
python3 scripts/reformat_parse.py --input mydoc.md --out /tmp/page.html \
  --title "My Document" --accent "#0a7488"
node scripts/render_html.cjs --in /tmp/page.html --out mydoc.pdf
```


### Legal contract round-trip case

For Word/DOCX legal contracts that must become a professional A4 PDF plus Markdown/HTML and reverse DOCX verification, do **not** rely on the default prose cover. Read [`../../docs/docx-contract-roundtrip-professional-case.md`](../../docs/docx-contract-roundtrip-professional-case.md) and start from [`cases/pku-contract-roundtrip/source.html`](cases/pku-contract-roundtrip/source.html).

## 6. Pitfalls

- **No charts.** This template renders prose only; markdown can't express
  charts / KPI cards / radar / scatter. If the source is data-heavy
  (benchmarks, comparisons), switch to `data-viz-report` and write a custom
  HTML rather than reformat.
- **First H1 lifted as title.** `reformat_parse.py` strips the leading `# Title`
  from the body and uses it as the cover title. If you want the H1 to remain in
  body, pass `--title "..."` explicitly so the lift is skipped.
- **Last page < 1/3 full.** Same anti-pattern as other templates: do not
  shrink margins to force-fit. Either accept the short tail or have the source
  expand.
- **PDF source with bad layout extraction.** `pdftotext -layout` works for
  text-native PDFs but garbles two-column / scanned PDFs. For those, use
  the READ route ([`../../docs/read-guide.md`](../../docs/read-guide.md))
  first to get clean text, then reformat.
- **CJK punctuation in tables.** Full-width `（）`、`：`、`／` overflow narrow
  cells. Edit the source markdown to use half-width punctuation inside table
  rows.
- **Lazy images / external `<img>` URLs.** `render_html.cjs` waits for
  `networkidle`, but very slow CDNs may still drop. Inline base64 or use
  `file://` paths for reliability.

## 7. Generalization

**Required placeholders** (filled by `reformat_parse.py`):
- `<!-- TITLE -->`, `<!-- SUBTITLE -->`, `<!-- AUTHOR -->`, `<!-- DATE -->`
- `<!-- ACCENT -->` (CSS hex)
- `<!-- BODY_HTML -->` (the rendered markdown)

**Structural invariants**:
- `@page A4 portrait` with 18/16 mm margins (do not change without re-tuning
  cover height `261mm`).
- Cover has accent top rule + eyebrow + title + subtitle + meta footer.
- H1 in body has `page-break-before: always` (except first).
- Tables use accent header + zebra body.

**Diversify per run.** Default accent is a generic blue — **change it**:

| Topic feel | Suggested accent |
| --- | --- |
| Engineering / hardware | `#0066cc` |
| Healthcare / wellness | `#0a7488` |
| Sustainability | `#3f7d3f` |
| Finance | `#0c8a5d` |
| Creative / portfolio | `#7c3aed` |
| Industrial / energy | `#d4621a` |

For richer customization (different cover layout, sidebar, custom hero),
duplicate this directory as `reformat-<your-slug>/`, edit `skeleton.html`,
and select with `--template <your-slug>`.
