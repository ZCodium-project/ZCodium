# Pitfalls Index — Canonical Query Templates

> **Match-and-fuse, don't read-and-think.** Each entry below is a
> production-ready prompt template. When the user's incoming query
> matches a `Match signatures` block, **copy the matching canonical
> query**, substitute the `Slots` with the user's actual values,
> and execute it verbatim. Each canonical query already encodes every
> known pitfall, every verification gate, and every fall-back path
> for that scenario — there is no extra "trace" to look up.
>
> If no signature matches, fall back to [`../SKILL.md`](../SKILL.md) routing.
> If a partial match (one of two slots fits), prefer **fusing** the
> matching template's verifications into your own plan rather than
> writing a new one from scratch.
>
> **Universal slot placeholders below** — these are referenced inside
> every canonical query and resolve at execution time:
>
> - `<SKILL>` → `{{DATA_DIR}}/.builtin-skills/pdf`
> - `<SKILL_XLSX>` → `{{DATA_DIR}}/.builtin-skills/xlsx`
> - `<TMP>` → a writable scratch dir (e.g. `/tmp/pdf-task-<ts>`)

---

## Quick lookup — match user query to a case

| # | Match keywords | Slots | Canonical §|
|---|---|---|---|
| **P1** | brand guide / cover / poster / 品牌指南 / 设计规范 from a website | `BRAND_URL`, `OUTPUT_PATH`, `BRAND_NAME`, `PAGE_COUNT(default 2)`, `AUDIENCE(intl/US)` | §P1 |
| **P2** | bilingual menu / 双语菜单 / formal printed deliverable / certificate / two-pager | `LANG_A`, `LANG_B`, `RESTAURANT_TYPE`, `ITEMS_JSON`, `OUTPUT_PATH`, `AUDIENCE` | §P2 |
| **P3** | markdown→PDF / convert structured text to chart-rich PDF / 可视化报告 / data brief | `INPUT_PATH(.md/.csv)`, `OUTPUT_PATH`, `CHART_COUNT`, `THEME(default light)` | §P3 |
| **P4** | research report across N jurisdictions / multi-region regulatory survey / 多国监管 | `TOPIC`, `JURISDICTIONS[]`, `OUTPUT_PDF`, `DEADLINE_MIN(default 30)` | §P4 |
| **P5** | translate this <EML/PDF> to <lang> preserving layout / 翻译保版 | `INPUT_PATH(.eml/.pdf)`, `TARGET_LANG`, `OUTPUT_PATH` | §P5 |
| **P6** | find <X> in this <100+ page PDF> / 长 PDF 定向提取 / extract specific data from annual report | `PDF_PATH`, `TARGET_QUERY`, `MAX_OUTPUT_PAGES(optional)` | §P6 |
| **P7** | convert <240-page financial PDF> to Excel/Word/Markdown / 复杂金融排版 PDF 转格式 | `PDF_PATH`, `OUTPUT_FORMAT`, `OUTPUT_PATH`, `STATEMENTS[]` | §P7 |
| **P8** | fill out this PDF form / AcroForm / visa / tax / contract / 表单填写 | `FORM_PDF`, `MATERIALS[]`, `OUTPUT_PDF`, `MISSING_FIELDS_REPORT(true)` | §P8 |
| **P9** | export 10k+ row spreadsheet as PDF / 大表打印 / tabular → PDF | `INPUT_XLSX`, `OUTPUT_PDF`, `ORIENTATION`, `REPEAT_HEADER`, `FULL_OR_PREVIEW` | §P9 |
| **P10** | convert <DOCX/PDF/MD/HTML> to <formats> with fidelity loss report / 双向转换 | `INPUT_PATH`, `TARGET_FORMATS[]`, `OUTPUT_DIR` | §P10 |

---

## P1 — Branded paged PDF from web content

### Match signatures

- "做一份 {BRAND_NAME}（{BRAND_URL}）的 brand guide / 品牌指南 PDF"
- "make a brand-guide / cover / poster PDF from {BRAND_URL}"
- "把 {site} 抓取的品牌元素整理成双页 PDF"
- "create a 2-page design system overview for {company}"

### Canonical query

