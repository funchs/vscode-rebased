import * as vscode from "vscode";
import { getStatus, stage, unstage, commit, runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { ChangelistManager } from "./changelists";
import { asset, csp, nonce } from "../core/webview-util";
import { showGitError } from "../core/notify";

export class CommitViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "rebased.commit";
  private view?: vscode.WebviewView;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly repos: RepoManager,
    private readonly changelists: ChangelistManager
  ) {
    repos.onChange(() => void this.refresh());
  }

  postMessage(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "out"), vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(async (msg) => {
      const root = this.repos.root;
      if (!root) return;
      switch (msg.type) {
        case "ready":
          await this.refresh();
          break;
        case "stage":
          await stage(root, msg.paths);
          this.repos.fire();
          break;
        case "unstage":
          await unstage(root, msg.paths);
          this.repos.fire();
          break;
        case "diff": {
          const uri = vscode.Uri.joinPath(vscode.Uri.file(root), msg.path);
          await vscode.commands.executeCommand("git.openChange", uri);
          break;
        }
        case "hunks":
          await vscode.commands.executeCommand("rebased.hunks.open", msg.path);
          break;
        case "wizard":
          await vscode.commands.executeCommand("rebased.commit.wizard");
          break;
        case "commit":
        case "commitAndPush": {
          if (!msg.message?.trim()) {
            vscode.window.showWarningMessage(vscode.l10n.t("Commit message cannot be empty."));
            return;
          }
          try {
            await commit(root, msg.message, {
              amend: !!msg.amend,
              signoff: !!msg.signoff,
              gpgSign: !!msg.gpgSign,
              author: msg.author || undefined,
            });
            if (msg.type === "commitAndPush") {
              try {
                await runGit(["push"], { cwd: root });
                vscode.window.showInformationMessage(vscode.l10n.t("Committed and pushed."));
              } catch (e: unknown) {
                await showGitError("Push", e, [
                  {
                    label: vscode.l10n.t("Set upstream + retry"),
                    run: async () => {
                      try {
                        const branch = (await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: root })).trim();
                        await runGit(["push", "--set-upstream", "origin", branch], { cwd: root });
                      } catch (e2) {
                        await showGitError("Push (set upstream)", e2);
                      }
                    },
                  },
                ]);
              }
            } else {
              vscode.window.showInformationMessage(vscode.l10n.t("Committed."));
            }
            this.repos.fire();
          } catch (e: unknown) {
            await showGitError("Commit", e);
          }
          break;
        }
        case "openStashes":
          await vscode.commands.executeCommand("rebased.stash.focus");
          break;
        case "rollback":
          await this.rollback(root, msg.paths);
          break;
        case "moveToChangelist":
          await this.moveToChangelist(msg.paths);
          break;
        case "commitChangelist": {
          if (!msg.message?.trim()) {
            vscode.window.showWarningMessage(vscode.l10n.t("Commit message cannot be empty."));
            return;
          }
          try {
            await this.changelists.commitChangelist(msg.list, msg.message);
            vscode.window.showInformationMessage(vscode.l10n.t("Committed changelist {0}.", msg.list));
          } catch (e) {
            await showGitError(`Commit changelist "${msg.list}"`, e);
          }
          break;
        }
        case "newChangelist": {
          const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("New changelist name") });
          if (!name) return;
          await this.changelists.createList(name);
          break;
        }
      }
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const root = this.repos.root;
    if (!root) {
      this.view.webview.postMessage({ type: "empty" });
      return;
    }
    try {
      const files = await getStatus(root);
      const clState = this.changelists.state();
      const buckets = this.changelists.classify(files.map((f) => f.path));
      const pathToList: Record<string, string> = {};
      for (const [list, paths] of buckets) for (const p of paths) pathToList[p] = list;

      this.view.webview.postMessage({
        type: "status",
        files,
        changelists: {
          names: Object.keys(clState.lists),
          active: clState.active,
          pathToList,
        },
      });
    } catch (e: unknown) {
      this.view.webview.postMessage({ type: "error", message: (e as Error).message });
    }
  }

  private async moveToChangelist(paths: string[]): Promise<void> {
    if (!paths?.length) return;
    const state = this.changelists.state();
    const names = Object.keys(state.lists);
    const NEW_LIST = "+ " + vscode.l10n.t("New changelist…");
    const choices = [...names, NEW_LIST];
    const target = await vscode.window.showQuickPick(choices, {
      placeHolder: paths.length === 1
        ? vscode.l10n.t("Move {0} to…", paths[0])
        : vscode.l10n.t("Move {0} files to…", String(paths.length)),
    });
    if (!target) return;
    let listName = target;
    if (target === NEW_LIST) {
      const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("New changelist name") });
      if (!name) return;
      await this.changelists.createList(name);
      listName = name;
    }
    for (const p of paths) await this.changelists.assignFile(listName, p);
  }

  // "Rollback" = discard local changes for given paths (revert working tree).
  // Tracked: `git restore --staged --worktree --source=HEAD`. Untracked: `git
  // clean -f` (deletes from disk). We split paths by current status so each
  // git invocation only sees paths it knows about.
  private async rollback(root: string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    const all = await getStatus(root);
    // A path may have both staged+unstaged entries — collapse to one classification.
    const isUntracked = new Set(all.filter((f) => f.status === "?").map((f) => f.path));
    const tracked = paths.filter((p) => !isUntracked.has(p));
    const untracked = paths.filter((p) => isUntracked.has(p));

    const detail = [
      tracked.length ? vscode.l10n.t("{0} tracked file(s) will be reset to HEAD", String(tracked.length)) : "",
      untracked.length ? vscode.l10n.t("{0} untracked file(s) will be DELETED from disk", String(untracked.length)) : "",
    ].filter(Boolean).join("\n");
    const ok = await vscode.window.showWarningMessage(
      vscode.l10n.t("Rollback {0} file(s)? Working-tree changes will be lost.", String(paths.length)),
      { modal: true, detail },
      vscode.l10n.t("Rollback")
    );
    if (!ok) return;
    try {
      if (tracked.length) {
        await runGit(["restore", "--staged", "--worktree", "--source=HEAD", "--", ...tracked], { cwd: root });
      }
      if (untracked.length) {
        // -f required; we do not pass -d (folders) to stay conservative.
        await runGit(["clean", "-f", "--", ...untracked], { cwd: root });
      }
      this.repos.fire();
      vscode.window.setStatusBarMessage(
        `$(discard) ${vscode.l10n.t("Rolled back {0} file(s)", String(paths.length))}`,
        3000
      );
    } catch (e) {
      await showGitError("Rollback", e);
    }
  }

  private html(webview: vscode.Webview): string {
    const n = nonce();
    const script = asset(webview, this.ctx, "out", "webview", "commit.js");
    const style = asset(webview, this.ctx, "media", "commit.css");
    const codicon = asset(webview, this.ctx, "media", "codicons", "codicon.css");
    const T = vscode.l10n.t;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    // Only strings the webview JS resolves dynamically (via t("key", ...))
    // need bridging here. HTML labels are translated at template time via
    // ${esc(T("..."))}, so they don't appear in this bundle.
    const l10nBundle = {
      // Dynamic tooltips / status text
      file: T("{0} file"),
      files: T("{0} files"),
      stagedSuffix: T("staged"),
      groupRoot: T("(root)"),
      emptyChanges: T("No local changes."),
      commitOnly: T("Commit only this changelist"),
      // Row-button tooltips
      stageTitle: T("Include in commit"),
      unstageTitle: T("Exclude from commit"),
      hunksTitle: T("Stage individual hunks"),
      rollbackRow: T("Rollback this file"),
      // Section-action tooltip (computed: which paths get rolled back)
      rollbackBulkSel: T("Rollback {0} selected file(s)"),
      rollbackBulkAll: T("Rollback all {0} file(s)"),
      // CC live validator chips / messages
      breakingChip: T("BREAKING"),
      ccValid: T("Conventional Commit"),
      ccUnknownType: T("Unknown type"),
      ccLowercaseType: T("Type should be lowercase"),
      ccCharCount: T("{0} chars (recommended ≤ 72)"),
      ccNoPeriod: T("No period at end"),
      ccLowercaseSubject: T("Lowercase subject"),
      ccBlankLineAfterHeader: T("Blank line after header"),
      ccHeaderFormat: T("Header must be type(scope)?[!]: subject"),
    };
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(webview, n)}" />
<link rel="stylesheet" href="${codicon}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<div id="empty" class="empty">${esc(T("No git repository."))}</div>

