import * as vscode from "vscode";
import { getOperationState } from "../core/git";
import type { RepoManager } from "../core/repo";

// Status bar badge that tracks rebase/merge/cherry-pick/revert/stash-pop state.
// Click → the conflict resolver webview (registered in extension.ts). The
// previous QuickPick-based showConflictResolution has been replaced by
// ConflictResolverPanel; this file now only owns the status indicator.

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
    this.statusItem.tooltip = vscode.l10n.t("{0} in progress — click to resolve", state.kind);
    this.statusItem.show();

    const sig = `${state.kind}:${total}`;
    if (sig !== this.lastShownState) {
      this.lastShownState = sig;
      if (total > 0) {
        vscode.window.setStatusBarMessage(
          `$(warning) ` + vscode.l10n.t("Rebased: {0} conflict(s) in {1}", String(total), state.kind),
          5000
        );
      }
    }
  }

  dispose(): void {
    this.statusItem.dispose();
  }
}
