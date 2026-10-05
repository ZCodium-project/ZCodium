# Task: EDIT_FILL_DOCX

Use this task family when the source DOCX remains the same document object and the user wants
content-level mutation.

## Required inputs

- one source `.docx`
- an edit instruction that can be normalized into operations such as:
  - replace text
  - fill anchor
  - insert block
  - fill table rows
  - remove block
  - update header/footer text

## Evidence profile

Default evidence: **content + structure**.
Add rendered truth when:
- the complaint is already visual
- the mutation touches section-sensitive areas
- the mutation affects headers/footers, TOC, numbering, or large tables

## Sub-modes

### Text replacement
Simple content replacement while preserving formatting boundaries.

### Placeholder fill
Fill anchors after atomicity verification.

### Block insert
Insert new content relative to a heading, anchor, or exact paragraph locator.

### Table expansion
Clone or fill rows while preserving table-local style behavior.

### Structural edit
Section, header/footer, TOC, or numbering work. This is still edit/fill as a task family, but it is
no longer a low-risk local patch.

## Backend selection

### Pick X when
- the operation is deterministic, local, and low-topology
- examples: anchor validation, merge-runs preview, local anchor fill, direct-format stripping,
  a constrained local replace

### Pick D when
- the edit needs builtin CLI support or preservation guarantees
- examples: replace-text, fill-placeholders, header/footer update, CLI-supported edits

### Pick S when
- the edit requires byte-level graph control outside both X and D

### Pick D or S after regeneration normalization
- if “edit” actually means “regenerate from the real Markdown / LaTeX source”, do not treat that as a
  pandoc edit path; reclassify into CREATE_DOCX or the regeneration path, normalize first, then pick `D`
  or `S`

## Hard no

- Never use P to edit a Word-authored DOCX in place.
- Never use X for section topology, header/footer graph edits, numbering rebuilds, or relationship rewrites.

## Acceptance profile

`normal`, escalating to rendered verification when visual risk exists.
