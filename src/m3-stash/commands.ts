import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import type { StashItem } from "./tree-provider";
import { showGitError } from "../core/notify";

export function registerStashCommands(ctx: vscode.ExtensionContext, repos: RepoManager): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("rebased.stash.create", async () => {
      const root = repos.root;
      if (!root) return;
      const message = await vscode.window.showInputBox({ prompt: "Stash message (optional)" });
      if (message === undefined) return;
      const includeUntracked = await vscode.window.showQuickPick(
        [
          { label: "Tracked only", value: false },
          { label: "Include untracked", value: true },
        ],
        { placeHolder: "Stash scope" }
      );
      if (!includeUntracked) return;
      const args = ["stash", "push"];
      if (includeUntracked.value) args.push("-u");
      if (message) args.push("-m", message);
      try {
        await runGit(args, { cwd: root });
        repos.fire();
        vscode.window.showInformationMessage("Stashed.");
      } catch (e: unknown) {
        await showGitError("Stash", e);
      }
    }),
    vscode.commands.registerCommand("rebased.stash.apply", async (item: StashItem) => {
      const root = repos.root;
      if (!root || !item) return;
      try {
        await runGit(["stash", "apply", item.stash.ref], { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Apply stash", e);
      }
    }),
    vscode.commands.registerCommand("rebased.stash.pop", async (item: StashItem) => {
      const root = repos.root;
      if (!root || !item) return;
      try {
        await runGit(["stash", "pop", item.stash.ref], { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Pop stash", e);
      }
    }),
    vscode.commands.registerCommand("rebased.stash.drop", async (item: StashItem) => {
      const root = repos.root;
      if (!root || !item) return;
      const ok = await vscode.window.showWarningMessage(
        `Drop stash "${item.stash.subject}"?`,
        { modal: true },
        "Drop"
      );
      if (ok !== "Drop") return;
      try {
        await runGit(["stash", "drop", item.stash.ref], { cwd: root });
        repos.fire();
      } catch (e: unknown) {
        await showGitError("Drop stash", e);
      }
    }),
    vscode.commands.registerCommand("rebased.stash.refresh", () => repos.fire())
  );
}
