# Case: EML research report → Chinese layout-preserving PDF

Use this reference after `docs/pitfalls-index.md` §P5 matches a prompt like
"Translate this email report into Chinese and save as PDF; keep content and
charts/icons unchanged." It records a Goldman Sachs macro research email run as
a reusable production case. The prompt below is optimized from the successful
run: it separates glossary, hard preservation rules, output schema, and QA flags
so the agent can reuse it without ad-hoc prompt writing.

## What already existed

Before this case, pdf already had:

- `docs/pitfalls-index.md` §P5 — canonical EML/PDF translation-preserve-layout trace.
- `templates/translate-preserve-layout/skeleton.html` — generic translated report skeleton.
- `templates/translate-preserve-layout/README.md` — m09 email translation pitfalls.

This case adds a concrete EML trace: MIME asset extraction, cid replacement,
Doctype-safe segment extraction, an optimized reusable LLM prompt, in-place HTML
mutation, A4 render, image/link verification, and a filled HTML exemplar.
Regenerate PDFs from the HTML when evaluating; do not store the rendered PDF in
the case.

## Files in this case

- `templates/translate-preserve-layout/cases/goldman-china-two-sessions-cn.html`
  — filled Chinese HTML from the successful run. It preserves the source email's
  table layout, Goldman Sachs logo, exhibit images, and hyperlinks.

## Trigger and boundary

Use this case when:

- Input is `.eml` with a formal research/newsletter report in `text/html`.
- User asks to translate the report, preserve layout/images/icons, and output PDF.
- Inline assets are referenced via `cid:` and charts are already raster/SVG images.
- Target language is Chinese or another CJK language where line-height/font
  cascade must be controlled.

Do not use this case when:

- The email only contains a PDF/DOCX attachment to translate (route to the PDF or
  DOCX read/translate path first).
- The user asks for a summary instead of a faithful translated deliverable.
- The source is scanned/image-only content with no text layer; use vision/OCR per
  page before translation.

## Successful trace: Goldman Sachs "Two Sessions" email

User request:

```text
将这个email里的报告翻译成中文并保存为pdf，内容和图标都要保持不变。
```

Source signals:

- Subject: `China: Local "Two Sessions" point to a lower national growth target this year than last year`.
- MIME parts: one `text/html` part (~106 KB), five inline PNG parts, plus one
  hidden remote tracking pixel.
- Visible report assets after rendering: Goldman Sachs logo + 4 exhibit charts.
  `pdfimages` lists 6 image rows because the transparent logo also creates an
  `smask` row.
- Source HTML rendered cleanly to A4 via Chromium: 7 pages, A4, image rows present.
- Final Chinese output: 6 pages, A4, ~907 KB, 25 URI link annotations.

## Step-by-step workflow

### 1. Preflight and source parsing

```bash
bash <SKILL>/scripts/make.sh check 2><TMP>/check.log
```

Parse the EML with Python's `email` package and preserve every inline image as a
local file. Replace `cid:<content-id>` references with the exact local filename;
do not re-encode or run Pillow on the images.

```python
from email import policy
from email.parser import BytesParser
from pathlib import Path
import json

src = Path("<INPUT.eml>")
out = Path("<TMP>/email")
out.mkdir(parents=True, exist_ok=True)
msg = BytesParser(policy=policy.default).parsebytes(src.read_bytes())
html = None
assets = []
for part in msg.walk():
    if part.is_multipart():
        continue
    payload = part.get_payload(decode=True) or b""
    ctype = part.get_content_type()
    if ctype == "text/html":
        html = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    elif ctype.startswith("image/"):
        cid = (part.get("content-id") or "").strip("<>")
        fn = part.get_filename() or f"{cid}.{ctype.split('/')[-1]}"
        (out / fn).write_bytes(payload)
        assets.append({"cid": cid, "filename": fn, "ctype": ctype, "bytes": len(payload)})
if html is None:
    raise SystemExit("no text/html part found")
for a in assets:
    html = html.replace(f"cid:{a['cid']}", a["filename"]).replace(f"cid%3A{a['cid']}", a["filename"])
(out / "source.html").write_text(html, encoding="utf-8")
(out / "assets.json").write_text(json.dumps(assets, ensure_ascii=False, indent=2), encoding="utf-8")
```

Baseline-render source HTML to establish page/image behavior:

```bash
bash <SKILL>/scripts/make.sh render \
  --in <TMP>/email/source.html \
  --out <TMP>/email/source_render.pdf \
  --format A4 --wait 15000 \
  2><TMP>/render-source.log
pdfinfo <TMP>/email/source_render.pdf | grep -E "Pages|Page size"
pdfimages -list <TMP>/email/source_render.pdf | wc -l
```

### 2. Extract stable translation units

