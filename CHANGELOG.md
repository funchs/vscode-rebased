# Changelog

All notable changes to this extension are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-12

First public release. JetBrains-style git client features for VS Code.

### Added — Log & history
- Log graph webview with branch lanes, refs, virtual scrolling, context menu.
- Sticky filter toolbar (subject / author / path / branch / since) with live status row.
- Commit details side-panel (subject / body / refs / parents / files with +/- stats; click file → diff vs parent via `git:` scheme).
- Commit search QuickPick across 6 modes (message / author / hash / file / `-S` content / all).
- File-level history (`--follow`) with diff against working / previous / open-at-revision.
- Compare branches: symmetric "in HEAD" / "in target" sections.
- Reflog browser with checkout / reset (soft/mixed/hard with hard-warn) / cherry-pick.

### Added — Commits & staging
- Commit view with stage/unstage, amend, hunk-level staging UI (`git apply --cached`).
- Conventional Commits live validator: type/scope/BREAKING chips, status hints (✓ valid / ⚠ N / ✕).
- Commit wizard: 5-step QuickPick (type → scope-with-mined-suggestions → subject-with-length-hint → body → breaking) → preview → commit.
- Scope miner: ranks recent (≤30d) before total frequency.
- Changelists: workspace-state-backed named groups of working-tree paths; commit a changelist stages only its files.

### Added — Branches, stash, rebase
- Drag-and-drop interactive rebase editor (pick / reword / edit / squash / fixup / drop, ⌘⏎ save).
- Branches QuickPick → 8 actions (checkout / merge / rebase onto / rename / delete / new from here / compare / push --set-upstream).
- Stash tree with create / apply / pop / drop and untracked-include option.
- Tags picker: create lightweight or annotated, push to origin, delete local/remote.
- Remotes picker: list / add / fetch / fetch-all-with-prune / rename / change URL / remove / open URL in browser.
- Submodules tree with init / update / sync, prefix-aware icons for uninitialized / out-of-sync / conflicted.
- Conflict watcher: status bar badge during rebase/merge/cherry-pick/revert; QuickPick to open each file in VS Code's 3-way merge editor, then continue/abort.

### Added — Push/pull, blame, local history
- Push / Pull dialogs preview commits before action; force-with-lease, rebase, fetch-only variants.
- Auto-stash-and-retry inline action when merge / rebase / checkout / pull fails on a dirty tree.
- Inline blame on the current line (author · age · subject) with 120ms debounce + per-file cache.
- Full-file blame gutter (toggle ⌘⌥B) — collapses runs of the same commit; hover shows commit details.
- Local history: auto-snapshot every save into `globalStorage`, browse + diff + restore through a `rebased-history:` scheme.

### Added — UX
- Status bar branch indicator with dirty marker; click to create a new branch.
- Window-focus refresh so external terminal git operations show up immediately.
- Strict CSP + nonce-gated webviews; all DOM writes use `textContent`.
- `showGitError` helper: codicon-free toast summary with a Details button for the full multi-line message.

### Quality
- 38 tests: 5 smoke + 7 integration (ephemeral git repos) + 8 edge cases + 12 Conventional Commits + 6 notify.
- CI-ready `npm test` chains all suites.
- Production bundle: 19 files / ~42 KB.
