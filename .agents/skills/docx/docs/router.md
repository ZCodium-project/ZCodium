# Task router

Choose exactly one route. Dispatch first, then go straight to the matching task guide. Do not start
with backend preference, evidence classes, or validation profiles.

## Fast path

### Generation-first routes

1. **User wants a new formal Word deliverable** -> `CREATE_DOCX`
2. **User wants current content put into a template / institutional style system** -> `APPLY_TEMPLATE`

For these two routes, stop routing once the intent is clear. Go directly to the task guide. The task
guide will decide recipe family, backend, and acceptance in that order.

### Everything else

- read meaning -> `READ_CONTENT`
- inspect Word / OpenXML internals -> `READ_STRUCTURE`
- inspect what pages actually look like -> `READ_RENDERED`
- mutate an existing DOCX in place -> `EDIT_FILL_DOCX`
- fix visible defects -> `REPAIR_LAYOUT`
- compare two DOCX files -> `COMPARE_TWO_DOCX`

## Router

```text
User asks for a DOCX task
|
+-- Is the main goal to produce or restyle a formal Word deliverable?
|   |
|   +-- Yes
|   |   |
|   |   +-- No source DOCX must remain “the same document”
|   |   |   -> CREATE_DOCX
|   |   |
|   |   +-- Source content survives but template / institutional visual system is the point
|   |       -> APPLY_TEMPLATE
|   |
|   +-- No
|       |
|       +-- User wants to read / summarize / quote / search / extract
|       |   -> READ_CONTENT
|       |
|       +-- User wants styles / sections / numbering / TOC / comments / revisions / template internals
|       |   -> READ_STRUCTURE
|       |
|       +-- User wants page truth / visual mismatch / blank pages / overflow / cover / TOC layout
|       |   -> READ_RENDERED or REPAIR_LAYOUT
|       |
|       +-- User wants to change the content but keep this DOCX as the same document
|       |   -> EDIT_FILL_DOCX
|       |
|       +-- User gives two DOCX files and wants differences explained
|           -> COMPARE_TWO_DOCX
```

## Route-level environment gate

After selecting a route, run the matching gate level before proceeding.

| Route              | Gate level |
|--------------------|------------|
| READ_CONTENT       | read       |
| READ_STRUCTURE     | read       |
| READ_RENDERED      | render     |
| COMPARE_TWO_DOCX   | read       |
| CREATE_DOCX        | full       |
| APPLY_TEMPLATE     | full       |
| EDIT_FILL_DOCX     | full       |
| REPAIR_LAYOUT      | full       |

```bash
# macOS / Linux / WSL
bash <skill_dir>/scripts/env_check.sh --level <gate_level>
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File <skill_dir>\scripts\env_check.ps1 -Level <Read|Render|Full>
```

Do not run the full gate before route selection. The loader already ran the read gate; only
escalate to render or full when the selected route requires it.

## Route boundaries

### CREATE_DOCX
Use when there is no source DOCX to preserve as a document object. Markdown / HTML / LaTeX /
business brief source still belongs here after normalization.

### APPLY_TEMPLATE
Use when the user’s real ask is “make this content become that document system”. This includes school
templates, 公文格式, house style, and multi-section institutional layouts.

### EDIT_FILL_DOCX
Use when the source DOCX stays the same document and the user wants content mutation. If the real
source is Markdown / LaTeX and the DOCX is just a stale render, do not edit in place; regenerate.

### READ_CONTENT
Use for meaning. Do not answer TOC, section, numbering, or page-layout questions here.

### READ_STRUCTURE
Use for Word/OpenXML truth. This is the default diagnosis route before template-sensitive mutation.

### READ_RENDERED
Use when the user asks what the pages actually look like. Rendered pages judge correctness; XML only
explains causes.

### REPAIR_LAYOUT
Use when the complaint is visual and the goal is correction, not just inspection.

### COMPARE_TWO_DOCX
Use when the user asks for a before/after or source/template difference analysis.

## Common misroutes

- “帮我写个 Word 报告” is **not** READ_CONTENT
- “套成学校模板” is **not** plain EDIT_FILL_DOCX
- “这份文档为什么看起来不对” is **not** automatically READ_STRUCTURE — it may be READ_RENDERED or REPAIR_LAYOUT
- “改这份 Word 的几段内容” is **not** CREATE_DOCX
- “这两个 docx 差在哪” is **not** ordinary READ_CONTENT
