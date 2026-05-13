import * as vscode from "vscode";
import { runGit, getIndexLockInfo } from "../core/git";

// Best-effort repository health check, surfaced when the user is stuck on a
// persistent index-write error. The goal is to point the user at the real
// cause (almost always permissions, cloud-sync paths, or antivirus on macOS)
// instead of leaving them with just "could not write index".

interface Check {
  level: "ok" | "warn" | "error";
  title: string;
  detail?: string;
}

export async function runDiagnostic(root: string): Promise<string> {
  const checks: Check[] = [];
  const fs = await import("fs/promises");
  const fsConstants = (await import("fs")).constants;
  const path = await import("path");

  // 1. .git directory stat
  const gitDir = path.join(root, ".git");
  try {
    const stat = await fs.stat(gitDir);
    checks.push({
      level: "ok",
      title: `.git exists`,
      detail: `mode=${(stat.mode & 0o777).toString(8)} uid=${stat.uid}`,
    });
  } catch (e: unknown) {
    checks.push({ level: "error", title: ".git directory missing", detail: (e as Error).message });
  }

  // 2. .git/index permissions + writability
  const indexPath = path.join(gitDir, "index");
  try {
    const stat = await fs.stat(indexPath);
    checks.push({
      level: "ok",
      title: `.git/index present`,
      detail: `size=${stat.size}  mode=${(stat.mode & 0o777).toString(8)}  uid=${stat.uid}`,
    });
    try {
      await fs.access(indexPath, fsConstants.W_OK);
      checks.push({ level: "ok", title: ".git/index is writable" });
    } catch {
      checks.push({
        level: "error",
        title: ".git/index NOT writable",
        detail: "Run `chmod u+w .git/index` from a terminal, or check ownership.",
      });
    }
  } catch (e: unknown) {
    checks.push({ level: "error", title: ".git/index missing", detail: (e as Error).message });
  }

  // 3. .git/index.lock
  const lock = await getIndexLockInfo(root);
  if (lock.exists) {
    const ageS = Math.round((Date.now() - (lock.mtimeMs ?? Date.now())) / 1000);
    checks.push({
      level: ageS > 30 ? "error" : "warn",
      title: `.git/index.lock present (${ageS}s old)`,
      detail: ageS > 30
        ? "Stale lock — remove with `rm .git/index.lock` from a terminal."
        : "Fresh lock — another git process is likely active.",
    });
  } else {
    checks.push({ level: "ok", title: "No .git/index.lock" });
  }

  // 4. git status (does basic read work?)
  try {
    await runGit(["status", "--porcelain=v1"], { cwd: root });
    checks.push({ level: "ok", title: "git status succeeds" });
  } catch (e: unknown) {
    checks.push({ level: "error", title: "git status fails", detail: (e as Error).message });
  }

  // 5. git fsck (quick — only --connectivity-only)
  try {
    await runGit(["fsck", "--connectivity-only", "--no-progress"], { cwd: root });
    checks.push({ level: "ok", title: "git fsck (connectivity) clean" });
  } catch (e: unknown) {
    checks.push({
      level: "warn",
      title: "git fsck reports issues",
      detail: (e as Error).message,
    });
  }

  // 6. cloud-sync / network mount heuristic
  const suspicious = /(?:CloudDocs|Mobile Documents|Dropbox|Google Drive|OneDrive|pCloud|Box Sync|\/Volumes\/)/i;
  if (suspicious.test(root)) {
    checks.push({
      level: "warn",
      title: "Repository sits on a cloud-sync or network mount",
      detail: `${root}\nThese services can race with git index writes — try moving the repo to a plain local path.`,
    });
  } else {
    checks.push({ level: "ok", title: "Repository on a plain local path" });
  }

  // 7. Disk free
  try {
    const { execFile } = await import("child_process");
    const free = await new Promise<string>((resolve, reject) => {
      execFile("df", ["-h", root], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    const lines = free.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    checks.push({ level: "ok", title: "Disk free", detail: lastLine });
  } catch (e: unknown) {
    checks.push({ level: "warn", title: "Could not determine disk free", detail: (e as Error).message });
  }

  // Format report
  const icon = (l: Check["level"]) => (l === "ok" ? "✓" : l === "warn" ? "⚠" : "✗");
  return checks
    .map((c) => `${icon(c.level)} ${c.title}${c.detail ? "\n    " + c.detail.replace(/\n/g, "\n    ") : ""}`)
    .join("\n");
}

export async function showDiagnostic(root: string): Promise<void> {
  const report = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Running repository diagnostic…"),
    },
    () => runDiagnostic(root)
  );
  await vscode.window.showInformationMessage(
    vscode.l10n.t("Repository diagnostic"),
    { modal: true, detail: report }
  );
}

export async function runInTerminal(scope: string, command: string[], cwd: string): Promise<void> {
  const term = vscode.window.createTerminal({
    name: `Rebased: ${scope}`,
    cwd,
  });
  term.show();
  // Quote args defensively for the shell. JSON.stringify gives us shell-safe
  // double-quoting for normal POSIX shells; not perfect for csh/fish but the
  // user can always re-quote.
  const line = command.map((a) => (/[ \t"\\$`]/.test(a) ? JSON.stringify(a) : a)).join(" ");
  term.sendText(line, true);
}
