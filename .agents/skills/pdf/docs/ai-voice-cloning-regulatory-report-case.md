# Case: AI voice cloning regulatory survey → print-academic PDF

Use this reference after `docs/pitfalls-index.md` §P4 matches a prompt like
"做一份关于 AI 声音克隆技术的全球监管深度研究报告，覆盖中国、欧盟、美国、日本、韩国，并以 PDF 交付".
It records a successful five-jurisdiction regulatory research run and the follow-up visual polish pass.
Regenerate PDFs from the editable HTML; do not store rendered PDFs as case artifacts.

## What already existed

Before this case, pdf already had:

- `docs/pitfalls-index.md` §P4 — generic multi-jurisdiction regulatory survey trace.
- `templates/multilang-research-report/skeleton.html` — generic A4 CJK research-report skeleton.
- `templates/multilang-research-report/README.md` — structural invariants and CJK font pitfalls.

This case adds the complete production trace: bilingual research prompts, per-jurisdiction source capture, fact-check file, print-academic HTML source, visual-polish recovery, and verification evidence.

## Files in this case

- `templates/multilang-research-report/cases/ai-voice-cloning-regulatory/source.html`
  — optimized editable HTML from the successful run. It contains a dark academic cover, KPI cards, numbered TOC, CJK-safe font cascade, compressed horizontal comparison table, per-jurisdiction sections, references, and appendix.

## Trigger and boundary

Use this case when:

- The deliverable is a Chinese or CJK **multi-country regulatory research PDF**.
- The requested structure includes per-jurisdiction laws, regulators, cases, self-regulation, comparison table, conclusions, and sources.
- The topic is AI voice cloning / synthetic media / biometrics / AI governance, or another topic requiring official legal sources across 3+ jurisdictions.
- Acceptance criteria require source reliability ratings, fact checking, A4, cover, TOC, page headers/footers, and print-academic styling.

Do not use this case when:

- The user only asks for a short memo or chat answer, with no PDF deliverable.
- The source is an existing PDF/EML to translate or reformat; use the READ/REFORMAT or translation-preserve-layout case first.
- The user asks for a chart-heavy data visualization report rather than legal/regulatory prose; use `data-viz-report` or the Markdown static academic case.

## Original user intent and acceptance criteria

Original request, condensed:

```text
帮我做一份关于AI声音克隆技术的全球监管深度研究报告，覆盖中国、欧盟、美国、日本、韩国五个主要司法管辖区。每个国家/地区需要包括：现行法律法规（列出关键条款原文摘录）、监管机构及其职责、典型执法案例（案件要素、裁判要点、判决结果）、行业自律规范。最后做五国横向比较分析表，并给出结论和趋势展望。报告需要附上所有参考来源及可靠性评级。以PDF形式交付。
```

Acceptance criteria from the run:

1. Cover China, EU, US, Japan, Korea with independent chapters.
2. Each chapter has at least four subsections: current law, regulators, enforcement cases, self-regulation.
3. Include a five-jurisdiction comparison table with at least five substantive dimensions and no page overflow.
4. Use at least 10 real references with institution/URL and reliability rating; no Wikipedia.
5. Chinese query -> Chinese report.
6. Execute four phases: Research -> Report Writing -> Fact-Checking -> Document Formatting.
7. Phase 1 creates `docs/` and `data/` research artifacts.
8. Search bilingually: e.g. `AI声音克隆 监管` plus `AI voice cloning regulation`.
9. Key data include at least three Tier 1-2 official/regulatory sources and at least five domains.
10. Phase 3 creates `fact_check_report.md` and cross-validates statutes/cases.
11. HTML -> PDF via Playwright, not screenshot stitching.
12. A4 pages, cover, clickable/linked TOC when feasible, header title, footer page number.
13. Do not use CSS counters for chapter/table numbering; write visible labels in HTML.
14. Use static HTML/CSS primitives; no runtime chart library unless truly needed.
15. Visual style: print-academic, title + fine rules + dense legal tables.

