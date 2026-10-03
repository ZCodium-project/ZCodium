# multi-article-aggregator

> Distilled from reference examples m16 (source blog 11 posts -> 70-page
> PDF). **Cowork multi-pass pipeline**: fetch -> clean DOM -> per-article
> render -> 2-pass TOC -> merge. This route is fundamentally a pipeline,
> not a single HTML file.

## 1. When to use

- **EN keywords**: aggregate articles, blog digest, multi-post
  compilation, monthly digest, TOC + multi-doc, news roundup,
  blog -> PDF
- **CN keywords**: 文章合集、blog 聚合、多篇汇总、月度回顾、资讯整理、博客打包
- **Sample user asks**:
  - "Compile these source blog posts from January 2026 into a PDF;
    needs a TOC that jumps to each post; one post per page."
  - "Aggregate 11 Medium articles into a single PDF with clickable TOC
    and category grouping."

## 2. Pipeline

**Cowork multi-pass pipeline** (not a single HTML, no single skeleton).

| Stage | Tool | Purpose |
|---|---|---|
| 1. Fetch | Playwright | Pull each source page (`networkidle` + 1.5 s settle for lazy loads). |
| 2. Per-article DOM cleanup | Playwright `page.evaluate` | Inject hide CSS to strip nav / footer / cookie / related-posts / share / sticky elements. |
| 3. Per-article render | Playwright `page.pdf()` | One PDF per article (do NOT merge HTML). |
| 4. Collect metadata | pdfinfo | Page count per article -> page-offset map for the TOC. |
| 5. **TOC pass 1** | reportlab canvas | Render the TOC with mock page numbers; measure its own page count. |
| 6. **Merge pass 1** | pypdf | Concatenate `[TOC + article 1..N]`; recompute the true start page of each article. |
| 7. **TOC pass 2** | reportlab canvas | Re-render the TOC with the real page numbers. |
| 8. **Merge pass 2** | pypdf | Final PDF + outline bookmarks + `/Link` annotations. |
| 9. (Optional) trim trailing blanks | pypdf | Detect per-article trailing pages that are >= 90% blank; drop them and re-balance offsets. |

Why cowork instead of merging HTML in one shot: 11 articles use
different Webflow templates with conflicting CSS cascades. Rendering
each article in isolation preserves its font hierarchy without
cross-contamination.

## 3. Document shape

- **Pages**: ~70 (5-8 per article x 11 + 1-2 TOC).
- **Structure**: cover (optional) -> TOC (dot leaders + page numbers +
  category grouping) -> 11 articles (each with `page-break-before`) ->
  colophon (optional).
- **Page size**: A4 portrait.
- **Per-article structure**: H1 title -> metadata (date / author /
  category / reading time) -> body (text + code + images) -> no nav /
  related / share.

## 4. Visual params

- **Palette**: neutral / inherit from source (the source uses dark + serif).
- **Typography**: pull source `@font-face` woff2 -> convert to TTF ->
  inline as `data:` URIs; `font-family` cascade with fallbacks;
  **critical: `await document.fonts.ready` before rendering.**
- **Code blocks**: `font-family: Menlo, Consolas, monospace`;
  `background: #f5f5f5`; `padding: 12px`; `whitespace: pre-wrap`.
- **TOC**: category-grouped (bold underlined subhead -> numbered item ->
  dot leaders -> right-aligned date -> right-aligned page number;
  multi-line titles wrap automatically).
- **Per-article H1**: 28pt; H2 20pt; H3 16pt.
- **Images**: `max-width: 100%; height: auto`. Wait for `img.complete`
  before rendering.

## 5. Skeleton

See [`pipeline.md`](pipeline.md) (cowork pipeline pseudocode + per-article
HTML stub + TOC rendering spec).

**Quick start**:

```bash
# This route has no "copy a single skeleton" path — you must walk the pipeline.
# 1. Prepare posts_list.json: [{url, title, date, author, category, slug}, ...]
# 2. Run fetch + clean DOM + per-article render (python + playwright).
# 3. Render TOC with reportlab, merge with pypdf.
# Full details in pipeline.md.
```

## 6. Pitfalls (from m16 production)

- **Web-font load race**: without `await document.fonts.ready` Chromium
  substitutes system fonts (Times / Helvetica) and breaks the visual.
  **Always await custom fonts.**
- **Lazy-loaded images dropped**: when Playwright prints, late-loading
  images get clipped. **Scroll to the bottom** before rendering, then
  `wait_for_timeout(1500-2000)` so all images settle.
- **CSS cascade pollution**: Webflow uses `.is-cc` / `[class*='icon']`
  in deeply nested layouts; broad selectors like `[class*='form_']`
  accidentally hit `.hero_blog_post_details_form` and collapse the
  metadata block. **Use an explicit KEEP whitelist** + force
  `display: flex` for the wanted nodes.
- **Per-article trailing blanks**: a single article often produces 1-2
  trailing blank pages (CSS height 100vh / placeholders). **Strip them
  before merging**, or the total page count balloons and TOC numbers
  drift.
- **Metadata icons run wild**: Webflow icons without size constraints
  occupy 60% of the page width. Inject early CSS:
  `svg, [class*='icon'] { max-width: 64px; max-height: 64px; }`.
- **TOC pagination**: 11 entries can overflow one page. reportlab
  canvas does not paginate automatically — measure cumulative height,
  call `c.showPage()` once you exceed `SAFE_PAGE_H`.
- **PDF outline 0-based vs 1-based**: outline page numbers are 0-based
  (page 0 = TOC), but the displayed numbers are 1-based. Off-by-one
  errors send bookmarks to the wrong page. **Verify the `/Dest` indirect
  reference with both `pdfinfo` and pypdf outline.**
- **Order / grouping**: defaults to chronological; users may want
  reverse or custom grouping. **Parameterise**:
  `--order=chrono|reverse`, `--group-by=category|date`.

## 7. Generalization

**Required**:
- `COMPILATION_TITLE`
- `SOURCE_WEBFONT_FAMILY` (auto-discover from source `@font-face`, or
  `getComputedStyle(body).fontFamily`).
- `posts_list.json` (`[{url, title, date, author, slug, category}]`).
- `N_ARTICLES` (5-50 typical).

**Optional**:
- Per-article excerpt (TOC sub-line).
- Category / tag badges.
- Author avatars (if the source provides them).
- Custom cover.

**Structural invariants**:
- TOC + dot leaders + page numbers (never inline).
- `page-break-before: always` per article.
- `img { max-width: 100%; height: auto; }` to prevent overflow.
- Code blocks in monospace + light-gray background.
- No nav / footer / related elements.

**Swappable**:
- Source site (blog -> medium.com / Substack / dev.to / WordPress
  / any stable HTML).
- Article count (5-50; tune the TOC paging threshold).
- Language (EN / CN / mixed; reportlab + pypdf are encoding-agnostic).
- Margins (default 16 mm; pass via the `page.pdf()` margin dict).

**Diversify every run.** The aggregator should inherit the **source
site's webfont** (auto-detect via `getComputedStyle`) — do not default
to a stock sans-serif. Re-pick the cover treatment, accent color, and
TOC layout based on the source site's identity (Substack newsletter
warmth vs dev.to monospace vs corporate blog formality). Two digests
from two different blogs should read as separate publications, not
both wearing the m18 default.
