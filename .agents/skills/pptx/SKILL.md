---
name: pptx
description: >-
  Read, create, and edit PowerPoint PPTX/PPT presentations.
  Covers: parsing, summarizing, extracting content, inspecting themes/layouts, creating new decks with PptxGenJS, and editing existing PPTX while preserving formatting.
descriptions:
  zh-Hans: "读取、创建和编辑 PowerPoint PPTX/PPT，支持解析、总结、抽取内容、检查主题布局和保留格式编辑。"
---

<!--
Copied from MiniMaxAI/minimax-code (packages/local-runtime/assets/skills/pptx)
at revision 564e9166d81f87b0b767b005e4779d4697b512be.
Copyright (c) 2026 MiniMax Code. Licensed under MIT.
Modified by ZCode: added this provenance notice only; skill content is otherwise unchanged.
See THIRD-PARTY-NOTICES.md in the repository root for license and provenance.
-->

## Scope

Use this skill for PowerPoint `.pptx` work.

- Read slide text, tables, speaker notes, or comments
- Search existing deck content
- Extract embedded images
- Render slide screenshots
- Audit theme, layout, font, color, hyperlink, embedded object, and security metadata
- Create a new deck from scratch with PptxGenJS
- Imitate an existing deck's visual style with new content
- Edit an existing PPTX or template while preserving layout

Replace `<skill_dir>` with the actual skill path shown by the loader.

## Router

| Need | Workflow |
| --- | --- |
| Existing PPTX inspection, extraction, search, preview, or audit | Use the inspection commands below |
| PPTX preview selection edit context (`mavis.ppt_artifact_edit_request.v1`) | Read `references/preview-selection-writeback.md`; use the targeted workflow there, not the template-wide editing workflow |
| Existing PPTX provided and layout/style must be preserved | Follow `references/editing.md` |
| Reference PPTX provided for style imitation, but content is new | Run the Template Imitation Workflow |
| No source deck, or a fresh deck is acceptable | Run the From-Scratch Workflow |

If the request says "edit" but no source deck is available, assume from-scratch generation and state that assumption.

## Inspection Commands

Default to `uv run --with python-pptx` for all Python workflows except comments, which has no extra dependency.

```bash
# Text, tables, notes, search
uv run --with python-pptx <skill_dir>/scripts/extract_pptx.py file.pptx

# Embedded images
uv run --with python-pptx <skill_dir>/scripts/extract_images.py file.pptx

# Review comments
uv run <skill_dir>/scripts/extract_comments.py file.pptx

# Format / metadata audit
uv run --with python-pptx <skill_dir>/scripts/audit_pptx.py file.pptx

# Screenshots (macOS only)
bash <skill_dir>/scripts/pptx-screenshot.sh file.pptx
```

High-value inspection flags:

- Slide subset: `--slides 1,3,5` or `--range 2-4`
- Text filtering: `--search "term"`, `--regex`, `--ignore-case`
- Speaker notes: `extract_pptx.py --notes`
- Image dry run: `extract_images.py --list-only`
- Comment output: `extract_comments.py --format json`
- Audit scope: `audit_pptx.py --sections metadata,themes,...`
- Screenshot subset: `pptx-screenshot.sh --pages "1,3,5" --outdir ./previews`

`audit_pptx.py` supports these sections:

- `metadata`: document properties
- `masters`: slide masters, layouts, usage counts
- `themes`: theme colors and font schemes
- `shapes`: per-slide shape inventory with position and text preview
- `hyperlinks`: URLs, actions, tooltips
- `embedded`: embedded files and OLE objects
- `security`: MSIP labels and custom XML parts

Use `--format text` only for human inspection. Prefer JSON when downstream processing is likely.

## Generation Defaults

Use these defaults unless the user specifies otherwise **and no template PPTX is provided for imitation**:

- audience: business / professional
- tone: clear, restrained, presentation-ready
- layout: `LAYOUT_16x9`
- Chinese font: `Microsoft YaHei`
- English font: `Arial` unless a better option is justified
- palette and typography: choose from `references/design-system.md`
- page numbers: required on all non-cover slides

When a template PPTX is provided for imitation, the template's actual colors and fonts override these defaults.

## Editable Sidecar Metadata

When creating a new PPTX from scratch for Mavis, also write an optional sidecar element map:

```text
slides/output/<descriptive-name>.mavis-ppt-map.json
```