```
TASK: Generate a {PAGE_COUNT}-page brand guide PDF for {BRAND_NAME} from
      {BRAND_URL}, output to {OUTPUT_PATH}.

STEP 1 — Environment preflight (mandatory)
  bash <SKILL>/scripts/make.sh check 2><TMP>/check.log
  # WARN/FAIL → bash <SKILL>/scripts/make.sh fix && re-run check

STEP 2 — Brand asset extraction (precise, not inferred)
  curl -sL "{BRAND_URL}" > <TMP>/brand.html 2><TMP>/curl.log
  # Palette — exact hex from CSS/SVG (NEVER infer from prose)
  grep -oE '#[0-9a-fA-F]{6}' <TMP>/brand.html | sort -u > <TMP>/palette.txt
  grep -oP 'fill="\K#[0-9a-fA-F]{6}' <TMP>/brand.html | sort -u >> <TMP>/palette.txt
  # Fonts
  grep -oiE 'font-family[: ][^;}"]+' <TMP>/brand.html | sort -u
  # Logo — download SVG / PNG separately
  # If <link rel="stylesheet"> points off-domain, fetch each one and grep colors there too.

STEP 3 — Template + fill placeholders
  cp <SKILL>/templates/brand-guide-2page/skeleton.html <TMP>/page.html
  # Replace <!-- PLACEHOLDER --> tokens with:
  #   - {BRAND_NAME}, tagline (LLM-extracted from site if user didn't supply)
  #   - 6-color palette from <TMP>/palette.txt (top 6 unique hex)
  #   - Font stack from grep above
  #   - Logo as <img src="data:image/...;base64,..."> or file:// reference

STEP 4 — Render (mandatory --format)
  bash <SKILL>/scripts/make.sh render \
    --in <TMP>/page.html --out {OUTPUT_PATH} \
    --format <A4 if AUDIENCE=intl|CJK else Letter> --wait 15000
  # Never rely on the renderer default; Chromium overrides CSS @page.

STEP 5 — Verification (BOTH gates mandatory)
  pdfinfo {OUTPUT_PATH} | grep "Page size"
  # Must print:  595.276 x 841.89 pts (A4)   OR   612 x 792 pts (Letter)
  # Mismatch → go back to STEP 4, do not ship.
  pdfimages -list {OUTPUT_PATH} | tail -n +3 | wc -l
  # Must be ≥ 1 (logo); typically ≥ 6 (logo + palette swatches + samples).
  # If 0 → Chart.js / fonts didn't settle. Bump --wait 30000, set
  # Chart.defaults.animation = false, wrap canvases in .avoid-break.

STEP 6 — Deliver with evidence
  Report: pdfinfo "Page size" line + pdfimages count + screenshot of page 1.

CONSTRAINTS (universal — do not violate):
  - NEVER `2>/dev/null` — redirect to <TMP>/*.log and grep on demand.
  - Palette MUST come from CSS/SVG hex, never from rendered prose ("looks blue-ish").
  - Always pass --format explicitly to make.sh render.
```

---

## P2 — Bilingual menu / formal printed two-pager

### Match signatures

- "做一份 {LANG_A}-{LANG_B} 双语 {RESTAURANT_TYPE} 菜单 PDF"
- "make a {LANG_A}/{LANG_B} bilingual menu / wine list / certificate"
- "design a 2-page formal printed PDF for {use_case}"

### Canonical query

```
TASK: Render a 2-page bilingual ({LANG_A} + {LANG_B}) {RESTAURANT_TYPE}
      menu PDF from items in {ITEMS_JSON}, output to {OUTPUT_PATH}.

STEP 1 — Preflight
  bash <SKILL>/scripts/make.sh check 2><TMP>/check.log

STEP 2 — Use the canonical template (do not author from scratch)
  cp <SKILL>/templates/bilingual-menu-premium/skeleton.html <TMP>/menu.html
  # Inject ITEMS_JSON: each item has {LANG_A_name, LANG_B_name, price, category}
  # Categories ≥ 3 (e.g. 前菜/Sushi/甘味). Pricing follows pricing_model.

STEP 3 — CJK font cascade verification
  # If LANG_A or LANG_B ∈ {zh, ja, ko}, the HTML MUST declare:
  #   font-family: -apple-system, "PingFang SC", "Hiragino Sans",
  #                "Apple SD Gothic Neo", "Helvetica Neue", sans-serif;
  # Cascade ORDER MATTERS — wrong order renders SC chars in JP forms.

STEP 4 — Render (canonical CLI shape)
  bash <SKILL>/scripts/make.sh render \
    --in <TMP>/menu.html --out {OUTPUT_PATH} \
    --format A4 --wait 15000
  # The flag is `--in` (not --input), `--out` (not --output).
  # A4 by default for CJK / international audiences.

STEP 5 — Verification (CJK-aware)
  pdfinfo {OUTPUT_PATH} | grep "Page size"   # 595x841 pts (A4)
  pdfimages -list {OUTPUT_PATH} | tail -n +3 | wc -l
  pdftotext -layout {OUTPUT_PATH} - | head -40
  # Look for [ ] [ ] tofu boxes in the CJK output. If any → install
  # missing CJK font (`brew install font-noto-sans-cjk-sc`), re-render.

STEP 6 — Spot-check first page visually (optional but recommended)
  pdftoppm -r 150 -png -f 1 -l 1 {OUTPUT_PATH} <TMP>/preview
  # Open <TMP>/preview-1.png to confirm typography & balance.

CONSTRAINTS:
  - Memorize the canonical render CLI shape: --in / --out (NOT --input / --output).
  - For CJK languages, verify font cascade ORDER, not just presence.
  - --format defaults to A4 here because menus are international/CJK; for
    US-only steakhouses pass --format Letter explicitly.
```

---

## P3 — Markdown / structured text → chart-rich PDF

