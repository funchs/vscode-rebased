import * as vscode from "vscode";
import { findRepoRoot } from "./git";

export class RepoManager implements vscode.Disposable {
  private _root: string | undefined;
  private _onChange = new vscode.EventEmitter<void>();
  readonly onChange = this._onChange.event;
  private watcher?: vscode.FileSystemWatcher;
  private disposed = false;

  constructor() {
    void this.detect();
    vscode.workspace.onDidChangeWorkspaceFolders(() => this.detect());
  }

  get root(): string | undefined {
    return this._root;
  }

  fire(): void {
    if (!this.disposed) this._onChange.fire();
  }

  private async detect(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this._root = undefined;
      this.watcher?.dispose();
      this.watcher = undefined;
      this.fire();
      return;
    }
    const root = await findRepoRoot(folder.uri.fsPath);
    this._root = root;
    this.watcher?.dispose();
    if (root) {
      const pattern = new vscode.RelativePattern(root, ".git/{HEAD,index,refs/**,packed-refs,ORIG_HEAD,MERGE_HEAD}");
      this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.watcher.onDidChange(() => this.fire());
      this.watcher.onDidCreate(() => this.fire());
      this.watcher.onDidDelete(() => this.fire());
    }
    this.fire();
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.dispose();
    this._onChange.dispose();
  }
}
