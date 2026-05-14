#!/usr/bin/env bash
# Guided screenshot capture. For each of the 6 README screenshots:
#   1. Print what to set up in VS Code (commands, files to open, etc.)
#   2. Press <Enter> when ready
#   3. screencapture -W -i grabs the clicked window
#
# Requires macOS. Output goes to docs/screenshots/.
#
# Usage: bash scripts/take-screenshots.sh [shot-name]
#   shot-name = one of: rebase-editor log-graph commit-details commit-wizard
#               blame-gutter local-history conflict-panel branches-context
#               (default: all)

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p docs/screenshots

FIXTURE="${TMPDIR:-/tmp}rebased-screenshot-fixture"
FIXTURE="${FIXTURE%/}"
VSCODE="${VSCODE:-/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code}"

if [ ! -d "$FIXTURE/.git" ]; then
  echo "Fixture not found — running setup first…"
  bash scripts/setup-screenshot-fixture.sh >/dev/null
fi

GRAY="\033[90m"; CYAN="\033[36m"; YEL="\033[33m"; GRN="\033[32m"; OFF="\033[0m"

prompt() {
  local name=$1 instructions=$2
  echo
  echo -e "${YEL}━━━ $name ━━━${OFF}"
  echo -e "$instructions"
  echo
  read -r -p "$(echo -e "${CYAN}When VS Code is in the right state, press <Enter>${OFF} — then click the window to capture. ")" _ </dev/tty
  local out="docs/screenshots/$name.png"
  echo -e "${GRAY}screencapture -W -o -t png $out${OFF}"
  screencapture -W -o -t png "$out"
  if [ -f "$out" ]; then
    echo -e "${GRN}✓ saved $out ($(du -h "$out" | cut -f1))${OFF}"
  else
    echo "✗ capture cancelled or failed"
  fi
}

open_fixture() {
  "$VSCODE" --new-window "$FIXTURE" >/dev/null 2>&1 &
  echo -e "${GRAY}Opening VS Code at $FIXTURE — give it ~5s${OFF}"
  sleep 5
}

shot=${1:-all}

case "$shot" in
  all|rebase-editor)
    open_fixture
    prompt "rebase-editor" "
1. In VS Code, open an integrated terminal (Ctrl+\`).
2. Run:    GIT_SEQUENCE_EDITOR='code --wait' git rebase -i HEAD~5
3. Rebased's interactive rebase webview should open as the active editor.
4. Click any row in the list once (so the cursor lands inside).
5. Drag one row up or down to show the drag affordance — release.
"
    [ "$shot" = "all" ] || exit 0 ;;
esac

case "$shot" in
  all|log-graph)
    [ "$shot" = "all" ] || open_fixture
    prompt "log-graph" "
1. Click the Rebased icon in the activity bar (left edge).
2. Expand the Log panel — you should see the swim-lane graph with
   main / feature/api / feature/perf branches.
3. (Optional) Click a commit to highlight it.
4. Capture the window showing the Log panel filling most of the height.
"
    [ "$shot" = "all" ] || exit 0 ;;
esac

case "$shot" in
  all|commit-details)
    [ "$shot" = "all" ] || open_fixture
    prompt "commit-details" "
1. In the Log panel, click commit 'feat(api): pagination'.
2. The Commit details panel opens on the right.
3. You should see refs, parents, file list with +/- stats.
4. Capture the full window (both Log panel + details).
"
    [ "$shot" = "all" ] || exit 0 ;;
esac

case "$shot" in
  all|commit-wizard)
    [ "$shot" = "all" ] || open_fixture
    prompt "commit-wizard" "
1. Press ⌘⌥C  (or Cmd+Shift+P → 'Commit Wizard…').
2. The first QuickPick lists 11 commit types — leave it on the first one.
3. Capture just the QuickPick area at the top (use ⌘⇧4 → space → click QuickPick
   instead of -W if you want a tighter crop).
"
    [ "$shot" = "all" ] || exit 0 ;;
esac

case "$shot" in
  all|blame-gutter)
    [ "$shot" = "all" ] || open_fixture
    prompt "blame-gutter" "
1. Open apps/api/list.ts from the explorer.
2. Press ⌘⌥B to toggle full-file blame.
3. Wait for the gutter annotations to appear (commit hash · author · age).
4. Capture the editor window with annotations visible.
"
    [ "$shot" = "all" ] || exit 0 ;;
esac

case "$shot" in
  all|local-history)
    [ "$shot" = "all" ] || open_fixture
    prompt "local-history" "
1. Open apps/web/handlers.ts.
2. Modify it (delete a line), Cmd+S to save — repeat 2-3 times to make a few snapshots.
3. Right-click the file in explorer → 'Show Local History'.
4. The QuickPick lists snapshots with timestamps.
5. Capture the QuickPick.
"
    [ "$shot" = "all" ] || exit 0 ;;
esac

case "$shot" in
  all|conflict-panel)
    [ "$shot" = "all" ] || open_fixture
    prompt "conflict-panel" "
1. Press Cmd+Shift+P → 'Rebased: Resolve Conflicts…' (apps/web/server.ts has UU markers).
2. The Conflict resolver webview opens with the file row + 4 action buttons.
3. Capture the panel.
"
    [ "$shot" = "all" ] || exit 0 ;;
esac

case "$shot" in
  all|branches-context)
    [ "$shot" = "all" ] || open_fixture
    prompt "branches-context" "
1. Click the Rebased icon in the activity bar.
2. Expand the 'Branches' view in the sidebar. You should see Local + Remote groups.
3. Right-click a NON-current local branch (e.g. 'feature/api') to open the
   context menu — it should list 11+ actions across 4 groups:
   Checkout / Merge / Rebase / Compare / New from Here / Copy Name / Rename /
   Push (Set Upstream) / Force Push / Reset Current to Here / Delete.
4. Capture the window so both the branches tree AND the open context menu
   are visible. Use Cmd+Shift+4 → Space → click for a tighter crop if needed.
"
    ;;
esac

echo
echo -e "${GRN}Done. Saved screenshots:${OFF}"
ls -lh docs/screenshots/ 2>/dev/null
