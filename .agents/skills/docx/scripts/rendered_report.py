#!/usr/bin/env python3
"""Build a rendered-truth delivery report for docx.

This script closes the gap between "artifact generated" and "rendered truth
explained". It combines:

- rendered artifacts (PDF / page PNG inventory)
- observed page-level issues (pages + visual symptoms)
- structure-truth output from read_docx_structure.py

The result is a structured rendered report that can be delivered as JSON or
Markdown, with each visual symptom aligned to concrete structure signals and
likely structural causes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


IssueData = Dict[str, Any]
StructureReport = Dict[str, Any]
StructureCues = Dict[str, Any]
IssueCatalog = Dict[str, Dict[str, Any]]


def load_json(path: Path) -> Any:
    with path.open('r', encoding='utf-8') as handle:
        return json.load(handle)


def parse_page_number(file_path: Path) -> Optional[int]:
    match = re.fullmatch(r'page-(\d+)\.png', file_path.name)
    if not match:
        return None
    return int(match.group(1))


def list_pages(pages_dir: Optional[Path]) -> List[Dict[str, Any]]:
    if pages_dir is None:
        return []
    pages: List[Dict[str, Any]] = []
    for file_path in sorted(pages_dir.iterdir(), key=lambda item: item.name):
        if not file_path.is_file():
            continue
        page_number = parse_page_number(file_path)
        if page_number is None:
            continue
        pages.append({
            'page': page_number,
            'png': str(file_path),
        })
    return pages


def page_evidence(pages: List[int], rendered_pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_page = {entry['page']: entry['png'] for entry in rendered_pages}
    evidence: List[Dict[str, Any]] = []
    for page in pages:
        if page in by_page:
            evidence.append({'page': page, 'png': by_page[page]})
        else:
            evidence.append({'page': page, 'png': None})
    return evidence


def unique_strings(values: List[Optional[str]]) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def derive_structure_cues(report: StructureReport) -> StructureCues:
    sections = report.get('sections', []) or []
    section_types = [section.get('type') for section in sections]
    title_page_sections = [section.get('index') for section in sections if section.get('titlePg')]
    header_footer_parts = report.get('headerFooterParts', []) or []
    fields = report.get('fields', {}) or {}
    field_kind_counts = fields.get('kindCounts', {}) or {}
    diagnostics = report.get('diagnostics', []) or []
    styles = report.get('styles', {}) or {}
    contamination = report.get('contamination', {}) or {}
    summary = report.get('summary', {}) or {}
    settings_flags = report.get('settingsFlags', {}) or {}

    return {
        'sectionCount': len(sections),
        'sectionTypes': unique_strings(section_types),
        'titlePageSections': title_page_sections,
        'sectionsWithHeaders': [
            section.get('index') for section in sections if section.get('headerReferences')
        ],
        'sectionsWithFooters': [
            section.get('index') for section in sections if section.get('footerReferences')
        ],
        'headerFooterParts': {
            'headers': sum(1 for part in header_footer_parts if part.get('kind') == 'header'),
            'footers': sum(1 for part in header_footer_parts if part.get('kind') == 'footer'),
            'partsWithFields': [
                {'kind': part.get('kind'), 'target': part.get('target'), 'fields': part.get('fields', 0)}
                for part in header_footer_parts
                if part.get('fields')
            ],
        },
        'fieldKinds': field_kind_counts,
        'tocFieldCount': int(field_kind_counts.get('TOC', 0)),
        'pageNumberFieldCount': {
            'PAGE': int(field_kind_counts.get('PAGE', 0)),
            'NUMPAGES': int(field_kind_counts.get('NUMPAGES', 0)),
            'SECTIONPAGES': int(field_kind_counts.get('SECTIONPAGES', 0)),
            'PAGEREF': int(field_kind_counts.get('PAGEREF', 0)),
        },
        'headingOutlineRisks': styles.get('headingsWithoutOutlineLvl', []) or [],
        'missingReferencedStyles': styles.get('missingReferenced', []) or [],
        'definedButUnusedStyles': styles.get('definedButUnused', []) or [],
        'dirtyParagraphRatio': contamination.get('dirtyRatio', 0.0),
        'dirtyParagraphCount': contamination.get('paragraphsDirty', 0),
        'paragraphCount': contamination.get('paragraphTotal', 0),
        'tableCount': int(summary.get('tables', 0)),
        'drawingCount': int(summary.get('drawings', 0)),
        'settingsFlags': settings_flags,
        'diagnosticCodes': [item.get('code') for item in diagnostics if item.get('code')],
    }


def describe_value(value: Any) -> str:
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def add_signal(signals: List[Dict[str, str]], label: str, value: Any, supports: str) -> None:
    if value in (None, '', [], {}, 0, 0.0, False):
        return
    signals.append({
        'signal': label,
        'evidence': describe_value(value),
        'supports': supports,
    })


def cues_for_toc(cues: StructureCues) -> List[Dict[str, str]]:
    signals: List[Dict[str, str]] = []
    add_signal(signals, 'TOC fields present', cues.get('tocFieldCount'), 'The document uses field-driven TOC generation rather than static text.')
    add_signal(
        signals,
        'Heading styles missing outline levels',
        cues.get('headingOutlineRisks'),
        'TOC inclusion / hierarchy can drift when heading-like styles do not expose outline levels.',
    )
    if cues.get('sectionCount', 0) > 1:
        add_signal(
            signals,
            'Multiple sections in document',
            cues.get('sectionTypes'),
            'TOC pagination can shift across section starts and title-page transitions.',
        )
    return signals


def cues_for_header_footer(cues: StructureCues) -> List[Dict[str, str]]:
    signals: List[Dict[str, str]] = []
    add_signal(
        signals,
        'Sections with header references',
        cues.get('sectionsWithHeaders'),
        'Header visuals are section-scoped, so mismatches can come from per-section reference divergence.',
    )
    add_signal(
        signals,
        'Sections with footer references',
        cues.get('sectionsWithFooters'),
        'Footer visuals are section-scoped, so mismatches can come from per-section reference divergence.',
    )
    add_signal(
        signals,
        'Header/footer parts containing fields',
        cues.get('headerFooterParts', {}).get('partsWithFields'),
        'The visible footer/header may be field-driven rather than plain text.',
    )
    if cues.get('settingsFlags', {}).get('evenAndOddHeaders'):
        add_signal(
            signals,
            'evenAndOddHeaders enabled',
            True,
            'Odd/even pages may intentionally use different header/footer variants.',
        )
    if cues.get('titlePageSections'):
        add_signal(
            signals,
            'titlePg sections present',
            cues.get('titlePageSections'),
            'First-page header/footer variants may differ from the rest of the section.',
        )
    return signals


def cues_for_page_numbers(cues: StructureCues) -> List[Dict[str, str]]:
    signals: List[Dict[str, str]] = []
    add_signal(
        signals,
        'Page-number fields present',
        cues.get('pageNumberFieldCount'),
        'Visible numbering is field-driven (PAGE / NUMPAGES / SECTIONPAGES / PAGEREF).',
    )
    if cues.get('titlePageSections'):
        add_signal(
            signals,
            'titlePg sections present',
            cues.get('titlePageSections'),
            'First page numbering may intentionally hide or restart inside these sections.',
        )
    if cues.get('sectionCount', 0) > 1:
        add_signal(
            signals,
            'Multiple sections in document',
            cues.get('sectionTypes'),
            'Page numbering can restart or jump at section boundaries.',
        )
    return signals


def cues_for_blank_page(cues: StructureCues) -> List[Dict[str, str]]:
    signals: List[Dict[str, str]] = []
    add_signal(
        signals,
        'Section break types',
        cues.get('sectionTypes'),
        'nextPage / oddPage / evenPage section starts can materialize as rendered blank pages.',
    )
    if cues.get('titlePageSections'):
        add_signal(
            signals,
            'titlePg sections present',
            cues.get('titlePageSections'),
            'First-page variants often interact with apparent blank pages around covers and TOCs.',
        )
    return signals


def cues_for_template(cues: StructureCues) -> List[Dict[str, str]]:
    signals: List[Dict[str, str]] = []
    add_signal(
        signals,
        'Multiple sections in document',
        cues.get('sectionTypes'),
        'Template fidelity depends on preserving section graph and per-section page setup.',
    )
    add_signal(
        signals,
        'Missing referenced styles',
        cues.get('missingReferencedStyles'),
        'Template application can drift if the target structure references styles that are absent or unresolved.',
    )
    add_signal(
        signals,
        'Direct-formatting contamination ratio',
        cues.get('dirtyParagraphRatio'),
        'Inline formatting can override template styling even when the base style names look correct.',
    )
    add_signal(
        signals,
        'Heading outline risks',
        cues.get('headingOutlineRisks'),
        'Template fidelity includes TOC / navigation hierarchy, not just typography.',
    )
    return signals


def cues_for_layout(cues: StructureCues) -> List[Dict[str, str]]:
    signals: List[Dict[str, str]] = []
    add_signal(
        signals,
        'Direct-formatting contamination ratio',
        cues.get('dirtyParagraphRatio'),
        'Manual spacing / alignment overrides are a common source of overflow and clipping.',
    )
    add_signal(
        signals,
        'Table count',
        cues.get('tableCount'),
        'Dense tables are common triggers for page overflow or page-break defects.',
    )
    add_signal(
        signals,
        'Drawing count',
        cues.get('drawingCount'),
        'Drawings and anchored objects can collide with text flow.',
    )
    return signals


ISSUE_CATALOG: IssueCatalog = {
    'toc_layout_or_update': {
        'label': 'TOC layout / update problem',
        'signal_builder': cues_for_toc,
        'likely_causes': [
            'The TOC is field-driven, so stale field results or unrefreshed pagination can leave entries and page numbers out of sync with the rendered pages.',
            'Heading-like styles without outline levels can drop content from the TOC or place it at the wrong hierarchy depth.',
            'Section boundaries around cover / abstract / body can push TOC pagination in ways that structure-only review would miss.',
        ],
        'recommended_checks': [
            'Confirm the affected TOC pages in the rendered PNG/PDF, then verify whether the corresponding headings expose outline levels.',
            'If edits changed pagination, rerender after a TOC refresh and compare the same page numbers again.',
        ],
    },
    'header_footer_mismatch': {
        'label': 'Header/footer mismatch',
        'signal_builder': cues_for_header_footer,
        'likely_causes': [
            'Header/footer content is wired per section, so one section may still reference an older header/footer part.',
            'titlePg or even/odd variants can make the first page or alternating pages intentionally diverge unless all variants are updated together.',
            'Visible footer text may actually come from PAGE / NUMPAGES fields rather than literal text content.',
        ],
        'recommended_checks': [
            'Compare the affected rendered page against the section index that owns its header/footer references.',
            'Inspect whether first-page, even-page, and default header/footer variants were all updated consistently.',
        ],
    },
    'page_number_wrong': {
        'label': 'Page-number defect',
        'signal_builder': cues_for_page_numbers,
        'likely_causes': [
            'Page numbers are field-driven and can restart or hide at section boundaries.',
            'titlePg sections often suppress numbering on the first page while still counting later pages.',
            'Mixed PAGE / NUMPAGES / SECTIONPAGES usage can make the rendered footer appear inconsistent even when the XML is structurally valid.',
        ],
        'recommended_checks': [
            'Record the exact rendered page numbers that look wrong, then map them to the owning section and footer field setup.',
            'Verify whether numbering is meant to restart per section or continue globally before attempting repair.',
        ],
    },
    'extra_blank_page': {
        'label': 'Extra blank page',
        'signal_builder': cues_for_blank_page,
        'likely_causes': [
            'Section starts such as nextPage / oddPage / evenPage can intentionally force a new rendered page.',
            'Cover/title-page handling can introduce a page that looks blank but is structurally reserved for a section transition.',
            'A visual blank page should be judged from rendered evidence first, then explained through section topology.',
        ],
        'recommended_checks': [
            'Capture the blank rendered page number and the pages immediately before/after it.',
            'Check the section break immediately preceding that page before changing content or deleting XML nodes.',
        ],
    },
    'template_fidelity': {
        'label': 'Template fidelity problem',
        'signal_builder': cues_for_template,
        'likely_causes': [
            'Template fidelity depends on section graph, page setup, headers/footers, and numbering — not only named styles.',
            'Direct formatting contamination can visually override the intended template even when style IDs look correct.',
            'Missing or misconfigured heading outline levels can make TOC/navigation drift from the target template rules.',
        ],
        'recommended_checks': [
            'Use rendered pages to identify the first visibly divergent page, then inspect section/page-setup ownership for that page.',
            'Before repair, decide whether the defect is caused by section topology, style inheritance, or direct formatting contamination.',
        ],
    },
    'layout_overflow_or_clipping': {
        'label': 'Layout overflow / clipping',
        'signal_builder': cues_for_layout,
        'likely_causes': [
            'Manual spacing, alignment, or run-level formatting can push content beyond the expected layout grid.',
            'Large tables or drawings can collide with page boundaries even when the surrounding structure seems valid.',
            'Rendered truth is the judge here; structure cues only narrow the likely cause set.',
        ],
        'recommended_checks': [
            'Record the exact page and region where clipping/overflow appears in the rendered artifact.',
            'Inspect local direct formatting and nearby large objects before changing global template rules.',
        ],
    },
}


def candidate_issue_classes(cues: StructureCues) -> List[str]:
    candidates: List[str] = []
    if cues.get('tocFieldCount', 0) > 0 or cues.get('headingOutlineRisks'):
        candidates.append('toc_layout_or_update')
    if cues.get('sectionsWithHeaders') or cues.get('sectionsWithFooters'):
        candidates.append('header_footer_mismatch')
    page_fields = cues.get('pageNumberFieldCount', {})
    if any(page_fields.get(key, 0) > 0 for key in ('PAGE', 'NUMPAGES', 'SECTIONPAGES', 'PAGEREF')):
        candidates.append('page_number_wrong')
    if cues.get('sectionCount', 0) > 1 or cues.get('titlePageSections'):
        candidates.extend(['extra_blank_page', 'template_fidelity'])
    if cues.get('dirtyParagraphRatio', 0.0) > 0 or cues.get('tableCount', 0) > 0 or cues.get('drawingCount', 0) > 0:
        candidates.append('layout_overflow_or_clipping')
    return unique_strings(candidates)


def normalize_issue(raw: Dict[str, Any]) -> IssueData:
    issue_class = raw.get('issueClass')
    if issue_class not in ISSUE_CATALOG:
        supported = ', '.join(sorted(ISSUE_CATALOG))
        raise RuntimeError(f'Unsupported issueClass {issue_class!r}. Supported: {supported}')

    raw_pages = raw.get('pages', []) or []
    pages: List[int] = []
    for page in raw_pages:
        if not isinstance(page, int) or page <= 0:
            raise RuntimeError(f'Issue pages must be positive integers: {raw_pages!r}')
        pages.append(page)

    severity = raw.get('severity', 'medium')
    if severity not in {'low', 'medium', 'high', 'critical'}:
        raise RuntimeError(f'Unsupported severity {severity!r} for issueClass {issue_class!r}')

    symptom = raw.get('visualSymptom') or raw.get('symptom')
    if not isinstance(symptom, str) or not symptom.strip():
        raise RuntimeError(f'Issue {issue_class!r} requires a non-empty visualSymptom')

    return {
        'issueClass': issue_class,
        'pages': pages,
        'severity': severity,
        'visualSymptom': symptom.strip(),
        'notes': raw.get('notes', ''),
    }


def build_issue_entry(issue: IssueData, cues: StructureCues, rendered_pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    catalog = ISSUE_CATALOG[issue['issueClass']]
    signal_builder: Callable[[StructureCues], List[Dict[str, str]]] = catalog['signal_builder']
    signals = signal_builder(cues)
    return {
        'issueClass': issue['issueClass'],
        'label': catalog['label'],
        'pages': issue['pages'],
        'severity': issue['severity'],
        'visualSymptom': issue['visualSymptom'],
        'notes': issue.get('notes', ''),
        'renderedEvidence': page_evidence(issue['pages'], rendered_pages),
        'structureCauseAlignment': signals,
        'likelyStructuralCauses': catalog['likely_causes'],
        'recommendedChecks': catalog['recommended_checks'],
    }


def build_report(
    *,
    task_family: str,
    pdf_path: Optional[Path],
    pages_dir: Optional[Path],
    structure_report: Optional[StructureReport],
    issues: List[IssueData],
) -> Dict[str, Any]:
    rendered_pages = list_pages(pages_dir)
    cues = derive_structure_cues(structure_report or {}) if structure_report else {}
    issue_entries = [build_issue_entry(issue, cues, rendered_pages) for issue in issues]

    return {
        'taskFamily': task_family,
        'artifactSummary': {
            'pdf': str(pdf_path) if pdf_path else None,
            'pagesDir': str(pages_dir) if pages_dir else None,
            'pageCount': len(rendered_pages),
            'pages': rendered_pages,
        },
        'structureCues': cues,
        'candidateIssueClasses': candidate_issue_classes(cues) if cues else [],
        'pageIssueSummary': issue_entries,
        'completionChecklist': [
            'Rendered artifact exists and the affected pages are named explicitly.',
            'Each visual symptom is aligned to structure signals, not guessed from XML alone.',
            'Typical classes such as layout/template/TOC/header-footer/page-number use the same delivery format.',
            'Artifact generation alone is not treated as completion; page issue summary is part of the deliverable.',
        ],
    }


def render_markdown(report: Dict[str, Any]) -> str:
    lines: List[str] = []
    artifact = report['artifactSummary']
    cues = report.get('structureCues', {}) or {}
    lines.append('# Rendered issue report')
    lines.append('')
    lines.append('## Artifact summary')
    lines.append(f"- PDF: {artifact.get('pdf') or 'N/A'}")
    lines.append(f"- Pages dir: {artifact.get('pagesDir') or 'N/A'}")
    lines.append(f"- Rendered page count: {artifact.get('pageCount', 0)}")
    if report.get('candidateIssueClasses'):
        lines.append(f"- Candidate issue classes: {', '.join(report['candidateIssueClasses'])}")
    lines.append('')
    if cues:
        lines.append('## Structure cues')
        lines.append(f"- Sections: {cues.get('sectionCount', 0)} ({', '.join(cues.get('sectionTypes', [])) or 'n/a'})")
        lines.append(f"- titlePg sections: {cues.get('titlePageSections', [])}")
        lines.append(f"- TOC fields: {cues.get('tocFieldCount', 0)}")
        lines.append(f"- Page-number fields: {json.dumps(cues.get('pageNumberFieldCount', {}), ensure_ascii=False)}")
        lines.append(f"- Heading outline risks: {cues.get('headingOutlineRisks', [])}")
        lines.append(f"- Missing referenced styles: {cues.get('missingReferencedStyles', [])}")
        lines.append(f"- Dirty paragraph ratio: {cues.get('dirtyParagraphRatio', 0.0)}")
        lines.append('')
    lines.append('## Page issue summary')
    if not report.get('pageIssueSummary'):
        lines.append('- No observed issues were provided. Use the candidate issue classes above to bootstrap a report after page inspection.')
        lines.append('')
    for issue in report.get('pageIssueSummary', []):
        lines.append(f"### {issue['label']} ({issue['issueClass']})")
        lines.append(f"- Pages: {issue.get('pages', [])}")
        lines.append(f"- Severity: {issue.get('severity')}")
        lines.append(f"- Visual symptom: {issue.get('visualSymptom')}")
        if issue.get('notes'):
            lines.append(f"- Notes: {issue['notes']}")
        lines.append('- Rendered evidence:')
        for evidence in issue.get('renderedEvidence', []):
            lines.append(f"  - page {evidence['page']}: {evidence.get('png') or 'missing page PNG'}")
        lines.append('- Structure cause alignment:')
        for signal in issue.get('structureCauseAlignment', []):
            lines.append(f"  - {signal['signal']} -> {signal['evidence']} :: {signal['supports']}")
        lines.append('- Likely structural causes:')
        for cause in issue.get('likelyStructuralCauses', []):
            lines.append(f"  - {cause}")
        lines.append('- Recommended checks:')
        for check in issue.get('recommendedChecks', []):
            lines.append(f"  - {check}")
        lines.append('')
    lines.append('## Completion checklist')
    for item in report.get('completionChecklist', []):
        lines.append(f'- {item}')
    return '\n'.join(lines).strip() + '\n'


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Build a rendered-truth delivery report from page artifacts, structure JSON, and observed page issues.'
    )
    parser.add_argument('--pdf', help='Path to the rendered PDF artifact')
    parser.add_argument('--pages-dir', help='Directory containing page-N.png files')
    parser.add_argument('--structure-json', help='JSON output from read_docx_structure.py --json')
    parser.add_argument('--issue-file', help='JSON file containing observed rendered issues')
    parser.add_argument(
        '--task-family',
        choices=('READ_RENDERED', 'REPAIR_LAYOUT'),
        default='READ_RENDERED',
        help='Rendered report consumer: READ_RENDERED or REPAIR_LAYOUT',
    )
    parser.add_argument(
        '--format',
        choices=('markdown', 'json'),
        default='markdown',
        help='Output format for the rendered report',
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    pdf_path = Path(args.pdf).expanduser().resolve() if args.pdf else None
    pages_dir = Path(args.pages_dir).expanduser().resolve() if args.pages_dir else None
    structure_path = Path(args.structure_json).expanduser().resolve() if args.structure_json else None
    issue_path = Path(args.issue_file).expanduser().resolve() if args.issue_file else None

    if pdf_path is None and pages_dir is None:
        raise RuntimeError('At least one rendered artifact input is required: --pdf or --pages-dir')
    if pdf_path is not None and not pdf_path.exists():
        raise RuntimeError(f'PDF artifact does not exist: {pdf_path}')
    if pages_dir is not None:
        if not pages_dir.exists():
            raise RuntimeError(f'Pages directory does not exist: {pages_dir}')
        if not pages_dir.is_dir():
            raise RuntimeError(f'Pages path is not a directory: {pages_dir}')
    if structure_path is not None and not structure_path.exists():
        raise RuntimeError(f'Structure JSON does not exist: {structure_path}')
    if issue_path is not None and not issue_path.exists():
        raise RuntimeError(f'Issue file does not exist: {issue_path}')

    structure_report = load_json(structure_path) if structure_path else None
    raw_issues = load_json(issue_path) if issue_path else []
    if raw_issues is None:
        raw_issues = []
    if not isinstance(raw_issues, list):
        raise RuntimeError('Issue file must contain a JSON array')
    issues = [normalize_issue(item) for item in raw_issues]

    report = build_report(
        task_family=args.task_family,
        pdf_path=pdf_path,
        pages_dir=pages_dir,
        structure_report=structure_report,
        issues=issues,
    )

    if args.format == 'json':
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(report))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f'rendered_report.py failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
