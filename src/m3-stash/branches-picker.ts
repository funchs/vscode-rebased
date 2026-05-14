import * as vscode from "vscode";
import { getBranches, runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError, stripCodicons, isWorkingTreeDirtyError } from "../core/notify";

export type BranchActionKind =
  | "checkout"
  | "checkoutLocal"
  | "merge"
  | "rebaseOnto"
  | "rename"
  | "delete"
  | "newFromHere"
  | "compare"
  | "pushSetUpstream"
  | "pushForceWithLease"
  | "fetch"
  | "deleteRemote"
  | "resetCurrentToHere"
  | "copyName";

interface BranchAction {
  label: string;
  description?: string;
  action: BranchActionKind;
}

export async function showBranchesPicker(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const branches = await getBranches(root);
  const items: Array<vscode.QuickPickItem & { name: string; remote: boolean; current: boolean }> = branches.map((b) => {
    const bits: string[] = [];
    if (b.upstream) bits.push(`→ ${b.upstream}`);
    if (b.ahead) bits.push(`↑${b.ahead}`);
    if (b.behind) bits.push(`↓${b.behind}`);
    return {
      label: `${b.current ? "$(check) " : b.remote ? "$(cloud) " : "$(git-branch) "}${b.name}`,
      description: bits.join(" "),
      name: b.name,
      remote: b.remote,
      current: b.current,
    };
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t("Search branches…  (Enter to pick, then choose an action)"),
    matchOnDescription: true,
  });
  if (!pick) return;
  await runBranchAction(repos, root, pick.name, pick.remote, pick.current);
}

async function runBranchAction(
  repos: RepoManager,
  root: string,
  name: string,
  remote: boolean,
  current: boolean
): Promise<void> {
  const actions: BranchAction[] = [];
  if (!current) {
    if (remote) {
      actions.push({ label: "$(git-pull-request) " + vscode.l10n.t("Checkout (create local tracking)"), action: "checkoutLocal" });
      actions.push({ label: "$(eye) " + vscode.l10n.t("Checkout detached"), action: "checkout" });
    } else {
      actions.push({ label: "$(check) " + vscode.l10n.t("Checkout"), action: "checkout" });
    }
    actions.push({ label: "$(git-merge) " + vscode.l10n.t("Merge into current"), action: "merge" });
    actions.push({ label: "$(git-pull-request-go-to-changes) " + vscode.l10n.t("Rebase current onto this"), action: "rebaseOnto" });
  }
  actions.push({ label: "$(diff) " + vscode.l10n.t("Compare with current"), action: "compare" });
  actions.push({ label: "$(add) " + vscode.l10n.t("New branch from here…"), action: "newFromHere" });
  if (!remote && !current) {
    actions.push({ label: "$(pencil) " + vscode.l10n.t("Rename…"), action: "rename" });
    actions.push({ label: "$(cloud-upload) " + vscode.l10n.t("Push (set upstream)"), action: "pushSetUpstream" });
    actions.push({ label: "$(trash) " + vscode.l10n.t("Delete"), action: "delete" });
  }

  const choice = await vscode.window.showQuickPick(
    actions.map((a) => ({ label: a.label, description: a.description, action: a.action })),
    { placeHolder: vscode.l10n.t("Action on {0}", name) }
  );
  if (!choice) return;
  await performBranchAction(repos, root, choice.action, name, { remote, current, label: choice.label });
}

