import * as vscode from "vscode";
import {
  getOperationState,
  continueOperation,
  abortOperation,
  runGit,
  clearStashPopInProgress,
} from "../core/git";
import type { RepoManager } from "../core/repo";
import type { OperationState } from "../core/git";
import { showGitError } from "../core/notify";

// Status bar badge that tracks rebase/merge/cherry-pick/revert/stash-pop state.
// Click → showConflictResolution dialog. JetBrains-style UX: as soon as we
// detect any of these states, the badge appears and stays until the operation
// is finalized or aborted.

export class ConflictWatcher implements vscode.Disposable {
  private statusItem: vscode.StatusBarItem;
  private lastShownState: string = "";

  constructor(private readonly repos: RepoManager) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    this.statusItem.command = "rebased.conflict.show";
    repos.onChange(() => void this.tick());
    void this.tick();
  }

  private async tick(): Promise<void> {
    const root = this.repos.root;
    if (!root) {
      this.statusItem.hide();
      return;
    }
    const state = await getOperationState(root);
    if (!state.kind) {
      this.statusItem.hide();
      this.lastShownState = "";
      return;
    }
    const total = state.conflicted.length;
    if (total > 0) {
      this.statusItem.text = `$(warning) ${state.kind}: ${total} conflict${total === 1 ? "" : "s"}`;
      this.statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.statusItem.text = `$(debug-continue) ${state.kind}: ready to continue`;
      this.statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.prominentBackground");
    }
    this.statusItem.tooltip = vscode.l10n.t("{0} in progress — click to resolve", state.kind!);
    this.statusItem.show();

    const sig = `${state.kind}:${total}`;
    if (sig !== this.lastShownState) {
      this.lastShownState = sig;
      if (total > 0) {
        vscode.window.setStatusBarMessage(
          `$(warning) ` + vscode.l10n.t("Rebased: {0} conflict(s) in {1}", String(total), state.kind!),
          5000
        );
      }
    }
  }

  dispose(): void {
    this.statusItem.dispose();
  }
}

// Open the built-in 3-way merge editor for a single conflicted file. Falls back
// to a plain text editor if the merge command isn't available (older VS Code).
async function openMergeForFile(root: string, relPath: string): Promise<void> {
  const uri = vscode.Uri.joinPath(vscode.Uri.file(root), relPath);
  try {
    await vscode.commands.executeCommand("git.openMergeEditor", uri);
  } catch {
    await vscode.window.showTextDocument(uri);
  }
}

