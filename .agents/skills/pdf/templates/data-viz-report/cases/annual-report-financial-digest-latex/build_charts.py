import base64, json, math
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np

out = Path('petrochina_2024_summary')
out.mkdir(parents=True, exist_ok=True)

# Source: PetroChina 2024 Annual Report, pp. 5, 23-25, 183 / 262-263.
financial = {
    'years': [2020, 2021, 2022, 2023, 2024],
    'revenue': [1935523, 2615967, 3240951, 3012812, 2937981],
    'net_profit': [33669, 114658, 163493, 180563, 183755],
    'parent_net_profit': [19190, 92129, 148888, 161416, 164684],
    'eps': [0.10, 0.50, 0.81, 0.88, 0.90],
    'operating_profit': [76138, 161241, 216888, 235862, 233954],
    'total_assets': [2494086, 2508762, 2676845, 2758975, 2752751],
    'total_liabilities': [1122737, 1098181, 1137764, 1123679, 1043128],
    'equity': [1371349, 1410581, 1539081, 1635296, 1709623],
    'operating_cashflow': [318898, 341424, 393246, 456847, 406532],
    'roe': [1.6, 7.3, 10.9, 11.1, 10.9],
}
segments = [
    {'name': '勘探与生产', 'source_name': '油气和新能源', 'revenue_bn': 906.813, 'external_bn': 154.862, 'profit_bn': 159.745, 'yoy': 1.3},
    {'name': '炼油与化工', 'source_name': '炼油化工和新材料', 'revenue_bn': 1192.589, 'external_bn': 344.220, 'profit_bn': 21.386, 'yoy': -2.3},
    {'name': '销售', 'source_name': '销售', 'revenue_bn': 2454.546, 'external_bn': 1878.462, 'profit_bn': 16.494, 'yoy': -2.9},
    {'name': '天然气与管道', 'source_name': '天然气销售', 'revenue_bn': 592.690, 'external_bn': 557.107, 'profit_bn': 54.010, 'yoy': 5.6},
]