### Match signatures

- "把 {INPUT_PATH} (markdown/csv) 转成含图表的 PDF 报告"
- "convert this benchmark / dataset / md into a visualized PDF"
- "make a data brief from {INPUT_PATH}"
- "可视化报告 / 图文报告 / 评测报告 / data report"

### Canonical query

```
TASK: Build a chart-rich PDF report from {INPUT_PATH}, with approximately
      {CHART_COUNT} charts (auto-estimate if unspecified), output to {OUTPUT_PATH}.

STEP 1 — Preflight
  bash <SKILL>/scripts/make.sh check 2><TMP>/check.log
  # Includes Playwright Chromium check; fix if WARN.

STEP 2 — Choose template
  cp -r <SKILL>/templates/data-viz-report/* <TMP>/
  # The skeleton.html has KPI grid, chart-card, takeaway-row, conclusion primitives.
  # If acceptance criteria require source hierarchy preservation, print-academic style,
  # and static charts only (no Chart.js/ECharts/D3/Plotly), load:
  #   <SKILL>/docs/markdown-static-academic-data-viz-case.md
  # and follow that case instead of the Chart.js skeleton path.

STEP 3 — Build content.json (mandatory ensure_ascii=False)
  python3 <<EOF
  import json, pathlib
  payload = {
      "title": "...",
      "kpis": [...],
      "charts": [{"id": "ch1", "type": "bar", "data": {...}}, ...],
      "tables": [...],
      "conclusion": "...",
  }
  pathlib.Path("<TMP>/content.json").write_text(
      json.dumps(payload, ensure_ascii=False, indent=2),
      encoding="utf-8",
  )
  EOF
  # NEVER hand-concatenate JSON strings. CJK quotes / em-dashes break json.load.

STEP 4 — Render (mandatory --format + long --wait for charts)
  bash <SKILL>/scripts/make.sh render \
    --in <TMP>/page.html --out {OUTPUT_PATH} \
    --format A4 --wait 15000
  # 15s baseline; if charts are non-trivial (>30 series, animated), use 25000.

STEP 5 — Verification (both gates mandatory; pdftotext alone is NOT enough)
  pdfinfo {OUTPUT_PATH} | grep "Page size"
  IMG_COUNT=$(pdfimages -list {OUTPUT_PATH} | tail -n +3 | wc -l)
  echo "Image count: $IMG_COUNT (expected ≥ {CHART_COUNT})"
  # IMG_COUNT < CHART_COUNT → at least one chart is a blank canvas.
  pdftotext -layout {OUTPUT_PATH} - | head -40   # body text sanity

STEP 6 — Chart-rendering recovery (when STEP 5 image count is low)
  # 1. In the source HTML's <script>: Chart.defaults.animation = false;
  # 2. Wrap every <canvas> parent: <div class="chart-card avoid-break">
  # 3. Increase --wait to 30000
  # 4. Re-render and re-verify.
  # See <SKILL>/docs/troubleshooting.md "Chart.js render-timing checklist".

STEP 7 — For matplotlib pipelines (PNG → embedded into HTML)
  ls -lh <TMP>/build/*.png   # the intermediate PNGs MUST exist and be > 5 KB each.

CONSTRAINTS:
  - JSON config files: json.dumps(payload, ensure_ascii=False, indent=2). Always.
  - `pdftotext` cannot see images and silently passes a chart-less PDF.
    pdfimages count is the ONLY reliable chart-presence check.
  - Don't 2>/dev/null any of the verification commands.
```

---

## P4 — Multi-jurisdiction research with parallel sub-agents

### Match signatures

- "研究 {TOPIC} 在 {JURISDICTIONS} 的 {regulatory|market|enforcement} 情况"
- "deep research on {topic} across {N} regions, output a synthesised PDF"
- "multi-country survey of {policy area}, parallel workers"

### Canonical query

