# conventions-guide — financial-model conventions for Excel outputs

> The full rationale behind the tables in [`SKILL.md`](../SKILL.md) §5 —
> color coding, number formatting, hardcode source documentation, formula
> construction discipline, and template-preservation rules. Anything that
> reviewers would otherwise ask "why this and not that" goes here so the
> SKILL stays a quick scan and the deeper material is one click away.

## 1. Color coding

Default palette unless the user or the existing template overrides it.
Black is intentionally listed first: a reviewer scanning the workbook
should see one color signaling "this is computed", one signaling "this
is an input I can change", and three signaling links of increasing
risk. The anti-pattern column captures the way each color is most often
misused in the wild.

| Color | RGB | Meaning | Anti-pattern |
|---|---|---|---|
| Black | `0,0,0` | Every formula and computed result | Setting `=A1+B1` to blue makes the reviewer think it is a manual input |
| Blue | `0,0,255` | Hard-coded inputs and scenario assumptions | Setting `=Sheet2!A1` (a sheet link) to blue makes it look like an assumption |
| Green | `0,128,0` | Same-workbook cross-sheet links | Setting `=[Other.xlsx]Sheet1!A1` to green hides the external dependency signal |
| Red | `255,0,0` | Cross-file external links | Setting same-sheet `=A1` to red implies a fake external dependency |
| Yellow (fill) | `255,255,0` background | Critical assumptions awaiting review | Coloring every cell yellow drowns out the cells that actually need a second look |

Why "Black first": when a reviewer opens a model the first thing they
look for is whether any formula was accidentally typed as a number.
Putting black at the top of the legend mirrors that scan order.

## 2. Number formatting

Default formats unless the existing template specifies otherwise.
"Rationale" is what to point at when a reviewer asks why a column looks
the way it does.

| Type | Format | Rationale |
|---|---|---|
| Year | text (`"FY2025"`) | Numeric `2025` gets thousands-separated to `2,025` by the corporate template; storing as text disables the auto-format |
| Currency | `$#,##0` or `¥#,##0` with the unit (`mm` / `bn` / `k`) in the header | The unit belongs in one place per column, not repeated on every cell — header `ARR (¥mm)` keeps the cells uncluttered |
| Zero | `"$#,##0;($#,##0);-"` (or the `0.0%` equivalent) | A literal `0` reads as data; an em-dash reads as "zero by intent" — separates a missing value from a real zero |
| Percentage | `0.0%` | One decimal is enough for reviewer scanning; `0.00%` reads as false precision, `0%` loses sign on small movements |
| Multiple | `0.0x` | Used for valuation multiples (EV/EBITDA, P/S, P/E) and ratio-style headers like `Token unit price 1.2x` |
| Negative | `(123)` (parentheses) | Accounting convention; minus signs blend into table grids and read as dashes at small font sizes |
| Hardcode | `Source: …` annotation in the next column or as a cell comment (see §3) | Reviewer can audit every input back to its source without scrolling around |

MiniMax-flavored sample headers: `ARR (¥mm)` / `Tokens (bn)` / `MAU
(mm)` / `Token unit price 1.2x` / `MAU YoY 0.0%`. Keep the unit in the
header, not in the cell.

## 3. Hardcode `Source:` documentation

Every hard-coded number should carry its provenance — either as a cell
comment or as a string in the adjacent column. The grammar is fixed so
downstream automation can grep for it:

```
Source: <system or document>, <date>, <locator>, <URL optional>
```

Five reference examples, spanning the source types reviewers see most:

| Source type | Example string |
|---|---|
| 10-K filing | `Source: AAPL 10-K FY2024, 2024-11-01, "Net sales by segment" table, https://www.sec.gov/...` |
| 10-Q filing | `Source: AAPL 10-Q FY2025 Q2, 2025-05-02, "Operating expenses" line 12` |
| Internal BI dashboard | `Source: MiniMax internal BI - MAU Dashboard, 2025-09-30, "moonshot-mau" view` |
| Interview transcript | `Source: User interview INT-2025-117, 2025-09-12, interviewee Z, page 4` |
| Market data terminal | `Source: Wind Terminal, 2025-08-15, AAPL.O closing price` / `Source: Bloomberg, 2025-08-15, AAPL US Equity PX_LAST` |

Date format is ISO `YYYY-MM-DD`; the locator must let a reader find the
exact cell in the source within ~30 seconds.

## 4. Formula construction rules

**The foundational rule: every computed value is a formula, not a
literal number.** Anything derivable from other cells — totals,
averages, ratios, percent changes, growth projections, lookups,
cross-sheet references — must be written as a live `=…` formula. Hard
numbers belong in §3 inputs only. Pasting a pre-computed total
(`125_430` instead of `=SUM(B2:B12)`) silently breaks the workbook
the moment any input cell changes; recalc cannot detect this because
the literal value evaluates fine — it just no longer reflects the
data. The four sub-rules below build on top of this principle and add
checks the model passes **before** running `scripts/recalc.py`.
recalc only catches errors that have already crystallised into a
`#REF!` / `#DIV/0!` marker; these checks catch the class of bugs that
produce a *wrong but not erroring* number.

