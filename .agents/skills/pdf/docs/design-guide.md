# Design System

The aesthetic layer. Read this before authoring any HTML report.
This file answers "what should it look like and why." For *how* to wire the
HTML so it survives Chromium's print snapshot, see
[`html-pdf-spec.md`](html-pdf-spec.md).

---

## The one rule

Every design decision must be **rooted in the document's content and purpose**.
Dark teal + cream is not "professional". Serif + beige is not "elegant".
A color chosen because it fits the content will always outperform a color chosen
because it seems safe.

---

## Palette logic

Pick a base palette by reading the content's mood, then declare the resulting
hex values as CSS variables on `:root`. **Don't** keep a default blue because
"blue is safe" — every report should look distinct from the last.

### Mood → base palette

| Content signal | Mood | Background | Accent | Text |
|---|---|---|---|---|
| Research, science, analysis | Authoritative | `#0F1F2E` deep ink | `#00B4A6` teal | `#F0EDE6` warm white |
| Business, strategy, finance | Confident | `#1C1C2B` near-black | `#E8A020` amber | `#F5F2EC` cream |
| Creative, portfolio, design | Expressive | `#1A0A2E` deep violet | `#FF6B6B` coral | `#FAF5FF` lavender white |
| Education, academic paper | Scholarly | `#FAFAF7` warm white | `#2C4A7C` navy | `#1A1A2E` dark |
| Healthcare, wellness | Calm | `#F5F9F8` pale mint | `#2D8B72` forest | `#1E3830` deep green |
| Resume / personal | Clean | `#FFFFFF` white | pick from content | `#111111` near-black |
| Formal publications, annual reports | Magazine | `#F2F0EC` warm linen | `#1C3557` deep navy | `#0D1A2B` near-black |
| Premium / dark reports, tech reviews | Darkroom | `#151C27` deep navy | `#4A6FA5` steel blue | `#F0EDE6` warm white |
| Technical docs, developer reports | Terminal | `#0D1117` near-black | `#39D353` neon green | `#E6EDF3` cool white |
| Portfolios, creative, photography | Poster | `#FFFFFF` white | `#0A0A0A` near-black | `#0A0A0A` near-black |
| General / unknown | Neutral | `#F8F6F1` warm off-white | `#3D3D3D` dark gray | `#1A1A1A` black |

### Accent selection rules

- **One accent color only.** Two accents split visual energy.
- Accent appears on: cover geometric elements, section rules, callout left
  borders, table header background, page header rule, chart primary series.
  Nowhere else.
- Accent must contrast with the cover background by at least **4.5:1** (WCAG
  AA). Verify with any contrast checker before shipping.
- **Do not default to blue.** Blue is the most overused accent in
  AI-generated documents.

### Color pairing anti-patterns

| Avoid | Why |
|---|---|
| Purple gradient on white | The default AI aesthetic — immediately signals "generated" |
| Navy + gold | Overused corporate cliche |
| All-black background | Prints aggressive, ink-heavy |
| More than 3 data colors + 1 accent | Visual noise |
| Accent on body text | Destroys readability |

---

## Typography

Two typefaces maximum. Always.

| Role | Criteria | System-safe choices |
|---|---|---|
| Display (cover title, H1) | Distinctive, strong contrast, high weight | Times New Roman, Georgia, Cambria (serif) · SF Pro Display, Helvetica Neue (sans) |
| Text (body, captions, UI) | Highly readable at 10–11 pt | Helvetica, Arial, SF Pro Text · Georgia, Cambria for serif body |

Cover hero pairings by mood (load CDN webfonts via `@font-face` + a local
fallback file under `assets/fonts/` — do not rely on a live CDN at render
time):

- Authoritative: Playfair Display / IBM Plex Sans
- Confident: Syne / Nunito Sans
- Expressive: Fraunces / Inter
- Scholarly: EB Garamond / Source Sans 3
- Clean: DM Serif Display / DM Sans
- Restrained: Cormorant Garamond / Jost
- Bold: Barlow Condensed / Barlow
- Editorial: Bebas Neue / Libre Franklin
- Classical: Cormorant / Crimson Pro
- System fallback (always include last): `-apple-system, "PingFang SC",
  "Helvetica Neue", Arial, sans-serif`

### Type scale (suggested baseline)

All sizes in `pt` (Chromium converts; never use `px` for body text in print).

| Token | Size | Leading | Usage |
|---|---|---|---|
| display | 38–54 pt | 1.10–1.20 | Cover title |
| h1 | 20–22 pt | 1.30 | Section headings |
| h2 | 13–15 pt | 1.40 | Subsection headings |
| h3 | 11.5–12 pt | 1.50 | Sub-subsection |
| body | 10–11 pt | 1.55–1.65 | Main prose |
| caption | 8.5–9 pt | 1.40 | Figure / table captions |
| meta | 8 pt | 1.30 | Header / footer text |

