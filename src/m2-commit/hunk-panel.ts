import * as vscode from "vscode";
import { diffFile, applyPatch } from "../core/git";
import { parsePatch, buildPatch } from "./hunks";
import type { RepoManager } from "../core/repo";
import { asset, csp, nonce } from "../core/webview-util";
import { showGitError } from "../core/notify";

export class HunkPanel {
  private static panels = new Map<string, HunkPanel>();
  private panel: vscode.WebviewPanel;

  static show(ctx: vscode.ExtensionContext, repos: RepoManager, path: string): void {
    const key = path;
    const existing = HunkPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      void existing.refresh();
      return;
    }
    const p = new HunkPanel(ctx, repos, path);
    HunkPanel.panels.set(key, p);
    p.panel.onDidDispose(() => HunkPanel.panels.delete(key));
  }

  private constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly repos: RepoManager,
    private readonly path: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "rebased.hunks",
      vscode.l10n.t("Hunks · {0}", path),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "out"), vscode.Uri.joinPath(ctx.extensionUri, "media")],
      }
    );
    this.panel.webview.html = this.renderHtml();
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") await this.refresh();
      else if (msg.type === "stage") await this.stage(msg.selected);
      else if (msg.type === "unstage") await this.unstage(msg.selected);
    });
    repos.onChange(() => void this.refresh());
  }

  private async refresh(): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const unstaged = await diffFile(root, this.path, false);
    const staged = await diffFile(root, this.path, true);
    this.panel.webview.postMessage({
      type: "diff",
      unstaged: parsePatch(unstaged),
      staged: parsePatch(staged),
    });
  }

  private async stage(selected: number[]): Promise<void> {
    const root = this.repos.root;
    if (!root || !selected.length) return;
    try {
      const patch = await diffFile(root, this.path, false);
      const parsed = parsePatch(patch);
      const minimal = buildPatch(parsed, selected);
      await applyPatch(root, minimal, { cached: true });
      this.repos.fire();
    } catch (e: unknown) {
      await showGitError("Stage hunks", e);
    }
  }

  private async unstage(selected: number[]): Promise<void> {
    const root = this.repos.root;
    if (!root || !selected.length) return;
    try {
      const patch = await diffFile(root, this.path, true);
      const parsed = parsePatch(patch);
      const minimal = buildPatch(parsed, selected);
      await applyPatch(root, minimal, { cached: true, reverse: true });
      this.repos.fire();
    } catch (e: unknown) {
      await showGitError("Unstage hunks", e);
    }
  }

  private renderHtml(): string {
    const n = nonce();
    const script = asset(this.panel.webview, this.ctx, "out", "webview", "hunks.js");
    const style = asset(this.panel.webview, this.ctx, "media", "hunks.css");
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(this.panel.webview, n)}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<header>
  <h1 id="title">${escape(this.path)}</h1>
  <div class="toolbar">
    <button id="stage-selected" class="primary">${vscode.l10n.t("Stage selected")}</button>
    <button id="unstage-selected">${vscode.l10n.t("Unstage selected")}</button>
  </div>
</header>
<section><h2>${vscode.l10n.t("Unstaged hunks")}</h2><div id="unstaged"></div></section>
<section><h2>${vscode.l10n.t("Staged hunks")}</h2><div id="staged"></div></section>
<script nonce="${n}" src="${script}"></script>
</body></html>`;
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}
