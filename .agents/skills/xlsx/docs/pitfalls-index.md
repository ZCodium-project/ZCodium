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
> - `<SKILL>` → `{{DATA_DIR}}/.builtin-skills/xlsx`
> - `<SKILL_PDF>` → `{{DATA_DIR}}/.builtin-skills/pdf`
> - `<TMP>` → a writable scratch dir (e.g. `/tmp/xlsx-task-<ts>`)

---

## Quick lookup — match user query to a case

| # | Match keywords | Slots | Canonical §|
|---|---|---|---|
| **X1** | financial PDF → Excel analysis / 财报分析 / 10-K → xlsx with formulas + charts | `PDF_PATHS[]`, `COMPANY`, `METRICS[]`, `OUTPUT_XLSX` | §X1 |
| **X2** | Excel + PDF + Word multi-format deliverable / 多格式产出 / dashboard + report + memo | `INPUT_DATA`, `ANALYSIS_DIMS[]`, `OUTPUT_DIR`, `DOTNET_BUDGET_MIN(default 5)` | §X2 |
| **X3** | 500k+ row dataset → pivot tables + dashboard + slicers / 大数据透视 / RFM | `INPUT`, `KEY_COLS[]`, `METRICS[]`, `PIVOT_AXES[]`, `SLICERS[]`, `OUTPUT_XLSX` | §X3 |
| **X4** | 240-page financial report → Excel preserving every table / 复杂金融 PDF→Excel | `PDF_PATH`, `STATEMENTS[]`, `OUTPUT_XLSX` | §X4 |
| **X5** | multi-year financial analysis / 财务分析 / revenue/margin/growth/segment trends | `COMPANY`, `YEAR_RANGE`, `PDF_PATHS[]`, `METRICS[]`, `OUTPUT_XLSX` | §X5 |
| **X6** | composite score / index / ranking with stated range / 综合评分 0-100 | `INPUT_XLSX`, `SCORE_COLS[]`, `WEIGHTS[]`, `TARGET_RANGE`, `OUTPUT_XLSX` | §X6 |
| **X7** | cross-sheet dynamic formulas / Inputs → Summary auto-update / 跨 sheet 引用 | `INPUT_LAYOUT`, `SUMMARY_LAYOUT`, `OUTPUT_XLSX` | §X7 |
| **X8** | xlsx ↔ csv ↔ json ↔ pdf with print settings / 表格格式转换 / 打印设置 / Superstore | `INPUT_XLSX`, `OUTPUT_FORMATS[]`, `PRINT_SETTINGS`, `OUTPUT_DIR` | §X8 + [Superstore case](superstore-multiformat-conversion-case.md) |

---

## X1 — Financial PDF → Excel analysis with formulas + charts

### Match signatures

- "读 {COMPANY} 的 {YEAR_RANGE} 年报 PDF，提取 {METRICS}，输出 Excel 含公式和图表"
- "build an Excel analysis of {COMPANY}'s {years} from these annual reports"
- "extract revenue / EPS / store count / segment data from {PDF}, build xlsx"

### Canonical query

