#!/usr/bin/env bash
# make.sh — pdf unified CLI (HTML → PDF)
# Usage: bash make.sh <command> [options]
#
# Commands:
#   check                          Verify all dependencies
#   fix                            Auto-install missing dependencies
#   render --in page.html --out report.pdf [--wait 15000] [--format A4] ...
#                                  CREATE: render any HTML file/URL → PDF
#   reformat --input doc.md --out report.pdf [--title T] [--accent #HEX] ...
#                                  REFORMAT: parse markdown/text/pdf → HTML → PDF
#   fill   <subcommand> [args...]  FILL: probe / inspect / apply (AcroForm)
#                                        scan / rasterize / preview / overlay / lint (visual)
#
# For READ / extract existing PDFs, see docs/read-guide.md (pdfplumber default,
#   scripts/read_pdf_vision.py for vision escalation).
# For PDF mutation (merge / split / rotate / watermark / annotate), see
# docs/advanced-reference.md (qpdf / pypdf / reportlab cookbook).
#
# Exit codes: 0 success, 1 usage error, 2 dep missing, 3 runtime error

set -euo pipefail
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPTS/.." && pwd)"
PY="${PYTHON:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo python3)}"

# ── Colour helpers ─────────────────────────────────────────────────────────────
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

# ── Minimum versions (single source of truth for `check` and `fix`) ───────────
PY_MIN="3.9"
NODE_MIN_MAJOR=18
PYPDF_MIN="3.0"
MARKDOWN_IT_MIN="3.0"

# Compare two dotted versions A and B; succeed iff A >= B.
ver_ge() {
  $PY - "$1" "$2" <<'PYEOF'
import sys
def parts(v):
    out = []
    for chunk in v.split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        out.append(int(digits) if digits else 0)
    return out
a, b = parts(sys.argv[1]), parts(sys.argv[2])
n = max(len(a), len(b))
a += [0] * (n - len(a))
b += [0] * (n - len(b))
sys.exit(0 if a >= b else 1)
PYEOF
}

# Print "OK <label> <version> (>= <min>)" or set ok=false and warn.
# Args: <import-name> <pretty-label> <min-version> [optional]
py_pkg_check() {
  local import_name="$1" label="$2" min="$3" optional="${4:-}"
  if ! $PY -c "import importlib, sys; m=importlib.import_module('$import_name'); v=getattr(m,'__version__','0'); print(v)" 2>/dev/null >/tmp/.pdfgen_ver; then
    if [[ "$optional" == "true" ]]; then
      yellow "  WARN $label not installed (optional)"
    else
      yellow "  MISSING $label (run: bash make.sh fix)"
      ok=false
    fi
    return
  fi
  local ver
  ver="$(cat /tmp/.pdfgen_ver)"
  if ver_ge "$ver" "$min"; then
    green "  OK $label $ver (>= $min)"
  else
    red "  FAIL $label $ver is below required $min"
    ok=false
  fi
}

