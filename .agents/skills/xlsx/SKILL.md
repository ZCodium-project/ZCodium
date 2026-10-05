---
name: xlsx
description: >-
  Spreadsheet skill — read, edit, create, and convert .xlsx/.xlsm/.csv/.tsv files.
  Trigger when a spreadsheet file is the primary input or output: editing columns, formulas, formatting, charting, cleaning messy data, or creating new spreadsheets.
  Not for Word/HTML/PDF deliverables even if tabular data is involved.
descriptions:
  zh-Hans: "读取、编辑、创建和转换表格文件，支持 xlsx、xlsm、csv、tsv、公式、格式、图表和数据清洗。"
license: MIT
---

<!--
Copied from MiniMaxAI/minimax-code (packages/local-runtime/assets/skills/xlsx)
at revision 564e9166d81f87b0b767b005e4779d4697b512be.
Copyright (c) 2026 MiniMax Code. Licensed under MIT.
Modified by ZCode: added the provenance notice; replaced a pointer into a different skill in the upstream host product with a self-contained Windows tool table (detect + install command), and stated that this fork ships no auto-installer. All other skill instructions unchanged.
See THIRD-PARTY-NOTICES.md in the repository root for license and provenance.
-->

# xlsx

A pragmatic, recipe-first guide for reading, editing, creating, and
recalculating `.xlsx` / `.xlsm` / `.csv` / `.tsv` files. The default
pairing is **pandas for tabular data + openpyxl for formulas, styles,
named ranges, and charts**. Recalculation through
[`scripts/recalc.py`](scripts/recalc.py) (LibreOffice headless) is
mandatory before delivery — openpyxl writes formulas as strings and
never evaluates them.

> **Formula-first.** A spreadsheet without live formulas is just a
> CSV with a fancier extension. **Every computed value** — totals,
> averages, growth rates, ratios, cross-sheet references, percent
> changes, anything derivable from other cells — **must be written as
> a live `=…` formula**, not as the pre-computed number. Hard-coded
> numbers belong only in the **Assumptions** block (inputs the user
> can flip to re-run the model). When in doubt, write the formula.
> Full convention in §5 and
> [`docs/conventions-guide.md`](docs/conventions-guide.md) §4.
>
> **❌ The most common anti-pattern.** Loading a workbook with pandas,
> computing derived columns in Python (`df["total"] = df["a"] + df["b"]`,
> `df.groupby(...).sum()`, etc.), then writing the result back with
> `df.to_excel(...)` ships **static numbers** — the workbook becomes a
> dead snapshot the moment any input changes. Use pandas/polars only
> to load and clean **raw inputs**; emit every derived value as a live
> `=` formula via openpyxl (§3.2). This rule applies regardless of how
> easy it would be to compute the value in Python first.

> **Spreadsheet output only.** For Word documents, PowerPoint slides,
> HTML reports, standalone Python scripts, database pipelines, or the
> Google Sheets API, switch to the matching skill.

## Operational rules — read before doing anything

> **1. Match user query against [`docs/pitfalls-index.md`](docs/pitfalls-index.md)
> FIRST.** It contains 8 production-ready **canonical query templates**
> (X1–X8), each with a `Match signatures` block (sample queries) and a
> complete executable prompt that already encodes Formula-first, recalc
> verification, formula-count gate, sample-data-integrity, slicer
> handling, and every other rule below. Workflow:
>
> 1. Scan the Quick lookup table — match user's query keywords to a row.
> 2. **Copy the matching canonical query verbatim**, substitute the
>    `Slots` (e.g. `{INPUT}`, `{COMPANY}`, `{OUTPUT_XLSX}`) with the
>    user's actual values, and execute step-by-step.
> 3. Multiple partial matches → fuse: take the strictest verification
>    from each, never relax a constraint.
> 4. No match → fall back to the Decision Tree / per-section guides below.
>
> Do NOT skip verification steps in the canonical queries — every
> "ship a wrong workbook" failure traces back to skipping recalc,
> total_formulas check, or row-count canary.

