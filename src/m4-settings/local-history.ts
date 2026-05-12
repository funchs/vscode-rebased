import * as vscode from "vscode";
import * as crypto from "crypto";
import * as path from "path";
import type { RepoManager } from "../core/repo";

// Auto-snapshot every file save under the active workspace into
// <globalStorage>/local-history/<repoHash>/<pathHash>/<timestamp>.snap.
// Diffs and restores re-create a virtual document via the rebased-history scheme.
//
// Retention: keep <maxPerFile> snapshots per file, pruned by oldest mtime.
// Skipped: dotfiles inside .git/, files larger than maxBytes, binary content
// (heuristic: any NUL byte in the first 8KB).

interface SnapshotMeta {
  timestamp: number;
  size: number;
}

const SCHEME = "rebased-history";

function repoHash(root: string): string {
  return crypto.createHash("sha1").update(root).digest("hex").slice(0, 12);
}
function pathHash(p: string): string {
  return crypto.createHash("sha1").update(p).digest("hex").slice(0, 16);
}

export class LocalHistory implements vscode.Disposable {
  private storage: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private maxPerFile: number;
  private maxBytes: number;

  constructor(ctx: vscode.ExtensionContext, private repos: RepoManager) {
    this.storage = vscode.Uri.joinPath(ctx.globalStorageUri, "local-history");
    const cfg = vscode.workspace.getConfiguration("rebased.localHistory");
    this.maxPerFile = cfg.get<number>("maxPerFile", 50);
    this.maxBytes = cfg.get<number>("maxBytes", 1024 * 1024);

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((d) => void this.snapshot(d)),
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, new HistoryDocProvider(this))
    );
  }

  private async snapshot(doc: vscode.TextDocument): Promise<void> {
    if (doc.uri.scheme !== "file") return;
    const root = this.repos.root;
    if (!root || !doc.uri.fsPath.startsWith(root)) return;
    if (doc.uri.fsPath.includes("/.git/")) return;
    const content = doc.getText();
    if (Buffer.byteLength(content, "utf8") > this.maxBytes) return;
    // Binary heuristic
    const head = content.slice(0, 8192);
    if (head.includes("\x00")) return;

    const rel = path.relative(root, doc.uri.fsPath);
    const dir = vscode.Uri.joinPath(this.storage, repoHash(root), pathHash(rel));
    try {
      await vscode.workspace.fs.createDirectory(dir);
    } catch { /* exists */ }

    // De-dup: skip if last snapshot has identical content.
    const existing = await this.list(rel);
    if (existing.length) {
      try {
        const last = await this.read(rel, existing[0].timestamp);
        if (last === content) return;
      } catch { /* fall through */ }
    }

    const ts = Date.now();
    const snapUri = vscode.Uri.joinPath(dir, `${ts}.snap`);
    const indexUri = vscode.Uri.joinPath(dir, "index.json");
    await vscode.workspace.fs.writeFile(snapUri, Buffer.from(content, "utf8"));

    let index: { rel: string; entries: SnapshotMeta[] };
    try {
      const buf = await vscode.workspace.fs.readFile(indexUri);
      index = JSON.parse(Buffer.from(buf).toString("utf8"));
    } catch {
      index = { rel, entries: [] };
    }
    index.entries.unshift({ timestamp: ts, size: Buffer.byteLength(content, "utf8") });

    // Prune oldest beyond maxPerFile.
    while (index.entries.length > this.maxPerFile) {
      const dropped = index.entries.pop()!;
      try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, `${dropped.timestamp}.snap`));
      } catch { /* already gone */ }
    }
    await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify(index), "utf8"));
  }

  async list(rel: string): Promise<SnapshotMeta[]> {
    const root = this.repos.root;
    if (!root) return [];
    const indexUri = vscode.Uri.joinPath(this.storage, repoHash(root), pathHash(rel), "index.json");
    try {
      const buf = await vscode.workspace.fs.readFile(indexUri);
      const idx = JSON.parse(Buffer.from(buf).toString("utf8"));
      return idx.entries ?? [];
    } catch {
      return [];
    }
  }

  async read(rel: string, timestamp: number): Promise<string> {
    const root = this.repos.root;
    if (!root) throw new Error("no repo");
    const snapUri = vscode.Uri.joinPath(this.storage, repoHash(root), pathHash(rel), `${timestamp}.snap`);
    const buf = await vscode.workspace.fs.readFile(snapUri);
    return Buffer.from(buf).toString("utf8");
  }

  async showHistory(target?: vscode.Uri): Promise<void> {
    const root = this.repos.root;
    if (!root) return;
    const uri = target ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      vscode.window.showInformationMessage("Open a file first.");
      return;
    }
    const rel = path.relative(root, uri.fsPath);
    const entries = await this.list(rel);
    if (!entries.length) {
      vscode.window.showInformationMessage(`No local history yet for ${rel}.`);
      return;
    }

    const items = entries.map((e) => ({
      label: `$(history) ${new Date(e.timestamp).toLocaleString()}`,
      description: `${(e.size / 1024).toFixed(1)} KB`,
      timestamp: e.timestamp,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `${entries.length} snapshot(s) of ${rel}`,
    });
    if (!pick) return;

    const action = await vscode.window.showQuickPick(
      [
        { label: "$(diff) Diff against current", value: "diff" },
        { label: "$(eye) Open snapshot read-only", value: "open" },
        { label: "$(history) Restore (overwrite current)", value: "restore" },
      ],
      { placeHolder: `${new Date(pick.timestamp).toLocaleString()} · ${rel}` }
    );
    if (!action) return;

    const historyUri = uri.with({
      scheme: SCHEME,
      path: uri.path,
      query: JSON.stringify({ root, rel, timestamp: pick.timestamp }),
    });

    switch (action.value) {
      case "diff":
        await vscode.commands.executeCommand(
          "vscode.diff",
          historyUri,
          uri,
          `${path.basename(rel)} · ${new Date(pick.timestamp).toLocaleString()} → current`
        );
        break;
      case "open":
        await vscode.window.showTextDocument(historyUri);
        break;
      case "restore": {
        const ok = await vscode.window.showWarningMessage(
          `Restore ${rel} to the snapshot from ${new Date(pick.timestamp).toLocaleString()}? Current content will be replaced.`,
          { modal: true },
          "Restore"
        );
        if (ok !== "Restore") return;
        const content = await this.read(rel, pick.timestamp);
        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
        await vscode.workspace.applyEdit(edit);
        break;
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

class HistoryDocProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly history: LocalHistory) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const q = JSON.parse(uri.query) as { rel: string; timestamp: number };
      return await this.history.read(q.rel, q.timestamp);
    } catch (e: unknown) {
      return `// Failed to load snapshot: ${(e as Error).message}`;
    }
  }
}