```
TASK: From {PDF_PATHS[]} (annual reports of {COMPANY}), extract
      {METRICS[]} and build a formula-first Excel analysis at {OUTPUT_XLSX}
      with cross-year derived metrics + charts.

STEP 1 — PDF read: ALWAYS go through [pdf] §P6 + §P7
  # §P6 = locate-first (build heading index before any extraction).
  # §P7 = vision per page for any financial-table page (balance sheet,
  #       income statement, cash flow, debt schedule).
  # Do NOT pdfplumber over financial tables — see [pdf] P7 for why.
  # Output: a flat list of {year, metric, value, source_page} tuples.

STEP 2 — Build the workbook structure
  Sheets:
  - Inputs / Raw          (blue text #0000FF, primary values from PDF)
  - Calculations          (black text #000000, all = formulas)
  - Summary               (green text #008000 for cross-sheet refs)
  - Charts                (visual, data sources point at formula cells)

  python3 <<EOF
  from openpyxl import Workbook
  from openpyxl.styles import Font, PatternFill
  book = Workbook()
  inputs = book.active; inputs.title = "Inputs"
  blue = Font(color="0000FF")
  black = Font(color="000000")
  # Header
  inputs.append(["Year"] + ["{COMPANY} {m}" for m in METRICS])
  for y in years:
      row = [y] + [extracted[(y, m)] for m in METRICS]
      inputs.append(row)
      for cell in inputs[inputs.max_row]:
          cell.font = blue
  EOF

STEP 3 — Derived metrics (every cell MUST be a = formula, not a literal)
  python3 <<EOF
  calc = book.create_sheet("Calculations")
  calc.append(["Year", "Revenue Growth", "Operating Margin", "EPS Growth"])
  for r_idx in range(2, len(years) + 2):
      calc.append([
          f"=Inputs!A{r_idx}",
          f"=(Inputs!B{r_idx} - Inputs!B{r_idx-1}) / Inputs!B{r_idx-1}",
          f"=Inputs!C{r_idx} / Inputs!B{r_idx}",
          f"=(Inputs!D{r_idx} - Inputs!D{r_idx-1}) / Inputs!D{r_idx-1}",
      ])
  EOF
  # NEVER pre-compute these in Python and write_number them. The user
  # must be able to flip an Inputs cell, recalc, and see Calculations move.

STEP 4 — Charts (data sources point at FORMULA cells, not literals)
  python3 <<EOF
  from openpyxl.chart import LineChart, BarChart, Reference
  ch = LineChart()
  ch.title = "{COMPANY} Revenue Trend"
  data = Reference(inputs, min_col=2, min_row=1, max_col=2, max_row=len(years)+1)
  cats = Reference(inputs, min_col=1, min_row=2, max_row=len(years)+1)
  ch.add_data(data, titles_from_data=True)
  ch.set_categories(cats)
  book["Calculations"].add_chart(ch, "F2")
  EOF

STEP 5 — Save + recalc
  book.save("{OUTPUT_XLSX}")
  python <SKILL>/scripts/recalc.py "{OUTPUT_XLSX}" 60 2><TMP>/recalc.log

STEP 6 — VERIFY (mandatory two-gate)
  # Gate 1: total_errors == 0
  # Gate 2: total_formulas > 0 AND > expected_min (e.g. years × metrics × 2)
  jq '.status, .total_errors, .total_formulas' <recalc-stdout>
  # status != "success" → fix per recalc-guide.md §3 error table.
  # total_formulas == 0 → DELIVERY FAILED, rewrite STEP 3 with = formulas.

STEP 7 — Spot-check formula correctness (not just count)
  python3 <<EOF
  from openpyxl import load_workbook
  book = load_workbook("{OUTPUT_XLSX}", data_only=True)
  # Pick 1-2 derived cells and compare to a Python re-computation
  # from the Inputs sheet. Mismatch → wrong formula references.
  EOF

CONSTRAINTS:
  - PDF reading: §P6 + §P7, never pdfplumber on financial tables.
  - Every derived value: = formula, not literal. No exceptions.
  - recalc → total_formulas == 0 is FAILURE, not success.
  - Don't 2>/dev/null vision calls or recalc — log to <TMP>/.
```

---

## X2 — Multi-format deliverable (Excel + PDF + Word) via parallel sub-agents

### Match signatures

- "分析 {DATA}，产出 Excel dashboard + PDF report + Word memo"
- "build me a triple deliverable: spreadsheet + presentation PDF + Word"
- "用户退款 / 业务三件套 / 完整分析包"

### Canonical query

