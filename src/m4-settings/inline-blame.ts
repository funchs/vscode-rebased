import * as vscode from "vscode";
import { blameFile, relTime, type BlameLine } from "../core/blame";
import type { RepoManager } from "../core/repo";

// Trailing decoration on the active line.
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
      try {
        const rel = key.startsWith(root + "/") ? key.slice(root.length + 1) : key;
        blame = await blameFile(root, rel);
      } catch {
        blame = "unavailable";
      }
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
    const text = ` ${info.author} · ${relTime(info.date)} ago · ${info.summary}`;
    editor.setDecorations(this.decorationType, [
      {
        range: new vscode.Range(line, doc.lineAt(line).text.length, line, doc.lineAt(line).text.length),
        renderOptions: { after: { contentText: text } },
      },
    ]);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.decorationType.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
