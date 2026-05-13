import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";

export class BranchStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor(private readonly repos: RepoManager) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = "rebased.branch.create";
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
      const head = (await runGit(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: root })).trim();
      const dirty = (await runGit(["status", "--porcelain"], { cwd: root })).trim().length > 0;
      this.item.text = `$(git-branch) ${head || "(detached)"}${dirty ? "*" : ""}`;
      this.item.tooltip = vscode.l10n.t("Rebased — {0}\nClick to create a new branch", head || vscode.l10n.t("detached HEAD"));
      this.item.show();
    } catch {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
