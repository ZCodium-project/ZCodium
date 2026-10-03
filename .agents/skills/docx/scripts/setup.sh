#!/usr/bin/env bash
# docx Environment Setup & Initialization Script
# Focus: macOS full-fidelity DOCX environment with no sudo requirement.
# Other platforms keep best-effort package-manager installs.
set -euo pipefail

export DOTNET_CLI_UI_LANGUAGE=en

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOTNET_DIR="$SCRIPT_DIR/dotnet"
LOG_FILE="$PROJECT_DIR/.setup.log"
DOTNET_REQUIRED_MAJOR=9

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
step()  { echo -e "\n${BLUE}=== $* ===${NC}"; }

OS="unknown"
PKG_MGR="unknown"
ARCH="$(uname -m)"
BREW_BIN=""
BREW_PREFIX=""

path_prepend_now() {
  case ":${PATH}:" in
    *":$1:"*) ;;
    *) export PATH="$1:$PATH" ;;
  esac
}

ensure_shell_export() {
  local file="$1"
  local line="$2"
  touch "$file"
  grep -Fqx "$line" "$file" 2>/dev/null || printf '%s\n' "$line" >> "$file"
}

persist_macos_paths() {
  [ "$OS" = "macos" ] || return 0

  mkdir -p "$HOME/.local/bin"
  path_prepend_now "$HOME/.dotnet"
  path_prepend_now "$HOME/.local/bin"

  if [ -n "$BREW_PREFIX" ]; then
    path_prepend_now "$BREW_PREFIX/bin"
    path_prepend_now "$BREW_PREFIX/sbin"
  fi

  local lines=(
    'export PATH="$HOME/.dotnet:$PATH"'
    'export PATH="$HOME/.local/bin:$PATH"'
  )
  if [ -n "$BREW_PREFIX" ]; then
    lines+=("export PATH=\"$BREW_PREFIX/bin:$BREW_PREFIX/sbin:\$PATH\"")
  fi

  for rc in "$HOME/.zprofile" "$HOME/.zshrc"; do
    for line in "${lines[@]}"; do
      ensure_shell_export "$rc" "$line"
    done
  done
}

resolve_brew() {
  if [ -n "$BREW_BIN" ] && [ -x "$BREW_BIN" ]; then
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    BREW_BIN="$(command -v brew)"
    BREW_PREFIX="$($BREW_BIN --prefix)"
    return 0
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    BREW_BIN=/opt/homebrew/bin/brew
    BREW_PREFIX=/opt/homebrew
    path_prepend_now /opt/homebrew/bin
    path_prepend_now /opt/homebrew/sbin
    return 0
  fi

  if [ -x /usr/local/bin/brew ]; then
    BREW_BIN=/usr/local/bin/brew
    BREW_PREFIX=/usr/local
    path_prepend_now /usr/local/bin
    path_prepend_now /usr/local/sbin
    return 0
  fi

  return 1
}

ensure_brew_for_macos() {
  if resolve_brew; then
    log "Homebrew available: $BREW_BIN"
    persist_macos_paths
    return 0
  fi

  fail "Homebrew is required on macOS to install pandoc, poppler, python3, and LibreOffice without sudo."
  fail "Install Homebrew first, then re-run this script: https://brew.sh"
  return 1
}

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

symlink_soffice_user_bin() {
  local soffice_path="$1"
  mkdir -p "$HOME/.local/bin"
  ln -sfn "$soffice_path" "$HOME/.local/bin/soffice"
  path_prepend_now "$HOME/.local/bin"
  persist_macos_paths
}

detect_platform() {
  case "$(uname -s)" in
    Darwin)
      OS="macos"
      PKG_MGR="brew"
      resolve_brew || true
      ;;
    Linux)
      OS="linux"
      if [ -f /etc/os-release ]; then
        . /etc/os-release
        case "${ID:-}" in
          ubuntu|debian|linuxmint|pop) PKG_MGR="apt" ;;
          fedora|rhel|centos|rocky|alma) PKG_MGR="dnf" ;;
          arch|manjaro|endeavouros) PKG_MGR="pacman" ;;
          opensuse*|sles) PKG_MGR="zypper" ;;
          alpine) PKG_MGR="apk" ;;
          *) PKG_MGR="unknown" ;;
        esac
      fi
      grep -qi microsoft /proc/version 2>/dev/null && OS="wsl"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      OS="windows-git-bash"
      PKG_MGR="none"
      cat <<'EOF' >&2

