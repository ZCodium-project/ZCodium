# Forms Guide

FILL is for putting values into the fields of an existing PDF form without
changing its layout or design. There are two main paths:

- **AcroForm** (PDF carries fillable widget fields): `probe -> inspect -> apply`
- **Non-AcroForm** (scanned images, visual tables, Word-printed-to-PDF):
  `probe -> scan -> rasterize -> preview -> overlay -> lint`

Global navigation rule: if the filled output is multi-page, preserve existing
PDF bookmarks, outlines, named destinations, and link annotations. If the form
is part of a generated multi-page packet, add a clickable index/outline to the
packet. Do **not** add a visible TOC page to an official form when that would
change its required page count or invalidate submission; in that case preserve
or add non-visual outline/bookmark navigation where possible and state the
exception in the delivery note. Single-page forms may omit TOC/index.

All commands run through `bash scripts/make.sh fill <verb>`, which automatically
changes into the skill root. You can also call the underlying scripts directly
with `python -m scripts.<group>.<name>` from the same cwd.

## Step 0 — Scan the templates

For complex government / multi-language forms (visa, tax, application) start
from [`../templates/form-fill-acroform/README.md`](../templates/form-fill-acroform/README.md).

That template was distilled from reference examples m03 (Italian visa AcroForm
fill) and ships with:

- `field_values.template.json` schema (the new array format `[{qname, page_no, set_to}]`,
  uniquely keyed by qname)
- A 9-step procedure (probe -> inspect -> mapping -> dry-run -> apply ->
  verify -> USER-FINAL-SUMMARY)
- 12 known pitfalls (same-name widget collisions, checkbox `on_state` literals,
  multiline `/Ff` bit, font substitution, placeholder pollution, visual-only
  frames, ...)

For simple single-page forms with no name collisions, drop straight into the
decision tree below.

---

## A. Probe the form type

```bash
bash scripts/make.sh fill probe form.pdf
```

The script prints exactly one machine-readable line:

```
acroform=true       # has fillable AcroForm fields -> follow §B
acroform=false      # no AcroForm fields            -> follow §C
```

A second human hint line follows. When scripting, parse only the `acroform=` line.

---

## B. Path 1 — AcroForm (fillable) PDFs

### B.1 Enumerate fields

```bash
bash scripts/make.sh fill inspect form.pdf meta.json
```

The output is a JSON array. Records look like:

```jsonc
{
  "qname":   "person.last_name",          // fully qualified name
  "page_no": 1,
  "box":     [left, bottom, right, top],   // pypdf rect, y=0 at bottom
  "type":    "text"
}

// Checkboxes carry on/off values:
{
  "qname":     "is_adult",
  "page_no":   1,
  "type":      "checkbox",
  "on_value":  "/On",
  "off_value": "/Off",
  "box":       [...]
}

// Radio groups:
{
  "qname":   "shirt_size",
  "page_no": 1,
  "type":    "radio_group",
  "radio_choices": [
    { "set_to": "/Small",  "box": [...] },
    { "set_to": "/Medium", "box": [...] }
  ]
}

// Multiple-choice / dropdown:
{
  "qname":   "country",
  "page_no": 1,
  "type":    "choice",
  "choice_options": [
    { "set_to": "us", "label": "United States" },
    { "set_to": "uk", "label": "United Kingdom" }
  ]
}
```

### B.2 Visual confirmation (recommended)

```bash
bash scripts/make.sh fill rasterize form.pdf preview/
```

Open `preview/page_1.png` etc. and cross-check against `meta.json` to confirm
each field's purpose.

### B.3 Build the values config

Create `values.json` as an array:

```jsonc
[
  { "qname": "person.last_name", "page_no": 1, "set_to": "Simpson" },
  { "qname": "is_adult",         "page_no": 1, "set_to": "/On" },           // for a checkbox use its on_value
  { "qname": "shirt_size",       "page_no": 1, "set_to": "/Medium" }        // must equal one of radio_choices[].set_to
]
```

Every record needs `qname`, `page_no`, and `set_to`. **Omit `set_to` to leave
that field untouched.**

### B.4 Apply

