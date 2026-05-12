import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";

const RECORD = "\x1e";
const NUL = "\x00";

interface Snapshot {
  branch: string;
  upstream?: string;
  ahead: Array<{ shortHash: string; subject: string; author: string }>;
  behind: Array<{ shortHash: string; subject: string; author: string }>;
}

async function snapshot(root: string): Promise<Snapshot | undefined> {
  let branch: string;
  try {
    branch = (await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: root })).trim();
  } catch {
    return undefined; // detached HEAD
  }

  let upstream: string | undefined;
  try {
    upstream = (await runGit(["rev-parse", "--abbrev-ref", `${branch}@{u}`], { cwd: root })).trim();
  } catch {
    return { branch, upstream: undefined, ahead: [], behind: [] };
  }

  // Fetch latest before computing ahead/behind so the preview is honest about
  // what's actually on the remote *right now*, not what was there last fetch.
  try {
    await runGit(["fetch", "--quiet"], { cwd: root });
  } catch {
    // Network errors are recoverable; we just use the stale snapshot.
  }

  const fmt = ["%h", "%an", "%s"].join(RECORD);
  const aheadRaw = await runGit(
    ["log", "-z", `--pretty=format:${fmt}`, "--max-count=200", `${upstream}..${branch}`],
    { cwd: root }
  );
  const behindRaw = await runGit(
    ["log", "-z", `--pretty=format:${fmt}`, "--max-count=200", `${branch}..${upstream}`],
    { cwd: root }
  );
  const ahead = parseList(aheadRaw);
  const behind = parseList(behindRaw);
  return { branch, upstream, ahead, behind };
}

function parseList(raw: string): Array<{ shortHash: string; subject: string; author: string }> {
  return raw
    .split(NUL)
    .filter(Boolean)
    .map((line) => {
      const [shortHash, author, subject] = line.split(RECORD);
      return { shortHash, author, subject };
    });
}

export async function showPushDialog(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const snap = await snapshot(root);
  if (!snap) {
    vscode.window.showWarningMessage("Cannot push from detached HEAD.");
    return;
  }
  const noUpstream = !snap.upstream;

  if (!snap.ahead.length && !noUpstream) {
    vscode.window.showInformationMessage(`Nothing to push. ${snap.branch} is up to date with ${snap.upstream}.`);
    return;
  }

  const items: vscode.QuickPickItem[] = [];
  if (noUpstream) {
    items.push({
      label: "$(cloud-upload) Push and set upstream to origin",
      description: `${snap.branch} → origin/${snap.branch}`,
      detail: "First push of this branch — no commits to preview yet (whole branch is new).",
    });
  } else {
    items.push({ label: `Will push ${snap.ahead.length} commit(s) to ${snap.upstream}`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
    for (const c of snap.ahead) {
      items.push({
        label: `$(arrow-up) ${c.subject}`,
        description: `${c.shortHash} · ${c.author}`,
      });
    }
    items.push({ label: "Actions", kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
    items.push({ label: "$(cloud-upload) Push", alwaysShow: true });
    items.push({
      label: "$(warning) Force push with lease",
      description: "Safer than --force; refuses if upstream moved since fetch",
      alwaysShow: true,
    });
  }

  const pick = await vscode.window.showQuickPick(items, { placeHolder: `Push ${snap.branch}` });
  if (!pick) return;

  try {
    if (noUpstream) {
      await runGit(["push", "--set-upstream", "origin", snap.branch], { cwd: root });
    } else if (pick.label.startsWith("$(cloud-upload) Push")) {
      await runGit(["push"], { cwd: root });
    } else if (pick.label.startsWith("$(warning) Force push")) {
      const ok = await vscode.window.showWarningMessage(
        `Force-push-with-lease ${snap.branch} to ${snap.upstream}?`,
        { modal: true },
        "Force push"
      );
      if (ok !== "Force push") return;
      await runGit(["push", "--force-with-lease"], { cwd: root });
    } else {
      return; // user picked a commit row, no action
    }
    repos.fire();
    vscode.window.setStatusBarMessage("$(check) Pushed.", 3000);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Push failed: ${(e as Error).message}`);
  }
}

export async function showPullDialog(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const snap = await snapshot(root);
  if (!snap) {
    vscode.window.showWarningMessage("Cannot pull on detached HEAD.");
    return;
  }
  if (!snap.upstream) {
    vscode.window.showInformationMessage(`${snap.branch} has no upstream — set one with 'push --set-upstream' first.`);
    return;
  }
  if (!snap.behind.length) {
    vscode.window.showInformationMessage(`${snap.branch} is up to date with ${snap.upstream}.`);
    return;
  }

  const items: vscode.QuickPickItem[] = [];
  items.push({ label: `Will integrate ${snap.behind.length} commit(s) from ${snap.upstream}`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
  for (const c of snap.behind) {
    items.push({
      label: `$(arrow-down) ${c.subject}`,
      description: `${c.shortHash} · ${c.author}`,
    });
  }
  if (snap.ahead.length) {
    items.push({
      label: `$(info) ${snap.ahead.length} local commit(s) ahead — rebase will replay them on top`,
      kind: vscode.QuickPickItemKind.Separator,
    } as vscode.QuickPickItem);
  }
  items.push({ label: "Actions", kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
  items.push({ label: "$(git-merge) Pull (merge)", alwaysShow: true });
  items.push({ label: "$(git-pull-request-go-to-changes) Pull --rebase", description: "Replay your commits on top of remote", alwaysShow: true });
  items.push({ label: "$(cloud-download) Fetch only", description: "Update refs without changing working tree", alwaysShow: true });

  const pick = await vscode.window.showQuickPick(items, { placeHolder: `Pull ${snap.branch} ← ${snap.upstream}` });
  if (!pick) return;

  try {
    if (pick.label.startsWith("$(git-merge)")) {
      await runGit(["pull", "--no-rebase"], { cwd: root });
    } else if (pick.label.startsWith("$(git-pull-request-go-to-changes)")) {
      await runGit(["pull", "--rebase"], { cwd: root });
    } else if (pick.label.startsWith("$(cloud-download)")) {
      await runGit(["fetch", "--all", "--prune"], { cwd: root });
    } else {
      return;
    }
    repos.fire();
    vscode.window.setStatusBarMessage("$(check) Pulled.", 3000);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Pull failed: ${(e as Error).message}`);
  }
}