[FAIL] You are running setup.sh under git-bash / MSYS / Cygwin on Windows.
       This script will NOT install anything here — it cannot reach winget/choco/scoop
       reliably from a POSIX-emulation shell, and any installs would land in the
       wrong PATH for the rest of the toolchain (dotnet build needs a Windows-native
       UTF-8 console, soffice.exe needs to be discoverable to PowerShell, etc.).

       Run the PowerShell setup instead, in an elevated or normal PowerShell window:

         powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
         # or, if pwsh 7+ is installed
         pwsh        -ExecutionPolicy Bypass -File scripts\setup.ps1

       Then verify with:

         powershell -ExecutionPolicy Bypass -File scripts\env_check.ps1 -Level Read

EOF
      exit 2
      ;;
  esac

  echo "Platform: $OS ($ARCH), Package Manager: $PKG_MGR"
}

install_dotnet() {
  step "Checking .NET SDK"

  if command -v dotnet >/dev/null 2>&1; then
    local ver major
    ver="$(dotnet --version 2>/dev/null || echo 0)"
    major="${ver%%.*}"
    if [ "$major" -ge "$DOTNET_REQUIRED_MAJOR" ] 2>/dev/null; then
      log "dotnet $ver already installed (>= $DOTNET_REQUIRED_MAJOR.0 OK)"
      return 0
    fi
    warn "dotnet $ver found but < $DOTNET_REQUIRED_MAJOR.0, upgrading..."
  fi

  if [ "$OS" = "macos" ]; then
    info "Installing .NET SDK via dotnet-install script to ~/.dotnet (no sudo)..."
    curl -fsSL "https://dot.net/v1/dotnet-install.sh" -o /tmp/dotnet-install.sh
    chmod +x /tmp/dotnet-install.sh
    /tmp/dotnet-install.sh --channel "$DOTNET_REQUIRED_MAJOR.0" --install-dir "$HOME/.dotnet"
    persist_macos_paths
  else
    info "Installing .NET SDK..."
    case "$PKG_MGR" in
      apt)
        curl -fsSL "https://dot.net/v1/dotnet-install.sh" -o /tmp/dotnet-install.sh
        chmod +x /tmp/dotnet-install.sh
        /tmp/dotnet-install.sh --channel "$DOTNET_REQUIRED_MAJOR.0" --install-dir "$HOME/.dotnet"
        export PATH="$HOME/.dotnet:$PATH"
        ;;
      dnf) sudo dnf install -y dotnet-sdk-$DOTNET_REQUIRED_MAJOR.0 ;;
      pacman) sudo pacman -S --noconfirm dotnet-sdk ;;
      zypper) sudo zypper install -y dotnet-sdk-$DOTNET_REQUIRED_MAJOR.0 ;;
      apk) apk add --no-cache dotnet8-sdk ;;
      *)
        fail "Could not auto-install dotnet on this platform. Install manually from https://dotnet.microsoft.com/download"
        return 1
        ;;
    esac
  fi

  if command -v dotnet >/dev/null 2>&1; then
    log "dotnet $(dotnet --version) installed"
  else
    fail "dotnet installation failed"
    return 1
  fi
}

install_python3() {
  step "Checking python3"

  if command -v python3 >/dev/null 2>&1; then
    log "python3 $(python3 --version 2>/dev/null | awk '{print $2}') already installed"
    return 0
  fi

  info "Installing python3..."
  case "$OS:$PKG_MGR" in
    macos:brew)
      ensure_brew_for_macos
      "$BREW_BIN" install python
      persist_macos_paths
      ;;
    linux:apt|wsl:apt) sudo apt-get update -qq && sudo apt-get install -y -qq python3 ;;
    linux:dnf|wsl:dnf) sudo dnf install -y python3 ;;
    linux:pacman|wsl:pacman) sudo pacman -S --noconfirm python ;;
    linux:zypper|wsl:zypper) sudo zypper install -y python3 ;;
    linux:apk|wsl:apk) apk add --no-cache python3 ;;
    *)
      fail "python3 is required and could not be auto-installed"
      return 1
      ;;
  esac

  command -v python3 >/dev/null 2>&1 || { fail "python3 installation failed"; return 1; }
  log "python3 installed"
}