// Execute a single branch action. Shared by the QuickPick (branches-picker)
// and the tree-view context menu (branch-commands).
export async function performBranchAction(
  repos: RepoManager,
  root: string,
  action: BranchActionKind,
  name: string,
  opts: { remote: boolean; current: boolean; label?: string }
): Promise<void> {
  const { remote, current, label } = opts;
  const localName = remote ? name.replace(/^[^/]+\//, "") : name;

  try {
    switch (action) {
      case "checkout":
        await runGit(["checkout", name], { cwd: root });
        break;
      case "checkoutLocal":
        await runGit(["checkout", "-b", localName, "--track", name], { cwd: root });
        break;
      case "merge":
        if (current) {
          vscode.window.showInformationMessage(vscode.l10n.t("Cannot merge a branch into itself."));
          return;
        }
        await runGit(["merge", "--no-ff", name], { cwd: root });
        break;
      case "rebaseOnto":
        if (current) {
          vscode.window.showInformationMessage(vscode.l10n.t("Cannot rebase a branch onto itself."));
          return;
        }
        await runGit(["rebase", name], { cwd: root });
        break;
      case "rename": {
        const next = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Rename {0} to…", name), value: name });
        if (!next || next === name) return;
        await runGit(["branch", "-m", name, next], { cwd: root });
        break;
      }
      case "delete": {
        if (current) {
          vscode.window.showInformationMessage(vscode.l10n.t("Cannot delete the current branch."));
          return;
        }
        const forceLabel = vscode.l10n.t("Force delete");
        const force = await vscode.window.showWarningMessage(
          vscode.l10n.t("Delete branch {0}?", name),
          { modal: true },
          vscode.l10n.t("Delete (safe)"),
          forceLabel
        );
        if (!force) return;
        await runGit(
          ["branch", force === forceLabel ? "-D" : "-d", name],
          { cwd: root }
        );
        break;
      }
      case "newFromHere": {
        const next = await vscode.window.showInputBox({ prompt: vscode.l10n.t("New branch from {0}", name) });
        if (!next) return;
        await runGit(["checkout", "-b", next, name], { cwd: root });
        break;
      }
      case "compare":
        await vscode.commands.executeCommand("rebased.branch.compare", name);
        return;
      case "pushSetUpstream":
        await runGit(["push", "--set-upstream", "origin", name], { cwd: root });
        break;
      case "pushForceWithLease":
        if (remote) {
          vscode.window.showInformationMessage(vscode.l10n.t("Cannot force-push a remote-tracking branch."));
          return;
        }
        {
          const ok = await vscode.window.showWarningMessage(
            vscode.l10n.t("Force-push {0} (with-lease)? This rewrites the remote branch history.", name),
            { modal: true },
            vscode.l10n.t("Force push")
          );
          if (!ok) return;
          // --force-with-lease refuses if the remote moved since the last fetch,
          // so it's the safer cousin of --force. No explicit refspec here — git
          // uses the configured upstream; missing upstream surfaces as an error.
          await runGit(["push", "--force-with-lease", "origin", name], { cwd: root });
        }
        break;
      case "fetch": {
        // For "origin/feature/foo", fetch the matching ref from "origin".
        const slash = name.indexOf("/");
        const remoteName = slash > 0 ? name.slice(0, slash) : "origin";
        const refName = slash > 0 ? name.slice(slash + 1) : name;
        await runGit(["fetch", remoteName, refName], { cwd: root });
        break;
      }
      case "deleteRemote": {
        if (!remote) {
          vscode.window.showInformationMessage(vscode.l10n.t("Use Delete for local branches."));
          return;
        }
        const slash = name.indexOf("/");
        const remoteName = slash > 0 ? name.slice(0, slash) : "origin";
        const refName = slash > 0 ? name.slice(slash + 1) : name;
        const ok = await vscode.window.showWarningMessage(
          vscode.l10n.t("Delete {0} on remote {1}? This is permanent.", refName, remoteName),
          { modal: true },
          vscode.l10n.t("Delete on remote")
        );
        if (!ok) return;
        await runGit(["push", remoteName, "--delete", refName], { cwd: root });
        break;
      }
      case "resetCurrentToHere": {
        if (current) {
          vscode.window.showInformationMessage(vscode.l10n.t("Already at this ref."));
          return;
        }
        const ok = await vscode.window.showWarningMessage(
          vscode.l10n.t("Hard-reset current branch to {0}? Uncommitted changes will be discarded.", name),
          { modal: true },
          vscode.l10n.t("Reset (hard)")
        );
        if (!ok) return;
        await runGit(["reset", "--hard", name], { cwd: root });
        break;
      }
      case "copyName": {
        await vscode.env.clipboard.writeText(name);
        vscode.window.setStatusBarMessage(`$(clippy) ${vscode.l10n.t("Copied:")} ${name}`, 2500);
        return;
      }
    }
    repos.fire();
    const tag = label ? stripCodicons(label) : action;
    vscode.window.setStatusBarMessage(`$(check) ${tag} — ${name}`, 3000);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    const scope = `${label ? stripCodicons(label) : action} ${name}`;
    const recoveries: Array<{ label: string; run: () => Promise<void> }> = [];

    if ((action === "merge" || action === "rebaseOnto") && isWorkingTreeDirtyError(msg)) {
      recoveries.push({
        label: vscode.l10n.t("Stash and retry"),
        run: async () => {
          try {
            await runGit(["stash", "push", "-u", "-m", `rebased: auto before ${action} ${name}`], { cwd: root });
            const op = action === "merge" ? ["merge", "--no-ff", name] : ["rebase", name];
            await runGit(op, { cwd: root });
            await runGit(["stash", "pop"], { cwd: root });
            repos.fire();
            vscode.window.showInformationMessage(vscode.l10n.t("{0} completed; stash popped.", action));
          } catch (e2: unknown) {
            await showGitError(`Auto-stash ${action}`, e2);
          }
        },
      });
      recoveries.push({
        label: vscode.l10n.t("Open Stash dialog"),
        run: async () => {
          await vscode.commands.executeCommand("rebased.stash.create");
        },
      });
    }
    await showGitError(scope, e, recoveries);
  }
}
