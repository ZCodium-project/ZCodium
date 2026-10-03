# Task: READ_RENDERED

Use this task family when the user wants page truth.

## Required inputs

- one source `.docx`
- a page-level question: blank pages, cover / TOC layout, overflow, clipped content, visual mismatch,
  pagination, page numbers, header/footer appearance, or “why does this Word look wrong?”

## Evidence profile

Default evidence: **rendered truth + structure truth**.

Rendered evidence judges the problem. Structure evidence helps explain the cause.

## Execution path

### Preferred route: DOCX -> PDF / page artifacts inside this skill
```bash
python3 <skill_dir>/scripts/docx_to_pdf.py --input <input.docx> --output /tmp/docx-render.pdf
```

Then inspect the generated PDF or derived page artifacts from inside `docx`. Rendered truth
must stay in this skill so DOCX page diagnosis and repair are all-in-one.

### Page PNG route
```bash
python3 <skill_dir>/scripts/render_docx_pages.py <input.docx> --output-dir /tmp/docx-pages
```

This route is valid only when full-fidelity rendering requirements are met. If the required render toolchain is missing, block and report the missing dependency. Do not degrade to a lower-fidelity preview path.

### Delivery route: rendered artifact -> page issue summary -> structure alignment
After page inspection, write down the observed rendered symptoms and produce the rendered report from
inside `docx`:

```bash
python3 <skill_dir>/scripts/read_docx_structure.py <input.docx> --json > /tmp/docx-structure.json
python3 <skill_dir>/scripts/rendered_report.py \
  --pdf /tmp/docx-render.pdf \
  --pages-dir /tmp/docx-pages \
  --structure-json /tmp/docx-structure.json \
  --issue-file /tmp/rendered-issues.json \
  --format markdown > /tmp/rendered-report.md
```

The exact issue-file format and output contract are defined in `rendered-delivery.md`.

## Output contract

Return:
- `artifactSummary`: PDF / PNG artifact inventory
- `pageIssueSummary`: each issue must name pages, severity, and visual symptom
- `structureCauseAlignment`: for each issue, align the symptom to structure signals
- `likelyStructuralCauses`: explain why the structure signals matter
- `recommendedChecks`: tell the next operator what to verify or rerender

Typical issue classes that must use this format:
- `layout_overflow_or_clipping`
- `template_fidelity`
- `toc_layout_or_update`
- `header_footer_mismatch`
- `page_number_wrong`
- `extra_blank_page`

Delivering only the PDF or page PNG directory is incomplete. Artifact generation is evidence collection,
not the rendered-truth answer.

## Acceptance profile

`light`

## Common mistake

Do not stay in pure XML once the task is about page appearance. XML is evidence, not the judge.
Do not treat a generated PDF or PNG folder as the final deliverable. The final deliverable is the
page issue summary plus structure alignment.
