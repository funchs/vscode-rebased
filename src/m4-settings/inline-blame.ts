import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";

interface BlameLine {
  hash: string;
  author: string;
  date: number;
  summary: string;
}

// Trailing decoration on the active line: "Author · 3 days ago · subject".
// Blame is parsed lazily per file and cached until the file changes.
export class InlineBlame implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType;
  private cache = new Map<string, BlameLine[] | "pending" | "unavailable">();
  private timer?: NodeJS.Timeout;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly repos: RepoManager) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        margin: "0 0 0 3em",
        fontStyle: "italic",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.schedule(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((e) => e && this.schedule(e)),
      vscode.workspace.onDidChangeTextDocument((e) => this.cache.delete(e.document.uri.fsPath)),
      repos.onChange(() => this.cache.clear())
    );
    if (vscode.window.activeTextEditor) this.schedule(vscode.window.activeTextEditor);
  }

  private schedule(editor: vscode.TextEditor): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.render(editor), 120);
  }

  private async render(editor: vscode.TextEditor): Promise<void> {
    const root = this.repos.root;
    const doc = editor.document;
    if (!root || doc.uri.scheme !== "file" || !doc.uri.fsPath.startsWith(root)) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const key = doc.uri.fsPath;
    let blame = this.cache.get(key);
    if (blame === "pending") return;
    if (blame === undefined) {
      this.cache.set(key, "pending");
      blame = await this.load(root, doc.uri.fsPath);
      this.cache.set(key, blame);
    }
    if (blame === "unavailable") {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const line = editor.selection.active.line;
    const info = blame[line];
    if (!info || info.hash.startsWith("0000000")) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const text = ` ${info.author} · ${this.relTime(info.date)} · ${info.summary}`;
    editor.setDecorations(this.decorationType, [
      {
        range: new vscode.Range(line, doc.lineAt(line).text.length, line, doc.lineAt(line).text.length),
        renderOptions: { after: { contentText: text } },
      },
    ]);
  }

  private async load(root: string, file: string): Promise<BlameLine[] | "unavailable"> {
    try {
      const rel = file.startsWith(root + "/") ? file.slice(root.length + 1) : file;
      const out = await runGit(["blame", "--porcelain", "--", rel], { cwd: root });
      return this.parsePorcelain(out);
    } catch {
      return "unavailable";
    }
  }

  private parsePorcelain(raw: string): BlameLine[] {
    const lines = raw.split("\n");
    const commitMeta = new Map<string, { author: string; date: number; summary: string }>();
    const result: BlameLine[] = [];
    let cur: { author?: string; date?: number; summary?: string } = {};
    let curHash = "";
    let i = 0;
    while (i < lines.length) {
      const header = lines[i];
      const m = header.match(/^([0-9a-f]{40})(?: \d+){2,3}$/);
      if (!m) { i++; continue; }
      curHash = m[1];
      cur = commitMeta.get(curHash) ? { ...commitMeta.get(curHash) } : {};
      i++;
      while (i < lines.length && !lines[i].startsWith("\t")) {
        const line = lines[i];
        if (line.startsWith("author ")) cur.author = line.slice(7);
        else if (line.startsWith("author-time ")) cur.date = parseInt(line.slice(12), 10) * 1000;
        else if (line.startsWith("summary ")) cur.summary = line.slice(8);
        i++;
      }
      if (cur.author && cur.date != null && cur.summary != null) {
        commitMeta.set(curHash, { author: cur.author, date: cur.date, summary: cur.summary });
      }
      const meta = commitMeta.get(curHash);
      if (meta) {
        result.push({ hash: curHash, ...meta });
      } else {
        result.push({ hash: curHash, author: "?", date: 0, summary: "" });
      }
      i++; // skip the \t<content> line
    }
    return result;
  }

  private relTime(ms: number): string {
    const diff = (Date.now() - ms) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} d ago`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} mo ago`;
    return `${Math.floor(diff / 31536000)} y ago`;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.decorationType.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
