# Twitter / X thread — 10 tweets

> Post the first tweet, then reply to your own tweets in sequence.
> Attach the suggested image to each. All images are at
> `docs/screenshots/*.png` — drop them when you draft the tweets.

---

## 1/10  (hook — attach cover.png)

```
After a year on JetBrains I switched back to VS Code.

Three weeks in, I missed three git features so much I built a new
extension.

→ Drag-and-drop interactive rebase
→ "Update Project" pipeline
→ Changelists

It's free, open-source, on Open VSX today.  ↓
```

Image: `docs/screenshots/cover.png`

---

## 2/10  (rebase editor)

```
Drag-and-drop interactive rebase.

`git rebase -i HEAD~5` opens a webview where rows DRAG. Action chips
(pick/reword/squash/edit/drop) cycle on click. DROP rows preview as
strikethrough.

⌘⏎ saves and continues the rebase.

GitLens has a table editor — not the same.
```

Image: `docs/screenshots/rebase-editor.png`

---

## 3/10  (update project)

```
"Update Project" — one command for the whole pipeline:

  dirty? → silent stash
         → fetch --all --prune
         → pull --rebase
         → pop stash
         → conflicts at any step → resolver panel
         → finalize (drop stash / continue rebase)

⌘⌥T. Twenty times a day in IntelliJ. Now in VS Code.
```

(no image needed, or `docs/screenshots/conflict-panel.png`)

---

## 4/10  (conflict resolver)

```
The conflict resolver panel handles three types distinctly:

→ CONTENT conflict (both sides modified) — 3-way merge editor
→ UNTRACKED collision (stash has a file upstream just added) —
  modal with keep-upstream / use-stash / per-file compare
→ ORPHAN UU (UU files but no active rebase) — collected as a
  resolve-first state, blocks further ops until cleared
```

Image: `docs/screenshots/conflict-panel.png`

---

## 5/10  (changelists)

```
Changelists: JetBrains' best-kept feature.

Uncommitted edits, bucketed into NAMED groups. Right-click a file →
"Move to Changelist…". Each list has its own "Commit Changelist…"
that stages only its files.

No more `git add -p` rituals, no more juggling branches mid-feature.
```

Image: `docs/screenshots/changelists.png`

---

## 6/10  (log graph)

```
Log lives in the bottom panel — like Terminal / Problems / Output.

Multi-color swim-lane graph. Virtual scrolling. 5-field filter
toolbar (subject / author / path / branch / since) that actually
runs `--grep --author --since -- <path>` server-side.

Click a commit → side panel with files + per-file diff-against-parent.
```

Image: `docs/screenshots/log-graph.png`

---

## 7/10  (conventional commits)

```
Live Conventional Commits validator above the commit textarea.
Type/scope/BREAKING as colored chips. ✓ valid / ⚠ N warnings / ✕ format.

The Commit Wizard (⌘⌥C) auto-mines scopes from your recent commits,
weighted by recency. Recently-used scopes float to the top.
```

Image: `docs/screenshots/commit-wizard.png`

---

## 8/10  (local history)

```
Local history. Every save auto-snapshots to globalStorage.

Browse, diff against current, or restore — independent of git.
Even works on untracked files.

The recovery-from-bad-rebase feature I never had to invoke in JetBrains
because it was always there. Now it's here too.
```

Image: `docs/screenshots/local-history.png`

---

## 9/10  (built with Claude)

```
The whole thing was built with @AnthropicAI's Claude — ~50 hours of
pair-programming sessions.

Two memorable moments:
1. NUL bytes in argv that Node 22+ silently rejects (CI exposed it)
2. A 4-round debug because `$(codicon)` text leaked into error toasts
   AND because Extension Development Host doesn't reload on rebuild

Both fully chronicled in the CHANGELOG.
```

---

## 10/10  (CTA)

```
Try it:

  ext install funchs.vscode-rebased

Works in Cursor / VSCodium / code-server today via Open VSX.
VS Code Marketplace coming after I finish the Azure DevOps PAT dance.

GitHub: https://github.com/funchs/vscode-rebased
Open VSX: https://open-vsx.org/extension/funchs/vscode-rebased

Bug reports welcome. RT if a JetBrains escapee in your timeline
might need it.
```

Image: `docs/screenshots/wordmark.png`

---

## Notes on posting

- **First tweet matters most.** Hook + image. The other 9 are
  diminishing-return content.
- **Spacing.** Reply to your own tweet rather than threading
  pre-typed; replies look more organic and Twitter / X surfaces
  them better.
- **Time.** Tuesday-Thursday 09:00-11:00 your audience's TZ tends
  to land best for dev content.
- **Hashtags.** Skip on Twitter (looks spammy in 2026 etiquette).
  On LinkedIn or Mastodon, add: #vscode #git #opensource #typescript.
- **Reply game.** Engage with replies for the first 2 hours — that
  window decides how the algorithm pushes the thread.
- **Repost the highlight.** A week later, repost tweet 5 (changelists)
  or tweet 2 (rebase) standalone with a "ICYMI" framing — those two
  resonate strongest with the JetBrains-curious audience.
