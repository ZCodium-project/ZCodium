# Case: DOC/DOCX legal contract → professional PDF + MD/HTML + round-trip DOCX

Use this case when a user asks to convert a Word contract/template into PDF, Markdown, HTML, and back to DOCX, and the PDF must be a professional legal/contract deliverable rather than a mechanical office export.

## Original user intent and acceptance criteria

**Representative prompt**

> 完成以下 Word 文档双向转换（使用附件合同模板）：
> 1. DOCX → PDF：保持高保真，中文字体正确显示
> 2. DOCX → Markdown：列表和表格转为 MD 语法
> 3. DOCX → HTML：保持样式，可嵌入网页
> 4. Markdown → DOCX（逆向验证）：将步骤 2 的 MD 转回 DOCX，评估信息损失

**Quality bar**

- PDF Chinese text renders correctly with no mojibake/tofu.
- PDF page layout is professional for a legal contract: A4, formal cover, readable clauses, controlled whitespace, signature table intact.
- Headers/footers are inspected from the source and either preserved, intentionally reconstructed, or explicitly reported as absent.
- Tables have borders, stable widths, and do not overflow the page.
- Hyperlinks are preserved when the source has real hyperlink relationships.
- PDF text is selectable/searchable, not screenshot-rendered.
- MD→DOCX reverse output is generated through the local `docx_engine.py render` route or the active docx equivalent; do not use `python-docx` for generation.
- Reverse DOCX audit passes and the report lists fidelity-loss items.
- For PDF generation, render editable HTML through `scripts/make.sh render`; do not use `convert_file`/screenshots.
- Numbered lists use explicit `<ol>/<li>` or literal numbering; do not rely on CSS counters.
- No decorative emoji/icons or invented ornamental elements.

## Case artifacts

Editable artifacts live under:

```text
templates/reformat-default/cases/pku-contract-roundtrip/
├── source.html       # professional A4 contract HTML; render this to reproduce the PDF
├── source.md         # Markdown extraction/normalization exemplar
└── docx_engine.py    # tiny compatibility wrapper for render/audit in environments lacking the historical tool
```

Do **not** store generated PDFs in the skill. Re-render from `source.html` when needed.

## Route decision: direct DOCX→PDF vs HTML→PDF

For ordinary DOCX→PDF conversion, **native DOCX render/export is the default**. Use docx `docx_to_pdf.py` or LibreOffice/soffice export and verify the result. Do not convert DOCX → Markdown/HTML → PDF just to obtain a PDF; that path discards Word pagination, headers/footers, fields, and table geometry.

Use the professional HTML→PDF reconstruction in this case only when one of these is true:

- the user explicitly asks for a redesigned/professional web-print PDF;
- the direct DOCX→PDF render is visibly poor (scattered cover, broken signature table, bad CJK font fallback, overflow);
- the task includes an editable web-embeddable HTML deliverable and the PDF should share that redesigned source.

When taking the HTML route, record it as a **recomposition decision** in the report and still keep the direct render as a reference when possible.

## End-to-end workflow

### 0. Preflight

```bash
SKILL={{DATA_DIR}}/.builtin-skills/pdf
DOCX_SKILL={{DATA_DIR}}/.builtin-skills/docx
WORK=/tmp/contract-roundtrip
mkdir -p "$WORK"

bash "$SKILL/scripts/make.sh" check
bash "$DOCX_SKILL/scripts/setup.sh"        # only if env_check is not ready
export PATH="$HOME/.dotnet:$PATH"
bash "$DOCX_SKILL/scripts/env_check.sh"
```

Recovery:

- If `env_check.sh` says dotnet is missing immediately after setup, export `PATH="$HOME/.dotnet:$PATH"` and rerun.
- Never suppress stderr for `soffice`, `pandoc`, render, or verification commands. Redirect to logs if needed.

### 1. Normalize the source Word file

Legacy `.doc` should first become `.docx`. Pandoc on `.doc` is unreliable.

```bash
cp "$INPUT_DOC_OR_DOCX" "$WORK/source_input"
if [[ "$INPUT_DOC_OR_DOCX" == *.doc && "$INPUT_DOC_OR_DOCX" != *.docx ]]; then
  soffice --headless --convert-to docx --outdir "$WORK" "$INPUT_DOC_OR_DOCX" \
    2>"$WORK/soffice-docx.log"
  INPUT_DOCX="$WORK/$(basename "${INPUT_DOC_OR_DOCX%.*}").docx"
else
  INPUT_DOCX="$INPUT_DOC_OR_DOCX"
fi
```

