# Case: MiniMax web brand guide two-pager

> CREATE route exemplar for turning a live brand website into an exact two-page A4 brand style guide. Store only editable source (`source.html`); do not commit generated PDFs.

## 1. Original user intent and acceptance criteria

**User ask:** “Generate a two-page Brand Style Guide for https://www.minimax.io/. Output as PDF.”

**Acceptance criteria:**

- Output is a polished PDF, exactly **2 pages**, A4 portrait.
- It reads like an official brand guide, not a generic website summary.
- It captures MiniMax identity from the site: wordmark/logo, mission language, multimodal model/product matrix, current product names, color mood, type hierarchy, voice rules, and do/don’t usage guidance.
- It preserves the best editable source for reuse; generated PDF files are disposable build artifacts.

## 2. Source inspection and parsing steps

Use the live site first, then inspect linked image assets. Do not infer the palette from prose alone.

```bash
TMP=/tmp/minimax-brand-guide
mkdir -p "$TMP"
python3 - <<'PYFETCH'
from pathlib import Path
import requests
url = 'https://www.minimax.io/'
Path('/tmp/minimax-brand-guide/site.html').write_text(requests.get(url, timeout=30).text, encoding='utf-8')
PYFETCH
```

High-signal content to extract from `https://www.minimax.io/`:

- Brand name: `MiniMax`.
- Mission/tagline language: `co-create intelligence with everyone` / `Intelligence with everyone`.
- Company position: “A world-leading general AI technology company.”
- Model/product breadth: text, speech, video, image, music; MiniMax M2.7, Music 2.6, Hailuo 2.3, Speech 2.8, MiniMax Agent.
- CTA/product rhythm: API platform, Agent, Hailuo, Audio, Talkie.
- Visual cues: dark ink hero cards, magenta/coral/violet gradients, soft light surfaces, rounded cards, large confident sans typography.

If the homepage is rendered by Next.js and the raw HTML is sparse, use a markdown fetch/browser snapshot and inspect image URLs from the rendered output. Prefer real logo assets (`logo_candidate.png` in this case) over a hand-drawn approximation.

## 3. Transformation prompt and terminology rules

No language translation was required. The transformation is **website → concise brand-system guide**.

Use this prompt pattern when asking an LLM or drafting manually:

```text
Create a two-page A4 brand style guide from the inspected MiniMax website.
Make it look like a real internal brand guideline, not a report.
Keep copy short and directive. Preserve exact product names and the mission phrase.
Use the real MiniMax wordmark/logo asset if available.
Structure:
Page 1: header with logo; large identity hero; six-color palette; typography/type scale.
Page 2: voice pillars; tagline lockup; product matrix rhythm; do/don't rules.
Tone: frontier but precise, human-scale, multimodal, production-ready.
Do not invent unsupported claims, statistics, or extra brand colors.
```

Terminology rules:

- Preserve product/model capitalization exactly: `MiniMax M2.7`, `Music 2.6`, `Hailuo 2.3`, `Speech 2.8`, `MiniMax Agent`.
- Use `co-create intelligence with everyone` as the long mission phrase; use `Intelligence with everyone.` as the short display lockup.
- Avoid vague claims such as “revolutionary AI” unless paired with product proof.
- Use `Do` / `Don't`, `Voice & Application`, `Product matrix rhythm`, and `Core palette extracted from current web assets` as concise guide labels.

## 4. Asset and layout preservation strategy

What made this case work:

1. **Real logo first.** The source HTML embeds the MiniMax logo as a data URI so the case is portable and does not depend on external files at render time.
2. **Strong page-one identity block.** Left: large gradient mark panel. Right: dark hero card with mission statement. This creates brand-guide authority before details.
3. **Exact two-page rhythm.** Each top-level `<section class="page">` maps to one A4 page with `height: calc(297mm - 30mm)` and `page-break-after: always`.
4. **Palette from observed assets.** Use the magenta/coral/violet family plus ink, soft aura, and slate:
   - Ink Core `#101020`
   - Signal Magenta `#E02060`
   - Motion Coral `#F06030`
   - Model Violet `#8060F0`
   - Soft Aura `#D0C0F0`
   - System Slate `#A0B0B0`
