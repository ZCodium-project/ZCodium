# 中文技术出版读物 LaTeX 模板

这是一个面向中文技术书出版的 LaTeX 模板，适合计算机科学教材、算法书、系统设计书、工程实践类专著。模板采用 B5
/ 16 开近似尺寸 `176mm × 250mm`，比 A4 更接近正式中文技术书样张。

## 编译

```bash
latexmk -xelatex -interaction=nonstopmode main.tex
```

或手动：

```bash
xelatex main.tex
bibtex main
makeindex main
xelatex main.tex
xelatex main.tex
```

## 文件结构

```text
technical-book-latex-template/
├── main.tex
├── references.bib
├── frontmatter/
│   ├── copyright.tex
│   └── preface.tex
├── chapters/
│   ├── chapter01.tex
│   ├── chapter02.tex
│   └── chapter03.tex
├── backmatter/
│   └── appendix.tex
└── figures/
```

## 主要特性

- B5 / 16 开中文技术书版式：`176mm × 250mm`。
- 双面排版，章节默认右页开始。
- 中文环境名：定义、定理、例、要点提示、常见误区、习题、本章延伸阅读。
- 支持算法伪代码、代码清单、表格、参考文献和索引。
- 使用 `hyperref` 生成可点击目录和引用。

## 正式出版前建议

正式交付出版社前，请确认：开本、版心、页边距、字体授权、ISBN、版权页、CIP 信息、图表分辨率和印刷出血规范。

## 当前风格

本模板已更新为与 `harness-book` 成书版一致的技术出版风格，但保留通用占位内容：

- O'Reilly / 技术动物封面风格，默认使用 TikZ 动物线稿占位；旧封面保留为
  `\maketechbooktitleClassic`，默认不编译。
- 目录编号与页码采用红色强调，正文目录文字保持黑色。
- 正文包含首字下沉、引文框、提示框、图示框、低饱和代码高亮、自动换行的行内代码路径等样式。
- 页眉仅显示当前小节标题，页脚显示书名、出版标识与页码。

正式成书时，建议替换 `main.tex` 中的书籍元数据、前言、章节文件与封面插图。
