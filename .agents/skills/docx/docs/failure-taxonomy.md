# Failure taxonomy

Use this doc when a DOCX task fails. Diagnose the failure class first; do not immediately switch
backend or guess at a fix.

## 1. Input failures

Examples:
- source file missing
- template file missing
- malformed instruction
- unsupported input format
- backend toolchain missing

Recovery:
- stop and report the missing requirement
- do not switch backend just because a tool is absent

## 2. Template failures

Examples:
- anchor split across runs
- duplicate anchors where uniqueness was assumed
- template manifest and actual template disagree
- required styleId missing
- section topology of template not understood

Recovery:
- run anchor verification or manifest validation
- fix the template / manifest mismatch before mutation

## 3. XML / graph failures

Examples:
- invalid element order
- missing required child
- broken rel target
- id collision
- orphaned comment or footnote ref

Recovery:
- if builtin validator can repair order, try builtin fix-order path
- if topology is complex, reroute to `S`

## 4. Rendered failures

Examples:
- extra blank page introduced
- header/footer visually lost
- page numbers reset incorrectly
- table collapsed across pages
- image missing or overflowed

Recovery:
- rerender
- inspect structure cause
- patch with `D` or `S`
- rerender again before declaring success

## 5. Routing failures

Examples:
- wrong task family chosen
- wrong evidence type trusted
- wrong backend chosen for preservation requirement
- missing acceptance profile
- raw Markdown / LaTeX was sent directly into CREATE without normalization

Recovery:
- restart from `router.md`
- do not “patch over” a bad route with ad-hoc edits
