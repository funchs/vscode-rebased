import * as vscode from "vscode";
import { getOperationState, continueOperation, abortOperation } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { OperationState } from "../core/git";

// Auto-popups the conflict panel whenever .git enters rebase/merge/cherry-pick.
// The panel itself uses a plain QuickPick + status-bar combo rather than a
// webview — every action it offers maps to a VS Code command, so a webview
// would add latency without buying clarity.

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
    this.statusItem.tooltip = `${state.kind} in progress — click to resolve`;
    this.statusItem.show();

    const sig = `${state.kind}:${total}`;
    if (sig !== this.lastShownState) {
      this.lastShownState = sig;
      if (total > 0) {
        vscode.window.setStatusBarMessage(
          `$(warning) Rebased: ${total} conflict${total === 1 ? "" : "s"} in ${state.kind}`,
          5000
        );
      }
    }
  }

  dispose(): void {
    this.statusItem.dispose();
  }
}

export async function showConflictResolution(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const state = await getOperationState(root);
  if (!state.kind) {
    vscode.window.showInformationMessage("No rebase/merge/cherry-pick in progress.");
    return;
  }
  const items: vscode.QuickPickItem[] = state.conflicted.map((p) => ({
    label: `$(warning) ${p}`,
    description: "Open in 3-way merge editor",
  }));
  const canContinue = state.conflicted.length === 0;
  items.push(
    {
      label: canContinue ? `$(check) Continue ${state.kind}` : `$(circle-slash) Continue (resolve conflicts first)`,
      description: canContinue ? "" : "All conflicts must be staged",
      kind: vscode.QuickPickItemKind.Separator,
    } as vscode.QuickPickItem,
    { label: canContinue ? "Continue" : "Continue (blocked)", description: state.kind, alwaysShow: true },
    { label: "Abort", description: `Abort the ${state.kind}`, alwaysShow: true }
  );

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `${state.kind} — ${state.conflicted.length} conflict(s)`,
  });
  if (!pick) return;

  if (pick.label === "Continue" && canContinue) {
    try {
      await continueOperation(root, state.kind as NonNullable<OperationState["kind"]>);
      repos.fire();
      vscode.window.showInformationMessage(`${state.kind} continued.`);
    } catch (e: unknown) {
      vscode.window.showErrorMessage(`Continue failed: ${(e as Error).message}`);
    }
    return;
  }
  if (pick.label.startsWith("Abort")) {
    const ok = await vscode.window.showWarningMessage(
      `Abort ${state.kind}? This rolls back to the pre-operation state.`,
      { modal: true },
      "Abort"
    );
    if (ok !== "Abort") return;
    try {
      await abortOperation(root, state.kind as NonNullable<OperationState["kind"]>);
      repos.fire();
    } catch (e: unknown) {
      vscode.window.showErrorMessage(`Abort failed: ${(e as Error).message}`);
    }
    return;
  }

  if (pick.label.startsWith("$(warning)")) {
    const path = pick.label.replace("$(warning) ", "");
    const uri = vscode.Uri.joinPath(vscode.Uri.file(root), path);
    // VS Code 1.69+ has a built-in 3-way merge editor; openMergeEditor activates it.
    try {
      await vscode.commands.executeCommand("git.openMergeEditor", uri);
    } catch {
      // Fallback: open the conflicted file directly so the user can edit markers.
      await vscode.window.showTextDocument(uri);
    }
  }
}