5. **Print-safe CSS.** Set `-webkit-print-color-adjust: exact; print-color-adjust: exact;` globally.
6. **Source artifact only.** Keep `source.html` in the case. Generated PDF and PNG previews belong in scratch/workspace only.

## 5. Rendering / compilation steps

From the skill root:

```bash
SKILL={{DATA_DIR}}/.builtin-skills/pdf
CASE="$SKILL/templates/brand-guide-2page/cases/minimax-web-brand-guide"
OUT=/tmp/MiniMax_Brand_Style_Guide.pdf

bash "$SKILL/scripts/make.sh" check
bash "$SKILL/scripts/make.sh" render   --in "$CASE/source.html"   --out "$OUT"   --format A4   --wait 1200
```

Use longer waits (`--wait 15000`) if future variants add remote fonts, charts, or late-loading JS. This case is static HTML/CSS and does not need Chart.js settling.

## 6. Verification commands and expected evidence

Run all gates before delivery:

```bash
pdfinfo "$OUT" | grep -E 'Pages|Page size'
pdfimages -list "$OUT"
pdftotext -layout "$OUT" - | sed -n '1,120p'
```

Expected evidence:

- `Pages: 2`
- `Page size: 595.92 x 842.88 pts (A4)` or equivalent A4 dimensions.
- `pdfimages -list` shows the embedded logo image on both pages (image + smask entries are normal for PNG transparency).
- Text extraction contains, at minimum:
  - `Co-create intelligence with everyone.`
  - `Core palette extracted from current web assets`
  - `MiniMax M2.7`, `Music 2.6`, `Hailuo 2.3`, `Speech 2.8`, `MiniMax Agent`
  - `Do` and `Don't` sections.

Optional visual check:

```bash
mkdir -p /tmp/minimax-brand-preview
pdftoppm -png -r 150 "$OUT" /tmp/minimax-brand-preview/page
```

Inspect both PNGs for: no clipped header/footer, balanced whitespace, readable tables, and a strong first-page hero.

## 7. Common pitfalls and recovery steps

| Pitfall | Symptom | Recovery |
|---|---|---|
| Hand-drawn logo approximation | Output looks like a fake brand, not MiniMax | Use a real logo PNG/SVG and embed as data URI or inline SVG. |
| Too many small modules | Looks like an AI report rather than a style guide | Use fewer, larger blocks: identity hero, palette, type, voice, tagline, product rhythm, rules. |
| Palette inferred from generic AI colors | Blue/mint SaaS look; not MiniMax-specific | Re-anchor to magenta/coral/violet from observed MiniMax web assets. |
| More than 2 pages | `pdfinfo` shows 3+ pages | Reduce copy, lower card min-heights, or remove secondary explanatory text; never shrink margins below the template rule. |
| Missing logo in PDF | `pdfimages -list` is empty or logo box blank | Inline the image as a base64 data URI; avoid brittle relative paths from temp dirs. |
| Text breaks awkwardly in hero | Large display line wraps poorly | Shorten tagline or reduce display size by 1–3 pt; keep max-width constrained. |
| Weak page-two hierarchy | Do/don’t rules dominate before brand voice | Preserve order: voice cards → tagline lockup → product matrix rhythm → do/don’t. |

## 8. Final reusable workflow

1. **Match intent:** user asks for a 2-page brand/style guide PDF from a website.
2. **Load skill route:** read `pdf` CREATE route and `templates/brand-guide-2page/README.md`.
3. **Inspect source:** fetch/render the website; extract brand name, tagline, product names, logo assets, palette, typography mood, and recurring UI motifs.
4. **Choose asset strategy:** download the best logo candidate; embed it as data URI in HTML for reproducibility.
5. **Draft transformation:** compress website content into brand rules, not a report. Keep product terms exact and copy short.
6. **Author HTML:** start from `templates/brand-guide-2page/skeleton.html` or this case’s `source.html`; keep two `<section class="page">` elements only.
7. **Render:** `bash scripts/make.sh render --in source.html --out out.pdf --format A4 --wait 1200`.
8. **Verify:** `pdfinfo` pages/size, `pdfimages` logo presence, `pdftotext` key content, optional raster preview.
9. **Deliver PDF only to user; store source in skill/case.** Do not add generated PDFs as case artifacts.

## 9. Case files

- `source.html` — portable editable source with embedded MiniMax logo image.
