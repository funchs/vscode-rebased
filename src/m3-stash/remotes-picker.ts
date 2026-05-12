import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError, stripCodicons } from "../core/notify";

interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

async function listRemotes(root: string): Promise<RemoteInfo[]> {
  const raw = await runGit(["remote", "-v"], { cwd: root });
  const map = new Map<string, RemoteInfo>();
  for (const line of raw.split("\n").filter(Boolean)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    const [, name, url, kind] = m;
    const entry = map.get(name) ?? { name, fetchUrl: "", pushUrl: "" };
    if (kind === "fetch") entry.fetchUrl = url;
    else entry.pushUrl = url;
    map.set(name, entry);
  }
  return [...map.values()];
}

export async function showRemotesPicker(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const remotes = await listRemotes(root);

  const ADD: vscode.QuickPickItem = { label: "$(add) Add new remote…", alwaysShow: true };
  const FETCH_ALL: vscode.QuickPickItem = { label: "$(cloud-download) Fetch all (with prune)", alwaysShow: true };
  const items: vscode.QuickPickItem[] = [ADD, FETCH_ALL];
  if (remotes.length) {
    items.push({ label: "Remotes", kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
    for (const r of remotes) {
      const desc = r.fetchUrl === r.pushUrl ? r.fetchUrl : `${r.fetchUrl} (fetch), ${r.pushUrl} (push)`;
      items.push({
        label: `$(cloud) ${r.name}`,
        description: desc,
      });
    }
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `${remotes.length} remote(s)`,
    matchOnDescription: true,
  });
  if (!pick) return;
  if (pick === ADD) return await addRemote(repos, root);
  if (pick === FETCH_ALL) return await fetch(repos, root, undefined, true);
  const name = pick.label.replace(/^\$\([^)]+\)\s/, "");
  await remoteAction(repos, root, remotes.find((r) => r.name === name)!);
}

async function addRemote(repos: RepoManager, root: string): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: "Remote name", value: "origin" });
  if (!name) return;
  const url = await vscode.window.showInputBox({
    prompt: `Remote URL for ${name}`,
    placeHolder: "git@github.com:user/repo.git",
  });
  if (!url) return;
  try {
    await runGit(["remote", "add", name, url], { cwd: root });
    repos.fire();
    vscode.window.showInformationMessage(`Added remote ${name}.`);
  } catch (e: unknown) {
    await showGitError("Add remote", e);
  }
}

async function fetch(repos: RepoManager, root: string, name?: string, prune = true): Promise<void> {
  const args = ["fetch"];
  if (prune) args.push("--prune");
  if (name) args.push(name);
  else args.push("--all");
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Fetching ${name ?? "all remotes"}` },
    async () => {
      try {
        await runGit(args, { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Fetch", e);
      }
    }
  );
}

async function remoteAction(repos: RepoManager, root: string, r: RemoteInfo): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(cloud-download) Fetch", value: "fetch" },
      { label: "$(globe) Open URL in browser", value: "open" },
      { label: "$(pencil) Rename…", value: "rename" },
      { label: "$(link) Change URL…", value: "url" },
      { label: "$(trash) Remove", value: "remove" },
    ],
    { placeHolder: `Action on ${r.name}` }
  );
  if (!action) return;
  try {
    switch (action.value) {
      case "fetch":
        await fetch(repos, root, r.name);
        break;
      case "open": {
        const httpish = r.fetchUrl.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");
        await vscode.env.openExternal(vscode.Uri.parse(httpish));
        break;
      }
      case "rename": {
        const next = await vscode.window.showInputBox({ prompt: `Rename ${r.name} to…`, value: r.name });
        if (!next || next === r.name) return;
        await runGit(["remote", "rename", r.name, next], { cwd: root });
        break;
      }
      case "url": {
        const next = await vscode.window.showInputBox({ prompt: `New URL for ${r.name}`, value: r.fetchUrl });
        if (!next || next === r.fetchUrl) return;
        await runGit(["remote", "set-url", r.name, next], { cwd: root });
        break;
      }
      case "remove": {
        const ok = await vscode.window.showWarningMessage(
          `Remove remote ${r.name}? This does not delete the remote itself.`,
          { modal: true },
          "Remove"
        );
        if (ok !== "Remove") return;
        await runGit(["remote", "remove", r.name], { cwd: root });
        break;
      }
    }
    repos.fire();
  } catch (e: unknown) {
    await showGitError(`${stripCodicons(action.label)} remote ${r.name}`, e);
  }
}
