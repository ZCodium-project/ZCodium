# XML patch DSL

Patch plans exist to convert a natural-language edit request into a deterministic operation list.
They are not a full programming language.

## Supported operations

- `replace_text`
- `fill_anchor`
- `insert_paragraph_after`
- `insert_paragraph_before`
- `remove_paragraph`
- `clone_table_row`
- `fill_table_row`
- `strip_direct_formatting`
- `set_paragraph_style`
- `set_run_style`
- `merge_runs`
- `fix_element_order`

## Locator types

- `anchor`
- `heading_text`
- `paragraph_text_exact`
- `paragraph_index`
- `table_anchor`
- `xpath` (advanced, not default)

## Safety boundary

If the operation implies section topology changes, numbering rebuilds, header/footer graph edits, or
relationship rewrites, the patch plan should escalate from `X` to `D` or `S`.
