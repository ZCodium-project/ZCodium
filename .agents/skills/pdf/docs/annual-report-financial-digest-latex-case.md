# Case: Long annual-report PDF → compact LaTeX financial digest

Use this case when the user supplies a long listed-company annual report PDF (100–300+ pages) and asks for a Chinese financial summary/report with accurate key tables, segment revenue, charts, and a professional broker-research / academic feel. This case is especially relevant when the user later rejects decorative layouts and wants a **compact, dense, data-table-first LaTeX PDF**.

Editable artifacts:

- `../templates/data-viz-report/cases/annual-report-financial-digest-latex/source.tex` — compact LaTeX source template; do not store generated PDFs.
- `../templates/data-viz-report/cases/annual-report-financial-digest-latex/build_charts.py` — chart/data scaffold from the PetroChina run; adapt data and paths before use.

## 1. Original intent and acceptance criteria

Representative prompt:

> Process the attached 200+ page annual report PDF. Extract the “主要财务指标” table, extract segment revenue for the main business lines, generate charts (multi-year financial trend, business revenue donut, financial-health radar), and output a polished Chinese PDF summary ≤10 pages with cover/TOC/charts and unified style.

Acceptance criteria from this run:

- Final report ≤10 pages, Chinese, A4.
- 2024 revenue accurate within ±5% (PetroChina run: `2,937,981` RMB mn ≈ `2.94万亿元`, accepted vs “约3.03万亿元”).
- Segment revenue includes all requested segments:
  - 勘探与生产 → annual-report segment may be named `油气和新能源`.
  - 炼油与化工 → `炼油化工和新材料`.
  - 销售 → `销售`.
  - 天然气与管道 → annual-report segment may be `天然气销售`.
- If user asks for “券商研报/论文式” and then “紧凑”, prioritize dense tables and data over decorative covers.
- If delivering via this LaTeX case, compile with `tectonic`/`xelatex`; it is **not HTML→PDF**.

## 2. Source inspection and locate-first parsing

For >200 page annual reports, index first. Do not blind-grep repeatedly.

```bash
pdfinfo "$PDF" | grep -E "Pages|Encrypted|Page size"
python3 - <<'PY'
from pypdf import PdfReader
pdf = "$PDF"
doc = PdfReader(pdf)
def walk(items, depth=0):
    for it in items:
        if isinstance(it, list):
            walk(it, depth+1)
        else:
            try:
                print(f"{'  '*depth}{it.title}\t{doc.get_destination_page_number(it)+1}")
            except Exception:
                pass
walk(getattr(doc, 'outline', []))
PY
pdftotext -layout -f 1 -l 8 "$PDF" -
```

If outline is empty, use printed TOC from first pages. In the PetroChina run, printed TOC showed:

- `会计数据和财务指标摘要` printed p5 → physical PDF p7.
- `经营情况讨论与分析` printed p21 → physical PDF p23.
- financial-report notes and segment tables around physical p173–176 and p262–265.

## 3. Extraction strategy

### 3.1 Use pdfplumber for text-native simple pages

```bash
python3 - <<'PY'
import pdfplumber
pdf = "$PDF"
for pno in [7,25,26,27,173,174,262,263]:
    with pdfplumber.open(pdf) as doc:
        text = doc.pages[pno-1].extract_text(x_tolerance=1, y_tolerance=3) or ''
        print('\n=== PAGE', pno, '===')
        print(text[:5000])
PY
```

### 3.2 Vision per page for complex financial tables / charts

For complex annual-report financial tables, run `read_pdf_vision.py` one page at a time. Do not pass ranges for these target pages.

```bash
cd "$MINIMAX_PDF_SKILL"
python3 -m scripts.read_pdf_vision \
  --input "$PDF" \
  --pages 7 \
  --prompt "请逐字提取本页‘主要财务数据/会计数据和财务指标摘要’表格，保留所有行名、年份和数值，输出 Markdown 表格。" \
  --max-stdout-bytes 12000
```

Segment prompts used in this run:

```text
请逐字提取本页分部业绩中的‘油气和新能源’部分，保留营业收入、经营支出、经营利润及同比描述，输出结构化中文。
```

```text
请逐字提取本页分部业绩中的‘炼油化工和新材料’与‘销售’部分，保留营业收入、经营支出、经营利润及同比描述，输出结构化中文。
```

```text
请逐字提取本页分部业绩中的‘天然气销售’部分，以及资产负债权益表关键数据，保留营业收入、经营支出、经营利润及同比描述，输出结构化中文。
```

Recovery: `gemini analysis failed: unexpected end of JSON input` may occur. Retry once; if it repeats and the text layer is clean, use pdfplumber output for that page and cross-check against adjacent segment tables.

## 4. Terminology and transformation rules

Use a normalized display vocabulary but preserve annual-report source names in a column:

| Display term | Source term examples | Notes |
|---|---|---|
| 勘探与生产 | 油气和新能源 / Exploration and Production | Mention mapping explicitly. |
| 炼油与化工 | 炼油化工和新材料 / Refining, Chemicals and New Materials | If source added “新材料”, keep source name in table. |
| 销售 | 销售 | Include trade business if source does. |
| 天然气与管道 | 天然气销售 / Natural Gas Sales | Some annual reports no longer use “管道”; map to requested term. |

Number rules:

- Preserve source unit; convert for readability only with labels (`百万元`, `亿元`, `万亿元`).
- Do not silently mix `分部收入` with `对外交易收入`. Include both when possible.
- If source has restatements, use the annual report’s restated comparative values and note this if material.
- For final claims, cite the source page/section in the notes page/table.

## 5. Asset and layout strategy

This run had two layout phases:

1. Decorative HTML/print-academic versions: useful for polished presentations, but user rejected large whitespace.
2. Final preferred version: **compact LaTeX table-first report**.

When user asks for broker-research / academic style but complains about whitespace, switch to the compact LaTeX strategy:

- No full-page cover unless explicitly required.
- 9pt or `\scriptsize` tables, narrow margins (≈11–12mm), compact section spacing.
- Data tables first; charts reduced to compact summary figures.
- Keep analysis short: one-line conclusion under each table, not long prose cards.
- Prefer 2–4 dense pages over 8 sparse pages, as long as acceptance criteria allow.

## 6. Chart generation

Use static PNG charts. The `build_charts.py` artifact contains an end-to-end scaffold using matplotlib. Adapt:

- `financial` dict: revenue, profit, EPS, assets, cash flow, ROE by year.
- `segments` list: business-line revenue/profit/yoy values.
- Output PNGs: `trend.png`, `donut.png`, `radar.png`.

Run:

```bash
python3 build_charts.py
```

If using only the compact LaTeX template, place the generated PNGs in the same working directory as `source.tex`, or update `\includegraphics{...}` paths.

## 7. LaTeX source and compilation

Use the case source as the editable deliverable:

```bash
cp "$MINIMAX_PDF_SKILL/templates/data-viz-report/cases/annual-report-financial-digest-latex/source.tex" ./report.tex
# edit company name, dates, tables, source notes, chart paths
tectonic -X compile report.tex --outdir ./out
cp ./out/report.pdf ./company_annual_report_digest.pdf
```

If `tectonic` is unavailable:

```bash
xelatex -interaction=nonstopmode report.tex
xelatex -interaction=nonstopmode report.tex
```

Important: if user explicitly requires HTML→PDF (some evals do), use the normal pdf HTML route instead. If user explicitly requests LaTeX or rejects HTML-style whitespace, this case applies.

## 8. Verification commands and expected evidence

Run every time:

```bash
pdfinfo "$OUT" | grep -E "Pages|Page size"
pdfimages -list "$OUT" | wc -l
pdftotext -layout "$OUT" - | grep -E "2,937,981|勘探与生产|炼油与化工|销售|天然气与管道"
```

Expected evidence for the PetroChina-style case:

- `Pages` ≤ 10. Compact final in this run: `2` pages.
- `Page size` is A4 (`595.28 x 841.89 pts` or close).
- Image count ≥ number of embedded chart PNGs (Poppler may count masks/duplicates; do not require exact equality).
- `pdftotext` finds:
  - key revenue value (`2,937,981` for PetroChina 2024 case);
  - all normalized segment names;
  - source-note text saying LaTeX direct generation if user asked “not HTML?”.

Optional link check if using TOC:

```bash
python3 - <<'PY'
from pypdf import PdfReader
r = PdfReader('$OUT')
ann = 0
for page in r.pages:
    a = page.get('/Annots')
    if a:
        ann += len(a.get_object())
print('annots', ann)
PY
```

## 9. Common pitfalls and recovery

| Pitfall | Symptom | Recovery |
|---|---|---|
| Too much decorative whitespace | User says “每页很多空白 / 不需要好看的样式” | Switch to compact LaTeX table-first template; remove cover/cards; reduce margins and font size. |
| LaTeX floats create blank pages | Chart jumps to last page or creates a blank page | Use `\usepackage{float}` and `[H]`, reduce image height, avoid one-chart-per-page. |
| HTML vs LaTeX confusion | User asks “你这个不是HTML转的吗？” | State clearly; deliver `.tex`-compiled PDF; include note “LaTeX直接编译生成，非HTML转PDF”. |
| Segment names mismatch | User asks “天然气与管道” but report says “天然气销售” | Include both display term and source term columns. |
| Vision transient failure | `unexpected end of JSON input` | Retry once; fallback to pdfplumber if text layer is clean. |
| Revenue acceptance mismatch | User expects “约3.03万亿元” but source says 2.94万亿元 | Show source value and percentage error; verify within ±5%. |
| Over-wide Chinese tables | Column overflow or tiny unreadable text | Use `tabularx`, `\scriptsize`, narrow margins, abbreviate headers, or split into two tables. |

## 10. Final reusable workflow

1. Preflight: verify `pdfinfo`, `pdftotext`, `pdfplumber`, `pypdf`, `tectonic`/`xelatex`.
2. Locate first: page count, outline/TOC, identify financial-summary and segment pages.
3. Extract:
   - pdfplumber for clean text pages;
   - vision one page at a time for complex tables.
4. Normalize terminology and units; keep source terms in table.
5. Build chart data and generate static PNGs.
6. Choose layout:
   - polished visual brief if user wants presentation style;
   - compact LaTeX table-first report if user values density / “券商研报” / “不要空白”.
7. Compile LaTeX; never store generated PDF in the case artifact.
8. Verify page count, A4, image presence, key values, all segment names, and source/method notes.
9. Deliver PDF and, when useful, keep `.tex` source in the working directory for edits.