```
TASK: Produce a synthesised PDF report on {TOPIC} covering jurisdictions
      {JURISDICTIONS[]}, output to {OUTPUT_PDF} within {DEADLINE_MIN} minutes.

STEP 0 — Load progressive case when applicable
  If TOPIC is AI voice cloning / synthetic voice / deepfake audio, or the
  acceptance criteria require laws + regulators + cases + self-regulation +
  source reliability ratings, read:
    <SKILL>/docs/ai-voice-cloning-regulatory-report-case.md
  Reuse its bounded worker prompts, terminology rules, fact-check table,
  and optimized source HTML.

STEP 1 — Plan the fan-out (timeout-with-degrade is mandatory)
  N background research sub-agents (task tool with
  run_in_background: true, one per jurisdiction) + a synthesis step
  after collecting their outputs. CRITICAL rules:
  - Launch every research sub-agent with run_in_background: true.
    Foreground task calls run sequentially and block — they cannot
    honor the deadline rule below.
  - Poll with task_query; collect finished reports with task_output.
    At T+{DEADLINE_MIN}, task_stop the stragglers and proceed.
  - Each sub-agent writes its report to <TMP>/report-<jurisdiction>.md
    and returns only a short summary.
  - The synthesis step explicitly allows partial input: "If at deadline
    T+{DEADLINE_MIN}, fewer than N jurisdictions have delivered, ship a
    partial PDF labelled 'Region X: data not yet available' for the
    missing ones."

STEP 2 — Per-sub-agent prompt SHAPE (specific, not open-ended)
  GOOD:  "Find the 5 enacted statutes most-cited by {jurisdiction}'s
          enforcement agencies on {topic} since 2020. For each: cite,
          1-line summary, primary agency, last enforcement action date."
  BAD:   "Research {jurisdiction}'s regulatory framework for {topic}."
  # Open-ended prompts run for hours and stall the whole batch.

STEP 3 — Synthesis (yourself, after the sub-agents return)
  Cross-reference all received jurisdiction reports. Build a comparison
  table (rows=jurisdictions, cols=key dimensions). Highlight 3 themes
  that appear in ≥3 jurisdictions and 3 unique-to-one-region findings.
  Then render via <SKILL>/scripts/make.sh render with the
  templates/multilang-research-report skeleton, --format A4 --wait 15000.

STEP 4 — Failure handling
  A sub-agent errors or returns garbage → relaunch it ONCE with the same
    bounded prompt.
  Still failing → proceed with the remaining N-1 reports; the partial-ship
    rule from STEP 1 covers the gap.

STEP 5 — Final verify (after synthesis renders)
  pdfinfo {OUTPUT_PDF} | grep Pages       # expected ≥ N+2 (intro + per-region + comparison)
  pdfinfo {OUTPUT_PDF} | grep "Page size" # match A4
  pdfimages -list {OUTPUT_PDF} | tail -n +3 | wc -l

CONSTRAINTS:
  - NEVER launch the fan-out without an explicit timeout-with-degrade rule.
  - Sub-agent prompts MUST be specific. "全面研究" / "全面分析" = guaranteed stall.
  - Don't suppress stderr in any sub-agent prompt — log to <TMP>/<worker>.log.
```

---

## P5 — Translate EML / PDF to {lang} preserving layout

### Match signatures

- "把这份 {INPUT_PATH} (.eml/.pdf) 翻译成 {TARGET_LANG}，保留排版"
- "translate this {Goldman Sachs / formal} report to {lang}, output PDF"
- "翻译保版 / preserve-layout translation"

### Canonical query

```
TASK: Translate {INPUT_PATH} into {TARGET_LANG} while preserving the
      original page geometry, figures, and tables. Output to {OUTPUT_PATH}.

STEP 1 — Source parsing
  Case A — INPUT_PATH ends with .eml:
    # Progressive case for rich research-email HTML with optimized translation prompt:
    #   <SKILL>/docs/email-translation-goldman-two-sessions-case.md
    python3 <<EOF
    import email, re
    msg = email.message_from_file(open("{INPUT_PATH}"))
    # Walk parts: extract text/html, extract attachments, replace cid: refs
    # with data: URIs so the rendered HTML is self-contained.
    EOF

  Case B — INPUT_PATH ends with .pdf:
    # Use pdfplumber for prose pages; vision per-page for chart/table pages
    # (see §P7 if the input is a financial doc).

STEP 2 — Translation (call LLM, never hand-write for long inputs)
  Use the llm-call skill, batched per page or per logical block.
  For rich EML research reports, copy the optimized prompt from the Goldman case;
  it enforces JSON id parity, terminology freeze, numeric preservation, and QA.
  STRICTLY PRESERVE verbatim:
  - Numbers, dates, currency symbols, percentages
  - Proper nouns (people, companies, fund codes, ticker symbols)
  - Already-target-lang words (don't double-translate)
  Only translate prose.

STEP 3 — Use the layout-preserving template
  cp -r <SKILL>/templates/translate-preserve-layout/* <TMP>/
  # The skeleton mirrors the source's page grid; substitute translated
  # blocks into the page-grid slots. Don't author HTML from scratch.
  # For rich EML HTML, prefer mutating the original HTML in place to preserve
  # table grid, hrefs, and img src (see Goldman case).

STEP 4 — Render
  bash <SKILL>/scripts/make.sh render \
    --in <TMP>/translated.html --out {OUTPUT_PATH} \
    --format <match source page size; default A4> --wait 15000

STEP 5 — Verification
  pdfinfo {OUTPUT_PATH} | grep "Page size"
  # Must MATCH the source PDF/EML's page size.
  pdfimages -list {OUTPUT_PATH} | tail -n +3 | wc -l
  # Must equal the source's image count (figures preserved).
  pdftotext -layout {OUTPUT_PATH} - | head -60   # confirm target lang text

STEP 6 — Cross-check verbatim items
  Spot-check 5 numeric values + 3 proper nouns: must appear unchanged
  in the translated PDF.

CONSTRAINTS:
  - Don't hand-translate long financial / legal text — call LLM via llm-call.
  - Use the translate-preserve-layout template; don't re-author the grid.
  - Number / date / proper-noun preservation is non-negotiable.
```

