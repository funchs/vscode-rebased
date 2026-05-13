import * as vscode from "vscode";
import { getCommitDetail } from "../core/git";
import type { RepoManager } from "../core/repo";
import { asset, csp, nonce } from "../core/webview-util";
import { showGitError } from "../core/notify";

export class CommitDetailsPanel {
  private static current: CommitDetailsPanel | undefined;
  private panel: vscode.WebviewPanel;
  private currentHash?: string;

  static show(ctx: vscode.ExtensionContext, repos: RepoManager, hash: string): void {
    if (CommitDetailsPanel.current) {
      CommitDetailsPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      void CommitDetailsPanel.current.load(hash);
      return;
    }
    const p = new CommitDetailsPanel(ctx, repos);
    CommitDetailsPanel.current = p;
    p.panel.onDidDispose(() => {
      CommitDetailsPanel.current = undefined;
    });
    void p.load(hash);
  }

  private constructor(private ctx: vscode.ExtensionContext, private repos: RepoManager) {
    this.panel = vscode.window.createWebviewPanel(
      "rebased.commitDetails",
      "Commit details",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
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
      if (msg.type === "openDiff" && msg.path && this.currentHash) {
        const detail = await getCommitDetail(root, this.currentHash);
        const parent = detail.parents[0];
        const uri = vscode.Uri.joinPath(vscode.Uri.file(root), msg.path);
        if (!parent) {
          // Root commit — show added file content.
          await vscode.window.showTextDocument(uri);
          return;
        }
        // Use VS Code's git extension to show the historical diff.
        await vscode.commands.executeCommand(
          "vscode.diff",
          this.gitResource(uri, parent),
          this.gitResource(uri, this.currentHash),
          `${msg.path} · ${parent.slice(0, 7)} → ${this.currentHash.slice(0, 7)}`
        );
      } else if (msg.type === "copyHash" && this.currentHash) {
        await vscode.env.clipboard.writeText(this.currentHash);
        vscode.window.setStatusBarMessage(`Copied ${this.currentHash}`, 2000);
      } else if (msg.type === "checkout" && this.currentHash) {
        await vscode.commands.executeCommand("rebased.branch.checkout", { name: this.currentHash });
      } else if (msg.type === "cherryPick" && this.currentHash) {
        await vscode.commands.executeCommand("rebased.cherryPick", this.currentHash);
      } else if (msg.type === "interactiveRebase" && this.currentHash) {
        await vscode.commands.executeCommand("rebased.rebase.interactive", this.currentHash);
      }
    });
  }

  private gitResource(file: vscode.Uri, ref: string): vscode.Uri {
    // The built-in git extension exposes "git:" URIs with a JSON-encoded query.
    return file.with({
      scheme: "git",
      path: file.path,
      query: JSON.stringify({ path: file.fsPath, ref }),
    });
  }

  private async load(hash: string): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    this.currentHash = hash;
    try {
      const detail = await getCommitDetail(root, hash);
      this.panel.title = `${detail.shortHash} · ${detail.subject.slice(0, 60)}`;
      this.panel.webview.postMessage({ type: "detail", detail });
    } catch (e: unknown) {
      await showGitError("Load commit", e);
    }
  }

  private renderHtml(): string {
    const n = nonce();
    const script = asset(this.panel.webview, this.ctx, "out", "webview", "details.js");
    const style = asset(this.panel.webview, this.ctx, "media", "details.css");
    const T = vscode.l10n.t;
    const l10n = {
      copyHashTooltip: T("Click to copy"),
      cherryPick: T("Cherry-pick"),
      interactiveRebaseHere: T("Interactive rebase here"),
      checkoutDetached: T("Checkout (detached)"),
      parents: T("parents:"),
      filesCount: T("Files ({0})"),
    };
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(this.panel.webview, n)}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<div id="root"></div>
<script nonce="${n}">window.__rebasedL10n=${JSON.stringify(l10n)};</script>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
