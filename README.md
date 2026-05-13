# Rebased

> JetBrains-style git client features for VS Code.
> Drag-drop interactive rebase, log graph, hunk staging, changelists, local history.

[![CI](https://github.com/funchs/vscode-rebased/actions/workflows/ci.yml/badge.svg)](https://github.com/funchs/vscode-rebased/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-47%20passing-brightgreen)](#testing)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC)](https://code.visualstudio.com/)

Inspired by [DetachHead/rebased](https://github.com/DetachHead/rebased) — the
IntelliJ git client extracted as a standalone app. This extension distills its
best ideas into a single VS Code extension that coexists with the built-in git
support and GitLens.

---

## Highlights

### Drag-and-drop interactive rebase

Open any `git-rebase-todo` (e.g. `GIT_SEQUENCE_EDITOR="code --wait" git rebase -i HEAD~5`)
to get a webview with drag-to-reorder rows, single-click action cycling
(pick → reword → edit → squash → fixup → drop), and ⌘⏎ to save and continue.

> _Screenshot: `docs/screenshots/rebase-editor.png` — capture from a real rebase session._

### Log graph with virtual scrolling

Branch-aware swim-lane graph, refs as colored chips, sticky filter toolbar
(subject / author / path / branch / since). Renders 10,000 commits without
breaking a sweat.

> _Screenshot: `docs/screenshots/log-graph.png`_

### Commit details side panel

Click any commit in the log to open a side panel with subject, body, refs,
parents, and a clickable file list (+ / − stats) that diffs each file against
its parent via VS Code's built-in diff editor.

> _Screenshot: `docs/screenshots/commit-details.png`_

### Hunk-level staging

Stage partial changes per file with checkboxes — backed by `git apply --cached`
on a minimal patch built from your selection.

### Conventional Commits live validator

Real-time type/scope/BREAKING chips above the commit textarea, status row
showing ✓ valid / ⚠ warnings / ✕ format error. Or run the 5-step **Commit
Wizard** (⌘⌥C) — scope autocomplete from your repo's history.

### Local history

Every file save auto-snapshots into `globalStorage`. Browse, diff against
current, or restore — independent of git, so even uncommitted work is
recoverable.

### Changelists

JetBrains-style named groups of working-tree paths. Group fix-up changes,
commit them as one without touching unrelated edits.

---

## Full feature list

| Area | Feature |
|---|---|
| **Rebase** | Drag-drop editor · ⌘⏎ save · auto-stash on dirty tree |
| **Log** | Graph · virtual scroll · 5-field filter · refs · context menu (rebase / cherry-pick / checkout) |
| **Commit** | Stage/unstage · hunk staging · amend · changelists · CC validator · wizard |
| **Branches** | QuickPick with 8 actions · ⌘⇧B · compare · push --set-upstream |
| **History** | Commit details · file history (`--follow`) · compare branches · commit search (6 modes) |
| **Blame** | Inline current line · full-file gutter (⌘⌥B) · hover shows commit |
| **Stash** | Tree view · apply / pop / drop · auto-stash-and-retry on dirty tree |
| **Tags** | Create lightweight/annotated · push · delete local/remote |
| **Remotes** | List · add · fetch with prune · rename · change URL · remove · open in browser |
| **Push/Pull** | Preview commits · merge / rebase / fetch-only · force-with-lease |
| **Conflicts** | Status bar badge · QuickPick → 3-way merge editor · continue / abort |
| **Reflog** | Browser · checkout · reset (soft/mixed/hard) · cherry-pick |
| **Submodules** | Tree · init · update · sync |
| **Local history** | Auto-snapshot · diff · restore (vsce-scheme) |
| **Status bar** | Current branch + dirty marker |

---

## Commands

All commands live under the `Rebased:` prefix in the Command Palette.

| Command | Default key |
|---|---|
| Commit Wizard… | <kbd>⌘⌥C</kbd> |
| Branches… | <kbd>⌘⇧B</kbd> |
| Show File History | <kbd>⌘⌥H</kbd> |
| Toggle Full-File Blame | <kbd>⌘⌥B</kbd> |
| Search Commits… | <kbd>⌘⌥F</kbd> |
| Amend Last Commit | <kbd>⌘⌥K</kbd> |

Discover all of them via `Cmd+Shift+P → Rebased:`.

---

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `rebased.log.maxCommits` | `2000` | Max commits loaded per batch in the log view |
| `rebased.log.allBranches` | `true` | Include `--all` in `git log` |
| `rebased.rebase.autoStash` | `true` | Auto-stash before starting interactive rebase |
| `rebased.gitPath` | `git` | Path to the git executable |
| `rebased.blame.enabled` | `true` | Inline current-line blame |
| `rebased.localHistory.maxPerFile` | `50` | Per-file snapshot retention |
| `rebased.localHistory.maxBytes` | `1048576` | Skip snapshots for files larger than this |

---

## Install

### From `.vsix`

```bash
git clone https://github.com/funchs/vscode-rebased
cd vscode-rebased
npm install
npm run build
npx @vscode/vsce package --allow-missing-repository
code --install-extension vscode-rebased-*.vsix
```

> After install you must **Developer: Reload Window** in any already-open VS Code window
> — extensions are loaded once at startup.

### Development (Extension Host)

```bash
npm install
npm run build
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with this extension loaded.

---

## Testing

```bash
npm test
```

Runs five chained suites:

```
smoke          6 checks   pure parser round-trips, real-repo graph layout
integration    9 tests    ephemeral git repos: renames, conflicts, reflog, update-project, edge repos
edge-cases     8 tests    octopus merges, rename detection, EOF markers, malformed input
cc            12 tests    Conventional Commits parser / validator / formatter
notify        12 tests    codicon stripping, dirty-tree heuristic, multi-line summarizer, lock detection, untracked collision parser
```

Total: **47 passing**.

---

## Architecture

```
src/
├── core/                 # git CLI wrapper (spawn, no shell), repo watcher, CC parser, blame parser, notify helpers
├── m0-rebase/            # CustomTextEditorProvider for git-rebase-todo
├── m1-log/               # WebviewViewProvider, swim-lane layout, details panel, search, file history, compare
├── m2-commit/            # Staging view, hunks, changelists, commit wizard
├── m3-stash/             # Stash / branches / tags / remotes / reflog / conflict / submodule pickers
├── m4-settings/          # Inline blame, gutter blame, local history, status bar
└── webview/              # Browser-bundled webview scripts (esbuild IIFE)
```

All UI is vanilla TypeScript + HTML + VS Code theme CSS variables. No React.
Webview ↔ extension communicates over `postMessage` only.

---

## Security

- All git invocations go through `runGit()` in `src/core/git.ts`, which uses `spawn` with `shell: false` and an argv array — no shell interpolation possible.
- Webviews use a strict CSP with nonce-gated scripts.
- File content rendered into the DOM uses `textContent`, never `innerHTML` with untrusted strings.

---

## Roadmap

- Submodule diff against parent
- PR integration (GitHub via `gh` CLI)
- Semantic highlighting in the log subject column (Conventional Commits type chips)
- Performance: persistent log index for instant 100k-commit repos

## License

[MIT](LICENSE)