> **2. Formula-first is non-negotiable.** A delivery that ships static
> numbers where formulas were possible is a **failed delivery** — even
> if every number is numerically correct the moment you saved it. The
> user's first edit will expose the lie. Hardcode only the Assumptions
> block; everything derivable from other cells goes in as `=…`. Full
> regime in §5.

> **3. `total_formulas == 0` is a red flag, not a green light.** A
> "success" recalc with zero formulas means the workbook is a static
> dump — the user can't audit, can't re-run scenarios, can't
> introspect derivations. Treat it as a delivery failure and rewrite
> via §3.2 / openpyxl `=` formulas. The only legitimate exception is
> a workbook the user explicitly asked to be a static snapshot
> (in which case `pandas.to_excel` is the right tool, not this skill).

> **4. Source-data-integrity rule — never `df.sample(N)` / `df.head(N)`
> on the raw sheet.** Down-sampling 400k rows to 100k "because openpyxl
> writes are slow" silently destroys every aggregation built on top —
> the pivot or `=SUMIF` summary will be off by ~75% and look entirely
> plausible. **Write the full row count, even if it takes minutes.**
> If write throughput is the real bottleneck, switch the writer
> (xlsxwriter §3.3, or `Workbook(write_only=True)` streaming pattern
> in [`docs/advanced-reference.md`](docs/advanced-reference.md) §6),
> never the sample size.

> **5. Summaries must be Excel-native — pivot tables or `=SUMIFS` /
> `=COUNTIFS` over the Raw sheet, never Python `groupby` written back
> as values.** This is the same rule as §3 phrased for the most
> common offender. The user expects: edit a Raw row, hit recalc, see
> the totals move. Static summaries break that contract silently.

> **6. Slicers cannot be authored from scratch by openpyxl.** The
> `xl/slicers/*.xml` part requires GUID-bound pivot cache references
> that openpyxl has no API for. Two production paths:
> (a) template-inheritance — author a `template.xlsx` once in Excel
> or LibreOffice with the slicer wired to a named range, then
> `load_workbook(template) → write into named range → save as new`;
> (b) raw-XML transplant from a known-good template via
> `scripts/office/{unpack,pack}.py`. **If the user asks for a slicer
> and you have no template, say so before silently downgrading to a
> static dropdown.**

> **7. Don't suppress stderr.** `2>/dev/null` is **never** the right
> choice in this skill (`recalc.py`, `soffice`, `pdfinfo`, `unpack.py`,
> `pack.py`). On failure you lose the only signal that explains why
> and have to rerun blind. If output is too noisy, redirect to a log
> file and grep on demand:
> ```bash
> python scripts/recalc.py file.xlsx 60 2>/tmp/recalc.log
> # If JSON shows status != "success" or exit != 0, then:
> #   grep -in "error\|trace\|fail" /tmp/recalc.log | head -20
> ```

> **8. When the user states a numeric range for a derived value,
> enforce it in the formula.** "Composite score 0–100" → wrap the
> formula with `=ROUND(MIN(MAX(raw, 0), 100), 1)`. Don't ship a
> 0–1804 column and blame "data anomaly". Spot-check `MIN()` /
> `MAX()` of the output column after recalc.

> **9. 500k+ rows: pandas/polars first, not openpyxl row walking.**
> For large tabular inputs (roughly **500,000+ rows**, or hundreds of MB),
> default to `pandas`/`polars` for reading, filtering, type normalization,
> joins, and QA spot-checks. Do **not** iterate cell-by-cell with openpyxl to
> inspect or transform the source workbook — it is too slow and encourages
> accidental sampling. Use openpyxl only at the output boundary for formulas,
> styles, charts, templates, and final `.xlsx` assembly. If the output is a
> static raw-data dump, `DataFrame.to_excel`/`xlsxwriter` is acceptable; if it
> contains derived values, write full raw rows and Excel-native `=` formulas.


> **10. Non-standard XLSX packages: trust recalc raw-XML fallback.**
> Workbooks with heavy merged cells, charts/drawings, or vendor-generated XML
> can make openpyxl crash even after LibreOffice recalculated successfully.
> `scripts/recalc.py` now catches openpyxl parse failures and falls back to a
> raw worksheet XML scanner. If JSON returns `scanner: "raw_xml_fallback"` with
> `status: success` / `errors_found`, treat it as authoritative and do not
> retry blindly. Use the `compatibility_hint` field to decide whether to avoid
> downstream openpyxl rewrites. Details in [`docs/recalc-guide.md`](docs/recalc-guide.md) §10.

