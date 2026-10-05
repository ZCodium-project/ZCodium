# Task: CREATE_DOCX

Use this task family when there is no source DOCX that must remain “the same document”.

## Fast path

For creation, do not start with evidence or backend theory. Use this order:

1. normalize the source into a document plan / structured config
2. choose the style family / recipe layer
3. choose backend `D` or `S`
4. write the DOCX
5. run acceptance

If the user intent is obvious, you should be able to start real generation work after step 2.

### Canonical dispatch

```text
Need a new formal DOCX
-> normalize source
-> match recipe family from quick chooser
-> default to D
-> escalate to S only if the graph clearly exceeds CLI surface
-> write
-> run post-write acceptance
```

The generation core that preserves old benchmark quality is:

- `<skill_dir>/references/scenario_a_create.md`
- `<skill_dir>/references/typography_guide.md`
- `<skill_dir>/references/design_principles.md`
- `<skill_dir>/references/cjk_typography.md` when CJK / 公文 / mixed-script quality matters
- `<skill_dir>/scripts/dotnet/MiniMaxAIDocx.Core/Samples/AestheticRecipeSamples*.cs`

These files are not optional background. They are the recipe layer. Pick a family from them before
inventing any formatting values.

## Required inputs

At least one of:
- Markdown / LaTeX / HTML / RST source (must be normalized into a document plan / structured config before write)
- structured config (JSON sections / headings / tables / images / page setup)
- business brief that can be turned into a document plan
- optional template DOCX if style transfer or institutional formatting is needed

## Quick recipe chooser

Use this table first. Only read deeper references after you have a first-match family.

| If the user asks for... | Start here |
| --- | --- |
| report / proposal / executive brief / polished business document | `ModernCorporate` or `ExecutiveBrief` |
| thesis / paper / journal-like / academic deliverable | `AcademicThesis` or the nearest citation-style recipe |
| 公文 / Chinese official / strong CJK formal output | `ChineseGovernment` + `cjk_typography.md` |
| branded but not institutionally templated document | nearest business recipe, then refine with `design_principles.md` |

## Style family / recipe selection

Choose the nearest recipe family before backend arbitration:

| User intent | Recipe family / source |
| --- | --- |
| business report / proposal / executive brief | `AestheticRecipeSamples` -> `ModernCorporate`, `ExecutiveBrief`, `MinimalModern`; spacing / page defaults from `typography_guide.md` |
| academic paper / thesis / journal-like output | `AcademicThesis`, `APA`, `MLA`, `Chicago`, `Springer`, `Nature`; hierarchy and spacing from `design_principles.md` |
| 公文 / Chinese institutional document / strong CJK output | `ChineseGovernment` + `cjk_typography.md` |
| brand / house style without a structural template | nearest recipe family first, then refine with `design_principles.md` / `typography_guide.md` |

If the user gives exact institutional formatting through a template DOCX, reconsider whether the real
route is `APPLY_TEMPLATE`.

Once a family is chosen, use the corresponding recipe/sample values as the default. Do not freestyle
font size, spacing, or page geometry from memory.

## Only if needed before writing

- read source content only if the source is ambiguous and must be normalized into a document plan
- read template structure only if an optional reference template is influencing creation choices
- do not open rendered workflow before writing; rendered truth is normally the post-write gate

## Sub-modes

### CREATE-D
Source is structured config (or normalized text-native input) and fits builtin dotnet CLI creation.

### CREATE-S
Output needs custom OpenXML structure beyond the CLI surface.

### CREATE-H
Source is only a business brief. First produce a document plan, then pick D or S.

`CREATE-H` still must choose a recipe family before backend.

## Backend decision

### Default to D when
- source is structured config
- source started as Markdown / LaTeX / HTML / RST but has been normalized into a document plan or structured config
- output is an institutional or section-aware DOCX that the CLI surface already supports

### Escalate to S when
- the output structure is beyond the builtin dotnet CLI surface

Backend choice happens after recipe choice, not before it.

If both `D` and `S` are plausible, prefer `D` first and escalate to `S` only when the required graph
is clearly beyond CLI surface.

If you are hesitating between `D` and `S`, that is not a reason to stop. Start from `D` unless a
specific structure requirement rules it out.

## Hard no

- Do not force D just because the builtin runtime is .NET-based.
- Do not treat text-native source as permission to route CREATE into pandoc; for formal CREATE_DOCX,
  normalize first, then write through `D` or `S`.
- Do not skip recipe selection and jump straight into OpenXML values from memory.

## After writing

- ordinary creation -> run `normal` acceptance from `acceptance.md`
- multi-section / layout-sensitive creation -> run `strict` acceptance from `acceptance.md`
- if strict applies, rendered acceptance is mandatory after write
