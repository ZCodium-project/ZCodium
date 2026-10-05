---
name: docx
metadata:
  version: "4.0.0"
  category: document-processing
  status: stable
  author: MiniMaxAI
  sources:
    - "ECMA-376 Office Open XML File Formats"
    - "GB/T 9704-2012 Layout Standard for Official Documents"
    - "IEEE / ACM / APA / MLA / Chicago / Turabian Style Guides"
    - "Springer LNCS / Nature / HBR Document Templates"
description: >
  Unified DOCX skill — create, template-apply, edit/fill, read, repair, and compare Word documents.
  Use for formal Word deliverables and DOCX diagnosis. Not for PDF/PPT or casual plain-text drafting.
descriptions:
  zh-Hans: "创建、套模板、编辑、读取、修复和比较 Word DOCX 文档，适用于正式文档交付。"
triggers:
  - Word
  - docx
  - document
  - 文档
  - Word文档
  - 报告
  - 合同
  - 公文
  - 套模板
  - 排版
  - 修目录
  - 修页眉页脚
---

<!--
Copied from MiniMaxAI/minimax-code (packages/local-runtime/assets/skills/docx)
at revision 564e9166d81f87b0b767b005e4779d4697b512be.
Copyright (c) 2026 MiniMax Code. Licensed under MIT.
Modified by ZCode: added the provenance notice; added a ZCodium capability-matrix section (read / render / full and what each level needs), and documented that setup.sh is report-only unless --install-dotnet is passed. Skill instructions are otherwise unchanged.
See THIRD-PARTY-NOTICES.md in the repository root for license and provenance.
-->

# docx

Replace `<skill_dir>` with the actual skill path shown by the loader.

Unified DOCX skill. `SKILL.md` is the dispatch layer. Pick the route that matches the user’s intent,
read that route guide, then go straight into execution. Do not front-load every task with the full
evidence/backend/acceptance waterfall.

## Environment gates

The env gate ships in two equivalent dialects so the skill works on macOS, Linux/WSL, and
Windows without any cygwin/git-bash hack:

| Platform | Setup | Env check |
|---|---|---|
| macOS / Linux / WSL | `bash <skill_dir>/scripts/setup.sh` | `bash <skill_dir>/scripts/env_check.sh --level <lvl>` |
| Windows (PowerShell 5.1+) | `powershell -ExecutionPolicy Bypass -File <skill_dir>\scripts\setup.ps1` | `powershell -ExecutionPolicy Bypass -File <skill_dir>\scripts\env_check.ps1 -Level <lvl>` |

Both dialects accept the same three levels (`read | render | full`, default `full`) and produce
the same `[OK] / [FAIL] / Status: READY|NOT READY` lines, so a route may be gated on either one.

The skill loader runs **only the read gate** at load time, so missing dotnet/soffice does not
block read-only routes.

### Read gate

Checked at skill load time (automatic). Applies to: `READ_CONTENT`, `READ_STRUCTURE`, `COMPARE_TWO_DOCX`.

```bash
# macOS / Linux / WSL
bash <skill_dir>/scripts/env_check.sh --level read

# Windows
powershell -ExecutionPolicy Bypass -File <skill_dir>\scripts\env_check.ps1 -Level Read
```

Requires: `python3` (or `python` launcher on Windows), `unzip` (or `tar.exe` on Windows 10+), UTF-8 console.

If the read gate fails, the skill cannot load at all.

### Render gate

Run before `READ_RENDERED` routes. Includes all read-level checks plus:

```bash
bash <skill_dir>/scripts/env_check.sh --level render                                # *nix
powershell -ExecutionPolicy Bypass -File <skill_dir>\scripts\env_check.ps1 -Level Render   # Windows
```

Requires (in addition to read): `soffice` / `soffice.exe`, `pdftoppm` (or `pdftocairo`).

If the render gate fails, stop and report. Do not silently fall back to structure-only reads.

### Full gate

Run before `CREATE_DOCX`, `APPLY_TEMPLATE`, `EDIT_FILL_DOCX`, `REPAIR_LAYOUT` routes.

```bash
bash <skill_dir>/scripts/env_check.sh --level full                                  # *nix
powershell -ExecutionPolicy Bypass -File <skill_dir>\scripts\env_check.ps1 -Level Full     # Windows
```

Requires (in addition to render): `dotnet` >= 9, `pandoc`, `zip` (or `Compress-Archive` on Windows),
dotnet project built.

If the full gate fails, stop and report. Do not attempt generation with missing dependencies.

### Capability matrix in ZCodium

The levels above assume a machine where the skill may install its own toolchain. In ZCodium the
repo skills must not silently change the host, so `scripts/setup.sh` is report-only unless you
opt in. Check the level you actually need before promising a deliverable:

| Level | Needs | Without it |
| --- | --- | --- |
| `read` | `python3` (+ `pdftoppm` for page images) | — |
| `render` | read + `soffice` / `pandoc` | no PDF/PNG preview of the result |
| `full` | render + `dotnet` >= 9 + `zip` | **creation, template application, validation and track-changes editing are unavailable** — say so instead of guessing |

`.NET` is a global SDK and the upstream installer fetched it with `curl | sh`, so this fork makes it
opt-in: run `bash scripts/setup.sh --install-dotnet` (writes `~/.dotnet`, no sudo) only after the
user agrees. The setup script never edits `~/.zprofile` / `~/.zshrc` and never installs global npm
packages; it prints the lines the user may want to add themselves.

**On an air-gapped or intranet host** the `curl | sh` and package-manager paths cannot work at all.
Plan for `read` / `render` and use the `full` gate only where a pre-provisioned SDK exists.

### Cross-platform path & temp-dir convention

Examples in `docs/` and `references/` are written for *nix shells. When you execute on Windows,
do these substitutions consistently:

| In the example | Windows substitute |
|---|---|
| `<skill_dir>/scripts/foo.sh` | `<skill_dir>\scripts\foo.ps1` (every `.sh` has a `.ps1` peer) |
| `python3 <skill_dir>/scripts/foo.py` | `python <skill_dir>\scripts\foo.py` (the `.py` files are cross-platform) |
| `/tmp/docx-<thing>` | `$env:TEMP\docx-<thing>` |
| `bash <skill_dir>/scripts/setup.sh` | `powershell -ExecutionPolicy Bypass -File <skill_dir>\scripts\setup.ps1` |
| `forward slashes in paths` | backslashes; quote any path containing spaces |

Never invoke a `.sh` script through git-bash on Windows — `setup.sh` will refuse to install
anything on `MINGW*/MSYS*/CYGWIN*` and tell you to switch to `powershell.exe` / `pwsh.exe`.

## Operational rules — read before doing anything

> **1. Dispatch by user intent, not by backend.**
>
> Start with the shortest route choice:
>
> - creating a new formal Word deliverable -> `CREATE_DOCX`
> - preserving content but changing template / institutional style -> `APPLY_TEMPLATE`
> - editing an existing DOCX in place -> `EDIT_FILL_DOCX`
> - reading text / structure / rendered pages -> matching read route
> - fixing visible defects -> `REPAIR_LAYOUT`
> - comparing two DOCX files -> `COMPARE_TWO_DOCX`
>
> Read `docs/router.md` only to settle the route. Do not read `docs/evidence.md`, `docs/backends.md`,
> and `docs/acceptance.md` before route selection.

> **2. For generation routes, choose style family / recipe before backend.**
>
> The old benchmarked generation core stays in this skill. For `CREATE_DOCX` and `APPLY_TEMPLATE`,
> the first substantive decision is the visual system, not the backend. Reuse these files as the
> generation core:
>
> - `references/typography_guide.md`
> - `references/design_principles.md`
> - `references/cjk_typography.md`
> - `scripts/dotnet/MiniMaxAIDocx.Core/Samples/AestheticRecipeSamples*.cs`
>
> These are not optional decoration. They are the quality-preserving recipe layer.

> **3. Backend comes after route + recipe.**
>
> - `D` is the default write backend for formal DOCX creation, template application, and most edits.
> - `S` is only for OpenXML graph work beyond the builtin CLI surface.
> - `X` is only for deterministic local XML patch / inspection work.
> - Formal `CREATE_DOCX` is never routed to pandoc as a generation backend.
> - If a chosen backend gate fails, stop and report it. Do not silently switch.

> **4. Rendered acceptance is a post-write gate, not a pre-dispatch hop.**
>
> For template, layout, TOC, multi-section, header/footer, and page-number work, finish the write
> first, then run rendered acceptance from `docs/acceptance.md` / `docs/rendered-delivery.md`.

> **5. Keep DOCX execution inside this skill.**
>
> Do not bounce rendered diagnosis to another skill. Do not treat raw XML string replace as a valid
> editing strategy. Do not use `readlink`, `$0`, or shell path tricks in skill docs; use `<skill_dir>` only.

> **6. DOCX→PDF is native to this skill.**
> If the user asks to convert an existing Word/DOCX document to PDF while
> preserving layout, do it here via `python3 <skill_dir>/scripts/docx_to_pdf.py`
> (or `soffice --headless --convert-to pdf` as fallback), then verify the PDF.
> Do not route DOCX→Markdown/HTML→PDF for a preservation task: DOCX already
> carries page geometry, sections, headers/footers, fields, numbering, and table
> layout. HTML/PDF belongs to redesign/recomposition after native render fails
> or when explicitly requested.

## Routes — pick one, then read that guide

### WRITE / GENERATE a DOCX

