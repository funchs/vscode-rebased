import * as vscode from "vscode";
import {
  runGit,
  getStatus,
  getOperationState,
  markStashPopInProgress,
} from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError, isWorkingTreeDirtyError, maybeRecoverFromIndexLock } from "../core/notify";
import { parseUntrackedCollisions, isStashConflictMessage, isIndexLockError } from "../core/notify-pure";

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
    { placeHolder: vscode.l10n.t("Update strategy (configurable as rebased.updateProject.strategy)") }
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
        vscode.l10n.t("Update Project — stash pop produced conflicts. Resolve in the 3-way merge editor, then finalize.")
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
    vscode.l10n.t("Keep upstream (drop stashed copies)"),
    vscode.l10n.t("Restore from stash (overwrite upstream)"),
    vscode.l10n.t("Compare per file (keep stash)"),
    vscode.l10n.t("Do nothing (keep stash for later)")
  );

  try {
    if (choice === vscode.l10n.t("Keep upstream (drop stashed copies)")) {
      await runGit(["stash", "drop", "stash@{0}"], { cwd: root });
      vscode.window.showInformationMessage(
        `Dropped stash; upstream copies of ${collisions.length} file(s) kept.`
      );
    } else if (choice === vscode.l10n.t("Restore from stash (overwrite upstream)")) {
      // Confirm once more — this is destructive to upstream's just-pulled content.
      const ok = await vscode.window.showWarningMessage(
        `Overwrite ${collisions.length} upstream file(s) with the stashed versions? Upstream content for these paths will be lost from the working tree.`,
        { modal: true },
        vscode.l10n.t("Overwrite")
      );
      if (ok !== vscode.l10n.t("Overwrite")) return;
      // Delete the upstream-introduced copies, then retry the pop.
      for (const rel of collisions) {
        await fs.rm(path.join(root, rel), { force: true });
      }
      try {
        await runGit(["stash", "pop"], { cwd: root });
        vscode.window.showInformationMessage(vscode.l10n.t("Restored stashed copies."));
      } catch (e: unknown) {
        await showGitError("Retry stash pop", e);
      }
    } else if (choice === vscode.l10n.t("Compare per file (keep stash)")) {
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
  const pick = await vscode.window.showWarningMessage(message, vscode.l10n.t("Open conflict panel"), vscode.l10n.t("Later"));
  if (pick === vscode.l10n.t("Open conflict panel")) {
    await vscode.commands.executeCommand("rebased.conflict.show");
  }
}

// Try a git operation with graceful index-lock recovery:
//   1. First attempt.
//   2. On any "could not write index"-class error, silently wait 600ms and retry —
//      handles transient races with VS Code's built-in git extension which also
//      pokes the index periodically.
//   3. If the retry still fails, show the recovery dialog (which prompts to
//      remove the lock file if one is present, or to retry).
//   4. After a user-approved retry, surface enriched errors verbatim.
async function tryWithLockRecovery(
  root: string,
  scope: string,
  op: () => Promise<unknown>
): Promise<boolean> {
  try {
    await op();
    return true;
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (!isIndexLockError(msg)) {
      await showGitError(scope, e);
      return false;
    }
    // Silent retry — typical transient race resolves in <100ms.
    await new Promise((r) => setTimeout(r, 600));
    try {
      await op();
      return true;
    } catch (e2: unknown) {
      const msg2 = (e2 as Error).message;
      const recovery = await maybeRecoverFromIndexLock(root, msg2);
      if (recovery === "retry") {
        try {
          await op();
          return true;
        } catch (e3: unknown) {
          await showGitError(`${scope} (after lock cleared)`, e3);
          return false;
        }
      }
      if (recovery === "abort") return false;
      // No lock file present and user couldn't recover via dialog.
      // Surface a richer message hinting at the likely cause.
      await showGitError(
        `${scope} — index could not be written`,
        new Error(
          `${msg2}\n\nTwo silent retries failed. Likely causes:\n` +
          `  • Another git process is holding the index (terminal, IDE, or CI)\n` +
          `  • .git/index permissions or disk space\n` +
          `  • Antivirus / backup software locking the file\n\n` +
          `Inspect .git/ and try again from a clean state.`
        )
      );
      return false;
    }
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
      vscode.l10n.t("A {0} is already in progress. Resolve it before running Update Project.", opState.kind!)
    );
    return;
  }

  // Detached HEAD has no upstream and no branch to rebase onto.
  let branch: string;
  try {
    branch = (await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: root })).trim();
  } catch {
    vscode.window.showWarningMessage(vscode.l10n.t("Update Project requires a branch (detached HEAD)."));
    return;
  }
  try {
    await runGit(["rev-parse", "--abbrev-ref", `${branch}@{u}`], { cwd: root });
  } catch {
    const pick = await vscode.window.showWarningMessage(
      `${branch} has no upstream. Set one with 'push --set-upstream' first.`,
      vscode.l10n.t("Push and set upstream"),
      vscode.l10n.t("Cancel")
    );
    if (pick === vscode.l10n.t("Push and set upstream")) {
      await vscode.commands.executeCommand("rebased.push");
    }
    return;
  }

  const strategy = opts?.strategy ?? (await chooseStrategy());
  if (!strategy) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Update Project: {0}", branch),
      cancellable: false,
    },
    async (progress) => {
      const dirty = !(await isClean(root));
      let didStash = false;
      const stashMsg = `rebased: auto before update ${new Date().toISOString()}`;

      if (dirty) {
        progress.report({ message: vscode.l10n.t("stashing uncommitted changes…"), increment: 10 });
        const stashOk = await tryWithLockRecovery(root, vscode.l10n.t("Auto-stash"), () =>
          runGit(["stash", "push", "-u", "-m", stashMsg], { cwd: root })
        );
        if (!stashOk) return;
        didStash = true;
      }

      progress.report({ message: vscode.l10n.t("fetching all remotes…"), increment: 20 });
      const fetchOk = await tryWithLockRecovery(root, vscode.l10n.t("Fetch"), () =>
        runGit(["fetch", "--all", "--prune"], { cwd: root })
      );
      if (!fetchOk) {
        if (didStash) await runGit(["stash", "pop"], { cwd: root }).catch(() => undefined);
        return;
      }

      progress.report({
        message: strategy === "rebase" ? vscode.l10n.t("pull --rebase…") : vscode.l10n.t("pull --no-rebase…"),
        increment: 30,
      });
      try {
        await runGit(["pull", strategy === "rebase" ? "--rebase" : "--no-rebase"], { cwd: root });
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (/CONFLICT|merge conflict|could not apply/i.test(msg)) {
          repos.fire();
          await routeToConflictPanel(
            vscode.l10n.t("{0} hit conflicts. Resolve them, then run Update Project again — your stash is still safe.", strategy)
          );
          return;
        }
        const recovery = await maybeRecoverFromIndexLock(root, msg);
        if (recovery === "retry") {
          try {
            await runGit(["pull", strategy === "rebase" ? "--rebase" : "--no-rebase"], { cwd: root });
          } catch (e2: unknown) {
            await showGitError("Pull (after lock cleared)", e2);
            return;
          }
        } else if (recovery === "not-applicable") {
          if (didStash && isWorkingTreeDirtyError(msg)) {
            await runGit(["stash", "pop"], { cwd: root }).catch(() => undefined);
          }
          await showGitError(vscode.l10n.t("Pull"), e);
          return;
        } else {
          return; // user aborted
        }
      }

      if (didStash) {
        progress.report({ message: vscode.l10n.t("restoring stashed changes…"), increment: 30 });
        await popStashSafely(root, repos);
      }

      repos.fire();
      progress.report({ message: vscode.l10n.t("done"), increment: 10 });
    }
  );

  // Final state check: if we ended in a conflict state, the watcher will already
  // be glowing. Don't toast "success" in that case.
  const finalState = await getOperationState(root);
  if (!finalState.kind) {
    vscode.window.setStatusBarMessage(`$(check) Update Project: ${branch} updated.`, 4000);
  }
}
