# recalc-guide — `scripts/recalc.py` reference

> Detailed reference for the only wrapped script in this skill —
> `scripts/recalc.py`, which drives LibreOffice headless to recompute every
> formula in a workbook and then walks the result with openpyxl looking for
> the seven Excel error markers. The minimal "what to type" lives in
> [`SKILL.md`](../SKILL.md) §4.1; this file is the place for the macro path,
> JSON schema, AF_UNIX shim, cross-platform timeout, and the offline
> alternatives.

## 1. Command

```bash
python scripts/recalc.py <workbook> [timeout_seconds]
```

`workbook` is positional; `timeout_seconds` is optional and defaults to 60.
Exit codes:

| Code | Meaning |
|---|---|
| `0` | LibreOffice ran to completion. The JSON on stdout decides success vs `errors_found` vs hard error. |
| non-zero | The wrapper itself failed (LibreOffice missing, file unreadable, timeout exceeded). The JSON on stdout will be `{"error": "..."}`. |

The wrapped soffice invocation already saves the recalculated values back
to the input path — there is no `--out` flag and no temp file dance.

## 2. JSON output schema

Three shapes, exactly one of which appears on stdout per run.

### 2.1 Success path

```json
{
  "status": "success",
  "total_errors": 0,
  "total_formulas": 42
}
```

### 2.2 `errors_found` path

```json
{
  "status": "errors_found",
  "total_errors": 4,
  "total_formulas": 42,
  "error_summary": {
    "#REF!": {
      "count": 2,
      "locations": ["MAU_Forecast!B5", "MAU_Forecast!C10"]
    },
    "#DIV/0!": {
      "count": 2,
      "locations": ["Assumptions!E3", "Assumptions!E4"]
    }
  }
}
```

`locations` is capped at 20 per error class; if the class has more, the
list is truncated and `count` reflects the full total.

### 2.3 Hard-error path

```json
{
  "error": "soffice timed out after 60 seconds"
}
```

Downstream callers should branch on `error` first (short-circuit on hard
failure) and only then on `status`.

## 3. The seven Excel error classes

Alphabetical, matching the tokens scanned in `scripts/recalc.py`:

| Marker | Diagnosis | First fix |
|---|---|---|
| `#DIV/0!` | Denominator evaluated to zero (or empty) | Wrap with `IFERROR(num/denom, 0)` or `IF(denom=0, "", num/denom)`; verify the upstream feed is not zero-padded |
| `#N/A` | Lookup target missing in `VLOOKUP` / `MATCH` / `XLOOKUP` | Check key whitespace, case, type (`123` vs `"123"`); confirm the lookup column is contiguous |
| `#NAME?` | Function name typo or missing add-in | Check spelling (`SUMM` / `VLOKUP`); LibreOffice ships add-ins separately from MS Excel |
| `#NULL!` | Range intersection is empty (a literal space was used between two ranges) | Replace the space with a comma or colon; run `recalc.py` again to confirm |
| `#NUM!` | Numeric out of bounds (`LOG(-1)`, IRR not converging, integer overflow) | Inspect the function args; clamp or use `IFERROR` for known boundary cases |
| `#REF!` | A referenced cell or sheet was deleted | Search the workbook for the broken reference; never bulk-delete columns without first running `Find: =` to enumerate dependents |
| `#VALUE!` | Type mismatch (text where a number is expected, or vice versa) | Coerce with `VALUE()` / `TEXT()`; for batch fixes set `engine="openpyxl"` and convert the column with pandas before resaving |

Each class only ever appears in `error_summary` if at least one cell on
the sheet contains the literal marker — recalc cannot infer "this looks
like it might be wrong" beyond the seven tokens.

## 4. LibreOffice macro install

`recalc.py` ships a tiny LibreOffice Basic module that wraps
`ThisComponent.calculateAll() + store() + close(True)`. On the first run
the script writes the module to the user profile and never touches it
again:

| Platform | Path |
|---|---|
| Linux | `~/.config/libreoffice/4/user/basic/Standard/Module1.xba` |
| macOS | `~/Library/Application Support/LibreOffice/4/user/basic/Standard/Module1.xba` |

