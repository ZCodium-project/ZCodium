# HTML → PDF Spec

> The single source of truth for *how* a CREATE / REFORMAT HTML page must be
> authored so it survives Chromium's print snapshot. Every template's
> `skeleton.html` is wired up to follow this spec; if you write a fresh HTML
> from scratch, follow this checklist before invoking
> `bash make.sh render`.

The pipeline is fixed: **HTML (file or URL) → Playwright Chromium →
`page.pdf()`**, driven by [`scripts/render_html.cjs`](../scripts/render_html.cjs).
There is no token pipeline, no ReportLab, no LaTeX. If a primitive cannot be
expressed in HTML+CSS+JS, it does not belong in this skill.

---

## 1. Page geometry

```css
@page { size: A4 portrait; margin: 14mm 12mm; }   /* default for reports */
@page { size: A4 landscape; margin: 12mm 14mm; }  /* dashboards / wide tables */
@page { size: Letter portrait; margin: 0.75in 0.6in; }  /* US-only audience */
```

**A4 is the default — design every HTML against the A4 aspect ratio.**
The renderer (`render_html.cjs`) defaults to `--format A4`, and Chromium's
`page.pdf({ format: 'A4' })` *overrides* any CSS `@page { size: 8.5in 11in }`
you may have inherited from a web template. Mismatches between the CSS you
wrote-for and the format the renderer prints-to are the most common source
of "huge margins / clipped content / 16:9 layout that looks tiny on the
page" complaints.

Concrete numbers to design against (A4 portrait, 14×12 mm margins):

- Page size: **210 × 297 mm** (1 : 1.414 aspect ratio)
- Content area: **186 × 269 mm**
- Aspect ratio for full-bleed sections / hero blocks: **roughly 5 : 7**
  (taller than your laptop screen — do not assume 16:9 or 4:3)

Hard rules:

- **Always declare `@page`.** Without it Chromium picks 8.5×11 with 1-inch
  margins, and your layout drifts.
- **Don't write `8.5in 11in` or `Letter` unless the user is US-only.** It
  will be silently overridden to A4 by the renderer's `--format A4`
  default; the visual result is "your CSS thinks Letter, the PDF is A4"
  and content overflows or gets cropped. Either author against A4 in CSS,
  or pass `--format Letter` to the renderer to make CSS and PDF match.
- **Use `mm` / `in`, not `px`.** Pixels render at 96 DPI in Chromium and
  look fine on screen but wrong in print. `vw` / `vh` / `100%` height
  are also off-limits at the page level — you will get one "screen" per
  page instead of A4 pages.
- The renderer accepts `--margin "14mm 12mm"` and `--format A4|Letter`;
  CSS `@page` takes precedence over the CLI flags only when both are set.
- **Cover / full-bleed sections**: explicit `height: 268mm` (A4 portrait
  297 − 2×14 mm − 1 mm bleed). For other margin schemes, recompute:
  `height = 297 - top_margin - bottom_margin - 1mm`. Don't use `100vh` —
  it expands with viewport, not with the printed page.
