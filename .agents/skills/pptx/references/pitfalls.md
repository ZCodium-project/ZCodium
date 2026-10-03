# QA Process & Common Pitfalls

## QA Process

**Assume there are problems. Your job is to find them.**

Your first render is almost never correct. Approach QA as a bug hunt, not a confirmation step. If you found zero issues on first inspection, you weren't looking hard enough.

### Delegate QA to a Subagent

**The QA process should be executed by a separate subagent** (not the same agent that created the slides). The creating agent is biased toward confirming its own work. A fresh subagent with no prior context will catch issues that the creator overlooks.

Spawn a subagent with:
- The compiled PPTX path
- The original source material (if any) for content verification
- The template PPTX path (if imitating a template) for visual conformance checking
- The instructions below as the QA checklist

The subagent should return a structured pass/fail report. If any check fails, the creating agent fixes the issues and re-runs QA (via the same or a new subagent).

### Content QA

```bash
python -m markitdown output.pptx
```

Check for missing content, typos, wrong order.

**Check for leftover placeholder text:**

```bash
python -m markitdown output.pptx | grep -iE "xxxx|lorem|ipsum|placeholder|this.*(page|slide).*layout"
```

If grep returns results, fix them before declaring success.

### Source Content Verification

**When the deck is derived from external source material** (paper, article, report, brief), verify content fidelity:

1. **Extract key claims**: List all important numbers, conclusions, and facts from the source material.
2. **Search the deck**: For each key claim, confirm it appears in the compiled PPTX text (via markitdown).
3. **Check placement**: Verify each claim is on the slide whose section topic matches (e.g., a key result number should be on the Results slide, not the Conclusion slide).
4. **Flag gaps**: Any missing or misplaced claim is a QA failure that must be fixed.

### Visual Conformance (Template Imitation)

**When imitating a template's visual style**, verify:

1. **Dark/light mode match**: Take a screenshot of the generated deck. Does its background color match the template's mode?
2. **Color palette**: Are the accent colors, text colors, and background colors consistent with the template's theme?
3. **Font families**: Are the generated deck's fonts the same as the template's (not the skill's default Arial)?
4. **Overall gestalt**: Compare template screenshots side-by-side with generated deck screenshots. The visual impression should be recognizably similar.

### Verification Loop

1. Generate slides -> Extract text with `python -m markitdown output.pptx` -> Review content
2. **List issues found** (if none found, look again more critically)
3. Fix issues
4. **Re-verify affected slides** — one fix often creates another problem
5. Repeat until a full pass reveals no new issues

**Do not declare success until you've completed at least one fix-and-verify cycle.**

### Per-Slide QA (for from-scratch creation)

```bash
python -m markitdown slide-XX-preview.pptx
```

Check for missing content, placeholder text, missing page number badge.

---

## Common Mistakes to Avoid

- **Don't repeat the same layout** — vary columns, cards, and callouts across slides
- **Don't center body text** — left-align paragraphs and lists; center only titles
- **Don't skimp on size contrast** — titles need 36pt+ to stand out from 14-16pt body
- **Don't default to blue** — pick colors that reflect the specific topic
- **Don't mix spacing randomly** — choose 0.3" or 0.5" gaps and use consistently
- **Don't style one slide and leave the rest plain** — commit fully or keep it simple throughout
- **Don't create text-only slides** — add images, icons, charts, or visual elements; avoid plain title + bullets
- **Don't forget text box padding** — when aligning lines or shapes with text edges, set `margin: 0` on the text box or offset the shape to account for padding
- **Don't use low-contrast elements** — icons AND text need strong contrast against the background
- **NEVER use accent lines under titles** — these are a hallmark of AI-generated slides; use whitespace or background color instead
- **NEVER use "#" with hex colors** — causes file corruption in PptxGenJS
- **NEVER encode opacity in hex strings** — use the `opacity` property instead
- **NEVER use async/await in createSlide()** — compile.js won't await
- **NEVER reuse option objects across PptxGenJS calls** — PptxGenJS mutates objects in-place

---

## Critical Pitfalls — PptxGenJS

### NEVER use async/await in createSlide()

```javascript
// WRONG - compile.js won't await
async function createSlide(pres, theme) { ... }

// CORRECT
function createSlide(pres, theme) { ... }
```

### NEVER use "#" with hex colors

```javascript
color: "FF0000"      // CORRECT
color: "#FF0000"     // CORRUPTS FILE
```

### NEVER encode opacity in hex strings

```javascript
shadow: { color: "00000020" }              // CORRUPTS FILE
shadow: { color: "000000", opacity: 0.12 } // CORRECT
```

### Prevent text wrapping in titles

```javascript
// Use fit:'shrink' for long titles
slide.addText("Long Title Here", {
  x: 0.5, y: 2, w: 9, h: 1,
  fontSize: 48, fit: "shrink"
});
```

### NEVER reuse option objects across calls

```javascript
// WRONG
const shadow = { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.15 };
slide.addShape(pres.shapes.RECTANGLE, { shadow, ... });
slide.addShape(pres.shapes.RECTANGLE, { shadow, ... });

// CORRECT - factory function
const makeShadow = () => ({ type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.15 });
slide.addShape(pres.shapes.RECTANGLE, { shadow: makeShadow(), ... });
slide.addShape(pres.shapes.RECTANGLE, { shadow: makeShadow(), ... });
```

### NEVER use non-ASCII characters in JS slide files

Chinese quotes (`\u201c` `\u201d` `\u2018` `\u2019`), full-width punctuation, and other non-ASCII
characters in JS source files cause `node` to throw syntax errors at compile time. This is the
**#1 cause of compile failures** — it triggers cascading fix attempts that waste 10+ tool calls.

Common sources of non-ASCII contamination:

- **Chinese smart quotes** `\u201c\u201d` instead of `"` — the most frequent offender
- **Full-width colons** `\uff1a` instead of `:`
- **Full-width parentheses** `\uff08\uff09` instead of `()`
- **Em-dashes** `\u2014` instead of `--`
- **Non-breaking spaces** `\u00a0` instead of regular space

Rules:

1. **All JS string literals must use only ASCII characters.** For CJK text content, write it
   directly with standard ASCII quotes wrapping the string — `"Chinese text here"` is correct.
2. **Never copy-paste text from user documents, PDFs, or web pages directly into JS string
   literals** without first checking for smart quotes and full-width punctuation.
3. **Use the pre-compile lint** (see below) before every `node compile.js` invocation.

```javascript
// WRONG — Chinese smart quotes break compilation
slide.addText("\u201c\u667a\u80fd\u52a9\u624b\u201d\u7684\u6838\u5fc3\u4ef7\u503c", { ... });

// CORRECT — ASCII quotes only in JS source
slide.addText('"\u667a\u80fd\u52a9\u624b"\u7684\u6838\u5fc3\u4ef7\u503c', { ... });
```

---

## Pre-Compile Lint

**Run this before every `node compile.js`.**  It catches non-ASCII quote issues before they
cascade into 10+ fix attempts.

```bash
# One-liner: scan all slide JS files for non-ASCII quotes and full-width punctuation
node -e "
const fs = require('fs');
const files = fs.readdirSync('./slides').filter(f => f.endsWith('.js'));
let ok = true;
const BAD = /[\u201c\u201d\u2018\u2019\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f\uff08\uff09\u2014\u2013\u2026\u00a0]/g;
for (const f of files) {
  const src = fs.readFileSync('./slides/' + f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(BAD);
    if (m) {
      console.error('NON-ASCII in slides/' + f + ':' + (i+1) + ' -> ' + JSON.stringify(m));
      ok = false;
    }
  }
}
if (!ok) { console.error('FIX non-ASCII characters before compiling!'); process.exit(1); }
else { console.log('Pre-compile lint passed.'); }
"
```

If the lint fails, replace all flagged characters with their ASCII equivalents before proceeding.
**Do not attempt to compile until the lint passes.**