install_pandoc() {
  step "Checking pandoc"

  if command -v pandoc >/dev/null 2>&1; then
    log "pandoc $(pandoc --version | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?') already installed"
    return 0
  fi

  info "Installing pandoc..."
  case "$OS:$PKG_MGR" in
    macos:brew)
      ensure_brew_for_macos
      "$BREW_BIN" install pandoc
      persist_macos_paths
      ;;
    linux:apt|wsl:apt) sudo apt-get update -qq && sudo apt-get install -y -qq pandoc ;;
    linux:dnf|wsl:dnf) sudo dnf install -y pandoc ;;
    linux:pacman|wsl:pacman) sudo pacman -S --noconfirm pandoc ;;
    linux:zypper|wsl:zypper) sudo zypper install -y pandoc ;;
    linux:apk|wsl:apk) apk add --no-cache pandoc ;;
    *)
      fail "pandoc is required and could not be auto-installed"
      return 1
      ;;
  esac

  command -v pandoc >/dev/null 2>&1 || { fail "pandoc installation failed"; return 1; }
  log "pandoc installed"
}

install_poppler() {
  step "Checking pdftoppm (poppler)"

  if command -v pdftoppm >/dev/null 2>&1; then
    log "pdftoppm already installed"
    return 0
  fi

  info "Installing poppler..."
  case "$OS:$PKG_MGR" in
    macos:brew)
      ensure_brew_for_macos
      "$BREW_BIN" install poppler
      persist_macos_paths
      ;;
    linux:apt|wsl:apt) sudo apt-get update -qq && sudo apt-get install -y -qq poppler-utils ;;
    linux:dnf|wsl:dnf) sudo dnf install -y poppler-utils ;;
    linux:pacman|wsl:pacman) sudo pacman -S --noconfirm poppler ;;
    linux:zypper|wsl:zypper) sudo zypper install -y poppler-tools ;;
    linux:apk|wsl:apk) apk add --no-cache poppler-utils ;;
    *)
      fail "pdftoppm is required and could not be auto-installed"
      return 1
      ;;
  esac

  command -v pdftoppm >/dev/null 2>&1 || { fail "pdftoppm installation failed"; return 1; }
  log "pdftoppm installed"
}

install_soffice() {
  step "Checking LibreOffice/soffice"

  if local_path="$(resolve_soffice_path 2>/dev/null)"; then
    log "soffice available at $local_path"
    [ "$OS" = "macos" ] && symlink_soffice_user_bin "$local_path"
    return 0
  fi

  info "Installing LibreOffice..."
  case "$OS:$PKG_MGR" in
    macos:brew)
      ensure_brew_for_macos
      mkdir -p "$HOME/Applications"
      HOMEBREW_CASK_OPTS="--appdir=$HOME/Applications" "$BREW_BIN" install --cask libreoffice
      ;;
    linux:apt|wsl:apt) sudo apt-get update -qq && sudo apt-get install -y -qq libreoffice-core ;;
    linux:dnf|wsl:dnf) sudo dnf install -y libreoffice-core ;;
    linux:pacman|wsl:pacman) sudo pacman -S --noconfirm libreoffice-still ;;
    linux:zypper|wsl:zypper) sudo zypper install -y libreoffice ;;
    linux:apk|wsl:apk) apk add --no-cache libreoffice ;;
    *)
      fail "LibreOffice is required and could not be auto-installed"
      return 1
      ;;
  esac

  local local_path
  local_path="$(resolve_soffice_path 2>/dev/null || true)"
  if [ -z "$local_path" ]; then
    fail "LibreOffice installation finished but soffice is still not discoverable"
    return 1
  fi
  [ "$OS" = "macos" ] && symlink_soffice_user_bin "$local_path"
  log "soffice installed at $local_path"
}

install_zip_tools() {
  step "Checking zip/unzip"
  local need_zip=false need_unzip=false
  command -v zip >/dev/null 2>&1 || need_zip=true
  command -v unzip >/dev/null 2>&1 || need_unzip=true
  if ! $need_zip && ! $need_unzip; then
    log "zip/unzip already installed"
    return 0
  fi

  info "Installing zip/unzip..."
  case "$PKG_MGR" in
    brew) ensure_brew_for_macos; "$BREW_BIN" install zip unzip ;;
    apt) sudo apt-get update -qq && sudo apt-get install -y -qq zip unzip ;;
    dnf) sudo dnf install -y zip unzip ;;
    pacman) sudo pacman -S --noconfirm zip unzip ;;
    zypper) sudo zypper install -y zip unzip ;;
    apk) apk add --no-cache zip unzip ;;
    *) warn "Could not auto-install zip/unzip" ;;
  esac
}

check_locale() {
  step "Checking locale and encoding"
  local current_lang="${LANG:-not set}"
  if echo "$current_lang" | grep -qi 'utf-8\|utf8'; then
    log "Locale supports UTF-8: LANG=$current_lang"
  else
    warn "Locale may not support UTF-8: LANG=$current_lang"
    warn "CJK processing needs UTF-8. Set: export LANG=en_US.UTF-8"
  fi
}

