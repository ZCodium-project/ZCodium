# pdf

A unified PDF skill for working with PDFs — generate, reformat, fill,
and read. **Five routes**, all in one skill:

- **CREATE** — render polished PDFs from scratch via Playwright Chromium
  (HTML+CSS → PDF), with 8 battle-tested templates.
- **REFORMAT** — restyle markdown / text / pdf as a clean PDF.
- **FILL** — write values into AcroForm fields or as a visual overlay
  on a non-fillable PDF.
- **READ** — extract text, tables, metadata, and (when needed) charts /
  scans from existing PDFs (pdfplumber default, vision escalation).
- **MUTATE** — cookbook-only (merge / split / rotate / crop / watermark /
  encrypt / annotate / sign / replace text via overlay).

`SKILL.md` is the routing index — it points to the per-route guide in
`docs/`. Read `SKILL.md` first, then the relevant guide.

## Quick start

```bash
bash scripts/make.sh check                                    # verify deps
bash scripts/make.sh fix                                      # auto-install missing deps

# CREATE — copy a template, edit, render
cp templates/data-viz-report/skeleton.html /tmp/page.html
$EDITOR /tmp/page.html
bash scripts/make.sh render --in /tmp/page.html --out /tmp/out.pdf --wait 15000

# REFORMAT — single command, markdown to PDF
bash scripts/make.sh reformat --input doc.md --out report.pdf --accent "#0a7488"

# FILL — probe then apply / overlay
bash scripts/make.sh fill probe form.pdf

# READ (default — pdfplumber inline recipe; see docs/read-guide.md §3.1)
python3 -c 'import pdfplumber; print(pdfplumber.open("doc.pdf").pages[0].extract_text())'

# READ (vision escalation — scanned / chart-heavy / broken layout)
python3 -m scripts.read_pdf_vision --input report.pdf --pages 1-30
```

---

## Routes

| Route | Use when | Read next |
|---|---|---|
| **CREATE** | Generate a polished PDF from scratch (chart-rich brief, brand guide, menu, report). | `docs/html-pdf-spec.md` → `docs/create-guide.md` |
| **REFORMAT** | Restyle an existing markdown / text / pdf as a clean PDF. | `docs/reformat-guide.md` |
| **FILL** | Put values into AcroForm fields, or visually overlay text onto a non-fillable PDF. | `docs/forms-guide.md` |
| **READ** | Extract text / tables / metadata / coordinates / images from an existing PDF. | `docs/read-guide.md` (+ `docs/vision-guide.md` for the vision escalation) |
| **MUTATE** | Merge / split / rotate / crop / watermark / encrypt / annotate / sign / replace text. | `docs/advanced-reference.md` (qpdf, pypdf, pdftk, reportlab — no in-skill route) |

---

## Layout

```text
SKILL.md                      <- route index (read first)
templates/                    <- 8 distilled HTML templates
  INDEX.md                    <- master template index
  bilingual-menu-premium/     <- premium bilingual menu (CREATE)
  brand-guide-2page/          <- 2-page brand guide (CREATE)
    cases/minimax-web-brand-guide/ <- MiniMax website→brand-guide exemplar source
  data-viz-report/            <- chart-rich data brief (CREATE)
  multi-article-aggregator/   <- article digest with TOC pagination (CREATE)
  multilang-research-report/  <- multi-jurisdiction regulatory report (CREATE)
  reformat-default/           <- default markdown→HTML target (REFORMAT)
  translate-preserve-layout/  <- layout-preserving translation (REFORMAT)
  form-fill-acroform/         <- AcroForm fill (FILL)
docs/
  html-pdf-spec.md            <- HTML→PDF mechanical contract (read before authoring)
  design-guide.md             <- aesthetic system: palette, typography, cover archetypes
  create-guide.md             <- CREATE: 4-step flow, primitive cookbook, verification
  reformat-guide.md           <- REFORMAT: input formats, title-lift, accent re-skin
  forms-guide.md              <- FILL: probe → AcroForm or visual overlay
  read-guide.md               <- READ: pdfplumber default + cookbook (text / tables / coords / raster)
  vision-guide.md             <- READ vision: read_pdf_vision.py reference
  troubleshooting.md          <- environment / CJK / chart / verification issues
  advanced-reference.md       <- PDF mutation / annotation / signatures cookbook
scripts/
  make.sh                     <- unified CLI (check / fix / render / reformat / fill)
  render_html.cjs             <- HTML or URL → PDF (Playwright)               [CREATE, REFORMAT]
  reformat_parse.py           <- md / txt / pdf → HTML (markdown-it-py)        [REFORMAT]
  merge.py                    <- merge multiple PDFs (pypdf)                   [utility]
  read_pdf_vision.py          <- pages -> native Matrix images_understand via local-runtime [READ vision]
  _pdf_read_lib.py            <- vision-side helpers (page-spec, spill, argparse) [READ vision]
  lib/                                                                         [FILL]
    geometry.py               <- coordinate transforms (img <-> pdf)
    acroform_io.py            <- AcroForm field read / write
    cli_utils.py              <- argparse / exit helpers (also used by READ)
  pdf_inspect/                                                                 [FILL]
    acroform_probe.py         <- detect: acroform=true|false
    acroform_inspect.py       <- AcroForm → field metadata JSON
    layout_scan.py            <- non-fillable PDF → layout JSON
  fill/                                                                        [FILL]
    acroform_apply.py         <- values.json → filled PDF (AcroForm)
    overlay_apply.py          <- fields.json → annotated PDF (overlay)
  render/                                                                      [FILL, READ]
    page_rasterize.py         <- PDF → PNG per page
    overlay_preview.py        <- page.png + fields.json → overlay PNG
  validate/                                                                    [FILL]
    geometry_lint.py          <- lint fields.json bbox geometry
```

