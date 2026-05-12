import * as vscode from "vscode";
import { cherryPick, runGit, startInteractiveRebase, commit as gitCommit } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { BranchItem } from "./branch-tree";

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
        vscode.window.showErrorMessage(`Checkout failed: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand("rebased.branch.create", async () => {
      const root = repos.root;
      if (!root) return;
      const name = await vscode.window.showInputBox({ prompt: "New branch name" });
      if (!name) return;
      try {
        await runGit(["checkout", "-b", name], { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Branch creation failed: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand("rebased.cherryPick", async (hash: string | undefined) => {
      const root = repos.root;
      if (!root) return;
      const h = hash ?? (await vscode.window.showInputBox({ prompt: "Commit hash to cherry-pick" }));
      if (!h) return;
      try {
        await cherryPick(root, h);
        repos.fire();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Cherry-pick failed: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand("rebased.rebase.interactive", async (baseRef: string | undefined) => {
      const root = repos.root;
      if (!root) return;
      const ref = baseRef ?? (await vscode.window.showInputBox({ prompt: "Rebase onto (ref or hash)", value: "HEAD~5" }));
      if (!ref) return;
      try {
        await startInteractiveRebase(root, `${ref}^`);
        repos.fire();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Rebase failed: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand("rebased.commit.amend", async () => {
      const root = repos.root;
      if (!root) return;
      const lastMsg = (await runGit(["log", "-1", "--pretty=%B"], { cwd: root })).trim();
      const msg = await vscode.window.showInputBox({ prompt: "Amend commit message", value: lastMsg });
      if (msg === undefined) return;
      try {
        await gitCommit(root, msg, true);
        repos.fire();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Amend failed: ${(e as Error).message}`);
      }
    })
  );
}
