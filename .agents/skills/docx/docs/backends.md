# Execution backends

Read this only after the route is clear. For generation routes, recipe / template-mode choice comes
first; backend arbitration comes second.

Execution is a routing decision, not a personal preference. Choose the backend from input shape and
preservation requirements, not from what feels strongest.

Shared roots:

```bash
# macOS / Linux / WSL
DOCX_ROOT="<skill_dir>"
CLI="dotnet run --project $DOCX_ROOT/scripts/dotnet/MiniMaxAIDocx.Cli --"
```

```powershell
# Windows
$env:DOCX_ROOT = "<skill_dir>"
$CLI = "dotnet run --project $env:DOCX_ROOT\scripts\dotnet\MiniMaxAIDocx.Cli --"
```

## Backend D — builtin dotnet CLI

**Use when**:
- creating DOCX from structured config
- editing an existing DOCX while preserving it as the same document
- placeholder fill, table fill, replace-text, header/footer update
- applying CJK 公文 / 学位论文 / institutional templates
- running builtin analyze / diff / merge-runs / validate / gate-check

**Hard no**:
- pretending it can ingest raw Markdown / LaTeX directly without an explicit normalization step
- pretending it resolves citations or converts bibliography sources by itself

**Gate**:
```bash
# macOS / Linux / WSL
test -d "$DOCX_ROOT" || { echo "FATAL: docx skill root missing" >&2; exit 1; }
bash "$DOCX_ROOT/scripts/env_check.sh" | grep -E "^\[OK\][[:space:]]+dotnet\b" || {
  echo "FATAL: dotnet SDK not available" >&2
  exit 1
}
```

```powershell
# Windows
if (-not (Test-Path $env:DOCX_ROOT)) { Write-Error "FATAL: docx skill root missing"; exit 1 }
$check = & powershell -ExecutionPolicy Bypass -File "$env:DOCX_ROOT\scripts\env_check.ps1" -Level Full
if (-not ($check | Select-String -Pattern '^\[OK\]\s+dotnet\b')) {
    Write-Error "FATAL: dotnet SDK not available"; exit 1
}
```

**Escalation**:
- if the command surface is insufficient but the job is still DOCX-graph work, stop using `D` and reroute to `S`
- if the input is still raw Markdown / LaTeX, stop and normalize it into a document plan / structured config first; do not reroute CREATE to `P`

## Backend S — direct OpenXML SDK

**Use when**:
- the task is structurally beyond the builtin dotnet CLI surface
- you need direct control over `document.xml`, `styles.xml`, `numbering.xml`, header/footer parts,
  comments, fields, or relationships
- you must rebuild a graph, not just call a builtin command

**Hard no**:
- using S because you forgot that P or D already solves the job
- writing SDK code from memory without reading the matching builtin samples first

**Gate**:
Same as `D`, plus read the relevant sample under:

```bash
$DOCX_ROOT/scripts/dotnet/MiniMaxAIDocx.Core/Samples/*.cs
```

## Backend X — local XML patch runtime

**Use when**:
- you need deterministic local XML inspection or low-topology patching
- you need anchor atomicity validation
- you need a patch plan, dry-run, or local unpack/pack flow
- you need to strip direct formatting, merge runs locally, or perform a constrained local replace

**Hard no**:
- section break topology changes
- header/footer graph rewrites
- numbering graph rebuilds
- image relationship insertion or repair
- arbitrary cross-part dependency rewrites

**Gate**:
No heavy toolchain gate. X uses bundled Python scripts only. But it is only valid for operations that
fit the X safety boundary. If topology risk appears, stop using `X` and reroute to `D` or `S`.

## Selection table

For `CREATE_DOCX` / `APPLY_TEMPLATE`, use this table only after recipe family or template mode is already chosen.

| Input shape | Output requirement | Pick |
| --- | --- | --- |
| Markdown / LaTeX / HTML / RST | formal DOCX creation after normalization into document plan / structured config | D |
| Markdown / LaTeX / HTML / RST + complex graph requirements | normalized create, but CLI surface insufficient | S |
| Existing DOCX | content edits preserving styles/headers/sections | D |
| Existing DOCX + institutional template DOCX | template apply / section-aware formatting | D |
| Structured config | create styled DOCX | D |
| Existing DOCX | deterministic local low-risk XML patch | X |
| Any DOCX graph task beyond D surface | byte-level control | S |

## What never happens

- A chosen backend never silently falls back to another backend with a different input contract.
- CREATE_DOCX is never routed to pandoc as a formal generation backend.
- X is never stretched into a fake full OpenXML editor.
- S is never the first instinct when D already matches the task.
