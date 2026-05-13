# Contributing to Rebased

Thanks for your interest. This is a small project that aims to stay focused —
JetBrains-style git workflows for VS Code, no more. Please read this before
opening a substantial PR.

## Scope guidelines

We're trying to **not** become another GitLens. Specifically:

- **Yes**: features the IntelliJ git client has that VS Code's built-in git +
  GitLens don't cover well (interactive rebase, changelists, hunk staging,
  Update Project, local history, etc.).
- **Maybe**: tighter integration with existing flows (better error UX, more
  context-aware QuickPicks, additional `git` plumbing wrappers).
- **No**: anything that competes directly with GitLens (inline current-line
  blame is an exception we keep because it's tiny). PR previews, AI commit
  messages, hover popups everywhere — out of scope.

If unsure, open an issue first.

## Setup

```bash
git clone https://github.com/funchs/vscode-rebased
cd vscode-rebased
npm install
npm run build
```

Open the folder in VS Code, press <kbd>F5</kbd> to launch an Extension
Development Host with your changes loaded.

## Tests

```bash
npm test
```

Runs five chained suites:

| Suite | What it covers |
|---|---|
| `smoke-test.mjs` | Pure-function round-trips (rebase-todo, graph layout) |
| `integration-test.mjs` | Ephemeral git repos: renames, conflicts, reflog, edge repos |
| `edge-cases-test.mjs` | Octopus merges, rename detection, EOF markers, malformed input |
| `cc-test.mjs` | Conventional Commits parser / validator / formatter |
| `notify-test.mjs` | Codicon stripping, dirty-tree heuristic, multi-line summarizer |

When adding features that touch git plumbing, add an integration test that
spawns a real ephemeral repo via `mkRepo()` (see `scripts/test-helpers.mjs`).
For pure parsers / layout logic, add a unit case to `edge-cases-test.mjs`.

## Code style

- TypeScript strict mode, `noUnusedLocals`, `noUnusedParameters`.
- Vanilla TS for webviews — **no React / Vue / Svelte**. Keeps the bundle
  small and load fast.
- Always `spawn` (never `exec`) with `shell: false` for git invocations.
- Webview DOM updates use `textContent`, never `innerHTML` with untrusted data.
- Strict CSP + nonce on every webview HTML.

## i18n

Every user-facing string must:

1. Go through `vscode.l10n.t("English source", ...args)` in extension code.
2. Have an entry in `l10n/bundle.l10n.json` (English fallback) **and**
   `l10n/bundle.l10n.zh-cn.json` (Chinese).
3. Use `{0}`, `{1}` placeholders for runtime interpolation — never
   `${...}` template literals around the translated string.
4. For webview JS labels: pass the localized string via the per-webview
   `window.__rebasedL10n` bundle injected in the HTML template.

For manifest contributions in `package.json`, use `%key%` references and
add the actual strings to `package.nls.json` and `package.nls.zh-cn.json`.

## Commits

Conventional Commits format (the same one the Commit Wizard produces):

```
type(scope): short subject

Optional body explaining what and why.
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`. Append `!` for breaking changes and add a
`BREAKING-CHANGE:` footer.

## PR checklist

The PR template walks you through it. Briefly:

- [ ] `npm test` passes
- [ ] Typecheck clean (`npx tsc --noEmit`)
- [ ] CHANGELOG `Unreleased` updated
- [ ] New strings translated
- [ ] Screenshots for UI changes

## Architecture quick map

```
src/
├── core/                 # git CLI wrapper, repo watcher, CC parser, notify
├── m0-rebase/            # CustomTextEditorProvider for git-rebase-todo
├── m1-log/               # WebviewViewProvider, swim-lane layout, details, search
├── m2-commit/            # Staging, hunks, changelists, commit wizard
├── m3-stash/             # Stash / branches / tags / remotes / reflog / conflicts
├── m4-settings/          # Inline blame, gutter blame, local history, status bar
└── webview/              # Browser-bundled webview scripts (esbuild IIFE)
```

Webview ↔ extension only via `postMessage`. No direct DOM access from the
extension side.

## Releasing (maintainers only)

See [PUBLISHING.md](./PUBLISHING.md).
