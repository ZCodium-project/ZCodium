# Guide: LaTeX Academic Thesis → PDF

Use this route when the user asks to generate, compile, or typeset an academic
thesis / dissertation / 毕业论文 / 学士论文 / 硕士论文 / 博士论文 using LaTeX,
especially with a university-provided template or Chinese national standard
format (GB/T 7714 bibliography, GB/T 7714 title rules, etc.).

This route does **not** write the thesis content for you — it provides the
toolchain, template scaffold, compilation workflow, and verification gates so
that a pre-authored `.tex` file (or a user's content) produces a correctly
formatted PDF.

---

## Trigger signatures

Match any of these; read the guide before doing anything:

- "用 LaTeX 生成/排版学术论文"
- "毕业论文 LaTeX 模板"
- "学士论文 PDF 封面合并"
- "LaTeX 编译 生成 PDF"
- "参考文献 GB/T 7714 编号"
- "页眉页脚 奇偶页 不同"
- "目录含一二三级标题"
- "三线表 格式"
- "学校论文格式 A4"
- "qpdf 合并封面 PDF"

---

## What this route does

1. **Scaffold** a Chinese academic thesis `main.tex` covering all required
   structural components (cover, abstract, TOC, body, bibliography, appendix).
2. **Compile** with `tectonic` (preferred, auto-fetches packages) or `xelatex
   + bibtex` (fallback).
3. **Verify** page size, page numbering breaks, header/footer, undefined
   references/citations.
4. **Merge** a separate cover PDF with the body PDF via `qpdf` when the cover
   is provided as an external file.

---

## What this route does NOT do

- Do **not** write the thesis body content from scratch. Extract structure and
  formatting rules from the user's content; do not invent or alter text.
- Do **not** route DOCX/Word tasks here — use `docx`.
- Do **not** use HTML→PDF for an academic thesis that requires LaTeX typesetting.
- Do **not** ignore `undefined reference`, `undefined citation`, or `fatal`
  warnings in `main.log` — they indicate broken cross-references or bibliography.
- Do **not** re-number references on every re-citation — use the bibliography
  style's built-in compression (`sort&compress` with `natbib`).

---

## Input collection checklist

Before writing any LaTeX or running any compile, collect:

| Item | How to get it | Why it matters |
|---|---|---|
| University / degree level | Ask user | Determines title formatting, page geometry |
| Page geometry | A4; top/bottom/left/right mm values | Passed to `geometry` package |
| Font requirements | e.g. "小四宋体 20pt", "Times New Roman" | Sets `\zihao{}`, `\setCJKmainfont` |
| Heading hierarchy | e.g. 一级小三加粗, 二级四号, 三级小四 | Sets `\ctexset{section/...}` |
| Bibliography style | GB/T 7714-2015 numeric; author-date | Sets `\bibliographystyle{gbt7714-numerical}` |
| Page numbering breaks | Roman (摘要/目录) → Arabic (正文) | Sets `\pagenumbering{roman/arabic}` |
| Figure/table caption style | e.g. 五号宋体, labelsep=space | Sets `\captionsetup` |
| Cover page | External PDF or LaTeX built-in? | Determines qpdf merge step |
| Whether `thebibliography` or BibTeX | Ask user or check source | Changes compile chain |
| External figure/table dirs | `graphicspath{{../charts/}{../photos/}}` | Resolves `\includegraphics` |
| Clickable TOC/index | All major sections, appendix, references | `hyperref` + `\tableofcontents` and live destinations |

---

## Implementation flow

### Step 1 — Write the compact template

Use the scaffold in `templates/latex-academic-thesis/source.tex` as the starting
point. Fill in the structural placeholders (title, author, supervisor, date,
school name). Keep all formatting commands — only replace content.

Key formatting blocks in the scaffold:

```latex
% Page geometry (南理工学士论文 spec)
\usepackage[a4paper, top=30mm, bottom=24mm, left=25mm, right=25mm,
  headheight=15pt, headsep=10mm, footskip=20mm]{geometry}

% Chinese font: Songti SC + Times New Roman
\usepackage{fontspec}
\setmainfont{Times New Roman}
\setCJKmainfont[AutoFakeBold=2.5]{Songti SC}

% Title formatting (南理工 spec)
\ctexset{
  section = { format = \raggedright\songti\bfseries\zihao{-3},
               beforeskip = 18pt, afterskip = 18pt, break = \clearpage },
  subsection = { format = \raggedright\songti\bfseries\zihao{4},
                 beforeskip = 12pt, afterskip = 12pt },
  subsubsection = { format = \raggedright\songti\bfseries\zihao{-4},
                    beforeskip = 6pt, afterskip = 6pt },
}

% Fancy header/footer (different odd/even pages)
\usepackage{fancyhdr}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[CO]{...}\fancyhead[CE]{...}
\fancyfoot[LE,RO]{\thepage}
```

Clickable navigation is mandatory: keep `hyperref` enabled, keep
`\tableofcontents`, and use `\phantomsection` before every manual
`\addcontentsline` entry such as abstract, appendix, or references. Do not
replace the generated TOC with plain text page numbers.

### Step 2 — Compile

**Preferred — tectonic (no manual package install):**
```bash
cd /path/to/thesis-dir
tectonic main.tex --outdir . 2>&1
```

**Fallback — xelatex + bibtex:**
```bash
cd /path/to/thesis-dir
xelatex main.tex && bibtex main && xelatex main.tex && xelatex main.tex
```

> Always run xelatex **twice after bibtex** to resolve cross-references and
> thebibliography page numbers. Three total runs is the safe minimum.

### Step 3 — Verify

```bash
# 1. Page size must be A4
pdfinfo main.pdf | grep "Page size"
# Expected: A4 = 595 x 842 pts (or 210 x 297 mm)

# 2. For xelatex: check log for fatal / undefined errors
grep -i "fatal\|undefined" main.log
# Must be empty (warnings are OK; tectonic does not emit main.log)

# 3. For xelatex: check for undefined references
grep "undefined reference" main.log
# Must be empty

# 4. For xelatex: check for undefined citations
grep "undefined" main.log | grep citation
# Must be empty

# 5. Page count spot-check
pdfinfo main.pdf | grep Pages
# Confirm reasonable page count

# 6. Text extraction spot-check
pdftotext main.pdf - | head -50
# Verify Chinese characters render (not CID-glyphs)

# 7. Navigation spot-check
# Open main.pdf and click several TOC entries; they must jump to the intended
# section pages. If the PDF was merged with an external cover, repeat this check
# on the final merged PDF because page offsets may change.
```

### Step 4 — Merge cover PDF (if external)

```bash
# 封面 PDF（1页）在前，正文 PDF（1-z）在后
# 正确顺序：封面 → 正文
qpdf --empty --pages cover.pdf 1-z body.pdf 1-z -- final.pdf

# 验证合并结果
pdfinfo final.pdf | grep Pages
pdftotext final.pdf - | head -20
# Also open final.pdf and spot-click TOC entries; ensure cover merge did not
# break internal TOC destinations or page offsets.
```

---

## Recommended toolchain

| Tool | Purpose | Install |
|---|---|---|
| `tectonic` | LaTeX compiler, auto-fetches packages | `brew install tectonic` |
| `xelatex` + `bibtex` | Fallback compile chain | `brew install basictex` |
| `qpdf` | PDF merge / split | `brew install qpdf` |
| `pdfinfo` | Verify page size and page count | `brew install poppler` |
| `pdftotext` | Extract text to verify rendering | `brew install poppler` |
| `grep` | Check `main.log` for undefined/fatal | system |

---

## Common pitfalls

1. **Missing `\clearpage` before `\section`** — without `break = \clearpage`,
   long sections can cause page geometry violations.
2. **Roman → Arabic page numbering gap** — `\newpage\clearpage\pagestyle{plain}`
   before `\pagenumbering{arabic}` prevents orphaned headers.
3. **Caption font size ignored** — `\captionsetup{font=...}` must come **after**
   `\usepackage{fontspec}` to avoid interference.
4. **`AutoFakeBold` too heavy or too light** — values between 1.5–3.0 are
   typical; 2.5 is a good default for "bold" Songti that matches Word output.
5. **`sort&compress` not working** — must use `natbib` with `numbers` option,
   not the default `authoryear`.
6. **qpdf merge creates blank pages** — ensure cover PDF page count is
   accounted for; use `qpdf --empty --pages` syntax precisely.
7. **Latin Modern / CM fonts for CJK** — always set `\setCJKmainfont`; never
   rely on the LaTeX default font for Chinese characters.
8. **Multiple `hyperref` warnings** — load `hyperref` last (or nearly last) to
    avoid option conflicts with `caption`, `subcaption`, `booktabs`.
9. **Overfull `\hbox`** — add `\emergencystretch=0.5em` in the preamble.
10. **`\ref` vs `\pageref`** — use `\ref` for section/figure numbers; do not
     mix them in a single document without checking context.
11. **Plain-text TOC** — never hand-type a static table of contents; use
    `\tableofcontents` with `hyperref` so entries remain clickable. For manual
    front-matter entries, add `\phantomsection` immediately before
    `\addcontentsline` or links jump to the previous page.

---

## Reference

| File | Purpose |
|---|---|
| [`templates/latex-academic-thesis/source.tex`](templates/latex-academic-thesis/source.tex) | Compact scaffold — all structural components, minimal content |
| [`templates/latex-academic-thesis/README.md`](templates/latex-academic-thesis/README.md) | Template usage — fill-in-the-blanks recipe |
| [`docs/annual-report-financial-digest-latex-case.md`](docs/annual-report-financial-digest-latex-case.md) | Case: long annual-report PDF → compact LaTeX digest (LaTeX compile, tectonic, chart generation) |