# ── check ──────────────────────────────────────────────────────────────────────
cmd_check() {
  local ok=true
  bold "Checking dependencies..."

  # Python interpreter + version gate
  if ! command -v $PY &>/dev/null; then
    red "  MISSING python3 not found"
    ok=false
  else
    local py_ver
    py_ver=$($PY -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null || echo "?")
    if ver_ge "$py_ver" "$PY_MIN"; then
      green "  OK python3 $py_ver (>= $PY_MIN) at $(command -v $PY)"
    else
      red "  FAIL python3 $py_ver is below required $PY_MIN"
      ok=false
    fi
    # pip must be importable so 'fix' can do its job
    if $PY -m pip --version &>/dev/null; then
      local pip_ver
      pip_ver=$($PY -m pip --version 2>/dev/null | awk '{print $2}')
      green "  OK pip $pip_ver"
    else
      yellow "  WARN pip not importable from $PY (try: $PY -m ensurepip)"
      ok=false
    fi
  fi

  # Python packages — pypdf is needed by fill/, markdown-it-py by reformat
  py_pkg_check pypdf       "pypdf"          "$PYPDF_MIN"
  py_pkg_check markdown_it "markdown-it-py" "$MARKDOWN_IT_MIN"

  # Node.js + version gate
  if command -v node &>/dev/null; then
    local node_ver node_major
    node_ver=$(node --version 2>&1 | sed 's/^v//')
    node_major=${node_ver%%.*}
    if [[ "$node_major" -ge "$NODE_MIN_MAJOR" ]]; then
      green "  OK node v$node_ver (>= v$NODE_MIN_MAJOR)"
    else
      red "  FAIL node v$node_ver is below required v$NODE_MIN_MAJOR"
      ok=false
    fi
  else
    red "  MISSING node not found - HTML rendering unavailable"
    ok=false
  fi

  # Playwright (resolved either locally or globally)
  if node -e "require('playwright')" 2>/dev/null || \
     node -e "require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright')" 2>/dev/null; then
    green "  OK playwright"
  else
    yellow "  WARN playwright not found  (run: bash make.sh fix)"
    ok=false
  fi

  # pdfinfo / qpdf are nice-to-have for verification & mutation
  if command -v pdfinfo &>/dev/null; then green "  OK pdfinfo $(pdfinfo -v 2>&1 | head -1 | awk '{print $NF}')"
  else yellow "  WARN pdfinfo not found (brew install poppler) — only used for verification"; fi
  if command -v qpdf &>/dev/null; then green "  OK qpdf $(qpdf --version | head -1 | awk '{print $NF}')"
  else yellow "  WARN qpdf not found (brew install qpdf) — only used for advanced PDF mutation"; fi

  if $ok; then
    green ""
    green "All required dependencies satisfied."
    exit 0
  else
    yellow ""
    yellow "Some dependencies are missing or below the supported minimum."
    yellow "Run: bash make.sh fix"
    exit 2
  fi
}

# ── fix ────────────────────────────────────────────────────────────────────────
cmd_fix() {
  bold "Installing missing dependencies..."
  local rc=0

  if ! command -v $PY &>/dev/null; then
    red "  python3 not found - install Python $PY_MIN+ first"
    exit 2
  fi
  if ! $PY -m pip --version &>/dev/null; then
    red "  pip is not importable from $(command -v $PY)"
    yellow "  Try: $PY -m ensurepip --upgrade"
    exit 2
  fi

  # Python packages
  local pip_log
  pip_log=$(mktemp -t pdfgen-pip.XXXXXX)
  local pip_specs=("pypdf>=$PYPDF_MIN" "markdown-it-py>=$MARKDOWN_IT_MIN")
  bold "  Running: $PY -m pip install ${pip_specs[*]}"
  if $PY -m pip install --break-system-packages -q "${pip_specs[@]}" >"$pip_log" 2>&1 \
     || $PY -m pip install -q "${pip_specs[@]}" >"$pip_log" 2>&1; then
    green "  OK Python packages installed (pypdf, markdown-it-py)"
  else
    yellow "  pip install failed -- last 20 lines of output:"
    tail -20 "$pip_log" | sed 's/^/    /'
    rc=3
  fi
  rm -f "$pip_log"

  # Playwright -- skip when already resolvable
  if node -e "require('playwright')" 2>/dev/null || \
     node -e "require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright')" 2>/dev/null; then
    green "  OK playwright already installed -- skipping"
  elif command -v npm &>/dev/null; then
    if npm install -g playwright --silent 2>/dev/null && \
       npx playwright install chromium --silent 2>/dev/null; then
      green "  OK Playwright + Chromium installed"
    else
      yellow "  playwright install failed -- try: npm install -g playwright && npx playwright install chromium"
      rc=3
    fi
  else
    yellow "  npm not found - cannot install Playwright (HTML rendering will fail)"
    rc=2
  fi

  if [[ $rc -eq 0 ]]; then
    green ""
    green "All dependencies installed. Run: bash make.sh check"
  else
    yellow ""
    yellow "Some installs failed -- run 'bash make.sh check' for the current state."
  fi
  exit $rc
}

