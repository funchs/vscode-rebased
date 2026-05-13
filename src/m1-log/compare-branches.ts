import * as vscode from "vscode";
import { runGit, getBranches } from "../core/git";
import type { RepoManager } from "../core/repo";

const RECORD = "\x1e";
const NUL = "\x00";

interface Side {
  label: string;
  commits: Array<{ hash: string; shortHash: string; subject: string; author: string; date: number }>;
}

export async function compareBranches(repos: RepoManager, against?: string): Promise<void> {
  const root = repos.root;
  if (!root) return;

  let a = against;
  if (!a) {
    const branches = await getBranches(root);
    const pick = await vscode.window.showQuickPick(
      branches.map((b) => ({
        label: `${b.current ? "$(check) " : ""}${b.name}`,
        description: b.upstream ? `→ ${b.upstream}` : "",
        name: b.name,
      })),
      { placeHolder: vscode.l10n.t("Pick a branch to compare against current") }
    );
    if (!pick) return;
    a = pick.name;
  }

  // Symmetric difference: A^...B^ — A has, B has.
  const fmt = ["%H", "%an", "%at", "%s"].join(RECORD);
  const aHead = "HEAD";
  const bHead = a;

  // Commits in A (HEAD) not in B (target)
  const onlyA = await collect(root, fmt, `${bHead}..${aHead}`);
  const onlyB = await collect(root, fmt, `${aHead}..${bHead}`);

  const ahead: Side = { label: `Only in HEAD (${onlyA.length})`, commits: onlyA };
  const behind: Side = { label: `Only in ${a} (${onlyB.length})`, commits: onlyB };

  const items: vscode.QuickPickItem[] = [];
  pushSection(items, ahead);
  pushSection(items, behind);

  if (!items.length) {
    vscode.window.showInformationMessage(vscode.l10n.t("HEAD and {0} have identical history.", a));
    return;
  }

  const pick = (await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t("Compare HEAD ⇆ {0} — pick a commit to inspect", a),
    matchOnDescription: true,
  })) as (vscode.QuickPickItem & { hash?: string }) | undefined;
  if (!pick || !pick.hash) return;
  await vscode.commands.executeCommand("rebased.commit.show", pick.hash);
}

async function collect(root: string, fmt: string, range: string): Promise<Side["commits"]> {
  const raw = await runGit(
    ["log", "-z", `--pretty=format:${fmt}`, "--max-count=500", range],
    { cwd: root }
  );
  return raw
    .split(NUL)
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split(RECORD);
      return {
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        author,
        date: parseInt(date, 10) * 1000,
      };
    });
}

function pushSection(items: vscode.QuickPickItem[], side: Side): void {
  items.push({ label: side.label, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
  for (const c of side.commits) {
    items.push({
      label: `$(git-commit) ${c.subject}`,
      description: `${c.shortHash} · ${c.author} · ${new Date(c.date).toLocaleDateString()}`,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      hash: c.hash,
    } as vscode.QuickPickItem & { hash: string });
  }
}
