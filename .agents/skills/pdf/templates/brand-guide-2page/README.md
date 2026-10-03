# brand-guide-2page

> Distilled from reference examples m19 (MiniMax brand guide). Playwright
> HTML+CSS, **exactly 2 pages**, A4 portrait, sans-serif + multi-block
> grid.

## 1. When to use

- **EN keywords**: brand guide, style guide, visual identity, brand
  book, design system, brand standards, 2-page identity
- **CN keywords**: 品牌指南、风格指南、品牌手册、视觉识别、设计系统、品牌册、2 页品牌
- **Sample user asks**:
  - "Generate a 2-page brand style guide for our company in PDF format."
  - "Make a 2-page PDF brand guide with logo, palette, type, do's & don'ts."

## 2. Pipeline

**Playwright HTML+CSS to PDF.** Does NOT use the token pipeline.

Why: brand guides have very high visual density (color blocks, logos,
type specimens, gradients). HTML+CSS gives pixel-precise color
fidelity, inline SVG embedding, and `@page` A4 hard pagination. The
token pipeline cannot express the strict 2-page split.

Architecture: a single `brand-guide.html` (CSS embedded inside `<style>`)
+ local/data-URI logo asset + optional `assets/fonts/` -> Playwright sync -> PDF.

## 3. Document shape

Exactly two A4 portrait pages (210 x 297 mm), 15 mm margins.

- **Page 1 (Identity)**: header (lockup + title) -> logo block (lockup +
  clearspace spec) -> color palette (six chips) -> typography (5-step
  scale: H1/H2/H3/Body/Caption) -> footer.
- **Page 2 (Voice & Application)**: header (running title) -> voice
  pillars (3 cards) -> tagline lockup (display type + usage) -> Do's &
  Don'ts (4 do / 7 don't, two columns) -> footer.

Grid: 12 columns + 6 mm gutter; 8 mm gap between blocks. The page-2
footer uses `margin-top: auto` to pin to the bottom.

## 4. Visual params

**Palette** (every hex is a CSS variable, override at will):
- Charcoal `#181E25` (body text / wordmark)
- Surface `#F7F8FA` (page background / cards)
- Brand primary `<!-- BRAND_PRIMARY -->` (accent 1)
- Brand secondary `<!-- BRAND_SECONDARY -->` (accent 2)
- Muted `#5A6470` (secondary text / timestamps)
- Rule `#E2E5EA` (hairline dividers)

**Typography** (verified pairing — leave the CJK fallback alone):
- Display: `Outfit, system-ui, sans-serif` (H1 / H2 / numbers / labels)
- Body: `Poppins, system-ui, sans-serif` (body / captions)
- Sizes: H1 48/56, H2 32/40, H3 20/28, Body 12/18, Caption 10/14
- Tagline: 38pt + linear-gradient text fill

**@page**:

```css
@page { size: A4 portrait; margin: 15mm; }
.page { page-break-after: always; height: calc(297mm - 30mm); }
.page:last-of-type { page-break-after: auto; }
.page[data-page="2"] .footer { margin-top: auto; }  /* pin bottom */
```

## 5. Skeleton

See [`skeleton.html`](skeleton.html) (~180 lines self-contained, CSS
variables drive the palette, the logo is left as an inline SVG slot).

**Case exemplar:** for a complete website-to-brand-guide workflow using the current MiniMax site, real logo asset, portable data-URI source, render command, and verification gates, read [`cases/minimax-web-brand-guide/README.md`](cases/minimax-web-brand-guide/README.md). Editable source: [`cases/minimax-web-brand-guide/source.html`](cases/minimax-web-brand-guide/source.html).

**Important:** case HTML is a reference exemplar, not a deliverable shortcut. For any user-requested website brand guide, independently explore the live website first (HTML, linked CSS, visible copy, logo/image assets, product/navigation structure, and screenshots when useful), then author a fresh/meaningfully adapted guide. Do not directly copy the case `source.html` or ship a lightly patched case output; use it only for layout patterns, pagination math, and verification examples.

**Quick start**:

```bash
cp templates/brand-guide-2page/skeleton.html /tmp/brand/page.html
# Edit the :root CSS variables --primary / --secondary.
# Edit <!-- BRAND_NAME --> / <!-- BRAND_LOGO_SVG --> / <!-- BRAND_TAGLINE -->.
bash scripts/make.sh render --in /tmp/brand/page.html --out /tmp/brand/out.pdf --format A4 --wait 1200
# Strict 2 pages: pdfinfo /tmp/brand/out.pdf | grep Pages must report 2.
```

## 6. Pitfalls (from m19 production)

- **CJK font fallback**: a system Helvetica/Arial fallback destroys
  wordmark identity. Embed Outfit + Poppins via `@font-face` from local
  files (do not depend on a CDN — it breaks offline / under VPN
  switching). Keep `system-ui` only as the very last fallback.
- **SVG logo embedding**: inline `<svg>...</svg>` or
  `data:image/svg+xml;base64,...` is the only stable form. `file://`
  paths can intermittently fail in headless Chromium — prefer inline.
- **@page A4 sizing**: use `@page { size: A4 portrait }`; never hardcode
  pixels. Content area = `297mm - 30mm = 267mm`. The last section must
  fit, otherwise pin the footer with `margin-top: auto`.
- **Exact 2 pages**: every `.page` needs `page-break-after: always`.
  Verify with `pdfinfo out.pdf | grep Pages` (must equal 2). More or
  fewer pages means a section did not fit cleanly.
- **Print color fidelity**: html / body need
  `-webkit-print-color-adjust: exact; print-color-adjust: exact;`,
  otherwise Chromium screen-optimises the colors and the printed swatches
  drift.

## 7. Generalization

**Required placeholders**:
- `<!-- BRAND_NAME -->` company / product name (1-20 characters)
- `--primary: <!-- BRAND_PRIMARY -->` hex color (CSS variable)
- `--secondary: <!-- BRAND_SECONDARY -->` hex color
- `<!-- BRAND_LOGO_SVG -->` inline SVG (200-400 characters)
- `<!-- BRAND_TAGLINE -->` slogan (3-10 words)

**Optional**:
- Number of palette swatches (4-8 ok).
- Voice-pillar cards (2-5 ok).
- Do/Don't ratio (4 / 7 is the baseline; 3-8 each is reasonable).
- Fonts (Outfit + Poppins is the baseline; switching fonts changes the
  wordmark feel as well).

**Structural invariants** (changing these breaks the layout):
- `@page` rules: A4 portrait, 15 mm margins, page-break-after on `.page`.
- Grid: 12 columns, 6 mm gutter, 8 mm section gap (this is what makes
  267 mm fit cleanly).
- Page-1 block order: Header -> Logo -> Color -> Type -> Footer (the
  density is calibrated for that order).
- Page-2 block order: Header -> Voice cards -> Tagline -> Do/Don't ->
  Footer.
- Color rule of thumb: 60% neutral / 30% brand / 10% accent.
- Tagline gradient: 180-deg vertical (top to bottom). Do not switch to
  135 deg or radial.

**Diversify every run.** The §4 baseline (Outfit + Poppins, charcoal +
surface) is wired up so the layout renders the moment you fill the
placeholders — it is **not** the default brand. The user's
`--primary` / `--secondary` plus their domain (consumer / B2B / fintech
/ creative agency) should drive the typography, palette intensity, and
voice-pillar tone. Two brand guides for two different companies should
not look like reskins of each other.
