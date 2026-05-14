import * as vscode from "vscode";
import { cherryPick, runGit, startInteractiveRebase, commit as gitCommit } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { BranchItem } from "./branch-tree";
import { performBranchAction, type BranchActionKind } from "./branches-picker";
import { showGitError, isWorkingTreeDirtyError } from "../core/notify";

type BranchArg = BranchItem | { name: string; remote?: boolean; current?: boolean } | undefined;

function resolve(arg: BranchArg): { name: string; remote: boolean; current: boolean } | undefined {
  if (!arg) return undefined;
  if ("branch" in arg) {
    return { name: arg.branch.name, remote: !!arg.branch.remote, current: !!arg.branch.current };
  }
  return { name: arg.name, remote: !!arg.remote, current: !!arg.current };
}

function delegate(action: BranchActionKind, repos: RepoManager) {
  return async (arg: BranchArg) => {
    const root = repos.root;
    if (!root) return;
    const info = resolve(arg);
    if (!info) {
      const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Branch name") });
      if (!name) return;
      await performBranchAction(repos, root, action, name, { remote: false, current: false });
      return;
    }
    await performBranchAction(repos, root, action, info.name, { remote: info.remote, current: info.current });
  };
}

export function registerBranchCommands(ctx: vscode.ExtensionContext, repos: RepoManager): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.branch.checkout", async (arg: BranchArg) => {
      const root = repos.root;
      if (!root || !arg) return;
      const info = resolve(arg);
      if (!info) return;
      // Local: checkout by name. Remote: strip "origin/" so git creates/uses
      // a local branch tracking it (matches existing behavior).
      const target = info.remote ? info.name.replace(/^[^/]+\//, "") : info.name;
      try {
        await runGit(["checkout", target], { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        const msg = (e as Error).message;
        const actions: Array<{ label: string; run: () => Promise<void> }> = [];
        if (isWorkingTreeDirtyError(msg)) {
          actions.push({
            label: vscode.l10n.t("Stash and retry"),
            run: async () => {
              try {
                await runGit(["stash", "push", "-u", "-m", `rebased: auto before checkout ${target}`], { cwd: root });
                await runGit(["checkout", target], { cwd: root });
                await runGit(["stash", "pop"], { cwd: root });
                repos.fire();
              } catch (e2: unknown) {
                await showGitError("Auto-stash checkout", e2);
              }
            },
          });
        }
        await showGitError(`Checkout ${target}`, e, actions);
      }
    }),
    vscode.commands.registerCommand("rebased.branch.merge", delegate("merge", repos)),
    vscode.commands.registerCommand("rebased.branch.rebaseOnto", delegate("rebaseOnto", repos)),
    vscode.commands.registerCommand("rebased.branch.rename", delegate("rename", repos)),
    vscode.commands.registerCommand("rebased.branch.delete", delegate("delete", repos)),
    vscode.commands.registerCommand("rebased.branch.newFromHere", delegate("newFromHere", repos)),
    vscode.commands.registerCommand("rebased.branch.pushSetUpstream", delegate("pushSetUpstream", repos)),
    vscode.commands.registerCommand("rebased.branch.pushForce", delegate("pushForceWithLease", repos)),
    vscode.commands.registerCommand("rebased.branch.fetch", delegate("fetch", repos)),
    vscode.commands.registerCommand("rebased.branch.deleteRemote", delegate("deleteRemote", repos)),
    vscode.commands.registerCommand("rebased.branch.resetTo", delegate("resetCurrentToHere", repos)),
    vscode.commands.registerCommand("rebased.branch.copyName", delegate("copyName", repos)),
    vscode.commands.registerCommand("rebased.branch.create", async () => {
      const root = repos.root;
      if (!root) return;
      const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("New branch name") });
      if (!name) return;
      try {
        await runGit(["checkout", "-b", name], { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Branch creation", e);
      }
    }),
    vscode.commands.registerCommand("rebased.cherryPick", async (hash: string | undefined) => {
      const root = repos.root;
      if (!root) return;
      const h = hash ?? (await vscode.window.showInputBox({ prompt: vscode.l10n.t("Commit hash to cherry-pick") }));
      if (!h) return;
      try {
        await cherryPick(root, h);
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Cherry-pick", e);
      }
    }),
    vscode.commands.registerCommand("rebased.rebase.interactive", async (baseRef: string | undefined) => {
      const root = repos.root;
      if (!root) return;
      const ref = baseRef ?? (await vscode.window.showInputBox({ prompt: vscode.l10n.t("Rebase onto (ref or hash)"), value: "HEAD~5" }));
      if (!ref) return;
      try {
        await startInteractiveRebase(root, `${ref}^`);
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Rebase", e);
      }
    }),
    vscode.commands.registerCommand("rebased.commit.amend", async () => {
      const root = repos.root;
      if (!root) return;
      const lastMsg = (await runGit(["log", "-1", "--pretty=%B"], { cwd: root })).trim();
      const msg = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Amend commit message"), value: lastMsg });
      if (msg === undefined) return;
      try {
        await gitCommit(root, msg, true);
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Amend", e);
      }
    })
  );
}
