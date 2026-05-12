import * as vscode from "vscode";
import { getLog } from "../core/git";
import { layout } from "./graph";
import type { RepoManager } from "../core/repo";
import { asset, csp, nonce } from "../core/webview-util";

export class LogViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "rebased.log";
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
      if (msg.type === "ready") await this.refresh();
      else if (msg.type === "checkout" && msg.ref) {
        await vscode.commands.executeCommand("rebased.branch.checkout", { name: msg.ref });
      } else if (msg.type === "interactiveRebase" && msg.hash) {
        await vscode.commands.executeCommand("rebased.rebase.interactive", msg.hash);
      } else if (msg.type === "cherryPick" && msg.hash) {
        await vscode.commands.executeCommand("rebased.cherryPick", msg.hash);
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
    const cfg = vscode.workspace.getConfiguration("rebased");
    const commits = await getLog(root, {
      maxCount: cfg.get<number>("log.maxCommits", 2000),
      allBranches: cfg.get<boolean>("log.allBranches", true),
    });
    const laid = layout(commits);
    this.view.webview.postMessage({
      type: "log",
      rows: laid.map((l) => ({
        hash: l.commit.hash,
        short: l.commit.shortHash,
        author: l.commit.author,
        date: l.commit.date,
        subject: l.commit.subject,
        refs: l.commit.refs,
        lane: l.lane,
        parentLanes: l.parentLanes,
        active: l.active,
      })),
    });
  }

  private html(webview: vscode.Webview): string {
    const n = nonce();
    const script = asset(webview, this.ctx, "out", "webview", "log.js");
    const style = asset(webview, this.ctx, "media", "log.css");
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(webview, n)}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<div id="empty" class="empty">No git repository in the current workspace.</div>
<div id="log"></div>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