For deeper material — creation and edit recipes, recalc internals,
financial-model conventions, large-file alternatives — see
[`docs/`](docs/).

---

## 1. Scope and When to Use

This skill covers the everyday spreadsheet chores an LLM agent is most
often asked to perform end-to-end:

- inspecting an existing workbook (sheet names, merged regions, headers)
- reading tabular data into pandas / polars for analysis or QA
- creating a new workbook with formulas, styles, named ranges, and charts
- editing an existing workbook in place (insert / delete / restyle / replace)
- recalculating every formula via [`scripts/recalc.py`](scripts/recalc.py)
  and verifying `total_errors == 0` in the JSON
- enforcing the financial-model conventions in §5 on every delivery
- converting between tabular formats (`csv` ↔ `xlsx` ↔ `ods` ↔ `tsv`)

Use a different approach when:

- the deliverable is a Word document, slide deck, standalone script, or
  database pipeline — switch to the matching skill (`docx`, `pptx`, etc.)
- the workflow is read-only and the user just wants the cell values
  printed — `extract-text` (`docs/advanced-reference.md` §5) is enough
- the workbook lives behind the Google Sheets API rather than on disk

---

## 2. Decision Tree

```
What does the user want from / for this workbook?
|
+-- Read tabular data only ───────────────> pandas / polars     -> §3.1, §3.4
+-- Inspect quickly without code ─────────> extract-text CLI    -> docs/advanced-reference.md §5
+-- Create a new workbook ────────────────> openpyxl            -> §3.2
+-- Edit an existing workbook in place ───> openpyxl            -> §3.2
+-- Output has any derived/computed cells > openpyxl + `=` formulas -> §3.2, §5
+-- Very large workbook (500k+ rows) ─────> pandas/polars read + openpyxl/xlsxwriter output -> §3.1, §3.4, docs/advanced-reference.md §6
+-- Recalculate formulas (mandatory) ─────> scripts/recalc.py   -> §4.1
+-- Convert format (csv ↔ xlsx ↔ ods) ────> pyexcel             -> §3.5
+-- Sandboxed env (no AF_UNIX) ───────────> office.soffice shim -> §4.1
```

**Default rule.** Read with pandas, write and edit with openpyxl,
recalculate with `scripts/recalc.py`. Drop to xlsxwriter when the
workload is write-only and throughput-bound; drop to polars when the
input file is too big for pandas to hold in memory. **Never use
`pandas.to_excel` / `polars.write_excel` for derived/computed values
— those write static numbers, not live formulas. See §3.1's ⚠️ box.**

---

## 3. Library Cookbook

Five subsections, one per library. Each entry is a minimum viable
example plus a short note. Deeper recipes — full styling, conditional
formatting, charts, edit gotchas — live in
[`docs/create-edit-guide.md`](docs/create-edit-guide.md).

### 3.1 pandas — tabular read / write (default)

```python
import pandas as pd

frame = pd.read_excel("mau_forecast.xlsx", engine="openpyxl")           # first sheet
sheets = pd.read_excel("mau_forecast.xlsx", sheet_name=None)            # {sheet: DataFrame}
frame.to_excel("clean_mau.xlsx", sheet_name="clean", index=False)
```

> ⚠️ **`to_excel()` writes static numbers only — no formulas survive.**
> Use it strictly for **raw data dumps**: cleaned input data, exported
> query results, anything where every cell is itself a primary value.
> The moment the deliverable contains a derived value — totals,
> averages, ratios, growth rates, anything computable from other cells
> — switch to §3.2 and write it as a live `=` formula. **Never** do
> `df["total"] = df["a"] + df["b"]; df.to_excel(...)`: the workbook
> will look fine until the user edits an input and discovers the
> "totals" don't move. For aggregations across rows/sheets, write the
> raw rows here and emit `=SUM(...)` / `=SUMIF(...)` on the openpyxl
> side (`docs/advanced-reference.md` §6 has the worked large-file
> example).

