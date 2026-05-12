import * as vscode from "vscode";
import { blameFile, relTime, type BlameLine } from "../core/blame";
import type { RepoManager } from "../core/repo";

// Per-line blame in the gutter (before-text decoration). Toggleable per editor
// via the rebased.blame.toggleGutter command. Lines from the same commit are
// collapsed: only the first row of a run shows the annotation.

interface EditorState {
  decoration: vscode.TextEditorDecorationType;
  shown: boolean;
}

export class BlameGutter implements vscode.Disposable {
  private states = new WeakMap<vscode.TextEditor, EditorState>();
  private blameCache = new Map<string, BlameLine[] | "unavailable">();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly repos: RepoManager) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.blameCache.delete(e.document.uri.fsPath);
        for (const ed of vscode.window.visibleTextEditors) {
          if (ed.document.uri.fsPath === e.document.uri.fsPath) this.refresh(ed);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors((eds) => {
        for (const ed of eds) this.refresh(ed);
      }),
      repos.onChange(() => {
        this.blameCache.clear();
        for (const ed of vscode.window.visibleTextEditors) this.refresh(ed);
      })
    );
  }

  async toggle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const st = this.states.get(editor);
    if (st?.shown) {
      st.shown = false;
      editor.setDecorations(st.decoration, []);
      return;
    }
    if (!st) {
      this.states.set(editor, {
        decoration: this.makeDecorationType(),
        shown: true,
      });
    } else {
      st.shown = true;
    }
    await this.refresh(editor);
  }

  private makeDecorationType(): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      before: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        margin: "0 1em 0 0",
        // Reserve consistent width so code doesn't jump when annotations vary.
        width: "22ch",
      },
      isWholeLine: false,
    });
  }

  private async refresh(editor: vscode.TextEditor): Promise<void> {
    const st = this.states.get(editor);
    if (!st?.shown) return;
    const root = this.repos.root;
    const doc = editor.document;
    if (!root || doc.uri.scheme !== "file" || !doc.uri.fsPath.startsWith(root)) {
      editor.setDecorations(st.decoration, []);
      return;
    }
    const key = doc.uri.fsPath;
    let blame = this.blameCache.get(key);
    if (!blame) {
      try {
        const rel = key.startsWith(root + "/") ? key.slice(root.length + 1) : key;
        blame = await blameFile(root, rel);
      } catch {
        blame = "unavailable";
      }
      this.blameCache.set(key, blame);
    }
    if (blame === "unavailable") {
      editor.setDecorations(st.decoration, []);
      return;
    }

    const decorations: vscode.DecorationOptions[] = [];
    let lastHash = "";
    for (let i = 0; i < Math.min(blame.length, doc.lineCount); i++) {
      const info = blame[i];
      if (!info || info.hash.startsWith("0000000")) continue;
      const collapsed = info.hash === lastHash;
      const text = collapsed
        ? ""
        : `${info.hash.slice(0, 7)} ${truncate(info.author, 10).padEnd(10)} ${relTime(info.date).padStart(4)}`;
      decorations.push({
        range: new vscode.Range(i, 0, i, 0),
        renderOptions: { before: { contentText: text } },
        hoverMessage: hoverFor(info),
      });
      lastHash = info.hash;
    }
    editor.setDecorations(st.decoration, decorations);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function hoverFor(info: BlameLine): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown(`**${escape(info.summary)}**\n\n`);
  md.appendMarkdown(`\`${info.hash.slice(0, 7)}\` · ${escape(info.author)} · ${new Date(info.date).toLocaleString()}\n\n`);
  md.appendMarkdown(
    `[Show commit](command:rebased.commit.show?${encodeURIComponent(JSON.stringify([info.hash]))})`
  );
  return md;
}

function escape(s: string): string {
  return s.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));
}
