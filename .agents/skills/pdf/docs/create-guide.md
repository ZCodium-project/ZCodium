# CREATE — Generate a New PDF

> **Prerequisites.** Read [`html-pdf-spec.md`](html-pdf-spec.md) for the
> mechanical contract (page geometry, page-break rules, Chart.js settle, CJK
> cascade). Read [`design-guide.md`](design-guide.md) for the aesthetic
> contract (palette mood, typography, anti-patterns). This file is the
> end-to-end recipe that ties them together.

The CREATE pipeline has one shape:

```
HTML file (templates/<slug>/skeleton.html or hand-written)
  └─► render_html.cjs (Playwright Chromium)
       └─► report.pdf
```

There is no token system, no ReportLab, no LaTeX. If a primitive cannot be
expressed in HTML+CSS+JS, it does not belong in CREATE.

---

## 1. The 4 steps

```bash
# Step 1 — verify deps once per machine
bash scripts/make.sh check

# Step 2 — pick a starting point (DO NOT skip this scan)
cat templates/INDEX.md
cat templates/<chosen-slug>/README.md      # 7-section recipe

# Step 3 — copy the skeleton, fill the placeholders, re-skin to your topic
cp templates/<chosen-slug>/skeleton.html /tmp/work/page.html
$EDITOR /tmp/work/page.html

# Step 4 — render & verify
bash scripts/make.sh render --in /tmp/work/page.html --out /tmp/work/out.pdf --wait 15000
pdfinfo /tmp/work/out.pdf | grep Pages
pdftotext -layout /tmp/work/out.pdf - | head -40
open /tmp/work/out.pdf       # eyeball it
```