**This rule applies regardless of how the value was computed during
authoring.** Even if pandas / polars / numpy / a one-line list
comprehension already produced the number in Python, the cell must
still hold the `=` formula referencing the source cells, not the
pre-computed result. The most common slip is loading raw data with
pandas, computing a derived column (`df["arr"] = df["mau"] *
df["price"]`), and writing the whole frame back with
`df.to_excel(...)`; that ships static numbers and undoes every
benefit of delivering a spreadsheet over a CSV. The right pattern is
to write only the **input columns** with pandas (or skip pandas
entirely and use openpyxl for everything), then emit each derived
column as `=B2*C2` etc. on the openpyxl side.

### 4.1 Assumption placement

All adjustable inputs live in a single dedicated **Assumptions** block
(usually a leading sheet or a clearly headlined region of the main
sheet). Downstream formulas reference these cells with `$`-locked
addresses so a fill-down does not silently skip them.

```
WRONG:  =B5 * 1.05                            // 5% growth hard-coded
RIGHT:  =B5 * (1 + $B$6)                      // 5% growth lives in $B$6 (Assumptions)
```

Sensitivity analysis (changing one assumption and watching the model
react) is impossible if the assumption is buried inside a formula.

### 4.2 Off-by-one sanity check

Every range in a `SUM`, `AVERAGE`, `COUNTIF`, etc. should be counted
literally. `SUM(B2:B12)` covers eleven rows (`12 - 2 + 1`), not ten.
The most common bug is summing only the first ten rows of an eleven-row
table because the model author counted the gap rather than the cells.

Quick check: open the formula bar, click into the range reference,
LibreOffice highlights the cells — confirm the highlight matches the
data block.

### 4.3 Boundary value testing

Before delivery, replace the lead inputs with edge cases and recalc:

| Input | Why test |
|---|---|
| `0` | Catches `#DIV/0!` and "any percentage of zero is still zero" semantics |
| Negative | Catches `LOG(<0)`, `SQRT(<0)`, and IRR convergence failures |
| Very large | Catches integer overflow in xlsxwriter and float underflow in `LOG10` chains |
| `NaN` (blank) | Catches `IFERROR` gaps and pandas → openpyxl conversion losses |
| Empty string | Catches `VALUE("")` failures and silent string concatenation |

Run `scripts/recalc.py` after each substitution. A real `errors_found`
JSON is the cheapest signal — far cheaper than a reviewer noticing a
silently-wrong percentile column three days later.

### 4.4 Circular reference avoidance

LibreOffice's `calculateAll()` fails loudly on circular references —
`recalc.py` will surface a `Circular reference detected` JSON before
ever returning a `total_formulas` count. Pre-check with openpyxl
before saving any model that wires inputs back into outputs:

```python
from openpyxl import load_workbook

book = load_workbook("model.xlsx")
seen = set()
for sheet in book.worksheets:
    for row in sheet.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith("="):
                seen.add(f"{sheet.title}!{cell.coordinate}")
# Then walk references with a graph library (e.g. networkx) to find cycles.
```

Iteration budget should always be the result of an explicit decision —
never leave "Iterative calculation" enabled by default.

## 5. Preserve existing templates

When updating someone else's template, **observe before edit**. Walk
the checklist below before changing a single cell:

- **Colors** — sample the current font / fill / border colors and
  reuse the exact RGB triplets, even if they violate this skill's
  defaults.
- **Column widths** — note the existing widths; resizing for "tidiness"
  always breaks something downstream (a chart, a print layout, a
  conditional format range).
- **Fonts** — if the template uses 宋体 / SimSun / a custom corporate
  font, do not switch to Calibri.
- **Merged cells** — record every merged region before mutating the
  sheet (see [`create-edit-guide.md`](create-edit-guide.md) §9).
- **Number formats** — copy the existing format string verbatim;
  reformatting a cell will replace it.
- **Conditional formatting** — list the rules with `for cf in
  sheet.conditional_formatting:` before editing the range; insertions
  shift the rule's anchor.

Customer template conventions always override this skill's defaults.

## 6. Code style for Python operating Excel

These rules apply to the Python that drives openpyxl / xlsxwriter, not
to the Excel files themselves.

- **No tutorial comments.** Comments explain *why*, not *what* — the
  reader knows what `book.save("foo.xlsx")` does.
- **No `print` debugging in committed code.** Use `logging.debug` or
  return values; `print` lines pollute downstream stdout that callers
  parse for JSON.
- **Business-named variables.** `book` / `sheet` / `frame` for the
  workbook / worksheet / DataFrame. The terse `wb` / `ws` / `df`
  reads as scratch-pad code; the full names match the financial-model
  vocabulary the reviewer is already in.
- **List comprehensions over manual `for` accumulators** when the body
  is a single expression — keeps the code at one screen.

## 7. Cell comment style

For the comments inside the workbook (right-click → Insert Comment):

- **Never use ALL CAPS.** Reviewers scanning the thumbnail interpret
  all-caps as an error warning, even when the content is benign.
- **Font size 9–10 pt.** Smaller is unreadable on retina displays;
  larger crops the comment box and looks shouty.
- **Cap at ~200 characters.** If the rationale is longer, link to a
  shared doc or memo (`See: BI/MAU forecast methodology, 2025-09`)
  rather than pasting the full text into the cell.