Extract visible text nodes from the HTML. Skip `script/style/noscript/head`,
conditional comments, build artifacts, bare bullets and punctuation, and hidden
tracking boilerplate. Keep anchor tags in place; translate only their text node
content so the `href` target survives unchanged.

Important: BeautifulSoup can expose the doctype as a text-like node. Exclude
`bs4.element.Doctype`, otherwise the LLM output IDs shift by one and every
translation is applied to the wrong source node.

```python
from bs4 import BeautifulSoup, Doctype
from pathlib import Path
import json

soup = BeautifulSoup(Path("<TMP>/email/source.html").read_text(encoding="utf-8"), "html.parser")
skip_exact = {"|", "●", ":", ").", ",", "content", "Company Takeover Disclosure", "END OF DOCUMENT"}
segments = []
for s in soup.find_all(string=True):
    if isinstance(s, Doctype):
        continue
    if not s.parent or s.parent.name in ("script", "style", "noscript", "head"):
        continue
    txt = " ".join(str(s).split())
    if not txt or txt in skip_exact:
        continue
    if txt.startswith("[if") or "jcr_root" in txt or txt.startswith("// END") or txt.startswith("TODO:"):
        continue
    segments.append({"id": len(segments), "text": txt})
Path("<TMP>/email/translate_units.json").write_text(
    json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8"
)
```

### 3. Optimized reusable translation prompt

Call an LLM for translation; do not hand-translate long financial/policy reports.
Use this optimized prompt instead of the rough one-off prompt from the original
run. It is designed to prevent terminology drift, ID mismatch, accidental link
translation, and prose-only preservation failures.

#### System prompt

```text
你是金融/宏观政策研究报告的专业英译中译者，任务是把 HTML/EML 中抽取出的可见文本节点翻译成简体中文，并让译文可直接放回原 HTML。

硬性规则：
1. 只输出合法 JSON，不要 Markdown、代码块、解释、前后缀文本。
2. 输入是 JSON 数组，每项有 id 和 text；输出必须是同长度 JSON 数组，每项只包含 {"id": 原id, "zh": "译文"}，顺序与输入一致，不得合并、拆分、遗漏或新增项目。
3. 只翻译自然语言；保留所有数字、年份、日期、时间、货币符号、百分比、区间、括号中的缩写、邮箱、电话、URL、股票/基金代码、HTML实体和占位符。
4. 人名保留英文；无官方中文译名的机构名保留英文。Goldman Sachs、Wind 保留英文。
5. 链接锚文本可翻译，但不得改写或臆造 URL；如果 text 本身是邮箱/URL/电话，只原样返回。
6. 不要解释图表，不要补充原文没有的信息，不要重组章节，不要把短锚文本扩写成长句。
7. 中文使用专业卖方研究语气：准确、克制、书面；避免口语化和宣传腔。
8. 标点用中文正文标点，但保留数值表达中的半角符号（如 4.5-5.0%、RMB4.6tn、1pp）。

固定术语表（必须一致）：
- Two Sessions = 两会
- local Two Sessions = 地方两会
- national Two Sessions = 全国两会
- GDP growth target = GDP增长目标
- real GDP growth = 实际GDP增长
- CPI inflation target = CPI通胀目标
- Central Economic Work Conference (CEWC) = 中央经济工作会议（CEWC）
- Government Work Report = 政府工作报告
- local government special bond (LGSB) = 地方政府专项债（LGSB）
- central government special bond (CGSB) = 中央政府特别债（CGSB）
- Augmented Fiscal Deficit (AFD) = 广义财政赤字（AFD）
- 15th Five-Year Plan (FYP) = “十五五”规划
- 4th Plenum = 四中全会
- Pledged Supplementary Lending (PSL) = 抵押补充贷款（PSL）
- fiscal deficit = 财政赤字
- effective on-budget fiscal deficit = 有效预算内财政赤字
- surveyed unemployment rate = 调查失业率
- new urban jobs = 城镇新增就业

质量自检后再输出：
- id 是否逐一对应；
- 术语是否完全一致；
- 数字/百分比/货币/缩写是否未被改动；
- 是否没有 Markdown 代码围栏。
```

#### User prompt template

```text
将下面 JSON 数组逐项翻译为简体中文。严格遵守 system prompt 的 JSON 输出格式。

领域提示：这是一封卖方宏观经济研究邮件，主题为中国地方/全国“两会”、GDP增长目标、财政预算、通胀、就业和“十五五”规划。译文将被放回原 HTML 并渲染成 PDF，所以每个 id 的文本必须保持独立，不要跨 id 合并句子。

输入 JSON：
<PASTE translate_units.json HERE>
```

#### Post-LLM validation