# ── render ────────────────────────────────────────────────────────────────────
# Thin wrapper around scripts/render_html.cjs. Forwards every flag through.
# Usage:
#   bash make.sh render --in page.html --out report.pdf [--wait 15000] ...
cmd_render() {
  if [[ $# -eq 0 ]]; then
    cat <<'USAGE'
Usage: bash make.sh render --in <file.html|url> --out <file.pdf>
                          [--wait <ms>]              extra settle time (Chart.js: 15000)
                          [--format A4|Letter]      page format (default A4)
                          [--margin "14mm 12mm"]    CSS margin shorthand
                          [--landscape]             landscape orientation
                          [--scale 1]               print scale 0.1–2
                          [--no-print-background]   disable color-exact print
                          [--header <html>]         header template
                          [--footer <html>]         footer template

Examples:
  bash make.sh render --in templates/data-viz-report/skeleton.html \
                      --out demo.pdf --wait 15000
  bash make.sh render --in https://example.com --out site.pdf --landscape
USAGE
    exit 1
  fi
  exec node "$SCRIPTS/render_html.cjs" "$@"
}

# ── reformat ───────────────────────────────────────────────────────────────────
# Parse a markdown / text / pdf source into HTML using the reformat-default
# template, then render to PDF.
cmd_reformat() {
  local input="" out="output.pdf"
  local title="" subtitle="" author="" date="" accent=""
  local template="default" wait_ms="800"
  local keep_html=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --input)    input="$2";    shift 2 ;;
      --out)      out="$2";      shift 2 ;;
      --title)    title="$2";    shift 2 ;;
      --subtitle) subtitle="$2"; shift 2 ;;
      --author)   author="$2";   shift 2 ;;
      --date)     date="$2";     shift 2 ;;
      --accent)   accent="$2";   shift 2 ;;
      --template) template="$2"; shift 2 ;;
      --wait)     wait_ms="$2";  shift 2 ;;
      --keep-html) keep_html=true; shift ;;
      -h|--help)
        cat <<'USAGE'
Usage: bash make.sh reformat --input <file.md|.txt|.pdf|.html> --out <file.pdf>
                            [--title T] [--subtitle S] [--author A] [--date D]
                            [--accent "#007AFF"] [--template default]
                            [--wait <ms>] [--keep-html]

Pipeline: source → markdown → reformat-default skeleton → PDF
USAGE
        exit 0 ;;
      *) red "Unknown option: $1"; exit 1 ;;
    esac
  done

  if [[ -z "$input" ]]; then
    red "error: --input is required"
    bash "$0" reformat --help
    exit 1
  fi
  if [[ ! -f "$input" ]]; then
    red "error: input not found: $input"
    exit 1
  fi

  local tmpdir
  tmpdir="$(mktemp -d -t pdfgen-reformat.XXXXXX)"
  local html="$tmpdir/page.html"

  bold "Parsing → HTML: $input"
  local parse_args=(--input "$input" --out "$html" --template "$template")
  [[ -n "$title"    ]] && parse_args+=(--title    "$title")
  [[ -n "$subtitle" ]] && parse_args+=(--subtitle "$subtitle")
  [[ -n "$author"   ]] && parse_args+=(--author   "$author")
  [[ -n "$date"     ]] && parse_args+=(--date     "$date")
  [[ -n "$accent"   ]] && parse_args+=(--accent   "$accent")
  $PY "$SCRIPTS/reformat_parse.py" "${parse_args[@]}"

  bold "Rendering → PDF: $out"
  node "$SCRIPTS/render_html.cjs" --in "$html" --out "$out" --wait "$wait_ms"

  if $keep_html; then
    yellow "  (--keep-html) intermediate HTML kept at: $html"
  else
    rm -rf "$tmpdir"
  fi
  green "OK reformat complete: $out"
}