## End-to-end workflow

### 1. Route and inspect existing case support

1. Load `pdf`.
2. Read `docs/pitfalls-index.md` and match §P4.
3. Read `templates/multilang-research-report/README.md` and `skeleton.html`.
4. Check whether a more specific case exists with grep/glob:

```bash
grep -R "AI声音克隆\|voice cloning\|regulatory survey" <SKILL>/docs <SKILL>/templates -n
```

If this case exists, reuse `source.html` and the workflow below instead of starting from the generic skeleton.

### 2. Create the project workspace

```bash
mkdir -p <WORK>/ai_voice_cloning_reg_report/docs \
         <WORK>/ai_voice_cloning_reg_report/data \
         <WORK>/ai_voice_cloning_reg_report/build
```

Expected Phase 1 artifacts:

- `data/phase1_research_notes.md` — query strategy, official source samples, worker summaries.
- `data/sources.json` — structured source list with `id`, `title`, `institution`, `url`, `rating`.
- `docs/report.md` — report companion or intermediate source notes.

### 3. Research plan and worker prompt shape

Parallelize by jurisdiction. The successful run used five independent research workers plus a synthesis step.
Use this worker prompt shape; do not ask workers to "全面研究" without boundaries.

```text
请进行 Phase 1 子研究：AI voice cloning / synthetic voice / deepfake audio 在 {JURISDICTION} 的监管。要求输出中文：
1) 现行法律法规，摘录关键条款原文（官方语言原文，可附中文解释，注明 Article/条/Section）；
2) 监管机构及职责；
3) 典型执法/司法案例（案件要素、裁判/处理要点、结果），优先监管机构/法院官方来源；如无声音克隆专案，说明并使用 deepfake/生物识别/公开权/voice phishing 相邻案例；
4) 行业自律规范；
5) 每条来源完整 URL、来源机构、可靠性评级 Tier 1/2/3。
不要编造；不确定请标注。
```

Bilingual query seeds:

| Jurisdiction | Query seeds |
|---|---|
| China | `AI声音克隆 监管`, `AI合成声音 侵权`, `深度合成 合成人声 标识`, `China AI voice cloning regulation` |
| EU | `AI voice cloning regulation EU`, `synthetic audio deep fake AI Act`, `GDPR biometric voice data`, `DSA manipulated audio` |
| US | `AI-generated voice robocalls FCC`, `voice cloning TCPA`, `synthetic voice FTC impersonation`, `ELVIS Act voice` |
| Japan | `AI 音声 クローン 規制`, `生成AI 音声 個人情報`, `APPI voice biometric`, `AI voice cloning Japan law` |
| Korea | `AI 음성 클로닝 규제`, `딥페이크 음성 법률`, `AI Basic Act synthetic voice Korea`, `voice phishing AI Korea` |

### 4. Source inspection and parsing

Use Tier 1 official pages for statute text whenever possible. In the successful run, cross-check samples included:

```bash
# China deep synthesis rule
webfetch https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm

# US FCC AI voice ruling
webfetch https://docs.fcc.gov/public/attachments/FCC-24-17A1.txt

# Japan APPI official translation
webfetch https://www.japaneselawtranslation.go.jp/en/laws/view/4241
```

Persist structured sources with JSON, always `ensure_ascii=False`:

```python
from pathlib import Path
import json
sources = [{"id":"US-1", "title":"FCC AI-generated voice Declaratory Ruling", "institution":"FCC", "url":"https://docs.fcc.gov/public/attachments/FCC-24-17A1.txt", "rating":"Tier 1"}]
Path("data/sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
```

Minimum source evidence for this topic:

- China: CAC deep synthesis rule, generative AI interim measures, AI-generated content labeling measures, PIPL, ChinaCourt AI voice case.
- EU: EUR-Lex AI Act, GDPR, DSA, EC AI Office, DPA cases.
- US: FCC 24-17, FCC Kramer/Lingo NALs, eCFR TCPA rules, FTC Act, state publicity/ELVIS Act where needed.
- Japan: Japanese Law Translation APPI, METI AI Guidelines, Agency for Cultural Affairs AI copyright, e-Gov statutes.
- Korea: Korea Law PIPA, AI Basic Act, Sexual Crimes Act, Information Network Act, Unfair Competition Act.

### 5. Transformation and terminology rules

No translation of a source document was required; the task was research synthesis in Chinese. Apply these terminology rules:

| Source term | Chinese output rule |
|---|---|
| voice cloning | 声音克隆；first mention may add `AI voice cloning` |
| synthetic voice / synthetic audio | 合成声音 / 合成音频 |
| deepfake / deep fake | 深度伪造 / 深伪；quote EU `deep fake` as original term where relevant |
| artificial or prerecorded voice | 人工或预录语音；quote FCC original text in English |
| biometric data / voiceprint | 生物识别数据 / 声纹 |
| deployer / provider | 部署者 / 提供者；EU AI Act terms must stay stable |
| Notice of Apparent Liability (NAL) | 拟罚通知；do not call it a final penalty |
| Tier 1/2/3 | Keep English `Tier` labels for source reliability |

Preservation rules:

- Quote legal provisions in original language where requested; add Chinese explanation after.
- Keep article/section numbers exact: `Article 50(2)`, `47 CFR §64.1200`, `제14조의2`.
- Keep monetary penalties and dates exact; if only proposed, say `拟罚`.
- Do not convert a related biometric/deepfake case into a direct voice-cloning precedent. Label it `相邻案例`.

### 6. Report-writing structure

Use this outline:

1. Cover.
2. Executive summary with KPI cards and 3-4 key findings.
3. TOC.
4. Methodology and reliability grading.
5. Horizontal comparison table before or after methodology; if table is wide, shorten cells to phrases.
6. Five jurisdiction sections, each with fixed subsections:
   - Current laws and key excerpts.
   - Regulators and responsibilities.
   - Enforcement/judicial cases.
   - Industry self-regulation.
7. Conclusion and trend outlook.
8. References with URL and rating.
9. Appendix/glossary/version stamp.

For CJK multi-language text, preserve the font cascade:

```css
font-family:
  "PingFang SC",
  "Hiragino Sans",
  "Hiragino Kaku Gothic ProN",
  "Apple SD Gothic Neo",
  "Noto Sans CJK SC",
  "Helvetica Neue", Arial, sans-serif;
```

### 7. Layout and asset preservation strategy

There are no external images to preserve in this case. The final visual system uses pure HTML/CSS assets so the source remains self-contained:

- Dark academic cover with CSS gradient and CSS-only waveform bars.
- KPI cards on executive summary page.
- Numbered TOC rows.
- Fine-rule table styling, muted zebra rows, and CJK-safe wrapping.
- Jurisdiction header tags such as `CN · 强标识规则`.
- Quote blocks for statutory excerpts.
- Case cards with border-top accent.

Do not store the generated PDF in the case. Store only `source.html` and regenerate PDF with `make.sh render`.

### 8. Rendering and compilation

Preflight:

```bash
bash <SKILL>/scripts/make.sh check
```

Render:

```bash
bash <SKILL>/scripts/make.sh render \
  --in <SKILL>/templates/multilang-research-report/cases/ai-voice-cloning-regulatory/source.html \
  --out <TMP>/ai-voice-cloning-regulatory.pdf \
  --format A4 --wait 1000
```

For a fresh generated report under a user workspace, render from that workspace path instead of the case source.
Always pass `--format A4`; do not rely on defaults.

### 9. Verification commands and expected evidence

Run all checks:

```bash
pdfinfo <OUTPUT_PDF>
pdftotext -layout <OUTPUT_PDF> - | head -80
pdfimages -list <OUTPUT_PDF>
```