This sidecar is editing metadata only. It must not replace the standard `.pptx` output, change
visible slide layout, or change the `createSlide(pres, theme)` slide-module contract. Use
`references/element-map.md` and `scripts/mavis-ppt-map.cjs` to record stable `elementId`, role,
text, style, and `rectIn` / `normalizedRect` coordinates for meaningful editable elements.

If the sidecar is unavailable for a deck, the PPTX is still valid and should be delivered after the
normal QA process. Future artifact-edit flows can then fall back to preview text, screenshots, and
coordinates as locator evidence.

## Hard Constraints

These are mandatory unless the user explicitly overrides them:

1. Use `LAYOUT_16x9`.
2. **Canvas boundary rule**: `LAYOUT_16x9` is **10" wide x 5.625" tall**. Every element must satisfy `x + w <= 10.0` and `y + h <= 5.625`. Coordinates that exceed these bounds will be clipped or overflow the slide edge. Do NOT assume the canvas is 13.3" wide — that is `LAYOUT_WIDE`, a different layout.
3. Create one file per slide: `slides/slide-01.js`, `slides/slide-02.js`, ...
4. Each slide file must export synchronous `createSlide(pres, theme)`.
5. Never use `async` / `await` in `createSlide()`.
6. Theme keys must be exactly `primary`, `secondary`, `accent`, `light`, `bg`.
7. Colors must be 6-character hex strings without `#`.
8. Do not encode opacity into hex strings.
9. All non-cover slides must include a page number badge near x `9.3`, y `5.1`.
10. Chinese text should use `Microsoft YaHei`.
11. No gradients or animation-style gimmicks.
12. Do not reuse mutable PptxGenJS option objects across calls.
13. Output filename must be descriptive; never use `presentation.pptx`.
14. Run QA before returning the deck — this is a **blocking gate**, not optional. Do NOT return the deck to the user until QA is complete. See `references/pitfalls.md` for the QA process.
15. When imitating a template, use the template's actual fonts. Only fall back to `references/design-system.md` font pairings when no template is provided.

## From-Scratch Workflow

Use this when no source PPTX must be preserved.

1. Derive a concise outline from topic, audience, purpose, and expected depth.
2. Pick one palette, font pairing, and style recipe from `references/design-system.md`.
3. Assign each slide one page type from `references/slide-types.md`.
4. Create `slides/slide-XX.js` modules and keep layout variety where the outline calls for it.
5. Run the pre-compile lint in `references/pitfalls.md#pre-compile-lint` before compiling.
6. Create `slides/compile.js`, load slide modules in final order, and write `slides/output/<descriptive-name>.pptx`.
7. For Mavis-generated decks, write `slides/output/<descriptive-name>.mavis-ppt-map.json` as a sidecar using `references/element-map.md`.
8. Run the QA process in `references/pitfalls.md#qa-process`, fix issues, and re-verify.

Minimal compile shape:

```javascript
const pptxgen = require('pptxgenjs');
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';

const theme = {
  primary: '22223b',
  secondary: '4a4e69',
  accent: '9a8c98',
  light: 'c9ada7',
  bg: 'f2e9e4'
};

require('./slide-01.js').createSlide(pres, theme);
pres.writeFile({ fileName: './output/my-deck-name.pptx' });
```

## Template Imitation Workflow

Use this when the user provides a reference PPTX for visual style, but all content is new.

### Step 1: Analyze Template Visual Identity

1. Take screenshots of 3-5 representative slides: cover, a content-heavy slide, and a data slide.
2. Run `audit_pptx.py --sections themes,masters,shapes` to extract theme colors, fonts, and layout usage.
3. Determine dark-mode vs light-mode:
   - Check the most-used slide layouts. If their backgrounds use `dk1`/`dk2` colors with dark values such as `1A1A1A` or `0D0D0D`, the template is dark-mode.
   - Look at screenshots: dark backgrounds with light text indicate dark-mode.
4. Record the template's visual identity:
   - Slide background color
   - Primary text color
   - Accent color(s)
   - Card/panel background color
   - Font families for title and body

### Step 2: Map to Theme Keys Faithfully

Map the template's actual colors to the 5-key theme, respecting the template's color roles:

```text
bg        = actual slide background color (may be dark)
primary   = actual body text color (may be light)
accent    = primary accent/highlight color
secondary = secondary/muted text color
light     = card/panel background color
```

