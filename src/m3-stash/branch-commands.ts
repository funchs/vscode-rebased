import * as vscode from "vscode";
import { cherryPick, runGit, startInteractiveRebase, commit as gitCommit } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { BranchItem } from "./branch-tree";
import { showGitError, isWorkingTreeDirtyError } from "../core/notify";

export function registerBranchCommands(ctx: vscode.ExtensionContext, repos: RepoManager): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.branch.checkout", async (arg: BranchItem | { name: string }) => {
      const root = repos.root;
      if (!root || !arg) return;
      const name = "branch" in arg ? arg.branch.name : arg.name;
      try {
        await runGit(["checkout", name.replace(/^origin\//, "")], { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        const msg = (e as Error).message;
        const actions: Array<{ label: string; run: () => Promise<void> }> = [];
        if (isWorkingTreeDirtyError(msg)) {
          actions.push({
            label: vscode.l10n.t("Stash and retry"),
            run: async () => {
              try {
                await runGit(["stash", "push", "-u", "-m", `rebased: auto before checkout ${name}`], { cwd: root });
                await runGit(["checkout", name.replace(/^origin\//, "")], { cwd: root });
                await runGit(["stash", "pop"], { cwd: root });
                repos.fire();
              } catch (e2: unknown) {
                await showGitError("Auto-stash checkout", e2);
              }
            },
          });
        }
        await showGitError(`Checkout ${name}`, e, actions);
      }
    }),
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
