# advanced-reference — situational xlsx libraries and workflows

> Material that is too situational for [`SKILL.md`](../SKILL.md) but worth
> documenting once: polars / duckdb / xlcalculator / pyexcel deep dives,
> the `extract-text` exploration CLI, large-file workflows, CI fallbacks,
> and the pandas → polars migration. Reach for this file when the default
> stack (pandas + openpyxl + `recalc.py`) does not fit the workload.

## 1. polars deep dive

`polars` is the right choice for any workbook above ~500k rows or any
pipeline where wall-clock latency matters. It uses Apache Arrow under
the hood and parses xlsx via `calamine`, which is roughly an order of
magnitude faster than openpyxl on read.

```python
import polars as pl

frame = pl.read_excel(
    "mau_forecast.xlsx",
    sheet_name="MAU_Forecast",
    schema_overrides={
        "Quarter": pl.Utf8,
        "MAU (mm)": pl.Float64,
        "Tokens (bn)": pl.Float64,
        "ARR (¥mm)": pl.Float64,
    },
    has_header=True,
)

# Write back — note the limitations below
frame.write_excel("clean_mau.xlsx", worksheet="clean")
```

> ⚠️ **`write_excel` writes static numbers only** — no formulas, no
> charts, no styles, conditional formatting best-effort. Use it
> strictly for **raw data dumps** (a cleaned input frame, an exported
> query). The moment the deliverable contains derived values, switch to
> openpyxl on the write side and emit each derivation as `=` formulas.
> The large-file pattern in §6 shows the polars-read + openpyxl-write
> + `=SUMIF(...)` shape end-to-end.

`schema_overrides` is the polars equivalent of pandas's `dtype` kwarg
and is the recommended way to suppress column-by-column type-inference
surprises (the most common one is integer-like columns silently
becoming `Int64` and losing leading zeros).

`write_excel` limitations to know before reaching for it as a write
target:

- No formulas — every cell is a literal value
- No charts
- No styles (font, fill, border, alignment)
- Conditional formatting is best-effort and only on simple rules

For any output that needs formulas, styles, or charts, reach for
openpyxl on the write side and keep polars only for the read.

When to choose polars over pandas:

- File size > 500k rows, or > 500 MB on disk
- Memory pressure (containers with < 4 GB RAM, serverless functions)
- Pipeline already uses Arrow / DuckDB
- Lazy evaluation needed (`pl.scan_excel` is not yet supported, but
  downstream operations on a polars frame can still fuse)

## 2. duckdb against xlsx

