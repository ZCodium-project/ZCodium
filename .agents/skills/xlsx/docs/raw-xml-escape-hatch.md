# Raw-XML Escape Hatch

> Distilled from spreadsheet interoperability lessons; supersedes the
> deprecated legacy `xlsx` skill bundle. The library-first
> workflow in `SKILL.md` covers >90% of edits — this doc is for the residual.

`openpyxl` round-trips real-world workbooks far better than its detractors
claim: charts, conditional formatting, named ranges, merged cells, frozen
panes, and (with `keep_vba=True`) VBA all survive a `load_workbook` →
`save` cycle. Reach for the surgical XML path **only** when the workbook
contains one of the six artefacts listed in §1; everything else stays in
the library cookbook.

---

## 1. When to fall back to raw XML

The following six categories are the genuine failure modes. In each case
`openpyxl` either drops the part on save or rewrites it with semantics
the consuming application no longer accepts.

| Artefact (path inside the .xlsx zip) | Where it appears | What `openpyxl` actually does on save | Why XML edit is the only safe path |
|---|---|---|---|
| `xl/vbaProject.bin` | Workbook saved as `.xlsm` with macros / form events | Dropped entirely unless the file was opened with `keep_vba=True`; even then any new sheet may shift cell-level event bindings | Binary VBA bytecode; one byte off and the macro project fails to load |
| `xl/pivotCaches/pivotCacheDefinition*.xml` + `xl/pivotTables/*.xml` | Pivot tables built from worksheet ranges or external data | Pivot table objects are dropped; pivot caches lose `<cacheSource>` ref tracking | The cache and the table are tightly coupled — editing one without the other corrupts the pivot |
| `xl/slicers/*.xml` (+ `xl/slicerCaches/*.xml`) | Slicers wired to a pivot or table | Slicer XML is silently removed; pivot still loads but UI filter is gone | Slicers reference pivot cache IDs by GUID; rewriting the parts without preserving GUIDs breaks the binding |
| `xl/connections.xml` | Workbooks with external data connections (Power Query, ODBC, OLAP) | Connection node is dropped; data refresh button does nothing | The connection definition is the only source of truth for the refresh URL / DSN |
| `xl/externalLinks/` (incl. `externalLink*.bin`) | `=[OtherBook.xlsx]Sheet!A1` style cross-file references | External link XML retained, `.bin` cache is lost; Excel re-prompts the user for every linked file on open | The `.bin` is a binary cache the format treats as opaque |
| Form controls / drawing shapes / advanced conditional formatting (color-scale + icon-set composites) | Workbooks with ActiveX form controls, `xl/drawings/drawing*.xml` shape art, multi-rule color-scale + icon-set on the same range | Form controls dropped (they live in `xl/activeX/` plus a paired `.bin`); shapes preserved but bound `linkedCell` may detach; multi-rule conditional formatting collapses into the first rule | None of these are first-class openpyxl objects |

Anything not in this table — column insertion, formula edits, style
changes, named-range tweaks, merged-cell expansion, chart series ranges
(via `openpyxl.chart`), simple conditional formatting (`openpyxl.formatting`)
— belongs in the library cookbook (see `SKILL.md` §3 and
`docs/create-edit-guide.md`).

---

## 2. The escape-hatch toolchain

Two scripts live at `scripts/office/` and are shared with the docx /
pptx skills (the OOXML zip layout is identical for all three formats):

| Script | Role | Notes |
|---|---|---|
| `scripts/office/unpack.py` | Unzip into a working directory and pretty-print every `*.xml` / `*.rels` so diffs read cleanly | Prints an inventory + a warning when high-risk parts are detected |
| `scripts/office/pack.py` | Re-zip the working directory back into a valid `.xlsx`, validating XML well-formedness before sealing the archive | Refuses to pack if any XML fails to parse |
| `scripts/office/validate.py` | Run XSD validation against the bundled OOXML schemas | Flags malformed parts the parsers will choke on |

Standard CLI workflow:

```bash
python scripts/office/unpack.py input.xlsx /tmp/work/
# ... edit raw XML files in /tmp/work/xl/ ...
python scripts/office/pack.py /tmp/work/ output.xlsx
python scripts/office/validate.py output.xlsx                    # optional XSD pass
python scripts/recalc.py output.xlsx 60                          # mandatory before delivery
```

The `pack.py` script catches the most common foot-guns (malformed XML,
missing `[Content_Types].xml` entries) but it does **not** semantically
validate the artefacts in §1 — that responsibility stays with the
caller.

---

## 3. Surgical edit recipe — rename a sheet

Sheet rename is the cleanest demonstrable example: it touches exactly
one attribute on one part, and any cross-sheet formula referring to the
old name needs the same rename. Anything more complex (column insertion,
row shift) belongs in `openpyxl` — they are the very operations the
deprecated `xlsx` helper scripts implemented and got wrong.

```bash
python scripts/office/unpack.py books.xlsx /tmp/books/
```

Edit `/tmp/books/xl/workbook.xml`:

```xml
<!-- before -->
<sheet name="Sheet1" sheetId="1" r:id="rId1"/>

<!-- after -->
<sheet name="Revenue" sheetId="1" r:id="rId1"/>
```

If any other worksheet referenced the old name in a formula, update
those `<f>` nodes too:

```bash
grep -rn 'Sheet1!' /tmp/books/xl/worksheets/
```

```xml
<!-- before -->
<c r="B5"><f>Sheet1!C10</f><v></v></c>

<!-- after -->
<c r="B5"><f>Revenue!C10</f><v></v></c>
```

Repack and recalc:

```bash
python scripts/office/pack.py /tmp/books/ books.xlsx
python scripts/recalc.py books.xlsx 60
```

