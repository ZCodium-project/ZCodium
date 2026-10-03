# LaTeX Academic Thesis Template

Compact scaffold for Chinese undergraduate / graduate theses (本科毕业论文,
硕士论文). All structural components are present with minimal content so the
agent can substitute real content without re-engineering the formatting.

## When to use this template

User asks to:
- Typeset a university thesis from an existing `.tex` file
- Apply a school template to thesis content
- Merge a cover PDF with a body PDF
- Fix page geometry, header/footer, bibliography style, or figure numbering
  in an existing thesis

## Structural invariants

| Component | `main.tex` location | Notes |
|---|---|---|
| Page geometry | Preamble (`geometry`) | A4, school-specific margins |
| Chinese fonts | Preamble (`fontspec`) | Songti SC + Times New Roman |
| Title hierarchy | `\ctexset{...}` in preamble | section / subsection / subsubsection |
| Header/footer | Preamble (`fancyhdr`) | Odd/even different; page number outside |
| Front matter | `\begin{document}` → body | roman page numbers |
| `\section{...}` | Body | `break = \clearpage` on section |
| Figures | `\begin{figure}[H]` | `caption{...}\label{fig:...}` |
| Tables | `\begin{table}[H]` | `booktabs` three-line table |
| Formulas | `equation` or `align` env | `\label{eq:...}` |
| Bibliography | `\thebibliography` or BibTeX | GB/T 7714-2015 numeric |
| Appendix | `\appendix` + `\section*` | Continues figure/table numbering |
| Cover merge | External PDF + `qpdf` | Separate step, not in tex |

## How to fill in

1. **Cover page**: replace `<学校>`, `<论文题目>`, `<学生姓名>`, `<学号>`,
   `<指导教师>`, `<专业>`, `<完成日期>`.
2. **Abstract**: replace the Chinese abstract paragraph and keywords.
3. **Abstract (English)**: replace the English abstract paragraph and keywords.
4. **Body sections**: keep all `\section`, `\subsection`, `\subsubsection`
   commands; replace body text.
5. **Figures**: place image files in `../图表/` or `../figures/`; update
   `\includegraphics[width=...]{filename}`.
6. **Tables**: replace tabular content inside `booktabs` environments.
7. **References**: add `\bibitem{...}` entries or populate `.bib` file.
8. **Appendix**: replace with actual appendix content; remove if not needed.

## Compile

```bash
# tectonic — preferred (auto-installs packages)
cd /path/to/thesis-dir
tectonic main.tex --outdir .

# xelatex + bibtex — fallback
xelatex main.tex && bibtex main && xelatex main.tex && xelatex main.tex
```

## Merge cover PDF (if cover is external)

```bash
# 封面 PDF（封面1页在前） + 正文 PDF（全部页面在后）
qpdf --empty --pages cover_page.pdf 1-z body.pdf 1-z -- final_output.pdf
pdfinfo final_output.pdf | grep Pages
```

## Common patterns from this template

### Heading with correct spacing (南理工 spec)

```latex
\ctexset{
  section = { format = \raggedright\songti\bfseries\zihao{-3},
               beforeskip = 18pt, afterskip = 18pt,
               break = \clearpage },
  subsection = { format = \raggedright\songti\bfseries\zihao{4},
                 beforeskip = 12pt, afterskip = 12pt },
  subsubsection = { format = \raggedright\songti\bfseries\zihao{-4},
                    beforeskip = 6pt, afterskip = 6pt },
}
```

### Three-line table (booktabs)

```latex
\begin{table}[H]
  \centering
  \caption{表格标题}
  \label{tab:example}
  \begin{tabular}{lll}
    \toprule
    \textbf{列1} & \textbf{列2} & \textbf{列3} \\
    \midrule
    数据1 & 数据2 & 数据3 \\
    \bottomrule
  \end{tabular}
\end{table}
```

### Figure with Chinese caption

```latex
\usepackage{subcaption}
\DeclareCaptionFont{songwu}{\songti\zihao{5}}
\captionsetup{font=songwu, labelfont=songwu, labelsep=space}

\begin{figure}[H]
  \centering
  \includegraphics[width=0.65\textwidth]{fig1.jpg}
  \caption{图注说明}
  \label{fig:example}
\end{figure}
```

### Equation with section numbering

```latex
\counterwithin{equation}{section}
\refstepcounter{section}
\section{绪论}
% ...
\begin{equation}
    t_{latency} = t_{switch} - t_{wakeup}
    \label{eq:sched-latency}
\end{equation}
% Reference: 式\eqref{eq:sched-latency}
```

### GB/T 7714-2015 bibliography

```latex
\usepackage[numbers,sort&compress]{natbib}
\bibliographystyle{gbt7714-numerical}
% or use thebibliography:
\begin{thebibliography}{99}
  \bibitem{key1} Author A, Author B. Title[J]. Journal, 2024, 1(1): 1-10.
\end{thebibliography}
```

## What not to change

- `\usepackage{geometry}` settings — they encode the school page spec.
- `\ctexset{...}` title formatting — it encodes the school heading spec.
- `fancyhdr` header/footer definition — it encodes odd/even page logic.
- `\counterwithin{figure}{section}` and related commands — they encode
  per-chapter figure/table/equation numbering.
- `\AtBeginDocument{\zihao{-4}...}` — body font size is school-specified.