### 1.5. Direct DOCX→PDF render baseline (default preservation route)

Create a native DOCX-rendered PDF baseline before rebuilding anything. This is the correct route when the user wants faithful Word-to-PDF preservation because DOCX natively carries page geometry, sections, headers/footers, fields, numbering, and table layout.

```bash
python3 "$DOCX_SKILL/scripts/docx_to_pdf.py"   --input "$INPUT_DOCX"   --output "$WORK/direct-render.pdf" 2>"$WORK/docx-to-pdf.log"   || soffice --headless --convert-to pdf --outdir "$WORK" "$INPUT_DOCX"        2>"$WORK/soffice-pdf.log"

pdfinfo "$WORK/direct-render.pdf" | grep "Page size"
pdftotext "$WORK/direct-render.pdf" "$WORK/direct-render.txt"
pdfimages -list "$WORK/direct-render.pdf" > "$WORK/direct-render-images.txt"
```

If this native baseline is visually professional and satisfies page/text/table/header-footer checks, deliver it as the DOCX→PDF output. Only continue to HTML reconstruction if the baseline fails the professional standard or the user asked for redesign.

### 2. Inspect source structure before choosing the PDF route

Use the source inspection to decide whether a mechanical export is good enough. For legal contracts with signature pages, it usually is not.

```bash
python3 - <<'PY'
from pathlib import Path
import zipfile, xml.etree.ElementTree as ET, sys
p=Path(sys.argv[1])
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(p) as z:
    root=ET.fromstring(z.read('word/document.xml'))
    paras=root.findall('.//w:p', ns)
    tbls=root.findall('.//w:tbl', ns)
    hyperlinks=root.findall('.//w:hyperlink', ns)
    text=''.join(t.text or '' for t in root.findall('.//w:t', ns))
    print({'paragraphs':len(paras),'tables':len(tbls),'hyperlinks':len(hyperlinks),'chars':len(text)})
PY "$INPUT_DOCX"
```

Also inspect the generated Markdown and HTML quickly:

```bash
pandoc "$INPUT_DOCX" -t markdown+pipe_tables+grid_tables --wrap=none \
  --extract-media="$WORK/media" -o "$WORK/source.md" 2>"$WORK/pandoc-md.log"
pandoc "$INPUT_DOCX" -s -t html5 --metadata title="技术服务合同" \
  -o "$WORK/source.raw.html" 2>"$WORK/pandoc-html.log"
```

Look for:

- large signature tables with `rowspan`/`colspan`;
- cover pages represented by many centered paragraphs;
- empty underlined form fields;
- comments/tracked changes/headers/footers;
- real hyperlinks;
- header/footer content and whether first page differs from later pages.

If the contract PDF looks unprofessional after a raw export, **reconstruct the PDF from semantic HTML** using the strategy below.

### 3. Transformation and terminology rules

No translation is needed for same-language contract conversion, but terminology must stay stable:

| Source term | Keep as | Notes |
|---|---|---|
| 委托方（甲方） | 委托方（甲方） | Do not paraphrase as “客户/甲方” only. |
| 受托方（乙方） | 受托方（乙方） | Preserve party labels. |
| 技术服务合同 | 技术服务合同 | Main title; no marketing wording. |
| 签字盖章 | 签字盖章 | Signature/seal section heading. |
| 北京大学科学研究部监制 | 北京大学科学研究部监制 | Institutional line on cover. |
| 北京仲裁委员会 | 北京仲裁委员会 | Underline if source underlined. |

When adapting to another contract:

- Preserve legal clause numbers and party labels exactly.
- Do not summarize clauses unless the user explicitly asks.
- Empty fields should become form lines/blank blocks, not removed.
- Do not add brand decorations, icons, or emoji.

### 4. Asset and layout preservation strategy

**PDF is the presentation deliverable.** For legal/contract docs, prioritize a formal contract layout over mechanical fidelity when the raw conversion is ugly.

Use an editable HTML source with:

- A4 `@page` rule and explicit `--format A4` at render time.
- Running headers/footers for formal contracts, except where a cover page should remain clean. If the source has institutional header/footer text, preserve it; if absent, use a conservative title/template header and centered page footer, and state this reconstruction in the report.
- CJK legal-document font cascade, e.g. `"Songti SC", "STSong", "Noto Serif CJK SC", "SimSun", serif`.
- Formal cover: template note, title, expense/category line, form fields, supervising unit.
- Clause pages: `h2` clause headings, justified paragraphs, 2em indentation, controlled line-height.
- Fillable blanks: underlined inline spans or `blank-block` divs.
- Tables: fixed widths, explicit `colgroup`, borders, controlled font size for signature table.
- Signature page: rebuild wide merged-cell tables manually instead of trusting raw Pandoc table HTML.

