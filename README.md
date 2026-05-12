# Rebased — VS Code Git Client

JetBrains-style git client features for VS Code. Drag-drop interactive rebase, log graph, commit view, stash management.

Inspired by [DetachHead/rebased](https://github.com/DetachHead/rebased).

## Features

| Milestone | Feature | Status |
|---|---|---|
| M0 | Drag-and-drop interactive rebase editor (★ killer feature) | MVP |
| M1 | Log graph with branch lanes, refs, context menu | MVP |
| M2 | Commit view with stage/unstage, amend, commit message | MVP |
| M3 | Stash tree (create / apply / pop / drop), cherry-pick, branch tree | MVP |
| M4 | Settings, keybindings, theme adaptation | Done |

## Quick start (development)

```bash
cd vscode-rebased
npm install
npm run build
```

Press `F5` in VS Code to launch an Extension Development Host with this extension loaded.

## Using the interactive rebase editor

The extension registers a `CustomTextEditor` for `git-rebase-todo` files. To trigger it:

```bash
# in any repo, with `code --wait` on PATH
GIT_SEQUENCE_EDITOR="code --wait" git rebase -i HEAD~5
```

Or invoke `Rebased: Interactive Rebase from...` from the Command Palette.

Drag rows to reorder, click the action chip to cycle `pick → reword → edit → squash → fixup → drop`, then **Start Rebase** (⌘⏎) to save and continue.

## Architecture

```
src/
├── core/                 # git CLI wrapper (spawn, no shell), repo watcher
├── m0-rebase/            # CustomTextEditorProvider for git-rebase-todo
├── m1-log/               # WebviewViewProvider, swim-lane layout
├── m2-commit/            # WebviewViewProvider, staging UI
├── m3-stash/             # TreeDataProvider, stash/branch commands
└── webview/              # Browser-bundled webview scripts (esbuild IIFE)
```

All UI is vanilla TS + HTML + VS Code theme CSS variables. No React. Webview ↔ extension communicates over `postMessage` only.

## Roadmap beyond MVP

- Virtual scrolling for log view (currently renders all rows)
- Diff preview pane inside commit view (currently delegates to built-in)
- Conflict resolution shortcut (open 3-way merge editor)
- Reflog browser
- Patch staging (hunk-level)
- Local history integration

## Security notes

- All git invocations go through `runGit()` in `src/core/git.ts`, which uses `spawn` with `shell: false` and an argv array — no shell interpolation possible.
- Webviews use a strict CSP with nonce-gated scripts.
- File content rendered into the DOM uses `textContent`, never `innerHTML` with untrusted strings.
