import * as vscode from "vscode";
import { getStatus, runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError } from "../core/notify";

// JetBrains-style "changelists": named groups of working-tree file paths.
// State lives in workspaceState, scoped per repo root. Files not in any
// changelist fall into the implicit "Default" group.

const KEY_PREFIX = "rebased.changelists.";

interface ChangelistMap {
  active: string;                 // name of the "default" / active changelist
  lists: Record<string, string[]>; // name -> paths
}

function emptyMap(): ChangelistMap {
  return { active: "Default", lists: { Default: [] } };
}

export class ChangelistManager {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this._emitter.event;

  constructor(private ctx: vscode.ExtensionContext, private repos: RepoManager) {
    repos.onChange(() => this._emitter.fire());
  }

  private key(): string {
    return KEY_PREFIX + (this.repos.root ?? "");
  }

  state(): ChangelistMap {
    return this.ctx.workspaceState.get<ChangelistMap>(this.key()) ?? emptyMap();
  }

  private async save(state: ChangelistMap): Promise<void> {
    await this.ctx.workspaceState.update(this.key(), state);
    this._emitter.fire();
  }

  async createList(name: string): Promise<void> {
    const s = this.state();
    if (s.lists[name]) return;
    s.lists[name] = [];
    await this.save(s);
  }

  async deleteList(name: string): Promise<void> {
    const s = this.state();
    if (!s.lists[name] || name === "Default") return;
    delete s.lists[name];
    if (s.active === name) s.active = "Default";
    await this.save(s);
  }

  async renameList(oldName: string, newName: string): Promise<void> {
    const s = this.state();
    if (!s.lists[oldName] || oldName === newName) return;
    if (s.lists[newName]) return;
    s.lists[newName] = s.lists[oldName];
    delete s.lists[oldName];
    if (s.active === oldName) s.active = newName;
    await this.save(s);
  }

  async assignFile(list: string, path: string): Promise<void> {
    const s = this.state();
    if (!s.lists[list]) s.lists[list] = [];
    for (const name of Object.keys(s.lists)) {
      s.lists[name] = s.lists[name].filter((p) => p !== path);
    }
    s.lists[list].push(path);
    await this.save(s);
  }

  async setActive(name: string): Promise<void> {
    const s = this.state();
    if (!s.lists[name]) return;
    s.active = name;
    await this.save(s);
  }

  classify(allChangedPaths: string[]): Map<string, string[]> {
    const s = this.state();
    const known = new Set<string>();
    const result = new Map<string, string[]>();
    for (const name of Object.keys(s.lists)) {
      const present = s.lists[name].filter((p) => allChangedPaths.includes(p));
      result.set(name, present);
      for (const p of present) known.add(p);
    }
    // Files not assigned go to active list (default behavior).
    const orphan = allChangedPaths.filter((p) => !known.has(p));
    const active = result.get(s.active) ?? [];
    result.set(s.active, [...active, ...orphan]);
    return result;
  }

  async commitChangelist(list: string, message: string): Promise<void> {
    const root = this.repos.root;
    if (!root) throw new Error("no repo");
    const all = (await getStatus(root)).map((f) => f.path);
    const buckets = this.classify(all);
    const targets = buckets.get(list) ?? [];
    if (!targets.length) throw new Error(`Changelist "${list}" is empty.`);
    // Reset all staged paths first to ensure we only commit the chosen subset,
    // even if the user pre-staged unrelated files.
    await runGit(["reset", "HEAD"], { cwd: root });
    await runGit(["add", "--", ...targets], { cwd: root });
    await runGit(["commit", "-m", message], { cwd: root });
    this.repos.fire();
  }
}

// Tree view -----------------------------------------------------------------

type Node =
  | { kind: "list"; name: string; active: boolean }
  | { kind: "file"; list: string; path: string };

