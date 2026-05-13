import * as vscode from "vscode";
import {
  runGit,
  getStatus,
  getOperationState,
  markStashPopInProgress,
} from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError, isWorkingTreeDirtyError } from "../core/notify";
import { parseUntrackedCollisions, isStashConflictMessage } from "../core/notify-pure";

// JetBrains "Update Project" (Ctrl+T) — one command that:
//   1. Refuses to start if a previous op (rebase/merge/cherry-pick/stash-pop)
//      is unfinished, routing user to the conflict panel.
//   2. Stashes uncommitted changes (incl. untracked) so the working tree is clean.
//   3. Fetches all remotes with prune.
//   4. Pulls with rebase (default) or merge, per user choice.
//      - On conflict here → drop user into the conflict panel; the stash stays
//        safe and is popped only after they finish the rebase/merge.
//   5. Pops the stash. If pop reports conflicts, write a sentinel so the
//      conflict panel knows it's a stash-pop session, and surface the merge editor.

type Strategy = "rebase" | "merge";

interface Options {
  strategy: Strategy;
  silent?: boolean;
}

async function chooseStrategy(): Promise<Strategy | undefined> {
  const cfg = vscode.workspace.getConfiguration("rebased");
  const remembered = cfg.get<Strategy | "ask">("updateProject.strategy", "ask");
  if (remembered === "rebase" || remembered === "merge") return remembered;
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(git-pull-request-go-to-changes) Rebase local commits onto upstream", value: "rebase" },
      { label: "$(git-merge) Merge upstream into local", value: "merge" },
    ],
    { placeHolder: "Update strategy (configurable as rebased.updateProject.strategy)" }
  );
  if (!pick) return undefined;
  return pick.value as Strategy;
}

async function isClean(root: string): Promise<boolean> {
  const status = await getStatus(root);
  return status.length === 0;
}

async function popStashSafely(root: string, repos: RepoManager): Promise<void> {
  const stashRef = "stash@{0}";
  try {
    await runGit(["stash", "pop"], { cwd: root });
    repos.fire();
  } catch (e: unknown) {
    const msg = (e as Error).message;

    // Case A: tracked-file conflict (3-way mergeable) → route to conflict panel.
    if (isStashConflictMessage(msg)) {
      await markStashPopInProgress(root, stashRef);
      repos.fire();
      await routeToConflictPanel(
        `Update Project — stash pop produced conflicts. Resolve in the 3-way merge editor, then finalize.`
      );
      return;
    }

    // Case B: untracked-file collision (e.g. upstream just introduced .dockerignore
    // and the stash also carries it). git refuses the entire pop and the stash
    // entry stays intact.
    const collisions = parseUntrackedCollisions(msg);
    if (collisions.length > 0) {
      await resolveUntrackedCollision(root, repos, collisions);
      return;
    }

    // Anything else: stash is intact, surface the error verbatim.
    await showGitError("Stash pop after update", e);
  }
}

// 'stash@{0}^3' is the synthetic commit `git stash -u` creates to hold the
// untracked files. We extract files from there to compare or to overwrite.
const UNTRACKED_PARENT = "stash@{0}^3";

async function resolveUntrackedCollision(
  root: string,
  repos: RepoManager,
  collisions: string[]
): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const preview = collisions.slice(0, 3).join(", ") + (collisions.length > 3 ? "…" : "");
  const choice = await vscode.window.showWarningMessage(
    `Stash pop blocked: ${collisions.length} untracked file${collisions.length === 1 ? "" : "s"} from the stash already exist in the working tree (added by upstream): ${preview}`,
    { modal: true, detail: collisions.join("\n") },
    "Keep upstream (drop stashed copies)",
    "Restore from stash (overwrite upstream)",
    "Compare per file (keep stash)",
    "Do nothing (keep stash for later)"
  );

  try {
    if (choice === "Keep upstream (drop stashed copies)") {
      await runGit(["stash", "drop", "stash@{0}"], { cwd: root });
      vscode.window.showInformationMessage(
        `Dropped stash; upstream copies of ${collisions.length} file(s) kept.`
      );
    } else if (choice === "Restore from stash (overwrite upstream)") {
      // Confirm once more — this is destructive to upstream's just-pulled content.
      const ok = await vscode.window.showWarningMessage(
        `Overwrite ${collisions.length} upstream file(s) with the stashed versions? Upstream content for these paths will be lost from the working tree.`,
        { modal: true },
        "Overwrite"
      );
      if (ok !== "Overwrite") return;
      // Delete the upstream-introduced copies, then retry the pop.
      for (const rel of collisions) {
        await fs.rm(path.join(root, rel), { force: true });
      }
      try {
        await runGit(["stash", "pop"], { cwd: root });
        vscode.window.showInformationMessage("Restored stashed copies.");
      } catch (e: unknown) {
        await showGitError("Retry stash pop", e);
      }
    } else if (choice === "Compare per file (keep stash)") {
      // Open a side-by-side diff per collision: stash version (rebased-stash: scheme)
      // vs the upstream copy currently in the working tree. The stash stays in
      // the list so the user can finalize later with their own preferred tool.
      for (const rel of collisions) {
        const fileUri = vscode.Uri.joinPath(vscode.Uri.file(root), rel);
        // Use the built-in git: scheme to ask the git extension to materialize
        // stash@{0}^3:<path>.
        const stashUri = fileUri.with({
          scheme: "git",
          query: JSON.stringify({ path: fileUri.fsPath, ref: UNTRACKED_PARENT }),
        });
        await vscode.commands.executeCommand(
          "vscode.diff",
          stashUri,
          fileUri,
          `${rel} · stash → upstream`
        );
      }
      vscode.window.showInformationMessage(
        `Stash kept. After deciding, drop it manually from the Stashes view.`
      );
    }
    // "Do nothing" — bail out, stash stays intact.
  } catch (e: unknown) {
    await showGitError("Resolve untracked collision", e);
  } finally {
    repos.fire();
  }
}