```
TASK: Produce three coordinated deliverables for {ANALYSIS_TOPIC} in
      {OUTPUT_DIR}: dashboard.xlsx + report.pdf + memo.docx.

STEP 1 — Pre-flight: confirm dotnet for docx
  which dotnet 2><TMP>/which.log
  # If missing: install IS POSSIBLE but takes ~5 minutes (200 MB download).
  # Either pre-install before launching sub-agents, OR the docx sub-agent
  # prompt must explicitly budget setup time per STEP 2.

STEP 2 — Launch 3 background sub-agents (task tool, run_in_background: true)
  # Foreground task calls run sequentially — background mode is what
  # makes the three deliverables build in parallel. Track with
  # task_query / task_output.
  # CRITICAL: the Word sub-agent prompt must include:
  #   "Setup may take up to {DOTNET_BUDGET_MIN} minutes for dotnet install
  #    if not already present. Do NOT abort during steady network activity.
  #    Only consider yourself stalled if no progress for >10 minutes."

  Sub-agent prompts:
  - dashboard:  <follow X1 / X3 / X5 canonical query for the data shape>
                → write {OUTPUT_DIR}/dashboard.xlsx
  - report-pdf: <follow [pdf] §P3 canonical for chart-rich PDF>
                → write {OUTPUT_DIR}/report.pdf
  - memo-docx:  <docx canonical>
                "Setup may take {DOTNET_BUDGET_MIN}min for dotnet — wait it
                 out. If install genuinely fails, fall back to python-docx
                 and EXPLICITLY note 'docx unavailable, python-docx used,
                 formatting fidelity reduced' in the deliverable."

STEP 3 — Cross-check (yourself, after all three return)
  Spot-check 3 numbers that appear in all three deliverables. They MUST
  be identical. If any differ, identify the divergent figure and relaunch
  the sub-agent whose input data feed was wrong.

STEP 4 — Final deliverables verification
  ls -lh {OUTPUT_DIR}/dashboard.xlsx {OUTPUT_DIR}/report.pdf {OUTPUT_DIR}/memo.docx
  # xlsx: total_formulas > 0 (per X1 STEP 6)
  # pdf:  pdfimages count > 0 (per [pdf] P3 STEP 5)
  # docx: spot-check via word/document.xml unzip → confirm formatting present

STEP 5 — Cross-deliverable consistency report
  Pick 3 KPIs (e.g. total revenue, top segment, growth rate). They must
  appear identically in xlsx Summary, pdf KPI grid, and docx executive
  summary. Mismatch → which one is wrong? Fix that sub-agent's input data
  feed, never patch the deliverable manually.

CONSTRAINTS:
  - dotnet install ≠ stall. Budget {DOTNET_BUDGET_MIN}min + 10min slack.
  - python-docx fallback IS allowed but MUST be flagged in the deliverable.
  - Cross-deliverable numbers MUST match — that's the whole point of one batch.
  - Sub-agent prompts: never `2>/dev/null` any setup or build step.
```

---

## X3 — 500k+ row dataset → pivot / dashboard / slicers

### Match signatures

- "处理 {INPUT}（54万行 / 500k+ rows）做透视 / dashboard / RFM"
- "clean + pivot + slicer dashboard from {large_dataset}"
- "Online Retail / 电商交易明细 → 完整分析"

### Canonical query

