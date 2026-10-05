# create-edit-guide — openpyxl + xlsxwriter cookbook

> Detailed recipes for the two write-side libraries. The minimal
> one-liners live in [`SKILL.md`](../SKILL.md) §3; this file is for
> when a one-liner is not enough — full styling, charts, conditional
> formatting, in-place edits, and the merged-cell / shared-strings
> gotchas.

## 1. Creating a new workbook (openpyxl)

A workbook with formulas, named range, headline styling, and tuned
column widths — the smallest end-to-end example covering everything
`recalc.py` will validate later:

```python
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.workbook.defined_name import DefinedName

book = Workbook()
sheet = book.active
sheet.title = "MAU_Forecast"

# Assumptions block — single source of truth for tunable inputs.
# Live in $G$1 so $-locked references in row formulas survive a fill-down.
sheet["F1"], sheet["G1"] = "Take-rate", 0.85

headers = ["Quarter", "MAU (mm)", "Tokens (bn)", "ARR (¥mm)"]
for col_idx, label in enumerate(headers, start=1):
    sheet.cell(row=1, column=col_idx, value=label)

rows = [("2025Q3", 148, 27), ("2025Q4", 165, 31), ("2026Q1", 188, 36)]
for r_idx, (quarter, mau, tokens) in enumerate(rows, start=2):
    sheet.cell(row=r_idx, column=1, value=quarter)
    sheet.cell(row=r_idx, column=2, value=mau)
    sheet.cell(row=r_idx, column=3, value=tokens)
    # Derived ARR — references inputs B/C and the Assumptions cell $G$1
    # ($-locked so a fill-down doesn't drift). Never hard-code 0.85 in
    # the formula — putting it in $G$1 lets the user run sensitivity by
    # editing one cell instead of every row.
    sheet.cell(row=r_idx, column=4, value=f"=B{r_idx}*C{r_idx}*$G$1")

title = sheet.cell(row=1, column=1)
title.font = Font(bold=True, color="000000")
title.fill = PatternFill("solid", start_color="DDEBF7")
title.alignment = Alignment(horizontal="center")

for letter, width in zip("ABCDEFG", (10, 12, 14, 14, 4, 12, 8)):
    sheet.column_dimensions[letter].width = width

book.defined_names["MAU_Forecast_Range"] = DefinedName(
    name="MAU_Forecast_Range",
    attr_text="MAU_Forecast!$A$1:$D$4",
)

book.save("mau_forecast.xlsx")
```

The four building blocks — header row, data rows, headline styling,
named range — are the four things almost every output workbook needs.
Note the take-rate lives in `$G$1` (the Assumptions cell), not embedded
in the formula as a literal `0.85`; this is the rule from
[`conventions-guide.md`](conventions-guide.md) §4.1 in action.

## 2. Editing an existing workbook (openpyxl)

Open with `load_workbook`, mutate, save back. `data_only=False` (the
default) is the only safe mode for read-modify-write — see §7.

```python
from openpyxl import load_workbook

book = load_workbook("mau_forecast.xlsx")
sheet = book.active                          # also: book["MAU_Forecast"]

for name in book.sheetnames:
    print("discovered sheet:", name)

sheet.insert_rows(idx=3, amount=1)
sheet.delete_cols(idx=4, amount=1)
sheet.cell(row=3, column=1, value="2025Q4")

detail = book.create_sheet(title="Detail", index=1)
detail.cell(row=1, column=1, value="Cohort")
detail.cell(row=1, column=2, value="Retention")

book.remove(book["Sheet1"]) if "Sheet1" in book.sheetnames else None
book.save("mau_forecast_v2.xlsx")
```

Insertions and deletions shift formulas referencing the moved range —
re-run `scripts/recalc.py` after every structural edit and resolve any
`#REF!` flagged in the JSON.

## 3. Cell styling deep dive

```python
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

cell = sheet["B2"]
cell.font      = Font(name="Calibri", size=11, bold=True, color="000000")
cell.fill      = PatternFill("solid", start_color="FFF2CC")
cell.alignment = Alignment(horizontal="right", vertical="center", wrap_text=True)
cell.border    = Border(
    left=Side(style="thin", color="999999"), right=Side(style="thin", color="999999"),
    top=Side(style="medium", color="333333"), bottom=Side(style="medium", color="333333"),
)
cell.number_format = "¥#,##0.00;(¥#,##0.00);-"
```