---

## P6 — Targeted extraction from a 100+ page PDF

### Match signatures

- "在这份 {PDF_PATH}（{N}页年报/招股书）里找 {TARGET_QUERY}"
- "extract {metric/section} from this annual report / prospectus / white paper"
- "what does {long PDF} say about {topic}"

### Canonical query

```
TASK: Locate and extract {TARGET_QUERY} from {PDF_PATH}, returning at most
      {MAX_OUTPUT_PAGES or 5} pages of relevant content.

STEP 1 — Probe page count + structure (cheap, mandatory)
  pdfinfo "{PDF_PATH}" | grep -E "Pages|Encrypted"
  # Three thresholds determine path:
  #   ≤20 pages → skip locate, pdfplumber the whole thing.
  #   21-200 pages → locate-first mandatory.
  #   >200 pages → ALWAYS build heading index FIRST (skip blind grep entirely).

STEP 2 — Build heading index (paths in cheapest-first order)

  Path A — pypdf outline (cheapest):
    python3 - <<EOF
    from pypdf import PdfReader
    doc = PdfReader("{PDF_PATH}")
    def walk(items, depth=0):
        for it in items:
            if isinstance(it, list):
                walk(it, depth + 1)
            else:
                p = doc.get_destination_page_number(it) + 1
                print(f"{'  '*depth}{it.title}  -> p{p}")
    walk(doc.outline)
    EOF

  Path B — printed TOC (when outline empty):
    pdftotext -layout -f 1 -l 5 "{PDF_PATH}" - | head -120
    # Note: printed page numbers may have a front-matter offset (cover,
    # copyright, preface = 2-10 unnumbered pages). Add the offset before
    # slicing.

  Path C — full-text grep (last resort, BUDGET = 2 attempts max):
    pdftotext -layout "{PDF_PATH}" - | grep -in "{KEYWORD}"
    # If 2 different keywords don't land on the target, STOP and use Path A/B.

STEP 3 — Once target pages identified
  Determine page nature:
  - Pure prose / simple table → pdfplumber recipe (§3.1 in read-guide)
  - Chart / diagram / financial table → vision PER PAGE (mandatory, see §P7)
    python3 -m scripts.read_pdf_vision --input "{PDF_PATH}" --pages N

STEP 4 — JSON config (if writing intermediate file)
  json.dumps(payload, ensure_ascii=False, indent=2)
  # Mandatory for any file passed to a downstream tool.

STEP 5 — Deliver
  Quote the relevant pages, cite page numbers, and if the user asked for
  a number, also cite the line / row context surrounding it.

CONSTRAINTS:
  - >200 pages + targeted query → BUILD INDEX FIRST. No blind greps.
  - 2 blind grep limit applies regardless of page count.
  - NEVER 2>/dev/null any extraction step. Use <TMP>/grep.log.
```

---

## P7 — Complex financial PDF → structured format

### Match signatures

- "把这份 {PDF_PATH}（240页 financial report / 10-K / 招股书）转成 {Excel/Word/Markdown}"
- "convert balance sheet / income statement / cash-flow from {PDF} to {format}"
- "extract financial tables from {annual report}"

### Canonical query

```
TASK: Convert {STATEMENTS[]} (e.g. balance sheet, income statement,
      cash-flow, debt schedule) from {PDF_PATH} into {OUTPUT_FORMAT},
      output to {OUTPUT_PATH}, preserving every cell.

STEP 1 — Locate financial-table pages (run §P6 first)
  Use §P6's heading-index path to list pages containing each statement.
  Output: PAGES = [p_balance, p_income, p_cashflow, ...].

STEP 2 — Vision per page (MANDATORY — pdfplumber FORBIDDEN here)
  # Reason: complex financial layout uses multi-level headers, merged
  # cells, dotted leader lines, footnoted sub-totals. pdfplumber's
  # extract_text returns scrambled fragments (`9,19109,190` for two
  # adjacent numbers); extract_tables needs a clean grid these layouts
  # never have.

  for p in $PAGES; do
    python3 -m scripts.read_pdf_vision \
      --input "{PDF_PATH}" --pages $p \
      --prompt "For every table on this page output one row per cell:
                header_l1 | header_l2 | row_label | value | footnote_ref.
                Preserve every sub-total and footnote marker. Use - for
                empty cells. Output as TSV." \
      --json 2><TMP>/vision-p$p.log > <TMP>/vision-p$p.json
  done

STEP 3 — Parse vision output
  python3 <<EOF
  import json, pathlib
  rows = []
  for p in PAGES:
      data = json.loads(pathlib.Path(f"<TMP>/vision-p{p}.json").read_text())
      # Vision output is in chunks[0].text; parse the TSV.
      for line in data["chunks"][0]["text"].splitlines():
          parts = line.split("\t")
          if len(parts) == 5:
              rows.append({"page": p, "l1": parts[0], "l2": parts[1],
                           "label": parts[2], "value": parts[3],
                           "footnote": parts[4]})
  EOF

STEP 4 — Write to OUTPUT_FORMAT

  Case A — OUTPUT_FORMAT = xlsx:
    # See [xlsx] §X4. One sheet per statement. Column A = label,
    # data = pure dump (this leg has no derived values; if you compute
    # totals/margins, switch to formula-first per [xlsx] §X5).

  Case B — OUTPUT_FORMAT = docx:
    # Use docx; render each statement as a Word table with
    # multi-level headers preserved.

  Case C — OUTPUT_FORMAT = md:
    # Use Markdown tables; multi-level headers expand to a flat header row.

STEP 5 — Verification
  Spot-check 3 sub-totals across statements: read them off the source PDF
  visually, compare to the converted output. Mismatch → re-run vision
  with a more explicit prompt for that page, never patch by hand.

CONSTRAINTS:
  - pdfplumber.extract_tables on financial layouts is FORBIDDEN even when
    the PDF is text-native. Visual structure complexity > text-native check.
  - Vision MUST be per-page (`--pages N`). A range like `--pages 1-30`
    stitches pages together and mis-attributes values.
  - Don't 2>/dev/null vision calls — the daemon log on stderr is the only
    debugging signal.
```