```
TASK: From {INPUT} (~{ROW_COUNT} rows), build a formula-first dashboard
      at {OUTPUT_XLSX} with pivots over {PIVOT_AXES[]} and slicers on
      {SLICERS[]}.

STEP 1 — Read with pandas by default (polars if pandas is memory-bound)
  # For 500k+ rows, do NOT inspect/transform source data with openpyxl row loops.
  # Use pandas for ordinary large tabular work; switch to polars for memory/latency pressure.
  python3 <<EOF
  import pandas as pd
  frame = pd.read_excel("{INPUT}", engine="openpyxl")
  print("Loaded rows:", len(frame))
  # If this is too slow or memory-bound, rerun with:
  #   import polars as pl
  #   frame = pl.read_excel("{INPUT}")
  EOF

STEP 2 — Clean (RECORD what you removed; report counts)
  python3 <<EOF
  # Cleaning rules — report row counts at each step:
  before = len(frame)
  frame = frame.filter(~pl.col("InvoiceNo").str.starts_with("C"))   # cancellations
  print("After dropping cancellations:", len(frame), "removed:", before - len(frame))
  before = len(frame)
  frame = frame.filter(pl.col("Quantity") > 0)
  frame = frame.filter(pl.col("UnitPrice") > 0)
  print("After dropping non-positive:", len(frame), "removed:", before - len(frame))
  before = len(frame)
  frame = frame.filter(pl.col("CustomerID").is_not_null())
  print("After dropping null CustomerID:", len(frame), "removed:", before - len(frame))
  EOF

STEP 3 — WRITE FULL CLEANED ROWS (NEVER df.sample / df.head!)
  # The most critical step. df.sample(100k) on a 397k-row frame breaks
  # every downstream pivot and SUMIF without raising any error.
  # If openpyxl's default writer is too slow, use write_only mode below.

  python3 <<EOF
  from openpyxl import Workbook
  from openpyxl.cell import WriteOnlyCell
  book = Workbook(write_only=True)         # streaming writer; ~4× faster
  raw = book.create_sheet("Raw")
  raw.append(list(frame.columns))
  for row in frame.iter_rows():            # ALL rows — no slicing
      raw.append([WriteOnlyCell(raw, value=v) for v in row])
  book.save("<TMP>/raw.xlsx")
  EOF
  # Confirm row count matches:
  python3 -c "from openpyxl import load_workbook; wb=load_workbook('<TMP>/raw.xlsx', read_only=True); print(wb['Raw'].max_row)"

STEP 4 — Derived columns as = formulas
  # Reopen with default reader to add formulas + pivot/slicer scaffolding.
  python3 <<EOF
  from openpyxl import load_workbook
  book = load_workbook("<TMP>/raw.xlsx")
  raw = book["Raw"]
  # Add Revenue = Quantity * UnitPrice as a formula column
  last = raw.max_row
  raw.cell(row=1, column=raw.max_column + 1, value="Revenue")
  for r in range(2, last + 1):
      raw.cell(row=r, column=raw.max_column,
               value=f"=B{r}*C{r}")          # adjust col letters to schema
  EOF

STEP 5 — Summary sheet: Excel-NATIVE aggregation only
  # Choose by structure complexity (see <SKILL>/docs/advanced-reference.md §6.2):
  #   - Single-axis aggregation       → =SUMIFS / =COUNTIFS / =AVERAGEIFS
  #   - Multi-axis cross-tab + drilldown → pivot table

  Single-axis example:
    summary.cell(row=r, column=2,
                 value=f"=SUMIFS(Raw!{rev_col}:{rev_col}, Raw!{cat_col}:{cat_col}, A{r})")

  # NEVER do: frame.group_by("category").sum() → write_number(...).
  # That ships a static snapshot and the recalc gate will not catch it.

STEP 6 — Slicers (openpyxl CANNOT create from scratch)
  # Two production paths — pick one:

  Path A (RECOMMENDED) — template inheritance:
    # Pre-author template.xlsx ONCE in Excel/LibreOffice with the pivot
    # and slicer wired to a named range "DataRange". Per run:
    book = load_workbook("<SKILL>/templates/with-slicer.xlsx")
    # Write Raw rows into the named range; pivot + slicer auto-refresh on recalc.

  Path B — surgical XML transplant from a known-good template:
    # See <SKILL>/docs/raw-xml-escape-hatch.md §1 + §3.
    # Copy xl/pivotTables/*.xml + xl/pivotCaches/*.xml + xl/slicers/*.xml
    # via scripts/office/{unpack,pack}.py.

  IF NEITHER PATH IS AVAILABLE:
    # Tell the user explicitly: "No slicer template available; falling back
    # to a static dropdown filter on the Summary sheet. Slicer cannot be
    # authored from scratch by openpyxl."
    # Do NOT silently downgrade.

STEP 7 — Save + recalc
  book.save("{OUTPUT_XLSX}")
  python <SKILL>/scripts/recalc.py "{OUTPUT_XLSX}" 120 2><TMP>/recalc.log

STEP 8 — VERIFY (4 mandatory checks)
  # 1. row count: Raw sheet matches the cleaned frame
  # 2. total_errors == 0
  # 3. total_formulas substantial (e.g. > #pivot_cells + #derived_cols)
  # 4. summary correctness: spot-check 1-2 cells against polars on FULL frame
  python3 <<EOF
  from openpyxl import load_workbook
  book = load_workbook("{OUTPUT_XLSX}", data_only=True)
  print("Raw rows:", book["Raw"].max_row - 1)
  # Compare a SUMIF result to the same aggregation on the FULL pandas/polars frame
  EOF

CONSTRAINTS:
  - 500k+ row source inspection/cleaning: pandas/polars default; openpyxl row-by-row source traversal is forbidden unless preserving workbook objects is the explicit goal.
  - df.sample / df.head / per-category truncation on the raw sheet = forbidden.
  - Summaries: pivot table or =SUMIFS only. Python groupby write-back = forbidden.
  - Slicers: template-inherit OR XML-transplant OR explicit user notification.
    NEVER silently downgrade.
  - 4-check verification is mandatory; row count is the canary.
```

---

## X4 — Complex financial PDF → Excel preserving every table

### Match signatures

- "把这份 {PDF_PATH}（240页 financial report / HKEx 2024）转成 Excel"
- "convert balance sheet / income statement / cash flow PDF to xlsx"
- "金融年报 → Excel，要保留所有 table 结构"

### Canonical query

