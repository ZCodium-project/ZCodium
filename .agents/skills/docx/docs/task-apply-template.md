# Task: APPLY_TEMPLATE

Use this task family when source content should survive but the visual or institutional template
system changes.

## Fast path

For template work, do not treat the job as a generic forensic waterfall. Use this order:

1. choose template mode
2. align the target visual system to the style family / recipe layer
3. read just the structure needed to execute that mode safely
4. choose backend `D` or `S`
5. write the output
6. run strict rendered acceptance

If the template mode is obvious, real template work should begin after step 3.

### Canonical dispatch

```text
Need this content to become that template system
-> choose template mode
-> align recipe family
-> read only the structure required by that mode
-> default to D
-> escalate to S only if structural transfer clearly exceeds CLI surface
-> write
-> run strict post-write rendered acceptance
```

The generation core that must stay active here is:

- `<skill_dir>/references/scenario_c_apply_template.md`
- `<skill_dir>/references/typography_guide.md`
- `<skill_dir>/references/design_principles.md`
- `<skill_dir>/references/cjk_typography.md` when CJK / 公文 / thesis formatting is involved
- `<skill_dir>/scripts/dotnet/MiniMaxAIDocx.Core/Samples/AestheticRecipeSamples*.cs`

Template work is not “style by vibes”. Use these to anchor the visual system before backend work.

## Required inputs

- source `.docx` or text-native source, depending on template mode
- template `.docx`
- a template mode decision

## Quick alignment chooser

Use this table first. Only read deeper references after you have the nearest alignment family.

| If the template looks like... | Start here |
| --- | --- |
| school / thesis / dissertation template | `AcademicThesis` family + institutional structure preservation |
| 公文 / Chinese government / strong CJK official template | `ChineseGovernment` + `cjk_typography.md` |
| corporate / branded business template | `ModernCorporate` / `ExecutiveBrief` |
| reference sample with no structural authority | nearest family by visual intent, then treat as `reference_style_only` |

## Style family / recipe alignment

After template mode is chosen, align the template target to a recipe family instead of inventing raw
values from scratch:

| Situation | Alignment rule |
| --- | --- |
| school / thesis / institutional template | preserve the template’s structural zones, then align heading / body / spacing expectations to the nearest academic or institutional recipe family |
| 公文 / government / strong CJK template | `ChineseGovernment` + `cjk_typography.md` is the baseline; template XML can override only where the template explicitly proves it |
| corporate / branded template | align to `ModernCorporate` / `ExecutiveBrief` / closest recipe, then preserve template-specific colors / sections / headers |
| reference-style-only template | treat the template as style intent, map it to the nearest recipe family, then generate through `D` or `S` |

Once alignment is chosen, preserve template-proven structure first and use recipe values for the parts
the template does not specify clearly.

## Template modes

### `reference_style_only`
Source is text-native, but the final formal DOCX still must be produced through `D` after
normalization into a document plan / structured config. Treat the template as style intent, not as a
pandoc route.

### `overlay_styles`
Source is DOCX and the template mainly supplies style system, not structural zones.

### `base_replace`
Template is the skeleton. Output starts from the template and replaces example content with source
content.

### `institutional_multi_section`
Template controls cover / TOC / abstract / body / page numbers / titlePg / per-section
headers/footers. This is the strictest mode.

If `institutional_multi_section` is chosen, recipe alignment still matters for typography and spacing,
but structure preservation outranks cosmetic simplification.

## Only if needed before writing

- read source/template structure only to the extent required by the chosen template mode
- inspect template rendered output only when structure alone cannot explain the template’s visual system
- do not open output rendered workflow before the write step; rendered acceptance comes after write

Template work without the needed structure read is blind. Template work without post-write rendered
verification is unfinished.

## Backend decision

### Default to D when
- source is text-native but has been normalized into a document plan / structured config and the
  template mainly supplies style intent
- source is DOCX and template carries institutional or multi-section structure
- source is DOCX and even “style overlay” still needs in-place preservation

### Escalate to S when
- the template transfer is structurally beyond D

Backend choice happens after template mode + recipe alignment, not before them.

If both `D` and `S` are plausible, prefer `D` first and escalate to `S` only when the structural
transfer clearly exceeds CLI surface.

If you are hesitating between `D` and `S`, that is not a reason to stop. Start from `D` unless a
specific structural transfer requirement rules it out.

## Hard no

- Never apply a structural template by pretending it is only a reference-doc style transfer.
- Never deliver template work without rendered acceptance.
- Never assume placeholders are stable; validate anchors first if the template uses anchors.
- Never skip recipe alignment and improvise typography values from memory.

## Deep references

Reuse the bundled template knowledge under:
- `<skill_dir>/references/scenario_c_apply_template.md`
- `<skill_dir>/references/typography_guide.md`
- `<skill_dir>/references/design_principles.md`
- `<skill_dir>/references/cjk_typography.md`
- `<skill_dir>/scripts/dotnet/MiniMaxAIDocx.Core/Samples/*.cs`

## After writing

Run `strict` acceptance from `acceptance.md`.