async function routeToConflictPanel(message: string): Promise<void> {
  const pick = await vscode.window.showWarningMessage(message, "Open conflict panel", "Later");
  if (pick === "Open conflict panel") {
    await vscode.commands.executeCommand("rebased.conflict.show");
  }
}

export async function updateProject(repos: RepoManager, opts?: Partial<Options>): Promise<void> {
  const root = repos.root;
  if (!root) return;

  // Refuse to start while another op is mid-flight — user needs to finish or
  // abort that one first.
  const opState = await getOperationState(root);
  if (opState.kind) {
    await routeToConflictPanel(
      `A ${opState.kind} is already in progress. Resolve it before running Update Project.`
    );
    return;
  }

  // Detached HEAD has no upstream and no branch to rebase onto.
  let branch: string;
  try {
    branch = (await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: root })).trim();
  } catch {
    vscode.window.showWarningMessage("Update Project requires a branch (detached HEAD).");
    return;
  }
  try {
    await runGit(["rev-parse", "--abbrev-ref", `${branch}@{u}`], { cwd: root });
  } catch {
    const pick = await vscode.window.showWarningMessage(
      `${branch} has no upstream. Set one with 'push --set-upstream' first.`,
      "Push and set upstream",
      "Cancel"
    );
    if (pick === "Push and set upstream") {
      await vscode.commands.executeCommand("rebased.push");
    }
    return;
  }

  const strategy = opts?.strategy ?? (await chooseStrategy());
  if (!strategy) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Update Project: ${branch}`,
      cancellable: false,
    },
    async (progress) => {
      const dirty = !(await isClean(root));
      let didStash = false;

      if (dirty) {
        progress.report({ message: "stashing uncommitted changes…", increment: 10 });
        try {
          await runGit(
            ["stash", "push", "-u", "-m", `rebased: auto before update ${new Date().toISOString()}`],
            { cwd: root }
          );
          didStash = true;
        } catch (e: unknown) {
          await showGitError("Auto-stash", e);
          return;
        }
      }

      progress.report({ message: "fetching all remotes…", increment: 20 });
      try {
        await runGit(["fetch", "--all", "--prune"], { cwd: root });
      } catch (e: unknown) {
        // Fetch failure: try to pop and bail.
        if (didStash) await runGit(["stash", "pop"], { cwd: root }).catch(() => undefined);
        await showGitError("Fetch", e);
        return;
      }

      progress.report({
        message: strategy === "rebase" ? "pull --rebase…" : "pull --no-rebase…",
        increment: 30,
      });
      try {
        await runGit(["pull", strategy === "rebase" ? "--rebase" : "--no-rebase"], { cwd: root });
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (/CONFLICT|merge conflict|could not apply/i.test(msg)) {
          // Don't auto-pop now — the stash stays safe; user finishes the
          // rebase/merge first, after which they (or we) pop manually. The
          // conflict watcher status bar is already lit.
          repos.fire();
          await routeToConflictPanel(
            `${strategy} hit conflicts. Resolve them, then run Update Project again — your stash is still safe.`
          );
          return;
        }
        if (didStash && isWorkingTreeDirtyError(msg)) {
          // Theoretically unreachable since we just stashed, but defensive.
          await runGit(["stash", "pop"], { cwd: root }).catch(() => undefined);
        }
        await showGitError("Pull", e);
        return;
      }

      if (didStash) {
        progress.report({ message: "restoring stashed changes…", increment: 30 });
        await popStashSafely(root, repos);
      }

      repos.fire();
      progress.report({ message: "done", increment: 10 });
    }
  );

  // Final state check: if we ended in a conflict state, the watcher will already
  // be glowing. Don't toast "success" in that case.
  const finalState = await getOperationState(root);
  if (!finalState.kind) {
    vscode.window.setStatusBarMessage(`$(check) Update Project: ${branch} updated.`, 4000);
  }
}
