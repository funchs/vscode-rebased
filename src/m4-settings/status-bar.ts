import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";

// Compact entry point for the Log panel. Deliberately avoids duplicating the
// VS Code built-in git status bar item (which already shows branch name + sync
// arrows). Instead surfaces what Rebased uniquely provides:
//
//   • A click target for the Log panel (icon-only by default).
//   • The stash count, which the built-in git item doesn't expose.
//
// Conflict state is owned by ConflictWatcher (a separate status bar item) so
// we don't double up there either.
export class BranchStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor(private readonly repos: RepoManager) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = "rebased.log.openPanel";
    repos.onChange(() => void this.refresh());
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const root = this.repos.root;
    if (!root) {
      this.item.hide();
      return;
    }
    try {
      const [headRaw, stashRaw] = await Promise.all([
        runGit(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: root }).catch(() => ""),
        runGit(["stash", "list"], { cwd: root }).catch(() => ""),
      ]);
      const head = headRaw.trim();
      const stashCount = stashRaw.trim() ? stashRaw.trim().split("\n").length : 0;

      this.item.text = stashCount > 0 ? `$(history) ${stashCount}` : `$(history)`;
      this.item.tooltip = new vscode.MarkdownString(
        vscode.l10n.t("**Rebased Log**\n\nBranch: `{0}`\n\nStashes: {1}\n\nClick to open the Log panel.",
          head || vscode.l10n.t("detached HEAD"),
          String(stashCount))
      );
      this.item.show();
    } catch {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
