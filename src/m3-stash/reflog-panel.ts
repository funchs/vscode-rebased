import * as vscode from "vscode";
import { getReflog, runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError } from "../core/notify";
import { asset, csp, nonce } from "../core/webview-util";

export class ReflogPanel {
  private static current: ReflogPanel | undefined;
  private panel: vscode.WebviewPanel;

  static show(ctx: vscode.ExtensionContext, repos: RepoManager): void {
    if (ReflogPanel.current) {
      ReflogPanel.current.panel.reveal();
      void ReflogPanel.current.refresh();
      return;
    }
    const p = new ReflogPanel(ctx, repos);
    ReflogPanel.current = p;
    p.panel.onDidDispose(() => {
      ReflogPanel.current = undefined;
    });
  }

  private constructor(private ctx: vscode.ExtensionContext, private repos: RepoManager) {
    this.panel = vscode.window.createWebviewPanel(
      "rebased.reflog",
      vscode.l10n.t("Reflog"),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "out"), vscode.Uri.joinPath(ctx.extensionUri, "media")],
      }
    );
    this.panel.webview.html = this.renderHtml();
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      const root = repos.root;
      if (!root) return;
      if (msg.type === "ready") await this.refresh();
      else if (msg.type === "checkout") {
        try { await runGit(["checkout", msg.hash], { cwd: root }); repos.fire(); }
        catch (e: unknown) { await showGitError("Checkout", e); }
      } else if (msg.type === "reset") {
        const mode = await vscode.window.showQuickPick(
          [
            { label: vscode.l10n.t("Soft (keep working tree + index)"), value: "--soft" },
            { label: vscode.l10n.t("Mixed (keep working tree)"), value: "--mixed" },
            { label: vscode.l10n.t("Hard (DISCARD working tree)"), value: "--hard", description: vscode.l10n.t("Destructive") },
          ],
          { placeHolder: vscode.l10n.t("Reset mode") }
        );
        if (!mode) return;
        if (mode.value === "--hard") {
          const ok = await vscode.window.showWarningMessage(
            vscode.l10n.t("Hard reset to {0}? This DISCARDS uncommitted work.", msg.hash),
            { modal: true },
            vscode.l10n.t("Reset")
          );
          if (ok !== vscode.l10n.t("Reset")) return;
        }
        try { await runGit(["reset", mode.value, msg.hash], { cwd: root }); repos.fire(); }
        catch (e: unknown) { await showGitError("Reset", e); }
      } else if (msg.type === "cherryPick") {
        await vscode.commands.executeCommand("rebased.cherryPick", msg.hash);
      }
    });
    repos.onChange(() => void this.refresh());
  }

  private async refresh(): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const entries = await getReflog(root, 300);
    this.panel.webview.postMessage({ type: "reflog", entries });
  }

  private renderHtml(): string {
    const n = nonce();
    const script = asset(this.panel.webview, this.ctx, "out", "webview", "reflog.js");
    const style = asset(this.panel.webview, this.ctx, "media", "reflog.css");
    const T = vscode.l10n.t;
    const l10n = {
      menuCheckout: T("Checkout {0}"),
      menuReset: T("Reset HEAD to {0}…"),
      menuCherryPick: T("Cherry-pick {0}"),
    };
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(this.panel.webview, n)}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<header>
  <h1>${vscode.l10n.t("Reflog")}</h1>
  <p class="hint">${vscode.l10n.t("Right-click an entry for actions. Reflog stays for ~90 days — recover lost commits here.")}</p>
</header>
<div id="list"></div>
<script nonce="${n}">window.__rebasedL10n=${JSON.stringify(l10n)};</script>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
