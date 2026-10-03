# Task: READ_STRUCTURE

Use this task family when the user wants Word/OpenXML truth rather than plain text.

## Required inputs

- one source `.docx`
- a structure question: styles, sections, numbering, TOC, headers/footers, revisions, comments,
  bookmarks, fields, template internals, or structural differences that affect later edits

## Evidence profile

Default evidence: **structure truth**.

Use content truth only as a locator aid. Use rendered truth only if the user also asks what the
structure difference means visually.

## Execution path

### Primary analyzer (structure truth oracle)

`scripts/read_docx_structure.py` is the **structure-truth implementation** for this skill. It is
not a summary that needs another tool to be useful; it parses every OOXML part directly with the
Python stdlib and produces an independent, self-contained structure report. Run it as the first
step of every READ_STRUCTURE task:

```bash
python3 <skill_dir>/scripts/read_docx_structure.py <input.docx> --json
```

The report owns these structure axes — none of them are delegated to dotnet:

| Section | What it gives you |
|---------|-------------------|
| `packaging` | `[Content_Types]`, package rels, document rels, full part inventory with sizes |
| `sections` | per-section graph: type, page size (mm), margins (mm), columns, `titlePg`, `lineNumbering`, `pageBorders`, header/footer rId references |
| `headerFooterParts` | every header/footer part resolved through rels with paragraph / field / drawing / hyperlink counts and per-part field kinds |
| `styles.byId` + `defaults` | full styles dictionary with `basedOn`, `linked`, `next`, `outlineLvl`, `numId`, `isCustom`, `isDefault` |
| `styles.usedParagraphStyles` / `usedRunStyles` | usage histograms straight from document body |
| `styles.missingReferenced` / `definedButUnused` / `headingsWithoutOutlineLvl` | template-diagnosis cross-reference audit |
| `numbering.abstractNums` / `nums` | the `numId → abstractNumId → levels` chain with `multiLevelType`, per-level `numFmt`, `lvlText`, `start`, `pStyle` |
| `numbering.usage` | paragraph counts per `numId` and per `(numId, ilvl)` |
| `fields.simple` / `complex` | full instruction text, classified `kind` (TOC, PAGE, REF, STYLEREF, …), `dirty` / `locked` flags, captured field result |
| `fields.kindCountsAllParts` | rolled-up field-kind counts including header/footer parts |
| `bookmarks` | start/end pairing with paragraph spans, orphan starts and ends, reserved-name flag |
| `hyperlinks` | anchor + rId resolved to URL via document rels, `external` flag |
| `comments` | comment defs, `commentsExtended` parent links, in-body range/reference counts, orphans both ways |
| `revisions` | per-kind counts (`ins`, `del`, `moveFrom`, `moveTo`, `cell*`, `rPrChange`, `pPrChange`, `sectPrChange`, …), authors, date range |
| `contamination` | direct-formatting heatmap: `pPrDirect`, `rPrDirectRuns`, dirty-paragraph ratio |
| `settingsFlags` | `trackChanges`, `evenAndOddHeaders`, `mirrorMargins`, `updateFields`, footnote/endnote presence |
| `diagnostics` | categorized findings (`severity` × `code` × `message`) for missing styles, broken section / hyperlink rels, undefined comment ids, orphan bookmarks, missing numIds, heading styles without outline level |

To request a subset of axes (cheaper context), pass `--section`:

```bash
python3 <skill_dir>/scripts/read_docx_structure.py <input.docx> --json --section sections,numbering,diagnostics
```

The `diagnostics` array is intentionally the place to look first when the user asks
"what's wrong with this template?" — every finding includes a stable `code` and the
ids/paths needed to act on it.

### Independent confirmation (optional)

`dotnet run --project <skill_dir>/scripts/dotnet/MiniMaxAIDocx.Cli -- analyze --input <input.docx> --json`
remains available as an **independent confirmation** shot — different runtime, different parser,
different JSON shape — and is useful when you need to sanity-check the Python analyzer or compare
counts across two parsers. It is not the structure-truth source. The dotnet `analyze` command
returns a deliberately shallower view (sections, headings, tables, image count, custom style ids,
XML file sizes) and does **not** cover numbering chains, field topology, bookmark pairing,
hyperlink rel resolution, contamination heatmap, or template diagnostics. If the two disagree on
something the Python analyzer covers, treat the Python output as authoritative and investigate
the divergence.

## Output contract

Return:

- a direct answer to the structure question
- the key objects involved: styles, section breaks, numbering, refs, fields, revisions, etc.
- any hazards from `diagnostics` that matter for later write work
- if applicable, the `code` of any diagnostic that downstream tasks (REPAIR_LAYOUT,
  APPLY_TEMPLATE) should pre-flight on

## Acceptance profile

`light`

## Common mistake

Do not claim a visual fix or visual defect from structure evidence alone when the user asked about
pages. That belongs in `READ_RENDERED` or `REPAIR_LAYOUT`. And do not run `dotnet analyze` *before*
the Python analyzer — the dotnet command is a corroboration shot, not the entry point.
