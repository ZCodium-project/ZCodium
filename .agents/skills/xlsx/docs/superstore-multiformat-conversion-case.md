# Case: Superstore Excel → CSV / JSON / printable PDF + CSV → Excel verification

## When this case applies

Use this case when a user provides an Excel workbook and asks for a multi-format data conversion package, especially with Superstore-like tabular data and acceptance criteria such as:

- Excel → CSV with UTF-8 encoding and normalized `YYYY-MM-DD` dates;
- Excel → JSON as a standard JSON array with correct primitive types;
- Excel → PDF for a 10k-row table, A4 landscape, all columns visible, repeated header on every page;
- CSV → Excel reverse validation with dates / numbers / text restored to proper Excel types;
- explicit requirement that CSV → Excel is generated through direct OOXML / XML-template packaging rather than a full `openpyxl` read-write pass;
- explicit requirement that PDF is generated through the pdf HTML→PDF route, not screenshot-style conversion.

This case strengthens X8 and fuses pdf P9. It is for data-preserving exports, not analytical dashboards: do not aggregate, sample, summarize, or drop rows.

## Original user intent and acceptance criteria

Source file from the successful run:

`Sample_Superstore (3).xlsx`

User intent:

> 完成以下Excel数据格式转换（使用Superstore数据集）：
> 1. Excel → CSV：UTF-8编码，日期统一YYYY-MM-DD格式
> 2. Excel → JSON：标准JSON数组，数据类型正确
> 3. Excel → PDF：横向打印，表头每页重复
> 4. CSV → Excel（逆向验证）：导回后数据类型正确

Acceptance criteria:

1. PDF 中所有列可见，无截断。
2. 数据量完整，总行数与原 Excel 一致（约 9994 行 + 表头）。
3. 使用横向打印布局: `@page { size: A4 landscape }`。
4. 排版无溢出、无乱码。
5. CSV → Excel 用 XML template / direct OOXML package 方式生成，不使用 openpyxl 全量读写。
6. 日期、数字、文本类型与原 Excel 一致。
7. JSON 数字字段不能变成字符串。
8. PDF 通过 HTML→PDF renderer 生成；不使用 `convert_file` / 截图式转换。
9. 不使用 CSS counters，不使用装饰性 emoji。
10. 表头每页重复，分页合理，无断行，视觉风格以数据密集表格为主。

## Source inspection and parsing steps

Always inspect workbook structure before transforming. Superstore normally has `Orders`, `People`, and `Returns`; the conversion target is usually `Orders` unless the user says otherwise.

```bash
python3 - <<'PY'
from openpyxl import load_workbook
from pathlib import Path
p = Path('<INPUT_XLSX>')
wb = load_workbook(p, read_only=True, data_only=True)
print('sheets', wb.sheetnames)
ws = wb['Orders'] if 'Orders' in wb.sheetnames else wb[wb.sheetnames[0]]
print('target_sheet', ws.title)
print('max_row', ws.max_row, 'max_col', ws.max_column)
headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
print('headers', headers)
for r in range(2, min(ws.max_row, 4) + 1):
    print([ws.cell(r, c).value for c in range(1, ws.max_column + 1)])
PY
```

Expected evidence from the Superstore run:

- sheets: `['Orders', 'People', 'Returns']`
- target sheet: `Orders`
- `max_row 9995`, `max_col 21`
- date columns read as `datetime.datetime`
- numeric columns read as Python `int` / `float`

Use an explicit type map instead of guessing from CSV strings later:

```python
date_cols = {'Order Date', 'Ship Date'}
int_cols = {'Row ID', 'Postal Code', 'Quantity'}
float_cols = {'Sales', 'Discount', 'Profit'}
text_cols = set(headers) - date_cols - int_cols - float_cols
```

If a column is missing or renamed, build the map from source cell types and column names, then print the final map in the manifest. Do not silently coerce postal codes to floats.

## Transformation rules

There is no natural-language translation in this case. The “translation” layer is type and format normalization:

| Source concept | Output rule |
|---|---|
| Excel date cells | CSV/JSON: ISO `YYYY-MM-DD`; reverse XLSX: numeric Excel date serial with `yyyy-mm-dd` number format |
| Integer IDs / counts | CSV: decimal text; JSON: JSON number; reverse XLSX: numeric cell |
| Money / measures (`Sales`, `Profit`, `Discount`) | CSV: decimal text; JSON: JSON number; reverse XLSX: numeric cell with number/percent style |
| Text identifiers (`Order ID`, `Product ID`, customer names) | Keep exact string; do not trim meaningful punctuation |
| Unicode / CJK if present | write CSV/JSON/HTML with UTF-8 and `ensure_ascii=False` |
| Empty cells | CSV empty string, JSON `null`, reverse XLSX empty cell |

