import * as vscode from "vscode";
import { runGit } from "../core/git";
import type { RepoManager } from "../core/repo";

const RECORD = "\x1e";
const NUL = "\x00";

interface SearchHit {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  subject: string;
}

type Mode = "all" | "message" | "author" | "hash" | "file" | "content";

const MODES: Array<{ label: string; value: Mode; detail: string }> = [
  { label: "$(search) Message", value: "message", detail: "git log --grep" },
  { label: "$(person) Author", value: "author", detail: "git log --author" },
  { label: "$(git-commit) Hash prefix", value: "hash", detail: "rev-parse" },
  { label: "$(file-code) File path", value: "file", detail: "git log -- <path>" },
  { label: "$(diff) Patch content (-S)", value: "content", detail: "git log -S<term> — slow but precise" },
  { label: "$(list-flat) All (message + author)", value: "all", detail: "default" },
];

export async function showCommitSearch(repos: RepoManager): Promise<void> {
  const root = repos.root;
  if (!root) return;

  // Mode picker first so the query syntax is predictable.
  const modePick = await vscode.window.showQuickPick(MODES, {
    placeHolder: vscode.l10n.t("Search commits by…"),
  });
  if (!modePick) return;
  const mode = modePick.value;

  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { hash?: string }>();
  qp.placeholder = `Search (${mode}) — type and wait`;
  qp.matchOnDescription = true;
  qp.busy = false;

  let token = 0;
  let pendingTimer: NodeJS.Timeout | undefined;

  qp.onDidChangeValue((value) => {
    const myToken = ++token;
    clearTimeout(pendingTimer);
    if (!value.trim()) {
      qp.items = [];
      qp.busy = false;
      return;
    }
    pendingTimer = setTimeout(async () => {
      qp.busy = true;
      try {
        const hits = await search(root, mode, value.trim());
        if (myToken !== token) return; // user kept typing
        qp.items = hits.map((h) => ({
          label: `$(git-commit) ${h.subject}`,
          description: `${h.shortHash} · ${h.author} · ${new Date(h.date).toLocaleDateString()}`,
          hash: h.hash,
        }));
        qp.busy = false;
      } catch (e: unknown) {
        qp.items = [{ label: `$(error) ${(e as Error).message}` }];
        qp.busy = false;
      }
    }, 220);
  });

  qp.onDidAccept(async () => {
    const sel = qp.selectedItems[0];
    if (sel?.hash) {
      qp.hide();
      await vscode.commands.executeCommand("rebased.commit.show", sel.hash);
    }
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function search(root: string, mode: Mode, q: string): Promise<SearchHit[]> {
  const fmt = ["%H", "%an", "%at", "%s"].join(RECORD);
  let args: string[];
  switch (mode) {
    case "hash": {
      // Resolve a hash prefix to a single commit.
      try {
        const hash = (await runGit(["rev-parse", q], { cwd: root })).trim();
        args = ["log", "-z", `--pretty=format:${fmt}`, "-1", hash];
      } catch {
        return [];
      }
      break;
    }
    case "message":
      args = ["log", "-z", `--pretty=format:${fmt}`, "--max-count=200", "--all", `--grep=${q}`, "-i", "--regexp-ignore-case"];
      break;
    case "author":
      args = ["log", "-z", `--pretty=format:${fmt}`, "--max-count=200", "--all", `--author=${q}`, "-i"];
      break;
    case "file":
      args = ["log", "-z", `--pretty=format:${fmt}`, "--max-count=200", "--all", "--", q];
      break;
    case "content":
      args = ["log", "-z", `--pretty=format:${fmt}`, "--max-count=100", "--all", `-S${q}`, "--pickaxe-regex"];
      break;
    case "all":
    default:
      args = [
        "log", "-z", `--pretty=format:${fmt}`,
        "--max-count=200", "--all",
        `--grep=${q}`, `--author=${q}`,
        "--regexp-ignore-case",
      ];
  }
  const raw = await runGit(args, { cwd: root });
  return raw
    .split(NUL)
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split(RECORD);
      return {
        hash,
        shortHash: hash.slice(0, 7),
        author,
        date: parseInt(date, 10) * 1000,
        subject,
      };
    });
}
