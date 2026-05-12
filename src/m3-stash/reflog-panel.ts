import * as vscode from "vscode";
import { getReflog, runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
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
      "Reflog",
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
        catch (e: unknown) { vscode.window.showErrorMessage(`Checkout failed: ${(e as Error).message}`); }
      } else if (msg.type === "reset") {
        const mode = await vscode.window.showQuickPick(
          [
            { label: "Soft (keep working tree + index)", value: "--soft" },
            { label: "Mixed (keep working tree)", value: "--mixed" },
            { label: "Hard (DISCARD working tree)", value: "--hard", description: "Destructive" },
          ],
          { placeHolder: "Reset mode" }
        );
        if (!mode) return;
        if (mode.value === "--hard") {
          const ok = await vscode.window.showWarningMessage(
            `Hard reset to ${msg.hash}? This DISCARDS uncommitted work.`,
            { modal: true },
            "Reset"
          );
          if (ok !== "Reset") return;
        }
        try { await runGit(["reset", mode.value, msg.hash], { cwd: root }); repos.fire(); }
        catch (e: unknown) { vscode.window.showErrorMessage(`Reset failed: ${(e as Error).message}`); }
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
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(this.panel.webview, n)}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<header>
  <h1>Reflog</h1>
  <p class="hint">Right-click an entry for actions. Reflog stays for ~90 days — recover lost commits here.</p>
</header>
<div id="list"></div>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
