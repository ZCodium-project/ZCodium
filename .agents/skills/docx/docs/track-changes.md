# Track changes

Track changes are not ordinary text edits. Preserve semantics.

## Runtime rules

- `w:del` uses `w:delText`, not `w:t`
- `w:ins` uses `w:t`, not `w:delText`
- if the task truly requires revision-graph manipulation, prefer backend `D` or `S`
- do not use pandoc to preserve tracked changes in a Word-authored DOCX

## Practical rule

If the user only wants readable content and does not care about tracked-change semantics, read-side
content extraction may ignore them. But write-side preservation must not.