# ── fill ──────────────────────────────────────────────────────────────────────
# FILL is dispatched via subverbs that map to subpackages under scripts/.
# All scripts run as `python -m scripts.<group>.<name>` from the skill root.
cmd_fill() {
  if [[ $# -lt 1 ]]; then
    cat <<'USAGE'
Usage: make.sh fill <subcommand> [args...]

Subcommands:
  probe     <input.pdf>                                 Detect AcroForm: prints acroform=true|false
  inspect   <input.pdf> <meta.json>                     Dump AcroForm field metadata
  apply     <input.pdf> <values.json> <output.pdf>      Apply values to AcroForm fields
  scan      <input.pdf> <layout.json>                   Scan visual layout (non-fillable PDFs)
  rasterize <input.pdf> <out_dir/> [--max-edge N] [--dpi N]
                                                        Render pages to PNG
  preview   <page> <fields.json> <page.png> <out.png>   Overlay bbox preview on a page image
  overlay   <input.pdf> <fields.json> <output.pdf>      Lay text via FreeText annotations
  lint      <fields.json> [--max-findings N]            Lint bounding-box geometry in fields.json

Decision tree: run 'fill probe' first.
  acroform=true  → inspect → apply
  acroform=false → scan → rasterize → preview → overlay → lint
USAGE
    exit 1
  fi

  local sub="$1"; shift
  cd "$SKILL_ROOT"
  # Prepend the skill root to PYTHONPATH so `python -m scripts.X` works even
  # when PYTHONSAFEPATH=1 is set in the user environment.
  export PYTHONPATH="$SKILL_ROOT${PYTHONPATH:+:$PYTHONPATH}"

  case "$sub" in
    probe)     bold "Probing AcroForm: $1";              $PY -m scripts.pdf_inspect.acroform_probe   "$@" ;;
    inspect)   bold "Inspecting AcroForm: $1 → $2";      $PY -m scripts.pdf_inspect.acroform_inspect "$@" ;;
    apply)     bold "Applying values: $1 + $2 → $3";     $PY -m scripts.fill.acroform_apply          "$@" ;;
    scan)      bold "Scanning layout: $1 → $2";          $PY -m scripts.pdf_inspect.layout_scan      "$@" ;;
    rasterize) bold "Rasterising pages: $1 → $2";        $PY -m scripts.render.page_rasterize        "$@" ;;
    preview)   bold "Overlay preview: page $1 → $4";     $PY -m scripts.render.overlay_preview       "$@" ;;
    overlay)   bold "Filling via overlay: $1 + $2 → $3"; $PY -m scripts.fill.overlay_apply           "$@" ;;
    lint)      bold "Linting fields: $1";                $PY -m scripts.validate.geometry_lint       "$@" ;;
    *)         red "Unknown fill subcommand: $sub";      exit 1 ;;
  esac
}

# ── dispatch ───────────────────────────────────────────────────────────────────
main() {
  if [[ $# -lt 1 ]]; then
    bold "pdf — make.sh (HTML → PDF)"
    cat <<'USAGE'

Usage: bash make.sh <command> [options]

Commands:
  check                              Verify all dependencies
  fix                                Auto-install missing dependencies
  render --in HTML --out PDF [opts]  CREATE: render HTML file or URL → PDF
                                     (see: bash make.sh render with no args)
  reformat --input SRC --out PDF     REFORMAT: markdown/text/pdf → HTML → PDF
                                     (see: bash make.sh reformat --help)
  fill <subcommand> [args...]        FILL: AcroForm probe/apply, visual overlay
                                     (see: bash make.sh fill with no args)

For READ / extract existing PDFs, see docs/read-guide.md.
For PDF mutation (merge / split / rotate / watermark), see docs/advanced-reference.md.
USAGE
    exit 0
  fi

  case "$1" in
    check)        cmd_check ;;
    fix)          cmd_fix   ;;
    render)       shift; cmd_render     "$@" ;;
    reformat)     shift; cmd_reformat   "$@" ;;
    fill)         shift; cmd_fill       "$@" ;;
    *)            red "Unknown command: $1"; exit 1 ;;
  esac
}

main "$@"