---

## P8 — AcroForm / PDF form filling

### Match signatures

- "填这份 {FORM_PDF} (visa / tax / contract)，材料是 {MATERIALS[]}"
- "fill out PDF form / AcroForm with the supplied values"
- "把 {employment_letter / itinerary} 里的信息填到 {visa_form}"

### Canonical query

```
TASK: Fill {FORM_PDF} using values extracted from {MATERIALS[]},
      output to {OUTPUT_PDF}. Report missing fields = {MISSING_FIELDS_REPORT}.

STEP 1 — Probe form type
  bash <SKILL>/scripts/make.sh fill probe "{FORM_PDF}"
  # Output: acroform=true → §B path; acroform=false → §C overlay path.

STEP 2 — Inspect fields (§B path only)
  bash <SKILL>/scripts/make.sh fill inspect "{FORM_PDF}" <TMP>/meta.json
  # Each record: {qname, page_no, type, box, on_value/off_value/choice_options}.

  # Progressive case: if FORM_PDF is an Italian / Schengen visa application and
  # MATERIALS include Chinese employment certificate + travel itinerary, read:
  #   <SKILL>/docs/italy-schengen-visa-acroform-case.md
  # It includes extract_pdfs_key_info, uppercase pinyin/date transforms,
  # missing-fields report, and exact verification evidence.

STEP 3 — Extract values from MATERIALS[]
  For each material:
  - Simple PDF (passport scan with text layer) → pdfplumber
  - Complex PDF (employment letter with letterhead, stamps, multi-column)
    → vision per page per §P7
  - DOCX itinerary → docx read
  Build the qname → value mapping.

STEP 4 — Build values.json (NEW array schema)
  python3 <<EOF
  import json, pathlib
  values = [
      {"qname": "person.last_name", "page_no": 1, "set_to": "Park"},
      {"qname": "person.first_name", "page_no": 1, "set_to": "Joon"},
      # Checkbox: use the field's literal on_value, NOT "true"/"false"
      {"qname": "is_adult", "page_no": 1, "set_to": "/On"},
  ]
  pathlib.Path("<TMP>/values.json").write_text(
      json.dumps(values, ensure_ascii=False, indent=2),
      encoding="utf-8",
  )
  EOF

STEP 5 — Apply
  bash <SKILL>/scripts/make.sh fill apply \
    "{FORM_PDF}" <TMP>/values.json "{OUTPUT_PDF}"

  # If you must skip the wrapper (custom validation / batch driver),
  # USE EXACTLY THIS pypdf snippet — see <SKILL>/docs/forms-guide.md §B.4.1:
  python3 <<EOF
  from pypdf import PdfReader, PdfWriter
  src = PdfReader("{FORM_PDF}")
  out = PdfWriter(clone_from=src)             # ← THE constructor
  for page_no, vals in values_by_page.items():
      out.update_page_form_field_values(
          out.pages[page_no - 1], vals,
          auto_regenerate=False,
      )
  out.set_need_appearances_writer(True)        # ← MANDATORY
  with open("{OUTPUT_PDF}", "wb") as fh:
      out.write(fh)
  EOF
  # NEVER use any of these — they "succeed silently" (no error, no values):
  #   - PdfWriter() + clone_reader_document_root(src)
  #   - patching page["/Annots"] /V directly
  #   - PdfWriter() + append_pages_from_reader(src)
  #   - pypdf 1.x camelCase updatePageFormFieldValues (removed)

STEP 6 — Verify
  bash <SKILL>/scripts/make.sh fill rasterize "{OUTPUT_PDF}" <TMP>/verify/
  # Open <TMP>/verify/page_*.png and visually confirm each filled field.

STEP 7 — Missing-fields report (if MISSING_FIELDS_REPORT)
  Print: "Filled X of Y fields. Missing: <qname>, <qname>, …"
  For each missing: state which MATERIALS[] would have provided it.

CONSTRAINTS:
  - The pypdf snippet in STEP 5 is THE only working pattern. Don't try variants.
  - Checkboxes: write the literal on_value (`/On`, `/Yes`, `/Choice2`),
    never `"true"`/`"false"`/`true`/`1`.
  - Don't 2>/dev/null the apply step — silent-failure is the dominant mode.
```