<div id="app">
  <!-- Collapsible Changes section, SCM-style -->
  <header id="changes-header" class="section-header" role="button" tabindex="0" aria-expanded="true">
    <span class="caret codicon codicon-chevron-down"></span>
    <span class="section-name">${esc(T("Changes"))}</span>
    <span id="files-count" class="count-pill"></span>
    <button id="bulk-rollback" class="section-action" title="${esc(T("Rollback selected (or all)"))}" hidden>
      <span class="codicon codicon-discard"></span>
    </button>
  </header>

  <ul id="changes" class="filelist"></ul>

  <!-- Commit message area -->
  <section class="message">
    <div class="cc-toolbar">
      <span id="cc-badges"></span>
      <span class="spacer"></span>
      <button id="wizard" type="button" class="link-btn" title="${esc(T("Run commit wizard"))}">${esc(T("Wizard…"))}</button>
    </div>
    <textarea id="msg" placeholder="${esc(T("Message  (type(scope): subject)"))}" rows="3"></textarea>
    <div id="cc-status" class="cc-status"></div>

    <div class="actions">
      <label class="amend-label">
        <input type="checkbox" id="amend" /><span>${esc(T("Amend"))}</span>
      </label>
      <button class="cog" data-act="options" title="${esc(T("Commit options…"))}" aria-label="${esc(T("Commit options…"))}">
        <span class="codicon codicon-settings-gear"></span>
      </button>
      <div class="dropdown-menu opts-menu" id="opts-menu">
        <label><input type="checkbox" id="opt-signoff" /> ${esc(T("Sign off (Signed-off-by)"))}</label>
        <label><input type="checkbox" id="opt-gpg" /> ${esc(T("GPG sign (-S)"))}</label>
        <label class="author-field">
          <span>${esc(T("Override author"))}</span>
          <input type="text" id="opt-author" placeholder="${esc(T("Name <email>"))}" />
        </label>
      </div>

      <span class="spacer"></span>

      <div class="split-btn">
        <button id="commit" class="primary">${esc(T("Commit"))}</button>
        <button id="commit-chevron" class="primary chevron" title="${esc(T("More commit actions"))}" aria-haspopup="true">
          <span class="codicon codicon-chevron-down"></span>
        </button>
      </div>
      <ul class="dropdown-menu" id="commit-menu">
        <li data-cmd="push">${esc(T("Commit and Push"))}</li>
        <li data-cmd="amend">${esc(T("Commit (amend, no edit)"))}</li>
        <li class="sep"></li>
        <li data-cmd="showDiff">${esc(T("Show Diff"))}</li>
        <li data-cmd="hunks">${esc(T("Open Hunk Editor"))}</li>
        <li data-cmd="move">${esc(T("Move to changelist…"))}</li>
        <li class="sep"></li>
        <li data-cmd="openStashes">${esc(T("Open Stashes view"))}</li>
        <li data-cmd="rollback" class="danger">${esc(T("Rollback…"))}</li>
      </ul>
    </div>
  </section>
</div>

<script nonce="${n}">window.__rebasedL10n=${JSON.stringify(l10nBundle)};</script>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