```
TASK: Convert {STATEMENTS[]} from {PDF_PATH} into {OUTPUT_XLSX}, one
      sheet per statement, preserving multi-level headers and footnotes.

STEP 1 — Locate financial-table pages
  Run [pdf] §P6 first → list of pages per statement.

STEP 2 — Vision per page (per [pdf] §P7)
  # pdfplumber FORBIDDEN on financial tables even when text-native.
  # Output: per-page TSV with header_l1 | header_l2 | label | value | footnote_ref

STEP 3 — Parse vision output to a normalised frame
  python3 <<EOF
  rows = []
  for p in pages:
      data = json.loads(open(f"<TMP>/vision-p{p}.json").read())
      for line in data["chunks"][0]["text"].splitlines():
          parts = line.split("\t")
          if len(parts) == 5:
              rows.append({"page": p, "l1": parts[0], "l2": parts[1],
                           "label": parts[2], "value": parts[3],
                           "footnote_ref": parts[4]})
  EOF

STEP 4 — Write to xlsx (one sheet per statement)
  python3 <<EOF
  from openpyxl import Workbook
  from openpyxl.styles import Font
  book = Workbook()
  book.remove(book.active)
  bold = Font(bold=True)
  for stmt in STATEMENTS:
      ws = book.create_sheet(stmt[:31])
      stmt_rows = [r for r in rows if r["statement"] == stmt]
      # Multi-level header
      ws.append(["", *[r["l1"] for r in unique_columns]])
      ws.append(["Label", *[r["l2"] for r in unique_columns]])
      for header_cell in ws[1] + ws[2]:
          header_cell.font = bold
      # Data
      for row in stmt_rows:
          ws.append([row["label"], row["value"], row["footnote_ref"]])
  # Footnotes sheet (separate, keyed by ref number)
  fn = book.create_sheet("Footnotes")
  fn.append(["Ref", "Text"])
  # ... populate from vision-extracted footnote glossary ...
  book.save("{OUTPUT_XLSX}")
  EOF

STEP 5 — VERIFY (cross-check 3 sub-totals against source)
  # Pick a known sub-total line per statement (e.g. "Total assets",
  # "Net income", "Net cash from operations"). Compare the value in
  # {OUTPUT_XLSX} to the value visible in the source PDF on the
  # corresponding page. Mismatch → re-run vision on that page with a
  # more explicit prompt. NEVER patch the xlsx by hand.

CONSTRAINTS:
  - Pure data dump — no derived values to compute on this leg.
    If the user wants margins / ratios on top, switch to X5.
  - Don't hand-fix vision misreads in xlsx; re-prompt vision instead.
  - Don't 2>/dev/null vision calls.
```

---

## X5 — Multi-year financial analysis (Formula-first hot spot)

### Match signatures

- "{COMPANY} {YEAR_RANGE} 财务分析 Excel，含 revenue / margin / growth / segment 趋势"
- "build a financial-analysis xlsx for {COMPANY} covering {years}"
- "腾讯 / Alibaba / Apple 多年财报对比 + 派生指标"

### Canonical query

```
TASK: Build a formula-first multi-year financial analysis for {COMPANY}
      covering {YEAR_RANGE}, output to {OUTPUT_XLSX}, including:
      revenue, gross margin, operating margin, net margin, EPS, EPS growth,
      revenue growth, CAGR, segment breakdown.

STEP 1 — PDF read: §P6 + §P7 per [pdf]
  Output: tuples of (year, segment, metric, value, source_page).

STEP 2 — Inputs sheet (raw values, blue text)
  See X1 STEP 2.

STEP 3 — Derived sheets (every cell = formula, no exceptions)
  python3 <<EOF
  calc = book.create_sheet("Derived")
  calc.append(["Year", "Revenue Growth", "Gross Margin", "Op Margin",
               "Net Margin", "EPS Growth", "Revenue CAGR (5y)"])
  n = len(years)
  for i, y in enumerate(years, start=2):
      calc.append([
          f"=Inputs!A{i}",
          f"=IFERROR((Inputs!B{i}-Inputs!B{i-1})/Inputs!B{i-1}, \"\")"        if i > 2 else "",
          f"=Inputs!C{i}/Inputs!B{i}",                                          # gross / revenue
          f"=Inputs!D{i}/Inputs!B{i}",
          f"=Inputs!E{i}/Inputs!B{i}",
          f"=IFERROR((Inputs!F{i}-Inputs!F{i-1})/Inputs!F{i-1}, \"\")"        if i > 2 else "",
          f"=IFERROR((Inputs!B{1+n}/Inputs!B{2})^(1/{n-1})-1, \"\")"          if i == 2 else "",
      ])
  EOF
  # Wrap divisions with IFERROR to prevent #DIV/0! poisoning the recalc gate.

STEP 4 — Charts (data sources reference Derived sheet formula cells)
  See X1 STEP 4.

STEP 5 — Save + recalc
  book.save("{OUTPUT_XLSX}")
  python <SKILL>/scripts/recalc.py "{OUTPUT_XLSX}" 60 2><TMP>/recalc.log

STEP 6 — VERIFY (mandatory two-gate + formula-count check)
  # Gate 1: total_errors == 0
  # Gate 2: total_formulas > 0  ← THE CRITICAL CHECK
  jq -r '.status, .total_errors, .total_formulas' <recalc-stdout>

  # If total_formulas is 0 OR less than #years × #metrics × 2:
  #   → DELIVERY FAILED. The workbook is a static snapshot, not a model.
  #   → Re-do STEP 3 with = formulas. Don't ship anyway.

  # Per-sheet formula count (catches "0 formulas in Derived"):
  python3 <<EOF
  from openpyxl import load_workbook
  book = load_workbook("{OUTPUT_XLSX}")
  for ws in book.worksheets:
      n = sum(1 for row in ws.iter_rows() for c in row
              if isinstance(c.value, str) and c.value.startswith("="))
      print(ws.title, "=", n, "formulas")
  EOF

STEP 7 — Spot-check a derived value against an external recompute
  # Pick one growth rate. Compute it manually from the source PDF values.
  # Compare to the Derived sheet output. Mismatch → wrong column reference.

CONSTRAINTS:
  - total_formulas == 0 OR << expected = DELIVERY FAILURE. Rewrite.
  - Don't 2>/dev/null any vision call or recalc — log and grep on demand.
  - All divisions wrapped with IFERROR.
  - Color: blue for Inputs, black for Derived, green for Summary cross-refs.
```