- **Charts / images** get `max-width: 100%` (relative to content area
  186 mm, not viewport). Set explicit `mm` heights on `.chart-wrap`
  rather than relying on `aspect-ratio` (Chromium's print pipeline
  computes aspect-ratio from screen, then prints; the 1.414 page ratio
  isn't applied).

### Screen-emulation block — make `open page.html` look like the PDF

The `@page` rule is **ignored on screen**, so opening the source HTML in
a browser shows one giant horizontal page that looks nothing like the
A4 PDF. **Every skeleton must include this `@media screen` block** so
the browser preview reads as a stack of A4 sheets — the agent (and the
human reviewer) gets the same geometry in both views, no surprise at
PDF time.

```css
@media screen {
  html { background: #d0d0d0; }
  body { margin: 0; padding: 20px 0; }
  /* Each top-level <section> renders as one A4 sheet on screen */
  body > section {
    width: 210mm;
    min-height: 297mm;        /* full A4; cover's height: 268mm is overridden up */
    margin: 0 auto 20px;
    background: #fff;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18);
    box-sizing: border-box;
    overflow: hidden;
  }
}
```

Notes:
- The block is **screen-only**; `@page`, page-breaks, and Chromium's PDF
  pipeline are unaffected.
- Sections that already have their own background (`.cover` linear-
  gradient, dark conclusion blocks) keep their styling because class
  selectors out-rank the type selector `body > section`.
- This is *visual* parity, not pixel-perfect — `page-break-inside: avoid`
  and Chart.js render timing only run during PDF generation. For
  pixel-perfect screen parity, opt in to a paged-media polyfill
  ([Paged.js](https://pagedjs.org/)); not required by default.

## 2. Universal print color fidelity

```css
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
```

- Apply to the **universal selector**, not just `body`. Gradient KPI cards,
  cover gradients, and dark conclusion blocks all desaturate without this.
- The renderer defaults to `printBackground: true`. Pass `--no-print-background`
  only when you want a transparent body (rare).

## 3. Page-break rules

### 3.1 Protect elements from being split

- Wrap every chart / large table / multi-column card in a container with
  `page-break-inside: avoid` (use `.avoid-break { page-break-inside: avoid }`).
- Use `page-break-after: always` on a wrapper element to force a split (e.g.
  cover page, end of a chapter). **Use sparingly** — every forced split is a
  page that can become half-empty.
- Headings should declare `page-break-after: avoid` (don't strand a title at
  the bottom of a page).
- **Never** use absolute positioning to "fix" a layout that overflows. Re-flow
  with `flex` / `grid` and adjust the `mm` sizing.

### 3.2 Page balance — every page must be full (≥ 2/3)

A protected element (chart card, table, conclusion block) that doesn't fit
in the remaining space gets pushed to the next page, leaving a fat blank
gap above it. Same for `page-break-before: always` on a section that comes
right after a short subsection. **This is the #1 cause of "amateurish"
PDFs.** Inspect every page and fix any blank gap > 1/3 of the page height.

**Estimate before authoring.** Rough capacity for A4 portrait at 14×12 mm
margins, body 10.5 pt / line-height 1.55:

| Element | Vertical cost (approx.) |
| --- | --- |
| Section header (eyebrow + h2 + rule) | 28 mm |
| Lead paragraph (3 lines) | 18 mm |
| KPI 4-grid (one row) | 28 mm |
| Chart card (default `.chart-wrap`) | 100 mm |
| Chart card (`.tall`) | 130 mm |
| Data table (10 rows) | 70 mm |
| Insight callout (1 paragraph) | 18 mm |
| Recommend triple (3-up cards) | 70 mm |
| Versus pair (2-up cards) | 65 mm |
| Body line | ~5 mm |

A4 content height ≈ **268 mm** (297 − 2×14 mm margin). Add up the elements
on a page, check whether they fit. If a chart card (100 mm) lands on a page
that already has 200 mm filled, **don't let it spill** — either pull
something forward (a small insight / takeaway) to fill the gap on the
current page, or re-order so the chart card starts the next page.

**Three fixes when a page has > 1/3 blank** (from cheapest to most-invasive):

1. **Pull next-section content backward** into the current page. Small
   primitives travel well: insight callouts, takeaway rows, a footer-meta
   block, even one extra KPI card. Move them across the section boundary
   (the visual section break still works because the H2 below is
   unmistakable).
2. **Expand current-section content**. Lengthen the lead paragraph,
   add a 4-row "key facts" mini-table, or split a single big chart into
   two smaller ones (one "overview", one "detail").
3. **Re-order major elements** so a tall element doesn't get orphaned.
   Move a long table before a chart card if the table fills the gap better.

**Three things you must NOT do**:
- ❌ Add `<br>` / `&nbsp;` / `.spacer { height: 50mm }` to fake fullness.
- ❌ Shrink page margins (`@page margin: 8mm`) to force-fit content.
- ❌ Inflate font-size / line-height purely to consume space.

**page-break-before discipline**: only `<h1>` / cover / chapter headers
should carry `page-break-before: always`. H2 and H3 must not — that's
how short subsections create huge gaps. Sections that flow naturally fill
better than sections that hard-split.

**The check is iterative**. After the first render, open the PDF and
look at every page bottom. Fix the worst gap, re-render, repeat. Don't
declare done until the worst-page-gap is ≤ 1/3.


### 3.3 Running headers and footers

Headers/footers are part of the document contract, not decoration. For any formal or multi-page output (contracts, proposals, reports, forms, manuals, translated documents), decide and implement them before the first serious render.

Decision rules:

- If the source document has headers/footers, preserve their text and placement unless the user asks for a redesign.
- If the source has no headers/footers but the output is formal and multi-page, add a conservative running header/footer: document title or section identity in the header, page number or classification/date in the footer.
- Keep cover/title pages clean unless the source explicitly has first-page headers/footers.
- If no header/footer is appropriate (poster, single-page certificate, full-bleed cover), state that decision in the delivery note.

Implementation pattern for hand-authored HTML:

```css
@page { size: A4 portrait; margin: 18mm 20mm; }
.page {
  position: relative;
  min-height: 261mm;      /* 297 - top/bottom @page margins */
  padding-top: 10mm;      /* reserved header area */
  padding-bottom: 12mm;   /* reserved footer area */
  break-after: page;
}
.cover { padding-top: 0; padding-bottom: 0; }
.running-header {
  position: absolute; top: 0; left: 0; right: 0; height: 7mm;
  border-bottom: 0.5pt solid #bdbdbd;
  font-size: 8.5pt; color: #555; line-height: 7mm;
}
.running-header .left { float: left; }
.running-header .right { float: right; }
.running-footer {
  position: absolute; bottom: 0; left: 0; right: 0; height: 8mm;
  border-top: 0.5pt solid #bdbdbd;
  font-size: 8.5pt; color: #555; line-height: 8mm; text-align: center;
}
```

```html
<section class="page">
  <div class="running-header"><span class="left">Document title</span><span class="right">Section</span></div>
  <!-- page content -->
  <div class="running-footer">Page 1</div>
</section>
```

Verification:

- Rasterize at least one body page and the last/signature/table-heavy page; confirm header/footer alignment and no overlap.
- `pdftotext` should expose running text/page numbers, but visual raster is the real gate.
- If a footer collides with a table/chart, increase `.page` bottom padding or split/reflow the protected element; do not shrink margins below the document standard just to fit it.

### 3.4 Clickable TOC / index links

Every generated multi-page PDF must include a visible table of contents or
index that links to the corresponding section pages. This is part of the PDF
navigation contract, not optional decoration.

Author HTML TOCs with internal anchors and stable target IDs:

```html
<nav class="toc" aria-label="Table of contents">
  <a class="toc-row" href="#sec-summary">
    <span>Executive summary</span><span class="page-ref">2</span>
  </a>
  <a class="toc-row" href="#sec-methodology">
    <span>Methodology</span><span class="page-ref">5</span>
  </a>
</nav>

<section class="page" id="sec-summary">
  <h2>Executive summary</h2>
  ...
</section>
```

Rules:

- Every major section, appendix, and reference block gets a unique ASCII `id`.
- TOC rows are real `<a href="#...">` links, not inert `<div>` rows styled to
  look like links.
- Displayed page numbers must match the rendered PDF. If the final page count
  shifts, re-render or update the TOC before delivery.
- Keep TOC styling print-friendly: visible row text, dot leaders or right-aligned
  page numbers, and sufficient line height for clicking.
- If the PDF is assembled after rendering (merge/split/reportlab/pypdf), add PDF
  outline/bookmarks and `/Link` annotations so the visible TOC remains clickable.
- Single-page posters/forms/certificates may omit the TOC, but the delivery note
  must explicitly state that it was omitted because the document is one page.

Verification:

- Inspect the final PDF in a viewer and spot-click at least 3 TOC entries (or all
  entries when fewer than 3) to confirm they jump to the intended pages.
- Use `pdfinfo out.pdf` and/or a short `pypdf` probe to confirm link annotations
  or outlines exist; `pdftotext` alone is insufficient because it cannot prove
  clickability.
- For long documents, also verify that the PDF side-panel outline/bookmarks
  match the visible TOC hierarchy when bookmarks are expected.

## 4. Typography

```css
body {
  font-family:
    -apple-system, BlinkMacSystemFont, "SF Pro Display",
    "PingFang SC",        /* Simplified Chinese — keep for CN content */
    "Hiragino Sans",      /* Japanese fallback */
    "Apple SD Gothic Neo",/* Korean — REQUIRED for hangul, Hiragino doesn't cover it */
    "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
```

- Body 10–11 pt, line-height 1.45–1.7. Below 10 pt becomes hard to read;
  above 12 pt eats too much page area.
- **Cascade order matters for CJK.** If you put `Hiragino Sans` before
  `PingFang SC`, simplified-Chinese characters render in JP forms.
- Don't ship a CDN webfont and hope it loads — Chromium prints whatever it
  has at snapshot time. Either use system fonts (above) or `@font-face` from a
  local file under `assets/fonts/` and rely on
  `page.waitForFunction(() => document.fonts.ready)` (the renderer already
  does this).

## 5. Color & accessibility

- **One accent color** per document. Section-line, chart-title bar, primary
  bar fill, link border — all the same hex.
- **At most 3 data colors + 1 accent + 5 grayscale shades.** More than that
  is visual noise.
- Accent contrast vs background ≥ **4.5:1** (WCAG AA). Skip pure blue
  (`#007AFF`) for non-Apple-themed reports — overused.
- 5-level status pills are fixed semantics, do not invent more:

| Class | Background | Text | Meaning |
| --- | --- | --- | --- |
| `pill-bad` | `#ffebee` | `#c62828` | hard fail |
| `pill-warn` | `#fff3e0` | `#e65100` | risky / borderline |
| `pill-ok` | `#e8f5e9` | `#2e7d32` | passes baseline |
| `pill-good` | `#e3f2fd` | `#1565c0` | comfortably exceeds |
| `pill-best` | `#f3e5f5` | `#6a1b9a` | top-tier / recommended |

## 6. Charts (Chart.js)

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
  Chart.defaults.animation = false;        /* CRITICAL — see below */
  Chart.defaults.font.family = '-apple-system, "PingFang SC", sans-serif';
  Chart.defaults.font.size = 10;
  Chart.defaults.color = '#424245';
  // … new Chart(...)
</script>
```

- **`Chart.defaults.animation = false`** is non-negotiable. With animation on,
  Chromium frequently snapshots mid-frame and you get a half-drawn bar.
- Render with `--wait 15000` (15 s settle window) when the page has Chart.js,
  lazy images, or any other late-loading JS. Default `--wait 800` is enough
  for static HTML.
- Wrap each `<canvas>` in `.chart-card.avoid-break` so a chart never splits
  across pages.
- **Two-decade value range (e.g. 80 vs 5,841)** — use `scales.x.type:
  'logarithmic'` (or `y.type`) and call out the log scale in the chart's
  sub-title.
- **Dual-axis charts** require `position: 'right', grid: { display: false }`
  on the secondary axis.
- 8 baseline chart types live in
  [`templates/data-viz-report/skeleton.html`](../templates/data-viz-report/skeleton.html):
  dual-axis bar+line, horizontal grouped bar, grouped vertical bar, scatter
  matrix, stacked bar, log-axis bar, radar, dual-axis bar (price/power).
  Copy from there before writing fresh init code.

## 7. Tables

- 9–9.5 pt body, 8.5 pt header, line-height 1.4–1.5.
- `border-collapse: collapse`, zebra `nth-child(even)` row, `padding: 7px 10px`.
- `page-break-inside: avoid` on small tables; for large tables, allow split
  but repeat headers via `<thead>`.
- **Use half-width punctuation inside cells** (`()`、`:`、`/`). Full-width
  CJK punctuation forces line-wrap in narrow columns.
- Status badges go in their own column with one of the 5 `pill-*` classes.

## 8. Images / SVG / icons

- Inline SVG is the most reliable; `<svg>…</svg>` direct or
  `data:image/svg+xml;base64,…`.
- For raster images, prefer **inline base64** (`data:image/png;base64,…`) or
  absolute `file://` paths. `http://` is fragile in headless mode.
- Lazy-loaded `<img loading="lazy">` may not paint in time — pre-load via
  `<link rel="preload" as="image" href="...">` or remove the attribute.
- `max-width: 100%; height: auto;` on every body image.

## 9. Special characters & encoding

- **Don't fake superscripts with HTML entities.** `3nm⊃2;` (intent: `3nm²`)
  prints the literal `⊃2;`. Paste real unicode: `²` `³` `⁺` `⁻` `™` `°` `µ`.
- **Never use full-width / CJK quotes in HTML or CSS syntax.** Editors that
  default to 中文标点 will silently turn `"` into `“ ”` and `'` into `‘ ’`,
  producing invalid markup that Chromium parses as a malformed attribute /
  selector. Symptoms: attributes get dropped (`class=` becomes inert),
  `font-family` falls back, charts won't render. Always type ASCII
  `"` / `'` in:
  - HTML attribute values: `class="kpi blue"`, `<a href="...">` — never
    `class=“kpi blue”`
  - CSS string values: `font-family: "PingFang SC"` — never `"PingFang SC"`
  - JS string literals: `'use strict'` — never `‘use strict’`
  - JSON / template literals
  Full-width quotes are fine in **body prose** between tags, e.g.
  `<p>他说"你好"</p>`. The rule is structural-syntax-only.
- **Other CJK punctuation also breaks syntax.** Watch for `；`(；vs `;`),
  `：`(：vs `:`), `，`(，vs `,`), `（）`(（）vs `()`), and `——`(em-dash
  used as JS minus). Same rule: full-width OK in prose, ASCII-only in code.
- **Don't write `&amp;` in HTML attributes you've already escaped.** Use a
  raw `&` inside CDATA / template literals.
- Always declare `<meta charset="UTF-8">` in `<head>`; without it, Chromium
  guesses Latin-1 and CJK becomes mojibake.

## 10. Resource bundling / offline rendering

- The renderer respects `--wait` for CDN-loaded scripts but cannot recover
  from a hard 4xx. If the agent runs offline (corporate VPN, sandbox), vendor:
  - `chart.js@4.4.0/dist/chart.umd.min.js` → `templates/<slug>/vendor/`
  - any `@font-face` woff2 files → `templates/<slug>/assets/fonts/`
  Reference them with relative paths from the HTML file.

## 11. Quality gate (agent self-check before declaring done)

Run these every time before reporting "PDF ready":

```bash
# 1. The PDF actually exists and is non-trivial
ls -lh out.pdf
[[ $(stat -f%z out.pdf 2>/dev/null || stat -c%s out.pdf) -gt 50000 ]] || echo "FAIL: too small"

# 2. Page count matches expectation
pdfinfo out.pdf | grep Pages

# 3. Body text is extractable (not rasterized) — first 40 lines should be readable
pdftotext -layout out.pdf - | head -40

# 4. Visual eyeball check — open EVERY page, look at the bottom of each
open out.pdf      # macOS — confirm charts drew, no blank canvases, fonts correct
                  # AND no page has > 1/3 blank below the last element (see §3.2)
```

Before committing the source HTML, confirm:

- [ ] All `<!-- PLACEHOLDER -->` tokens replaced (search for `<!--`).
- [ ] `@page { size: A4 portrait }` matches the renderer's `--format`
      (default A4). No stray `8.5in 11in` / `Letter` in the source unless
      you also pass `--format Letter`. Cover heights computed from page
      size minus margins, **not** `100vh`.
- [ ] **Source HTML includes the `@media screen` block** (see §1) so
      `open page.html` in a browser shows the same A4 sheet stack as the
      PDF. If the browser preview is one wide horizontal page, the block
      is missing — the agent and reviewer will both be misled by the
      wrong geometry. Don't trust browser preview without it.
- [ ] No `⊃2;` / `&sup` / `&amp;` artifacts in the output.
- [ ] No CJK full-width quotes / punctuation in HTML/CSS/JS syntax
      (only `"` `'` `;` `:` `,` `()` allowed in code; full-width is
      fine inside prose between tags).
- [ ] Each `<canvas>` parent has `.avoid-break`.
- [ ] `Chart.defaults.animation = false` is set.
- [ ] **Every page is ≥ 2/3 full** — flip through the whole PDF,
      not just the last page. Any page with a > 1/3 blank gap below
      the last element must be fixed (pull next-section content forward,
      expand current content, or re-order — see §3.2). Don't ship
      half-empty pages.
- [ ] Every multi-page PDF has clickable TOC/index navigation to the
      corresponding pages (or, for official/source-faithful exceptions,
      preserved/added outline navigation with the exception documented). Spot-
      click at least 3 entries and confirm link annotations/outlines exist;
      `pdftotext` alone does not prove navigation works.
- [ ] At most 3 data colors + 1 accent (re-skinned away from default blue).
- [ ] CJK source files use the SC → JP → KR → Latin font cascade.

## 12. Renderer reference

[`scripts/render_html.cjs`](../scripts/render_html.cjs):

```bash
node scripts/render_html.cjs \
  --in page.html --out report.pdf \
  [--wait 15000]              # extra settle (ms); 15000+ for Chart.js
  [--format A4|Letter]
  [--margin "14mm 12mm"]      # CSS margin shorthand (1/2/3/4 values)
  [--landscape]
  [--scale 1]                 # 0.1–2.0
  [--no-print-background]
  [--header <html>]           # page-header template (uses Playwright tokens like {pageNumber})
  [--footer <html>]
```

The renderer:
1. Loads `playwright` (local node_modules first, then global `npm root -g`).
2. `page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })`.
3. `page.waitForFunction(() => document.fonts.ready)` (best-effort, 15 s cap).
4. `page.waitForTimeout(--wait)` for late JS / charts.
5. `page.pdf(opts)` then writes `--out`.
6. Sanity check: output > 5 KB, otherwise exits 3.

## 13. Anti-patterns

| Don't | Why |
| --- | --- |
| Use `pixels` for layout | Print at 96 DPI — your margins drift |
| Use `vw` / `vh` / `100vh` for cover height | Bound to viewport, not the printed page → cover shrinks to single screen |
| Set `@page { size: 8.5in 11in }` while renderer prints A4 | CSS thinks Letter, output is A4 → content overflows or massive empty bands |
| Design hero sections at 16:9 / 4:3 | A4 is 1:1.414 (taller) — 16:9 hero leaves the bottom 1/3 blank |
| Skip `Chart.defaults.animation = false` | Mid-frame snapshots → blank charts |
| Ship CDN webfonts without `document.fonts.ready` | Body text falls back to default sans |
| `display: none` instead of `visibility: hidden` for print-only hides | Chromium drops the element from layout calc, breaking page-break math |
| Force-fit a thin last page by shrinking margins | Looks cramped, wastes white space — extend the content instead |
| Default to blue (`#007AFF`) for every report | Reports look identical, defeats the point of HTML flexibility |
| Inline JSON content > 1 MB in the HTML | Chromium parse + GC cost exceeds your `--wait` budget |