Default for any "read tabular data" job. For 500k+ rows, prefer pandas/polars
for source inspection, filtering, joins, and QA; avoid openpyxl cell-by-cell
source traversal. Pair with openpyxl only on the write side when you need
formulas or formatting.

### 3.2 openpyxl — create and edit (default for write + edit)

```python
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font

book  = Workbook()                                                       # create
sheet = book.active
sheet["A1"], sheet["B1"], sheet["C1"], sheet["D1"], sheet["E1"] = (
    "Quarter", "MAU (mm)", "Tokens/MAU", "Take-rate", "ARR (¥mm)"
)
# Inputs (Assumptions) — hardcoded primary values; §5.2 requires blue.
input_font = Font(color="0000FF")
sheet["A2"], sheet["B2"], sheet["C2"], sheet["D2"] = "2025Q3", 148, 27, 0.85
for ref in ("B2", "C2", "D2"):
    sheet[ref].font = input_font
# Derived ARR — references inputs, not literal numbers; §5.2 requires black.
sheet["E2"] = "=B2*C2*D2"
sheet["E2"].font = Font(color="000000")
book.save("mau_forecast.xlsx")

book = load_workbook("mau_forecast.xlsx")                               # edit
book["Sheet"]["D2"] = 0.90                                              # flip take-rate
# E2 still says "=B2*C2*D2" — recalc.py will refresh the cached value
book.save("mau_forecast.xlsx")
```

The edit example flips the **input** (`D2`), not the result — that is
the whole point of formula-first. If `E2` had been written as the
literal `=148*27*0.85`, this edit would have left ARR stale.
`data_only=True` is **read-only safe only** — saving such a workbook
permanently replaces every formula with its cached value. See
[`docs/create-edit-guide.md`](docs/create-edit-guide.md) §7.

### 3.3 xlsxwriter — write-only throughput

```python
import xlsxwriter

book  = xlsxwriter.Workbook("big_table.xlsx")
sheet = book.add_worksheet("Tokens")
for r, row in enumerate(rows):
    sheet.write_row(r, 0, row)
sheet.write_formula(0, 5, "=SUM(F2:F100001)")
book.close()
```

Faster than openpyxl on six-figure-row writes; cannot reopen what it
wrote. Reach for it when the workbook is the terminal output.

### 3.4 polars — fast read for huge files

```python
import polars as pl

frame    = pl.read_excel("big.xlsx")
as_pandas = frame.to_pandas()                                            # interop
```

> ⚠️ **`polars.write_excel()` writes static numbers — same trap as
> `pandas.to_excel`.** No formulas, no charts, no styles. Polars is a
> read-side accelerator for files above ~500k rows; for the write side,
> always pair with openpyxl and emit derived values as `=` formulas
> (`docs/advanced-reference.md` §6 has the worked large-file pattern).

### 3.5 pyexcel — format-agnostic conversion

```python
import pyexcel as pe

records = pe.get_records(file_name="upload.xlsx")                       # also csv / ods / tsv
pe.save_book_as(file_name="raw.csv", dest_file_name="clean.xlsx")
```

Use it when the input format is unknown ahead of time, or when the
pipeline accepts several formats.

---

## 4. Recalculation Routes

openpyxl writes formulas as strings and never evaluates them.
Recalculation is mandatory before delivery; it refreshes the cached
values and surfaces the seven Excel error markers.

### 4.1 `scripts/recalc.py` — LibreOffice headless (default)

```bash
python scripts/recalc.py mau_forecast.xlsx 30
```

Sample success output on stdout:

```json
{
  "status": "success",
  "total_errors": 0,
  "total_formulas": 42
}
```

If `status == "errors_found"`, the JSON includes an `error_summary`
keyed by error marker with up to 20 locations per marker. For the full
JSON schema, the seven error markers, the macro install path, the
cross-platform timeout wrapper, and the AF_UNIX sandbox shim, see
[`docs/recalc-guide.md`](docs/recalc-guide.md).

### 4.2 `xlcalculator` / `formulas` — pure-Python fallback

