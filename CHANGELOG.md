# Changelog

All notable changes to this extension are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Branches sidebar: JetBrains-style direct right-click actions.** The
  Branches tree now exposes the full action set per node — previously the
  only way to merge / rebase / rename / delete / push-set-upstream a branch
  was the `Rebased: Branches…` QuickPick (⌘⇧B), which forced "pick branch →
  pick action" two steps. The tree's context menu now groups by branch type
  (current / local / remote), with a `9_danger` group at the bottom.

  New per-row commands: `rebased.branch.merge`, `rebased.branch.rebaseOnto`,
  `rebased.branch.rename`, `rebased.branch.delete`, `rebased.branch.newFromHere`,
  `rebased.branch.pushSetUpstream`, `rebased.branch.pushForce`,
  `rebased.branch.fetch`, `rebased.branch.deleteRemote`,
  `rebased.branch.resetTo`, `rebased.branch.copyName`.

  Destructive actions (force-push, hard-reset, delete on remote) gate behind
  a modal warning; merge / rebase keep the existing "Stash and retry" recovery.

- **Click a branch in the tree → opens the Log filtered to that branch.**
  Added `rebased.log.showBranch` command and an inbound `setBranchFilter`
  message on the Log webview; `BranchItem` now carries that command, so the
  click fires per `workbench.list.openMode` (single- or double-click).

### Changed

- Branches view title bar's "New Branch" icon switched from `$(git-branch)`
  to `$(add)` — the previous icon duplicated the adjacent `$(git-branch)`
  for the Branches QuickPick. Aligns with the "create" icon convention used
  by Stashes / Changelists.
- `BranchItem.contextValue` split from a single `"branch"` into three
  variants — `branch-current`, `branch-local`, `branch-remote` — so the
  context menu can hide actions that don't apply (e.g. Delete on the
  current branch, Delete on Remote for local branches).
- Action-execution body extracted from `branches-picker.ts` into a shared
  `performBranchAction(repos, root, action, name, opts)` helper. The
  QuickPick and the new context-menu commands now go through the same code
  path — single source of truth for error handling, dirty-tree recovery,
  and status-bar feedback.

## [0.1.4] - 2026-05-13

### Changed
- **Status bar Log entry shrunk to an icon.** User feedback: the
  `⎇ develop_v0.2*` chip duplicated VS Code's built-in git item right
  next to it. Replaced the branch-name text with just `$(history)` (or
  `$(history) N` when there are N stashes — a count the built-in chip
  doesn't surface). Tooltip now uses a MarkdownString with branch +
  stash count + click hint, so the info is one hover away without
  taking horizontal real estate.

## [0.1.3] - 2026-05-13

### Changed
- **Log view moved to the bottom panel** (terminal row). The swim-lane graph
  benefits from horizontal real estate that the sidebar can't give it, and
  switching context from code → log via Cmd+J feels closer to how Source
  Control panels work in JetBrains IDEs. Users who prefer the sidebar can
  drag the view back via right-click → Move View.
- **Status bar branch chip is now the Log shortcut**. Click `⎇ main*` to
  focus the Log panel instead of opening the New Branch dialog. Branch
  creation moves to `Rebased: Branches…` (⌘⇧B) or the Branches sidebar.

### Added
- `rebased.log.openPanel` command — reveals the bottom panel and focuses
  the Log view. Wired to the status bar click; also reachable from the
  command palette.

## [0.1.2] - 2026-05-13

### Fixed
- View names in the activity-bar sidebar (Log / Commit / Stashes / Branches /
  Changelists / Submodules) stayed English in Antigravity and other VS Code
  forks that emit the BCP 47 locale tag `zh-Hans` instead of the legacy
  VS Code tag `zh-cn`. Added `package.nls.zh-Hans.json` +
  `l10n/bundle.l10n.zh-Hans.json` aliases so both naming conventions resolve.

## [0.1.1] - 2026-05-13

First Open VSX release. Builds on 0.1.0 with i18n, more screenshots, and
production-ready conflict handling discovered during real-world use.

### Added
- **Update Project (⌘⌥T)** — JetBrains-style one-shot pipeline: stash → fetch → pull rebase/merge → pop, with full conflict routing at any step.
- **Conflict resolver webview** — JetBrains-style file list with per-file actions (采用我方 / 采用对方 / 合并… / 重置), state-aware finalize button.
- **Orphan-unmerged state detection** — when UU files exist without a formal rebase/merge/cherry-pick in progress (e.g. previous op was reset away), route to conflict panel instead of attempting to stash.
- **Untracked-file collision dialog** — when stash pop is blocked by upstream files of the same name, offer Keep upstream / Restore from stash (overwrite) / Compare per file / Keep stash.
- **Index-lock recovery** — silent retry after 600ms on transient races (VS Code's built-in git extension); modal dialog with "Remove lock and retry" for stale locks; "Run diagnostic / Run in terminal / Show output" actions when retries fail.
- **Repository diagnostic** (`rebased.diagnose`) — 7-check health report covering permissions, lock state, fsck, cloud-sync path heuristic, disk free.
- **Rebased Git output channel** (`rebased.showOutput`) — full argv / stderr / exit code / elapsed time of every git invocation.

### Added — UX
- **Internationalization** via `vscode.l10n` — follows VS Code locale automatically. Full Simplified Chinese translation for ~280 strings: command titles, view names, all toasts, all QuickPick items, every webview label.
- **Screenshots** — 8 illustrative mockups + a hero animated GIF generated from them, embedded inline in the README.

### Fixed
- Codicon-prefix labels (`$(git-merge) Merge into current`) rendered as literal text in toast notifications because `showErrorMessage` doesn't parse codicons. Switched stuck-index error from toast to modal so all recovery buttons stay visible.
- Multi-line git errors collapsed to a single line in toasts. New `showGitError` helper surfaces a summary + "Details" button that opens a modal with the full multi-line output.
- 8 broken comparisons where `if (ok !== "English")` checks were left after the corresponding label got translated. Now using label-constant pattern.
- `git show --name-status` missed renames because rename detection isn't on by default. Now passes `-M` flag (also for numstat).
- `parseTodo` rejected lines with leading whitespace and single-token actions (`break`). Now tolerant of both.

### CI / infrastructure
- `actions/checkout@v4` now uses `fetch-depth: 0` so the smoke test's `git log` against the repo itself sees real history.
- Release workflow makes both `VSCE_PAT` and `OVSX_PAT` independently optional — publishes to whichever one(s) you have a secret for.
- Issue templates, PR template, CONTRIBUTING.md, Dependabot config added for public repo readiness.

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