JSON serialization rule:

```python
json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
```

Do not use `default=str` as a substitute for type control when the acceptance criteria says “data types correct”; convert dates explicitly and preserve numbers as numbers.

## Reusable workflow

Set variables:

```bash
INPUT_XLSX="/path/to/Sample_Superstore.xlsx"
OUTPUT_DIR="/path/to/out"
mkdir -p "$OUTPUT_DIR"
```

### 1. Generate CSV, JSON, PDF HTML source, and XML-template XLSX

Use one deterministic Python driver. It may read the source workbook with `openpyxl` in streaming mode, but the reverse-validation XLSX must be written as a direct OOXML package (`zipfile` + XML parts), not via `Workbook.save()` over the CSV.

Core implementation pattern:

```python
import csv, json, html, zipfile
from pathlib import Path
from datetime import datetime, date
from openpyxl import load_workbook

src = Path(INPUT_XLSX)
out = Path(OUTPUT_DIR)
csv_path = out / 'superstore_orders_utf8.csv'
json_path = out / 'superstore_orders.json'
html_path = out / 'superstore_orders_print.html'
xlsx_path = out / 'superstore_orders_from_csv_verified.xlsx'
manifest_path = out / 'conversion_manifest.json'

wb = load_workbook(src, read_only=True, data_only=True)
ws = wb['Orders'] if 'Orders' in wb.sheetnames else wb[wb.sheetnames[0]]
headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]

# Explicit maps for Superstore; adapt only after source inspection.
date_cols = {'Order Date', 'Ship Date'}
int_cols = {'Row ID', 'Postal Code', 'Quantity'}
float_cols = {'Sales', 'Discount', 'Profit'}
records = []

with csv_path.open('w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(headers)
    for row in ws.iter_rows(min_row=2, values_only=True):
        rec, csv_row = {}, []
        for h, v in zip(headers, row):
            if h in date_cols:
                iso = v.date().isoformat() if isinstance(v, datetime) else (v.isoformat() if isinstance(v, date) else '')
                rec[h] = iso or None
                csv_row.append(iso)
            elif h in int_cols:
                rec[h] = None if v in (None, '') else int(v)
                csv_row.append('' if v in (None, '') else int(v))
            elif h in float_cols:
                rec[h] = None if v in (None, '') else float(v)
                csv_row.append('' if v in (None, '') else float(v))
            else:
                text = '' if v is None else str(v)
                rec[h] = text
                csv_row.append(text)
        records.append(rec)
        writer.writerow(csv_row)

json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
```

For the reverse XLSX, write a minimal OOXML zip:

- `[Content_Types].xml`
- `_rels/.rels`
- `xl/workbook.xml`
- `xl/_rels/workbook.xml.rels`
- `xl/worksheets/sheet1.xml`
- `xl/styles.xml`
- `docProps/core.xml`
- `docProps/app.xml`

Worksheet XML rules:

- Use inline strings (`t="inlineStr"`) for text; no sharedStrings part is required.
- Write dates as Excel serial numbers, using the 1900 date system offset: `(date - date(1899, 12, 30)).days`.
- Apply a custom `yyyy-mm-dd` number format to date cells.
- Add `<dimension ref="A1:U9995"/>` so streaming readers know sheet size.
- Freeze header row and set column widths.
- Add `<autoFilter ref="A1:U9995"/>`.

Minimal cell writer:

```python
def col_letter(n):
    s = ''
    while n:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s

def esc(s):
    return html.escape(str(s), quote=False)

def cell_xml(r, c, value, style=0, cell_type=None):
    ref = f'{col_letter(c)}{r}'
    s_attr = f' s="{style}"' if style else ''
    if value is None or value == '':
        return f'<c r="{ref}"{s_attr}/>'
    if cell_type == 'str':
        return f'<c r="{ref}" t="inlineStr"{s_attr}><is><t>{esc(value)}</t></is></c>'
    return f'<c r="{ref}"{s_attr}><v>{value}</v></c>'
```

Keep the full driver in the task workspace when running; the case intentionally documents the structure rather than storing a generated XLSX artifact.

### 2. Build editable HTML source for the PDF

Do not store generated PDFs as case artifacts. Store and deliver the HTML source that reproduces the PDF.

For 10k-row wide tables, prefer HTML→PDF over LibreOffice conversion when all columns must be visible and repeat headers are mandatory. Use dense tabular styling, wrapping text instead of truncating it.

Required CSS pattern:

