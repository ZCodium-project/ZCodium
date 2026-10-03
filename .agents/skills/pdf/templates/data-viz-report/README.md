# data-viz-report

> Distilled from a 14-page Apple-M-series AI deployment analysis trace (cover + 3 parts +
> conclusion, 8 Chart.js charts). Playwright HTML+CSS, A4 portrait, **chart-rich** report driven by
> Chart.js v4 from CDN. Use this when the source content is **table- and number-heavy** and you want
> the PDF to feel like an Apple-style data brief, not a Word dump of the markdown.

## 1. When to use

- **EN keywords**: data report, visualization, dashboard PDF, hardware benchmark, comparison report,
  chart-heavy, infographic report, KPI brief, technical analysis, deep-research summary
- **CN
  keywords**: 数据可视化、图文报告、硬件评测、对比分析、跑分报告、基准测试报告、行业洞察、深度分析、可视化简报
- **Sample user asks**:
  - "把这份 markdown 评测报告做成数据可视化更好的 PDF。"
  - "Generate a chart-rich PDF brief for this hardware comparison spreadsheet — I want bars, radar,
    and KPI cards, not just tables."
  - "Turn this benchmark write-up into a designed PDF report with visualizations of the numbers."

**Pick a different template if** the source has < 4 quantitative tables / ≤ 1 chart-able dataset
(use `multi-article-aggregator` or the token pipeline) or is purely prose (use
`multilang-research-report`).

## 2. Pipeline

**Playwright / Chrome headless HTML+CSS → PDF, with Chart.js rendered in-browser before the print
snapshot.** Does NOT use the token pipeline.

Why not the token pipeline:

- Token pipeline has no chart primitives — bars, radar, scatter, dual-axis must be SVG hand-rolled
  per chart, which scales poorly past 3 charts.
- Chart.js gives you 8+ chart types with consistent styling for free.
- The "feel" of the trace (KPI cards + chart cards + insight callouts + pill badges + decision
  cards) is HTML/CSS-native and would explode the token catalogue.

**Architecture**: a single self-contained `report.html` (CSS + Chart.js init scripts inlined) +
Chart.js loaded from `cdn.jsdelivr.net` → Chrome headless with `--virtual-time-budget=15000` → PDF.

## 3. Document shape

- **Pages**: ~10–18 (typical 14).
- **Page size**: A4 portrait, 14 mm top/bottom, 12 mm sides.
- **Structure**:
  - **Cover** (full-bleed gradient, hero title, 2-line subtitle, 3 meta-stat chips bottom-left,
    version badge bottom-right).
  - **Prologue page** (`PROLOGUE · 引言` eyebrow + section-line + lead paragraph + 4 KPI cards
    summarizing the questions answered).
  - **Part 1 / 2 / 3 …** each starts with `PART NN · 标题` eyebrow. Each part has 2–4 H3
    subsections; each subsection mixes:
    - 4-up KPI card row (when there are headline numbers),
    - 1–2 chart cards (each card has its own title strip + sub),
    - a `data` table for full-fidelity reference,
    - a yellow `insight` callout for the takeaway.
  - **Conclusion** (3 dark `conclusion` cards, then 3 `takeaway` rows, then a footer-meta block with
    references).
- **Charts**: 6–10 (typical 8). Mix:
  - 1 dual-axis bar+line "evolution" chart,
  - 1 horizontal grouped bar (long category list, e.g. 14 chips),
  - 1 grouped vertical bar (cross-tab),
  - 1 scatter "matrix" (X = capacity, Y = bandwidth),
  - 1 stacked bar (model weight + KV cache vs total budget),
  - 1 logarithmic horizontal bar (when numbers span 2+ decades),
  - 1 radar (multi-dimensional positioning, 6 axes recommended),
  - 1 dual-axis bar (price + power, two units side-by-side).

## 4. Visual params

**Palette** (Apple-minimal tech tone — **swap for the subject domain**):

