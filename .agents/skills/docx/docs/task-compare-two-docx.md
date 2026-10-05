# Task: COMPARE_TWO_DOCX

Use this task family when the user provides two DOCX files and wants the differences explained.

## Required inputs

- `before.docx`
- `after.docx`
- optional compare focus; if omitted, assume full compare

Allowed focuses:
- `content_only`
- `structure_only`
- `rendered_only`
- `full`

## Evidence profile

Default evidence: **content + structure + rendered**.

## Output contract

Always separate the result into:

### Content differences
- changed text, headings, tables, notes, or clauses

### Structure differences
- changed styles, sections, numbering, headers/footers, fields, comments/revisions, direct formatting

### Rendered differences
- changed page count, blank pages, page numbers, header/footer appearance, overflow, cover/TOC/body layout

Then classify risk:
- content risk
- structure risk
- purely visual risk
- highest-risk difference

## Execution notes

- use read-content techniques for content diff
- use `diff_docx_structure.py` for structure diff
- use rendered inspection when page truth matters

## Acceptance profile

`forensic`