DuckDB can SQL-query an xlsx file directly via the spatial extension
(which understands GDAL's `OGR_XLSX` driver). Useful for joining
several sheets without writing a manual loop:

```sql
INSTALL spatial;
LOAD spatial;

-- Read a single sheet
SELECT * FROM st_read('model.xlsx', layer='Inputs') LIMIT 10;

-- Multi-sheet UNION (each layer becomes a table)
SELECT 'Inputs'   AS source, * FROM st_read('model.xlsx', layer='Inputs')
UNION ALL
SELECT 'Outputs'  AS source, * FROM st_read('model.xlsx', layer='Outputs');

-- Join two sheets on a shared key
SELECT i.cohort, i.users, o.arr
FROM st_read('model.xlsx', layer='Inputs')  i
JOIN st_read('model.xlsx', layer='Outputs') o USING (cohort);
```

Choose SQL over a DataFrame transform when the operation is naturally
relational (join across sheets, aggregate with `GROUP BY`, window
functions). DuckDB serializes the result back to a DataFrame in one
call (`con.execute(...).fetchdf()`) so the rest of the pipeline stays
familiar.

DuckDB read is nondestructive — formulas are evaluated on the cached
values present in the xlsx. Run `scripts/recalc.py` first if the file
has been edited but not yet recalculated.

## 3. xlcalculator — pure-Python recalculation

When LibreOffice cannot be installed (CI containers, serverless,
locked-down corporate machines),
[`xlcalculator`](https://github.com/bradbase/xlcalculator) is the
closest pure-Python equivalent.

```bash
pip install xlcalculator
```

```python
from xlcalculator import ModelCompiler, Evaluator

compiler  = ModelCompiler()
model     = compiler.read_and_parse_archive("model.xlsx")
evaluator = Evaluator(model)
print(evaluator.evaluate("MAU_Forecast!D2"))
```

The supported function list is maintained upstream
(<https://github.com/bradbase/xlcalculator#supported-functions>) — if a
formula uses anything outside that list, the evaluator raises
`UnsupportedFunctionError`. CI integration: wrap the call in
`try / except`, fall back to flagging the workbook for manual recalc.

Gaps to watch:

- Array formulas (`{=SUM(...)*...}`) and dynamic-array spill ranges
- Pivot tables (the cached values are returned but not recalculated)
- Custom functions (xlcalculator has no UDF support)
- Charts and conditional formatting (out of scope — calculator only)

## 4. pyexcel — format-agnostic recipes

`pyexcel` normalises csv / xlsx / ods / tsv into the same `[record_dict]`
or `[[row]]` structure. Use it when the input format is unknown ahead
of time, or when the pipeline accepts several formats and the consumer
does not care:

```python
import pyexcel as pe

# Read whatever the file is, get list of dicts
records = pe.get_records(file_name="upload.xlsx")
records = pe.get_records(file_name="upload.csv")
records = pe.get_records(file_name="upload.ods")

# Convert csv to xlsx in one call
pe.save_book_as(file_name="raw.csv", dest_file_name="clean.xlsx")
pe.save_book_as(file_name="data.tsv", dest_file_name="data.ods")

# Multi-sheet workbook from a dict of lists
book = pe.Book({
    "Inputs":  [["k", "v"], ["growth", 0.05]],
    "Outputs": [["q", "arr"], ["2025Q3", 148]],
})
book.save_as("model.xlsx")
```

Useful glue for "user-uploaded spreadsheet, unknown extension" flows.
Drop back to pandas / openpyxl / polars when format is known and you
need richer control.

## 5. extract-text CLI — "look first, code second"

`extract-text` is the docx / pptx / xlsx companion CLI shared across
sibling skills. It dumps the workbook content to stdout, one
`## Sheet:` header per sheet, tab-separated cells per row:

```bash
extract-text mau_forecast.xlsx | head -120

# .xlsm shares the .xlsx zip container — force the format if the
# extension confuses the auto-detect:
extract-text --format xlsx macro_book.xlsm | head -120
```

Use it whenever the next code-write decision depends on what the file
actually contains — header positions, sheet names, merged regions, the
shape of the Assumptions block. Skipping this step and writing
exploratory openpyxl code blind wastes more tokens than the dump costs.

## 6. Large-file workflow

For files above ~500k rows, the read side dominates. The recommended
pattern is **pandas or polars on the read/transform/QA side, then
openpyxl/xlsxwriter only at the output boundary**. Do not use openpyxl
`iter_rows()`/cell loops to inspect or transform the source data.
Aggregations in the delivered workbook must live as `=SUMIF(...)` formulas
(or pivots), not as pre-computed numbers from pandas/polars.

Default choice:

- Use **pandas** when the workbook fits comfortably in memory and the task is
  ordinary cleaning/filtering/joining. It is the default for 500k+ row
  tabular work because it is simpler and much faster than openpyxl row loops.
- Use **polars** when pandas is memory-bound, latency-sensitive, or the data
  is Arrow/DuckDB-adjacent.
- Use **openpyxl** only to assemble the final workbook features pandas/polars
  cannot express: formulas, styles, named ranges, charts, template edits, and
  XML-compatible workbook structure.

> **❌ Never `df.sample(N)` / `df.head(N)` / per-category truncation
> before writing the raw sheet.** Down-sampling 400k rows to 100k
> "because openpyxl writes are slow" silently destroys every
> aggregation built on top — the pivot or `=SUMIF` summary will be
> off by ~75% and look entirely plausible. The pivot still functions,
> the recalc gate still passes, the workbook still opens cleanly.
> There is no error to catch — just a wrong number flowing into a
> downstream decision. **Write the full row count, even if it takes
> minutes.** If raw-write throughput is the actual bottleneck, switch
> the writer (§6.1), never the sample size.

```python
import polars as pl
from openpyxl import Workbook
from openpyxl.utils import get_column_letter

# Stream-read with polars (Arrow + calamine) — fast read, no formula support.
frame = pl.read_excel("big_input.xlsx")

# Write the FULL raw frame to a "Raw" sheet — never a sample. Sampling
# here breaks every downstream pivot / SUMIF without raising any error
# the recalc gate can detect.
book = Workbook()
raw  = book.active
raw.title = "Raw"
raw.append(frame.columns)                                                # header
for row in frame.iter_rows():
    raw.append(list(row))                                                # ALL rows

# Aggregation sheet — every "total" is a live SUMIF formula referencing Raw.
# Edit a Raw row, recalc, and the totals move automatically.
summary = book.create_sheet("Summary")
summary.append(["Cohort", "ARR (¥mm)"])
last_row = raw.max_row                                                   # data ends here
cohorts  = sorted(frame["cohort"].unique().to_list())                    # only used as keys
for r_idx, cohort in enumerate(cohorts, start=2):
    summary.cell(row=r_idx, column=1, value=cohort)
    summary.cell(
        row=r_idx, column=2,
        value=f"=SUMIF(Raw!A2:A{last_row}, A{r_idx}, Raw!B2:B{last_row})",
    )

book.save("filled_template.xlsx")
# subprocess: python scripts/recalc.py filled_template.xlsx
```

When to use:

- Input workbook > 500k rows or > 500 MB
- Target workbook needs formulas / styles / charts that polars cannot write

Caveats:

- Each library has its own type system; round-tripping through polars
  can drop the cell's number format. Re-apply formats on the openpyxl
  side.
- Formulas in the source workbook are read as their **cached values**
  (polars cannot evaluate them); re-add the formulas explicitly on the
  openpyxl side if they need to remain live.
- Always finish with `scripts/recalc.py` so the cached values in the
  output reflect the freshly written formulas.
- The polars-aggregate-and-dump shortcut (`frame.group_by(...).sum()`
  written back as `write_number`) ships static totals — see the
  `=SUMIF` recipe above for the formula-preserving alternative.

### 6.1 Choosing the writer when 400k+ rows is too slow

The pattern above uses regular `Workbook()`; on a 400k-row raw sheet
it can take minutes. Three accelerated variants — pick by what the
output workbook still needs to do:

| Need | Writer | Why |
|---|---|---|
| Output is the terminal artefact (no later openpyxl edits) | `xlsxwriter` (SKILL.md §3.3) | Fastest writer; cannot be reopened with openpyxl for further edits. Formulas must be written via `write_formula(...)`. |
| Need to keep editing with openpyxl after the bulk write | `openpyxl.Workbook(write_only=True)` + `WriteOnlyCell` | Streams rows to disk; ~4× faster than the default writer. Can be reopened normally. Cannot use `cell()` random access during the bulk phase. |
| Output is small enough that openpyxl works but pivot / chart authoring is the slow part | Default `Workbook()` + chunked `append()` in batches of 10k–50k | Lets you interleave pivot / chart objects with row writes. |

All three keep the **full** raw row count — that is the invariant. The
choice is purely about how the bytes get to disk faster.

Worked write-only example (the most common production path — fast
write, still editable later):

```python
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell

book = Workbook(write_only=True)
raw  = book.create_sheet("Raw")
raw.append(list(frame.columns))
for row in frame.iter_rows():
    raw.append([WriteOnlyCell(raw, value=v) for v in row])
book.save("filled_template.xlsx")

# Reopen with the regular reader to add pivots / formula-driven Summary
# sheet / charts; only the bulk write goes through write_only mode.
```

### 6.2 Pivot tables vs `=SUMIF` for the summary, plus slicers

Both `=SUMIF` and pivot tables belong to the formula-first regime —
both refresh when the raw data changes. Choose by structure complexity:

| Structure | Pick | Why |
|---|---|---|
| Single-axis aggregation (one key column → one metric) | `=SUMIF` / `=COUNTIF` / `=AVERAGEIF` in openpyxl | Pure formula; no Excel-specific objects to round-trip; survives any reopen / save cycle. |
| Multi-axis cross-tab, multiple metrics per cell, drill-down with slicers | Pivot table | `=SUMIFS` matrices become unmaintainable past 2 axes; pivots also expose slicers / timelines for interactive filtering. |

> **openpyxl cannot create pivot tables or slicers from scratch.** It
> can preserve them if they already exist in a loaded workbook (via a
> clean load → save cycle), but it has no API to author the
> `xl/pivotTables/*.xml` + `xl/pivotCaches/*.xml` + (for slicers)
> `xl/slicers/*.xml` parts. Two production paths:
>
> **(a) Template inheritance (recommended).** Author a
> `template.xlsx` once in Excel or LibreOffice with the pivot table
> and slicers already built and pointed at a named range that *will*
> hold the data. Each run:
>
> ```python
> from openpyxl import load_workbook
> book = load_workbook("template.xlsx")
> raw  = book["Raw"]
> # Clear any sample rows the template ships with, then write all rows
> for r_idx, row in enumerate(frame.iter_rows(), start=2):
>     for c_idx, v in enumerate(row, start=1):
>         raw.cell(row=r_idx, column=c_idx, value=v)
> book.save("output.xlsx")
> # subprocess: python scripts/recalc.py output.xlsx
> ```
>
> The pivot's `<cacheSource><worksheetSource>` keeps pointing at the
> named range, so `recalc.py` auto-refreshes both pivot and slicer.
>
> **(b) Surgical XML transplant from a known-good template.** When a
> pivot layout is generated programmatically, copy the four XML parts
> above out of a template into the target via
> `scripts/office/unpack.py` + `pack.py` (see
> [`raw-xml-escape-hatch.md`](raw-xml-escape-hatch.md) §1 + §3 for
> the recipe). Never hand-author these parts from a blank file — the
> GUID bindings between slicer cache, pivot cache, and pivot table are
> not tractable to write from scratch.
>
> **If the user explicitly asks for "a slicer in the workbook" and
> you have no template to inherit from, say so and ask the user to
> provide one** — do not silently downgrade to a `=SUMIF` summary
> without mentioning the slicer can't be created from openpyxl.

## 7. CI / serverless considerations

In a container without LibreOffice:

- `scripts/recalc.py` will exit non-zero with `"soffice: command not
  found"` — wrap calls in a `try / except` and fall back to
  `xlcalculator` (§3) for an approximate recalc.
- Pre-validate every input cheaply with `openpyxl.load_workbook(path,
  read_only=True)` before mutating; corrupt files fail fast (~50 ms)
  instead of after a multi-minute polars read.
- Cache the LibreOffice user profile between CI runs so the macro at
  `~/.config/libreoffice/.../basic/Standard/Module1.xba` does not
  reinstall each time (saves 5-10 s per job).
- For containerised LibreOffice, prefer the `linuxserver/libreoffice`
  or `collabora/code` images over `apt install libreoffice`; the
  `--headless` mode in older Debian builds segfaults on certain locales.

## 8. Migration: pandas → polars

When to switch:

- Pipeline latency is the bottleneck (read takes > 30 s with pandas)
- Memory is the bottleneck (DataFrame > half of available RAM)
- Downstream ops are columnar (group-by, joins, window functions) —
  polars's lazy frames fuse them into a single pass

What breaks during the migration:

| pandas behavior | polars behavior | Action |
|---|---|---|
| `pd.NaT` for missing dates | polars uses `null` with explicit type | Use `pl.col("d").is_null()` instead of `pd.isna` |
| Auto-convert object columns to dates | polars never auto-converts | Pass `try_parse_dates=True` to `read_excel` or coerce explicitly |
| Datetime tz handled by `dt.tz_localize` | polars uses `dt.replace_time_zone` | Update tz-handling code |
| `dtype="float64"` permissive | polars rejects mixed-type columns at read | Use `schema_overrides={col: pl.Float64}` |
| `to_excel` writes formulas | polars `write_excel` does not | Switch to openpyxl on the write side (§6) |

Rule of thumb: keep both libraries available, default to pandas,
upgrade to polars when one of the trigger conditions above hits.
Round-trip with `frame.to_pandas()` / `pl.from_pandas(frame)` so the
rest of the codebase keeps using whichever it already knows.

## 9. Out-of-scope reminder

The helpers under `scripts/office/` are cross-format zip / XSD
utilities shared with the docx and pptx sibling skills:

- `office/pack.py` — zip a directory of XML parts into a docx / pptx /
  xlsx container
- `office/unpack.py` — unzip a docx / pptx / xlsx into editable XML
- `office/validate.py` — validate the XML parts against the
  ECMA / W3C / Microsoft schemas under `office/schemas/`

These are not xlsx-specific creation tools — for xlsx output, stick to
openpyxl / xlsxwriter / polars / pyexcel as covered above.

**Do not edit `office/schemas/*.xsd`.** Those files are vendored copies
of the W3C / ECMA / ISO / Microsoft specifications. Regenerating or
hand-editing them silently breaks validation across docx, pptx, and
xlsx alike.
