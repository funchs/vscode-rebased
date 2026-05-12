import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError } from "../core/notify";

interface Submodule {
  prefix: string;     // " ", "-" (not init), "+" (out of sync), "U" (merge conflict)
  hash: string;
  path: string;
  describe: string;
}

async function listSubmodules(root: string): Promise<Submodule[]> {
  try {
    const raw = await runGit(["submodule", "status", "--recursive"], { cwd: root });
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => {
        const prefix = l[0];
        const rest = l.slice(1);
        const m = rest.match(/^([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?$/);
        if (!m) return { prefix, hash: "", path: rest.trim(), describe: "" };
        return { prefix, hash: m[1], path: m[2], describe: m[3] ?? "" };
      });
  } catch {
    return [];
  }
}

export class SubmoduleTreeProvider implements vscode.TreeDataProvider<Submodule> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private repos: RepoManager) {
    repos.onChange(() => this._emitter.fire());
  }

  getTreeItem(sm: Submodule): vscode.TreeItem {
    const item = new vscode.TreeItem(sm.path, vscode.TreeItemCollapsibleState.None);
    item.contextValue = "submodule";
    item.description = sm.describe || sm.hash.slice(0, 7);
    if (sm.prefix === "-") {
      item.iconPath = new vscode.ThemeIcon("circle-slash");
      item.tooltip = "Not initialized";
    } else if (sm.prefix === "+") {
      item.iconPath = new vscode.ThemeIcon("warning");
      item.tooltip = "Out of sync with the recorded commit";
    } else if (sm.prefix === "U") {
      item.iconPath = new vscode.ThemeIcon("error");
      item.tooltip = "Merge conflict in submodule";
    } else {
      item.iconPath = new vscode.ThemeIcon("file-submodule");
    }
    return item;
  }

  async getChildren(): Promise<Submodule[]> {
    const root = this.repos.root;
    if (!root) return [];
    return await listSubmodules(root);
  }
}

export function registerSubmoduleCommands(ctx: vscode.ExtensionContext, repos: RepoManager): void {
  const run = async (args: string[], success: string) => {
    const root = repos.root;
    if (!root) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: success },
      async () => {
        try {
          await runGit(args, { cwd: root });
          repos.fire();
        } catch (e: unknown) {
          await showGitError(success, e);
        }
      }
    );
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.submodule.init", (sm?: { path: string }) =>
      run(["submodule", "update", "--init", "--recursive", ...(sm?.path ? ["--", sm.path] : [])], "Initializing submodule")
    ),
    vscode.commands.registerCommand("rebased.submodule.update", (sm?: { path: string }) =>
      run(["submodule", "update", "--remote", "--recursive", ...(sm?.path ? ["--", sm.path] : [])], "Updating submodule")
    ),
    vscode.commands.registerCommand("rebased.submodule.sync", (sm?: { path: string }) =>
      run(["submodule", "sync", "--recursive", ...(sm?.path ? ["--", sm.path] : [])], "Syncing submodule URL")
    ),
    vscode.commands.registerCommand("rebased.submodule.refresh", () => repos.fire())
  );
}
