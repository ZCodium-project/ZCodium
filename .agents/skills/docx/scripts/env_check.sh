#!/usr/bin/env bash
# docx strict environment check
# This script is authoritative for whether the skill may run.
# Supports --level read|render|full (default: full).
set -euo pipefail

# --- Parse --level argument ---
LEVEL="full"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --level)
      shift
      LEVEL="${1:-}"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$LEVEL" in
  read|render|full) ;;
  *)
    echo "Invalid --level value: '$LEVEL'. Must be one of: read, render, full" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOTNET_DIR="$SCRIPT_DIR/dotnet"
DOTNET_REQUIRED_MAJOR=9

export DOTNET_CLI_UI_LANGUAGE=en

resolve_soffice_path() {
  local candidates=(
    "$(command -v soffice 2>/dev/null || true)"
    "$HOME/.local/bin/soffice"
    "$HOME/Applications/LibreOffice.app/Contents/MacOS/soffice"
    "/Applications/LibreOffice.app/Contents/MacOS/soffice"
  )
  local p
  for p in "${candidates[@]}"; do
    [ -n "$p" ] || continue
    [ -x "$p" ] || continue
    printf '%s\n' "$p"
    return 0
  done
  return 1
}

OS="unknown"
case "$(uname -s)" in
  Darwin) OS="macos" ;;
  Linux) OS="linux"; grep -qi microsoft /proc/version 2>/dev/null && OS="wsl" ;;
  MINGW*|MSYS*|CYGWIN*) OS="windows-shell" ;;
esac

echo "=== docx Environment Check (level: $LEVEL) ==="
echo ""

STATUS="READY"
# Failure buckets — populated by check_fail, rendered at the end so the
# remediation section can speak to the user in their language without
# repeating "go install python3" five times.
MISSING_TOOLS=""    # python3, unzip, soffice, pdftoppm, dotnet, pandoc, zip
LOCALE_BROKEN=0
LOCALE_HEALED=0     # set when locale self-heal succeeds; READY path still emits
                    # a short advisory so the "see hint below" promise on the OK
                    # line is actually fulfilled (and the user gets the persist
                    # commands without having to fail the gate first).
LOCALE_HEALED_FROM_LANG=""
LOCALE_HEALED_FROM_CHARMAP=""
LOCALE_HEALED_TO=""
PERMS_BROKEN=0
PROJECT_BROKEN=0

check_ok() {
  printf "[OK]      %-14s %s\n" "$1" "$2"
}

check_fail() {
  printf "[FAIL]    %-14s %s\n" "$1" "$2"
  STATUS="NOT READY"
}

# Same as check_fail but also tag the failure bucket so the end-of-run
# remediation section can be specific. We keep check_fail around because
# daemon-side parsers may scan for "[FAIL]" prefixes verbatim.
mark_missing_tool() {
  MISSING_TOOLS="$MISSING_TOOLS $1"
}

# --- read-level checks (always run) ---

if ! command -v python3 >/dev/null 2>&1; then
  check_fail "python3" "not found"
  mark_missing_tool "python3"
else
  check_ok "python3" "$(python3 --version 2>/dev/null | awk '{print $2}')"
fi

if ! command -v unzip >/dev/null 2>&1; then
  check_fail "unzip" "not found"
  mark_missing_tool "unzip"
else
  check_ok "unzip" "available"
fi

# Locale check (3-step, with self-heal):
#   1. $LANG explicitly carries utf-8?            -> OK
#   2. `locale charmap` reports UTF-8?            -> OK (LANG empty is fine on macOS GUI shells)
#   3. Try hot-patching LC_ALL=C.UTF-8 for the rest of this run and re-check.
#      This rescues subprocess contexts (skill spawners, daemon workers) where
#      $LANG is stripped but a UTF-8 locale is installed.
#   Otherwise -> fail with an actionable remediation in the summary block.
current_lang="${LANG:-}"
if [ -n "$current_lang" ] && echo "$current_lang" | grep -qi 'utf-8\|utf8'; then
  check_ok "locale" "$current_lang"
else
  charmap="$(locale charmap 2>/dev/null || echo "unknown")"
  if echo "$charmap" | grep -qi 'utf-8\|utf8'; then
    check_ok "locale" "charmap=$charmap (LANG empty/non-UTF-8, but system charmap is UTF-8)"
  else
    healed=0
    for candidate in C.UTF-8 en_US.UTF-8; do
      # Use a subshell + locale charmap so we don't depend on `locale -a`
      # (which is slow on macOS and absent on minimal Linux images).
      if [ "$(LC_ALL="$candidate" locale charmap 2>/dev/null)" = "UTF-8" ]; then
        export LANG="$candidate"
        export LC_ALL="$candidate"
        check_ok "locale" "self-healed to $candidate (was LANG='$current_lang', charmap='$charmap'; see advisory below to persist)"
        healed=1
        LOCALE_HEALED=1
        LOCALE_HEALED_FROM_LANG="$current_lang"
        LOCALE_HEALED_FROM_CHARMAP="$charmap"
        LOCALE_HEALED_TO="$candidate"
        break
      fi
    done
    if [ "$healed" -eq 0 ]; then
      check_fail "locale" "LANG='$current_lang', charmap='$charmap' — neither is UTF-8 and self-heal failed"
      LOCALE_BROKEN=1
    fi
  fi
