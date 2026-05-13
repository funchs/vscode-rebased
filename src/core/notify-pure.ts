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

// `git stash pop` with -u: when any untracked file in the stash already lives
// in the working tree (e.g. upstream just introduced the same path), git
// refuses with a line shaped like "<path> already exists, no checkout".
// Modern git: bare path. Older git: numbered ("1: <path>..."). Our runGit
// wrapper prefixes "git <cmd> exited <code>: " on top, so we strip both
// possible prefixes per line.
const WRAPPER_PREFIX = /^git\s+\S.*?\s+exited\s+\d+:\s*/;
const NUMBER_PREFIX = /^\d+:\s*/;
export function parseUntrackedCollisions(message: string): string[] {
  const out: string[] = [];
  for (const rawLine of message.split(/\r?\n/)) {
    let line = rawLine.replace(WRAPPER_PREFIX, "");
    line = line.replace(NUMBER_PREFIX, "");
    const m = line.match(/^(.+?)\s+already exists, no checkout\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

export function isStashConflictMessage(message: string): boolean {
  return /(CONFLICT|merge conflict|needs merge|conflict in)/i.test(message);
}