Rules of thumb that apply to every surgical edit:

- Touch the minimum number of nodes. Never rewrite a whole part you do not need to change.
- Preserve `sheetId` and every `r:id` — these are stable internal identifiers.
- Sheet names in formulas are case-sensitive and need single-quoting if they contain spaces (`'Q1 Data'!B5`).
- Update `<dimension ref="...">` if you extended the row / column range; reviewers and pivot caches consult it.

---

## 4. Files you must never touch

These six entries are absolute no-go zones for raw XML edits — the
artefacts are either binary or so tightly coupled that there is no safe
in-place patch. If a delivery requires modifying any of them, change
the upstream architecture (regenerate the workbook, replace the link
with a Power Query, etc.) instead of editing bytes.

| File / location | Why it is unfixable in-place |
|---|---|
| `xl/vbaProject.bin` | Binary VBA bytecode; any modification corrupts the macro project |
| `xl/pivotCaches/pivotCacheDefinition*.xml` | The cache definition ties the pivot to its source data; editing without a paired `pivotTable*.xml` update corrupts the pivot |
| `xl/pivotTables/*.xml` | Tightly coupled to its cache definition and to internal state Excel rebuilds on load |
| `xl/slicers/*.xml` | Slicers are connected to specific cache IDs and pivot fields; breaking those connections silently corrupts the file |
| `xl/connections.xml` | External data connections; editing breaks live data refresh |
| `xl/externalLinks/` (`*.bin` included) | External workbook links; the binary `.bin` cache files in here must not be modified |

If you need to "fix" any of the above, the answer is to rebuild the
workbook from a clean source — never to hand-edit bytes.

---

## 5. Files you may touch with constraints

The following parts can be edited surgically, but only specific
attributes are safe — every other byte must remain untouched.

| File | What you may update | What to leave alone |
|---|---|---|
| `xl/charts/chartN.xml` | Data series range references (`<numRef><f>`) after a row / column shift | Chart type, formatting, layout, axis configuration |
| `xl/tables/tableN.xml` | `ref` attribute on `<table>` after appending rows | Column definitions, style info, header row metadata |
| `xl/pivotCaches/pivotCacheDefinition*.xml` | `ref` attribute on `<cacheSource><worksheetSource>` after shifting source data | All other content (cache fields, refresh metadata, GUIDs) |

Any edit that strays beyond the "may update" column lands you back in
§4 territory.

---

## 6. Validation after a raw-XML edit

Always run the full pipeline before delivering an XML-edited workbook —
the XSD validator + a real recalculation are the only way to catch
subtle malformations.

```bash
python scripts/office/pack.py /tmp/work/ output.xlsx
python scripts/office/validate.py output.xlsx                  # XSD well-formedness
python scripts/recalc.py output.xlsx 60                        # LibreOffice headless
```

`recalc.py` returns JSON with `status`, `total_errors`, and
`total_formulas`. A delivery is acceptable only when `total_errors == 0`.
If `validate.py` flags a malformed part, fix the XML and repeat — do not
ship a workbook that fails XSD validation.

For the `recalc.py` JSON schema, the seven Excel error markers, and the
AF_UNIX sandbox shim, see [`docs/recalc-guide.md`](recalc-guide.md).

---

## 7. When NOT to use this

The deprecated `xlsx` cookbook reached for raw-XML edits as a
default; that policy was driven by the now-disproven claim that
"openpyxl corrupts complex workbooks". In practice, **>90% of xlsx edits
the agent is asked to perform are one to three lines of `openpyxl`**.

Reach for the escape hatch only when the workbook genuinely contains an
artefact from §1; reach for the library cookbook in every other case.

| Common task | Library-first answer (use this) | Why escape-hatch is wrong here |
|---|---|---|
| Add a column at the end of a sheet | `sheet.cell(row=r, column=last+1, value=...)` then `book.save()` | XML insertion has to keep `<dimension>`, `<cols>`, every cell `r=` attribute, conditional-formatting `sqref`, table `ref`, and chart series ranges in sync; `openpyxl` does it for you |
| Insert a row in the middle | `sheet.insert_rows(idx)` then refill the new row, then `book.save()` | The deprecated `xlsx_insert_row.py` had a silent `FileNotFoundError` on openpyxl-produced files (`os.path.join(work_dir, "xl", rel.get("Target"))` dropped `work_dir` when `Target` started with `/`); same root-cause bug in `xlsx_shift_rows.py` and `xlsx_add_column.py` |
| Set cell values from a list | `for r, row in enumerate(rows, start=2): for c, v in enumerate(row, start=1): sheet.cell(row=r, column=c, value=v)` | XML write requires sharedStrings table updates with paired `count` / `uniqueCount` increments — easy to get wrong |
| Restyle a range (font, fill, border) | `cell.font = Font(...)`, `cell.fill = PatternFill(...)`, etc. | XML restyle requires appending `<font>` / `<fill>` / `<border>` / `<xf>` entries with paired `count` updates and a fresh `cellXfs` index |
| Add a chart | `openpyxl.chart.LineChart()` + `add_data` + `add_chart` | Chart XML has thirty-plus required nodes; hand-writing them is a waste of context |
| Add conditional formatting (single rule) | `openpyxl.formatting.rule.CellIsRule(...)` + `add` | Multi-rule color-scale + icon-set composites belong to §1 — but a single rule is a one-line library call |
| Recalculate after edits | `python scripts/recalc.py output.xlsx 60` | Already covered by `SKILL.md` §4 |

If you find yourself reaching for `unpack.py` to do any of the rows in
that table, stop and rewrite the operation in `openpyxl` first.
