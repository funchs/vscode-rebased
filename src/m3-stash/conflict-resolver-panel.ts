import * as vscode from "vscode";
import {
  runGit,
  getOperationState,
  continueOperation,
  abortOperation,
  clearStashPopInProgress,
  type OperationState,
  type GitOp,
} from "../core/git";
import type { RepoManager } from "../core/repo";
import { asset, csp, nonce } from "../core/webview-util";
import { showGitError } from "../core/notify";

// JetBrains-style conflicts dashboard:
//   • File list on the left, each row with per-file actions.
//   • Footer with state-aware finalize button (Mark resolved / Continue / Drop stash).
//   • Labels are context-aware: during rebase, "ours" and "theirs" are swapped
//     vs git's internal naming (rebase replays YOUR commits onto upstream HEAD,
//     so stage 2 is upstream and stage 3 is your commit) — we present "yours"
//     as the user's intuitive notion regardless of git's internal stages.

interface FileEntry {
  path: string;
  // Status code from `git status --porcelain`: UU / AA / DD / DU / UD / UA / AU.
  code: string;
}

export class ConflictResolverPanel {
  private static current: ConflictResolverPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static show(ctx: vscode.ExtensionContext, repos: RepoManager): void {
    if (ConflictResolverPanel.current) {
      ConflictResolverPanel.current.panel.reveal();
      void ConflictResolverPanel.current.refresh();
      return;
    }
    const p = new ConflictResolverPanel(ctx, repos);
    ConflictResolverPanel.current = p;
    p.panel.onDidDispose(() => {
      ConflictResolverPanel.current = undefined;
      for (const d of p.disposables) d.dispose();
    });
  }