The XML payload is byte-fixed inside `recalc.py` — keep it untouched.
LibreOffice resolves the macro by literal name (`Standard.Module1
.RecalculateAndSave`); any rename breaks the call site.

If the macro file already exists with the expected XML, `install_recalc
_basic()` is a no-op — safe to re-run.

## 5. Cross-platform timeout

`recalc.py` wraps the soffice command with the platform-specific timeout
binary so a hung LibreOffice never blocks the caller forever:

| Platform | Wrapper |
|---|---|
| Linux | `timeout <sec> soffice ...` (`coreutils` is always present) |
| macOS with `coreutils` | `gtimeout <sec> soffice ...` (`brew install coreutils`) |
| macOS without `coreutils` | no wrapper; the wall-clock timeout falls back to `subprocess.run(timeout=…)` |

The third path still terminates the soffice process tree, but the JSON
on stdout is the Python wrapper's `{"error": "..."}` rather than a
`gtimeout`-style 124 exit code. If you parse the timeout reason
upstream, branch on the JSON, not the exit code.

## 6. AF_UNIX sandbox shim (`scripts/office/soffice.py`)

LibreOffice opens an internal AF_UNIX socket pair to coordinate the
headless backend with the Basic interpreter. Some sandboxed
environments deny AF_UNIX entirely:

- macOS App Sandbox (Mavis daemon spawned from a sandboxed parent)
- Linux containers with seccomp filters that block `socket(AF_UNIX,...)`

`office/soffice.py::get_soffice_env()` probes for the restriction (one
quick `socket.socket(AF_UNIX, SOCK_STREAM)` attempt) and, if blocked,
compiles a small C shim into `/tmp/lo_socket_shim.so` and sets
`LD_PRELOAD` on the env it returns. The shim intercepts `socket(AF_UNIX,
...)` and serves it from a `socketpair()` instead — transparent to
LibreOffice.

```python
from office.soffice import get_soffice_env
import subprocess

env = get_soffice_env()                      # already includes LD_PRELOAD if needed
subprocess.run(["soffice", "--headless", ...], env=env)
```

`recalc.py` calls `get_soffice_env()` for you. Direct callers
(unoserver, custom batch wrappers) should do the same so a single code
path works on every host.

The compiled `.so` is cached. **Do not edit the C source** in
`soffice.py` — the file's bytes are part of the cache key, and any whitespace
change invalidates a working shim on a sandboxed machine.

## 7. Alternative — `unoserver`

