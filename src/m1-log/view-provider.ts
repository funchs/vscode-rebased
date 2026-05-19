import * as vscode from "vscode";
import { getLog, getBranches, getAuthors, type LogFilter } from "../core/git";
import { layout } from "./graph";
import type { RepoManager } from "../core/repo";
import { asset, csp, nonce } from "../core/webview-util";

export class LogViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "rebased.log";
  private view?: vscode.WebviewView;
  private currentFilter: LogFilter = {};
  // Branch to apply once the webview signals "ready". Holds the request when
  // revealForBranch is called before the view has been resolved (first reveal).
  private pendingBranchFilter?: string;

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly repos: RepoManager) {
    repos.onChange(() => void this.refresh());
  }

  async revealForBranch(name: string): Promise<void> {
    this.pendingBranchFilter = name;
    // VS Code auto-registers `<viewId>.focus` for every contributed view.
    // This also resolves the webview if it hasn't been opened yet.
    await vscode.commands.executeCommand("rebased.log.focus");
    this.applyPendingFilter();
  }

  private applyPendingFilter(): void {
    if (!this.view || !this.pendingBranchFilter) return;
    this.view.webview.postMessage({ type: "setBranchFilter", branch: this.pendingBranchFilter });
    this.pendingBranchFilter = undefined;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "out"), vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    const T = vscode.l10n.t;
    const l10n = {
      menuInteractiveRebase: T("Interactive rebase from here"),
      menuCherryPick: T("Cherry-pick this commit"),
      menuCheckout: T("Checkout {0}"),
      statusFiltered: T("{0} commit{1} match · clear filters to show all"),
      errorPrefix: T("Error: {0}"),
      msNoMatches: T("No matches."),
      currentBranchHead: T("Current branch (HEAD)"),
    };
    view.webview.html = this.html(view.webview, l10n);
    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") {
        await Promise.all([this.sendBranches(), this.sendAuthors()]);
        await this.refresh();
        this.applyPendingFilter();
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
      } else if (msg.type === "pickPath") {
        // Open VS Code's native file/folder dialog; return a repo-relative
        // path back to the webview so the user doesn't have to type one.
        const root = this.repos.root;
        const defaultUri = root ? vscode.Uri.file(root) : undefined;
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: vscode.l10n.t("Filter to this path"),
          defaultUri,
        });
        if (!picked?.[0]) return;
        let p = picked[0].fsPath;
        if (root && (p === root || p.startsWith(root + "/"))) {
          p = p === root ? "" : p.slice(root.length + 1);
        }
        this.view?.webview.postMessage({ type: "setPathFilter", path: p });
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

  private async sendAuthors(): Promise<void> {
    const root = this.repos.root;
    if (!root || !this.view) return;
    try {
      const authors = await getAuthors(root);
      this.view.webview.postMessage({ type: "authors", authors });
    } catch {
      // empty repo or no commits yet — leave authors empty
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

  private html(webview: vscode.Webview, l10n: Record<string, string>): string {
    const n = nonce();
    const script = asset(webview, this.ctx, "out", "webview", "log.js");
    const style = asset(webview, this.ctx, "media", "log.css");
    const codicon = asset(webview, this.ctx, "media", "codicons", "codicon.css");
    const T = vscode.l10n.t;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(webview, n)}" />
<link rel="stylesheet" href="${codicon}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<div id="empty" class="empty">${esc(T("No git repository in the current workspace."))}</div>

<form id="toolbar" class="toolbar" autocomplete="off">
  <!-- Subject text search -->
  <input id="q-message" type="search" placeholder="${esc(T("Subject…"))}" />

  <!-- Author multi-select. Trigger button shows summary; popover hosts a
       filter input + checkbox list (populated via 'authors' message). -->
  <div class="ms" id="ms-author" data-empty="${esc(T("All users"))}" data-plural="${esc(T("{0} users"))}">
    <button type="button" class="ms-trigger" title="${esc(T("Author"))}">
      <span class="ms-label">${esc(T("All users"))}</span>
      <span class="codicon codicon-chevron-down ms-caret"></span>
    </button>
    <div class="ms-popover" hidden>
      <input class="ms-search" type="search" placeholder="${esc(T("Filter…"))}" />
      <ul class="ms-list"></ul>
      <div class="ms-foot">
        <button type="button" class="ms-reset link-btn">${esc(T("Clear"))}</button>
      </div>
    </div>
  </div>

  <!-- Path filter + Browse button (VS Code openDialog). -->
  <input id="q-path" type="search" placeholder="${esc(T("Path"))}" />
  <button type="button" id="q-path-pick" class="icon-btn" title="${esc(T("Browse…"))}" aria-label="${esc(T("Browse…"))}">
    <span class="codicon codicon-folder-opened"></span>
  </button>

  <!-- Branch multi-select. Includes two static head entries (All / HEAD)
       above the dynamic branch list. -->
  <div class="ms" id="ms-branch" data-empty="${esc(T("All branches"))}" data-plural="${esc(T("{0} branches"))}">
    <button type="button" class="ms-trigger" title="${esc(T("Branch"))}">
      <span class="ms-label">${esc(T("All branches"))}</span>
      <span class="codicon codicon-chevron-down ms-caret"></span>
    </button>
    <div class="ms-popover" hidden>
      <input class="ms-search" type="search" placeholder="${esc(T("Filter…"))}" />
      <ul class="ms-list"></ul>
      <div class="ms-foot">
        <button type="button" class="ms-reset link-btn">${esc(T("Clear"))}</button>
      </div>
    </div>
  </div>

  <!-- Date range. "Custom…" reveals from/until inputs. -->
  <select id="q-since" title="${esc(T("Date range"))}">
    <option value="">${esc(T("Any time"))}</option>
    <option value="1.day.ago">${esc(T("Last 24h"))}</option>
    <option value="1.week.ago">${esc(T("Last week"))}</option>
    <option value="1.month.ago">${esc(T("Last month"))}</option>
    <option value="3.months.ago">${esc(T("Last 3 months"))}</option>
    <option value="1.year.ago">${esc(T("Last year"))}</option>
    <option value="__custom__">${esc(T("Custom range…"))}</option>
  </select>
  <input id="q-since-date" type="date" hidden title="${esc(T("From date"))}" />
  <input id="q-until-date" type="date" hidden title="${esc(T("Until date"))}" />

  <!-- Hash filter — separate from subject because git's --grep doesn't match SHAs. -->
  <input id="q-hash" type="search" placeholder="${esc(T("Commit hash"))}" pattern="[0-9a-fA-F]{4,40}" />

  <!-- Clear-all button (codicon). -->
  <button type="button" id="clear" class="icon-btn" title="${esc(T("Clear filters"))}" aria-label="${esc(T("Clear filters"))}">
    <span class="codicon codicon-clear-all"></span>
  </button>
</form>

<div id="status" class="status"></div>
<div id="log"></div>
<script nonce="${n}">window.__rebasedL10n=${JSON.stringify(l10n)};</script>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}
