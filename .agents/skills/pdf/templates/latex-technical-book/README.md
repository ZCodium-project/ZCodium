# LaTeX Technical Book Template

Use this template when the user wants a Chinese technical book / engineering monograph / source-code
reading book / algorithm or systems book in a polished LaTeX book format rather than a short HTML
report.

## When to use

Trigger examples:

- “把这些 HTML/Markdown 章节做成一本技术书”
- “中文技术书 LaTeX 模板”
- “源码解析书 / 工程实践书 / 算法书排版”
- “B5/16 开，目录、页眉页脚、代码块、引文框、结构图”
- “O'Reilly 风格封面 / 动物封面 / 技术出版读物”

Do **not** use this for academic thesis formatting; use `templates/latex-academic-thesis/` and
`docs/latex-academic-thesis-guide.md` instead.

## Files

- `source.tex` — compact generic scaffold with final technical-book style.
- `source.tex` includes a TikZ animal-style placeholder cover illustration. Replace that block with
  an `\includegraphics` call only when the user supplies a real cover image.
- `README.template-source.md` — the source project README retained for context.

## Style features

The scaffold includes:

- B5 / 16 开 page size: `176mm × 250mm`.
- O'Reilly-like framed cover with top/bottom red bars, optional animal illustration, publisher mark,
  and old-cover fallback command `\maketechbooktitleClassic` that is not used by default.
- Clickable `hyperref` table of contents with black text and red number/page accents.
- Running header showing current section title + page number; footer with book title / publisher /
  page number.
- Low-saturation code highlighting with `listings` and robust line breaking.
- Inline code/path support through `xurl` / `\path|...|` to prevent long API paths from overflowing.
- `insightbox`, `pullquotebox`, `diagramBox`, `warningbox`, theorem/definition/example boxes,
  exercises.
- `\fancydropcap{首}{段剩余文字}` for chapter/section opening paragraphs.
- `tabularx` ragged columns (`Y`) for robust technical tables.

## Copy-and-fill workflow

```bash
mkdir -p /tmp/technical-book
cp templates/latex-technical-book/source.tex /tmp/technical-book/main.tex
mkdir -p /tmp/technical-book/figures /tmp/technical-book/chapters /tmp/technical-book/backmatter
```

Then edit:

1. Book metadata in `main.tex`:
   - `\BookTitle`
   - `\BookTitleDetail`
   - `\BookAuthor`
   - `\BookPublisher`
   - `\BookYear`
2. Replace the preface text.
3. Replace `\input{chapters/chapter01}` etc. with the actual chapter files.
4. Replace the TikZ placeholder in `source.tex` only if the user supplied a cover illustration.
5. Keep `\tableofcontents`, `hyperref`, and `\phantomsection` entries intact so navigation remains
   clickable.

## HTML/Markdown → book conversion guidance

When source content is structured HTML pages:

- Inspect representative pages first: cover, TOC, first section, code-heavy page, table-heavy page,
  diagram-heavy page.
- Preserve semantic blocks, not CSS literally:
  - `p.dropcap` or leading `<span class="dropcap">` → `\fancydropcap{...}{...}` for Chinese prose
    only; avoid ASCII/digit drop caps.
  - `div.pullquote`, `blockquote`, `.pull-quote` → `pullquotebox`.
  - `ul.timeline` / `.year` spans → `diagramBox + description`.
  - `arch-diagram`, `dep-flow`, `flow-diagram`, `flow-chain`, `path-diagram`, `flow-row` → rebuild
    as LaTeX/TikZ or a `diagramBox`; do not drop diagrams silently.
  - `code` inline → `\path|...|` for ASCII paths/API names; plain escaped text for CJK-heavy inline
    snippets.
  - `pre code` → `lstlisting` with low-saturation highlighting.
  - `table` → `tabularx` with `Y` columns, small font, reduced `\tabcolsep`.
  - `ul`/`ol` feature lists → `enumitem` lists with red bullet/number accents.
- If the source references an image (`<img src="...">`) but the file is missing, report it. Do not
  invent that image; use a simple placeholder only when the user approves or supplies the asset.

## Compile

Preferred for this template: XeLaTeX via latexmk.

```bash
PATH="/usr/local/texlive/2026/bin/universal-darwin:$PATH" \
  latexmk -xelatex -interaction=nonstopmode main.tex
```

Fallback manual chain:

```bash
xelatex -interaction=nonstopmode main.tex
bibtex main || true
makeindex main || true
xelatex -interaction=nonstopmode main.tex
xelatex -interaction=nonstopmode main.tex
```

## Verification gates

Run these before delivery:

```bash
pdfinfo main.pdf | grep -E 'Pages|Page size'
grep -i "fatal\|undefined control sequence\|LaTeX Error" main.log
pdftotext main.pdf - | head -80
```

Expected:

- Page size is B5-like `176mm × 250mm` unless the user requested A4.
- No fatal LaTeX errors or undefined control sequences.
- Chinese text extracts correctly.
- TOC entries are clickable when opened in a PDF viewer.

## Common warnings

- `Overfull/Underfull hbox` can occur in very long code paths or dense tables. Reduce by using
  `\path`, smaller table font, `tabularx` `Y` columns, or manually splitting the cell.
- `lettrine` warnings mean a drop cap is too close to a page boundary. For final publishing, remove
  `\fancydropcap` on that paragraph or insert a local page break.
- Font shape warnings for CJK italics/small caps are usually harmless; avoid relying on italic CJK
  for semantic meaning.
