#!/usr/bin/env bash
# Cross-platform PNG re-render from the SVG sources in docs/screenshots/_src/.
# Runs anywhere with rsvg-convert (macOS: brew install librsvg / Linux/Gitpod:
# apt-get install -y librsvg2-bin). Idempotent — rewrites every PNG every run.
#
# Use this when you've tweaked an SVG mockup and want the README image refreshed
# without firing up the macOS screencapture flow.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert not found. Install:"
  echo "  macOS:        brew install librsvg"
  echo "  Debian/Ubuntu/Gitpod: sudo apt-get install -y librsvg2-bin"
  exit 1
fi

SRC=docs/screenshots/_src
OUT=docs/screenshots
shopt -s nullglob

count=0
for svg in "$SRC"/*.svg; do
  name=$(basename "$svg" .svg)
  width=1200
  # The status-bar and submodules mocks were intentionally narrower.
  case "$name" in
    status-bar)  width=1200 ;;
    submodules)  width=480 ;;
  esac
  rsvg-convert -w "$width" "$svg" -o "$OUT/$name.png"
  size=$(du -h "$OUT/$name.png" | cut -f1)
  echo "  ✓ $OUT/$name.png  ($size, ${width}px wide)"
  count=$((count + 1))
done

echo
echo "Rendered $count PNG(s) from $SRC/."
echo "Note: demo.gif is built separately by ffmpeg — run scripts/build-demo-gif.sh"