```bash
bash scripts/make.sh fill apply form.pdf values.json filled.pdf
```

The script validates each entry on the fly. Common errors:

- `ERROR: \`<qname>\` is not a known field id` — typo or stale field name.
  Re-check the `inspect` output.
- `ERROR: page_no mismatch` — do not edit `page_no` by hand; use the value from `meta.json`.
- `ERROR: invalid value "..." for checkbox "..."` — use the field's
  `on_value` / `off_value` literal, not strings such as `"true"` / `"false"`.

#### B.4.1 Direct pypdf pattern (skip the wrapper)

When the wrapper isn't usable (custom validation, batch driver, embedded
in a larger script), this is the **only** AcroForm fill pattern that
works on **pypdf ≥ 4.0** (including the current 6.x line). Use it
verbatim — do not invent variants:

```python
from pypdf import PdfReader, PdfWriter

src = PdfReader("form.pdf")

# Clone via PdfWriter(clone_from=...) — preserves the AcroForm tree,
# field appearances, page tree, and metadata in one call. This is the
# constructor pypdf documents; it internally calls
# clone_document_from_reader() for you.
out = PdfWriter(clone_from=src)

# Fill page-by-page. Group your values by page first; the function
# expects {field_name: value} per page, and field names are the
# fully-qualified `qname` from `fill inspect`.
values_by_page = {
    1: {"person.last_name": "Park", "person.first_name": "Joon"},
    2: {"is_adult": "/On"},   # checkbox: pass the on_value literal, not "true"
}
for page_no, values in values_by_page.items():
    out.update_page_form_field_values(
        out.pages[page_no - 1],     # 0-indexed page list
        values,
        auto_regenerate=False,      # we set need_appearances below
    )

# Tell viewers (Adobe Reader / Preview / Chrome) to repaint widget
# appearances on open. Without this, the widget cache shows the OLD
# value even though the PDF dictionary holds the NEW one.
out.set_need_appearances_writer(True)

with open("filled.pdf", "wb") as fh:
    out.write(fh)
```

> **❌ Do not waste turns on these dead ends.** Three deceptively similar
> APIs exist on `PdfWriter` and only one fills AcroForm fields correctly:
>
> | Don't use | Why it fails |
> |---|---|
> | `out = PdfWriter(); out.clone_reader_document_root(src)` | Clones the *page tree only*. AcroForm dictionary is missing → `update_page_form_field_values` finds no widgets → no error, no values written. |
> | Iterating `page["/Annots"]` and patching `/V` directly | Bypasses widget appearance regeneration. Some viewers show the value, others show the cached blank; checkbox state often wrong; field re-validates on the next save. |
> | `out = PdfWriter(); out.append_pages_from_reader(src)` | Same failure as `clone_reader_document_root` — AcroForm tree absent. |
> | Older `pypdf.PdfFileWriter().updatePageFormFieldValues(...)` (pypdf 1.x camelCase) | Removed in 4.x. Will `AttributeError`. |
>
> The single working pattern in pypdf ≥ 4 is `PdfWriter(clone_from=src)` +
> `update_page_form_field_values(...)` + `set_need_appearances_writer(True)`,
> exactly as shown above. **All four dead ends "succeed silently" — the
> PDF saves without error but contains no values.** If your fill
> produces a "saved but empty" PDF, you almost certainly used one of the
> four anti-patterns; switch to the snippet above before retrying
> anything else.

### B.5 Verify

```bash
bash scripts/make.sh fill rasterize filled.pdf verify/
```

Open the PNGs in `verify/` and confirm the values landed where they should.
For multi-page filled outputs, also verify navigation: preserve existing
bookmarks/link annotations, or add packet-level index/outline navigation when
the output is a generated packet. Do not add a visible TOC page to official
forms if changing page count invalidates the form; document that exception.

---

## C. Path 2 — Non-AcroForm (visual overlay)

### C.1 Try structure extraction first

```bash
bash scripts/make.sh fill scan form.pdf layout.json
```

The output JSON contains:

