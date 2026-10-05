# Task: REPAIR_LAYOUT

Use this task family when the document already exists, the user reports that it looks wrong, and the
job is to fix the visual outcome rather than merely inspect it.

## Required inputs

- one source `.docx`
- a layout complaint
- optional target screenshot or template reference

Normalize the complaint into one or more issue classes:
- `extra_blank_page`
- `header_footer_mismatch`
- `section_restart_wrong`
- `toc_not_generated`
- `heading_number_wrong`
- `table_row_split`
- `image_float_overlap`
- `title_orphan`
- `style_contamination`
- `inconsistent_page_numbers`

## Evidence profile

Fixed sequence:
1. rendered truth first
2. structure truth second
3. rendered truth again after repair

## Execution model

1. classify the complaint
2. inspect the rendered defect
3. map to likely structural causes
4. choose backend (`D`, `S`, or low-risk `X` only if truly local)
5. repair
6. rerender and verify

## Delivery contract

`REPAIR_LAYOUT` must produce two rendered reports using the same issue classes and page references:

1. **before repair** — reproduce the defect and pin the failing pages
2. **after repair** — rerender and prove the same complaint no longer reproduces

Use `rendered-delivery.md` and `scripts/rendered_report.py` for both passes. The report must include:

- page-level symptom summary
- structure-cause alignment
- likely structural causes
- recommended checks

Typical repair classes:
- `extra_blank_page`
- `header_footer_mismatch`
- `page_number_wrong`
- `toc_layout_or_update`
- `template_fidelity`
- `layout_overflow_or_clipping`

## Hard no

- Do not start from XML alone when the problem statement is visual.
- Do not claim success until rerendered pages confirm the fix.
- Do not claim success from artifact generation alone. A rerendered report is required.

## Acceptance profile

`strict`