---

## X6 — Composite score / index with stated range

### Match signatures

- "做一个 composite score / 综合评分 from {COLS}, normalised {0-100 / 1-10}"
- "build a risk index / ranking, normalised to {RANGE}"
- "{Financial_Sample_with_PI} 综合评分要 0-100"

### Canonical query

```
TASK: Build a composite score on {INPUT_XLSX} using {SCORE_COLS[]} with
      weights {WEIGHTS[]}, normalised to {TARGET_RANGE} (e.g. 0-100),
      output to {OUTPUT_XLSX}.

STEP 1 — Open + add Score column
  python3 <<EOF
  from openpyxl import load_workbook
  book = load_workbook("{INPUT_XLSX}")
  ws = book.active
  last_col = ws.max_column
  score_col = last_col + 1
  ws.cell(row=1, column=score_col, value="Composite Score")
  EOF

STEP 2 — Choose normalization formula (CLAMP to TARGET_RANGE in formula)

  # Two patterns — pick one based on score nature:

  # Pattern A — weighted sum then CLAMP (when raw is unbounded):
  for r in range(2, ws.max_row + 1):
      raw_expr = " + ".join(f"{w}*{col_letter}{r}" for w, col_letter in zip(WEIGHTS, SCORE_COLS))
      formula = f"=ROUND(MIN(MAX(({raw_expr}), {LO}), {HI}), 1)"
      ws.cell(row=r, column=score_col, value=formula)

  # Pattern B — min-max normalization to TARGET_RANGE:
  raw_col = chr(ord('A') + last_col)   # the unnormalized raw composite
  formula = (f"=ROUND(({raw_col}{r} - MIN(${raw_col}$2:${raw_col}${ws.max_row}))"
             f" / (MAX(${raw_col}$2:${raw_col}${ws.max_row})"
             f" - MIN(${raw_col}$2:${raw_col}${ws.max_row}))"
             f" * {HI - LO} + {LO}, 1)")

STEP 3 — Save + recalc
  book.save("{OUTPUT_XLSX}")
  python <SKILL>/scripts/recalc.py "{OUTPUT_XLSX}" 60 2><TMP>/recalc.log

STEP 4 — IMMEDIATE range verification (the critical step)
  python3 <<EOF
  from openpyxl import load_workbook
  book = load_workbook("{OUTPUT_XLSX}", data_only=True)
  ws = book.active
  scores = [ws.cell(row=r, column=score_col).value
            for r in range(2, ws.max_row + 1)
            if isinstance(ws.cell(row=r, column=score_col).value, (int, float))]
  print("MIN:", min(scores), "MAX:", max(scores))
  # MIN must be >= LO; MAX must be <= HI.
  # If MAX = 1804 when user asked for 0-100 → STEP 2 formula missing CLAMP.
  # FIX THE FORMULA, do NOT blame "data anomaly". Re-recalc.
  EOF

STEP 5 — Methodology sheet (audit trail)
  meth = book.create_sheet("Methodology")
  meth.append(["Score Formula", "Weights", "Source Columns", "Range"])
  meth.append([formula_template, str(WEIGHTS), str(SCORE_COLS), f"{LO}-{HI}"])
  book.save("{OUTPUT_XLSX}")

CONSTRAINTS:
  - When user states a target range, ENFORCE it in the formula.
    Don't ship a wider range and blame "data anomaly".
  - The verification in STEP 4 is mandatory; without it the formula bug
    won't be caught until the user reports it.
  - Document the formula in a Methodology sheet so the user can audit.
```