check_nuget_config() {
  step "Checking NuGet configuration"
  if dotnet nuget list source 2>/dev/null | grep -q 'nuget.org'; then
    log "nuget.org source is configured"
  else
    warn "nuget.org not in sources. Adding..."
    dotnet nuget add source "https://api.nuget.org/v3/index.json" --name "nuget.org" >/dev/null 2>&1 || true
  fi
}

fix_permissions() {
  step "Setting script permissions"
  local scripts=(
    "$SCRIPT_DIR/env_check.sh"
    "$SCRIPT_DIR/docx_preview.sh"
    "$SCRIPT_DIR/doc_to_docx.sh"
    "$SCRIPT_DIR/setup.sh"
  )
  local s
  for s in "${scripts[@]}"; do
    [ -f "$s" ] || continue
    chmod +x "$s"
  done
  log "script permissions updated"
}

build_project() {
  step "Building docx .NET project"
  [ -d "$DOTNET_DIR" ] || { fail "Dotnet project directory not found: $DOTNET_DIR"; return 1; }

  cd "$DOTNET_DIR"
  info "Restoring NuGet packages..."
  if ! dotnet restore --verbosity quiet 2>>"$LOG_FILE"; then
    fail "NuGet restore failed. Check $LOG_FILE for details."
    return 1
  fi
  log "NuGet packages restored"

  info "Building project..."
  if ! dotnet build --verbosity quiet --no-restore 2>>"$LOG_FILE"; then
    fail "Build failed. Check $LOG_FILE for details."
    return 1
  fi
  log "Project built successfully"
  cd "$PROJECT_DIR"
}

verify_installation() {
  step "Verification Test"
  local test_output="/tmp/docx-setup-test-$$.docx"
  info "Creating a test document..."
  if cd "$DOTNET_DIR" && dotnet run --project MiniMaxAIDocx.Cli -- create --type report --output "$test_output" --title "Setup Test" 2>>"$LOG_FILE"; then
    log "Test document created: $test_output"
    rm -f "$test_output"
    log "Test passed — docx is ready to use"
  else
    fail "Test document creation failed. Check $LOG_FILE for details."
    return 1
  fi
  cd "$PROJECT_DIR"
}

check_fonts() {
  step "Checking fonts"
  if [ "$OS" = "macos" ]; then
    log "macOS built-in CJK fonts available"
    if [ -d "/Applications/Microsoft Word.app" ] || [ -d "/Applications/Microsoft Office" ]; then
      log "Microsoft Office fonts available"
    else
      warn "Microsoft Office not installed — Calibri/Cambria may be missing"
    fi
  else
    info "Font check is informational on non-macOS platforms"
  fi
}

print_summary() {
  step "Setup Complete"
  echo ""
  echo "  Environment: $OS ($ARCH)"
  echo "  dotnet:      $(dotnet --version 2>/dev/null || echo 'NOT FOUND')"
  echo "  python3:     $(python3 --version 2>/dev/null | awk '{print $2}' || echo 'NOT FOUND')"
  echo "  pandoc:      $(pandoc --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' || echo 'NOT FOUND')"
  echo "  pdftoppm:    $(command -v pdftoppm 2>/dev/null || echo 'NOT FOUND')"
  echo "  soffice:     $(resolve_soffice_path 2>/dev/null || echo 'NOT FOUND')"
  echo "  Project:     $DOTNET_DIR"
  echo ""
  echo "  Mandatory preflight: bash $SCRIPT_DIR/env_check.sh"
  echo "  Log file: $LOG_FILE"
}

main() {
  echo "============================================"
  echo "  docx Setup & Initialization"
  echo "  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "============================================"

  : > "$LOG_FILE"
  detect_platform

  local skip_verify=false
  local skip_optional=false
  for arg in "$@"; do
    case "$arg" in
      --minimal) skip_optional=true ;;
      --skip-verify) skip_verify=true ;;
      --help|-h)
        echo "Usage: setup.sh [options]"
        echo "  --minimal       Skip font check only (runtime deps are still installed)"
        echo "  --skip-verify   Skip the final create-document verification"
        exit 0
        ;;
    esac
  done

  [ "$OS" = "macos" ] && ensure_brew_for_macos

  install_dotnet
  install_python3
  install_pandoc
  install_poppler
  install_soffice
  install_zip_tools

  check_locale
  check_nuget_config
  fix_permissions
  build_project
  if ! $skip_optional; then
    check_fonts
  fi
  if ! $skip_verify; then
    verify_installation
  fi
  print_summary
}

main "$@"