Long-running batch jobs (hundreds of workbooks per hour) can swap
`soffice` for [`unoserver`](https://github.com/unoconv/unoserver), a
daemon that keeps a single LibreOffice process alive and accepts requests
over UNO's socket protocol.

| Tradeoff | `soffice` per call (default) | `unoserver` daemon |
|---|---|---|
| Memory | Released after each call | ~250 MB resident permanently |
| Cold start | 1.5–3 s per call | None after first start |
| Concurrency | Serial unless you orchestrate | Pool inside the daemon |
| Setup | Zero | `pip install unoserver` + systemd unit / launchd plist |

The default in this skill stays `soffice` because it is zero-config and
reproducible across machines. Switch to `unoserver` only when the
per-call cold start dominates the workload.

## 8. Alternative — `xlcalculator` / `formulas` (pure Python)

In environments where LibreOffice cannot be installed (CI containers,
serverless, Apple Silicon hosts without the cask), pure-Python
calculators can recompute a subset of Excel functions:

| Library | Coverage | Notable gaps |
|---|---|---|
| [`xlcalculator`](https://github.com/bradbase/xlcalculator) | ~140 of the most common functions (math, stats, lookup, text, date) | Array formulas, pivot tables, data validation, custom functions |
| [`formulas`](https://github.com/vinci1it2000/formulas) | Wider function set, dependency-graph based | Slower on large workbooks; charts and conditional formatting unsupported |

```python
from xlcalculator import ModelCompiler, Evaluator

compiler = ModelCompiler()
model = compiler.read_and_parse_archive("model.xlsx")
evaluator = Evaluator(model)
print(evaluator.evaluate("MAU_Forecast!D2"))
```

Use these as **CI fallbacks** — for delivery, always rerun
`scripts/recalc.py` on a host with LibreOffice so the cached values
match what reviewers see when they open the file in Excel.

## 9. LibreOffice → openpyxl mergeCell roundtrip caveat

LibreOffice's `calculateAll() + store()` cycle aggressively materialises
implicit merged regions into explicit `<mergeCell>` elements — a 22-sheet
input with four merged regions has been observed to come back with 200+,
some with `ref` attributes that openpyxl's `CellRange` parser cannot
read. The `_scan_for_errors` path then dies with a bare
`TypeError: expected <class 'int'>` at
`openpyxl.descriptors.base._convert`, even though LibreOffice itself
exited `0` and the recalculated values are correctly persisted on disk.

`scripts/recalc.py` handles this transparently:

1. It tries `_scan_for_errors` (openpyxl) first.
2. If that raises `TypeError` or `ValueError`, it falls back to
   `_scan_for_errors_via_xml`, which walks the `.xlsx` zip directly with
   `zipfile + xml.etree.ElementTree`. The XML scan does the same job —
   count `<f>` elements as formulas, look for the seven error tokens in
   `<v>` cached values — without touching merged-cell parsing.
3. The JSON shape is identical to §2 with one extra field:

```json
{
  "status": "success",
  "total_errors": 0,
  "error_summary": {},
  "total_formulas": 5,
  "warning": "openpyxl could not parse the post-recalc workbook (expected <class 'int'>); verified via raw XML scan instead. LibreOffice did complete the recalculation."
}
```

Callers should treat the verdict as authoritative regardless of which
scanner produced it; the `warning` field is informational only — there
is no need to retry or escalate. If both scanners fail (rare), the
script returns `{"error": "..."}` listing both failure reasons.

The fallback exists because LibreOffice's mergeCell rewrites are
non-deterministic across versions; the right place to absorb them is
inside `recalc.py`, not in every downstream caller.

**Downstream readers are still affected.** The fallback patches
`recalc.py` itself, but a *caller* who later does
`load_workbook(path)` on the same post-recalc file will hit the same
`TypeError`. Open with `load_workbook(path, read_only=True,
data_only=True)` instead — the streaming reader bypasses the merged-cell
parser and returns cached values directly. When you also need formula
strings (or want to inspect the zip without instantiating openpyxl
objects), use the raw-XML pattern in
[`docs/create-edit-guide.md`](create-edit-guide.md) §11.

## 10. Non-standard XLSX compatibility fallback

Some real-world workbooks (observed in formula-summary / Starbucks-style
workbooks) contain package metadata that openpyxl parses strictly but Excel and
LibreOffice tolerate: expanded `mergeCell` refs, chart/drawing relationship
quirks, styles/number-format oddities, or vendor-generated XML. In these cases,
`recalc.py` must not crash after LibreOffice has already recalculated the file.

Current behavior:

1. LibreOffice recalculates and saves the workbook.
2. `recalc.py` tries the normal openpyxl scanner.
3. **Any openpyxl parse failure** falls back to raw worksheet XML scanning.
4. The fallback ignores charts/drawings/styles/merged-cell objects and only
   verifies what recalc needs: cached error tokens and `<f>` formula nodes.

Fallback JSON includes extra diagnostic fields:

```json
{
  "status": "success",
  "total_errors": 0,
  "error_summary": {},
  "total_formulas": 42,
  "scanner": "raw_xml_fallback",
  "openpyxl_error_type": "TypeError",
  "openpyxl_error": "expected <class 'int'>",
  "compatibility_hint": "openpyxl failed while parsing merged-cell metadata ... do not retry blindly ..."
}
```

Agent rule:

- Treat `status: success` or `errors_found` from `scanner: raw_xml_fallback` as
  authoritative for formula/error verification.
- Do **not** retry the same command blindly just because openpyxl complained.
- If downstream code must read values after such a warning, prefer
  `load_workbook(path, read_only=True, data_only=True)` or raw XML inspection.
- If downstream code must preserve charts/merged cells/styles, avoid saving the
  workbook with openpyxl unless you have a separate round-trip verification.
- If both openpyxl and raw XML fallback fail, inspect with
  `scripts/office/unpack.py` and resave the workbook with Excel/LibreOffice.

