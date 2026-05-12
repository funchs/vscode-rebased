import * as vscode from "vscode";
import { getStashes } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { StashEntry } from "../core/types";

export class StashTreeProvider implements vscode.TreeDataProvider<StashItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly repos: RepoManager) {
    repos.onChange(() => this._onDidChangeTreeData.fire());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: StashItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<StashItem[]> {
    const root = this.repos.root;
    if (!root) return [];
    const stashes = await getStashes(root);
    return stashes.map((s) => new StashItem(s));
  }
}

export class StashItem extends vscode.TreeItem {
  constructor(public readonly stash: StashEntry) {
    super(stash.subject, vscode.TreeItemCollapsibleState.None);
    this.id = stash.ref;
    this.description = stash.branch;
    this.contextValue = "stash";
    this.iconPath = new vscode.ThemeIcon("archive");
    this.tooltip = `${stash.ref}\n${stash.subject}`;
  }
}