```html
<style>
@page { size: A4 landscape; margin: 7mm 5mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; font-family: Arial, "PingFang SC", sans-serif; color: #111827; }
body { font-size: 4.6pt; line-height: 1.10; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th, td {
  border: 0.20pt solid #c7d2e5;
  padding: 0.8pt 1.0pt;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: normal;
  hyphens: auto;
}
th { background: #1f4e78; color: #ffffff; font-weight: 700; text-align: left; }
tbody tr:nth-child(even) td { background: #f7f9fc; }
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
```

Do not use:

- `text-overflow: ellipsis` or visible `…` when the acceptance criterion says no truncation;
- CSS counters for headings / captions / row labels;
- decorative emoji;
- screenshot stitching.

Column widths must sum to 100%. In the successful Superstore run the widest columns were `Product Name`, `Order ID`, `Customer Name`, `Product ID`, `City`, and `State`; allocate width accordingly and keep numeric columns narrow.

### 3. Render PDF via pdf HTML renderer

```bash
PDF_SKILL="{{DATA_DIR}}/.builtin-skills/pdf"
bash "$PDF_SKILL/scripts/make.sh" render \
  --in "$OUTPUT_DIR/superstore_orders_print.html" \
  --out "$OUTPUT_DIR/superstore_orders_landscape.pdf" \
  --format A4 --landscape --wait 1000 --scale 1
```

Expected success line:

```json
{"status":"ok","out":".../superstore_orders_landscape.pdf","format":"A4","landscape":true}
```

## Asset and layout preservation strategy

This workflow preserves data rather than visual workbook styling:

- Source rows are streamed in full; never use `head()`, `sample()`, or a preview subset unless the user explicitly requests preview mode.
- Header order is exactly the source order.
- CSV/JSON values are generated from typed Excel cell values, not re-parsed from formatted display strings.
- The PDF is a dense table, not a dashboard redesign. Use a title and one metadata line only; keep the rest of the page area for rows.
- Long text wraps inside cells; rows are protected from page breaks with `page-break-inside: avoid`.
- `thead { display: table-header-group; }` is the repeated-header mechanism.
- The HTML source is the reproducible PDF artifact; do not check generated PDF into the skill.

## Verification commands and expected evidence

Run these checks before delivery.

### CSV / JSON / reverse XLSX

```bash
python3 - <<'PY'
import csv, json, re, zipfile
from pathlib import Path
from openpyxl import load_workbook
out = Path('<OUTPUT_DIR>')
csv_path = out / 'superstore_orders_utf8.csv'
json_path = out / 'superstore_orders.json'
xlsx_path = out / 'superstore_orders_from_csv_verified.xlsx'

with csv_path.open('r', encoding='utf-8', newline='') as f:
    reader = csv.DictReader(f)
    rows = list(reader)
    headers = reader.fieldnames
print('csv_rows', len(rows), 'csv_cols', len(headers))
print('csv_dates_yyyy_mm_dd', all(
    re.fullmatch(r'\d{4}-\d{2}-\d{2}', r['Order Date']) and
    re.fullmatch(r'\d{4}-\d{2}-\d{2}', r['Ship Date'])
    for r in rows
))

records = json.loads(json_path.read_text(encoding='utf-8'))
print('json_records', len(records), 'json_is_array', isinstance(records, list))
print('json_numeric_types', type(records[0]['Row ID']).__name__, type(records[0]['Sales']).__name__, type(records[0]['Quantity']).__name__, type(records[0]['Discount']).__name__)
print('json_date_value', records[0]['Order Date'])

wb = load_workbook(xlsx_path, read_only=True, data_only=True)
ws = wb.active
count = sum(1 for _ in ws.iter_rows(values_only=True))
vals = [ws.cell(2, c).value for c in range(1, 22)]
print('xlsx_rows_counted', count, 'xlsx_cols', ws.max_column)
print('xlsx_first_types', [type(v).__name__ for v in vals])
print('xlsx_date_number_format', ws.cell(2, 3).number_format, ws.cell(2, 4).number_format)

with zipfile.ZipFile(xlsx_path) as z:
    names = set(z.namelist())
print('xlsx_parts_ok', all(p in names for p in ['xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/workbook.xml']))
PY
```

Expected evidence from the successful run:

```text
csv_rows 9994 csv_cols 21
csv_dates_yyyy_mm_dd True
json_records 9994 json_is_array True
json_numeric_types int float int float
json_date_value 2017-11-08
xlsx_rows_counted 9995 xlsx_cols 21
xlsx_first_types ['int', 'str', 'datetime', 'datetime', ... 'float', 'int', 'float', 'float']
xlsx_date_number_format yyyy-mm-dd yyyy-mm-dd
xlsx_parts_ok True
```

