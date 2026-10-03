# form-fill-acroform

> Distilled from reference examples m03 (Italian visa AcroForm fill). **FILL route** — unlike the other
> five CREATE / REFORMAT templates, this one has no HTML/CSS skeleton, only a `field_values.json`
> schema
>
> - a procedural checklist.

## 1. When to use

- **EN keywords**: fill PDF form, acroform, form-fill, visa form, application form, tax form,
  official form, populate PDF form
- **CN keywords**: 填表、填写表单、acroform、签证表、申请表、报税表、PDF 表单填写、自动填表
- **Sample user asks**:
  - "Fill in the Italian visa application from my source documents. Leave blanks for missing data
    and tell me what is missing."
  - "Fill this PDF tax form from the attached documents, report missing fields."

## 2. Pipeline

**FILL route** (separate from CREATE / REFORMAT). Steps:

1. **Probe**: `fill probe target.pdf` — confirm `acroform=true`. Otherwise switch to the overlay
   path.
2. **Inspect**: `fill inspect target.pdf inspect.json` — extract qname / type / on_value /
   radio_choices / box / page_no.
3. Pull the source data (employment letter PDF, itinerary docx, passport photo, financial
   statements, etc.).
4. Build a field-mapping + transform table: date `DD-MM-YYYY`, name -> uppercase pinyin, phone
   normalisation, etc. If the task is an Italian / Schengen visa form filled from Chinese employment
   certificate + itinerary, load the progressive case first:
   `../../../docs/italy-schengen-visa-acroform-case.md` and copy-edit
   `cases/italy-schengen-visa-example/field_values.case.json`.
5. Validate: maxlen / required / format constraints.
6. Write into the AcroForm using **qname for primary lookup + `page_no` for a second check** (do
   **not** match by widget short name only — same-name widgets collide).
7. Report missing fields + SHOWSTOPPER items.

Why AcroForm instead of visual overlay: government PDFs require machine-readable / searchable field
values; the bulk-write API keyed by short name writes through the same parent name to multiple
children, polluting unrelated fields (in m03 the literal `"Other"` appears across several questions
— that was the biggest pitfall). The `qname` emitted by `fill inspect` is a fully qualified name
(with parent path), so identical short names under different parents resolve to different qnames and
disambiguate themselves.

## 3. Document shape

- **Pages**: 3-20 (depending on the visa / tax form).
- **Field types**: text (Tx), checkbox (Btn), radio_group (Btn group), choice (Ch), signature
  (visual-only, NOT in the AcroForm).
- **Same-name widget collisions**: government forms often reuse short names across pages (`Other`
  appears in marital status + travel purpose; `Valid until` appears in passport expiry + residence
  permit expiry). **The `qname` from `inspect` already includes the parent prefix**, so it
  self-disambiguates. If two fields share both short name and parent (rare), `page_no` is the second
  guard — `apply` rejects writes whose `page_no` does not match the inspect record.

## 4. Visual / format params (FILL-specific, not visual)

- **Date format**: `DD-MM-YYYY` (EU visas) / `YYYY-MM-DD` (US tax) — check the form first.
- **Name format**: ALL CAPS + pinyin (Chinese characters in a Latin-only AcroForm field render as
  missing glyphs / FontBBox issues).
- **Text field**: respect `maxlen`; if the value is longer, truncate to `maxlen-1 + "..."` and warn
  the user.
- **Checkbox**: `on_value` varies (`/Yes` / `/No` / `/X` / `/1` / `/2` / `/Off`) — always look up
  the literal in the inspect output's `on_value` field. **Never write `"true"` or `"checked"`
  literals.**
- **Multiline**: separate with `\n` (do not use `;` or `, `).
- **Visual-only frames** (signature blocks, photo boxes, handwritten date lines): **not** AcroForm
  fields. **Do not try to fill them**; list them in `missing_required` so the user can do them by
  hand.

## 5. Skeleton

See [`field_values.template.json`](field_values.template.json) (action template schema) + the
procedure below.

The template's `writes` array carries metadata per record (source / transform / maxlen / validation
/ ...) so the LLM can self-track. `fill apply` reads only `qname` / `page_no` / `set_to` and ignores
the rest.

**Procedure** (run in order; every command from the skill root):