| Key | Meaning |
|---|---|
| `pages` | per-page geometry (`pdf_w`, `pdf_h`) |
| `glyphs` | every text run with `[x0, top, x1, bottom]` |
| `rules` | long horizontal lines (candidate row separators) |
| `ticks` | small square boxes (candidate checkboxes) |
| `bands` | derived row top/bottom pairs |

If `glyphs` contains real text, use the structural data to compute slot
positions. If `glyphs` is empty or full of `(cid:NNN)` placeholders, fall back
to §C.2 (visual).

### C.2 Visual fallback

```bash
bash scripts/make.sh fill rasterize form.pdf preview/
```

Inspect the page images and estimate field rectangles in pixel coordinates.
Use ImageMagick to crop a tighter region around each field when you need
finer placement:

```bash
magick preview/page_1.png -crop 300x80+50+120 +repage crops/name.png
```

(If `magick` is missing, `convert` accepts the same arguments.) Translate
in-crop coordinates back to full-image coordinates by adding the crop offset.

### C.3 Author `fields.json`

The overlay schema is intentionally compact. **Each page may use either PDF
or image coordinates** — the fill script auto-detects which by inspecting the
keys present.

```jsonc
{
  "pages": [
    { "page_no": 1, "pdf_w": 612, "pdf_h": 792 }      // PDF coordinates
    // or:
    // { "page_no": 1, "img_w": 1700, "img_h": 2200 } // image coordinates
  ],
  "slots": [
    {
      "page_no":     1,
      "description": "Last name slot",
      "tag_text":    "Last Name",
      "tag_box":     [43, 63, 87, 73],
      "slot_box":    [92, 63, 260, 79],
      "value":       { "text": "Simpson", "size": 10 }
    },
    {
      "page_no":     1,
      "description": "Yes-citizen checkbox",
      "tag_text":    "Yes",
      "tag_box":     [260, 200, 280, 210],
      "slot_box":    [285, 197, 292, 205],
      "value":       { "text": "X" }
    }
  ]
}
```

**Coordinate convention:** `[left, top, right, bottom]` with the origin in the
**top-left** (the same convention pdfplumber uses for glyphs). The fill script
flips y when it generates the pypdf rectangle.

### C.4 Lint geometry

```bash
bash scripts/make.sh fill lint fields.json
```

The linter catches two classes of problem:

- bounding boxes that overlap on the same page (slot vs slot, slot vs tag)
- slots whose height is smaller than `value.size` (text would be clipped)

Any `FAILURE:` line yields a non-zero exit code. Fix `fields.json` until you
get `SUCCESS:` and exit 0.

### C.5 Preview the overlay (optional)

```bash
bash scripts/make.sh fill rasterize form.pdf preview/
bash scripts/make.sh fill preview 1 fields.json preview/page_1.png preview/page_1_overlay.png
```

Open `page_1_overlay.png` and confirm the red (slot) and blue (tag) rectangles
sit where they should.

### C.6 Stamp the overlay

```bash
bash scripts/make.sh fill overlay form.pdf fields.json annotated.pdf
bash scripts/make.sh fill rasterize annotated.pdf verify/
```

Inspect `verify/` for the final result.

---

## D. Hybrid workflow

When `layout_scan` finds **most** but not all fields (common with circular
checkboxes or unusual decorations):

1. Build a partial `fields.json` from `layout.json` for the detected fields,
   using PDF coordinates (`pdf_w`/`pdf_h`).
2. Use §C.2 cropping to place the missing fields, in image coordinates first.
3. Convert image coordinates to PDF coordinates manually before merging into
   the same `fields.json`:
   - `pdf_x = image_x * (pdf_w / img_w)`
   - `pdf_y = image_y * (pdf_h / img_h)`
4. Use exactly one coordinate system per `pages[]` entry — never mix
   `pdf_w` / `pdf_h` and `img_w` / `img_h` on the same page.
5. Lint -> preview -> overlay -> verify.

---

## E. JSON schema reference

### E.1 AcroForm metadata (`fill inspect` output, also a reference for `fill apply` input)

