import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";

interface FileCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: number;
}

const RECORD = "\x1e";
const NUL = "\x00";

export async function showFileHistory(repos: RepoManager, uri?: vscode.Uri): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showInformationMessage(vscode.l10n.t("Open a file or right-click one in the explorer."));
    return;
  }
  const rel = vscode.workspace.asRelativePath(target, false);

  const fmt = ["%H", "%an", "%at", "%s"].join(RECORD);
  // --follow tracks across renames so the picker doesn't dead-end at a rename.
  const raw = await runGit(
    ["log", "-z", "--follow", `--pretty=format:${fmt}`, "--max-count=500", "--", rel],
    { cwd: root }
  );
  const commits: FileCommit[] = raw
    .split(NUL)
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split(RECORD);
      return {
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        author,
        date: parseInt(date, 10) * 1000,
      };
    });

  if (!commits.length) {
    vscode.window.showInformationMessage(vscode.l10n.t("No history found for {0}.", rel));
    return;
  }

  const items = commits.map((c) => ({
    label: `$(git-commit) ${c.subject}`,
    description: `${c.shortHash} · ${c.author} · ${new Date(c.date).toLocaleDateString()}`,
    hash: c.hash,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t("{0} commit(s) touched {1}", String(commits.length), rel),
    matchOnDescription: true,
  });
  if (!pick) return;

  // Open a one-shot QuickPick to choose action.
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(eye) Open commit details", value: "details" },
      { label: "$(diff) Diff this file against working tree", value: "diffWorking" },
      { label: "$(diff) Diff against previous version", value: "diffPrev" },
      { label: "$(history) Open file at this revision", value: "openAt" },
    ],
    { placeHolder: `${pick.hash.slice(0, 7)} on ${rel}` }
  );
  if (!action) return;

  switch (action.value) {
    case "details":
      await vscode.commands.executeCommand("rebased.commit.show", pick.hash);
      break;
    case "diffWorking":
      await vscode.commands.executeCommand(
        "vscode.diff",
        gitResource(target, pick.hash),
        target,
        `${rel} · ${pick.hash.slice(0, 7)} → working`
      );
      break;
    case "diffPrev":
      await vscode.commands.executeCommand(
        "vscode.diff",
        gitResource(target, `${pick.hash}^`),
        gitResource(target, pick.hash),
        `${rel} · ${pick.hash.slice(0, 7)}^ → ${pick.hash.slice(0, 7)}`
      );
      break;
    case "openAt":
      await vscode.commands.executeCommand("vscode.open", gitResource(target, pick.hash));
      break;
  }
}

function gitResource(file: vscode.Uri, ref: string): vscode.Uri {
  return file.with({
    scheme: "git",
    path: file.path,
    query: JSON.stringify({ path: file.fsPath, ref }),
  });
}
