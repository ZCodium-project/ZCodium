# bilingual-menu-premium

> Distilled from reference examples m17 (Sakura Omakase tasting menu) and a
> luxe refresh in 2026-04. Playwright HTML+CSS, A4 portrait, serif + two-
> column parallel layout with leader dots, Roman-numeral courses, monogram
> seal, sake-pairing sidebar, and CJK chop signature.

## 1. When to use

- **EN keywords**: bilingual menu, restaurant menu, omakase, two-language
  layout, serif, premium dining, JP/EN menu, fine-dining menu, prix-fixe
- **CN keywords**: 高端菜单、双语菜单、日料菜单、左右对照、餐厅菜单、和食、江戸前
- **Sample user asks**:
  - "Generate a dinner menu for a high-end Japanese restaurant in
    Manhattan, JP left + EN right, three categories, per-item prices."
  - "Make a high-end Japanese omakase menu, bilingual side-by-side,
    serif typography, three categories."

## 2. Pipeline

**Playwright (headless Chromium) + HTML/CSS to PDF.** Renders via
`bash scripts/make.sh render --in page.html --out menu.pdf`.

Why HTML+CSS over the (now-removed) token pipeline: menus need very high
visual density and precise typography (serif + generous whitespace +
tabular numbers + leader dots). CSS Grid handles column widths with
pixel precision; Playwright's @font-face + `document.fonts.ready`
(handled by `render_html.cjs`) eliminates the web-font race.

Font cascade (verified in production): `Cormorant Garamond` →
`Hiragino Mincho ProN` (macOS native) → `Noto Serif JP` (Google Fonts,
cross-platform) → `Yu Mincho` → `Songti SC` (CJK fallback).
Sans-serif accents (eyebrow tags, prices, pairing labels) use `Inter`.

## 3. Document shape

- **Page size**: A4 portrait (595 × 842 pt). Switch to Letter via
  `@page { size: Letter portrait }` if shipping to US-only audiences.
- **Pages**: typically 1–2 (4 courses × 2 dishes ≈ 1 page; 6+ courses
  with descriptions push to 2 pages).
- **Margins**: 14 mm top/bottom, 16 mm left/right (`@page` rule).
- **Columns**: two-column grid `1fr 1fr`, gap 14 pt, JP on the left,
  EN on the right, hairline divider in between.
- **Sections**: monogram + wordmark + tagline → double-rule → prix-fixe
  block → repeating course (Roman-numeral + JP title + romaji subtitle,
  then dish rows, optional sake-pairing sidebar) → chef's note with
  signature + red seal → 3-column footer (address / website / contact)
  + fine-print band.

## 4. Visual params

**Palette** (CSS variables on `:root` — swap once, the whole document
re-skins):

- `--paper #faf6ed` cream paper (use `#fff` for "white-paper formal")
- `--ink #1a1814` near-black body
- `--ink-2 #3d3528` / `--ink-3 #6b5e48` graded muted text
- `--gold #9a7434` accent (course numerals, prices, eyebrow, pairing rule)
- `--gold-2 #c5a866` decorative hairlines (double rule, leader dots)
- `--hairline #dcc89a` row dividers
- `--seal #a82828` chef's chop (CJK red square)

**Typography**:

- Wordmark: 30 pt 500-weight Cormorant Garamond, letter-spacing `.55em`
- Course title (JP): 13 pt Hiragino Mincho letter-spacing `.14em`
- Course numeral (Roman): 12 pt italic Cormorant in `--gold`
- Course subtitle (EN romaji): 7 pt 500 Inter uppercase letter-spacing `.42em`
- Dish JP name 10.5 pt 600 / EN name 11 pt italic 500
- Dish description JP 8.5 pt / EN 9 pt
- Price 9.5 pt Inter `tabular-nums` in `--gold` (or `included` in tiny caps)
- Eyebrow / fineprint 7.5 pt / 6 pt Inter uppercase letter-spacing `.42em`

**Premium-feel components in the skeleton**:

| Component | What it is | Class / element |
| --- | --- | --- |
| Monogram | Single-letter inline SVG inside a 2-ring badge | `.monogram svg` |
| Double rule | Two parallel hairlines with 2 pt gap | `.double-rule` |
| Roman-numeral course | `I.` / `II.` / `III.` italic gold | `.course-head .num` |
| Letterspaced eyebrow | Small uppercase Inter `letter-spacing: .42em` | `.tagline`, `.lbl`, `.head` |
| Leader dots | Dotted line between dish name and price | `.en .leader` |
| Tabular-nums prices | `font-variant-numeric: tabular-nums` for column align | `.en .price` |
| Pairing sidebar | Left-rule callout with light gold tint | `.pairing` |
| Chef's chop | CJK character on red square, slight tilt | `.signature .seal` |
| 3-col footer | Address · website · contact, then fineprint band | `footer` grid |

## 5. Skeleton

See [`skeleton.html`](skeleton.html) (~210 lines self-contained, embedded
`<style>`, all real content stubbed as `<!-- PLACEHOLDER -->`).