- Ink `#1d1d1f` (body text, KPI value)
- Sub-ink `#424245` / `#6e6e73` / `#86868b` (descriptors / muted)
- Surface `#fff` / Card-mute `#f5f5f7` / Hairline `#e5e5ea` / `#d2d2d7`
- Accent `#007AFF` (Apple blue — section-line, chart-title bar, primary bar)
- Data series 5-tone: `#5AC8FA` cyan / `#007AFF` blue / `#5e5ce6` indigo / `#34a853` green /
  `#FF9500` orange (use also for the second axis line)
- Status pills 5-level: bad `#c62828`/`#ffebee` · warn `#e65100`/`#fff3e0` · ok `#2e7d32`/`#e8f5e9`
  · good `#1565c0`/`#e3f2fd` · best `#6a1b9a`/`#f3e5f5`
- Cover gradient `linear-gradient(135deg, #0a1628 0%, #1d3557 50%, #2a5298 100%)` with two radial
  halo blobs (cyan top-right, violet bottom-left).

**Typography** (system stack — keeps render fast, no font shipping):

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  'SF Pro Display',
  'PingFang SC',
  /* Simplified Chinese — keep for CN reports */ 'Helvetica Neue',
  Arial,
  sans-serif;
```

- Body 10.5pt / line-height 1.55 / `-webkit-font-smoothing: antialiased`
- Section H2: 20pt 700, letter-spacing -0.5px
- Section eyebrow: 10pt 600, letter-spacing 3px, color = accent
- KPI value: 22pt 700; KPI unit: 11pt 500; KPI label: 8.5pt uppercase
- Chart title: 11pt 600 with a 4×14px accent rule prefix
- Pill badge: 8pt 500
- Cover hero H1: 38pt 700, letter-spacing -1px

**@page**:

```css
@page {
  size: A4 portrait;
  margin: 14mm 12mm;
}
* {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.page-break {
  page-break-after: always;
}
.avoid-break {
  page-break-inside: avoid;
} /* wrap every chart-card */
```

## 5. Skeleton

See [`skeleton.html`](skeleton.html) (~520 lines self-contained — embeds every component primitive:
cover, KPI grid, chart cards for 8 chart types, data table with pill badges, versus card, recommend
triple, dark conclusion cards, takeaway rows, timeline strip).

**Quick start**:

```bash
cp templates/data-viz-report/skeleton.html /tmp/report/page.html
# Edit:
#   1. <!-- REPORT_TITLE --> / <!-- REPORT_SUBTITLE --> / cover meta stats
#   2. :root accent + cover gradient (subject-domain match)
#   3. Each <!-- SECTION_NN --> block: title, lead, KPI numbers
#   4. Chart datasets in the bottom <script> (labels + numbers only)
#   5. Drop chart cards / KPI cards you do not need; keep the wrapper
#      classes intact.

# Render with Chrome headless — must give Chart.js time to draw.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=15000 \
  --run-all-compositor-stages-before-draw \
  --no-pdf-header-footer \
  --print-to-pdf="/tmp/report/out.pdf" \
  "file:///tmp/report/page.html"

# OR via the project's renderer (drives Playwright + same delays):
node packages/local-runtime/assets/skills/pdf/scripts/render_html.cjs \
  /tmp/report/page.html /tmp/report/out.pdf
```

## 6. Pitfalls (from the source trace)

- **HTML entity superscripts silently break.** Writing `3nm⊃2;` (intent: `3nm²`) renders the literal
  characters `⊃2;` in print. For superscripts, paste the actual unicode (`²`, `⁺`, `™`) or write the
  word ("二代", "v2"). Do a final search for `⊃` / `&sup` / `&amp;` in the HTML before rendering.
- **Chart.js needs explicit render time.** Without `--virtual-time-budget=15000` (or Playwright
  `waitForFunction`), Chrome snapshots the page before charts paint and you get blank boxes. Also
  disable Chart.js animation in JS: `Chart.defaults.animation = false;` — animated charts can also
  be captured mid-frame.
- **Two-decade value range crushes the smaller bar.** When comparing e.g. 80 tokens/s vs 5,841
  tokens/s on the same axis, the small bar becomes a 1-pixel sliver. Use
  `scales.x.type: 'logarithmic'` and call it out in the chart sub-title — the log axis itself is the
  message.
- **Dual-axis charts drop the right axis if you forget `position`.** Every secondary axis needs
  `{ position: 'right', grid: { display: false } }` or it overlaps the primary.
- **`page-break-inside: avoid` only works on a wrapped container.** The template wraps every chart
  in `.chart-card.avoid-break`. Charts placed directly under a section header without the wrapper
  will split across pages and look broken.
- **Print color drift.** Without `-webkit-print-color-adjust: exact; print-color-adjust: exact;` on
  `*`, chip background gradients (cover, KPI cards, dark conclusion) all desaturate. Apply the rule
  to the universal selector, not just `body`.
- **Chinese punctuation eats horizontal space in tables.** Full-width `（）`, `：`, `／` in narrow
  columns force line wrap. Use half-width `()`, `:`, `/` inside table cells; keep full-width in body
  prose.
- **Last page < 1/3 full.** Same rule as `multilang-research-report`: expand content (add a
  "三大核心收获" takeaway list, add a footer-meta references block) rather than shrinking margins.
- **CDN flakiness.** `cdn.jsdelivr.net` is the default; if the renderer runs offline, vendor
  `chart.umd.min.js` next to the HTML and load it with a relative
  `<script src="chart.umd.min.js"></script>`.

## 7. Generalization

**Required placeholders**:

- `<!-- REPORT_TITLE -->` / `<!-- REPORT_SUBTITLE -->` — cover hero copy.
- `<!-- COVER_TAG -->` — the eyebrow chip ("DEEP RESEARCH · 2026").
- `<!-- META_STAT_N_NUM -->` / `<!-- META_STAT_N_LABEL -->` — three cover stat chips (entity counts
  / questions / sources).
- `--accent: <!-- ACCENT_HEX -->` — the section-line / chart-title / primary-bar color (CSS
  variable).
- For each `SECTION`: `<!-- SECTION_NUM -->`, `<!-- SECTION_TITLE -->`, `<!-- SECTION_LEAD -->`, an
  array of KPI tuples `(label, value, unit, desc)`, and one or more chart datasets.
- For each chart: chart `id`, `type`, `labels`, `datasets`, axes config.

**Optional sections** (drop or duplicate freely):

- Timeline strip (for a generation / version progression — 3-5 stops).
- Versus card (head-to-head 2-column comparison).
- Recommend triple (entry / recommended / premium tier cards).
- Insight callout (yellow box with a 1-paragraph takeaway).
- Decision-tree pair (mirrors versus card; second axis is "if you are X").

**Structural invariants** (do not break):

- Cover is full-bleed and ends with `page-break-after: always`.
- Every `chart-card` is wrapped in `.avoid-break`.
- Every section starts with eyebrow + H2 + section-line, in that order.
- Chart.js is loaded once at the top; one `<script>` at the bottom initializes every chart in
  document order.
- `Chart.defaults.animation = false` is set globally.
- KPI grid is 4 columns on its own row; never inlined with prose.
- Status pills always carry one of the 5 semantic classes (`pill-bad/warn/ok/good/best`); custom
  colors break the legend.

**Diversify every run.** The §4 baseline (Apple navy gradient cover + `#007AFF` accent) is the
trace's rendition of one specific subject (consumer hardware). **Re-skin to the subject domain every
time:**

| Subject                            | Cover gradient     | Accent    | Data palette feel      |
| ---------------------------------- | ------------------ | --------- | ---------------------- |
| Consumer hardware / Apple-adjacent | navy → blue        | `#007AFF` | cool blues + indigo    |
| Finance / market data              | charcoal → emerald | `#0c8a5d` | greens + amber + slate |
| Healthcare / pharma                | teal → ivory       | `#0a7488` | teal + coral + sand    |
| Energy / industrial                | graphite → ember   | `#d4621a` | ochre + steel + brick  |
| AI / research lab                  | violet → midnight  | `#7c3aed` | violet + cyan + lime   |
| Sustainability / ESG               | forest → khaki     | `#3f7d3f` | leaf + earth + sky     |

Two reports on different subjects must read as two different publications — same primitives (cards,
chart cards, pills, conclusion blocks), different chrome (gradient, accent, data palette, eyebrow
wording, optional sections kept vs dropped). Reusing the navy/blue across every report defeats the
whole point of using HTML.