Use the case artifact as a starting point:

```bash
cp "$SKILL/templates/reformat-default/cases/pku-contract-roundtrip/source.html" "$WORK/contract.html"
# Replace title, parties, clauses, and signature fields from the current source.
```

**HTML authoring prompt for future agents**

```text
Rewrite the extracted contract into semantic A4 HTML for a formal Chinese legal contract.
Keep all legal text, party labels, clause numbers, underlined terms, and blank fields.
Use Songti/STSong font stack, black/gray only, no icons/emoji.
Represent numbered lists with explicit ol/li or literal numbering, not CSS counters.
Represent signature/seal blocks with real HTML tables and borders; avoid overflow.
Add running headers/footers on non-cover pages; preserve source header/footer text when present, otherwise use conservative document-title header and page footer.
Do not store or edit the generated PDF; store the editable source HTML.
```

### 5. Render PDF through html_to_pdf route

```bash
bash "$SKILL/scripts/make.sh" render \
  --in "$WORK/contract.html" \
  --out "$OUTPUT_DIR/contract.pdf" \
  --format A4 \
  --wait 1000 2>"$WORK/render.log"
```

Expected evidence:

```bash
pdfinfo "$OUTPUT_DIR/contract.pdf" | tee "$OUTPUT_DIR/pdfinfo.txt"
pdftotext "$OUTPUT_DIR/contract.pdf" "$OUTPUT_DIR/pdf_text.txt"
pdfimages -list "$OUTPUT_DIR/contract.pdf" | tee "$OUTPUT_DIR/pdfimages.txt"
```

Pass conditions:

- `pdfinfo` page size is A4 (`595.92 x 842.88 pts`, or close equivalent).
- `pdftotext` extracts key Chinese terms (e.g. title, institution, clause headings, signature heading).
- `pdfimages -list` does not show full-page screenshot images unless the source truly had images.
- Visual spot-check of page 1 and signature page shows professional contract layout and no table overflow.
- Header/footer text appears on non-cover pages when expected, and does not collide with body content or signature tables.

For a visual spot-check:

```bash
pdftoppm -r 150 -png -f 1 -l 1 "$OUTPUT_DIR/contract.pdf" "$WORK/page1"
# Find signature page from pdftotext or page count, then rasterize it too.
```

### 6. Produce Markdown and HTML deliverables

Markdown should be honest about what it can and cannot represent.

```bash
pandoc "$INPUT_DOCX" -t markdown+pipe_tables+grid_tables --wrap=none \
  --extract-media="$OUTPUT_DIR/media" \
  -o "$OUTPUT_DIR/contract.md" 2>"$WORK/pandoc-md.log"
```

Normalize headings if the source only uses bold paragraphs for article headings. For example:

```text
**一、技术服务内容、方式和要求：** → ## 一、技术服务内容、方式和要求
**十一、签字盖章：** → ## 十一、签字盖章
```

HTML deliverable should be the same professional editable HTML used for PDF:

```bash
cp "$WORK/contract.html" "$OUTPUT_DIR/contract.html"
```

### 7. Reverse Markdown → DOCX verification

If the active docx environment provides a native `docx_engine.py`, use it. If not, use the compatibility wrapper stored in this case as a local `render/audit` driver. The wrapper delegates generation to Pandoc and audits the OOXML package; it does **not** use `python-docx` to generate.

```bash
cp "$SKILL/templates/reformat-default/cases/pku-contract-roundtrip/docx_engine.py" "$WORK/docx_engine.py"
python3 "$WORK/docx_engine.py" render \
  --input "$OUTPUT_DIR/contract.md" \
  --output "$OUTPUT_DIR/contract_roundtrip.docx"

python3 "$WORK/docx_engine.py" audit \
  --input "$OUTPUT_DIR/contract_roundtrip.docx" | tee "$OUTPUT_DIR/roundtrip_audit.txt"
```

Also run docx validation when available:

```bash
export PATH="$HOME/.dotnet:$PATH"
dotnet run --project "$DOCX_SKILL/scripts/dotnet/MiniMaxAIDocx.Cli" -- \
  validate --input "$OUTPUT_DIR/contract_roundtrip.docx" --business \
  | tee "$OUTPUT_DIR/roundtrip_validate.txt"

dotnet run --project "$DOCX_SKILL/scripts/dotnet/MiniMaxAIDocx.Cli" -- \
  analyze --input "$OUTPUT_DIR/contract_roundtrip.docx" --json \
  > "$OUTPUT_DIR/roundtrip_analyze.json"
```

Pass conditions:

- Audit says `AUDIT PASS` or native equivalent.
- Business validation passes; warnings about orphaned comments/relationships may be noted if they do not affect the main document.
- Analysis shows Heading styles for normalized headings and expected table count.

### 8. Fidelity-loss report

Always include a loss report. Suggested table:

| Category | Expected loss / change | Severity |
|---|---|---|
| Legacy `.doc` normalization | LibreOffice may reinterpret page breaks, spacing, and old binary Word features. | Medium |
| Direct Word formatting | Markdown cannot preserve exact font size, line spacing, underline offsets, and manual centering. | Medium |
| Complex merged tables | Markdown grid tables cannot fully express rowspan/colspan semantics; round-trip DOCX may simplify the table graph. | High |
| Pagination | Markdown does not preserve exact page breaks; PDF is reflowed to A4 HTML. | Medium |
| Headers/footers | Markdown usually loses them; PDF HTML must preserve/reconstruct them; reverse DOCX may not recover them unless explicitly generated. | Medium/High for legal |
| Legal content | Clause text, party labels, and key terms should be preserved exactly. | Critical gate |
| Images/OLE | Must inventory; absent in the PKU contract exemplar. | Depends |
| Hyperlinks | Preserve only real hyperlink relationships; report if source has none. | Low/Medium |

## Common pitfalls and recovery

| Pitfall | Symptom | Recovery |
|---|---|---|
| Shipping a raw Pandoc/LibreOffice PDF | Cover text is scattered, tables look amateur, signature page overflows. | Rebuild semantic contract HTML from clauses and signature fields; render through `make.sh render`. |
| Using screenshots for PDF | `pdfimages` shows page-sized images; text not searchable. | Use Playwright HTML→PDF only; verify with `pdftotext`. |
| Relying on strings only | Text exists but visual layout is unacceptable. | Rasterize page 1 and signature page with `pdftoppm`; inspect layout. |
| CSS counters for legal numbering | Copy/paste/search loses numbering; nested list levels break. | Use literal numbering or real `<ol><li>` elements. |
| Wide signature table overflow | Right columns clip or shrink unreadably. | Use fixed `colgroup`, smaller font, controlled line-height, and split overly wide structures if needed. |
| Missing or colliding headers/footers | Formal contract pages have no running identity/page footer, or footer overlaps signature table. | Reserve header/footer space in `.page`, keep cover clean, add `.running-header`/`.running-footer`, then raster-check body and signature pages. |
| CJK font mismatch | Chinese glyphs look like Japanese forms or tofu. | Use Songti/PingFang/Noto CJK font stack; verify visually and with `pdftotext`. |
| Missing dotnet after setup | `env_check.sh` fails even after installing .NET. | `export PATH="$HOME/.dotnet:$PATH"`; rerun env check. |
| Claiming hyperlink preservation when none exist | User expects clickable links, but source had only underlined text. | Inspect OOXML hyperlink relationships; report “source has no real hyperlinks.” |

## Final reusable workflow checklist

1. Normalize `.doc` → `.docx` with `soffice`.
2. Inventory paragraphs, tables, hyperlinks, and risky legal-layout features.
3. Generate Markdown with Pandoc grid/pipe tables; normalize headings.
4. Generate a native DOCX→PDF baseline and prefer it when it is faithful/professional.
5. Only if needed, generate professional editable HTML, using the case `source.html` as a legal-contract template.
6. Add/preserve headers and footers on non-cover pages, reserving print-space so they do not collide with body content.
7. Render redesigned PDF via `bash pdf/scripts/make.sh render --format A4` only when using the HTML route.
8. Verify `pdfinfo`, `pdftotext`, `pdfimages`, and visual previews of cover/body/signature pages, including headers/footers.
9. Reverse Markdown → DOCX through `docx_engine.py render`; audit and validate.
10. Deliver PDF, MD, HTML, round-trip DOCX, and a fidelity-loss report that states whether PDF came from direct render or HTML recomposition.
11. If the user says the PDF is not professional, do not defend raw conversion. Reconstruct the contract layout semantically and re-render.