CJK font cascade rule: order is **SC → JP → KR → Latin → generic**. Putting
JP before SC renders simplified-Chinese characters in JP forms. Apple SD
Gothic Neo (or Noto Sans CJK KR) is required for Korean — Hiragino does not
cover hangul.

---

## Cover design

The cover is the most important page. It determines whether a reader trusts the
document. The cover should occupy exactly one A4 page (~268 mm content height
at 14 mm margin), end with `page-break-after: always`, and use full-bleed
`-webkit-print-color-adjust: exact`.

Pick a cover archetype that fits the mood. None of these are "the right one";
pick the one that matches the content energy.

| Archetype | Best for | Visual signature |
|---|---|---|
| **Full-bleed gradient hero** | Tech / data reports | Deep gradient + radial halo blobs + hero title + bottom meta strip |
| **Split panel** | Proposals | Colored left 42% panel + right white panel + accent vertical rule |
| **Typographic** | Resumes, academic papers | Off-white bg + oversized type + first word in accent + thin rule |
| **Atmospheric** | Portfolios | Near-black bg + soft accent radial + low-opacity dot grid |
| **Minimal bar** | Editorial summaries | White bg + 8 px accent left bar + huge light-weight title |
| **Stripe** | Newspaper / brand poster | Three horizontal bands (accent / dark / light), hard edges |
| **Diagonal** | Bold reports | SVG polygon diagonal cut, accent edge line traces it |
| **Frame** | Annual reports, legal | Inset rectangular border + accent corner squares |
| **Editorial** | Magazines | Ghost first-letter at low opacity + accent top bar + uppercase title |
| **Magazine** | Centered formal | Cream/linen bg, vertical stack, optional hero image |
| **Darkroom** | Premium tech reviews | Same as magazine but deep navy + grayscale hero filter |
| **Terminal** | Developer / system reports | Near-black + neon green + monospace + grid overlay + bracket frame |
| **Poster** | Creative, photography | White bg + thick accent left sidebar + 96 px condensed all-caps title |

### What always kills a cover

- Centered title on white background with a thin horizontal line beneath
- Gradient from one color to another that reads as PowerPoint, not print
- Drop shadows on text
- More than one accent color
- Emoji or icon fonts (fail silently in headless Chromium)

---

## Inner page restraint

Every design decision should remove something, not add something. The page is
done when there is nothing left to remove.

- Accent appears on section rules / chart bars / pill backgrounds — **not**
  on body headings, **not** on bullet markers.
- No bordered card components inside body prose. Cards are reserved for
  call-out roles: KPI grids, recommend cards, versus comparisons,
  conclusion blocks, insight callouts.
- No rounded corners on anything except callout boxes / KPI cards (≤ 12 px).
- No shadows beyond `0 1px 3px rgba(0,0,0,0.04)` on chart cards (very subtle).
- Tables: header row in accent (or dark gradient), zebra rows, no internal
  grid lines except the outer box and a hairline between rows.
- Callout boxes: left border in accent (3–4 px), very light tint background,
  no icon decoration unless it's a single semantic emoji (⚡ insight, 🛠
  pitfall).

### Page header / footer

Header (when used): document title left-aligned 7.5 pt muted + accent rule
1.5 pt full width below. Footer: author left, page number right, light rule
above. Both at 7.5 pt, color = `#86868b` or similar muted.

---

## Quality bar

A PDF passes if a designer would not be embarrassed to hand it to a client.
Concretely:

- Cover has a clear visual identity that is not "generic AI output".
- Body text is readable at arm's length without squinting.
- Every page looks like it belongs to the same document.
- No element bleeds off the edge or overlaps another.
- Page numbers are present (when ≥ 5 pages) and correct.
- The accent color appears fewer than 8 times per page on average.
- Last page is ≥ 1/3 full — if not, expand content, do **not** shrink margins.
- Two reports on different subjects don't look like reskins of each other —
  the palette, typography, and cover archetype have all been adapted.

---

## Anti-patterns specific to AI-generated documents

These are the tells that a reader spots in 2 seconds:

| Tell | Fix |
|---|---|
| Apple-blue (`#007AFF`) on every report | Re-skin per subject (see palette table) |
| Identical KPI 4-grid on every cover | Mix layouts: timeline, hero stat, single big number |
| Stock emoji icons everywhere | One semantic emoji per callout, max 3 per page |
| Tables with the default Chrome look (gray rows, blue header) | Use the accent header + zebra body + outer-box-only style |
| Generic "Q3 2024 Strategy Review" cover with stock subtitle | Pull a real signal from the content for the subtitle |
| All charts in the same orientation | Mix horizontal / vertical / radar / scatter to match data shape |

When in doubt, look at the [`templates/`](../templates/) catalogue — every
skeleton there has been tuned for a real bench-trace; copy the closest one
and re-skin rather than starting from the generic blueprint.
