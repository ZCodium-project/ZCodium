# Advanced Reference

Maintained by MiniMax (MIT). This reference collects PDF features and
libraries that are too situational for the main `SKILL.md`. Reach for
it when the standard recipes in `create-guide.md` / `forms-guide.md` /
`read-guide.md` are not enough.

All in-tree script invocations live under `scripts/` and are dispatched
through `bash scripts/make.sh ...`. The fill / pdf_inspect / render / validate
subpackages can also be run directly as `python -m scripts.<group>.<name>`
from the skill root when you need fine-grained control.

Global navigation rule for every mutation path: when you merge, split, rotate,
crop, watermark, encrypt, annotate, sign, or otherwise rebuild a PDF, preserve
existing TOC links, named destinations, outlines/bookmarks, and `/Link`
annotations whenever possible. If page order or page offsets change, update the
visible TOC/index, outlines, and link destinations so they still land on the
correct pages. For any newly assembled multi-page output, add clickable
TOC/index navigation before delivery; do not ship a merged packet whose first
page is an inert list of page numbers.

> **Note on the `pdf_inspect/` directory name.** It is deliberately
> *not* called `inspect/`. Python ≥ 3.11 colourised tracebacks pull
> ``inspect.signature`` in via ``argparse → _colorize → dataclasses``, and
> any package named ``inspect`` placed first on ``sys.path`` (which the
> CPython "script directory at index 0" rule does for entry-point
> scripts) shadows the stdlib module and breaks every renderer that
> transitively touches it (reportlab → PIL → typing_extensions). The
> rename is structural insulation against that whole class of bugs.

---

## 1. pypdfium2 — High-Performance Rendering