Do not pick from `references/design-system.md` palettes. Use the template's actual colors.

Do not assume `bg` is light and `primary` is dark. Dark-mode templates flip this.

### Step 3: Use Template Fonts

Use the font families from the template audit, not `references/design-system.md` recommendations. Only fall back to recommended pairings if the template fonts are unavailable on the target system.

### Step 4: Generate

Do all of the following (these are the From-Scratch Workflow steps, adapted — do NOT skip any):

1. Derive a concise outline from topic, audience, purpose, and expected depth.
2. Assign each slide one page type from `references/slide-types.md`.
3. Create `slides/slide-XX.js` modules and keep layout variety where the outline calls for it.
4. Run the pre-compile lint in `references/pitfalls.md#pre-compile-lint` before compiling.
5. Create `slides/compile.js`, load slide modules in final order, and write `slides/output/<descriptive-name>.pptx`.
6. For Mavis-generated decks, write `slides/output/<descriptive-name>.mavis-ppt-map.json` as a sidecar using `references/element-map.md`.
7. Run the QA process in `references/pitfalls.md#qa-process`, fix issues, and re-verify. **Do NOT return the deck until QA passes.**

Skip palette/font selection (step 2 of From-Scratch) because palette and fonts come from the template.

## Template Editing Workflow

Use this when the user provides a source PPTX and expects structure or layout to survive.

- Prefer preserving slide masters, theme relationships, and layout semantics.
- Complete structural edits first, then content edits.
- Follow `references/editing.md` for XML-level workflow and pitfalls.
- Only switch to from-scratch generation if it does not violate the user's intent.

## Delivery Checklist

- slides render without runtime errors
- layout is `LAYOUT_16x9`
- no `#` in colors
- all slide modules are synchronous
- all non-cover slides include page numbers
- no placeholder/demo text remains
- titles do not wrap awkwardly
- repeated elements align consistently
- final file is written successfully
- generated decks include an element-map sidecar when available, without changing the `.pptx` output contract
- inspection/editing tasks preserve the source file unless explicitly replacing it
- template imitation background color matches the template's dark/light mode
- template imitation fonts match the template's font families

## Operational Notes

- Screenshots are macOS-only and require `soffice` plus `swiftc`.
- `extract_comments.py` supports classic comments only, not modern Office 365 collaborative comments.
- If targeted `python-pptx` editing is needed, read `references/python-pptx-recipes.md` on demand instead of keeping those patterns in main context.

## Windows (win32) platform notes

On Windows, invoke bash scripts and piped commands via **Git Bash**:

```powershell
# QA verification with markitdown
bash -c "python -m markitdown output.pptx | grep -iE 'xxxx|lorem|ipsum|placeholder'"

# Python inspection via uv
uv run --with python-pptx scripts/extract_pptx.py file.pptx
```

> **Note:** `scripts/pptx-screenshot.sh` is **macOS-only** (requires Swift compiler + soffice).
> On Windows, use LibreOffice GUI export or `python-pptx` + pillow for slide previews.

| Unix reference | Windows handling |
|---|---|
| `python3` / `python -m` | `python` — works in both PowerShell and Git Bash |
| `/tmp/` for temp writes | Git Bash maps `/tmp/` automatically |
| `soffice` | Must be on PATH — `winget install TheDocumentFoundation.LibreOffice` |

**If Git Bash or any tool is missing**, read the `mavis` skill's
`references/windows-tool-bootstrap.md` for detection + auto-install commands.

## References

### Mandatory for Generation Tasks

Read these **before writing any slide code**. Do not skip them even if you think you already know the API:

- `references/pitfalls.md`: pre-compile lint, QA process, common PptxGenJS failures — **must run lint and QA**
- `references/pptxgenjs.md`: PptxGenJS API, layout dimensions, text/shape/table options — **must verify canvas dimensions**
- `references/slide-types.md`: page type classification and layout patterns — **must assign a type to each slide**
- `references/element-map.md`: optional sidecar metadata for Mavis-generated decks — **must not replace the PPTX output contract**

### Load On Demand

- `references/design-system.md`: palette, typography, style recipes (skip when imitating a template)
- `references/editing.md`: template-preserving editing workflow
- `references/python-pptx-recipes.md`: targeted python-pptx inspection or editing patterns
