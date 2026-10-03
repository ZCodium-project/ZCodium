# translate-preserve-layout

> Distilled from reference examples m09 (Email -> Chinese-translated PDF, layout preserved). HTML parse
> -> **terminology freeze** -> translate -> Chromium print.

## 1. When to use

- **EN keywords**: translate document, preserve layout, preserve formatting, email translation,
  report translation, image-preserving translation
- **CN keywords**: 翻译保版、邮件翻译、报告翻译、保留排版、保留图片、译文 PDF、保持不变
- **Sample user asks**:
  - "Translate this report inside an email to Chinese and save as a PDF; keep the content and the
    icons intact."
  - "Translate this report to Chinese preserving all images and layout."

## 2. Pipeline

HTML parse -> terminology freeze -> translate -> Chromium print -> PDF

1. Parse the source (`.eml` / `.html` / `.pdf` text layer) into structured paragraphs + image
   references (**preserve byte-level** URL / data-uri / cid: references).
2. Extract domain terms -> freeze them in `terminology.json` (after the first 3 iterations the file
   is read-only for every later round).
3. Translate per-paragraph with the frozen glossary; categorise by type: metadata / heading / body /
   list_item / caption / footnote / disclaimer / table_cell.
4. Emit HTML with the translated text + **original image references untouched** (no re-encoding).
5. Playwright Chromium print -> PDF (preserves CJK / transparency / EXIF).

Why not the token pipeline: the source already has a rich layout (tables, figures, nested lists). A
token rebuild loses both spatial fidelity and image byte tracking. HTML -> HTML -> PDF is the
natural "layout-preserving" path.

## 3. Document shape

- **Pages**: typically 5 A4 (varies; tracks the source).
- **Structure**: metadata (subject / from / to / date) -> header (logo) -> body (paragraphs +
  headings + lists) -> exhibits (figures + captions + footnotes) -> team cards -> footer /
  disclaimer.
- **Page size**: A4, 11-14 mm margins (match source).
- **Image preservation**: byte-level (no Pillow post-processing, no resize, transparency smask
  preserved).

## 4. Visual params

- **Palette**: match source (unless the user requests otherwise).
- **Typography**: PingFang SC / Hiragino Sans GB / Microsoft YaHei / Source Han Sans CN for body;
  keep the source heading fonts.
- **Images**: keep `<img src="cid:...">` or `<img src="data:image/...">` exactly as-is;
  `max-width: 88%` to prevent overflow.
- **Line-height**: minimum 1.6 (CJK needs breathing room; 1.5 is too tight and characters collide).
- **Exhibits**: `page-break-inside: avoid` + `max-height: 400pt` to prevent orphans.

## 5. Skeleton

See [`skeleton.html`](skeleton.html) (HTML template, ~150 lines) +
[`terminology.template.json`](terminology.template.json) (terminology schema).

**Quick start**:

```bash
# 1. Extract source
python3 -c "import html_parse; html_parse.extract('source.eml', out='/tmp/extracted/')"
# 2. Build terminology.json (settle within first 3 iterations, then freeze)
cp templates/translate-preserve-layout/terminology.template.json /tmp/extracted/terminology.json
# Fill in your domain terms.
# 3. Translate every paragraph using the frozen terminology.
python3 translate.py --in /tmp/extracted/ --terminology /tmp/extracted/terminology.json --out /tmp/translated/
# 4. Render HTML (skeleton + translated data).
cp templates/translate-preserve-layout/skeleton.html /tmp/translated/page.html
# Fill in placeholders.
# 5. Chromium print.
node packages/local-runtime/assets/skills/pdf/scripts/render_html.cjs /tmp/translated/page.html /tmp/translated/out.pdf
# 6. Verify image count.
src_imgs=$(pdfimages -list source.pdf | tail -n +3 | wc -l)
out_imgs=$(pdfimages -list /tmp/translated/out.pdf | tail -n +3 | wc -l)
[ "$src_imgs" = "$out_imgs" ] || echo "Warning: image count drift: src=$src_imgs out=$out_imgs"
```