`pypdfium2` is the Python binding for PDFium (Chromium's PDF engine).
It is the fastest mainstream renderer in the Python ecosystem.

### 1.1 Render a page to PIL

```python
import pypdfium2 as pdfium
src_doc = pdfium.PdfDocument("invoice.pdf")
pg = src_doc[0]
bitmap = pg.render(scale=2.0, rotation=0)
bitmap.to_pil().save("invoice_page_1.png", "PNG")
```

### 1.2 Render every page to JPEG

```python
import pypdfium2 as pdfium
src_doc = pdfium.PdfDocument("payslip.pdf")
for i, pg in enumerate(src_doc):
    pg.render(scale=1.5).to_pil().save(f"payslip_{i + 1}.jpg", "JPEG", quality=90)
```

### 1.3 Cheap text extraction

```python
import pypdfium2 as pdfium
src_doc = pdfium.PdfDocument("payslip.pdf")
for i, pg in enumerate(src_doc):
    body = pg.get_text()
    print(f"page {i + 1}: {len(body)} chars")
```

---

## 2. JavaScript Libraries

These are useful when the surrounding application is a Node service or
a browser front-end. They are listed here only for completeness; the
in-tree scripts are pure Python.

### 2.1 pdf-lib (MIT)

`pdf-lib` works in any JavaScript runtime — Node, Deno, browsers — and
preserves form structure better than most alternatives.

#### Manipulate an existing document

```javascript
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function tweak() {
  const bytes = fs.readFileSync('invoice.pdf');
  const doc = await PDFDocument.load(bytes);

  console.log(`pages: ${doc.getPageCount()}`);
  const pg = doc.addPage([600, 400]);
  pg.drawText('Added by pdf-lib', { x: 100, y: 300, size: 16 });

  fs.writeFileSync('invoice-modified.pdf', await doc.save());
}
```

#### Author from scratch

```javascript
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';

async function makeInvoice() {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pg   = doc.addPage([595, 842]);
  const { width, height } = pg.getSize();

  pg.drawText('Invoice 2026-04-21', {
    x: 50, y: height - 50, size: 18, font: bold, color: rgb(0.2, 0.2, 0.8),
  });
  pg.drawRectangle({
    x: 40, y: height - 100, width: width - 80, height: 30,
    color: rgb(0.9, 0.9, 0.9),
  });

  fs.writeFileSync('invoice-new.pdf', await doc.save());
}
```

#### Merge selected pages

```javascript
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function combine() {
  const merged = await PDFDocument.create();

  const a = await PDFDocument.load(fs.readFileSync('a.pdf'));
  const b = await PDFDocument.load(fs.readFileSync('b.pdf'));

  (await merged.copyPages(a, a.getPageIndices()))
    .forEach(pg => merged.addPage(pg));
  (await merged.copyPages(b, [0, 2, 4]))
    .forEach(pg => merged.addPage(pg));

  fs.writeFileSync('combined.pdf', await merged.save());
}
```

### 2.2 pdfjs-dist (Apache)

Mozilla's PDF.js, packaged for npm. Used primarily inside browsers.

```javascript
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.js';

async function show() {
  const pdf = await pdfjsLib.getDocument('invoice.pdf').promise;
  const pg  = await pdf.getPage(1);
  const vp  = pg.getViewport({ scale: 1.5 });

  const cv = document.createElement('canvas');
  cv.width  = vp.width;
  cv.height = vp.height;
  await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  document.body.appendChild(cv);
}
```

Extract text with coordinates:

```javascript
async function harvest() {
  const pdf = await pdfjsLib.getDocument('invoice.pdf').promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg   = await pdf.getPage(i);
    const txt  = await pg.getTextContent();
    const items = txt.items.map(it => ({
      text: it.str,
      x:    it.transform[4],
      y:    it.transform[5],
      w:    it.width,
      h:    it.height,
    }));
    console.log(`page ${i} - ${items.length} runs`);
  }
}
```

Pull form/annotation metadata:

```javascript
async function annotations() {
  const pdf = await pdfjsLib.getDocument('annotated.pdf').promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    for (const a of await pg.getAnnotations()) {
      console.log(a.subtype, a.contents, a.rect);
    }
  }
}
```

---

## 3. Heavy CLI Recipes

### 3.1 poppler-utils (advanced)

```bash
# Text + bounding boxes (XML)
pdftotext -bbox-layout invoice.pdf invoice.xml

# Render with explicit DPI
pdftoppm -png -r 300 invoice.pdf out_prefix

# Range with high resolution
pdftoppm -png -r 600 -f 1 -l 3 invoice.pdf high_res

# JPEG with quality knob
pdftoppm -jpeg -jpegopt quality=85 -r 200 invoice.pdf jpeg_out

# Pull all images, with metadata
pdfimages -j -p invoice.pdf images/

# List images without extracting
pdfimages -list invoice.pdf

# Original-format extraction
pdfimages -all invoice.pdf images/img
```

### 3.2 qpdf (advanced)

```bash
# Split into N-page chunks
qpdf --split-pages=3 invoice.pdf out_%02d.pdf

# Custom page picks
qpdf invoice.pdf --pages invoice.pdf 1,3-5,8,10-end -- subset.pdf

# Cross-document merge with per-source ranges
qpdf --empty --pages a.pdf 1-3 b.pdf 5-7 c.pdf 2,4 -- combined.pdf

# Linearise for streaming
qpdf --linearize invoice.pdf invoice-web.pdf

# Optimisation
qpdf --optimize-level=all invoice.pdf invoice-small.pdf

# Repair
qpdf --check broken.pdf
qpdf --fix-qdf damaged.pdf repaired.pdf

# Encryption with explicit permissions
qpdf --encrypt user_pw owner_pw 256 --print=none --modify=none -- in.pdf out.pdf

# Inspection
qpdf --show-encryption out.pdf
qpdf --password=pw --decrypt out.pdf clear.pdf
qpdf --show-all-pages invoice.pdf > structure.txt
```

### 3.3 pdftk (fallback when qpdf is unavailable)

`pdftk` predates qpdf and survives on systems where qpdf is hard to install
(some old Linux distros, locked-down corporate machines). Recipes are coarser
than qpdf but the binary is widely packaged.

```bash
# Merge
pdftk a.pdf b.pdf cat output merged.pdf

# Split into one file per page
pdftk input.pdf burst        # produces pg_0001.pdf, pg_0002.pdf, ...

# Rotate single pages (east = +90 clockwise, west = -90, south = 180)
pdftk input.pdf rotate 1east output rotated.pdf

# Concatenate selected page ranges across files
pdftk A=a.pdf B=b.pdf cat A1-3 B5-7 output combined.pdf

# Encrypt (AES-128)
pdftk input.pdf output secured.pdf owner_pw owner_pass user_pw user_pass

# Decrypt (requires owner password)
pdftk secured.pdf input_pw owner_pass output clear.pdf
```

Prefer qpdf where both are installed: qpdf has finer optimisation knobs,
better repair, and AES-256 support; pdftk is the safety net.

---

## 4. Advanced Python

### 4.1 pdfplumber — coordinate-aware extraction

```python
import pdfplumber
with pdfplumber.open("payslip.pdf") as src_doc:
    pg = src_doc.pages[0]
    for ch in pg.chars[:10]:
        print(ch["text"], ch["x0"], ch["top"])
    region = pg.within_bbox((100, 100, 400, 200)).extract_text()
```

Custom table strategy:

```python
import pdfplumber
import pandas as pd

with pdfplumber.open("complex_table.pdf") as src_doc:
    pg = src_doc.pages[0]
    settings = {
        "vertical_strategy":      "lines",
        "horizontal_strategy":    "lines",
        "snap_tolerance":         3,
        "intersection_tolerance": 15,
    }
    tbls = pg.extract_tables(settings)
    pg.to_image(resolution=150).save("debug.png")
```

### 4.2 reportlab — styled tables

```python
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
)
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

rows = [
    ["Product", "Q1", "Q2", "Q3", "Q4"],
    ["Widgets", "120", "135", "142", "158"],
    ["Gadgets",  "85",  "92",  "98", "105"],
]

doc   = SimpleDocTemplate("sales.pdf")
story = [Paragraph("Quarterly Sales", getSampleStyleSheet()["Title"])]
tbl   = Table(rows)
tbl.setStyle(TableStyle([
    ("BACKGROUND",  (0, 0), (-1, 0),  colors.grey),
    ("TEXTCOLOR",   (0, 0), (-1, 0),  colors.whitesmoke),
    ("ALIGN",       (0, 0), (-1, -1), "CENTER"),
    ("FONTNAME",    (0, 0), (-1, 0),  "Helvetica-Bold"),
    ("FONTSIZE",    (0, 0), (-1, 0),  14),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 12),
    ("BACKGROUND",  (0, 1), (-1, -1), colors.beige),
    ("GRID",        (0, 0), (-1, -1), 1, colors.black),
]))
story.append(tbl)
doc.build(story)
```

---

## 5. Annotations, Signatures, and Text Overlay

Three related mutation routes for annotating an existing PDF without
rebuilding the page. All keep the original content stream intact and
either add an annotation object or stack an overlay on top.

### 5.1 Sticky note annotations (`/Text` subtype)

Sticky notes show as a clickable icon in Adobe Acrobat / macOS Preview;
the comment text appears when the icon is opened.

```python
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    DictionaryObject, ArrayObject, FloatObject,
    NameObject, TextStringObject, NumberObject, BooleanObject,
)

def make_sticky_note(x, y, w, h, *, subject, contents, color=(1, 1, 0)):
    annot = DictionaryObject()
    annot[NameObject("/Type")]    = NameObject("/Annot")
    annot[NameObject("/Subtype")] = NameObject("/Text")
    annot[NameObject("/Rect")]    = ArrayObject([
        FloatObject(x), FloatObject(y),
        FloatObject(x + w), FloatObject(y + h),
    ])
    annot[NameObject("/T")]        = TextStringObject("Reviewer")
    annot[NameObject("/Subj")]     = TextStringObject(subject)
    annot[NameObject("/Contents")] = TextStringObject(contents)
    annot[NameObject("/Open")]     = BooleanObject(False)
    annot[NameObject("/C")]        = ArrayObject([FloatObject(c) for c in color])
    annot[NameObject("/F")]        = NumberObject(4)         # Print flag
    annot[NameObject("/Name")]     = NameObject("/Note")
    return annot

reader = PdfReader("input.pdf")
writer = PdfWriter()
for pg in reader.pages:
    writer.add_page(pg)

page    = writer.pages[0]
page_h  = float(page.mediabox.height)

# pdfplumber `top` is from the page TOP; pypdf y is from the page BOTTOM:
#   pypdf_y = page_h - pdfplumber_top
note     = make_sticky_note(54, page_h - 270, 20, 20,
                            subject="Review", contents="Must order!")
note_ref = writer._add_object(note)

# Append to the existing /Annots, never overwrite:
existing = page.get("/Annots")
existing_list = list(existing) if existing else []
existing_list.append(note_ref)
page[NameObject("/Annots")] = ArrayObject(existing_list)

with open("output.pdf", "wb") as fp:
    writer.write(fp)
```

Notes:

- `/F` = 4 sets the Print flag — without it some viewers omit the
  annotation when printing.
- `/C` is a 0-1 RGB tuple, not 0-255.
- Chromium's built-in PDF viewer ignores annotations; verify with
  Acrobat, Preview, or `pdftotext -annotate`.

### 5.2 Visible signatures and stamps (`/FreeText` subtype)

`FreeText` renders text directly on the page (no click-to-open icon) —
the standard way to add a visible signature, date stamp, or watermark
without rebuilding the page.

```python
sig = DictionaryObject()
sig[NameObject("/Type")]     = NameObject("/Annot")
sig[NameObject("/Subtype")]  = NameObject("/FreeText")
sig[NameObject("/Rect")]     = ArrayObject([
    FloatObject(x), FloatObject(y),
    FloatObject(x + width), FloatObject(y + height),
])
sig[NameObject("/Contents")] = TextStringObject("J. Doe\n2026.04.21")
# /DA = "/FontName Size Tf  R G B rg"  (RGB are 0-1)
sig[NameObject("/DA")]       = TextStringObject("/Helvetica 16 Tf 0.1 0.1 0.35 rg")
sig[NameObject("/F")]        = NumberObject(4)
sig[NameObject("/C")]        = ArrayObject([])               # no border
sig[NameObject("/IC")]       = ArrayObject([])               # transparent fill
sig[NameObject("/BS")]       = DictionaryObject({
    NameObject("/W"): FloatObject(0),
})
sig[NameObject("/Q")]        = NumberObject(2)               # 0=left, 1=center, 2=right
```

Notes:

- `/DA` font names are limited to PDF built-ins (`/Helvetica`,
  `/Times-Roman`, `/Courier`). **Built-ins do not cover CJK** — for
  Chinese / Japanese / Korean signatures, drop down to the overlay
  route in §5.3.
- `/Q` is text alignment: 0/1/2 = left/center/right.
- Set `/IC` to `[r, g, b]` instead of `[]` if you want a coloured fill
  behind the text (e.g. a yellow highlight).

### 5.3 Replace text via white-out + overlay (works with CJK)

PDF text lives inside compressed content streams; editing it in place
is impractical. The reliable approach is **white box on top of the
original + new text on top of the white box, all merged as an overlay
page**:

1. Locate the original text with `pdfplumber` (gives x0/x1/top/bottom).
2. Build an overlay page in `reportlab` with a white rectangle and the
   replacement text.
3. Call `merge_page(overlay)` to stack the overlay above the original.

```python
import io
import pdfplumber
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

# 1. Find the source coordinates.
with pdfplumber.open("menu.pdf") as src:
    pg = src.pages[0]
    page_w, page_h = float(pg.width), float(pg.height)
    target = next(w for w in pg.extract_words() if "胡麻豆腐" in w["text"])
    # target = {"text": "胡麻豆腐", "x0": 54.75, "x1": 97.58,
    #           "top": 255.77, "bottom": 266.48, ...}

# Convert pdfplumber-top to reportlab-y (origin at page bottom):
rl_y_bottom = page_h - target["bottom"]
rl_y_top    = page_h - target["top"]

# 2. Draw the overlay (white box + new text).
pdfmetrics.registerFont(TTFont(
    "DroidSans", "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
))
packet = io.BytesIO()
c = canvas.Canvas(packet, pagesize=(page_w, page_h))
c.setFillColorRGB(1, 1, 1)
c.rect(target["x0"] - 2, rl_y_bottom - 2,
       (target["x1"] - target["x0"]) + 4,
       (rl_y_top - rl_y_bottom) + 4,
       fill=1, stroke=0)                          # pad ~2pt to swallow ink fringes
c.setFont("DroidSans", 11)
c.setFillColorRGB(0.18, 0.12, 0.05)               # match the original ink colour
c.drawString(target["x0"], rl_y_bottom + 2, "世东豆腐")
c.save()
packet.seek(0)

# 3. Merge the overlay into the original page.
reader  = PdfReader("menu.pdf")
overlay = PdfReader(packet).pages[0]
writer  = PdfWriter()
for i, page in enumerate(reader.pages):
    if i == 0:
        page.merge_page(overlay)                  # overlay stacks ABOVE original
    writer.add_page(page)
with open("menu_patched.pdf", "wb") as fp:
    writer.write(fp)
```

Coordinate cheat sheet:

```
pdfplumber top  -> distance from page TOP    (top axis)
reportlab  y    -> distance from page BOTTOM (bottom axis)
pypdf      y    -> distance from page BOTTOM (bottom axis)

reportlab_y = page_height - pdfplumber_top
```

Notes:

- Pad the white rectangle by 2-4pt on each side to swallow
  anti-aliasing fringes on the original glyphs.
- For colour match, render the source page to PNG (use
  `python -m scripts.render.page_rasterize`), sample the ink with any
  colour picker, and divide each channel by 255 to get the reportlab
  triplet (e.g. RGB(46, 30, 13) -> `(0.18, 0.12, 0.05)`).
- CJK text needs a TTF font registered via `TTFont(...)` — built-in
  fonts only cover Latin-1.
- `merge_page(overlay)` stacks `overlay` **above** the original in the
  content stream — that is what makes the white box hide the original
  ink and the new text sit on top of the white box.

### 5.4 Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| Annotation invisible when printing | `/F` flag missing or wrong | set `/F` to `4` (Print) |
| Sticky note disappears after a second pass | `/Annots` was overwritten, not appended | `list(page.get("/Annots") or [])` then append |
| Chinese characters render as boxes in `/FreeText` | built-in fonts don't cover CJK | switch to the overlay route in §5.3 |
| White box covers the wrong region | mixed up pdfplumber top vs reportlab y | `reportlab_y = page_h - pdfplumber_top` |
| Original ink shows through the edges of the white box | rectangle too tight | pad by 2-4pt on each side |
| Overlay text appears underneath the white box | `merge_page` direction reversed | call `original.merge_page(overlay)` so the overlay goes on top |

---

## 6. Workflows

### 5.1 Extract figures from a PDF

Fast path with poppler:

```bash
pdfimages -all invoice.pdf images/img
```

Detect-and-crop with pypdfium2 plus numpy:

```python
import pypdfium2 as pdfium
import numpy as np

def figures(pdf_path):
    src_doc = pdfium.PdfDocument(pdf_path)
    for i, pg in enumerate(src_doc):
        bitmap = pg.render(scale=3.0)
        arr = np.array(bitmap.to_pil())
        non_white = np.any(arr != [255, 255, 255], axis=2)
        # Plug your favourite contour finder in here.
        yield i, non_white.sum()
```

### 5.2 Batch processing with error handling

```python
import glob, logging, os
from pypdf import PdfReader, PdfWriter

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

def merge(folder):
    out_doc = PdfWriter()
    for path in glob.glob(os.path.join(folder, "*.pdf")):
        try:
            for pg in PdfReader(path).pages:
                out_doc.add_page(pg)
            log.info("ok %s", path)
        except Exception as exc:  # noqa: BLE001
            log.error("skip %s: %s", path, exc)
    with open("merged.pdf", "wb") as fp:
        out_doc.write(fp)

def dump_text(folder):
    for path in glob.glob(os.path.join(folder, "*.pdf")):
        try:
            text = "".join(pg.extract_text() for pg in PdfReader(path).pages)
            with open(path.replace(".pdf", ".txt"), "w", encoding="utf-8") as fp:
                fp.write(text)
        except Exception as exc:  # noqa: BLE001
            log.error("skip %s: %s", path, exc)
```

### 5.3 Crop pages

```python
from pypdf import PdfReader, PdfWriter

src_doc = PdfReader("invoice.pdf")
out_doc = PdfWriter()

pg = src_doc.pages[0]
pg.mediabox.left   = 50
pg.mediabox.bottom = 50
pg.mediabox.right  = 550
pg.mediabox.top    = 750
out_doc.add_page(pg)

with open("invoice_cropped.pdf", "wb") as fp:
    out_doc.write(fp)
```

---

## 7. Performance Tips

1. **Large PDFs** — stream pages with `pypdf`/`pypdfium2`, never load
   the entire file in RAM. Use `qpdf --split-pages` to chunk.
2. **Text extraction** — `pdftotext -bbox-layout` is fastest for plain
   text; `pdfplumber` is the right tool when you need tables;
   `pypdf.extract_text()` is the slowest option for big documents.
3. **Image extraction** — `pdfimages` is faster than rendering each
   page yourself; render only when you actually need the rasterised
   pixels (e.g. for OCR or visual overlay).
4. **Form filling** — pre-validate the input config (the bundled
   `geometry_lint` does this for the overlay path); for AcroForm,
   trust `acroform_apply` to validate against the discovered schema.
5. **Memory management** — process pages in chunks:

```python
from pypdf import PdfReader, PdfWriter

def chunked(path, chunk=10):
    src_doc = PdfReader(path)
    total   = len(src_doc.pages)
    for start in range(0, total, chunk):
        out_doc = PdfWriter()
        for i in range(start, min(start + chunk, total)):
            out_doc.add_page(src_doc.pages[i])
        with open(f"chunk_{start // chunk}.pdf", "wb") as fp:
            out_doc.write(fp)
```

---

## 8. Troubleshooting

### Encrypted PDFs

```python
from pypdf import PdfReader

src_doc = PdfReader("encrypted.pdf")
if src_doc.is_encrypted:
    src_doc.decrypt("password")
```

### Corrupted PDFs

```bash
qpdf --check corrupted.pdf
qpdf --replace-input corrupted.pdf
```

### Scanned PDFs (no text layer)

```python
import pytesseract
from pdf2image import convert_from_path

def ocr(pdf_path):
    return "".join(
        pytesseract.image_to_string(img)
        for img in convert_from_path(pdf_path)
    )
```

---

## 9. Third-Party Library Licenses

| Library      | License   |
| ------------ | --------- |
| pypdf        | BSD       |
| pdfplumber   | MIT       |
| pypdfium2    | Apache/BSD |
| reportlab    | BSD       |
| pdf2image    | MIT       |
| Pillow       | HPND (PIL) |
| poppler-utils | GPL-2     |
| qpdf         | Apache    |
| pdf-lib      | MIT       |
| pdfjs-dist   | Apache    |