### PDF

```bash
pdfinfo "$OUTPUT_DIR/superstore_orders_landscape.pdf"
python3 - <<'PY'
import subprocess
p = '<OUTPUT_DIR>/superstore_orders_landscape.pdf'
text = subprocess.check_output(['pdftotext', '-layout', p, '-'], text=True, errors='replace')
headers = ['Row ID','Order ID','Order Date','Ship Date','Ship Mode','Customer ID','Customer Name','Segment','Country','City','State','Postal Code','Region','Product ID','Category','Sub-Category','Product Name','Sales','Quantity','Discount','Profit']
print('text_chars', len(text))
print('all_headers_present', all(h in text for h in headers))
print('header_occurrences_Row_ID', text.count('Row ID'))
print('contains_ellipsis_char', '…' in text)
print('contains_first_order', 'CA-2017-152156' in text)
print('page_breaks', text.count('\f'))
PY
```

Expected evidence from the successful run:

```text
Pages: 177
Page size: 842.88 x 595.92 pts (A4)
all_headers_present True
header_occurrences_Row_ID 177
contains_ellipsis_char False
contains_first_order True
```

Also inspect the HTML source mechanically:

```bash
python3 - <<'PY'
from pathlib import Path
html = Path('<OUTPUT_DIR>/superstore_orders_print.html').read_text(encoding='utf-8')
print('html_has_landscape_css', '@page { size: A4 landscape' in html)
print('html_repeats_header', 'display: table-header-group' in html)
print('html_no_css_counters', 'counter(' not in html and 'counter-increment' not in html)
print('html_no_ellipsis_css', 'text-overflow' not in html)
PY
```

## Common pitfalls and recovery steps

| Pitfall | Symptom | Recovery |
|---|---|---|
| Using `pandas.to_json` directly after `read_excel` | dates become epoch milliseconds or unexpected strings | Build records explicitly; dates → ISO strings, numbers → int/float |
| Using `default=str` for JSON without type review | numeric-looking values may hide type errors | Print `type(records[0][...]).__name__` for representative fields |
| `text-overflow: ellipsis` in PDF HTML | `pdftotext` shows `…`, acceptance says truncation | Remove ellipsis CSS; allow wrapping with `overflow-wrap:anywhere` |
| LibreOffice XLSX→PDF ignores fit/repeated headers | page size/orientation or header repetition wrong | Use HTML→PDF route with `@page A4 landscape` and `thead` repeat |
| Rows split across pages | product names / addresses split awkwardly | Add `tr { page-break-inside: avoid; break-inside: avoid; }`; reduce font slightly if needed |
| PDF too wide / columns missing | some headers absent in `pdftotext` or visual preview | Use `table-layout: fixed`, explicit `<colgroup>`, A4 landscape, narrow numeric columns |
| Reverse XLSX dates read as integers | no date style or wrong style index | Add custom `numFmt` `yyyy-mm-dd`, apply it to date cells, verify with openpyxl |
| `ws.max_row` is `None` in streaming verification | missing `<dimension>` in generated sheet XML | Insert `<dimension ref="A1:U9995"/>` before `<sheetViews>` |
| Accidental openpyxl full read/write for CSV→XLSX | violates skill standard even if file opens | Generate direct OOXML package with `zipfile` and worksheet XML |
| Using CSS counters / emoji | violates PDF generation standard | Use literal text labels and plain headings only |

## Final reusable workflow checklist

1. Load `xlsx` and `pdf`.
2. Match X8 (multi-format spreadsheet conversion) and P9 (tabular → printable PDF); for strict HTML→PDF requirement, use this case instead of LibreOffice conversion.
3. Inspect workbook sheets, target sheet, row/column count, headers, sample typed values.
4. Declare type map for date / integer / float / text columns.
5. Stream source rows once to CSV UTF-8 and typed JSON records.
6. Generate reverse XLSX via direct OOXML XML parts from the CSV; use inline strings, numeric dates, styles, dimension, widths, and autofilter.
7. Generate editable HTML table source with A4 landscape `@page`, repeated `thead`, no counters, no emoji, no ellipsis truncation.
8. Render with `bash pdf/scripts/make.sh render --format A4 --landscape`.
9. Verify CSV row count + date regex, JSON array + primitive types, XLSX row count + cell types + date number format, PDF page size + header repetition + all headers present + no ellipsis.
10. Deliver files and evidence. Store the HTML source as the reusable PDF artifact; do not store generated PDFs in the skill.
