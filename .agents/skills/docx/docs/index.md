# docx — index

Start here only after reading `../SKILL.md`.

## Fast dispatch

Pick the first matching route and go there immediately:

- new formal Word deliverable -> `task-create.md`
- same content, new template / institutional visual system -> `task-apply-template.md`
- in-place content mutation on an existing DOCX -> `task-edit-fill.md`
- read meaning -> `task-read-content.md`
- inspect structure -> `task-read-structure.md`
- inspect pages -> `task-read-rendered.md`
- fix visible defects -> `task-repair-layout.md`
- compare two DOCX files -> `task-compare-two-docx.md`

## What to read only when needed

- `router.md` — if route choice is ambiguous
- `evidence.md` — if the chosen route needs truth-source arbitration
- `backends.md` — if backend choice is genuinely ambiguous after route + recipe/mode selection
- `acceptance.md` — when you are ready to validate output

## Generation-first rule

For `CREATE_DOCX` and `APPLY_TEMPLATE`, do not start with a backend debate. Start with the recipe /
visual system:

- `references/typography_guide.md`
- `references/design_principles.md`
- `references/cjk_typography.md`
- `scripts/dotnet/MiniMaxAIDocx.Core/Samples/AestheticRecipeSamples*.cs`

Then choose backend and execute.

## Specialized docs

- `rendered-delivery.md`
- `template-dsl.md`
- `xml-patch-dsl.md`
- `track-changes.md`
- `tables-and-numbering.md`
- `failure-taxonomy.md`
- `anti-patterns.md`

## Core idea

This index exists to shorten dispatch. Route first, hit the generation/read/repair core quickly, then
open deeper policy docs only when the selected route actually needs them.
