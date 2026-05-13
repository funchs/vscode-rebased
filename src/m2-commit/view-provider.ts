import * as vscode from "vscode";
import { getStatus, stage, unstage, commit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { asset, csp, nonce } from "../core/webview-util";
import { showGitError } from "../core/notify";

export class CommitViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "rebased.commit";
  private view?: vscode.WebviewView;

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly repos: RepoManager) {
    repos.onChange(() => void this.refresh());
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
      if (msg.type === "ready") await this.refresh();
      else if (msg.type === "stage") {
        await stage(root, msg.paths);
        this.repos.fire();
      } else if (msg.type === "unstage") {
        await unstage(root, msg.paths);
        this.repos.fire();
      } else if (msg.type === "diff") {
        const uri = vscode.Uri.joinPath(vscode.Uri.file(root), msg.path);
        await vscode.commands.executeCommand("git.openChange", uri);
      } else if (msg.type === "hunks") {
        await vscode.commands.executeCommand("rebased.hunks.open", msg.path);
      } else if (msg.type === "wizard") {
        await vscode.commands.executeCommand("rebased.commit.wizard");
      } else if (msg.type === "commit") {
        if (!msg.message?.trim()) {
          vscode.window.showWarningMessage(vscode.l10n.t("Commit message cannot be empty."));
          return;
        }
        try {
          await commit(root, msg.message, !!msg.amend);
          this.repos.fire();
          vscode.window.showInformationMessage(vscode.l10n.t("Committed."));
        } catch (e: unknown) {
          await showGitError("Commit", e);
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
    const files = await getStatus(root);
    this.view.webview.postMessage({ type: "status", files });
  }

  private html(webview: vscode.Webview): string {
    const n = nonce();
    const script = asset(webview, this.ctx, "out", "webview", "commit.js");
    const style = asset(webview, this.ctx, "media", "commit.css");
    const T = vscode.l10n.t;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    // Strings used inside the webview JS are passed via the init message.
    const l10nBundle = {
      wizardLabel: T("Wizard…"),
      wizardTooltip: T("Run commit wizard"),
      ccValid: T("✓ Conventional Commit"),
      ccUnknownType: T("Unknown type"),
      ccLowercaseType: T("Type should be lowercase"),
      ccCharCount: T("{0} chars (recommended ≤ 72)"),
      ccNoPeriod: T("No period at end"),
      ccLowercaseSubject: T("Lowercase subject"),
      ccBlankLineAfterHeader: T("Blank line after header"),
      ccHeaderFormat: T("Header must be type(scope)?[!]: subject"),
      breakingChip: T("BREAKING"),
      stageTitle: T("Stage"),
      unstageTitle: T("Unstage"),
      hunksTitle: T("Stage individual hunks"),
      messageEmpty: T("Commit message cannot be empty."),
    };
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(webview, n)}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<div id="empty" class="empty">${esc(T("No git repository."))}</div>
<div id="app">
  <section class="section">
    <h3>${esc(T("Staged"))} <span id="staged-count" class="count">0</span></h3>
    <ul id="staged" class="filelist"></ul>
  </section>
  <section class="section">
    <h3>${esc(T("Changes"))} <span id="changes-count" class="count">0</span></h3>
    <ul id="changes" class="filelist"></ul>
  </section>
  <section class="message">
    <div class="cc-toolbar">
      <span id="cc-badges"></span>
      <span class="spacer"></span>
      <button id="wizard" type="button" title="${esc(T("Run commit wizard"))}">${esc(T("Wizard…"))}</button>
    </div>
    <textarea id="msg" placeholder="type(scope): subject" rows="3"></textarea>
    <div id="cc-status" class="cc-status"></div>
    <div class="actions">
      <label><input type="checkbox" id="amend" /> ${esc(T("Amend last commit"))}</label>
      <button id="commit" class="primary">${esc(T("Commit"))}</button>
    </div>
  </section>
</div>
<script nonce="${n}">window.__rebasedL10n=${JSON.stringify(l10nBundle)};</script>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
