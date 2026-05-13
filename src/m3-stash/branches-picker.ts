import * as vscode from "vscode";
import { getBranches, runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError, stripCodicons, isWorkingTreeDirtyError } from "../core/notify";

interface BranchAction {
  label: string;
  description?: string;
  action: "checkout" | "checkoutLocal" | "rename" | "delete" | "merge" | "rebaseOnto" | "compare" | "newFromHere" | "pushSetUpstream";
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
  const localName = remote ? name.replace(/^[^/]+\//, "") : name;
  const actions: BranchAction[] = [];
  if (!current) {
    if (remote) {
      actions.push({ label: "$(git-pull-request) Checkout (create local tracking)", action: "checkoutLocal" });
      actions.push({ label: "$(eye) Checkout detached", action: "checkout" });
    } else {
      actions.push({ label: "$(check) Checkout", action: "checkout" });
    }
    actions.push({ label: "$(git-merge) Merge into current", action: "merge" });
    actions.push({ label: "$(git-pull-request-go-to-changes) Rebase current onto this", action: "rebaseOnto" });
  }
  actions.push({ label: "$(diff) Compare with current", action: "compare" });
  actions.push({ label: "$(add) New branch from here…", action: "newFromHere" });
  if (!remote && !current) {
    actions.push({ label: "$(pencil) Rename…", action: "rename" });
    actions.push({ label: "$(cloud-upload) Push (set upstream)", action: "pushSetUpstream" });
    actions.push({ label: "$(trash) Delete", action: "delete" });
  }

  const choice = await vscode.window.showQuickPick(
    actions.map((a) => ({ label: a.label, description: a.description, action: a.action })),
    { placeHolder: vscode.l10n.t("Action on {0}", name) }
  );
  if (!choice) return;

  try {
    switch (choice.action) {
      case "checkout":
        await runGit(["checkout", name], { cwd: root });
        break;
      case "checkoutLocal": {
        // Create local branch tracking the remote.
        await runGit(["checkout", "-b", localName, "--track", name], { cwd: root });
        break;
      }
      case "merge":
        await runGit(["merge", "--no-ff", name], { cwd: root });
        break;
      case "rebaseOnto":
        await runGit(["rebase", name], { cwd: root });
        break;
      case "rename": {
        const next = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Rename {0} to…", name), value: name });
        if (!next || next === name) return;
        await runGit(["branch", "-m", name, next], { cwd: root });
        break;
      }
      case "delete": {
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
    }
    repos.fire();
    vscode.window.setStatusBarMessage(`$(check) ${stripCodicons(choice.label)} — ${name}`, 3000);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    const scope = `${stripCodicons(choice.label)} ${name}`;
    const actions: Array<{ label: string; run: () => Promise<void> }> = [];

    if (
      (choice.action === "merge" || choice.action === "rebaseOnto") &&
      isWorkingTreeDirtyError(msg)
    ) {
      actions.push({
        label: vscode.l10n.t("Stash and retry"),
        run: async () => {
          try {
            await runGit(["stash", "push", "-u", "-m", `rebased: auto before ${choice.action} ${name}`], { cwd: root });
            const op = choice.action === "merge"
              ? ["merge", "--no-ff", name]
              : ["rebase", name];
            await runGit(op, { cwd: root });
            await runGit(["stash", "pop"], { cwd: root });
            repos.fire();
            vscode.window.showInformationMessage(vscode.l10n.t("{0} completed; stash popped.", choice.action));
          } catch (e2: unknown) {
            await showGitError(`Auto-stash ${choice.action}`, e2);
          }
        },
      });
      actions.push({
        label: vscode.l10n.t("Open Stash dialog"),
        run: async () => {
          await vscode.commands.executeCommand("rebased.stash.create");
        },
      });
    }
    await showGitError(scope, e, actions);
  }
}
