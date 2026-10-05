# Evidence router

DOCX tasks fail when the wrong truth source is treated as authoritative. This skill uses three evidence
classes and requires you to choose deliberately.

## The three truths

### Content truth
What the document says in readable text order.
Use for:
- summary
- retrieval
- quoting
- content diff
- finding a heading by text

### Structure truth
How Word/OpenXML represents the document.
Use for:
- styles
- sections
- numbering
- TOC mechanics
- header/footer references
- comments, revisions, fields, bookmarks
- template internals
- relationship and part topology

The structure-truth oracle is `scripts/read_docx_structure.py`. It is the primary
implementation; the dotnet `analyze` command is an optional independent confirmation
shot, not the source. See `task-read-structure.md` for the full report contract.

### Rendered truth
What the user actually sees on pages.
Use for:
- blank pages
- cover / TOC / abstract / body layout
- pagination and page-number issues
- overflow and clipping
- table split defects
- header/footer visual mismatch
- visual template fidelity

## Default evidence posture by task family

| Task family | Default evidence |
| --- | --- |
| READ_CONTENT | content |
| READ_STRUCTURE | structure |
| READ_RENDERED | rendered + structure |
| CREATE_DOCX | source content + optional template structure + rendered acceptance when visual fidelity matters |
| EDIT_FILL_DOCX | content + structure; add rendered when visual risk exists |
| APPLY_TEMPLATE | source structure + template structure + output rendered |
| REPAIR_LAYOUT | rendered -> structure -> rendered again |
| COMPARE_TWO_DOCX | content + structure + rendered |

## Rules

- If the user asks a page question, rendered truth wins.
- If the user asks a TOC / section / numbering question, structure truth wins.
- If the user asks for summary or quote, content truth wins.
- If you are about to modify a template-driven DOCX, structure truth comes before mutation.
- If you finish a template or layout task without rendered truth, the task is not finished.
- If you only generated artifacts and did not produce a page issue summary, rendered truth is still not finished.
- Rendered truth delivery means visual symptom + page reference + structure alignment, not artifact path only.

## Evidence mistakes to avoid

- Using extracted text to answer section topology questions
- Using XML alone to declare a visual bug fixed
- Using screenshots alone to rewrite numbering or TOC rules
- Skipping structure read before applying an institutional template
- Treating a PDF/PNG directory as the final rendered answer without a rendered report