| Intent | Guide | What happens next |
|---|---|---|
| **CREATE_DOCX** — author a new report / proposal / contract / memo / thesis / 公文 | `docs/task-create.md` | normalize source -> choose recipe family -> choose `D`/`S` -> write -> acceptance |
| **APPLY_TEMPLATE** — preserve content but move into a template / institutional visual system | `docs/task-apply-template.md` | choose template mode -> align recipe family -> read only the needed structure -> choose `D`/`S` -> write -> strict rendered acceptance |
| **EDIT_FILL_DOCX** — mutate content in an existing DOCX while keeping it the same document | `docs/task-edit-fill.md` | choose edit mode -> choose `X`/`D`/`S` -> mutate -> acceptance |

### READ / DIAGNOSE / REPAIR a DOCX

| Intent | Guide | Primary truth |
|---|---|---|
| **READ_CONTENT** — summarize / quote / retrieve text | `docs/task-read-content.md` | content |
| **READ_STRUCTURE** — inspect styles / sections / numbering / TOC / comments / revisions | `docs/task-read-structure.md` | structure |
| **READ_RENDERED** — inspect what the pages actually look like | `docs/task-read-rendered.md` | rendered + structure |
| **REPAIR_LAYOUT** — fix page-level defects | `docs/task-repair-layout.md` | rendered -> structure -> rendered |
| **COMPARE_TWO_DOCX** — explain before/after or source/template differences | `docs/task-compare-two-docx.md` | content + structure + rendered |

## Deep docs — only after the route is clear

| File | Use when |
|---|---|
| `docs/router.md` | settle route choice |
| `docs/evidence.md` | the selected route needs truth-source clarification |
| `docs/backends.md` | the selected route needs backend arbitration |
| `docs/acceptance.md` | you are ready to validate deliverables |
| `docs/rendered-delivery.md` | rendered issue report shape is required |

## Generation core references

Use these after `CREATE_DOCX` / `APPLY_TEMPLATE` is selected:

| File | Role |
|---|---|
| `references/scenario_a_create.md` | create-from-scratch mechanics |
| `references/scenario_c_apply_template.md` | template transfer and multi-section rules |
| `references/typography_guide.md` | font pairings, sizes, spacing, page layout, table rules |
| `references/design_principles.md` | visual judgment rules when exact specs are missing |
| `references/cjk_typography.md` | CJK fonts, 字号, mixed-script rules, 公文 defaults |
| `scripts/dotnet/MiniMaxAIDocx.Core/Samples/AestheticRecipeSamples*.cs` | benchmarked recipe families; choose one instead of inventing values |

## Runtime shorthands

```bash
# macOS / Linux / WSL
CLI="dotnet run --project <skill_dir>/scripts/dotnet/MiniMaxAIDocx.Cli --"
TMPDIR_DOCX="${TMPDIR:-/tmp}"
```

```powershell
# Windows PowerShell
$CLI = "dotnet run --project <skill_dir>\scripts\dotnet\MiniMaxAIDocx.Cli --"
$TmpDocx = $env:TEMP
```

Common commands (substitute `$TMPDIR_DOCX` / `$TmpDocx` for the literal `/tmp` examples elsewhere
in `docs/`):

```bash
$CLI analyze --input in.docx --json
$CLI diff --before before.docx --after after.docx
$CLI merge-runs --input out.docx
$CLI validate --input out.docx --xsd <skill_dir>/assets/xsd/wml-subset.xsd
$CLI validate --input out.docx --business
$CLI validate --input out.docx --gate-check <skill_dir>/assets/xsd/business-rules.xsd
python3 <skill_dir>/scripts/docx_to_pdf.py --input in.docx --output "$TMPDIR_DOCX/docx-render.pdf"
python3 <skill_dir>/scripts/render_docx_pages.py in.docx --output-dir "$TMPDIR_DOCX/docx-pages"
```

On Windows substitute `python3` -> `python`, `/` -> `\`, and `$TMPDIR_DOCX` -> `$env:TEMP`. The
underlying `.py` scripts use `tempfile.TemporaryDirectory` and `Path(...).expanduser().resolve()`
so they do not care which slash style you pass in.

## Structural non-negotiables

- `w:p` = `pPr` -> runs
- `w:r` = `rPr` -> text-like children
- `w:tbl` = `tblPr` -> `tblGrid` -> rows
- `w:body` ends with `sectPr`
- heading styles need `OutlineLevel`
- direct formatting contamination must be stripped unless explicitly preserved
- template and multi-section work must preserve section graph, `titlePg`, and per-section headers/footers

## Out of scope

- PDF / PPT deliverables -> use `pdf` / `pptx`
- casual plain-text drafting with no DOCX output
- pretending a Word-authored DOCX can be safely round-tripped through pandoc for formal output
