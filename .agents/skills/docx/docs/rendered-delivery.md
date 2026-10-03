# Rendered delivery contract

Rendered truth is not complete when the skill only emits a PDF or page PNG directory.
Those are artifacts, not the final answer.

`docx` closes the rendered-truth loop only when it delivers all four layers:

1. rendered artifact exists
2. problematic pages are named explicitly
3. each page-level symptom is summarized in user-facing language
4. each symptom is aligned to structure evidence and likely structural causes

## Closure path

```bash
python3 <skill_dir>/scripts/docx_to_pdf.py --input in.docx --output /tmp/render.pdf
python3 <skill_dir>/scripts/render_docx_pages.py in.docx --output-dir /tmp/render-pages
python3 <skill_dir>/scripts/read_docx_structure.py in.docx --json > /tmp/structure.json
python3 <skill_dir>/scripts/rendered_report.py \
  --pdf /tmp/render.pdf \
  --pages-dir /tmp/render-pages \
  --structure-json /tmp/structure.json \
  --issue-file /tmp/rendered-issues.json \
  --format markdown > /tmp/rendered-report.md
```

The operator still has to inspect the rendered pages and write `rendered-issues.json`.
That is intentional: rendered truth starts from what the user sees, not what the XML predicts.

## `rendered-issues.json` input

The issue file is a JSON array. Each item describes a single observed visual problem.

```json
[
  {
    "issueClass": "toc_layout_or_update",
    "pages": [2, 3],
    "severity": "high",
    "visualSymptom": "TOC page numbers do not match the rendered body headings.",
    "notes": "The rendered TOC still shows pre-edit pagination."
  }
]
```

Supported `issueClass` values:

| Issue class | Use when |
| --- | --- |
| `toc_layout_or_update` | TOC looks stale, misaligned, missing entries, or paginates incorrectly |
| `header_footer_mismatch` | header/footer appearance differs across pages or sections |
| `page_number_wrong` | visible page numbers are missing, duplicated, restarted, or inconsistent |
| `extra_blank_page` | a rendered page looks unexpectedly blank |
| `template_fidelity` | the output no longer visually follows the target template system |
| `layout_overflow_or_clipping` | body/table/image content clips, overflows, or collides visually |

## Output contract

`rendered_report.py` emits either JSON or Markdown. No schema file is required at runtime; the gate is
the concrete output contract below.

Use `--task-family READ_RENDERED` for inspection output and `--task-family REPAIR_LAYOUT` for
before/after repair reports.

When `--format json`, the top-level object must contain:

- `artifactSummary` — PDF path, pages dir, page count, per-page PNG inventory
- `structureCues` — section / TOC / page-number / contamination cues extracted from structure truth
- `candidateIssueClasses` — issue classes suggested by structure cues when observation has not yet been written down
- `pageIssueSummary` — one entry per observed problem
- `completionChecklist` — explicit reminder that artifact creation alone is not enough

Each `pageIssueSummary` entry must carry the same fields across READ_RENDERED and REPAIR_LAYOUT:

- `issueClass`
- `label`
- `pages`
- `severity`
- `visualSymptom`
- `renderedEvidence` — page -> PNG mapping
- `structureCauseAlignment` — concrete structure signals and what they support
- `likelyStructuralCauses`
- `recommendedChecks`

When `--format markdown`, the report must include these sections in order:

1. `# Rendered issue report`
2. `## Artifact summary`
3. `## Structure cues`
4. `## Candidate issue classes`
5. `## Page issue summary`
6. `## Completion checklist`

Every issue block under `## Page issue summary` must contain:

- issue label with `issueClass`
- affected pages
- severity
- visual symptom
- `Structure cause alignment:`
- `Likely structural causes:`
- `Recommended checks:`

## Typical symptom -> structure alignment

The report intentionally aligns visual problems to structure causes instead of treating them as two
separate deliverables.

| Symptom family | Typical structure alignment |
| --- | --- |
| TOC drift | TOC field count, heading outline-level risks, section transitions |
| Header/footer mismatch | per-section header/footer references, titlePg, even/odd header flags |
| Page-number issues | PAGE / NUMPAGES / SECTIONPAGES fields, section count, titlePg |
| Blank page | section break types, title-page sections |
| Template fidelity drift | section graph, missing styles, direct-format contamination |
| Overflow / clipping | direct formatting, table density, drawing density |

## REPAIR_LAYOUT usage

For layout repair, generate the rendered report twice:

1. before repair — to pin the failing pages and likely structural causes
2. after repair — to prove the same pages no longer reproduce the complaint

Do not declare REPAIR_LAYOUT complete without the second rendered report.