Styles are immutable per cell — a new `Font(...)` replaces the previous
one, not merge fields. Build one `Font` / `Fill` / `Border` and assign
the same instance across many cells.

## 4. Conditional formatting

```python
from openpyxl.formatting.rule import (
    ColorScaleRule, DataBarRule, FormulaRule,
)
from openpyxl.styles import PatternFill

# 4.1 Color scale — gradient by value, useful for cohort heatmaps
sheet.conditional_formatting.add(
    "B2:B100",
    ColorScaleRule(start_type="min", start_color="F8696B",
                   mid_type="percentile", mid_value=50, mid_color="FFEB84",
                   end_type="max", end_color="63BE7B"),
)

# 4.2 Data bar — inline bar inside the cell
sheet.conditional_formatting.add(
    "C2:C100",
    DataBarRule(start_type="min", end_type="max", color="638EC6"),
)

# 4.3 Custom formula — highlight rows where ARR drops vs prior period
fill_red = PatternFill("solid", start_color="FFC7CE")
sheet.conditional_formatting.add(
    "A2:D100",
    FormulaRule(formula=["$D2<$D1"], fill=fill_red),
)
```

Custom formulas use the **active row** as the reference (`$D2<$D1` =
"current row's D less than previous row's D"); double-check by
extending the range manually in Excel before delivery.

## 5. Charts

```python
from openpyxl.chart import BarChart, LineChart, Reference

# 5.1 BarChart — quarterly MAU comparison
bar = BarChart()
bar.title = "MAU by Quarter"
bar.y_axis.title, bar.x_axis.title = "MAU (mm)", "Quarter"
data   = Reference(sheet, min_col=2, min_row=1, max_col=2, max_row=5)
labels = Reference(sheet, min_col=1, min_row=2, max_row=5)
bar.add_data(data, titles_from_data=True)
bar.set_categories(labels)
sheet.add_chart(bar, "F2")

# 5.2 LineChart — ARR trend
line = LineChart()
line.title = "ARR Trend"
arr_ref = Reference(sheet, min_col=4, min_row=1, max_col=4, max_row=5)
line.add_data(arr_ref, titles_from_data=True)
line.set_categories(labels)
sheet.add_chart(line, "F18")
```

`Reference` ranges include the header row when `titles_from_data=True`;
forgetting that flag is the most common source of "the legend says
Series 1 instead of MAU".

## 6. xlsxwriter for write-only throughput

Faster than openpyxl on six-figure-row writes; cannot reopen what it
wrote. Use it when the workbook is the **terminal** output of a
pipeline.

```python
import xlsxwriter

book = xlsxwriter.Workbook("big_table.xlsx")
sheet = book.add_worksheet("Tokens")

bold       = book.add_format({"bold": True, "bg_color": "#DDEBF7", "align": "center"})
money      = book.add_format({"num_format": "¥#,##0;(¥#,##0);-"})
input_blue = book.add_format({"font_color": "#0000FF"})                  # §5.2 inputs

# Assumptions block (E1) — ¥ per million tokens; flip this one cell to
# re-run the model. Inputs carry input_blue per conventions §5.2.
sheet.write(0, 3, "Price (¥/Mtok)", bold)
sheet.write_number(0, 4, 1.20, input_blue)

headers = ["Date", "Tokens (Mtok)", "Revenue (¥mm)"]
sheet.write_row(0, 0, headers, bold)
for r, (date, tokens) in enumerate(rows, start=1):
    sheet.write_string(r, 0, date)
    sheet.write_number(r, 1, tokens, input_blue)                          # raw input
    # Derived revenue — formula referencing tokens (B) and Price ($E$1).
    # NEVER pre-compute `tokens * 1.20` in Python and write_number it;
    # that ships a static snapshot the user cannot rerun. money carries
    # the default black font, so derived cells are §5.2-compliant.
    sheet.write_formula(r, 2, f"=B{r + 1}*$E$1", money)

# Footer total — also a formula, never a Python sum().
sheet.write_formula(len(rows) + 1, 2, f"=SUM(C2:C{len(rows) + 1})", money)
sheet.autofilter(0, 0, len(rows), len(headers) - 1)
sheet.freeze_panes(1, 0)
book.close()
```

