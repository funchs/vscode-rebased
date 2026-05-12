# Publishing checklist

This document covers the steps to publish a new version of Rebased to the
[VS Code Marketplace](https://marketplace.visualstudio.com/) (and optionally
[Open VSX](https://open-vsx.org/)).

---

## One-time setup (manual — Claude can't do these)

### 1. Create an Azure DevOps publisher

The Marketplace identifies publishers by name. The `publisher` field in
`package.json` is currently `"rebased"` — pick whatever you want and register it:

1. Sign in at <https://aka.ms/vscode-create-publisher>.
2. Verify your email; choose a publisher ID (lowercase, hyphens OK). Update
   `package.json` → `"publisher"` to match.
3. From your Azure DevOps user settings ("User → Security → Personal access
   tokens"), create a token with:
   - **Organization**: All accessible organizations
   - **Scope**: `Marketplace → Manage`
   - Expiry: ≤ 1 year is recommended; rotate before then.
4. Save the token somewhere safe — you will not see it again.

### 2. (Optional) Open VSX publisher

VSCodium and other forks pull extensions from <https://open-vsx.org/>. To
publish there too:

1. Sign in at <https://open-vsx.org/> with GitHub.
2. Claim a namespace matching your publisher ID.
3. Create an access token under "User → Settings → Access Tokens".

### 3. Wire secrets to GitHub Actions

In your GitHub repo → Settings → Secrets and variables → Actions:

| Secret name | Source |
|---|---|
| `VSCE_PAT` | Azure DevOps PAT from step 1 |
| `OVSX_PAT` | Open VSX token from step 2 (optional) |

The release workflow (`.github/workflows/release.yml`) reads these.

### 4. Update repository URLs in `package.json`

Replace the placeholder `github.com/example/vscode-rebased` with your real
GitHub repo URL in `repository.url`, `bugs.url`, and `homepage`.

### 5. Capture screenshots

The README references several screenshots under `docs/screenshots/`. The
extension can't take its own screenshots — open the Extension Development
Host (`F5`) against any sizable repo (e.g. clone `microsoft/vscode`), open
each feature, and capture:

| File | What to show |
|---|---|
| `docs/screenshots/rebase-editor.png` | The drag-drop editor mid-drag with a few rows |
| `docs/screenshots/log-graph.png` | Log view with multiple branches converging |
| `docs/screenshots/commit-details.png` | A commit's details panel beside the log |
| `docs/screenshots/commit-wizard.png` | The wizard QuickPick at the type step |
| `docs/screenshots/blame-gutter.png` | Full-file blame on a real file |
| `docs/screenshots/local-history.png` | The local history picker with restore action |

Tip: macOS `⌘⇧4` then space → click the VS Code window for a clean, shadowed
PNG. Compress with `pngquant` before committing if they're large.

---

## Per-release flow

The repo's CI does the heavy lifting on tag push. Locally:

```bash
# 1. Bump version (semver). Pre-1.0 use 0.minor.patch for breaking → minor.
npm version minor   # or: patch / major

# 2. Edit CHANGELOG.md — move "Unreleased" content under the new version header.

# 3. Push the tag. CI's release.yml takes over from here.
git push --follow-tags
```

The release workflow runs `npm test`, packages the `.vsix`, publishes to the
Marketplace (and Open VSX if `OVSX_PAT` is set), and attaches the `.vsix` to
the GitHub release page.

---

## Manual publish (escape hatch)

If you ever need to publish from your machine:

```bash
# Marketplace
npx @vscode/vsce login <publisher-id>   # paste your PAT
npx @vscode/vsce publish

# Open VSX
npx ovsx create-namespace <publisher-id> -p $OVSX_PAT   # one time
npx ovsx publish *.vsix -p $OVSX_PAT
```

---

## Verifying a published version

1. Search for your extension name in VS Code: **Extensions** view, search box.
2. The store page should show your icon, banner, screenshots, README rendered
   from `README.md`, and the latest version from `package.json`.
3. Click **Uninstall** then **Install** to do a smoke test of the published
   bundle (not your local source).

---

## Yanking a broken release

```bash
npx @vscode/vsce unpublish <publisher>.vscode-rebased <broken-version>
```

The Marketplace does NOT keep historical bundles available, so users who
already installed the broken version will keep it until they reinstall the
prior good version explicitly (e.g. `code --install-extension <name>@<good-ver>`).
Plan accordingly.
