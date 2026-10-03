---
name: pdf
description: >
  Unified PDF skill — generate, reformat, fill, and read PDFs. Covers: text-to-PDF (reports,
  resumes, proposals, 可视化报告), LaTeX thesis, Markdown→PDF conversion, PDF form filling, and PDF
  reading/extraction/OCR. Trigger on any task with PDF as primary input or output. Not for DOCX or
  PPT.
descriptions:
  zh-Hans: '生成、重排、填写和读取 PDF，支持报告、简历、提案、Markdown/LaTeX 转 PDF、表单和 OCR。'
metadata:
  version: '3.0'
  category: document-pdf
---

<!--
Copied from MiniMaxAI/minimax-code (packages/local-runtime/assets/skills/pdf)
at revision 564e9166d81f87b0b767b005e4779d4697b512be.
Copyright (c) 2026 MiniMax Code. Licensed under MIT.
Modified by ZCode: added this provenance notice only; skill content is otherwise unchanged.
See THIRD-PARTY-NOTICES.md in the repository root for license and provenance.
-->

# pdf

Unified PDF skill. The model chooses the route based on user intent; this SKILL.md is an index. Each
route has its own guide in `docs/`. Read the guide before authoring or running anything.

## Operational rules — read before doing anything

> **1. Match user query against [`docs/pitfalls-index.md`](docs/pitfalls-index.md) FIRST.** It
> contains 10 production-ready **canonical query templates** (P1–P10), each with a
> `Match signatures` block (sample queries) and a complete executable prompt that already encodes
> every known pitfall, verification gate, and fall-back path. Workflow:
>
> 1. Scan the Quick lookup table — match user's query keywords to a row.
> 2. **Copy the matching canonical query verbatim**, substitute the `Slots` (e.g. `{PDF_PATH}`,
>    `{OUTPUT_PATH}`) with the user's actual values, and execute step-by-step.
> 3. Multiple partial matches → fuse: take the strictest verification from each, never relax a
>    constraint.
> 4. No match → fall back to the Routes / route guides below.
>
> Do NOT skip verification steps in the canonical queries — they exist because past evaluation runs
> shipped wrong outputs without them.

> **2. Locate before bulk-extracting any non-trivial PDF.** Three independent thresholds, all
> enforced together:
>
> | Threshold                                                              | Rule                                                                                                                                            |
> | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
> | **>20 pages** AND user wants a specific datum (not the whole document) | locate-first is **mandatory** — do not run pdfplumber over every page; build a heading index first (pypdf outline → printed TOC → keyword grep) |
> | **2 blind grep passes** without landing on the target                  | stop and build the heading index, regardless of page count — a 3rd / 4th / 5th keyword search is the most common time sink                      |
> | **>200 pages**                                                         | always build a heading index up-front, even before the first grep — at this size 6-8 blind greps balloon into 30+ shell calls                   |
>
> See [`docs/read-guide.md`](docs/read-guide.md) §3 for the actual outline / TOC / grep recipes.

> **3. Chart pages and complex financial tables — vision, ONE PAGE PER CALL, mandatory.** Any page
> with a chart / diagram / info-graphic whose values matter, **or** any page with a complex
> financial / regulatory table (balance sheet, income statement, cash-flow, debt schedule —
> multi-level headers, merged cells, footnoted sub-totals), MUST be read visually, **one page per
> call, never a range** — pdfplumber returns scrambled fragments on these layouts even when the PDF
> is text-native, and packing neighbour pages into one image makes the model mis-attribute values to
> the wrong page. **Pick the visual path by model capability:**
>
> - **Vision-capable model (e.g. M3 — can natively accept image input):** rasterise that single page
>   to PNG (`pdftoppm` / `pypdfium2`, or `scripts/render/page_rasterize.py`) and read the PNG
>   directly with the **Read tool**. Faster, offline, no upstream LLM call — this is the default
>   now.
> - **Text-only model (e.g. M2.7 — cannot see images):** fall back to `read_pdf_vision.py` invoked
>   with `--pages N` (a single page), which ships the page to native Matrix vision.

> **4. Verify HTML→PDF page size and chart presence after every render.** Always pass `--format A4`
> or `--format Letter` explicitly to `make.sh render` — Chromium overrides CSS `@page { size }` when
> the CLI flag is missing. After render:
>
> ```bash
> pdfinfo out.pdf | grep "Page size"        # must match user intent
> pdfimages -list out.pdf | tail -n +3 | wc -l   # ≥ 1 per chart / logo
> ```
>
> `pdftotext` cannot see images and will silently pass a chart-less deck. Both checks are mandatory.

