import * as vscode from "vscode";

export function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

export function asset(webview: vscode.Webview, ctx: vscode.ExtensionContext, ...parts: string[]): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, ...parts));
}

export function csp(webview: vscode.Webview, n: string): string {
  return [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");
}