---

## P9 — Tabular data → printable PDF

### Match signatures

- "把这份 {INPUT_XLSX}（{N} 行）导出成 PDF / 打印"
- "export 10k+ rows as PDF, landscape, repeat header"
- "{xlsx} 转 PDF 可打印"

### Canonical query

```
TASK: Convert {INPUT_XLSX} (N rows) to PDF at {OUTPUT_PDF} with
      orientation={ORIENTATION}, repeat_header={REPEAT_HEADER},
      mode={FULL_OR_PREVIEW}.

STEP 0 — Strict wide-table / Superstore route check
  If the request is a multi-format Excel conversion package (CSV + JSON +
  PDF + CSV→Excel reverse validation), and the PDF must be HTML→PDF with
  A4 landscape, repeated headers, all columns visible, no truncation, and
  no CSS counters, load:
    <SKILL_XLSX>/docs/superstore-multiformat-conversion-case.md
  Follow its HTML-source workflow instead of the LibreOffice path below.

STEP 1 — Sanity probe
  python3 -c "import pandas as pd; df = pd.read_excel('{INPUT_XLSX}'); print(len(df))"
  # If row_count > 500 AND user didn't state mode → STOP and ASK:
  #   "This dataset has N rows. Full export will produce a ~XX MB PDF
  #    (estimated YY pages). Do you want full or first-N preview?"

STEP 2 — Configure print settings (openpyxl)
  python3 <<EOF
  from openpyxl import load_workbook
  book = load_workbook("{INPUT_XLSX}")
  ws = book.active
  ws.page_setup.orientation = "{ORIENTATION}"   # 'landscape' or 'portrait'
  ws.page_setup.fitToWidth = 1
  ws.page_setup.fitToHeight = 0
  if {REPEAT_HEADER}:
      ws.print_title_rows = "1:1"               # repeat header on every page
  ws.print_options.gridLines = True
  book.save("<TMP>/printable.xlsx")
  EOF

STEP 3 — Convert via LibreOffice (NOT openpyxl-native; print settings need soffice)
  python3 <SKILL_XLSX>/scripts/office/soffice.py \
    --headless --convert-to pdf --outdir <TMP> <TMP>/printable.xlsx \
    2><TMP>/soffice.log
  mv <TMP>/printable.pdf "{OUTPUT_PDF}"

STEP 4 — VERIFY (mandatory because soffice may ignore print settings)
  pdfinfo "{OUTPUT_PDF}" | grep -E "Pages|Page size"
  ls -lh "{OUTPUT_PDF}"
  # If size > 50 MB and user wanted preview → mode mismatch; rerun.

  # Open page 1 + last page visually:
  PAGES=$(pdfinfo "{OUTPUT_PDF}" | awk '/^Pages/{print $2}')
  pdftoppm -r 100 -png -f 1 -l 1 "{OUTPUT_PDF}" <TMP>/p1
  pdftoppm -r 100 -png -f $PAGES -l $PAGES "{OUTPUT_PDF}" <TMP>/last
  # Check: page 1 has the header; last page rows are not truncated;
  # orientation looks right.

STEP 5 — Recovery: print settings didn't survive soffice
  Fall back to rendering via the pdf HTML pipeline:
  - For Superstore-like wide data, use the ready workflow and editable HTML
    artifact pattern in <SKILL_XLSX>/docs/superstore-multiformat-conversion-case.md.
  - Convert xlsx → dense HTML table with @page A4 landscape and
    thead { display: table-header-group; }.
  - Use bash <SKILL>/scripts/make.sh render with --format A4 --landscape.
  - Verify page size, repeated header, all headers present, and no ellipsis.

CONSTRAINTS:
  - row_count > 500 + no mode → ASK before producing a 50+ MB PDF.
  - Never trust openpyxl's print settings without re-opening the converted
    PDF and visually checking page 1 + last page.
  - Don't 2>/dev/null soffice — its stderr explains why settings failed.
```

---

## P10 — DOCX ↔ PDF / MD / HTML round-trip with fidelity report

> Progressive case: for legal/contract Word templates where the PDF must look professional (formal cover, fill lines, signature/seal tables), read [`docx-contract-roundtrip-professional-case.md`](docx-contract-roundtrip-professional-case.md) before executing the generic P10 steps. Reuse its editable HTML artifact instead of shipping a raw Pandoc/LibreOffice export.

### Match signatures