export class ChangelistTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private mgr: ChangelistManager, private repos: RepoManager) {
    mgr.onDidChange(() => this._emitter.fire(undefined));
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === "list") {
      const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = n.active ? "changelist-active" : "changelist";
      item.iconPath = new vscode.ThemeIcon(n.active ? "list-tree" : "list-flat");
      if (n.active) item.description = "active";
      return item;
    }
    const item = new vscode.TreeItem(n.path, vscode.TreeItemCollapsibleState.None);
    item.contextValue = "changelist-file";
    item.iconPath = vscode.ThemeIcon.File;
    item.resourceUri = vscode.Uri.joinPath(vscode.Uri.file(this.repos.root ?? ""), n.path);
    item.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [item.resourceUri],
    };
    return item;
  }

  async getChildren(el?: Node): Promise<Node[]> {
    const root = this.repos.root;
    if (!root) return [];
    if (!el) {
      const all = (await getStatus(root)).map((f) => f.path);
      const buckets = this.mgr.classify(all);
      const active = this.mgr.state().active;
      // Keep deterministic order: active first, then alphabetical.
      const names = [...buckets.keys()].sort((a, b) => {
        if (a === active) return -1;
        if (b === active) return 1;
        return a.localeCompare(b);
      });
      return names.map((name) => ({ kind: "list", name, active: name === active }));
    }
    if (el.kind === "list") {
      const root2 = this.repos.root;
      if (!root2) return [];
      const all = (await getStatus(root2)).map((f) => f.path);
      const buckets = this.mgr.classify(all);
      const files = buckets.get(el.name) ?? [];
      // Deduplicate (staged + unstaged of the same path both arrive).
      const unique = [...new Set(files)];
      return unique.map((p) => ({ kind: "file", list: el.name, path: p }));
    }
    return [];
  }
}

// Commands -------------------------------------------------------------------

export function registerChangelistCommands(
  ctx: vscode.ExtensionContext,
  mgr: ChangelistManager,
  tree: ChangelistTreeProvider
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.changelist.create", async () => {
      const name = await vscode.window.showInputBox({ prompt: "New changelist name" });
      if (!name) return;
      await mgr.createList(name);
    }),
    vscode.commands.registerCommand("rebased.changelist.rename", async (node: Node) => {
      if (!node || node.kind !== "list") return;
      const next = await vscode.window.showInputBox({ prompt: `Rename ${node.name}`, value: node.name });
      if (!next || next === node.name) return;
      await mgr.renameList(node.name, next);
    }),
    vscode.commands.registerCommand("rebased.changelist.delete", async (node: Node) => {
      if (!node || node.kind !== "list" || node.name === "Default") return;
      const ok = await vscode.window.showWarningMessage(
        `Delete changelist "${node.name}"? Files move to Default.`,
        { modal: true },
        "Delete"
      );
      if (ok !== "Delete") return;
      await mgr.deleteList(node.name);
    }),
    vscode.commands.registerCommand("rebased.changelist.setActive", async (node: Node) => {
      if (!node || node.kind !== "list") return;
      await mgr.setActive(node.name);
    }),
    vscode.commands.registerCommand("rebased.changelist.commit", async (node: Node) => {
      if (!node || node.kind !== "list") return;
      const msg = await vscode.window.showInputBox({ prompt: `Commit message for "${node.name}"` });
      if (!msg) return;
      try {
        await mgr.commitChangelist(node.name, msg);
        vscode.window.showInformationMessage(`Committed "${node.name}".`);
      } catch (e: unknown) {
        await showGitError(`Commit changelist "${node.name}"`, e);
      }
    }),
    vscode.commands.registerCommand("rebased.changelist.moveFile", async (node: Node) => {
      if (!node || node.kind !== "file") return;
      const state = mgr.state();
      const target = await vscode.window.showQuickPick(
        Object.keys(state.lists).filter((n) => n !== node.list),
        { placeHolder: `Move ${node.path} to…` }
      );
      if (!target) return;
      await mgr.assignFile(target, node.path);
    }),
    vscode.commands.registerCommand("rebased.changelist.refresh", () => {
      (tree as unknown as { _emitter: vscode.EventEmitter<Node | undefined> })._emitter.fire(undefined);
    })
  );
}