**Quick start**:

```bash
cp templates/bilingual-menu-premium/skeleton.html /tmp/menu/page.html
$EDITOR /tmp/menu/page.html       # replace every <!-- ... --> placeholder
bash scripts/make.sh render --in /tmp/menu/page.html --out /tmp/menu/out.pdf
pdfinfo /tmp/menu/out.pdf | grep Pages
```

## 6. Pitfalls

- **Web-font race condition**: `render_html.cjs` waits for
  `document.fonts.ready` automatically (15 s cap), but
  `Cormorant + Inter + Noto Serif JP` is a 3-font cold-load. If the
  output Helvetica's the body, bump `--wait` to `2000`+.
- **CJK tofu / mojibake**: when the host has no Hiragino, Noto Serif JP
  is the safety net (loaded via Google Fonts in the skeleton). For
  air-gapped machines, vendor `NotoSerifJP-*.woff2` to
  `assets/fonts/` and switch the `<link>` to a relative `@font-face`.
- **JP/EN parity**: when a JP description exceeds 8 characters, the EN
  side must carry equivalent content. m17 iter6 had Aji / Zuke Akami
  entries fall out of parity; the critic flagged P1.
- **Sparse last page**: 4 courses × 2 dishes is comfortable for 1 page;
  6 courses pushes to 2. If the second page is < 1/3 full, expand the
  chef's note or add a separate "wine list" section.
- **Leader-dot height drift**: the dots use
  `transform: translateY(-2pt)` to align with the baseline. If you
  change the EN name font-size, tweak the `translateY` to keep the dots
  centered between the descender and the price.
- **Monogram letter spacing**: the wordmark uses `letter-spacing: .55em`
  with a `margin-left: .55em` compensator so the visually-centered title
  sits true-center under the monogram. Don't drop the compensator.

## 7. Generalization

**Required placeholders**:

- `RESTAURANT_NAME`, `MONOGRAM_LETTER` (1 char for the badge)
- `ESTABLISHED_YEAR`, `LOCATION_LINE`, `DATE_MONTH_YEAR`
- `PRICE_LABEL`, `PRICE_AMT`, `PRICE_NOTE`
- Per course: `COURSE_NUM` (`I.` / `II.` / …), `CATEGORY_JP`,
  `CATEGORY_ROMAJI`, `CATEGORY_EN_SUBTITLE`
- Per dish: `DISH_NAME_JP`, `DISH_KANA_JP`, `DISH_DESC_JP`,
  `DISH_NAME_EN`, `PRICE` (or use `class="price included"` for
  fixed-menu courses), `DISH_DESC_EN`
- Closing: `CLOSING_TITLE`, `CHEF_PHILOSOPHY_OR_SOURCING_NOTE`,
  `CHEF_SIGNATURE`, `SEAL_CHAR` (1–2 CJK chars)
- Footer: `FOOTER_LEFT`, `FOOTER_CENTER`, `FOOTER_RIGHT`,
  `HEALTH_DISCLAIMER`, `GRATUITY_NOTE`, `TAX_NOTE`

**Optional / swappable**:

- Pairing sidebar (drop the `.pairing` div if no wine/sake list).
- Cuisine (omakase generalises to kaiseki / French tasting / Italian
  prix-fixe — keep the columns, adjust `CATEGORY_JP/ROMAJI`).
- Language pair (JP/EN baseline — swap to JP/CN, KR/EN, or FR/EN; the
  grid is language-agnostic).
- Palette via `:root` CSS variables. Quick re-skin presets:

| Mood | --paper | --gold | --seal |
| --- | --- | --- | --- |
| Classic Japanese (default) | `#faf6ed` cream | `#9a7434` deep gold | `#a82828` red |
| White-paper formal | `#ffffff` | `#1a3a5c` navy | `#1a3a5c` navy |
| Italian trattoria | `#fdf6e3` | `#7a5236` terracotta | `#5a7d3a` olive |
| French bistro | `#f7f3ec` | `#3a3a3a` graphite | `#9a2828` claret |
| Modern monochrome | `#fafafa` | `#222` graphite | `#222` graphite |

**Structural invariants** (do not change — they are what make the doc
read as "premium"):

- Two-column grid with a hairline border between left and right.
- `break-inside: avoid` on rows, course sections, pairing, closing,
  footer to prevent mid-element page splits.
- Centered course titles with wide letter-spacing (≥ `.14em`).
- 0.25 pt dotted dish-row separator (any thicker reads as "form").
- Roman numerals for course numbering (Arabic numbers feel transactional).

**Diversify every run.** Treat the §4 baseline (cream + gold + Hiragino
Mincho + Cormorant Garamond) as a sanity check, not the default answer.
Adapt the palette, typography, language pair, and cuisine to the user's
restaurant brand, cuisine style, location, and mood — two back-to-back
menu generations for different restaurants should NOT both come back
cream/gold unless the user explicitly asked for that look.
