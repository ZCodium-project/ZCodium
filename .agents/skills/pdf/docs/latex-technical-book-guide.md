# Guide: LaTeX Technical Book → PDF

Use this route for polished Chinese technical books, engineering monographs, source-code reading
books, algorithm books, systems design books, or long-form book-like content that should be typeset
with LaTeX rather than HTML.

This is distinct from the academic-thesis route. Do not apply university thesis formatting rules
here unless the user explicitly asks for an academic thesis.

---

## Trigger signatures

- “中文技术书 LaTeX 模板”
- “把这些 HTML 页面整理成一本书”
- “源码解析书 / 工程实践书 / 多 Agent 平台书稿”
- “B5 / 16 开技术出版读物”
- “O'Reilly 风格封面 / 动物封面 / 技术书封面”
- “代码块、目录、页眉页脚、引文框、结构图都要像书”

---

## Starting point

Start from:

```text
templates/latex-technical-book/source.tex
```

The template uses a TikZ animal-style placeholder by default, so no binary cover illustration is
required. If the user provides a real cover image, copy it into `figures/` and replace the
placeholder block in `source.tex` with an `\includegraphics` call. If the source HTML references an
image that is absent, tell the user instead of pretending the image exists.

---

## Required workflow

1. **Inspect source structure first**
   - Read cover, TOC, a normal prose page, a code-heavy page, a table-heavy page, and a
     diagram-heavy page.
   - Identify semantic classes: `dropcap`, `pullquote`, `timeline`, `arch-diagram`, `dep-flow`,
     `flow-diagram`, `code`, `table`, etc.

2. **Generate semantic LaTeX, not literal CSS**
   - Preserve headings/sections through `\chapter`, `\section`, `\subsection`.
   - Preserve diagrams by rebuilding them with TikZ or `diagramBox`; do not drop structural
     diagrams.
   - Preserve callouts as `pullquotebox`/`insightbox`/`warningbox`.
   - Preserve inline code as breakable `\path|...|` when ASCII-heavy.

3. **Keep navigation clickable**
   - `hyperref` is mandatory.
   - Keep `\tableofcontents`.
   - Use `\phantomsection` before manual TOC entries.

4. **Compile with XeLaTeX**
   - Use `latexmk -xelatex -interaction=nonstopmode main.tex`.
   - Run enough passes to resolve TOC and links.

5. **Verify before delivery**
   - No fatal LaTeX errors / undefined control sequences.
   - Page size and page count are reasonable.
   - Open and visually inspect cover, TOC, one prose page, one code page, one table/diagram page.

---

## Mapping rules for HTML sources

Use semantic mappings rather than literal CSS copying:

- `p.dropcap`, `span.dropcap` → `\fancydropcap{首}{剩余文字}` for Chinese prose only; skip
  ASCII/digit starts.
- `div.pullquote`, `.pull-quote`, `blockquote` → `pullquotebox`.
- `ul.timeline` with `.year` → `diagramBox` plus `description`.
- `.arch-diagram`, `.dep-flow` → TikZ diagram inside `diagramBox`.
- `.flow-diagram`, `.flow-chain`, `.path-diagram`, `.flow-row` → TikZ or structured `diagramBox`;
  preserve all nodes/arrows.
- Inline `<code>` → `\path+...+` (or another delimiter) when ASCII/path/API-like; escaped normal
  text when CJK-heavy.
- `<pre><code>` → `lstlisting` with low-saturation highlighting.
- `<table>` → `tabularx` with ragged `Y` columns; reduce `\tabcolsep`; use `\scriptsize` for many
  columns.
- `<ul>` / `<ol>` → `enumitem` lists with restrained red marker/number accents.

---

## Design contract

- Cover can use the O'Reilly-like framed style from `source.tex`.
- If using an animal cover, align paper/background tone with the image's edge color to avoid visible
  mismatched rectangles.
- Avoid overusing accent color. In the template, red is used for rules, TOC numbers, quote bars, and
  small markers — not for body prose.
- Keep code highlighting muted, not neon.
- Page header should be short: current section title + page number, not chapter title and section
  title concatenated.

---

## Common pitfalls

1. **Forgetting special HTML blocks** — plain text conversion loses the book feel. Always scan
   classes and map key style semantics.
2. **Missing cover assets** — if HTML references a cover image but the file is not present, ask for
   it or use the TikZ placeholder explicitly.
3. **Drop caps everywhere** — use on opening prose paragraphs; skip ASCII/digit starts and remove
   when `lettrine` warns near page boundaries.
4. **Long code paths overflow** — prefer `\path`, `xurl`, `tabularx`, and manual line breaks for
   extreme cells.
5. **Static TOC** — never hand-type TOC. Use LaTeX-generated clickable TOC.
