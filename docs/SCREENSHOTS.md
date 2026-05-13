# Screenshots

The README references 7 screenshots under `docs/screenshots/`. This doc
walks you through capturing them — guided (recommended) or manually.

## Guided

```bash
bash scripts/take-screenshots.sh           # all 7
bash scripts/take-screenshots.sh log-graph # just one
```

The script:

1. Builds an ephemeral demo repo at `$TMPDIR/rebased-screenshot-fixture`
   with 3 branches, 9 CC-style commits, a UU conflict file, and a dirty
   file with two distinct hunks (full topology in
   `scripts/setup-screenshot-fixture.sh`).
2. Opens VS Code at the fixture.
3. For each screenshot, prints what to set up, waits for you to press
   `<Enter>`, then runs `screencapture -W -o` so you click the target
   window to grab it.
4. Saves to `docs/screenshots/<name>.png`.

After all 7 are captured, commit and push:

```bash
git add docs/screenshots/*.png
git commit -m "docs: add README screenshots"
git push
```

## Manual fallback

If the guided script misbehaves, set up the fixture and capture by hand:

```bash
bash scripts/setup-screenshot-fixture.sh
code "$TMPDIR/rebased-screenshot-fixture"
```

Then for each screenshot:

### `rebase-editor.png`

In the integrated terminal:
```bash
GIT_SEQUENCE_EDITOR='code --wait' git rebase -i HEAD~5
```
A drag-drop rebase editor opens. Capture it (⌘⇧4 → space → click).

### `log-graph.png`

Click the Rebased activity-bar icon → Log panel. The swim-lane graph
shows `main` / `feature/api` / `feature/perf` diverging.

### `commit-details.png`

Click `feat(api): pagination` in the log. The commit details side
panel opens — refs, parents, file list with +/− stats. Capture both
panels.

### `commit-wizard.png`

Press <kbd>⌘⌥C</kbd>. The 11-type QuickPick appears. Capture just the
QuickPick (⌘⇧4 → space → click QuickPick).

### `blame-gutter.png`

Open `apps/api/list.ts` → press <kbd>⌘⌥B</kbd>. Gutter annotations
(hash · author · age) appear next to every line. Capture the editor.

### `local-history.png`

Open `apps/web/handlers.ts` → modify and save 3-4 times → right-click
the file → "Show Local History". A QuickPick lists timestamps. Capture
the QuickPick.

### `conflict-panel.png`

Command Palette → "Rebased: Resolve Conflicts…". The webview opens
with `apps/web/server.ts` row showing the 4 per-file action buttons
(Accept yours / Accept theirs / Merge / Reset). Capture the panel.

## Trimming and compressing (optional)

PNG screenshots from `screencapture` are often 1–3 MB. Compress before
committing:

```bash
brew install pngquant   # one-time
pngquant --ext .png --force --quality=70-90 docs/screenshots/*.png
```

Typical reduction: 70-80%.

## Notes

- The fixture uses deterministic timestamps (epoch 1730000000 + offsets)
  so the dates in your screenshots stay stable across re-captures.
- The fixture is ephemeral — wiping `$TMPDIR/rebased-screenshot-fixture`
  and re-running the setup gives an identical state.
- Window rendering on macOS retina captures at 2× scale automatically.
  The README references these as regular images; GitHub auto-scales.