In CI containers or serverless runtimes without LibreOffice, fall back
to [`xlcalculator`](https://github.com/bradbase/xlcalculator) or
[`formulas`](https://github.com/vinci1it2000/formulas). Neither
supports array formulas, pivot tables, or custom functions — for
delivery, always rerun `recalc.py` on a host with LibreOffice. Limits
in [`docs/recalc-guide.md`](docs/recalc-guide.md) §8.

---

## 5. Conventions for Excel Outputs

**Formula-first as the unifying rule.** All four sub-sections below
exist to enforce one principle: a delivered workbook is a *live model*
the user can adjust by editing inputs and watching every dependent
cell recompute. The colour code (§5.2 — black for formulas, blue for
hardcoded inputs) makes it obvious at a glance whether a number is
derived or assumed; the recalc gate (§5.1) makes sure every formula
actually evaluates; the number formats (§5.3) make sure the recomputed
values stay readable. **Whenever you can express a value as a formula
referencing other cells, do so** — never paste a pre-computed total /
average / ratio / growth rate as a literal number. Hard-coded numbers
belong only in the leading Assumptions block (full rationale in
[`docs/conventions-guide.md`](docs/conventions-guide.md) §4).

### 5.1 Professional font and zero formula errors

Default body font is one of Calibri / Arial / Times New Roman, used
consistently throughout the workbook. Every workbook with formulas
must pass `scripts/recalc.py` with `total_errors == 0` before delivery.

### 5.2 Color coding

| Color | Hex | RGB | Meaning | Anti-pattern |
|---|---|---|---|---|
| Black | `000000` | `0,0,0` | Every formula and computed result | Setting `=A1+B1` to blue makes it look like a manual input |
| Blue | `0000FF` | `0,0,255` | Hard-coded inputs and scenario assumptions | Setting `=Sheet2!A1` to blue hides the cross-sheet link |
| Green | `008000` | `0,128,0` | Same-workbook cross-sheet links | Coloring a cross-file link green hides the external dependency |
| Red | `FF0000` | `255,0,0` | Cross-file external links | Coloring same-sheet `=A1` red implies a fake external dependency |
| Yellow (fill) | `FFFF00` | `255,255,0` background | Critical assumptions awaiting review | Coloring every cell yellow drowns out the cells that need review |

Black-first ordering matches the reviewer's scan order — see
[`docs/conventions-guide.md`](docs/conventions-guide.md) §1 for the
rationale. Three- and six-digit hex are equivalent (`#000` ≡ `#000000`);
both `openpyxl` and `xlsxwriter` accept either form.

### 5.3 Number formatting

| Type | Format | Rationale |
|---|---|---|
| Year | text (`"FY2025"`) | Numeric `2025` gets thousands-separated to `2,025` |
| Currency | `$#,##0` or `¥#,##0` with the unit (`mm` / `bn` / `k`) in the header | The unit lives once per column, not per cell |
| Zero | `"$#,##0;($#,##0);-"` | Em-dash separates "zero by intent" from "missing value" |
| Percentage | `0.0%` | One decimal is enough for a scan; two is false precision |
| Multiple | `0.0x` | Used for valuation multiples (EV/EBITDA, P/S, P/E) |
| Negative | `(123)` (parentheses) | Accounting convention; minus signs blend into table grids |
| Hardcode | `Source: …` annotation in the next column or as a cell comment | Reviewer can audit every input back to its source |

Sample headers: `ARR (¥mm)` / `Tokens (bn)` / `MAU (mm)` /
`Token unit price 1.2x`. Full hardcode-source grammar and five worked
examples in [`docs/conventions-guide.md`](docs/conventions-guide.md) §3.

### 5.4 Preserve existing templates

When updating someone else's template, observe before editing — colors,
column widths, fonts, merged cells, number formats, and conditional
formatting from the existing file all override this skill's defaults.
Checklist in [`docs/conventions-guide.md`](docs/conventions-guide.md) §5.

---

## 6. Reference Index

| File | Purpose |
|---|---|
| [`docs/pitfalls-index.md`](docs/pitfalls-index.md) | **Read first when the task matches a known case.** 8 evaluation cases keyed by task signature → past failure → recommended trace |
| [`docs/superstore-multiformat-conversion-case.md`](docs/superstore-multiformat-conversion-case.md) | X8 progressive case: Superstore Excel → CSV/JSON/HTML→PDF + XML-template CSV→XLSX reverse validation |
| [`docs/create-edit-guide.md`](docs/create-edit-guide.md) | openpyxl create / edit / chart recipes plus merged-cell and shared-strings gotchas |
| [`docs/recalc-guide.md`](docs/recalc-guide.md) | `recalc.py` reference — macro path, JSON schema, AF_UNIX shim, timeouts, alternatives |
| [`docs/conventions-guide.md`](docs/conventions-guide.md) | Color coding, number formats, formula construction, hardcode source documentation |
| [`docs/raw-xml-escape-hatch.md`](docs/raw-xml-escape-hatch.md) | Surgical XML escape hatch via `scripts/office/{pack,unpack}.py` for the few files openpyxl can't safely round-trip (VBA, pivot caches, slicers, connections, externalLinks) |
| [`docs/advanced-reference.md`](docs/advanced-reference.md) | polars / duckdb / xlcalculator / pyexcel / extract-text / large-file / CI workflows |
| `scripts/recalc.py` | LibreOffice-driven recalculation entry point — mandatory final step |
| `scripts/office/soffice.py` | Sandbox-friendly LibreOffice runner with AF_UNIX shim |
| `scripts/office/{pack,unpack,validate}.py` | DOCX / PPTX / XLSX zip helpers + XSD validate (cross-format; schemas live under `office/schemas/`) |

---

## 7. Troubleshooting

| Symptom | Likely cause | First thing to try |
|---|---|---|
| Recalc returns `#REF!` after row insertion | Old formulas point at the row that just shifted | Search the workbook for `#REF!`; replace with the new coordinate; rerun `recalc.py` |
| Recalc returns `#DIV/0!` | Denominator evaluates to zero or empty | Wrap with `IFERROR(num/denom, 0)` or `IF(denom=0, "", num/denom)` |
| Recalc returns `#N/A` | `VLOOKUP` / `MATCH` key not found in the lookup column | Check key whitespace, case, and type (`123` vs `"123"`); confirm the lookup column is contiguous |
| `recalc.py` exits with `soffice timed out` | LibreOffice hung on a heavy workbook | Raise the second positional arg (`python scripts/recalc.py file.xlsx 180`); if it persists, see `docs/recalc-guide.md` §5 |
| `recalc.py` errors with `Address already in use` / AF_UNIX denied | Sandbox blocks AF_UNIX (macOS App Sandbox / Linux seccomp) | Auto-handled by `office.soffice` shim; ensure `gcc` is on `PATH` so the shim can compile (see `docs/recalc-guide.md` §6) |
| `iter_rows()` returns `None` for cells that visibly have a value | Cells live inside a merged region; only the anchor carries the value | `unmerge_cells()` first, broadcast the anchor value, then re-merge if layout matters (see `docs/create-edit-guide.md` §9) |
| `save()` deletes every formula in the workbook | The file was opened with `data_only=True` | Reload with `load_workbook(path)` (default `data_only=False`); `data_only=True` is read-only safe only |
| `load_workbook` raises `TypeError: expected <class 'int'>` after `recalc.py` ran | LibreOffice rewrote the workbook's `<mergeCell>` XML in a form openpyxl's default parser cannot read | The file itself is intact and openable in Excel — `recalc.py` already returned `status: success` via its raw-XML fallback (see `docs/recalc-guide.md` §9). For programmatic readback, retry with `load_workbook(path, read_only=True, data_only=True)` (streaming reader skips the merged-cell parser); when you also need formula strings, drop to the raw-XML pattern in `docs/create-edit-guide.md` §11 |
| Polars `write_excel` output has no formulas, no charts, no styles | Expected — polars does not write formulas / charts / styles | Use openpyxl on the write side (see `docs/advanced-reference.md` §6) |
| `load_workbook` strips VBA / pivot tables / slicers / connections | openpyxl can't round-trip these binary or strongly-coupled artefacts | Drop to `scripts/office/unpack.py` + manual XML edit + `scripts/office/pack.py`; see `docs/raw-xml-escape-hatch.md` §1 for the full no-go table |

---

## 8. Environment

| Dependency | Purpose | Install |
|---|---|---|
| Python 3.9+ | All `.py` scripts | system |
| `openpyxl` | Read / write `.xlsx` with formulas, styles, named ranges | `pip install openpyxl` |
| `pandas` | Tabular read / write (default for §3.1) | `pip install pandas openpyxl` |
| `polars` (optional) | Fast read for large files (§3.4) | `pip install polars` |
| `xlsxwriter` (optional) | Write-only throughput (§3.3) | `pip install xlsxwriter` |
| `pyexcel` (optional) | Format-agnostic conversion (§3.5) | `pip install pyexcel pyexcel-xlsx` |
| LibreOffice (`soffice` on PATH) | `recalc.py` headless recalculation | macOS: `brew install --cask libreoffice`; Debian/Ubuntu: `apt install libreoffice` |
| `coreutils` (macOS) | Provides `gtimeout` for the recalc timeout wrapper | `brew install coreutils` (optional; falls back to `subprocess` kwarg) |

`scripts/office/soffice.py` auto-activates an `LD_PRELOAD` AF_UNIX shim
when the host sandbox denies AF_UNIX (macOS App Sandbox, Linux seccomp);
`recalc.py` already routes through `get_soffice_env()`, so it is transparent.

For long-running batch jobs (hundreds of workbooks per hour), swap
`soffice` per-call for [`unoserver`](https://github.com/unoconv/unoserver) —
see [`docs/recalc-guide.md`](docs/recalc-guide.md) §7.

## Windows (win32) platform notes

Scripts and code examples in this skill use bash syntax (heredocs, pipes, `python3`). On Windows,
execute them via **Git Bash**:

```powershell
# Raw XML escape hatch
bash -c "python scripts/office/unpack.py input.xlsx /tmp/work/"
bash -c "python scripts/office/pack.py /tmp/work/ output.xlsx"

# Piped inspection
bash -c "python -c \"from openpyxl import load_workbook; wb=load_workbook('file.xlsx', read_only=True); print(wb.sheetnames)\""
```

> **⚠️ recalc.py limitation on Windows:** `scripts/recalc.py` installs a LibreOffice Basic macro
> to `~/.config/libreoffice/...` (Linux path). On Windows, LibreOffice stores macros in
> `%APPDATA%\LibreOffice\4\user\basic\Standard\`. Until `recalc.py` is patched to resolve the
> Windows macro directory, recalc will fail to find the macro. **Workaround:** open the workbook
> in LibreOffice GUI, run Ctrl+Shift+F9 (recalculate all), then save.

**Key differences on Windows:**

| Unix reference | Windows handling |
|---|---|
| `python3` | Use `python` — Git Bash finds it on PATH if installed |
| `python3 <<EOF ... EOF` | Use `bash -c "python -c '...'"` or write a .py file and run it |
| `/tmp/` | Git Bash maps `/tmp/` automatically — scripts work as-is |
| `grep -in ... \| head -20` | Works inside `bash -c "..."` |
| `brew install --cask libreoffice` | `winget install TheDocumentFoundation.LibreOffice` |
| `coreutils` (`gtimeout`) | Not needed — `recalc.py` falls back to `subprocess` timeout kwarg |

**If Git Bash or any tool is missing**, detect before installing anything:

| Tool | Detect | Install (run by the user, not the agent) |
| --- | --- | --- |
| Python | `python --version` | `winget install Python.Python.3.12` |
| Git Bash | `ls "$PROGRAMFILES/Git/bin/bash.exe"` | `winget install Git.Git` |
| LibreOffice | `ls "$PROGRAMFILES/LibreOffice/program/soffice.exe"` | `winget install TheDocumentFoundation.LibreOffice` |
| openpyxl | `python -c "import openpyxl; print(openpyxl.__version__)"` | `python -m pip install openpyxl` |

This fork deliberately does **not** ship an auto-installer. Upstream delegated the bootstrap to a
reference inside a different skill in its own host product; that skill is not part of ZCodium, so
the pointer dangles. A skill that also writes to the user's shell config or installs global
packages is the wrong default on a managed host anyway. Report what is missing and let the user
run the install command.
