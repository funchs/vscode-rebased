import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";
import { showGitError, stripCodicons } from "../core/notify";

const RECORD = "\x1e";

interface TagInfo {
  name: string;
  hash: string;
  subject: string;
  annotated: boolean;
}

async function listTags(root: string): Promise<TagInfo[]> {
  const fmt = ["%(refname:short)", "%(objectname)", "%(contents:subject)", "%(*objectname)"].join(RECORD);
  const raw = await runGit(
    ["for-each-ref", `--format=${fmt}`, "--sort=-creatordate", "refs/tags"],
    { cwd: root }
  );
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, hash, subject, peeled] = line.split(RECORD);
      return {
        name,
        hash: peeled || hash,
        subject: subject || "",
        annotated: !!peeled,
      };
    });
}

export async function showTagsPicker(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;
  const tags = await listTags(root);

  const NEW: vscode.QuickPickItem = { label: "$(add) " + vscode.l10n.t("Create new tag…"), alwaysShow: true };
  const items: vscode.QuickPickItem[] = [NEW];
  for (const t of tags) {
    items.push({
      label: `${t.annotated ? "$(tag) " : "$(bookmark) "}${t.name}`,
      description: `${t.hash.slice(0, 7)}${t.subject ? " · " + t.subject : ""}`,
    });
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t("{0} tag(s)", String(tags.length)),
    matchOnDescription: true,
  });
  if (!pick) return;
  if (pick === NEW) {
    await createTag(repos, root);
    return;
  }
  const name = pick.label.replace(/^\$\([^)]+\)\s/, "");
  await tagAction(repos, root, name);
}

async function createTag(repos: RepoManager, root: string): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Tag name (e.g. v1.0.0)") });
  if (!name) return;
  const ref = await vscode.window.showInputBox({ prompt: vscode.l10n.t("Commit/ref to tag"), value: "HEAD" });
  if (!ref) return;
  const message = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Annotation message (leave empty for lightweight tag)"),
  });
  if (message === undefined) return;
  try {
    if (message) {
      await runGit(["tag", "-a", name, ref, "-m", message], { cwd: root });
    } else {
      await runGit(["tag", name, ref], { cwd: root });
    }
    repos.fire();
    vscode.window.showInformationMessage(vscode.l10n.t("Tag {0} created on {1}.", name, ref));
  } catch (e: unknown) {
    await showGitError("Tag create", e);
  }
}

async function tagAction(repos: RepoManager, root: string, name: string): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(eye) " + vscode.l10n.t("Show tagged commit"), value: "show" },
      { label: "$(cloud-upload) " + vscode.l10n.t("Push tag to origin"), value: "push" },
      { label: "$(trash) " + vscode.l10n.t("Delete locally"), value: "deleteLocal" },
      { label: "$(cloud) " + vscode.l10n.t("Delete on origin"), value: "deleteRemote" },
    ],
    { placeHolder: vscode.l10n.t("Action on tag {0}", name) }
  );
  if (!action) return;
  try {
    switch (action.value) {
      case "show": {
        const hash = (await runGit(["rev-list", "-1", name], { cwd: root })).trim();
        await vscode.commands.executeCommand("rebased.commit.show", hash);
        break;
      }
      case "push":
        await runGit(["push", "origin", name], { cwd: root });
        break;
      case "deleteLocal": {
        const deleteLabel = vscode.l10n.t("Delete");
        const ok = await vscode.window.showWarningMessage(vscode.l10n.t("Delete local tag {0}?", name), { modal: true }, deleteLabel);
        if (ok !== deleteLabel) return;
        await runGit(["tag", "-d", name], { cwd: root });
        break;
      }
      case "deleteRemote": {
        const ok = await vscode.window.showWarningMessage(
          vscode.l10n.t("Delete tag {0} on origin? This affects others.", name),
          { modal: true },
          vscode.l10n.t("Delete remotely")
        );
        if (ok !== vscode.l10n.t("Delete remotely")) return;
        await runGit(["push", "origin", `:refs/tags/${name}`], { cwd: root });
        break;
      }
    }
    repos.fire();
  } catch (e: unknown) {
    await showGitError(`${stripCodicons(action.label)} tag ${name}`, e);
  }
}
