#!/usr/bin/env bash
# Build docs/screenshots/demo.gif — slideshow of the project's PNG screenshots.
# Cross-platform (needs ffmpeg). Uses palettegen + paletteuse for small filesize.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install:"
  echo "  macOS:        brew install ffmpeg"
  echo "  Debian/Ubuntu/Gitpod: sudo apt-get install -y ffmpeg"
  exit 1
fi

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# Frame order tells the story:
#  1. Log graph — the headline visual
#  2. Log filter — IntelliJ-style multi-select / hash / custom range
#  3. Commit view — checkbox staging + group-by + chevron variants
#  4. Branches context menu — JetBrains-style direct right-click
#  5. Drag-drop interactive rebase editor — flagship
#  6. Commit details side panel
#  7. Conventional Commits wizard
#  8. Blame gutter
#  9. Conflict resolution panel
# 10. Local history
# 11. Loop back to log graph
cat > "$TMP/order.txt" <<EOF
file '$PWD/docs/screenshots/log-graph.png'
duration 2.4
file '$PWD/docs/screenshots/log-filter.png'
duration 2.8
file '$PWD/docs/screenshots/commit-view.png'
duration 2.8
file '$PWD/docs/screenshots/branches-context.png'
duration 2.6
file '$PWD/docs/screenshots/rebase-editor.png'
duration 2.6
file '$PWD/docs/screenshots/commit-details.png'
duration 2.4
file '$PWD/docs/screenshots/commit-wizard.png'
duration 2.2
file '$PWD/docs/screenshots/blame-gutter.png'
duration 2.4
file '$PWD/docs/screenshots/conflict-panel.png'
duration 2.6
file '$PWD/docs/screenshots/local-history.png'
duration 2.2
file '$PWD/docs/screenshots/log-graph.png'
EOF

ffmpeg -hide_banner -loglevel error \
  -f concat -safe 0 -i "$TMP/order.txt" \
  -vf "fps=24,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff" \
  -y "$TMP/palette.png"

ffmpeg -hide_banner -loglevel error \
  -f concat -safe 0 -i "$TMP/order.txt" \
  -i "$TMP/palette.png" \
  -lavfi "fps=24,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4" \
  -y docs/screenshots/demo.gif

size=$(du -h docs/screenshots/demo.gif | cut -f1)
echo "  ✓ docs/screenshots/demo.gif  ($size)"