---

## X7 — Cross-sheet dynamic formulas (modelling)

### Match signatures

- "wire up Inputs tab so Summary cells auto-update when Inputs change"
- "build a model where Summary references Inputs via formulas"
- "跨 sheet 动态引用 / dynamic linkage"

### Canonical query

```
TASK: Build {OUTPUT_XLSX} where every Summary cell references the Inputs
      sheet via formulas, with full color-code conventions.

STEP 1 — Sheet structure
  python3 <<EOF
  from openpyxl import Workbook
  from openpyxl.styles import Font
  book = Workbook()
  inputs = book.active; inputs.title = "Inputs"
  summary = book.create_sheet("Summary")
  blue  = Font(color="0000FF")     # primary inputs
  black = Font(color="000000")     # in-sheet formulas
  green = Font(color="008000")     # cross-sheet references
  EOF

STEP 2 — Inputs sheet
  # Column A: label, Column B: value (blue), Column C: source/note
  for label, value, src in INPUT_ROWS:
      inputs.append([label, value, src])
      inputs.cell(row=inputs.max_row, column=2).font = blue

STEP 3 — Summary sheet (every cell = =Inputs!ref or = derivation)
  python3 <<EOF
  summary.append(["Metric", "Value"])
  for s in SUMMARY_ROWS:
      # s = (label, formula) where formula references Inputs
      r = summary.max_row + 1
      summary.cell(row=r, column=1, value=s["label"])
      cell = summary.cell(row=r, column=2, value=s["formula"])
      # Color: green if cross-sheet ref, black if same-sheet derivation
      cell.font = green if "Inputs!" in s["formula"] else black
  EOF

STEP 4 — Save + recalc
  book.save("{OUTPUT_XLSX}")
  python <SKILL>/scripts/recalc.py "{OUTPUT_XLSX}" 30 2><TMP>/recalc.log

STEP 5 — VERIFY linkage (the live-model test)
  python3 <<EOF
  from openpyxl import load_workbook
  # 1. Open data-only, capture a Summary value
  book = load_workbook("{OUTPUT_XLSX}", data_only=True)
  v_before = book["Summary"]["B2"].value
  # 2. Open in formula mode, flip an Inputs value
  book2 = load_workbook("{OUTPUT_XLSX}")
  book2["Inputs"]["B2"] = book2["Inputs"]["B2"].value * 1.10
  book2.save("<TMP>/test.xlsx")
  # 3. Recalc, reopen data-only, confirm Summary moved
  EOF
  python <SKILL>/scripts/recalc.py "<TMP>/test.xlsx" 30 2><TMP>/recalc2.log
  python3 -c "from openpyxl import load_workbook; print(load_workbook('<TMP>/test.xlsx', data_only=True)['Summary']['B2'].value)"
  # Should differ from v_before. If not → Summary cell was a literal,
  # not a formula. Go back to STEP 3.

CONSTRAINTS:
  - All Summary cells: formula referencing Inputs, never literal.
  - Color code is part of the deliverable — review at-a-glance audits this.
  - The "flip an input, see Summary move" verification is mandatory.
```

---

## X8 — xlsx ↔ csv ↔ json ↔ pdf with print settings

### Match signatures

- "把 {INPUT_XLSX} 转成 csv + json + pdf，PDF 要横向 + 重复表头"
- "export to multiple formats with landscape, repeat header"
- "Superstore / 多格式数据转换"

### Canonical query