fi

perm_issues=0
for s in "$SCRIPT_DIR"/*.sh; do
  if [ -f "$s" ] && [ ! -x "$s" ]; then
    perm_issues=$((perm_issues + 1))
  fi
done
if [ "$perm_issues" -eq 0 ]; then
  check_ok "permissions" "all scripts executable"
else
  check_fail "permissions" "$perm_issues script(s) not executable"
  PERMS_BROKEN=1
fi

# --- render-level checks (render + full) ---

if [[ "$LEVEL" == "render" || "$LEVEL" == "full" ]]; then
  SOFFICE_PATH="$(resolve_soffice_path 2>/dev/null || true)"
  if [ -z "$SOFFICE_PATH" ]; then
    check_fail "soffice" "not found"
    mark_missing_tool "soffice"
  else
    check_ok "soffice" "$SOFFICE_PATH"
  fi

  if ! command -v pdftoppm >/dev/null 2>&1; then
    check_fail "pdftoppm" "not found"
    mark_missing_tool "pdftoppm"
  else
    check_ok "pdftoppm" "available"
  fi
fi

# --- full-level checks (full only) ---

if [[ "$LEVEL" == "full" ]]; then
  if ! command -v dotnet >/dev/null 2>&1; then
    check_fail "dotnet" "not found"
    mark_missing_tool "dotnet"
  else
    ver="$(dotnet --version 2>/dev/null || echo 0.0.0)"
    major="${ver%%.*}"
    if [ "$major" -ge "$DOTNET_REQUIRED_MAJOR" ] 2>/dev/null; then
      check_ok "dotnet" "$ver (>= $DOTNET_REQUIRED_MAJOR.0)"
    else
      check_fail "dotnet" "$ver (requires >= $DOTNET_REQUIRED_MAJOR.0)"
      mark_missing_tool "dotnet"
    fi
  fi

  if ! command -v pandoc >/dev/null 2>&1; then
    check_fail "pandoc" "not found"
    mark_missing_tool "pandoc"
  else
    check_ok "pandoc" "$(pandoc --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' || echo '?')"
  fi

  if ! command -v zip >/dev/null 2>&1; then
    check_fail "zip" "not found"
    mark_missing_tool "zip"
  else
    check_ok "zip" "available"
  fi

  if [ ! -d "$DOTNET_DIR" ]; then
    check_fail "project" "directory not found: $DOTNET_DIR"
    PROJECT_BROKEN=1
  else
    if [ -f "$DOTNET_DIR/MiniMaxAIDocx.Cli/bin/Debug/net10.0/MiniMaxAIDocx.Cli.dll" ] || \
       [ -f "$DOTNET_DIR/MiniMaxAIDocx.Cli/bin/Debug/net9.0/MiniMaxAIDocx.Cli.dll" ] || \
       [ -f "$DOTNET_DIR/MiniMaxAIDocx.Cli/bin/Debug/net8.0/MiniMaxAIDocx.Cli.dll" ]; then
      check_ok "project" "built"
    else
      if dotnet restore "$DOTNET_DIR" --verbosity quiet >/dev/null 2>&1 && \
         dotnet build "$DOTNET_DIR" --verbosity quiet --no-restore >/dev/null 2>&1; then
        check_ok "project" "restore+build succeeded"
      else
        check_fail "project" "restore/build failed"
        PROJECT_BROKEN=1
      fi
    fi
  fi
fi

echo ""
if [ "$STATUS" = "READY" ]; then
  echo "Status: READY"
  # Advisory — fulfils the "see advisory below to persist" promise on the
  # self-heal OK line. Not a failure (we keep exit 0 and READY status), just a
  # nudge so the next subprocess does not have to self-heal again.
  if [ "$LOCALE_HEALED" -eq 1 ]; then
    echo ""
    echo "----- Advisory -----"
    echo ""
    echo "[locale] Self-healed to '$LOCALE_HEALED_TO' for this run (was LANG='$LOCALE_HEALED_FROM_LANG', charmap='$LOCALE_HEALED_FROM_CHARMAP')."
    echo "  Skill scripts in THIS shell will keep working — no further action needed."
    echo "  But every NEW subprocess starts from scratch and must self-heal again."
    echo "  To make UTF-8 sticky for the Mavis daemon and its workers:"
    if [ "$OS" = "macos" ]; then
      echo "    launchctl setenv LANG en_US.UTF-8"
      echo "    launchctl setenv LC_ALL en_US.UTF-8"
      echo "    # then restart the daemon so it inherits the new env"
    elif [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
      echo "    # daemon launched via systemd: add to your unit file's [Service] section:"
      echo "    Environment=LANG=en_US.UTF-8"
      echo "    Environment=LC_ALL=en_US.UTF-8"
      echo "    # daemon launched from shell: export the two vars in the parent shell"
      echo "    # before starting the daemon (NOT in ~/.zshrc — see below)."
    fi
    echo "  Note: editing ~/.zshrc does NOT help — Mavis subprocesses are non-interactive"
    echo "  and never source it. Use the launchctl / systemd / parent-shell paths above."
  fi
else
  echo "Status: NOT READY"
  echo ""
  echo "----- Remediation -----"

  # Locale block — most common subprocess/skill-spawner pitfall, surface first.
  if [ "$LOCALE_BROKEN" -eq 1 ]; then
    echo ""
    echo "[locale] No UTF-8 locale is exposed to this process."
    echo "  Caller (one-shot, no system changes):"
    echo "    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 bash $0 --level $LEVEL"
    if [ "$OS" = "macos" ]; then
      echo "  macOS (persist for GUI apps + Mavis daemon; survives reboot once set in launchd):"
      echo "    launchctl setenv LANG en_US.UTF-8"
      echo "    launchctl setenv LC_ALL en_US.UTF-8"
      echo "  Then restart the daemon so it inherits the new env."
    elif [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
      echo "  Linux/WSL (persist for interactive shells):"
      echo "    echo 'export LANG=en_US.UTF-8'   >> ~/.bashrc"
      echo "    echo 'export LC_ALL=en_US.UTF-8' >> ~/.bashrc"
      echo "  If your distro has no en_US.UTF-8, install glibc-locale-source / glibc-langpack-en"
      echo "  or add 'en_US.UTF-8 UTF-8' to /etc/locale.gen and run 'sudo locale-gen'."
    fi
    echo "  Note: editing ~/.zshrc does NOT help — Mavis subprocesses are non-interactive"
    echo "  and never source it. Use launchctl (macOS) or the caller-prefix approach."
  fi

  # Permissions block — cheap to fix, surface before tool installs.
  if [ "$PERMS_BROKEN" -eq 1 ]; then
    echo ""
    echo "[permissions] Some scripts are not executable. Fix:"
    echo "    chmod +x $SCRIPT_DIR/*.sh"
  fi

  # Missing tools block — show one composite install hint instead of one per tool.
  if [ -n "$MISSING_TOOLS" ]; then
    # Squash leading space + dedup.
    tools="$(echo "$MISSING_TOOLS" | tr ' ' '\n' | awk 'NF' | sort -u | tr '\n' ' ')"
    echo ""
    echo "[missing tools] $tools"
    if [ "$OS" = "macos" ]; then
      echo "  Recommended: bash $SCRIPT_DIR/setup.sh"
      echo "  This installs everything via Homebrew without sudo."
    elif [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
      # apt is the most common; pacman/dnf users will know what to do.
      echo "  Debian/Ubuntu:  sudo apt-get update && sudo apt-get install -y \\"
      echo "                    python3 unzip zip libreoffice poppler-utils pandoc"
      echo "  dotnet:         see https://learn.microsoft.com/dotnet/core/install/linux"
      echo "  Or, if package manager is unavailable: bash $SCRIPT_DIR/setup.sh"
    else
      echo "  Run: bash $SCRIPT_DIR/setup.sh"
    fi
  fi

  # dotnet project build failure — usually means dotnet SDK is too old or
  # NuGet feed is blocked. Not solvable by re-running setup blindly.
  if [ "$PROJECT_BROKEN" -eq 1 ]; then
    echo ""
    echo "[dotnet project] build/restore failed. To diagnose:"
    echo "    dotnet restore $DOTNET_DIR --verbosity normal"
    echo "    dotnet build   $DOTNET_DIR --verbosity normal --no-restore"
    echo "  Common causes: dotnet SDK < $DOTNET_REQUIRED_MAJOR.0, blocked NuGet feed,"
    echo "  or a clobbered intermediate build. Try 'rm -rf $DOTNET_DIR/**/{bin,obj}' then rebuild."
  fi

  # Level-specific tail.
  echo ""
  if [[ "$LEVEL" == "read" ]]; then
    echo "The read-level gate requires: python3, unzip, UTF-8 locale, executable scripts."
    echo "Re-check with: bash $0 --level read"
  elif [[ "$LEVEL" == "render" ]]; then
    echo "The render-level gate requires read-level items plus: soffice, pdftoppm."
    echo "Re-check with: bash $0 --level render"
  else
    echo "The full-level gate requires render-level items plus: dotnet>=$DOTNET_REQUIRED_MAJOR, pandoc, zip, built dotnet project."
    echo "Re-check with: bash $0 --level full"
  fi
  exit 1
fi