The `--wait 15000` flag is critical when the page contains Chart.js or any
late-loading JS. Static prose can use the default `--wait 800`. See
[html-pdf-spec.md §6](html-pdf-spec.md#6-charts-chartjs).

---

## 2. Picking a template

[`templates/INDEX.md`](../templates/INDEX.md) lists every skeleton with intent
keywords. Match by user intent first, then by document shape:

| Intent | Template |
|---|---|
| Restaurant menu, bilingual omakase | `bilingual-menu-premium` |
| Brand guide / style guide / 2-page identity | `brand-guide-2page` |
| Data report / benchmark / 数据可视化 / 评测 | `data-viz-report` |
| Article digest / blog anthology / newsletter | `multi-article-aggregator` |
| Multi-country research / regulatory survey | `multilang-research-report` (for AI voice cloning / legal-regulatory surveys, read `docs/ai-voice-cloning-regulatory-report-case.md`) |
| Plain markdown report (REFORMAT path) | `reformat-default` |

If nothing fits, **adapt the closest** rather than starting from scratch — the
skeletons encode page-break math and CJK cascades that take real time to get
right.

If the user's content is genuinely unique (not just "reskin needed"),
hand-author the HTML following [`html-pdf-spec.md`](html-pdf-spec.md) and
copy individual primitives (KPI cards, chart cards, pill table) from
`templates/data-viz-report/skeleton.html`.

---

## 2. JSON-driven CREATE workflow (data reports)

Use this when the PDF is a data/report deliverable and the content should be
separated from layout. The contract is still **HTML → Playwright → PDF**;
JSON is only an intermediate content manifest consumed by your build script.

### 2.1 Minimal `content.json` shape

Always write JSON with `json.dumps(..., ensure_ascii=False, indent=2)` — never
hand-concatenate strings.

```json
{
  "meta": {
    "title": "2024 Annual Report Digest",
    "subtitle": "Financial highlights and segment revenue",
    "author": "Mavis",
    "date": "2026-04-26",
    "locale": "zh-CN",
    "page_format": "A4",
    "style": "print-academic"
  },
  "theme": {
    "accent": "#8A1E1E",
    "ink": "#1F2A25",
    "muted": "#66706A",
    "paper": "#FBFAF7"
  },
  "kpis": [
    {"label": "营业收入", "value": "2.94万亿", "delta": "同比 -2.5%", "tone": "neutral"},
    {"label": "归母净利润", "value": "1,646.84亿", "delta": "同比 +2.0%", "tone": "good"}
  ],
  "sections": [
    {
      "id": "financials",
      "title": "主要财务指标",
      "lead": "单位除特别注明外为人民币百万元。",
      "tables": [
        {
          "caption": "近五年主要财务指标",
          "columns": ["项目", "2024", "2023", "2022"],
          "rows": [
            ["营业收入", "2,937,981", "3,012,812", "3,240,951"],
            ["净利润", "183,755", "180,563", "163,493"]
          ],
          "source": "年报第5页"
        }
      ],
      "charts": [
        {"id": "trend", "title": "财务趋势", "image": "trend.png", "alt": "五年收入与利润趋势"}
      ],
      "takeaways": ["收入同比回落，但利润端保持韧性。"]
    }
  ],
  "footnotes": [
    "本摘要不替代经审计年度报告全文。"
  ]
}
```

Recommended fields:

| Field | Required | Meaning |
|---|---:|---|
| `meta.title` | yes | Cover/title-bar title; must match user language. |
| `meta.page_format` | yes | Usually `A4`; renderer must also pass `--format A4`. |
| `theme.*` | no | Palette tokens copied into CSS variables. |
| `kpis[]` | no | Small KPI cards; values are strings so units are explicit. |
| `sections[].tables[]` | no | Dense source tables; keep `source` for auditability. |
| `sections[].charts[]` | no | Static image paths or data-URI strings; runtime chart libraries are optional but static PNGs are preferred for strict deliverables. |
| `sections[].takeaways[]` | no | Short bullets; do not let prose crowd out tables. |
| `footnotes[]` | no | Method, caveats, and source notes. |

### 2.2 Build script skeleton

This script turns `content.json` into `page.html`. Keep HTML escaping explicit;
never paste JSON directly into JavaScript unless you serialized it yourself.

```python
import html, json
from pathlib import Path

work = Path("/tmp/pdf-create")
payload = json.loads((work / "content.json").read_text(encoding="utf-8"))

def esc(x):
    return html.escape(str(x), quote=True)

def render_table(table):
    head = "".join(f"<th>{esc(c)}</th>" for c in table["columns"])
    rows = []
    for row in table["rows"]:
        rows.append("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in row) + "</tr>")
    source = f"<div class='source'>{esc(table.get('source',''))}</div>" if table.get("source") else ""
    return f"<figure class='table-card'><figcaption>{esc(table['caption'])}</figcaption><table><thead><tr>{head}</tr></thead><tbody>{''.join(rows)}</tbody></table>{source}</figure>"

sections = []
for sec in payload["sections"]:
    body = [f"<section class='page' id='{esc(sec['id'])}'>", f"<h2>{esc(sec['title'])}</h2>"]
    if sec.get("lead"):
        body.append(f"<p class='lead'>{esc(sec['lead'])}</p>")
    for table in sec.get("tables", []):
        body.append(render_table(table))
    for chart in sec.get("charts", []):
        body.append(f"<figure class='chart'><img src='{esc(chart['image'])}' alt='{esc(chart.get('alt',''))}'><figcaption>{esc(chart['title'])}</figcaption></figure>")
    for item in sec.get("takeaways", []):
        body.append(f"<p class='takeaway'>{esc(item)}</p>")
    body.append("</section>")
    sections.append("\n".join(body))

html_doc = f"""<!doctype html>
<meta charset="utf-8">
<title>{esc(payload['meta']['title'])}</title>
<style>
@page {{ size: A4 portrait; margin: 14mm 12mm; }}
* {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
body {{ font-family: -apple-system, 'PingFang SC', sans-serif; color: {payload.get('theme',{}).get('ink','#1F2A25')}; }}
.page {{ page-break-after: always; }}
.page:last-child {{ page-break-after: auto; }}
table {{ width: 100%; border-collapse: collapse; font-size: 8.8pt; }}
th, td {{ border: .5pt solid #d8d0c4; padding: 5px 7px; }}
th {{ background: #efe7da; }}
.chart img {{ max-width: 100%; height: auto; }}
</style>
<body>
{''.join(sections)}
</body>"""
(work / "page.html").write_text(html_doc, encoding="utf-8")
```

### 2.3 End-to-end commands

```bash
SKILL=/path/to/pdf
WORK=/tmp/pdf-create
mkdir -p "$WORK"

bash "$SKILL/scripts/make.sh" check
python3 "$WORK/build_content.py"              # writes content.json and any chart PNGs
python3 "$WORK/build_html.py"                 # content.json -> page.html
bash "$SKILL/scripts/make.sh" render \
  --in "$WORK/page.html" \
  --out "$WORK/report.pdf" \
  --format A4 \
  --wait 15000

pdfinfo "$WORK/report.pdf" | grep -E "Pages|Page size"
pdfimages -list "$WORK/report.pdf" | tail -n +3 | wc -l
pdftotext -layout "$WORK/report.pdf" - | head -40
```

Expected evidence:

- `Page size` is A4.
- `Pages` matches the requested cap.
- image count is at least the number of embedded chart PNGs/logos.
- `pdftotext` shows readable body text and key figures.
- Source HTML and `content.json` have no placeholder tokens.

---

## 3. The component primitive cookbook

Every primitive below ships in `templates/data-viz-report/skeleton.html`
(self-contained). Copy the markup + CSS for the ones you need.

### Cover (full-bleed gradient)

```html
<section class="cover">
  <span class="cover-tag">DEEP RESEARCH · 2026</span>
  <h1>Report title</h1>
  <p class="subtitle">One-sentence positioning, ≤ 3 lines.</p>

  <div class="cover-meta">
    <div class="meta-stats">
      <div class="meta-stat"><div class="num">14</div><div class="lbl">CHIPS</div></div>
      ...
    </div>
    <div class="cover-info">RESEARCH REPORT<br/>v1.0 · 2026/04</div>
  </div>
</section>
```

### Section header (eyebrow + H2 + accent rule)

```html
<span class="section-num">PART 01 · 硬件分析</span>
<h2 class="section">Apple M-series Hardware Analysis</h2>
<div class="section-line"></div>
```

### KPI 4-grid (4 color variants)

```html
<div class="kpis">
  <div class="kpi blue"><div class="label">Q3</div><div class="value">$4.2M</div><div class="desc">vs $3.1M Q2</div></div>
  <div class="kpi green">…</div>
  <div class="kpi orange">…</div>
  <div class="kpi purple">…</div>
</div>
```

### Chart card (always wrap with `.avoid-break`)

```html
<div class="chart-card avoid-break">
  <div class="chart-title">Figure 1.1 · Memory bandwidth & TOPS evolution</div>
  <div class="chart-sub">Max series M1 → M4 representative comparison</div>
  <div class="chart-wrap"><canvas id="evolution"></canvas></div>
</div>
```

### Reference table with status pills

```html
<table class="data">
  <thead><tr><th>Chip</th><th>Memory</th><th>Verdict</th></tr></thead>
  <tbody>
    <tr><td class="bold">M3 Pro</td><td>36 GB</td><td><span class="pill pill-ok">✓ Feasible</span></td></tr>
    <tr><td class="bold">M4 Max</td><td>128 GB</td><td><span class="pill pill-best">★★ Excellent</span></td></tr>
  </tbody>
</table>
```

5 pill semantics are fixed: `bad / warn / ok / good / best`. Do not invent
new colors.

### Versus comparison

```html
<div class="versus">
  <div class="vs-card apple">
    <span class="tag">APPLE M4 MAX</span>
    <h4>Unified memory · End-of-line</h4>
    <ul><li>...</li></ul>
  </div>
  <div class="vs-divider">VS</div>
  <div class="vs-card nvidia">
    <span class="tag">NVIDIA RTX 5090</span>
    <h4>CUDA empire · Compute beast</h4>
    <ul><li>...</li></ul>
  </div>
</div>
```

### Recommend triple (entry / recommended / premium)

```html
<div class="recommend-grid">
  <div class="rec-card entry"><span class="level">Entry</span>...</div>
  <div class="rec-card recommend"><span class="level">★ Recommended</span>...</div>
  <div class="rec-card premium"><span class="level">Premium</span>...</div>
</div>
```

### Insight callout (yellow, one paragraph)

```html
<div class="insight">
  <span class="label">⚡ Key insight</span>
  Body text — one paragraph, ideally a single takeaway. Don't stack 3 of these on a page.
</div>
```

### Dark conclusion block

```html
<div class="conclusion">
  <h3><span class="num">01.</span>Title of the conclusion</h3>
  <p style="opacity: 0.92;">Body text on dark background. Keep it short.</p>
</div>
```

### Chart.js initialization (8 baseline types)

See `templates/data-viz-report/skeleton.html` `<script>` at the bottom of the
file. Copy the chart you need (dual-axis, horizontal bar, grouped bar,
scatter, stacked, log-axis, radar, dual-axis 2-bar) and edit the `labels` /
`data` arrays — keep the `options` block intact.

**Always** set `Chart.defaults.animation = false` once at the top.

---

## 4. Cover archetype palette

If your topic doesn't fit the navy + Apple-blue feel of `data-viz-report`,
re-skin the cover gradient + accent. Examples (also in
[design-guide.md](design-guide.md)):

| Subject | Cover gradient | Accent |
|---|---|---|
| Healthcare / pharma | teal → ivory | `#0a7488` |
| Finance / market data | charcoal → emerald | `#0c8a5d` |
| Energy / industrial | graphite → ember | `#d4621a` |
| AI research lab | violet → midnight | `#7c3aed` |
| Sustainability / ESG | forest → khaki | `#3f7d3f` |

Two reports on different subjects must read as two different publications.
Reusing the same blue defeats the whole point of using HTML.

---

## 5. Hand-authoring an HTML from zero

When no template fits, follow this order:

1. Start from a minimal `@page` + `*` reset:
   ```css
   @page { size: A4 portrait; margin: 14mm 12mm; }
   * { box-sizing: border-box;
       -webkit-print-color-adjust: exact; print-color-adjust: exact; }
   ```
2. Define `:root` CSS variables for palette (`--accent`, `--ink`, `--mute`,
   `--rule`, `--hairline`).
3. Build the cover, then the visible clickable TOC/index. Use real internal
   anchors (`<a href="#section-id">`) and give every target section a stable,
   unique `id`; see [html-pdf-spec.md §3.4](html-pdf-spec.md#34-clickable-toc--index-links).
4. Build one body section, render, eyeball, iterate.
5. Add primitives (KPI cards, chart card, pill table) by copying from
   `data-viz-report/skeleton.html`.
6. Run the **quality gate** in
   [html-pdf-spec.md §11](html-pdf-spec.md#11-quality-gate-agent-self-check-before-declaring-done)
   before declaring "done".

---

## 6. Verification checklist

Run before committing the source HTML or reporting "PDF ready":

- [ ] `bash scripts/make.sh render --in page.html --out out.pdf --wait 15000` exits 0
- [ ] `pdfinfo out.pdf | grep Pages` matches expected page count (within ±1)
- [ ] `pdftotext -layout out.pdf - | head -40` shows readable body text
- [ ] PDF has a visible TOC/index for every multi-page output; TOC rows are
      clickable internal links or the PDF has equivalent outline/bookmark
      navigation for the same section targets
- [ ] Spot-click at least 3 TOC/index entries (or all entries when fewer than 3)
      and confirm they jump to the intended pages; for assembled PDFs, also
      inspect link annotations/outlines with `pdfinfo` or `pypdf`
- [ ] `open out.pdf` — eyeball: charts drew, no blank canvases, fonts correct,
      no `⊃2;` artifacts
- [ ] Last page is ≥ 1/3 full (not an orphan)
- [ ] Source HTML has no remaining `<!-- PLACEHOLDER -->` tokens
- [ ] Accent re-skinned away from default blue (unless subject is consumer
      hardware)
- [ ] At most 3 data colors + 1 accent in any single page

---

## 7. Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Blank chart canvases | Chromium snapshotted before Chart.js painted | Add `--wait 15000`; set `Chart.defaults.animation = false` |
| Body text in default sans | Webfont didn't load before snapshot | Use system stack from spec §4, or `@font-face` from local file |
| Color desaturated in print | Missing `print-color-adjust: exact` | Apply to universal selector `*`, not `body` |
| Charts split across pages | Missing `.avoid-break` wrapper | Wrap each `.chart-card` |
| Tables eat too much space | Full-width CJK punctuation | Use half-width `()`、`:`、`/` inside cells |
| `3nm⊃2;` artifacts | HTML entity typo for `²` | Paste real unicode `²` `⁺` `™` etc |
| Output PDF is 1 KB | Source HTML had a JS error (404 on Chart.js, etc) | Open the source in a browser, check Console |
| Cover takes 2 pages | Cover height > 268 mm | Reduce padding or content; do not change `@page` margin |

For deeper debugging see [`troubleshooting.md`](troubleshooting.md).