```
TASK: Convert {INPUT_XLSX} into each format in {OUTPUT_FORMATS[]} with
      print settings {PRINT_SETTINGS}, output to {OUTPUT_DIR}.

STEP 0 — Strict Superstore / XML-template / HTML→PDF route check
  If the user requires all of these at once:
    - Excel → CSV + JSON + PDF;
    - CSV → Excel reverse validation;
    - PDF: A4 landscape + repeated headers + all columns visible;
    - CSV→Excel via XML template / direct OOXML, not openpyxl full read-write;
    - PDF via HTML→PDF, not screenshot or LibreOffice conversion;
  then load and follow docs/superstore-multiformat-conversion-case.md.
  That case replaces the simpler pandas/soffice path below.

STEP 1 — Sanity probe
  python3 -c "import pandas as pd; df=pd.read_excel('{INPUT_XLSX}'); print('Rows:', len(df)); print('Cols:', list(df.columns)); print('Dtypes:', df.dtypes.to_dict())"

STEP 2 — Per-format conversion (parallel where independent)

  CSV:
    python3 -c "import pandas as pd; pd.read_excel('{INPUT_XLSX}').to_csv('{OUTPUT_DIR}/data.csv', index=False, encoding='utf-8', date_format='%Y-%m-%d')"

  JSON:
    python3 <<EOF
    import pandas as pd, json, pathlib
    df = pd.read_excel("{INPUT_XLSX}")
    payload = df.to_dict(orient="records")
    pathlib.Path("{OUTPUT_DIR}/data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    EOF
    # For strict "data types correct" requirements, prefer the explicit
    # typed-record pattern in docs/superstore-multiformat-conversion-case.md
    # instead of relying on default=str for timestamps.

  PDF (with print settings → see [pdf] §P9 canonical):
    # Configure print settings via openpyxl, then convert via soffice.
    # If acceptance requires HTML→PDF or all columns visible in a 10k-row
    # landscape table, use docs/superstore-multiformat-conversion-case.md.
    # Verification on PDF is MANDATORY — soffice may ignore some settings.

STEP 3 — Reverse-validation (round-trip integrity)
  python3 <<EOF
  import pandas as pd
  orig = pd.read_excel("{INPUT_XLSX}")
  back = pd.read_csv("{OUTPUT_DIR}/data.csv")
  print("Row count match:", len(orig) == len(back))
  print("Col count match:", len(orig.columns) == len(back.columns))
  # Date columns become strings in CSV — that's expected.
  EOF

STEP 4 — PDF visual verification (PRINT-SETTINGS GATE)
  # Per [pdf] §P9 STEP 4. NEVER trust openpyxl print settings without
  # opening the converted PDF and visually checking page 1 + last page:
  pdfinfo {OUTPUT_DIR}/data.pdf | grep -E "Pages|Page size"
  ls -lh {OUTPUT_DIR}/data.pdf
  # If size > 50 MB and user wanted preview → mode mismatch.
  pdftoppm -r 100 -png -f 1 -l 1 {OUTPUT_DIR}/data.pdf <TMP>/p1
  pdftoppm -r 100 -png -f LAST -l LAST {OUTPUT_DIR}/data.pdf <TMP>/last
  # Confirm: page 1 has the header; last page rows not truncated;
  # orientation matches request.

STEP 5 — Deliverable summary
  Print:
  - Conversion success / failure per format
  - File sizes
  - PDF page count + page size
  - Any data type changes flagged (date → string in CSV is expected;
    flag anything unexpected)

CONSTRAINTS:
  - Row count > 500 + no mode → ASK before producing a 50+ MB PDF.
  - JSON: ensure_ascii=False; for strict type requirements, convert dates
    explicitly and verify numeric fields remain JSON numbers.
  - CSV→Excel reverse validation with XML-template requirement means direct
    OOXML package generation; do not use openpyxl full read-write.
  - PDF print settings: NEVER ship without visual page-1 + last-page check.
  - Don't 2>/dev/null soffice/render commands — stderr explains failures.
```

---

## How to use this index

1. **Read the user's incoming query.** Match it against each `Match signatures` block.
2. **One match → copy the full Canonical query.** Substitute Slots
   verbatim from the user's actual values. Execute step-by-step. Do not
   skip verification steps (recalc + total_formulas + spot-check).
3. **Multiple partial matches → fuse.** Take the strictest verification
   from each matched canonical query; never relax a constraint.
4. **No match → fall back** to [`../SKILL.md`](../SKILL.md) Operational rules and
   §2 Decision Tree. Don't force-fit a wrong canonical query.

## Universal constraints (apply to every canonical query above)

- **Don't `2>/dev/null`.** Redirect to `<TMP>/<step>.log`, grep on demand.
- **JSON files via `json.dumps(payload, ensure_ascii=False, indent=2)`.**
- **Formula-first.** Every derived value = `=` formula, never a literal.
- **`recalc.py` total_formulas == 0 = delivery failure.** Rewrite, don't ship.
- **Never `df.sample` / `df.head` on the raw sheet** when a summary will
  aggregate over it. Always write the full row count.
- **Summaries: pivot tables or `=SUMIFS`/`=COUNTIFS` only.** Python
  groupby written back as values is forbidden.
- **Slicers: template-inheritance OR XML transplant OR explicit user
  notification.** Never silently downgrade.
- **When user states a numeric range, enforce it in the formula** with
  `=ROUND(MIN(MAX(raw, LO), HI), 1)`. Spot-check MIN/MAX after recalc.