---

## Reference index

| File | Purpose |
|---|---|
| `templates/INDEX.md` | Eight battle-tested PDF templates — start here for CREATE / REFORMAT / FILL |
| `docs/html-pdf-spec.md` | HTML→PDF mechanical contract (page geometry, page-break, Chart.js, CJK, color, quality gate) |
| `docs/design-guide.md` | Aesthetic system: palette mood table, typography, cover archetypes, anti-patterns |
| `docs/create-guide.md` | CREATE route: 4-step flow, primitive cookbook, cover archetype re-skinning, verification |
| `docs/reformat-guide.md` | REFORMAT route: input formats, title-lift, accent re-skinning, "when NOT to REFORMAT" |
| `docs/forms-guide.md` | FILL route: probe → AcroForm or visual overlay, JSON schemas, geometry lint |
| `docs/read-guide.md` | READ route: pdfplumber default, library + CLI cookbook, troubleshooting |
| `docs/vision-guide.md` | READ vision: `read_pdf_vision.py` reference (flags, JSON schema, error matrix) |
| `docs/troubleshooting.md` | Environment / CJK / chart settle / verification / stale-script issues |
| `docs/advanced-reference.md` | Deeper cookbook (qpdf / pypdf / pdftk for mutation; pypdf + reportlab for annotation, signatures, text replacement) |

---

## Dependencies

| Tool | Used by | Install |
|---|---|---|
| Python 3.9+ | `.py` scripts | system |
| `markdown-it-py` | `reformat_parse.py` | `pip install markdown-it-py` |
| `pypdf` | FILL, MUTATE | `pip install pypdf` |
| `pdfplumber` | READ default | `pip install pdfplumber` |
| `pdf2image`, `pillow`, `pypdfium2` | READ vision + page rasterise | `pip install pdf2image pillow pypdfium2` |
| Node.js 18+ | `render_html.cjs` | system |
| `playwright` + Chromium | `render_html.cjs` | `npm install -g playwright && npx playwright install chromium` |
| `pdfinfo`, `pdftotext`, `pdfimages` (poppler) | READ + verification | `brew install poppler` |
| `qpdf` | MUTATE / decryption | `brew install qpdf` (optional) |
| `reportlab` | advanced overlay / annotation (optional, see `advanced-reference.md`) | `pip install reportlab` |

`bash scripts/make.sh fix` installs everything required by CREATE /
REFORMAT / FILL / READ automatically. The optional tools are lazily
imported only when you reach for them in `advanced-reference.md`.

`scripts/read_pdf_vision.py` additionally requires local-runtime to be running
with authenticated native Matrix tools. Managed Matrix hosts use the Mavis login
token; custom `MATRIX_BASE_URL` hosts require `MATRIX_TOKEN` in the runtime
environment. See `docs/vision-guide.md`.

## License

MIT
