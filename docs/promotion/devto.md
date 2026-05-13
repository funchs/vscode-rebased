---
title: "I rebuilt JetBrains' Git client as a VS Code extension. Here's what was missing."
published: false
tags: vscode, git, productivity, opensource
cover_image: https://raw.githubusercontent.com/funchs/vscode-rebased/main/docs/screenshots/cover.png
canonical_url:
---

After a year on IntelliJ I went back to VS Code for a new project. Three weeks
in, three things from JetBrains' git client never stopped grating:

1. **Drag-and-drop interactive rebase.** GitLens has a table editor with up/down
   buttons. It works. It's not the same as physically dragging a row.
2. **"Update Project"** — one command that stashes uncommitted work, fetches,
   pulls with rebase, pops, and routes you into conflict resolution at any
   broken step. The flow I used twenty times a day.
3. **Changelists** — uncommitted edits bucketed into named groups, each its
   own partial commit ready to send.

None of these had a VS Code equivalent that satisfied. So I built one.

**[Rebased](https://github.com/funchs/vscode-rebased)** is now on Open VSX:

```
ext install funchs.vscode-rebased
```

(Works in Cursor, VSCodium, code-server, etc. VS Code Marketplace publishing
is a separate Azure DevOps song-and-dance, on the to-do list.)

![Rebased — JetBrains-style Git client for VS Code](https://raw.githubusercontent.com/funchs/vscode-rebased/main/docs/screenshots/cover.png)

## What's actually in it

**Interactive rebase editor.** Open any `git-rebase-todo` (the file `git rebase
-i` opens by default), or trigger via `GIT_SEQUENCE_EDITOR='code --wait' git
rebase -i HEAD~5`. You get a webview with draggable rows and clickable action
chips. ⌘⏎ to save and continue the rebase. Drop rows get a strikethrough
preview so you see the result before committing.

**Update Project (⌘⌥T).** The whole pipeline as one command:

```
dirty? → silent stash → fetch --all --prune → pull --rebase (or merge)
                                                 ↓
                                            pop stash
                                                 ↓
              conflict at any step → conflict resolver panel
                                                 ↓
                                          finalize (drop stash / continue rebase)
```

Three real conflict types are handled distinctly:
- **CONTENT** (both sides modified) → 3-way merge editor per file
- **UNTRACKED COLLISION** (upstream just introduced a file your stash also
  carries) → modal with Keep upstream / Restore from stash / Compare per file
- **ORPHAN UU** (UU files in working tree but no active rebase / merge —
  happens when a previous op was reset away) → status detection + finalize
  path

**Changelists.** Workspace-state-backed named groups of paths. A
right-click "Move to Changelist…" on any file row sorts your changes; each
list has its own "Commit Changelist…" action that stages only the listed
paths.

**Conflict resolver panel.** JetBrains-style file list, per-file
*Accept yours* / *Accept theirs* / *Merge…* (opens VS Code's built-in
3-way) / *Reset*. Footer carries a state-aware finalize button that
adapts to whether you're in rebase / merge / cherry-pick / revert /
stash-pop / orphan-unmerged.

**Local history.** Every save snapshots the file into `globalStorage`.
Browse with a QuickPick, diff against current, or restore. Works on files
that aren't even in git yet.

**Log graph in the bottom panel.** Swim-lane rendering with virtual
scrolling. Sticky filter toolbar across subject / author / path / branch /
since. Click any commit → details panel on the side with the file list +
per-file diff-against-parent.

**Conventional Commits validator.** Live chips for type/scope/BREAKING
above the commit textarea, status row showing ✓ / ⚠ / ✕. The 5-step Commit
Wizard (⌘⌥C) auto-suggests scopes mined from recent commits, with
recency-weighted ranking.

**Inline blame** for the current line; **gutter blame** for the whole
file (⌘⌥B) with same-commit row collapsing.

**i18n** follows VS Code's locale — English and Simplified Chinese ship
out of the box. ~280 strings translated, including manifest contributions
and webview JS labels.

## Why bother when GitLens exists

GitLens is fantastic at blame, line history, code lens, search. Rebased
deliberately stays out of that lane and focuses on the JetBrains-style
*workflow* features:

| Feature | GitLens | Built-in git | Rebased |
|---|---|---|---|
| Inline current-line blame | ✓ | — | ✓ |
| Drag-drop interactive rebase | table editor only | — | ✓ drag-and-drop |
| Update Project pipeline | — | — | ✓ |
| Conflict resolver dashboard | — | UU files in source control | ✓ webview panel |
| Changelists | — | — | ✓ |
| Local history | — | — | ✓ |
| Log graph | ✓ paid | ✓ basic | ✓ free |
| Commit wizard with CC validator | — | — | ✓ |

The two extensions coexist; install both, they don't overlap.

## A note on how it was built

I built the whole thing with Claude in roughly 50 hours of pair-programming
sessions. Two stories worth telling:

**The bug I'd have spent a day finding.** Initial test runs were green
locally, red on CI. After tracking down the diff, it turned out my `git
log` invocation passed a NUL byte inside an argv string (as a record
separator). On Node 20 it was tolerated. On Node 22+ `spawn` validates
argv against NUL and rejects the call. Fix: use `git log -z` to emit
NUL on stdout instead of embedding it in argv. Claude noticed it in 30
seconds while writing test scaffolding.

**The bug I almost shipped.** When checkout / merge / rebase fail on
dirty trees, I show an error toast. The toast title was
`$(git-merge) Merge into current: <error>` — except VS Code only renders
codicons in QuickPick and status bar, not in toasts, so users saw the
literal text `$(git-merge)`. The fix took 4 rounds with screenshots
because each round was "still seeing $(git-merge)"… because the
notification window had cached the old extension instance. The lesson
was less about codicons and more about Extension Development Host
reload semantics — a thing you only learn the painful way.

The repo has CONTRIBUTING.md with scope guidelines, an issue template
that requires the diagnostic report up front (saves a triage round-trip),
and Dependabot wired. All from a solo developer + an AI, but engineered
like a small team's project. CI runs `npm test` across 3 OS × 2 Node
versions; release on `v*.*.*` tags publishes to Open VSX automatically.

## Try it

```
ext install funchs.vscode-rebased
```

Or from source:

```
git clone https://github.com/funchs/vscode-rebased
cd vscode-rebased
npm install && npm run build
npx @vscode/vsce package --allow-missing-repository
code --install-extension vscode-rebased-*.vsix
```

Bug reports welcome — the issue template asks you to paste a
`rebased.diagnose` output, which I added precisely so this part wouldn't
require a triage round. Feature requests with a "this is what JetBrains
does and VS Code doesn't" framing have the strongest priority.

GitHub: https://github.com/funchs/vscode-rebased
Open VSX: https://open-vsx.org/extension/funchs/vscode-rebased
