# multilang-research-report

> Multi-country regulatory survey template. Playwright HTML+CSS, A4 portrait, CJK multi-language
> font cascade, per-country sections + horizontal comparison table + references. For the production
> AI voice cloning case, read `../../docs/ai-voice-cloning-regulatory-report-case.md`.

## 1. When to use

- **EN keywords**: research report, regulation, multi-country, cross-jurisdiction, deep research,
  comparative study, policy analysis
- **CN keywords**: 监管、调研报告、多国对比、深度研究、跨国法律对比、行业研究、政策分析
- **Sample user asks**:
  - "Produce a deep regulatory survey on global AI voice cloning, covering CN / EU / US / JP / KR —
    each country needs laws, regulators, enforcement cases, and industry self-regulation."
  - "Create a 50-60 page cross-jurisdictional regulatory comparison covering 5 countries with
    horizontal comparison + 100+ sourced references."

## 2. Pipeline

**Playwright HTML+CSS direct render -> PDF.** Does NOT use the token pipeline.

Why not the token pipeline:

- Multi-language CJK (SC / JP / KR) needs precise `@font-face` + `font-family` cascade control.
- 60 pages of structured prose + 6xN comparison tables + 100+ reference rows need full CSS control.
- The token pipeline's font fallback collapses on Korean hangul.

## 3. Document shape

- **Pages**: ~50-90 (typical 59).
- **Structure**: cover -> exec summary -> TOC (dot leaders + page numbers) -> per-country x N
  sections (4 subsections: laws / regulators / cases / self-regulation) -> horizontal comparison
  table -> conclusion -> references -> appendices.
- **Page size**: A4 portrait.
- **Citations**: 150-200+, A/B/C reliability grading.

## 4. Visual params

**Palette** (academic / governmental muted tone):

- Primary `#1a3d7c` navy (H1 + table headers)
- Text `#111` near-black
- Table zebra `#fafbfd` light
- Muted `#888` border

**Typography** (CJK cascade — **order matters**):

```css
font-family:
  'PingFang SC',
  /* CN simplified, primary */ 'Hiragino Sans',
  /* JP fallback */ 'Apple SD Gothic Neo',
  /* KR — required! Hiragino does NOT cover hangul */ 'Helvetica Neue',
  /* Latin fallback */ sans-serif;
```

**Layout**:

- TOC: dot leaders + right-aligned page numbers.
- Tables: `border-collapse`, 9.5pt body, navy header background, zebra even rows,
  `page-break-inside: avoid`.
- Headings: H1 navy 20pt + 2.5pt underline (`page-break-before: always` except for the first
  section), H2 14pt + left rule, H3 12pt muted navy.
- Line-height: 1.55-1.62 (CJK collision protection).
- Margins: 20 mm top / sides, 22 mm bottom.

## 5. Skeleton

See [`skeleton.html`](skeleton.html) (~200 lines; one representative per-country section provided —
duplicate it per country in the loop).

**Quick start**:

```bash
cp templates/multilang-research-report/skeleton.html /tmp/report/page.html
# Edit --primary in :root.
# Duplicate the per-country section for each of your N countries.
node packages/local-runtime/assets/skills/pdf/scripts/render_html.cjs /tmp/report/page.html /tmp/report/out.pdf
```

## 6. Pitfalls (from m15 production)

- **Hiragino does not cover Korean hangul** — fatal: Hiragino Kaku Gothic / Hiragino Sans cover SC +
  JP, but Korean characters fail. **Apple SD Gothic Neo / Noto Sans CJK KR must be added explicitly
  to the cascade.** Test by rendering "中日本국語" — all five characters must display correctly.
- **Last page < 1/3 full — P0 fail**: trigger content expansion (add a glossary / case timeline /
  legislative evolution); **do not** shrink margins to force a fit.
- **Citation drift across N countries**: country A grades the ECJ as A, country B grades it as B.
  **Freeze `references_master.md` within the first 3 iterations** to lock the A/B/C grading scheme.
- **Multi-language inline mixing** needs `lang="zh-CN"` / `lang="ko"` / `lang="ja"` on `<p>` /
  `<td>` to enable correct hyphenation / line-breaking.
- **Table cell overflow**: 9pt + Korean + English URLs in a narrow column overflow. Use
  `td { word-break: break-word; vertical-align: top; padding: 6pt; }`.
- **Cascade order**: SC -> JP -> KR -> Latin -> generic. Reordering causes tofu boxes.

## 7. Generalization

**Required placeholders / swappable**:

- `JURISDICTION_COUNT` (5 is the baseline; 3-10 ok).
- `COUNTRY_LIST` -> loop structure: `COUNTRY_CODE` (CN/EU/US/KR/JP) / `COUNTRY_NAME` /
  `LEGAL_FRAMEWORK_TEXT` / `STATUTE_NAMES` / ...
- `LAW_NAME` (per country x per section).
- `CASE_PARTIES` / `CASE_VERDICT` / `CASE_YEAR`.
- `DIMENSION_LIST` (6 baseline: legal hierarchy / core statutes / penalties / disclosure / effective
  date / consent standard).
- Comparison-table column count = `JURISDICTION_COUNT + 1`.

**Optional sections**:

- Case studies (1-3 per country vs zero).
- Industry self-regulation (depends on the topic).
- Legislative timeline (track 3+ years of evolution).
- Cross-border enforcement cooperation (cross-border topics).

**Structural invariants**:

- Each section H1 has `page-break-before: always`.
- Subsections follow a fixed H2 order: §1 legal framework / §2 regulators / §3 cases / §4
  self-regulation.
- One 6xN horizontal comparison table.
- References use `[CODE-##]` format (CN-1 / EU-27 / US-48).
- Last page is the appendices (acronym table, version stamp).

**Swappable subject domains** (verified path: AI voice cloning; generalises to: data privacy +
cross-border, chip export controls, crypto regulation, biometrics):

- Required: >= 3 jurisdictions + >= 2 statutes per jurisdiction +
  > = 2 cases per jurisdiction + 50+ sources.
- Font stack stays put (CJK is critical).
- Comparison dimensions adapt (crypto: custody rules / AML / DeFi treatment).

**Diversify every run.** The §4 baseline (academic navy + zebra tables) is the m15 rendition of one
specific topic — do not paste it onto every research report. Adapt the primary color to match the
subject domain (privacy: green; chip export: industrial gray; crypto: amber), re-pick the table
accent, and re-cut the comparison dimensions per topic. Two reports on different subjects should
read as different publications, not two coats of paint on the same template.

## 8. Production case

- **AI voice cloning regulatory survey** — five-jurisdiction Chinese regulatory PDF with bilingual
  research prompts, `docs/` + `data/` research artifacts, fact-check report, optimized dark academic
  cover, KPI cards, compact horizontal comparison table, and source ratings. Read
  [`../../docs/ai-voice-cloning-regulatory-report-case.md`](../../docs/ai-voice-cloning-regulatory-report-case.md)
  and regenerate from
  [`cases/ai-voice-cloning-regulatory/source.html`](cases/ai-voice-cloning-regulatory/source.html).
