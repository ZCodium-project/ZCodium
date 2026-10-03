# Troubleshooting

The first thing to do, always:

```bash
bash scripts/make.sh check
```

If `check` is already green, work through the table below.

## Symptom table

| Symptom | Most likely cause | Fix |
|---|---|---|
| `[ ] [ ] [ ]` boxes for CJK text | The host has no system CJK font, or the HTML font cascade is missing PingFang / Hiragino / Apple SD Gothic Neo | Check the cascade in [`html-pdf-spec.md §4`](html-pdf-spec.md#4-typography); install a CJK font (`brew install font-noto-sans-cjk-sc`) |
| Cover PDF blank / partial / browser not found | Playwright Chromium not installed | `npx playwright install chromium`, or `bash scripts/make.sh fix` |
| Output PDF is < 5 KB / `render_html.cjs` exits 3 | The source HTML had a JS error (CDN 404, syntax error, etc) | Open the source HTML in a browser, check the Console; vendor the script if a CDN is unreachable |
| **Blank chart canvases in the PDF** | Chromium snapshotted the page before Chart.js painted | Pass `--wait 15000` to `make.sh render`; set `Chart.defaults.animation = false` once at the top of the page's `<script>` |
| **Body text in default sans / serif** | Web fonts didn't load before snapshot | Use the system stack from [`html-pdf-spec.md §4`](html-pdf-spec.md#4-typography), or `@font-face` from a local file under `assets/fonts/` (the renderer waits for `document.fonts.ready` automatically) |
| **Print color desaturated** (cover gradient looks washed out, KPI cards lose tint) | Missing `print-color-adjust: exact` | Apply the rule to the **universal selector** `*`, not just `body` |
| **Charts split across pages** | Missing `.avoid-break` wrapper around `.chart-card` | Wrap every chart card with `<div class="chart-card avoid-break">` |
| **A page has > 1/3 blank at the bottom** | A protected element (chart card / table / `page-break-before` H1) didn't fit the remaining space and got pushed to the next page | Don't ship half-empty pages. Three fixes (see [`html-pdf-spec.md` §3.2](html-pdf-spec.md#32-page-balance--every-page-must-be-full--23)): (1) **pull** small primitives from the next section into this page (insight callout, takeaway row, footer note); (2) **expand** current section (longer lead, key-facts table, split one big chart into two); (3) **re-order** so a tall element doesn't get orphaned. Never use `<br>` / spacers / shrunk margins to fake fullness |
| **Cover / hero squished into top half of page** | HTML used `100vh` / `100%` height (viewport-bound, not page-bound) | A4 portrait at 14 mm margins → use `height: 268mm` (computed: 297 − 2×14 − 1 mm bleed). For other margins, recompute. Never `vh` / `vw` for page-level sizing |
| **Content overflows / huge empty bands at bottom** | CSS declared `@page { size: 8.5in 11in }` (Letter) but renderer prints `--format A4` (default) | Either change CSS to `@page { size: A4 portrait }` (preferred) or pass `--format Letter` to `make.sh render` so CSS and PDF format match. Audit existing skeleton.html files: `grep -nE "8\.5in 11in\|Letter" templates/**/*.html` |
| **Hero / section visually short, leaves bottom strip empty** | Designed at 16:9 or 4:3 aspect ratio (laptop-screen mindset) | A4 is **1 : 1.414** (taller than any laptop). Hero blocks should be ≈ 5:7. See [`html-pdf-spec.md` §1](html-pdf-spec.md#1-page-geometry) capacity numbers |
| **Browser preview shows one giant horizontal page (not A4)** | `@page` is print-only; on screen the body fills the viewport (~1440px laptop) | Add the standard `@media screen` block from [`html-pdf-spec.md` §1](html-pdf-spec.md#screen-emulation-block--make-open-pagehtml-look-like-the-pdf) — every section then renders as a 210×297mm sheet on a gray backdrop. Or temporarily: Chrome DevTools → Rendering → Emulate CSS media type → `print` |
| **`3nm⊃2;` artifacts in the PDF** | HTML entity typo where superscript was intended | Paste real unicode (`²` `³` `⁺` `™` `°`); never use `&sup` or `⊃` for superscripts |
| **Class / style / attribute silently ignored, layout broken** | CJK full-width quotes (`"` `"` `'` `'`) in HTML attributes or CSS syntax — Chromium can't parse them | `grep -nP '[""''；：，（）]' page.html` and replace with ASCII `"` `'` `;` `:` `,` `()`. Full-width is fine inside body prose between tags, **never** in code |
| Tables eat too much horizontal space | Full-width CJK punctuation (`（）`、`：`、`／`) inside narrow cells | Use half-width punctuation (`()`, `:`, `/`) in table cells; keep full-width in body prose |
| Last page is < 1/3 full | Content didn't expand to fill the budget | Add a takeaway list / footer references / appendix; do **not** shrink margins to force-fit |
| `ls -la report.pdf` shows a file but content is wrong | Existence is not success | Verify with `pdftotext -layout report.pdf - \| head -40` and `pdfinfo report.pdf \| grep Pages` |
| `make.sh fix` printed `OK` but `make.sh check` still warns | Re-run `make.sh fix` — the current implementation prints the actual `pip` failure | If `pip` itself is missing (rare venv setup), run `python3 -m ensurepip --upgrade` |
| `AttributeError: module 'inspect' has no attribute 'signature'` | A directory called `inspect/` is shadowing the stdlib `inspect` module on `sys.path[0]` | The skill ships FILL helpers under `scripts/pdf_inspect/` to avoid this; if you copied an older snapshot with `scripts/inspect/`, rename it. As a one-shot escape, `export PYTHONSAFEPATH=1` (Python 3.11+) drops the script-directory entry from `sys.path` |
| REFORMAT loses my H1 | `reformat_parse.py` lifts the first H1 as the cover title (intentional) | Pass `--title "Different Title"` explicitly; the source's H1 will then stay in body |
| Chromium hangs > 60 s during render | Source HTML waiting on a slow / hanging CDN | Vendor the external script (Chart.js, web fonts) next to the HTML and reference with a relative path |

## Chart.js render-timing checklist

When charts render blank in the PDF but look fine in the browser:

1. `Chart.defaults.animation = false;` at the top of the init `<script>`.
2. `bash scripts/make.sh render --in page.html --out out.pdf --wait 15000`
   (default `--wait 800` is too short for non-trivial charts).
3. Each `<canvas>` parent has `.avoid-break` (otherwise mid-chart page split
   looks like a blank canvas).
4. Open the source HTML in Chrome, check Console for errors. Common ones:
   - `Chart is not defined` — the CDN didn't load (vendor it locally).
   - `Cannot read properties of null` — wrong canvas ID in `getElementById`.

## CJK support

The skill renders CJK via the system font cascade declared in your HTML:

```css
font-family:
  -apple-system, BlinkMacSystemFont, "SF Pro Display",
  "PingFang SC",            /* Simplified Chinese — keep first */
  "Hiragino Sans",          /* Japanese fallback */
  "Apple SD Gothic Neo",    /* Korean — required for hangul */
  "Helvetica Neue", Arial, sans-serif;
```

**Cascade order matters.** Putting `Hiragino Sans` before `PingFang SC`
renders simplified-Chinese characters in JP forms. If hangul renders as
tofu, add `Apple SD Gothic Neo` (macOS) or `Noto Sans CJK KR` (Linux).

If you embed `@font-face` from a CDN, the renderer waits for
`document.fonts.ready` automatically (15 s cap). Prefer local font files
under `assets/fonts/` — CDN flakiness is the #1 reason fonts fall back.

## Verification reminder

Before you declare a job done, run at least these checks:

```bash
pdfinfo out.pdf | grep Pages
pdftotext -layout out.pdf - | head -40
ls -lh out.pdf            # should be > 50 KB for a real report
open out.pdf              # eyeball — do charts actually render?
```

For a programmatic visual check (compare against a baseline image):

```bash
pdftoppm -r 90 -png -f 1 -l 1 out.pdf _verify
```
