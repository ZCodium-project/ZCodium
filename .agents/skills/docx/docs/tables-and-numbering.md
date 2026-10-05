# Tables and numbering

These are high-risk structures. Treat them as such.

## Tables

Local row fill is safe only when:
- row topology is simple
- no relationship insertion is required
- no complex vertical/horizontal merge logic has to be rebuilt

Escalate to `D` or `S` when:
- merged cells matter
- repeated header rows matter
- shading/borders/grid logic must be preserved precisely
- template transfer contaminates cell-local paragraph/run formatting

## Numbering

Numbering is not just visible numerals. It is a graph between `num` and `abstractNum` definitions.

Local patching is unsafe when:
- numbering definitions must be rebuilt or remapped
- section restarts interact with page-number systems
- heading numbering and TOC behavior must stay aligned

Use the bundled references and validators in this skill when numbering changes are part of the task.
