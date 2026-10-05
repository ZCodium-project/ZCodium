# Acceptance profiles

Read this after the route has executed or when you are preparing the final validation pass. This file
defines post-write / pre-delivery gates, not first-hop dispatch.

No DOCX task is complete until it passes the acceptance profile mapped to its task family.

## Profiles

### light
Use for:
- read-only tasks
- trivial extraction or diagnosis

Checks:
- output exists and is readable
- answer is grounded in the selected evidence type
- for READ_RENDERED, artifact creation alone is insufficient; the answer must include a rendered issue summary

### normal
Use for:
- ordinary create and edit/fill work

Checks:
- output opens successfully
- builtin structure validation when a DOCX was written
- diff or equivalent evidence that the intended change happened
- rendered verification if the change obviously risks layout

### strict
Use for:
- apply-template
- repair-layout
- multi-section create
- header/footer, TOC, numbering, or section-sensitive edits

Checks:
- output opens successfully
- builtin structural validation
- business validation / gate-check where applicable
- rendered verification
- rendered issue summary or rendered report that names the affected pages and structure alignment
- source-preservation sanity check
- task-specific checklist under `acceptance-checklists/`

### forensic
Use for:
- compare-two-docx
- high-risk documents where the user wants an audit trail

Checks:
- content diff
- structure diff
- rendered diff or rendered issue summary
- explicit risk classification

## Task family mapping

| Task family | Acceptance profile |
| --- | --- |
| READ_CONTENT | light |
| READ_STRUCTURE | light |
| READ_RENDERED | light |
| CREATE_DOCX | normal or strict depending on structural complexity |
| EDIT_FILL_DOCX | normal |
| APPLY_TEMPLATE | strict |
| REPAIR_LAYOUT | strict |
| COMPARE_TWO_DOCX | forensic |

## Strict reminders

The following jobs are not finished without rendered verification:

- template application
- layout repair
- multi-section document creation
- header/footer changes
- TOC changes
- page-number system changes
- table-overflow / blank-page fixes

For READ_RENDERED and REPAIR_LAYOUT, rendered verification means:
- the affected pages are named
- the visual symptom is summarized
- the structure cause alignment is delivered
- the output is not merely a PDF / PNG artifact dump

## Builtin validation path

When a DOCX is written and backend `D` or `S` is involved, reuse the builtin validator:

```bash
$CLI merge-runs --input out.docx
$CLI validate --input out.docx --xsd <skill_dir>/assets/xsd/wml-subset.xsd
$CLI validate --input out.docx --business
```

For template work, add:

```bash
$CLI validate --input out.docx --gate-check <skill_dir>/assets/xsd/business-rules.xsd
```

## Output gates by task family

These are the concrete gates. Prefer these over abstract schemas.

### READ_STRUCTURE
- `python3 <skill_dir>/scripts/read_docx_structure.py <input.docx> --json` must succeed
- output JSON must contain top-level keys: `summary`, `sections`, `styles`, `numbering`, `fields`, `diagnostics`
- if a focused read is requested, the answer must name the specific structure objects involved (styles / sections / fields / refs / diagnostics)

### READ_RENDERED
- rendered artifact command must succeed (`docx_to_pdf.py` and/or `render_docx_pages.py`)
- `python3 <skill_dir>/scripts/rendered_report.py ... --format markdown` must succeed
- rendered report markdown must contain:
  - `# Rendered issue report`
  - `## Artifact summary`
  - `## Page issue summary`
  - `## Completion checklist`
- each reported issue must name pages, visual symptom, structure alignment, likely structural causes, and recommended checks

### REPAIR_LAYOUT
- all READ_RENDERED gates apply twice: before repair and after repair
- both reports must use the same issue classes and page references unless the repair itself changes page topology
- success is blocked unless the after-repair report shows the original complaint no longer reproduces

### COMPARE_TWO_DOCX
- final answer must contain four titled blocks:
  - `Content differences`
  - `Structure differences`
  - `Rendered differences`
  - `Risk classification`
- the result must explicitly name the highest-risk difference

### CREATE_DOCX / EDIT_FILL_DOCX / APPLY_TEMPLATE
- when a DOCX is written, builtin validation commands must succeed
- if layout-sensitive, rendered acceptance is required
- deliverable must name changed files / commands run / why the chosen backend matches the task