- "把这份 {INPUT_PATH} (.docx/.pdf/.md) 转成 {TARGET_FORMATS[]}，并评估 fidelity loss"
- "convert {contract / report} to PDF + MD + HTML, tell me what's lost"
- "DOCX 双向转换 / round-trip"

### Canonical query

```
TASK: Convert {INPUT_PATH} into each format in {TARGET_FORMATS[]} and
      produce a fidelity-loss inventory. Output to {OUTPUT_DIR}.

STEP 1 — Normalize input
  Case A — INPUT_PATH ends with .doc (legacy binary):
    python3 <SKILL_XLSX>/scripts/office/soffice.py \
      --headless --convert-to docx --outdir <TMP> "{INPUT_PATH}" \
      2><TMP>/soffice.log
    INPUT_PATH=<TMP>/<basename>.docx

STEP 2 — Detect structural elements that risk fidelity loss
  python3 <<EOF
  from docx import Document
  d = Document("{INPUT_PATH}")
  # Inventory:
  # - Tables with merged cells (rowspan/colspan)
  # - Headers / footers with content
  # - Footnotes / endnotes / comments
  # - Embedded objects (Excel ranges, Visio shapes, OLE)
  # - Tracked changes / revisions
  # - Section breaks with different page sizes
  EOF

STEP 3 — Convert to each TARGET_FORMAT (parallel)
  For PDF: native DOCX→PDF render/export first (docx docx_to_pdf.py or
           LibreOffice/soffice export) → verify. Do NOT route DOCX through
           Markdown/HTML just to make a PDF; that loses Word layout. Use
           HTML→PDF only if the user asks for redesign/recomposition or direct
           render is visibly unacceptable, and state that decision.
  For MD:  pandoc {INPUT_PATH} -o {OUTPUT_DIR}/output.md
  For HTML: pandoc {INPUT_PATH} -o {OUTPUT_DIR}/output.html --self-contained

STEP 4 — Fidelity-loss inventory (mandatory deliverable)
  Produce a table:
  | Element | DOCX | PDF | MD | HTML | Severity |
  |---|---|---|---|---|---|
  | Tables (merged cells) | ✓ | ✓ | LOST → flat | LOST → flat | HIGH |
  | Headers / footers | ✓ | ✓ | LOST | LOST | MED |
  | Footnotes | ✓ | ✓ | LOST | LOST | MED |
  | Comments / tracked changes | ✓ | LOST | LOST | LOST | HIGH for legal |
  | Embedded Excel ranges | ✓ | image | LOST | LOST | HIGH |
  | Section page sizes | ✓ | ✓ | N/A | N/A | LOW |

STEP 5 — Visual verification on PDF outputs (legal/contract docs critical)
  pdftoppm -r 150 -png -f 1 -l 1 {OUTPUT_DIR}/output.pdf <TMP>/p1
  # Open <TMP>/p1-1.png — confirm signature blocks, seals, stamps render.
  # For multi-page legal docs, also rasterize the signature page:
  SIG_PAGE=$(pdftotext -layout {OUTPUT_DIR}/output.pdf - | grep -n "^Signature\|签字\|签章" | head -1 | cut -d: -f1)
  # …then rasterize that page too.

STEP 6 — Round-trip verification (if user wants reverse confirmation)
  pandoc {OUTPUT_DIR}/output.md -o <TMP>/roundtrip.docx
  python3 -c "from docx import Document; …"   # diff structures
  # Report the delta back to user.

CONSTRAINTS:
  - Fidelity-loss inventory is a MANDATORY deliverable, not optional.
  - For PDF outputs of legal / contract docs, NEVER trust strings/grep
    alone — visual verification on signature pages is required.
  - .doc → .docx must go through soffice first; pandoc on .doc is unreliable.
  - DOCX→PDF native render/export is the default for preservation; HTML→PDF is a redesign/recomposition route, not the default conversion route.
  - Don't 2>/dev/null pandoc / soffice — their stderr lists every dropped element.
```

---

## How to use this index

1. **Read the user's incoming query.** Match it against each `Match signatures` block.
2. **One match → copy the full Canonical query.** Substitute Slots verbatim
   from the user's actual values. Execute step-by-step. Do not skip
   verification steps.
3. **Multiple partial matches → fuse.** Take the strictest verification
   from each matched canonical query; never relax a constraint.
4. **No match → fall back** to [`../SKILL.md`](../SKILL.md) Operational rules and
   Routes. Don't force-fit a wrong canonical query — it will encode the
   wrong constraints.

## Universal constraints (apply to every canonical query above)

- **Don't `2>/dev/null`.** Redirect to `<TMP>/<step>.log`, grep on demand.
- **JSON files via `json.dumps(payload, ensure_ascii=False, indent=2)`.**
- **Always pass `--format` explicitly** to `make.sh render`.
- **Always verify with `pdfinfo "Page size"` + `pdfimages -list | wc -l`.**
- **Vision per page** for charts and complex financial tables (`--pages N`).
- **Locate-first** for >20 page PDFs with targeted queries; index-first
  for >200 pages; budget = 2 blind greps max.