Reuse the same `Format` object across cells — re-creating one per cell
inflates the file and slows the writer down by an order of magnitude.
xlsxwriter writes formulas just as cleanly as openpyxl
(`write_formula`); the throughput advantage is no excuse to skip them.

## 7. Read-modify-write loops — `data_only=True` is dangerous

`load_workbook(..., data_only=True)` returns the **last cached
calculation** instead of the formula string. Saving such a workbook
permanently replaces every formula with its number.

```python
# WRONG — formulas vanish after save
book = load_workbook("model.xlsx", data_only=True)
book["Inputs"]["B2"] = 0.05
book.save("model.xlsx")                      # =SUM(...) replaced by numbers

# RIGHT — keep formulas, then re-run recalc.py to refresh cached values
book = load_workbook("model.xlsx")           # data_only defaults to False
book["Inputs"]["B2"] = 0.05
book.save("model.xlsx")
# subprocess: python scripts/recalc.py model.xlsx
```

Use `data_only=True` only when the workbook is **read-only** and you
need the cached numeric values for downstream analysis.

> **Reading back a workbook that just went through `recalc.py`.** Some
> source files force LibreOffice to rewrite their `<mergeCell>` XML in
> a form openpyxl cannot parse — `load_workbook` then raises
> `TypeError: expected <class 'int'>` from `cell_range.py` regardless
> of `data_only`. The file is fine; openpyxl's default parser is the
> bottleneck. Two readback paths sidestep it:
>
> ```python
> # easiest — streaming reader skips merged-cell parsing entirely.
> # Streaming mode rejects subscript access like ws["B4"].value;
> # use iter_rows() instead.
> book = load_workbook("model.xlsx", read_only=True, data_only=True)
> for row in book["Sheet"].iter_rows(values_only=True):
>     ...
>
> # escape hatch — when you also need formula strings, or want to
> # inspect the zip without instantiating openpyxl objects, use the
> # raw-XML pattern in §11 (same technique recalc.py uses internally)
> ```
>
> See `docs/recalc-guide.md` §9 for why LibreOffice triggers the bug
> and how `recalc.py` already handles its own internal scan.

## 8. Performance tips

- `read_only=True` streams sheets row-by-row — drop into it for any
  input file above ~100k rows.
- `write_only=True` does the inverse for outputs; with `WriteOnlyCell`
  it keeps memory flat while writing million-row sheets.
- Iterate with `sheet.iter_rows(min_row=2, values_only=True)` instead
  of nested `cell.value` access — values-only iteration skips the
  per-cell object construction.
- Avoid `sheet.cell(row=r, column=c).value = x` inside hot loops; the
  attribute access has measurable overhead on large workbooks.

## 9. Merged-cells gotcha

`iter_rows()` returns the merged region's anchor cell at the top-left
position and `None` everywhere else. Flattening the sheet into a
DataFrame loses the merged value silently:

```python
book = load_workbook("merged.xlsx")
sheet = book.active

for row in sheet.iter_rows(min_row=1, max_row=3, values_only=True):
    print(row)
# (None, 'Q3 Summary', None, None)   <- only the anchor cell has the value
# (None, None, None, None)
# ('SKU', 'Units', 'Price', 'Total')
```

Unmerge before processing, broadcast the anchor value into the cleared
cells, then re-merge if layout matters:

```python
ranges = [str(r) for r in sheet.merged_cells.ranges]
for rng in ranges:
    top, left, bottom, right = sheet[rng].bounds
    anchor = sheet.cell(row=top, column=left).value
    sheet.unmerge_cells(rng)
    for r in range(top, bottom + 1):
        for c in range(left, right + 1):
            sheet.cell(row=r, column=c, value=anchor)
```

## 10. Shared-strings index drift gotcha