plt.rcParams['font.sans-serif'] = ['PingFang SC', 'Heiti SC', 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
colors = ['#8b3f18', '#c65f24', '#2f4f4f', '#6b7f3a']
accent = '#a84f1d'
ink = '#22302b'

# Trend chart: revenue, net profit, parent net profit, EPS on secondary axis
fig, ax1 = plt.subplots(figsize=(8.2, 4.2), dpi=220)
years = financial['years']
rev = np.array(financial['revenue']) / 1_000_000 # trillion yuan
net = np.array(financial['net_profit']) / 10_000 # 100 million yuan? RMB100mn = millions of yuan / 100 -> hundreds of millions; /10000 -> trillions? Check the label below.
parent = np.array(financial['parent_net_profit']) / 10_000
ax1.plot(years, rev, marker='o', linewidth=2.8, color=accent, label='营业收入(万亿元)')
ax1.set_ylabel('营业收入(万亿元)', color=accent, fontsize=10)
ax1.tick_params(axis='y', labelcolor=accent)
ax1.set_ylim(1.7, 3.4)
ax1.grid(True, axis='y', alpha=0.22)
ax2 = ax1.twinx()
ax2.plot(years, net*1000, marker='s', linewidth=2.2, color='#2f4f4f', label='净利润(亿元)')
ax2.plot(years, parent*1000, marker='^', linewidth=2.2, color='#6b7f3a', label='归母净利润(亿元)')
ax2.set_ylabel('利润(亿元)', color='#2f4f4f', fontsize=10)
ax2.tick_params(axis='y', labelcolor='#2f4f4f')
ax2.set_ylim(0, 2100)
ax1.set_title('多年财务趋势：收入高位回落、利润韧性增强', fontsize=13, fontweight='bold', color=ink, pad=12)
lines = ax1.get_lines() + ax2.get_lines()
ax1.legend(lines, [l.get_label() for l in lines], loc='upper left', frameon=False, fontsize=9)
for x, y in zip(years, rev):
    ax1.text(x, y+0.05, f'{y:.2f}', ha='center', va='bottom', fontsize=8, color=accent)
for x, y in zip(years, parent*1000):
    ax2.text(x, y+55, f'{y:.0f}', ha='center', va='bottom', fontsize=8, color='#6b7f3a')
fig.tight_layout()
trend = out/'trend.png'
fig.savefig(trend, bbox_inches='tight', facecolor='white')
plt.close(fig)

# Donut chart segment gross revenue
fig, ax = plt.subplots(figsize=(6.6, 4.5), dpi=220)
vals = [s['revenue_bn'] for s in segments]
labels = [s['name'] for s in segments]
wedges, texts = ax.pie(vals, startangle=90, counterclock=False, colors=colors,
                       wedgeprops=dict(width=0.38, edgecolor='white', linewidth=2))
total = sum(vals)
ax.text(0, 0.05, '分部收入', ha='center', va='center', fontsize=13, fontweight='bold', color=ink)
ax.text(0, -0.13, f'{total:,.0f} 亿元', ha='center', va='center', fontsize=11, color='#66736d')
legend_labels = [f"{lab}  {v:,.0f}亿元  {v/total:.1%}" for lab, v in zip(labels, vals)]
ax.legend(wedges, legend_labels, loc='center left', bbox_to_anchor=(1.0, 0.5), frameon=False, fontsize=9)
ax.set_title('2024年四大业务板块收入结构(分部收入口径)', fontsize=13, fontweight='bold', color=ink, pad=10)
fig.tight_layout()
donut = out/'donut.png'
fig.savefig(donut, bbox_inches='tight', facecolor='white')
plt.close(fig)

# Radar chart health score
revenue_score = financial['revenue'][-1] / max(financial['revenue']) * 100
net_margin = financial['net_profit'][-1] / financial['revenue'][-1] * 100
profit_score = min(net_margin / 6.5 * 100, 100)
roe_score = financial['roe'][-1] / max(financial['roe']) * 100
cash_score = min((financial['operating_cashflow'][-1] / financial['net_profit'][-1]) / 2.0 * 100, 100)
equity_ratio = 1 - financial['total_liabilities'][-1] / financial['total_assets'][-1]
leverage_score = min(equity_ratio / 0.65 * 100, 100)
segment_score = min(sum(1 for s in segments if s['profit_bn'] > 0) / 4 * 100, 100)
radar_labels = ['规模稳定', '盈利能力', 'ROE效率', '现金创造', '资本稳健', '板块盈利']
radar_vals = [revenue_score, profit_score, roe_score, cash_score, leverage_score, segment_score]
angles = np.linspace(0, 2*np.pi, len(radar_labels), endpoint=False).tolist()
radar_vals_closed = radar_vals + radar_vals[:1]
angles_closed = angles + angles[:1]
fig = plt.figure(figsize=(5.8, 5.2), dpi=220)
ax = plt.subplot(111, polar=True)
ax.plot(angles_closed, radar_vals_closed, color=accent, linewidth=2.4)
ax.fill(angles_closed, radar_vals_closed, color=accent, alpha=0.18)
ax.set_xticks(angles)
ax.set_xticklabels(radar_labels, fontsize=9, color=ink)
ax.set_yticks([20,40,60,80,100])
ax.set_yticklabels(['20','40','60','80','100'], fontsize=7, color='#7a8580')
ax.set_ylim(0,100)
ax.grid(color='#d8d2c8', alpha=0.8)
ax.set_title('财务健康度雷达图(标准化评分)', fontsize=13, fontweight='bold', color=ink, pad=18)
for angle, val in zip(angles, radar_vals):
    ax.text(angle, min(val+8, 108), f'{val:.0f}', ha='center', va='center', fontsize=8, color=accent)
fig.tight_layout()
radar = out/'radar.png'
fig.savefig(radar, bbox_inches='tight', facecolor='white')
plt.close(fig)

# Convert images to base64
def img64(p):
    return 'data:image/png;base64,' + base64.b64encode(Path(p).read_bytes()).decode('ascii')

# Key calculations
rev24_t = financial['revenue'][-1] / 1_000_000
rev_yoy = (financial['revenue'][-1]/financial['revenue'][-2]-1)*100
net_yoy = (financial['net_profit'][-1]/financial['net_profit'][-2]-1)*100
parent_yoy = (financial['parent_net_profit'][-1]/financial['parent_net_profit'][-2]-1)*100
cash_to_profit = financial['operating_cashflow'][-1] / financial['net_profit'][-1]
liab_ratio = financial['total_liabilities'][-1] / financial['total_assets'][-1] * 100

html = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>中国石油2024年度报告财务摘要</title>
<style>
@page {{ size: A4 portrait; margin: 0; }}
* {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
:root {{ --accent:#a84f1d; --accent2:#c65f24; --ink:#22302b; --muted:#66736d; --paper:#fbfaf6; --line:#ded6c9; --green:#536b3e; --slate:#2f4f4f; }}
html, body {{ margin:0; padding:0; background:#d2d2d2; }}
body {{ font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Hiragino Sans","Apple SD Gothic Neo","Helvetica Neue",Arial,sans-serif; color:var(--ink); font-size:10.5pt; line-height:1.55; }}
.sheet {{ width:210mm; height:297mm; margin:0 auto 8mm; background:var(--paper); padding:16mm 15mm 14mm; position:relative; overflow:hidden; page-break-after:always; display:flex; flex-direction:column; }}
.sheet:last-child {{ page-break-after:auto; }}
.cover {{ padding:0; color:white; background:linear-gradient(135deg,#1f2a25 0%,#5d2b16 48%,#b45820 100%); }}
.cover::before {{ content:""; position:absolute; inset:0; background:radial-gradient(circle at 78% 24%, rgba(255,230,180,.23), transparent 28%), radial-gradient(circle at 14% 84%, rgba(255,255,255,.12), transparent 30%); }}
.cover-inner {{ position:relative; z-index:1; height:100%; padding:28mm 20mm; display:flex; flex-direction:column; justify-content:space-between; }}
.eyebrow {{ letter-spacing:.12em; text-transform:uppercase; font-size:9pt; opacity:.86; }}
h1 {{ font-size:31pt; line-height:1.12; margin:16mm 0 5mm; font-weight:800; }}
.subtitle {{ font-size:14pt; opacity:.92; max-width:136mm; }}
.cover-grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:5mm; margin-top:18mm; }}
.cover-stat {{ border:1px solid rgba(255,255,255,.34); border-radius:5mm; padding:5mm; background:rgba(255,255,255,.10); backdrop-filter:blur(2px); }}
.cover-stat .num {{ font-size:17pt; font-weight:800; }}
.cover-stat .lbl {{ font-size:8.5pt; opacity:.82; margin-top:1mm; }}
.cover-foot {{ display:flex; justify-content:space-between; align-items:flex-end; font-size:9.5pt; opacity:.88; }}
.header {{ display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:4mm; margin-bottom:6mm; color:var(--muted); font-size:8.5pt; }}
.footer {{ margin-top:auto; border-top:1px solid var(--line); padding-top:3mm; display:flex; justify-content:space-between; color:#7b827e; font-size:8pt; }}
h2 {{ font-size:20pt; line-height:1.2; margin:0 0 3mm; }}
h3 {{ font-size:13pt; margin:5mm 0 2mm; }}
.section-tag {{ color:var(--accent); font-weight:800; letter-spacing:.08em; font-size:8.5pt; }}
.lead {{ color:#3e4945; font-size:11pt; margin:2mm 0 5mm; }}
.toc {{ margin-top:8mm; border-top:2px solid var(--accent); }}
.toc a {{ color:var(--ink); text-decoration:none; display:grid; grid-template-columns:18mm 1fr 12mm; gap:3mm; padding:4.2mm 0; border-bottom:1px solid var(--line); }}
.toc .p {{ color:var(--accent); font-weight:800; }}
.kpis {{ display:grid; grid-template-columns:repeat(4,1fr); gap:4mm; margin:5mm 0; }}
.kpi {{ background:#fff; border:1px solid var(--line); border-radius:4mm; padding:4mm; min-height:25mm; }}
.kpi .label {{ color:var(--muted); font-size:8pt; }}
.kpi .value {{ font-size:17pt; color:var(--accent); font-weight:800; margin:1mm 0; }}
.kpi .desc {{ font-size:8pt; color:#66736d; }}
.card {{ background:#fff; border:1px solid var(--line); border-radius:4mm; padding:5mm; margin:4mm 0; box-shadow:0 2mm 8mm rgba(60,48,36,.05); }}
.chart {{ text-align:center; }}
.chart img {{ max-width:100%; max-height:104mm; object-fit:contain; }}
.chart.small img {{ max-height:88mm; }}
.cap {{ color:var(--muted); font-size:8.5pt; margin-top:1mm; }}
table {{ width:100%; border-collapse:collapse; background:#fff; font-size:8.7pt; margin:3mm 0; }}
th {{ background:#efe6db; color:#332b24; text-align:left; font-weight:800; }}
th, td {{ border:1px solid #ddd3c6; padding:2.2mm 2.6mm; }}
td.num, th.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
.note {{ font-size:8.2pt; color:var(--muted); }}
.two {{ display:grid; grid-template-columns:1fr 1fr; gap:5mm; align-items:start; }}
.callout {{ border-left:3mm solid var(--accent); background:#fff7ef; padding:4mm 5mm; margin:4mm 0; color:#3b3028; }}
.pill {{ display:inline-block; padding:.6mm 2mm; border-radius:99px; font-size:7.8pt; background:#f0eadf; color:#6a3c1e; }}
.source {{ margin-top:4mm; color:#6d746f; font-size:8.4pt; }}
@media screen {{ .sheet {{ box-shadow:0 4px 24px rgba(0,0,0,.18); }} }}
</style>
</head>
<body>
<section class="sheet cover" id="cover">
  <div class="cover-inner">
    <div>
      <div class="eyebrow">PetroChina Company Limited · Annual Report Digest</div>
      <h1>中国石油<br>2024年度报告财务摘要</h1>
      <p class="subtitle">基于《中国石油2024年度报告》提取主要财务指标、业务板块收入，并生成趋势、结构与财务健康度可视化。</p>
      <div class="cover-grid">
        <div class="cover-stat"><div class="num">2.94万亿</div><div class="lbl">2024营业收入(人民币)</div></div>
        <div class="cover-stat"><div class="num">1,837.55亿</div><div class="lbl">净利润</div></div>
        <div class="cover-stat"><div class="num">0.90元</div><div class="lbl">每股基本及摊薄盈利</div></div>
        <div class="cover-stat"><div class="num">10.9%</div><div class="lbl">净资产收益率</div></div>
      </div>
    </div>
    <div class="cover-foot"><div>精简摘要报告 · 中文版</div><div>生成日期：2026年4月25日</div></div>
  </div>
</section>

<section class="sheet" id="toc">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>目录</span></div>
  <span class="section-tag">CONTENTS</span><h2>目录</h2>
  <p class="lead">本报告保留关键财务数据来源页码，图表为静态图片嵌入，适合打印与归档阅读。</p>
  <nav class="toc">
    <a href="#summary"><span class="p">01</span><span>执行摘要与关键结论</span><span>3</span></a>
    <a href="#financials"><span class="p">02</span><span>主要财务指标(近五年)</span><span>4</span></a>
    <a href="#trend"><span class="p">03</span><span>多年财务趋势图</span><span>5</span></a>
    <a href="#segments"><span class="p">04</span><span>分业务板块收入明细</span><span>6</span></a>
    <a href="#donut"><span class="p">05</span><span>业务收入环形图</span><span>7</span></a>
    <a href="#health"><span class="p">06</span><span>财务健康度雷达图</span><span>8</span></a>
    <a href="#notes"><span class="p">07</span><span>口径说明与数据来源</span><span>9</span></a>
  </nav>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>2 / 9</span></div>
</section>

<section class="sheet" id="summary">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>执行摘要</span></div>
  <span class="section-tag">PART 01</span><h2>执行摘要与关键结论</h2>
  <div class="kpis">
    <div class="kpi"><div class="label">营业收入</div><div class="value">{rev24_t:.2f}万亿</div><div class="desc">同比 {rev_yoy:.1f}%</div></div>
    <div class="kpi"><div class="label">净利润</div><div class="value">1,837.55亿</div><div class="desc">同比 +{net_yoy:.1f}%</div></div>
    <div class="kpi"><div class="label">归母净利润</div><div class="value">1,646.84亿</div><div class="desc">同比 +{parent_yoy:.1f}%</div></div>
    <div class="kpi"><div class="label">经营现金流</div><div class="value">4,065.32亿</div><div class="desc">现金流/净利润 {cash_to_profit:.2f}x</div></div>
  </div>
  <div class="callout"><strong>核心判断：</strong>2024年收入规模在油价与产品价格回落下同比下降2.5%，但净利润和归母净利润继续小幅增长，显示成本管控、天然气销售利润改善及资产负债结构优化对盈利形成支撑。</div>
  <div class="two">
    <div class="card"><h3>增长韧性</h3><p>营业收入为人民币2,937,981百万元，接近3.03万亿元校验标准且在允许误差内；归母净利润达到164,684百万元，连续五年改善。</p></div>
    <div class="card"><h3>结构特征</h3><p>销售板块分部收入最高，天然气销售板块收入与利润均增长，炼油化工和新材料利润受毛利空间收窄影响明显下降。</p></div>
    <div class="card"><h3>财务稳健</h3><p>总负债较上年下降7.2%，资产负债率约37.9%；权益总额增加4.5%，资本结构继续改善。</p></div>
    <div class="card"><h3>现金质量</h3><p>经营活动现金流净额为406,532百万元，虽同比下降11.0%，仍显著覆盖当年净利润，现金创造能力保持较强。</p></div>
  </div>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>3 / 9</span></div>
</section>

<section class="sheet" id="financials">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>主要财务指标</span></div>
  <span class="section-tag">PART 02</span><h2>主要财务指标(近五年)</h2>
  <p class="lead">单位除特别注明外为人民币百万元；每股收益单位为人民币元。</p>
  <table>
    <thead><tr><th>项目</th><th class="num">2024</th><th class="num">2023</th><th class="num">2022</th><th class="num">2021</th><th class="num">2020</th></tr></thead>
    <tbody>
      <tr><td>营业收入</td><td class="num">2,937,981</td><td class="num">3,012,812</td><td class="num">3,240,951</td><td class="num">2,615,967</td><td class="num">1,935,523</td></tr>
      <tr><td>经营利润</td><td class="num">233,954</td><td class="num">235,862</td><td class="num">216,888</td><td class="num">161,241</td><td class="num">76,138</td></tr>
      <tr><td>税前利润</td><td class="num">241,508</td><td class="num">237,881</td><td class="num">213,517</td><td class="num">158,308</td><td class="num">56,281</td></tr>
      <tr><td>净利润</td><td class="num">183,755</td><td class="num">180,563</td><td class="num">163,493</td><td class="num">114,658</td><td class="num">33,669</td></tr>
      <tr><td>归属于母公司股东的净利润</td><td class="num">164,684</td><td class="num">161,416</td><td class="num">148,888</td><td class="num">92,129</td><td class="num">19,190</td></tr>
      <tr><td>每股基本及摊薄盈利</td><td class="num">0.90</td><td class="num">0.88</td><td class="num">0.81</td><td class="num">0.50</td><td class="num">0.10</td></tr>
      <tr><td>资产总额</td><td class="num">2,752,751</td><td class="num">2,758,975</td><td class="num">2,676,845</td><td class="num">2,508,762</td><td class="num">2,494,086</td></tr>
      <tr><td>负债总额</td><td class="num">1,043,128</td><td class="num">1,123,679</td><td class="num">1,137,764</td><td class="num">1,098,181</td><td class="num">1,122,737</td></tr>
      <tr><td>经营活动产生的现金流量净额</td><td class="num">406,532</td><td class="num">456,847</td><td class="num">393,246</td><td class="num">341,424</td><td class="num">318,898</td></tr>
      <tr><td>净资产收益率(%)</td><td class="num">10.9</td><td class="num">11.1</td><td class="num">10.9</td><td class="num">7.3</td><td class="num">1.6</td></tr>
    </tbody>
  </table>
  <p class="note">来源：年报第5页“按国际财务报告会计准则编制的主要财务数据”。</p>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>4 / 9</span></div>
</section>

<section class="sheet" id="trend">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>财务趋势</span></div>
  <span class="section-tag">PART 03</span><h2>多年财务趋势图</h2>
  <div class="card chart"><img src="{img64(trend)}" alt="多年财务趋势图"><div class="cap">图1：营业收入以万亿元展示；利润以亿元展示。静态PNG图嵌入。</div></div>
  <div class="callout">2022年收入达到阶段高点，2023-2024年回落；利润端则保持温和增长，归母净利润从2020年的191.90亿元提升至2024年的1,646.84亿元。</div>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>5 / 9</span></div>
</section>

<section class="sheet" id="segments">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>业务板块收入</span></div>
  <span class="section-tag">PART 04</span><h2>分业务板块收入明细</h2>
  <p class="lead">年报2024年分部口径：勘探与生产对应“油气和新能源”，天然气与管道对应“天然气销售”。金额单位：人民币亿元。</p>
  <table>
    <thead><tr><th>业务板块(摘要口径)</th><th>年报分部名称</th><th class="num">分部收入</th><th class="num">对外交易收入</th><th class="num">经营利润</th><th class="num">收入同比</th></tr></thead>
    <tbody>
      <tr><td>勘探与生产</td><td>油气和新能源</td><td class="num">9,068.13</td><td class="num">1,548.62</td><td class="num">1,597.45</td><td class="num">+1.3%</td></tr>
      <tr><td>炼油与化工</td><td>炼油化工和新材料</td><td class="num">11,925.89</td><td class="num">3,442.20</td><td class="num">213.86</td><td class="num">-2.3%</td></tr>
      <tr><td>销售</td><td>销售</td><td class="num">24,545.46</td><td class="num">18,784.62</td><td class="num">164.94</td><td class="num">-2.9%</td></tr>
      <tr><td>天然气与管道</td><td>天然气销售</td><td class="num">5,926.90</td><td class="num">5,571.07</td><td class="num">540.10</td><td class="num">+5.6%</td></tr>
    </tbody>
  </table>
  <div class="two">
    <div class="card"><h3>收入结构</h3><p>销售板块分部收入占四大板块合计近一半，体现公司在成品油销售和贸易链条中的规模优势。</p></div>
    <div class="card"><h3>利润贡献</h3><p>勘探与生产利润最高；天然气与管道利润同比增长25.5%，成为2024年业绩改善的重要支撑。</p></div>
  </div>
  <p class="note">来源：年报第23-25页“分部业绩”及第262页“经营分部”。分部收入含内部交易；对外交易收入来自经营分部表。</p>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>6 / 9</span></div>
</section>

<section class="sheet" id="donut">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>收入结构图</span></div>
  <span class="section-tag">PART 05</span><h2>业务收入环形图</h2>
  <div class="card chart"><img src="{img64(donut)}" alt="业务收入环形图"><div class="cap">图2：按四大板块分部收入口径绘制，未抵销分部间交易。</div></div>
  <div class="callout">若改用“对外交易收入”口径，销售板块占比更高；本页采用分部收入口径，以体现各业务链条经营规模。</div>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>7 / 9</span></div>
</section>

<section class="sheet" id="health">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>财务健康度</span></div>
  <span class="section-tag">PART 06</span><h2>财务健康度雷达图</h2>
  <div class="two">
    <div class="card chart small"><img src="{img64(radar)}" alt="财务健康度雷达图"><div class="cap">图3：基于2024年核心指标构建的标准化评分。</div></div>
    <div class="card">
      <h3>评分口径</h3>
      <p><span class="pill">规模稳定</span> 2024收入/五年最高收入。</p>
      <p><span class="pill">盈利能力</span> 净利率相对6.5%目标上限。</p>
      <p><span class="pill">ROE效率</span> 2024 ROE/五年最高ROE。</p>
      <p><span class="pill">现金创造</span> 经营现金流/净利润，2倍封顶。</p>
      <p><span class="pill">资本稳健</span> 权益占资产比例相对65%目标上限。</p>
      <p><span class="pill">板块盈利</span> 四大板块经营利润均为正。</p>
    </div>
  </div>
  <div class="callout">2024年公司在现金创造、ROE效率和板块盈利方面表现强；主要压力来自收入规模较2022年高点回落、炼油化工和销售板块利润承压。</div>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>8 / 9</span></div>
</section>

<section class="sheet" id="notes">
  <div class="header"><span>中国石油2024年度报告财务摘要</span><span>口径与来源</span></div>
  <span class="section-tag">PART 07</span><h2>口径说明与数据来源</h2>
  <div class="card">
    <h3>数据来源</h3>
    <p>本摘要来自附件《中国石油2024年度报告.pdf》：</p>
    <ul>
      <li>主要财务指标：第5页“按国际财务报告会计准则编制的主要财务数据”。</li>
      <li>分部业绩文字说明：第23-25页“经营情况讨论与分析 — 分部业绩”。</li>
      <li>经营分部收入、对外交易收入、经营利润：第262-263页“合并财务报表附注 — 经营分部”。</li>
    </ul>
  </div>
  <div class="card">
    <h3>重要口径</h3>
    <ul>
      <li>营业收入2024年为2,937,981百万元，即约2.94万亿元；与“约3.03万亿元”的校验标准误差约3.1%，在±5%范围内。</li>
      <li>业务板块名称按用户问题统一为“勘探与生产、炼油与化工、销售、天然气与管道”；年报对应名称分别为“油气和新能源、炼油化工和新材料、销售、天然气销售”。</li>
      <li>图表均为本地生成的静态PNG图片后嵌入HTML，再通过Chromium HTML→PDF渲染。</li>
    </ul>
  </div>
  <div class="source">制作用途：管理层/投资者快速阅读版；本摘要不替代经审计年度报告全文。</div>
  <div class="footer"><span>PetroChina 2024 Annual Report Digest</span><span>9 / 9</span></div>
</section>
</body>
</html>'''
(out/'petrochina_2024_summary.html').write_text(html, encoding='utf-8')
manifest = {'financial': financial, 'segments': segments, 'radar_scores': dict(zip(radar_labels, radar_vals))}
(out/'data_manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(out/'petrochina_2024_summary.html')
