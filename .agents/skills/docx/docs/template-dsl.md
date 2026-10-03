# Template DSL

This skill does not rely on ad-hoc placeholder folklore. It uses explicit anchors and optional template
manifests.

## Anchor forms

Recommended anchors:
- `@@FIELD:name@@`
- `@@FIELD:date@@`
- `@@BLOCK:intro@@`
- `@@TABLE:items@@`
- `@@IMAGE:logo@@`
- `@@RICH:summary@@`

## Rules

- anchors should live in a single `w:t` node whenever possible
- anchors should not cross runs or paragraphs
- table repetition should use structural row cloning, not Jinja-style inline loop syntax
- if atomicity fails, either normalize runs safely or reject the template as unsafe for automated fill

## Template manifest

A template manifest is a JSON description of:
- template mode
- required sections
- expected style IDs
- anchor rules
- validation profile

See `../references/sample-template-manifests.json` for example structure.
