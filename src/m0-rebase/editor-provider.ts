import * as vscode from "vscode";
import { parseTodo, serializeTodo } from "./rebase-todo";
import { asset, csp, nonce } from "../core/webview-util";

export class RebaseEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "rebased.rebaseTodo";

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "out"), vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    panel.webview.html = this.renderHtml(panel.webview);

    const push = () => {
      panel.webview.postMessage({ type: "load", todo: parseTodo(document.getText()) });
    };

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) push();
    });
    panel.onDidDispose(() => sub.dispose());

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "ready") {
        push();
      } else if (msg.type === "save") {
        const text = serializeTodo(msg.todo);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(0, 0, document.lineCount, 0),
          text
        );
        await vscode.workspace.applyEdit(edit);
        await document.save();
        vscode.window.showInformationMessage("Rebase plan saved. Git will continue.");
      } else if (msg.type === "abort") {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      }
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const n = nonce();
    const scriptUri = asset(webview, this.ctx, "out", "webview", "rebase.js");
    const styleUri = asset(webview, this.ctx, "media", "rebase.css");
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp(webview, n)}" />
<link rel="stylesheet" href="${styleUri}" />
<title>Interactive Rebase</title>
</head>
<body>
<header>
  <h1>Interactive Rebase</h1>
  <div class="hint">Drag rows to reorder. Click action label to change. Save to continue rebase.</div>
  <div class="toolbar">
    <button id="save" class="primary">Start Rebase (⌘⏎)</button>
    <button id="abort">Abort</button>
  </div>
</header>
<ul id="list" aria-label="Rebase plan"></ul>
<template id="row-tpl">
  <li class="row" draggable="true">
    <span class="handle" aria-hidden="true">⋮⋮</span>
    <button class="action" data-action="pick" aria-label="Action"></button>
    <code class="hash"></code>
    <span class="subject"></span>
  </li>
</template>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