## 6. Progressive case

For a full production trace of a rich Goldman Sachs research EML translated to Chinese while
preserving cid chart images, links, A4 geometry, and CJK typography, load:

- [`../../docs/email-translation-goldman-two-sessions-case.md`](../../docs/email-translation-goldman-two-sessions-case.md)
- [`cases/goldman-china-two-sessions-cn.html`](cases/goldman-china-two-sessions-cn.html)

Use the case when the source EML has `text/html` plus inline `cid:` images. It contains the
optimized reusable translation prompt, Doctype-safe segment extraction, and verification gates; do
not duplicate those details here.

## 7. Pitfalls (from m09 production)

- **Terminology drift** — fatal: the same term gets three different translations across iterations
  (e.g. "Two Sessions" rendered three different ways in Chinese). **Freeze `terminology.json` after
  the first 3 iterations; treat it as read-only afterwards.**
- **Lost images — P0 fail**: source has 6 images, output has 5 -> the acceptance gate fails. **Count
  images via `pdfimages -list` before and after rendering; source must equal output.**
- **Image byte drift**: re-encoding through Pillow / base64 loses transparency + EXIF. **Skip
  post-processing**; preserve `cid:` references and let Playwright render natively.
- **CJK line-height**: 1.5 is too tight — PingFang / Noto characters overlap. Minimum 1.6; verify
  visually with `pdftotext`.
- **Header fields forgotten**: agents commonly skip Subject / From / Date / Footer. Mark them
  explicitly with `is_translatable: true` in the schema.
- **Table cell width px -> mm fails**: use percentages or `max-width` constraints.
- **Caption / footnote orphans**: `page-break-inside: avoid` on `<figure>`.
- **Over-translating proper nouns**: agents invent Chinese names for English authors (e.g. "Andrew
  Tilton" -> a fabricated Chinese name). **Mark authors / companies / places without standard CN
  translations as `category: proper_noun, note: preserve English / no invented translations`.**
- **Quote preservation**: "around 5%" / "4.5-5.0%" — the Chinese version must keep proper Chinese
  quotation marks. Note `preserve` in `terminology.json` and grep the rendered PDF to verify.

## 8. Generalization

**Required placeholders**:

- TRANSLATED_TITLE / SUBJECT / FROM / TO / DATE / SECTION_HEADING_TRANSLATED.
- `paragraphs_translated[]` (categorised by type).
- `images[]` (with original cid: / data-uri).
- `terminology.json` (per-domain glossary; frozen after 3 iterations).
- Exhibit captions + footnotes (translated independently).

**Optional / swappable**:

- Target language (zh-CN / zh-TW / ja / ko) — change `lang=""` and the font cascade.
- Page size / margins (match source / override).
- Fonts (PingFang <-> Noto Sans CJK SC for Linux).
- Image reference style (cid: / data-uri / inline base64 — follow the source).

**Structural invariants**:

- `@page A4` + 11-14 mm margins (match source).
- CJK fonts FIRST in the cascade.
- `max-width: 88%` on `<img.exhibit>`.
- `page-break-inside: avoid` on `<figure>`.
- `line-height: 1.6` minimum.
- Preserve every heading level.
- The metadata block (subject / from / to / date) always sits at the top of the document.
- Author names mark `proper_noun` (preserve English; do not invent translations).

**Domain swappable**: finance (baseline) / legal / technical / medical / political — each domain
produces an independent `terminology.json`.

**Diversify every run.** REFORMAT is the one route where you should **not** invent new visuals — the
whole point is layout fidelity to the source. But per-domain `terminology.json`, target language,
and CJK font cascade still need to be re-picked per task: a finance translation for a HK firm and a
medical translation for a JP hospital should not share the same glossary or font stack. Always start
a fresh `terminology.json` from the source's domain.