export async function showConflictResolution(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const state = await getOperationState(root);
  if (!state.kind) {
    vscode.window.showInformationMessage(vscode.l10n.t("No rebase/merge/cherry-pick/stash in progress."));
    return;
  }

  // If there are still conflicted files, the primary affordance is "open the
  // next file in 3-way merge". If they're all resolved, the primary
  // affordance shifts to "Continue / Finalize".
  const allResolved = state.conflicted.length === 0;
  const items: vscode.QuickPickItem[] = [];

  if (!allResolved) {
    items.push({ label: `${state.kind} — ${state.conflicted.length} conflict(s)`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
    for (const p of state.conflicted) {
      items.push({ label: `$(warning) ${p}`, description: "Open in 3-way merge editor" });
    }
    items.push({ label: "$(check-all) Resolve all in merge editor (sequential)", alwaysShow: true });
    items.push({ label: "$(circle-slash) Abort", description: `Abort the ${state.kind}`, alwaysShow: true });
  } else {
    items.push({ label: vscode.l10n.t("All conflicts resolved"), kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
    if (state.kind === "stash-pop") {
      items.push({
        label: "$(check) Finalize: drop stash and continue",
        description: state.stashRef ?? "",
        alwaysShow: true,
      });
      items.push({
        label: "$(discard) Keep stash (do nothing)",
        description: "Conflicts already resolved; leave the stash entry intact",
        alwaysShow: true,
      });
    } else if (state.kind === "orphan-unmerged") {
      items.push({
        label: "$(check) Mark resolved (git add)",
        description: vscode.l10n.t("Stage the resolved files so git stops blocking index writes"),
        alwaysShow: true,
      });
    } else {
      items.push({
        label: `$(check) Continue ${state.kind}`,
        alwaysShow: true,
      });
    }
    items.push({ label: "$(circle-slash) Abort", description: `Abort the ${state.kind}`, alwaysShow: true });
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `${state.kind}${state.conflicted.length ? ` · ${state.conflicted.length} unresolved` : " · ready"}`,
  });
  if (!pick) return;

  // File picked from the list → open merge editor.
  if (pick.label.startsWith("$(warning) ")) {
    await openMergeForFile(root, pick.label.replace("$(warning) ", ""));
    return;
  }

  // Sequential mode: open each conflicted file in turn.
  if (pick.label.startsWith("$(check-all)")) {
    for (const p of state.conflicted) {
      await openMergeForFile(root, p);
    }
    return;
  }

  // Continue (non-stash ops)
  if (pick.label.startsWith("$(check) Continue ")) {
    try {
      await continueOperation(root, state.kind as Exclude<OperationState["kind"], null | "stash-pop" | "orphan-unmerged">);
      repos.fire();
      vscode.window.showInformationMessage(vscode.l10n.t("{0} continued.", state.kind!));
    } catch (e: unknown) {
      await showGitError(`Continue ${state.kind}`, e);
    }
    return;
  }

  // Orphan-unmerged finalize: just stage the resolved files. No stash to drop,
  // no operation state to clear — git is happy as soon as the index has no UU.
  if (pick.label.startsWith("$(check) Mark resolved")) {
    try {
      if (state.conflicted.length) {
        await runGit(["add", "--", ...state.conflicted], { cwd: root });
      }
      repos.fire();
      vscode.window.showInformationMessage(vscode.l10n.t("Conflicts marked resolved. You can now run Update Project / Commit / etc."));
    } catch (e: unknown) {
      await showGitError("Mark resolved", e);
    }
    return;
  }

  // Finalize stash-pop: mark files resolved, drop the stash entry, clear sentinel.
  if (pick.label.startsWith("$(check) Finalize")) {
    try {
      // Stage all the previously-conflicted files (assumes user already saved
      // the resolved content via the merge editor — VS Code's git.openMergeEditor
      // writes the resolved content back).
      if (state.conflicted.length) {
        await runGit(["add", "--", ...state.conflicted], { cwd: root });
      }
      if (state.stashRef) {
        await runGit(["stash", "drop", state.stashRef], { cwd: root });
      }
      await clearStashPopInProgress(root);
      repos.fire();
      vscode.window.showInformationMessage(vscode.l10n.t("Stash finalized; conflicts resolved."));
    } catch (e: unknown) {
      await showGitError("Finalize stash", e);
    }
    return;
  }

  if (pick.label.startsWith("$(discard) Keep stash")) {
    await clearStashPopInProgress(root);
    repos.fire();
    return;
  }

  // Abort
  if (pick.label.startsWith("$(circle-slash) Abort")) {
    const target = state.kind;
    let warn: string;
    if (target === "stash-pop") {
      warn = "Abort stash pop? Conflict markers will be reverted; your stash entry stays in 'git stash list'.";
    } else if (target === "orphan-unmerged") {
      warn = "Discard UU files and revert them to HEAD? Your in-progress conflict resolution will be lost.";
    } else {
      warn = `Abort ${target}? This rolls back to the pre-operation state.`;
    }
    const abortLabel = vscode.l10n.t("Abort");
    const ok = await vscode.window.showWarningMessage(warn, { modal: true }, abortLabel);
    if (ok !== abortLabel) return;
    try {
      if (target === "stash-pop") {
        if (state.conflicted.length) {
          await runGit(["checkout", "--", ...state.conflicted], { cwd: root });
        }
        await clearStashPopInProgress(root);
      } else if (target === "orphan-unmerged") {
        if (state.conflicted.length) {
          // `git checkout -- <paths>` restores from index, but for UU files the
          // index has multiple stages — use `git checkout HEAD -- <paths>` to
          // force-reset to the committed version.
          await runGit(["checkout", "HEAD", "--", ...state.conflicted], { cwd: root });
        }
      } else {
        await abortOperation(root, target as Exclude<OperationState["kind"], null | "stash-pop" | "orphan-unmerged">);
      }
      repos.fire();
    } catch (e: unknown) {
      await showGitError(`Abort ${target}`, e);
    }
    return;
  }
}