> **5. Don't suppress stderr.** `2>/dev/null` is **never** the right choice in this skill
> (`make.sh render`/`reformat`/`fill`, `read_pdf_vision.py`, `pdfinfo`, `pdftotext`, `pdfimages`,
> `qpdf`). On failure you lose the only signal that explains why and have to rerun blind. If output
> is too noisy, redirect to a log file and grep on demand:
>
> ```bash
> python3 -m scripts.read_pdf_vision --input report.pdf --pages 5 \
>   2>/tmp/vision.log
> # If the result looks wrong, only then:
> #   grep -in "error\|trace\|fail\|502\|413" /tmp/vision.log | head -20
> ```

> **6. Always serialise JSON with `ensure_ascii=False`.** When this skill writes a JSON config /
> manifest that a downstream step parses (chart data, content manifests, form values), use
> `json.dumps`, never hand-concatenate strings. CJK / smart quotes / em-dashes in data are the most
> common reason a "looks fine" JSON file fails to `json.load()`:
>
> ```python
> Path("content.json").write_text(
>     json.dumps(payload, ensure_ascii=False, indent=2),
>     encoding="utf-8",
> )
> ```

> **7. AcroForm fill — copy the one canonical pypdf snippet.** In pypdf ≥ 4 the only working pattern
> is `PdfWriter(clone_from=src)` + `update_page_form_field_values(...)`
>
> - `set_need_appearances_writer(True)`. `clone_reader_document_root`, direct `/Annots` patching,
>   and `append_pages_from_reader` all _silently_ produce a PDF with no values written — there is no
>   error to debug. See [`docs/forms-guide.md`](docs/forms-guide.md) §B.

> **8. Header/footer discipline for generated PDFs.** For any formal or multi-page PDF (contracts,
> reports, proposals, forms, manuals, translated documents), decide the header/footer strategy
> before rendering: preserve source headers/footers when present; otherwise add a conservative
> running header/footer or explicitly justify why none is appropriate (e.g. cover-only one-pager).
> Reserve print-space so running elements do not collide with body content, tables, signatures, or
> charts. Verification must include a visual check of at least one body page and the
> final/signature/table-heavy page, not only `pdftotext`. Implementation details live in
> [`docs/html-pdf-spec.md`](docs/html-pdf-spec.md) §3.3.

> **9. DOCX→PDF is a DOCX-native render/export task, not an HTML task.** When the user asks to
> convert a Word/DOCX file to PDF while preserving the Word document, route to `docx` / the DOCX
> renderer first (e.g. `scripts/docx_to_pdf.py` or LibreOffice/soffice export). DOCX already has
> native page geometry, styles, sections, headers/footers, fields, numbering, and table layout;
> converting DOCX → Markdown/HTML → PDF just to make a PDF is a fidelity bug. Verify the native PDF
> with `pdfinfo`, `pdftotext`, and visual spot checks. Use HTML→PDF only for explicit
> redesign/recomposition, when the native render is visibly unacceptable, or when the requested
> deliverable is a newly authored web/print design. If HTML is used, say it is a recomposition
> route, not the default DOCX→PDF conversion path.

> **10. Every PDF output needs clickable TOC/index navigation, regardless of route.** This is a
> global delivery contract for CREATE, REFORMAT, LATEX_THESIS, FILL/overlay, MUTATE/merge/split,
> DOCX-native export handoff, and any read→write chain. Any multi-page PDF produced, transformed,
> merged, or substantially reformatted by this skill must include a visible TOC / index that maps
> major sections to their destination pages and is clickable in the final PDF. For HTML→PDF,
> implement TOC rows as internal anchors (`<a href="#section-id">`) and give every target section a
> stable, unique `id`. For LaTeX, `hyperref` is mandatory and `\tableofcontents` plus any manual
> `\addcontentsline` targets must resolve to live links. For markdown/text reformatting, generate or
> preserve a TOC before rendering; do not ship a flat prose PDF without navigable section links. For
> filled forms, official one-page forms may omit TOC, but multi-page filled packets must preserve
> existing bookmarks/links or add an index/outline without altering the form semantics. For
> merged/split/watermarked/pypdf/reportlab-built outputs, preserve existing links where possible and
> add/update PDF outline/bookmarks plus `/Link` annotations when the visible TOC cannot be generated
> by the renderer alone. Exceptions are only single-page forms/posters/certificates or
> source-faithful official forms where adding pages/visual TOC would invalidate the document; the
> delivery note must explicitly say why and what navigation was preserved instead. Verification must
> include checking link or outline annotations and spot-clicking several TOC/index entries to
> confirm they land on the intended pages.