  private constructor(
    private ctx: vscode.ExtensionContext,
    private repos: RepoManager
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "rebased.conflicts",
      vscode.l10n.t("Conflicts"),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(ctx.extensionUri, "out"),
          vscode.Uri.joinPath(ctx.extensionUri, "media"),
        ],
      }
    );
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") await this.refresh();
      else if (msg.type === "useOurs" && msg.path) await this.useOurs(msg.path);
      else if (msg.type === "useTheirs" && msg.path) await this.useTheirs(msg.path);
      else if (msg.type === "openMerge" && msg.path) await this.openMerge(msg.path);
      else if (msg.type === "reset" && msg.path) await this.reset(msg.path);
      else if (msg.type === "resolveAll") await this.resolveAllSequential();
      else if (msg.type === "finalize") await this.finalize();
      else if (msg.type === "abort") await this.abort();
    });
    this.disposables.push(this.repos.onChange(() => void this.refresh()));
  }

  // For rebase, git's --ours/--theirs are reversed relative to the user's
  // intuitive sense. We flip them at the boundary so the UI always says
  // "yours" = your branch, "theirs" = the version being integrated.
  private oursFlag(kind: OperationState["kind"]): "--ours" | "--theirs" {
    return kind === "rebase" ? "--theirs" : "--ours";
  }
  private theirsFlag(kind: OperationState["kind"]): "--ours" | "--theirs" {
    return kind === "rebase" ? "--ours" : "--theirs";
  }

  private async useOurs(path: string): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const state = await getOperationState(root);
    try {
      await runGit(["checkout", this.oursFlag(state.kind), "--", path], { cwd: root });
      await runGit(["add", "--", path], { cwd: root });
      this.repos.fire();
    } catch (e: unknown) {
      await showGitError(vscode.l10n.t("Accept yours") + ` (${path})`, e);
    }
  }

  private async useTheirs(path: string): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const state = await getOperationState(root);
    try {
      await runGit(["checkout", this.theirsFlag(state.kind), "--", path], { cwd: root });
      await runGit(["add", "--", path], { cwd: root });
      this.repos.fire();
    } catch (e: unknown) {
      await showGitError(vscode.l10n.t("Accept theirs") + ` (${path})`, e);
    }
  }

  private async openMerge(path: string): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const uri = vscode.Uri.joinPath(vscode.Uri.file(root), path);
    try {
      await vscode.commands.executeCommand("git.openMergeEditor", uri);
    } catch {
      await vscode.window.showTextDocument(uri);
    }
  }

  private async resolveAllSequential(): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const state = await getOperationState(root);
    for (const path of state.conflicted) {
      await this.openMerge(path);
    }
  }

  private async reset(path: string): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const ok = await vscode.window.showWarningMessage(
      vscode.l10n.t("Reset {0} to HEAD? Local resolution work on this file will be discarded.", path),
      { modal: true },
      vscode.l10n.t("Reset")
    );
    if (ok !== vscode.l10n.t("Reset")) return;
    try {
      await runGit(["checkout", "HEAD", "--", path], { cwd: root });
      this.repos.fire();
    } catch (e: unknown) {
      await showGitError(vscode.l10n.t("Reset") + ` (${path})`, e);
    }
  }

  private async finalize(): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const state = await getOperationState(root);
    if (state.conflicted.length > 0) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Still {0} unresolved conflict(s).", String(state.conflicted.length))
      );
      return;
    }
    try {
      if (state.kind === "stash-pop") {
        if (state.stashRef) await runGit(["stash", "drop", state.stashRef], { cwd: root });
        await clearStashPopInProgress(root);
      } else if (state.kind === "orphan-unmerged" || !state.kind) {
        // Nothing else to do — files are already added.
      } else {
        await continueOperation(root, state.kind as GitOp);
      }
      this.repos.fire();
      vscode.window.showInformationMessage(vscode.l10n.t("Conflicts finalized."));
      this.panel.dispose();
    } catch (e: unknown) {
      await showGitError(vscode.l10n.t("Finalize"), e);
    }
  }

  private async abort(): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const state = await getOperationState(root);
    const target = state.kind;
    let warn: string;
    if (target === "stash-pop") {
      warn = vscode.l10n.t("Abort stash pop? Conflict markers revert; the stash entry stays.");
    } else if (target === "orphan-unmerged") {
      warn = vscode.l10n.t("Discard UU files and revert them to HEAD? In-progress resolution will be lost.");
    } else if (target) {
      warn = vscode.l10n.t("Abort {0}? Rolls back to the pre-operation state.", target);
    } else {
      warn = vscode.l10n.t("Nothing to abort.");
    }
    const ok = await vscode.window.showWarningMessage(warn, { modal: true }, vscode.l10n.t("Abort"));
    if (ok !== vscode.l10n.t("Abort")) return;
    try {
      if (target === "stash-pop") {
        if (state.conflicted.length) {
          await runGit(["checkout", "--", ...state.conflicted], { cwd: root });
        }
        await clearStashPopInProgress(root);
      } else if (target === "orphan-unmerged") {
        if (state.conflicted.length) {
          await runGit(["checkout", "HEAD", "--", ...state.conflicted], { cwd: root });
        }
      } else if (target) {
        await abortOperation(root, target as GitOp);
      }
      this.repos.fire();
      this.panel.dispose();
    } catch (e: unknown) {
      await showGitError(vscode.l10n.t("Abort"), e);
    }
  }

  private async refresh(): Promise<void> {
    const root = this.repos.root;
    if (!root) {
      this.panel.webview.postMessage({ type: "state", state: null, files: [] });
      return;
    }
    const state = await getOperationState(root);
    // Use porcelain to grab the UU code per file.
    const raw = await runGit(["status", "--porcelain=v1", "-z"], { cwd: root });
    const entries: FileEntry[] = [];
    const parts = raw.split("\x00");
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry || entry.length < 3) continue;
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      if (code === "UU" || code === "AA" || code === "DD" ||
          code === "DU" || code === "UD" || code === "UA" || code === "AU") {
        entries.push({ path, code });
      }
      if (code[0] === "R" || code[0] === "C") i++; // skip old name
    }

    this.panel.webview.postMessage({
      type: "state",
      kind: state.kind,
      files: entries,
      flippedOurs: state.kind === "rebase",
    });
  }

  private html(): string {
    const n = nonce();
    const script = asset(this.panel.webview, this.ctx, "out", "webview", "conflicts.js");
    const style = asset(this.panel.webview, this.ctx, "media", "conflicts.css");
    const T = vscode.l10n.t;
    const l10n = {
      kindRebase: T("Rebase"),
      kindMerge: T("Merge"),
      kindCherryPick: T("Cherry-pick"),
      kindRevert: T("Revert"),
      kindStashPop: T("Stash pop"),
      kindOrphan: T("Orphan unmerged"),
      readyToFinalize: T("ready to finalize"),
      bannerConflicts: T("{0} conflict(s)"),
      bannerSep: " · ",
      flippedOursTitle: T("git checkout --theirs (rebase flips the semantics; this is YOUR branch's version)"),
      flippedTheirsTitle: T("git checkout --ours (rebase flips the semantics; this is the upstream version)"),
      oursTitle: "git checkout --ours",
      theirsTitle: "git checkout --theirs",
    };
    return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(this.panel.webview, n)}" />
<link rel="stylesheet" href="${style}" />
</head><body>
<header>
  <h1 id="title">${escape(vscode.l10n.t("Conflicts"))}</h1>
  <div id="state-banner" class="state-banner"></div>
</header>
<ul id="files" class="files"></ul>
<div id="empty" class="empty">${escape(vscode.l10n.t("No conflicts."))}</div>
<footer>
  <button id="resolve-all">${escape(vscode.l10n.t("Open all in merge editor"))}</button>
  <span class="spacer"></span>
  <button id="abort">${escape(vscode.l10n.t("Abort"))}</button>
  <button id="finalize" class="primary" disabled>${escape(vscode.l10n.t("Finalize"))}</button>
</footer>
<template id="row-tpl">
  <li class="file">
    <span class="badge"></span>
    <span class="path"></span>
    <span class="actions">
      <button class="ours" title="">${escape(vscode.l10n.t("Accept yours"))}</button>
      <button class="theirs" title="">${escape(vscode.l10n.t("Accept theirs"))}</button>
      <button class="merge primary">${escape(vscode.l10n.t("Merge…"))}</button>
      <button class="reset ghost" title="${escape(vscode.l10n.t("Reset"))}">↺</button>
    </span>
  </li>
</template>
<script nonce="${n}">window.__rebasedL10n=${JSON.stringify(l10n)};</script>
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
