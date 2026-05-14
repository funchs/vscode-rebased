import * as vscode from "vscode";
import { getBranches } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { BranchInfo } from "../core/types";

export class BranchTreeProvider implements vscode.TreeDataProvider<BranchItem | GroupItem> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private readonly repos: RepoManager) {
    repos.onChange(() => this._emitter.fire());
  }

  getTreeItem(item: BranchItem | GroupItem): vscode.TreeItem {
    return item;
  }

  async getChildren(element?: BranchItem | GroupItem): Promise<(BranchItem | GroupItem)[]> {
    const root = this.repos.root;
    if (!root) return [];
    const all = await getBranches(root);
    if (!element) {
      const local = all.filter((b) => !b.remote);
      const remote = all.filter((b) => b.remote);
      return [
        new GroupItem(vscode.l10n.t("Local"), local),
        new GroupItem(vscode.l10n.t("Remote"), remote),
      ];
    }
    if (element instanceof GroupItem) {
      return element.branches.map((b) => new BranchItem(b));
    }
    return [];
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(label: string, public branches: BranchInfo[]) {
    super(`${label} (${branches.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "branch-group";
  }
}

export class BranchItem extends vscode.TreeItem {
  constructor(public branch: BranchInfo) {
    super(branch.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = branch.current
      ? "branch-current"
      : branch.remote
      ? "branch-remote"
      : "branch-local";
    this.iconPath = new vscode.ThemeIcon(branch.current ? "check" : "git-branch");
    const bits: string[] = [];
    if (branch.upstream) bits.push(`→ ${branch.upstream}`);
    if (branch.ahead) bits.push(`↑${branch.ahead}`);
    if (branch.behind) bits.push(`↓${branch.behind}`);
    if (bits.length) this.description = bits.join(" ");
    // Default click action: reveal the Log view filtered to this branch.
    // VS Code's `workbench.list.openMode` (singleClick / doubleClick) decides
    // when this fires.
    this.command = {
      command: "rebased.log.showBranch",
      title: vscode.l10n.t("Show in Log"),
      arguments: [this],
    };
  }
}