## Routes — pick by user intent, then read the guide

### WRITE a PDF

| Intent                                                                                                                                                              | Guide                                                                                                                                                               | Entry                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **CREATE** — author a polished PDF from scratch (cover, charts, KPI grids, branded report)                                                                          | [`docs/create-guide.md`](docs/create-guide.md) + [`docs/design-guide.md`](docs/design-guide.md) + [`templates/INDEX.md`](templates/INDEX.md)                        | `bash scripts/make.sh render --in page.html --out out.pdf`   |
| **REFORMAT** — restyle markdown / text / pdf as a clean PDF (no charts, no design recomposition)                                                                    | [`docs/reformat-guide.md`](docs/reformat-guide.md)                                                                                                                  | `bash scripts/make.sh reformat --input src.md --out out.pdf` |
| **FILL** — write values into a PDF form (AcroForm or visual overlay)                                                                                                | [`docs/forms-guide.md`](docs/forms-guide.md)                                                                                                                        | `bash scripts/make.sh fill probe form.pdf`                   |
| **LATEX_THESIS** — typeset an academic thesis/dissertation with LaTeX (Chinese university template, GB/T 7714 bibliography, cover merge)                            | [`docs/latex-academic-thesis-guide.md`](docs/latex-academic-thesis-guide.md)                                                                                        | tectonic / xelatex + qpdf merge                              |
| **LATEX_TECHNICAL_BOOK** — typeset a Chinese technical book / engineering monograph / source-code reading book with LaTeX (B5, O'Reilly-like cover, code, diagrams) | [`docs/latex-technical-book-guide.md`](docs/latex-technical-book-guide.md) + [`templates/latex-technical-book/README.md`](templates/latex-technical-book/README.md) | latexmk -xelatex                                             |
| **MUTATE** — merge / split / rotate / crop / watermark / encrypt / annotate / sign / replace text                                                                   | [`docs/advanced-reference.md`](docs/advanced-reference.md)                                                                                                          | qpdf / pypdf / reportlab cookbook (no in-skill route)        |

> Mechanical contract for any HTML→PDF authoring (page geometry, page-break rules, Chart.js settle,
> CJK cascade, color fidelity) lives in [`docs/html-pdf-spec.md`](docs/html-pdf-spec.md). Read it
> before writing any new HTML.

### READ a PDF

| Intent                                                                                | Guide                                            | Entry                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| **Default** — text + tables from any text-native PDF                                  | [`docs/read-guide.md`](docs/read-guide.md) §3.1  | `pdfplumber` (5–10 line inline recipe)                               |
| **Vision escalation** — scanned / image-only PDFs, chart values, broken reading order | [`docs/vision-guide.md`](docs/vision-guide.md)   | `python3 -m scripts.read_pdf_vision --input report.pdf --pages 1-30` |
| Coordinate-aware extraction, page count, decryption, rasterise pages                  | [`docs/read-guide.md`](docs/read-guide.md) §3–§4 | inline cookbook recipes                                              |

> Default to **pdfplumber**. Only escalate to vision when the text path is insufficient (`(cid:NNN)`
> glyphs, empty strings, charts that matter, magazine-style layout). **When vision IS needed, check
> the running model first:** a vision-capable model (e.g. M3) should rasterise the page(s) to PNG
> and read them with the Read tool directly — no daemon, no MCP, no upstream LLM call.
> `read_pdf_vision.py` is the fallback for text-only models (e.g. M2.7) that cannot accept image
> input. See [`docs/read-guide.md`](docs/read-guide.md) §3.3 and
> [`docs/vision-guide.md`](docs/vision-guide.md).

### Combined chains — read then write

When the source is an existing PDF, run the read route first, then feed the extracted text/markdown
into REFORMAT or CREATE. Common patterns:

| User intent                           | Read step                                                                                                                     | Write step                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restyle an existing PDF               | pdfplumber recipe ([`docs/read-guide.md`](docs/read-guide.md) §3.1) for text-native, or `read_pdf_vision.py` for layout-heavy | REFORMAT — pass extracted markdown as `--input`                                                                                                                                                                           |
| Fill an unfamiliar form               | `read_pdf_vision.py` to describe field layout/labels                                                                          | `bash scripts/make.sh fill probe`, then [`docs/forms-guide.md`](docs/forms-guide.md)                                                                                                                                      |
| Author a PDF inspired by a reference  | `read_pdf_vision.py` on the reference (palette, cover, sections)                                                              | CREATE — encode cues in HTML (CSS variables + cover archetype)                                                                                                                                                            |
| Translate a PDF/EML preserving layout | EML: parse text/html + cid assets; PDF: pdfplumber per page (or vision if scanned / broken layout)                            | REFORMAT + [`templates/translate-preserve-layout/`](templates/translate-preserve-layout/); for rich EML load [`docs/email-translation-goldman-two-sessions-case.md`](docs/email-translation-goldman-two-sessions-case.md) |
| Verify a generated PDF (sanity loop)  | pdfplumber on the freshly written file                                                                                        | n/a — write → read                                                                                                                                                                                                        |

## Out of scope

- OCR a single image with no PDF involved → call any vision tool directly.
- Desktop-grade PDF editing (paragraph reflow, font substitution) → not an automation job.
- `.docx` or `.pptx` → use `docx` / `pptx`.
- Authoring long-form thesis **content** from scratch → the skill provides the compilation toolchain
  and format scaffold only; do not generate full thesis body text without user-provided source
  material.

## Reference index

| File                                                                                                               | Purpose                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/pitfalls-index.md`](docs/pitfalls-index.md)                                                                 | **Read first when the task matches a known case.** 10 evaluation cases keyed by task signature → past failure → recommended trace                                                     |
| [`docs/create-guide.md`](docs/create-guide.md)                                                                     | CREATE route: 4-step flow, component primitive cookbook, cover archetype re-skinning, verification checklist                                                                          |
| [`docs/latex-academic-thesis-guide.md`](docs/latex-academic-thesis-guide.md)                                       | LATEX_THESIS route: trigger signatures, input checklist, tectonic/xelatex compile chain, qpdf merge, verification gates, common pitfalls                                              |
| [`docs/latex-technical-book-guide.md`](docs/latex-technical-book-guide.md)                                         | LATEX_TECHNICAL_BOOK route: Chinese technical book / engineering monograph scaffold, HTML style mapping, B5 book compile and verification                                             |
| [`docs/markdown-static-academic-data-viz-case.md`](docs/markdown-static-academic-data-viz-case.md)                 | P3 progressive case: Markdown report → A4 print-academic PDF, preserve source hierarchy, generate Matplotlib static charts for source tables, verify images/text/no Markdown remnants |
| [`docs/email-translation-goldman-two-sessions-case.md`](docs/email-translation-goldman-two-sessions-case.md)       | P5 progressive case: rich EML research report → Chinese A4 PDF, optimized translation prompt, cid image preservation, link/image verification evidence                                |
| [`docs/ai-voice-cloning-regulatory-report-case.md`](docs/ai-voice-cloning-regulatory-report-case.md)               | P4 progressive case: AI voice cloning multi-jurisdiction regulatory survey → Chinese A4 PDF, bilingual research prompts, fact-check report, optimized print-academic HTML source      |
| [`docs/reformat-guide.md`](docs/reformat-guide.md)                                                                 | REFORMAT route: input formats, title-lift, accent re-skinning, "when NOT to REFORMAT"                                                                                                 |
| [`docs/forms-guide.md`](docs/forms-guide.md)                                                                       | FILL route: probe → AcroForm or visual overlay, JSON schemas, geometry lint                                                                                                           |
| [`docs/read-guide.md`](docs/read-guide.md)                                                                         | READ route: pdfplumber default, library + CLI cookbook, troubleshooting                                                                                                               |
| [`docs/vision-guide.md`](docs/vision-guide.md)                                                                     | `read_pdf_vision.py` reference — flags, JSON schema, internal chunking, time budget, error matrix                                                                                     |
| [`docs/html-pdf-spec.md`](docs/html-pdf-spec.md)                                                                   | HTML→PDF mechanical contract — page geometry, page-break, Chart.js settle, CJK, color fidelity, quality gate                                                                          |
| [`../xlsx/docs/superstore-multiformat-conversion-case.md`](../xlsx/docs/superstore-multiformat-conversion-case.md) | Cross-skill X8/P9 case: 10k-row Superstore Excel → CSV/JSON/HTML→PDF + XML-template CSV→XLSX                                                                                          |
| [`docs/design-guide.md`](docs/design-guide.md)                                                                     | Aesthetic layer — palette mood table, typography pairs, cover archetypes, anti-patterns                                                                                               |
| [`docs/advanced-reference.md`](docs/advanced-reference.md)                                                         | Mutation / annotation / signature / text replacement cookbook (qpdf, pypdf, reportlab)                                                                                                |
| [`docs/troubleshooting.md`](docs/troubleshooting.md)                                                               | Environment / CJK / merge / verification / stale-script / read-side issues                                                                                                            |
| [`templates/INDEX.md`](templates/INDEX.md)                                                                         | Templates index — eight skeletons + LaTeX thesis scaffold                                                                                                                             |
| [`templates/latex-academic-thesis/source.tex`](templates/latex-academic-thesis/source.tex)                         | Compact LaTeX thesis scaffold — cover, abstract, TOC, body, refs, appendix, headers/footers, page-number breaks                                                                       |
| [`templates/latex-technical-book/source.tex`](templates/latex-technical-book/source.tex)                           | Technical book scaffold — O'Reilly-like cover, red-number TOC, code highlighting, callouts, diagrams, B5 geometry                                                                     |
| [`templates/latex-academic-thesis/README.md`](templates/latex-academic-thesis/README.md)                           | Template fill-in guide — structural invariants, compile commands, common patterns                                                                                                     |

## Environment

> **First run on a new machine?** Always start with `bash scripts/make.sh check`. If anything prints
> `WARN`, run `bash scripts/make.sh fix` immediately and re-run `check` until the output is all
> green. Generation routes assume a green environment — proceeding with `WARN` will fail
> mid-pipeline.

```bash
bash scripts/make.sh check        # verify CREATE / REFORMAT / FILL / READ deps
bash scripts/make.sh fix          # auto-install missing deps (idempotent)
```

`check` enforces minimum versions (Python ≥ 3.9, Node ≥ 18, pypdf ≥ 3.0, markdown-it-py ≥ 3.0) and
prints the actual installed version for each. `fix` propagates real `pip` failures (no longer
silently green) — read the last 20 lines of pip output it dumps on failure rather than re-running
blindly.

| Tool                                          | Used by                        | Install                                                        |
| --------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Python 3.9+                                   | all `.py` scripts              | system                                                         |
| `markdown-it-py`                              | REFORMAT (`reformat_parse.py`) | `pip install markdown-it-py`                                   |
| `pypdf`                                       | FILL, MUTATE                   | `pip install pypdf`                                            |
| `pdfplumber`                                  | READ (default)                 | `pip install pdfplumber`                                       |
| `pdf2image`, `pillow`, `pypdfium2`            | READ vision + page rasterise   | `pip install pdf2image pillow pypdfium2`                       |
| Node.js 18+                                   | `render_html.cjs`              | system                                                         |
| `playwright` + Chromium                       | `render_html.cjs`              | `npm install -g playwright && npx playwright install chromium` |
| `pdfinfo`, `pdftotext`, `pdfimages` (poppler) | READ + verification            | `brew install poppler`                                         |
| `qpdf`                                        | MUTATE / decryption            | `brew install qpdf` (optional)                                 |

`read_pdf_vision.py` additionally requires local-runtime to be running with authenticated native
Matrix tools. Managed Matrix hosts use the Mavis login token; custom `MATRIX_BASE_URL` hosts
require `MATRIX_TOKEN` in the runtime environment.
Details: [`docs/vision-guide.md`](docs/vision-guide.md).

## Windows (win32) platform notes

All scripts in this skill are bash-based and run via **Git Bash** on Windows. The agent's shell is
PowerShell, so invoke scripts with the `bash` prefix:

```powershell
bash scripts/make.sh check
bash scripts/make.sh render --in page.html --out out.pdf --format A4 --wait 15000
bash scripts/make.sh reformat --input doc.md --out report.pdf
bash scripts/make.sh fill probe form.pdf
```

For piped verification commands, wrap in `bash -c`:

```powershell
bash -c "pdfinfo out.pdf | grep 'Page size'"
bash -c "pdfimages -list out.pdf | tail -n +3 | wc -l"
bash -c "pdftotext -layout out.pdf - | head -40"
```

**Tool mapping:**

| Unix reference         | Windows equivalent                                                  |
| ---------------------- | ------------------------------------------------------------------- |
| `python3`              | `python` (inside bash: the script's `PY` var handles this)          |
| `/tmp/pdf-*`           | Git Bash auto-maps `/tmp/` — no change needed                       |
| `brew install poppler` | `winget install` or `scoop install poppler`                         |
| `~/.zshrc`             | `$PROFILE` (PowerShell profile) or set env vars via System Settings |

**If Git Bash or any tool is missing**, read the `mavis` skill's
`references/windows-tool-bootstrap.md` for detection + auto-install commands.