```bash
SKILL=packages/local-runtime/assets/skills/pdf

# 1. Probe.
bash $SKILL/scripts/make.sh fill probe target.pdf
# Expect acroform=true. Otherwise switch to the overlay path.

# 2. Inspect field metadata.
bash $SKILL/scripts/make.sh fill inspect target.pdf /tmp/fill/inspect.json
# Read: qname total / type / on_value / radio_choices[].set_to / page_no.

# 3. Build field_values.json from inspect.json.
cp $SKILL/templates/form-fill-acroform/field_values.template.json /tmp/fill/field_values.json
# Populate with source data + transform rules
# (each entry must carry qname / page_no / type / set_to / source).

# 4. Same short-name disambiguation: the qname from inspect already includes
#    the parent path, which is enough for the common case.
python3 -c "
import json
fields = json.load(open('/tmp/fill/field_values.json'))['writes']
keys = [(f['page_no'], f['qname']) for f in fields]
assert len(keys) == len(set(keys)), 'Warning: duplicate (page_no, qname) — same-parent collision unresolved'
"

# 5. Visual-only fields: list under missing_required (do not feed apply).

# 6. Extract the apply payload — apply only consumes the three core fields.
jq '.writes | map({qname, page_no, set_to})' \
  /tmp/fill/field_values.json > /tmp/fill/values.json

# 7. Apply.
bash $SKILL/scripts/make.sh fill apply target.pdf /tmp/fill/values.json /tmp/fill/filled.pdf
# apply validates: unknown qname / page_no mismatch / illegal checkbox / radio /
# choice values are rejected with an error and a non-zero exit code.

# 8. Visual verification.
bash $SKILL/scripts/make.sh fill rasterize /tmp/fill/filled.pdf /tmp/fill/preview/
# Open preview/page_*.png and spot-check text / checkbox marks.

# 9. Emit USER-FINAL-SUMMARY.md (alongside the PDF).
# Include: filled count / missing SHOWSTOPPERs / visual-only manual items / usage notes.
```

## 6. Pitfalls (from m03 production)

- **Same-name widget collision** — fatal: in the Italian visa form, `Other` appears in both Q9
  (marital status) and Q21 (travel purpose); `Valid until` appears in both Q15 (passport) and Q18
  (residence permit). **The `qname` from `fill inspect` already prefixes the parent path** so most
  cases are auto-disambiguated; `apply` adds a `page_no` second check, so a write to the wrong page
  is rejected.
- **Checkbox on_state varies per form**: some use `/1` `/2` `/3`, others `/Yes` `/No` `/X`, others a
  custom literal. **Copy `on_value` / `off_value` directly from the inspect output**, never `"true"`
  / `"checked"`.
- **Multiline must check /Ff bit 13** (0x1000 / 4096): multiline fields (employer, inviter, address)
  honor `\n` only when `/Ff` has bit 13 set. Without it the literal `\n` is rendered.
- **After writing /V you must drop /AP**: PDF viewers cache the appearance stream. Until you
  regenerate it, the viewer keeps showing the stale value. `fill apply` defaults
  `/NeedAppearances=true`, which most viewers honor.
- **Date format mismatch**: source `YYYY-MM-DD`, target `DD-MM-YYYY` (EU) or `MM/DD/YYYY` (US).
  **Always transform — never paste raw.**
- **Name field font substitution failure**: Chinese characters in a Latin-only PDF font (FontBBox
  subset) render blank. **Always use uppercase pinyin.**
- **maxlen silent truncation**: an oversize value does not raise; it silently truncates.
  **Pre-validate maxlen, truncate to `maxlen-1 + "..."`, and warn.**
- **Placeholder pollution**: source documents often carry template placeholders (`+86-138-0000-1234`
  with four zeros, `@email.com` fake domain, `HTL-001` template booking number). **Detect and leave
  blank, then report to the user.**
- **Visual-only frames are not AcroForm fields**: signatures / photos / handwritten date lines exist
  visually in the PDF without `/T` or `/FT`. **The script cannot fill them.** Record their
  coordinates and add them to `missing_required`.

## 7. Generalization

**Required**:

- The target form PDF + extracted widget roster (via `fill inspect`).
- Source data files (PDF / DOCX / JSON / image OCR) + extraction rules.
- Field-mapping table: (source field -> target acroform qname) + transform rules.

**Optional**:

- Pre-filled defaults (recursive forms — keep the last filled `field_values.json` as a template).
- Multi-language sources (translate first, or keep the source language if the form allows).

**Structural invariants**:

- `_meta` block: form_id / widget_total / source_pdf / comments (justify hard rules).
- Each `writes[]` entry must carry (qname, page_no, type, set_to, source, validation).
- `missing_required[]` must enumerate every required-but-not-filled field + reason.
- `USER-FINAL-SUMMARY.md` is a required deliverable (not optional).
- Always run jq to extract the core fields before `apply`; if `apply` fails, cross-reference
  inspect.json to find the bad qname.

**Swappable**:

- Form type (visa / tax / employment / school admission / government registration / mortgage /
  insurance / ...).
- Source file types (PDF / DOCX / XLSX / JSON / YAML / image OCR / web form screenshot).
- Target language (EN / ZH / JP / KR / FR — naming conventions and AcroForm structure shift
  accordingly).
- Transform rules (date / name / phone / address / currency / ...).
- maxlen handling (truncate / warn / reject).

**Re-derive per form; do not template the mapping.** Every government or institutional form has its
own qname conventions, language quirks, required-field rules, and `on_state` literals. Re-run
`fill inspect` and rebuild `field_values.json` from the resulting roster every time — never paste a
mapping table from a previous form unless it is provably the same form (same `form_id` in `_meta`).

**Boundary with CREATE / REFORMAT**:

- **CREATE**: build a layout from scratch (HTML/CSS or blank PDF). The user designs the visual.
- **REFORMAT**: re-organise an existing visual (resize / reorder / restyle). The user changes the
  appearance.
- **FILL**: insert values into a predefined AcroForm. The user **cannot** move fields or change the
  layout; the focus is data extraction, transform, and error reporting.
