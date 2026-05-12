// Pure helpers used by the toast layer. Kept vscode-free so tests can import
// directly without bundling the extension API.

export function stripCodicons(s: string): string {
  return s.replace(/\$\([a-zA-Z0-9-]+\)\s?/g, "");
}

export function firstNonEmptyLine(s: string): string {
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("fatal:")) return t;
  }
  return s.split("\n")[0] ?? s;
}

export function isWorkingTreeDirtyError(message: string): boolean {
  return /(would be overwritten|local changes|uncommitted changes|not a fast.forward|untracked working tree files)/i.test(message);
}