The `.xlsx` zip stores text values in `xl/sharedStrings.xml` and
references them by integer index from `xl/worksheets/sheetN.xml`.
Manually editing the inner XML (e.g. string-replacing a value with a
shorter one) reorders the dictionary on the next read and silently
mis-renders every cell on the sheet.

If a workbook arrives with mangled text, do **not** keep editing the
XML — load it through openpyxl once and resave. openpyxl rebuilds the
shared-strings table from cell values, restoring indexing invariants:

```python
book = load_workbook("mangled.xlsx")
book.save("rebuilt.xlsx")                    # shared-strings reindexed
```

Then run `scripts/recalc.py rebuilt.xlsx` to verify no `#VALUE!` /
`#REF!` showed up after the rewrite.

## 11. Inject cached values without LibreOffice recalc

Excel and LibreOffice compute the cached `<v>` next to each formula on
their own first open; spreadsheet readers that ignore stored formulas
(some viewers, some pipelines, the openpyxl `data_only=True` path) only
ever see the cached value. When `scripts/recalc.py` is unavailable —
sandboxed environment, no LibreOffice on disk, the rare workbook the
fallback in `recalc-guide.md` §9 cannot rescue either — you can write
the cached value yourself by editing the `<v>` element next to each
`<f>` element you just emitted with openpyxl.

```python
import os, re, shutil, tempfile, zipfile

def inject_cached_values(xlsx_path, sheet_name, cell_values):
    """Write `<v>computed</v>` next to the `<f>...</f>` of each cell.

    `cell_values` is a dict like `{"B4": 722589, "B5": 26.2}`. The
    function rewrites the workbook in place, preserving every other
    archive entry byte-for-byte.
    """
    with zipfile.ZipFile(xlsx_path) as zin:
        wb_xml   = zin.read("xl/workbook.xml").decode()
        rels_xml = zin.read("xl/_rels/workbook.xml.rels").decode()

        rid = re.search(
            rf'<sheet[^/]*name="{re.escape(sheet_name)}"[^/]*r:id="(rId\d+)"',
            wb_xml,
        ).group(1)
        target = None
        for rel in re.finditer(r"<Relationship\b[^>]*/?>", rels_xml):
            if f'Id="{rid}"' in rel.group(0):
                raw = re.search(r'Target="([^"]+)"', rel.group(0)).group(1)
                raw = raw.lstrip("./").lstrip("/")
                target = raw if raw.startswith("xl/") else f"xl/{raw}"
                break

        sheet_xml = zin.read(target).decode()
        for ref, value in cell_values.items():
            pattern = (
                rf'(<c r="{re.escape(ref)}"[^>]*>)'
                rf'(<f[^>]*>[^<]*</f>)'
                rf'(<v\s*/>|<v[^>]*>[^<]*</v>)?'
                rf'(</c>)'
            )
            sheet_xml, count = re.subn(
                pattern, rf"\1\2<v>{value}</v>\4", sheet_xml,
            )
            assert count == 1, f"no formula cell found for {ref}"

        names = zin.namelist()
        infos = {info.filename: info for info in zin.infolist()}
        payload = {name: zin.read(name) for name in names}
        payload[target] = sheet_xml.encode()

    fd, tmp = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            zout.writestr(infos[name], payload[name])
    shutil.move(tmp, xlsx_path)


# Usage after openpyxl wrote the formulas:
inject_cached_values(
    "summary.xlsx",
    "Executive_Summary",
    {"B4": 722589, "B5": 26.2, "B6": 19.7, "B7": 44.3, "B8": 76.5},
)
```

The pattern matches both the openpyxl-written `<v />` self-closing form
and the populated `<v>...</v>` form, and refuses to touch a cell that
does not already contain an `<f>` (the assertion guards against typos in
the ref). The asserted count of `1` is intentional — silently rewriting
nothing is the failure mode that ships an empty workbook.

Use this only as a substitute for `scripts/recalc.py`. When LibreOffice
is reachable, the recalc path is still preferable because it computes
every formula in the workbook (not just the ones you happen to enumerate
in `cell_values`) and surfaces the seven error tokens.

