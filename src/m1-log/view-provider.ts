import * as vscode from "vscode";
import { getLog, getBranches, type LogFilter } from "../core/git";
import { layout } from "./graph";
import type { RepoManager } from "../core/repo";
import { asset, csp, nonce } from "../core/webview-util";

export class LogViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "rebased.log";
  private view?: vscode.WebviewView;
  private currentFilter: LogFilter = {};

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
      if (msg.type === "ready") {
        await this.sendBranches();
        await this.refresh();
      } else if (msg.type === "setFilter") {
        this.currentFilter = msg.filter ?? {};
        await this.refresh();
      } else if (msg.type === "checkout" && msg.ref) {
        await vscode.commands.executeCommand("rebased.branch.checkout", { name: msg.ref });
      } else if (msg.type === "interactiveRebase" && msg.hash) {
        await vscode.commands.executeCommand("rebased.rebase.interactive", msg.hash);
      } else if (msg.type === "cherryPick" && msg.hash) {
        await vscode.commands.executeCommand("rebased.cherryPick", msg.hash);
      } else if (msg.type === "showCommit" && msg.hash) {
        await vscode.commands.executeCommand("rebased.commit.show", msg.hash);
      }
    });
  }

  private async sendBranches(): Promise<void> {
    const root = this.repos.root;
    if (!root || !this.view) return;
    try {
      const all = await getBranches(root);
      this.view.webview.postMessage({
        type: "branches",
        branches: all.map((b) => b.name),
      });
    } catch {
      // ignore — first-time repos may have no refs yet
    }
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const root = this.repos.root;
    if (!root) {
      this.view.webview.postMessage({ type: "empty" });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("rebased");
    try {
      const commits = await getLog(root, {
        maxCount: cfg.get<number>("log.maxCommits", 2000),
        allBranches: cfg.get<boolean>("log.allBranches", true),
        filter: this.currentFilter,
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
        filtered: Object.values(this.currentFilter).some(Boolean),
      });
    } catch (e: unknown) {
      this.view.webview.postMessage({ type: "error", message: (e as Error).message });
    }
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
<form id="toolbar" class="toolbar" autocomplete="off">
  <input id="q-message" placeholder="Subject…" type="search" />
  <input id="q-author" placeholder="Author" type="search" />
  <input id="q-path" placeholder="Path" type="search" />
  <select id="q-branch">
    <option value="">All branches</option>
  </select>
  <select id="q-since">
    <option value="">Any time</option>
    <option value="1.day.ago">Last 24h</option>
    <option value="1.week.ago">Last week</option>
    <option value="1.month.ago">Last month</option>
    <option value="3.months.ago">Last 3 months</option>
    <option value="1.year.ago">Last year</option>
  </select>
  <button type="button" id="clear" title="Clear filters">×</button>
</form>
<div id="status" class="status"></div>
<div id="log"></div>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