```python
import json
from pathlib import Path
src = json.loads(Path("<TMP>/email/translate_units.json").read_text(encoding="utf-8"))
out = json.loads(Path("<TMP>/email/translations.json").read_text(encoding="utf-8"))
assert len(src) == len(out)
assert [x["id"] for x in src] == [x["id"] for x in out]
for s, t in zip(src, out):
    for token in ("%", "RMB", "GDP", "AFD", "LGSB", "CGSB", "PSL"):
        if token in s["text"]:
            assert token in t["zh"], (token, s, t)
```

If the model returns fenced JSON, strip only the fence and re-parse. If IDs or
counts do not match, rerun translation with the validation error; do not guess a
mapping manually.

### 4. Mutate original HTML in place

Apply translations back to the original text nodes by ID. Preserve leading and
trailing whitespace so inline links remain readable. Then append a CJK-safe print
style block rather than rebuilding the whole report.

Append this style for the Goldman-style email layout:

```css
@page { size: A4 portrait; margin: 12mm 10mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body, table, td, p, span, font, a, b {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
               "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif !important;
}
p, td.copybody, .copybody, font { line-height: 1.6 !important; }
img { max-width: 100% !important; height: auto !important; }
img[src^="https://publishing.gs.com/CI0"] { display: none !important; width: 1px !important; height: 1px !important; }
figure, img { page-break-inside: avoid; }
a { color: #446EA6; }
@media screen {
  html { background:#d0d0d0; }
  body { margin:0; padding:20px 0; }
  #templateContainer { background:#fff; box-shadow:0 4px 24px rgba(0,0,0,.18); }
}
```

Do **not** set `page-break-inside: avoid` on every `table` or `tr` in table-heavy
email HTML. That caused unnecessary blank pages in this run. Protect images and
figures instead.

### 5. Render

```bash
bash <SKILL>/scripts/make.sh render \
  --in <TMP>/email/translated.html \
  --out <OUTPUT_PATH> \
  --format A4 --wait 15000 \
  2><TMP>/render-translated.log
```

The final case HTML is stored at:

```text
<SKILL>/templates/translate-preserve-layout/cases/goldman-china-two-sessions-cn.html
```

### 6. Verification gates

```bash
pdfinfo <OUTPUT_PATH> | grep -E "Pages|Page size"
pdfimages -list <OUTPUT_PATH>
pdftotext -layout <OUTPUT_PATH> - | python3 -c "import sys; print(sys.stdin.read()[:2500])"
python3 - <<'PY'
from pypdf import PdfReader
r = PdfReader("<OUTPUT_PATH>")
links = 0
for page in r.pages:
    for a in page.get('/Annots') or []:
        obj = a.get_object(); aa = obj.get('/A')
        if aa and aa.get('/URI'):
            links += 1
print('links', links)
PY
```

Expected Goldman evidence:

```text
Pages:           6
Page size:       595.92 x 842.88 pts (A4)
PDF size:        ~907 KB
pdfimages rows:  8 total output lines; visible semantic images = logo + 4 exhibits
links:           25 URI annotations
Text extract:    readable Chinese; includes 两会, GDP增长目标, 地方政府专项债, 广义财政赤字, 抵押补充贷款
```

Image count notes:

- `pdfimages -list | wc -l` includes the two header lines.
- Transparent PNG logos may create both `image` and `smask` rows.
- Hidden 1×1 tracking pixels should not be counted as semantic report assets;
  hiding them is acceptable if the visible report is unchanged.

### 7. Final polish checks

- Terminology: `Two Sessions → 两会`, `GDP growth target → GDP增长目标`,
  `AFD → 广义财政赤字（AFD）`, `PSL → 抵押补充贷款（PSL）`.
- Dates and punctuation: convert obvious English dates in Chinese prose where
  useful (`3 February` → `2月3日`, `4 March` → `3月4日`).
- No tofu boxes or mojibake in `pdftotext` output.
- No huge blank pages introduced by over-broad `break-inside: avoid` rules.

## Reuse pattern for another EML report

1. Parse MIME, save inline assets, replace `cid:` with local filenames.
2. Baseline-render source HTML to measure pages/images.
3. Extract visible text nodes with stable IDs; exclude `Doctype` and artifacts.
4. Translate via LLM with the optimized prompt and frozen domain glossary.
5. Validate JSON length/IDs and preservation tokens before HTML mutation.
6. Mutate original HTML in place; preserve links and images; append CJK print CSS.
7. Render with `--format A4 --wait 15000`.
8. Verify A4, image presence, text readability, terminology, and URI annotations.

## Final response shape

```text
完成，已翻译并生成 PDF：<OUTPUT_PATH>
验证：A4；<N>页；图表/图片已保留；链接注释 <N> 个；中文文本可提取且关键术语已检查。
```