Expected evidence from the optimized successful run:

- `pdfinfo` shows `Pages: 19`.
- `pdfinfo` shows `Page size: 595.92 x 842.88 pts (A4)`.
- `pdftotext` shows Chinese title, cover text, `EXECUTIVE SUMMARY`, numbered TOC, five jurisdiction headings, reference IDs.
- `pdfimages -list` may show zero rows because this case uses CSS-only visual assets; zero images is acceptable **only because there are no charts/logos**. If you add charts or logos, image count must be at least the number of expected raster/SVG assets.
- Spot-check reference table: at least 10 sources, no Wikipedia, URLs visible, ratings present.
- Spot-check comparison table: at least five dimensions; no row spills horizontally in PDF.

### 10. Fact-checking workflow

Create `docs/fact_check_report.md` before final render. Use this table shape:

```markdown
# Fact Check Report — <TOPIC>

## 核验结论
...

| 核验项 | 核验说明 | 结论 | 主要来源 |
|---|---|---|---|
| FCC AI voice ruling | Confirmed FCC 24-17 says TCPA artificial/prerecorded voice covers AI-generated human voices. | 通过 | https://docs.fcc.gov/public/attachments/FCC-24-17A1.txt |
```

Required checks:

- Statute excerpts exist in cited official source or reliable law database.
- Case outcome is not overstated: `NAL` -> proposed forfeiture; related case -> `相邻案例`.
- Source count and domain count meet the user criteria.
- No Wikipedia.
- Known uncertainty is explicitly listed.

### 11. Common pitfalls and recovery

| Pitfall | Symptom | Recovery |
|---|---|---|
| Generic P4 plan stalls | Workers spend too long on open-ended research | Use the bounded worker prompt above; each worker returns laws/regulators/cases/self-regulation/source list only |
| Table overflow | Comparison table text wraps badly or spills | Convert long sentences to `<br>`-separated short phrases; use fixed layout and 6.8-7.2pt font |
| Bland report look | User says "观感还不是很好" | Add dark cover, KPI cards, numbered TOC, jurisdiction tags, quote/case cards; keep print-academic restraint |
| Korean tofu boxes | Hangul appears missing or wrong | Add `Apple SD Gothic Neo` / Noto CJK KR in font cascade after Japanese fonts |
| Case overclaim | Japan/Korea/EU lack direct voice-cloning enforcement case | Label as `相邻案例` and explain relevance; do not call it a direct precedent |
| FCC enforcement overclaim | Kramer/Lingo are treated as final fines | Say `Notice of Apparent Liability` / `拟罚`; update only if final order exists |
| CSS counters violate criteria | Auto-numbered headings/tables via CSS | Write visible numbers/labels directly in HTML |
| `pdftotext` passes but visual table is ugly | Text extraction looks fine but page is cramped | Inspect `pdftotext -layout` around comparison table and visually open PDF; shorten cells and rerender |

### 12. Final reusable workflow

1. Match §P4 and this case.
2. Create `docs/`, `data/`, `build/` in the user workspace.
3. Launch one bounded research worker per jurisdiction or do equivalent parallel searches.
4. Persist `phase1_research_notes.md` and `sources.json`.
5. Write the Chinese report in the fixed structure; keep legal excerpts and case caveats precise.
6. Generate `fact_check_report.md` with statute/case/source checks.
7. Start from `source.html` or `templates/multilang-research-report/skeleton.html`, then fill content.
8. Use CSS-only academic visual elements unless charts/assets are required.
9. Render with `bash <SKILL>/scripts/make.sh render --format A4`.
10. Verify with `pdfinfo`, `pdftotext`, and `pdfimages`; document evidence in the final response.
11. If the user dislikes the first look, do a visual-polish pass: dark cover, KPI cards, numbered TOC, compressed comparison table, section tags, quote/case cards.
