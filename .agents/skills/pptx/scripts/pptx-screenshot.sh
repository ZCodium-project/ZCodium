#!/bin/bash
# pptx-screenshot.sh — Screenshot PPTX slides as PNG images
# Requires: LibreOffice (soffice), Swift compiler (Xcode CLI tools), macOS
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT_SRC="$SKILL_DIR/scripts/pdf2png.swift"
BINARY="$SKILL_DIR/scripts/pdf2png"

PAGES="1"
SCALE="2.0"
OUTDIR=""

usage() {
  cat >&2 <<EOF
Usage: pptx-screenshot.sh <pptx_file> [options]

Options:
  --pages <spec>    Page specification: "1", "1,3,5", "2-5", "all" (default: "1")
  --outdir <dir>    Output directory (default: same as input file)
  --scale <factor>  Rendering scale factor (default: 2.0)
  -h, --help        Show this help

Examples:
  pptx-screenshot.sh presentation.pptx
  pptx-screenshot.sh presentation.pptx --pages "1-3" --outdir /tmp/slides
  pptx-screenshot.sh presentation.pptx --pages all --scale 3.0
EOF
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

PPTX_FILE="$1"
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --pages)
      PAGES="$2"
      shift 2
      ;;
    --outdir)
      OUTDIR="$2"
      shift 2
      ;;
    --scale)
      SCALE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

if [ ! -f "$PPTX_FILE" ]; then
  echo "Error: file not found: $PPTX_FILE" >&2
  exit 1
fi

if [ -z "$OUTDIR" ]; then
  OUTDIR="$(dirname "$PPTX_FILE")"
fi

if ! command -v soffice &>/dev/null; then
  echo "Error: LibreOffice (soffice) not found." >&2
  echo "Install with: brew install --cask libreoffice" >&2
  exit 1
fi

if ! command -v swiftc &>/dev/null; then
  echo "Error: Swift compiler not found. Install Xcode Command Line Tools:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

if [ ! -f "$BINARY" ] || [ "$SWIFT_SRC" -nt "$BINARY" ]; then
  echo "Compiling PDF renderer..." >&2
  swiftc "$SWIFT_SRC" -o "$BINARY" -O 2>&1
  echo "Compilation done." >&2
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

BASENAME="$(basename "$PPTX_FILE" | sed 's/\.[^.]*$//')"

echo "Converting PPTX to PDF..." >&2
soffice --headless --convert-to pdf --outdir "$TMPDIR" "$PPTX_FILE" >/dev/null 2>&1

PDF_FILE="$TMPDIR/$BASENAME.pdf"
if [ ! -f "$PDF_FILE" ]; then
  echo "Error: LibreOffice failed to convert $PPTX_FILE to PDF" >&2
  exit 1
fi

mkdir -p "$OUTDIR"
"$BINARY" "$PDF_FILE" "$OUTDIR" --pages "$PAGES" --scale "$SCALE"