```jsonc
[
  {
    "qname":     "string",                       // required
    "page_no":   1,                              // required, 1-based
    "box":       [0, 0, 0, 0],                   // [l, b, r, t]
    "type":      "text|checkbox|radio_group|choice|unknown (...)",

    // checkbox extras:
    "on_value":  "string",
    "off_value": "string",

    // radio_group extras:
    "radio_choices": [{"set_to": "string", "box": [0, 0, 0, 0]}],

    // choice extras:
    "choice_options": [{"set_to": "string", "label": "string"}]
  }
]
```

### E.2 AcroForm value config (`fill apply` input)

```jsonc
[
  {
    "qname":   "string",       // required, must match a meta entry
    "page_no": 1,              // required
    "set_to":  "string"        // optional; omit to leave untouched
  }
]
```

### E.3 Overlay config (input to `fill overlay`, `fill preview`, and `fill lint`)

```jsonc
{
  "pages": [
    {
      "page_no": 1,
      // pick exactly one pair per page:
      "pdf_w":   612, "pdf_h": 792,
      "img_w":   1700, "img_h": 2200
    }
  ],
  "slots": [
    {
      "page_no":     1,
      "description": "Free text",        // shown in linter messages
      "tag_text":    "Last Name",
      "tag_box":     [l, t, r, b],
      "slot_box":    [l, t, r, b],
      "value": {
        "text":  "string",
        "size":  14,                       // points
        "face":  "Arial",                  // optional
        "color": "000000"                  // optional, RRGGBB hex
      }
    }
  ]
}
```

---

## F. Quick reference

| Scenario | Recommended verb | One-line example | Notes |
|---|---|---|---|
| Probe AcroForm | `fill probe` | `bash scripts/make.sh fill probe a.pdf` | Prints `acroform=true|false` |
| Enumerate fields | `fill inspect` | `bash scripts/make.sh fill inspect a.pdf meta.json` | Writes JSON metadata |
| Scan layout | `fill scan` | `bash scripts/make.sh fill scan a.pdf layout.json` | Coordinates for the overlay path |
| Render pages | `fill rasterize` | `bash scripts/make.sh fill rasterize a.pdf out/` | 200 dpi, longest edge 1000 px |
| Preview bounding boxes | `fill preview` | `bash scripts/make.sh fill preview 1 fields.json out/page_1.png out/page_1_overlay.png` | Red = slot, blue = tag |
| Lint geometry | `fill lint` | `bash scripts/make.sh fill lint fields.json` | Non-zero exit on failure |
| Apply AcroForm values | `fill apply` | `bash scripts/make.sh fill apply a.pdf values.json filled.pdf` | Validates value legality |
| Stamp overlay | `fill overlay` | `bash scripts/make.sh fill overlay a.pdf fields.json annotated.pdf` | FreeText annotations |

---

## Hard rules

- **Always run `fill probe` first.** AcroForm and overlay paths share no schemas.
- **Treat `fill inspect` output as the source of truth.** Do not invent
  `qname`, `on_value`, or `radio_choices[].set_to`.
- **For AcroForm checkbox / radio fields, write the literal `on_value`** the
  field carries (`/On`, `/Yes`, `/Choice2`, ...) — never `"true"`.
- **Overlay `slot` height must be >= `value.size`** or the text is clipped.
  The linter catches this.

## Typical mistakes

- Writing a `dropdown` / `radio` value that does not appear in the
  `choice_options` / `radio_choices` list. Re-check `fill inspect`.
- Using the legacy `{"FieldName": "value"}` dict form for AcroForm values.
  The new schema is an array `[{qname, page_no, set_to}]`.
- Mixing `pdf_w` / `pdf_h` and `img_w` / `img_h` on the same overlay page.
  Pick one coordinate system per page.
- Skipping `lint` before `overlay`. The linter catches slot overlaps and
  height overflows that ruin the final output.
- **Trying multiple pypdf clone APIs to "find one that works".** There
  is exactly one working pattern in pypdf ≥ 4 (`PdfWriter(clone_from=src)` +
  `update_page_form_field_values(...)` + `set_need_appearances_writer(True)`,
  see §B.4.1). The dead-end APIs (`clone_reader_document_root`,
  direct `/Annots` patch, `append_pages_from_reader`) all *succeed
  silently* and produce a PDF with no values written — there is no
  error to debug. Don't try variants; copy the §B.4.1 snippet.
