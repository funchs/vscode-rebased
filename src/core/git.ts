import { spawn } from "child_process";
import * as vscode from "vscode";
import type {
  CommitRef,
  FileChange,
  StashEntry,
  BranchInfo,
} from "./types";

const NUL = "\x00";
const RECORD = "\x1e";

function gitPath(): string {
  return vscode.workspace.getConfiguration("rebased").get<string>("gitPath", "git");
}

export interface GitRunOptions {
  cwd: string;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}

// Uses spawn (NOT exec) with argv array — never invokes a shell, so caller-supplied
// strings (paths, refs, messages) cannot inject commands.
export function runGit(args: string[], opts: GitRunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitPath(), args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
    });
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }
  });
}

export async function findRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    const out = await runGit(["rev-parse", "--show-toplevel"], { cwd });
    return out.trim();
  } catch {
    return undefined;
  }
}

export async function getStatus(repo: string): Promise<FileChange[]> {
  const out = await runGit(["status", "--porcelain=v1", "-z"], { cwd: repo });
  const items: FileChange[] = [];
  const parts = out.split(NUL);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 3) continue;
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    let oldPath: string | undefined;
    if (x === "R" || x === "C") {
      oldPath = parts[++i];
    }
    if (x !== " " && x !== "?") {
      items.push({ path, staged: true, status: mapStatus(x), oldPath });
    }
    if (y !== " ") {
      items.push({ path, staged: false, status: mapStatus(y), oldPath });
    }
  }
  return items;
}

function mapStatus(c: string): FileChange["status"] {
  if (c === "M" || c === "A" || c === "D" || c === "R" || c === "C" || c === "U" || c === "?") return c;
  return "M";
}

export async function getLog(
  repo: string,
  opts: { maxCount: number; allBranches: boolean }
): Promise<CommitRef[]> {
  // -z separates commits with NUL on stdout; we keep NUL out of argv (node 24+ rejects it).
  const format = ["%H", "%P", "%an", "%ae", "%at", "%s", "%D"].join(RECORD);
  // --topo-order guarantees a child always precedes its parent — required for the
  // graph layout's invariant that parents are resolved against subsequent rows.
  const args = ["log", "-z", "--topo-order", `--pretty=format:${format}`, `--max-count=${opts.maxCount}`];
  if (opts.allBranches) args.push("--all");
  const out = await runGit(args, { cwd: repo });
  return out.split(NUL).filter(Boolean).map((line) => {
    const [hash, parents, author, email, date, subject, refs] = line.split(RECORD);
    return {
      hash,
      shortHash: hash.slice(0, 7),
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      author,
      email,
      date: parseInt(date, 10) * 1000,
      subject,
      refs: refs ? refs.split(", ").filter(Boolean) : [],
    };
  });
}

export async function stage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  await runGit(["add", "--", ...paths], { cwd: repo });
}

export async function unstage(repo: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  await runGit(["restore", "--staged", "--", ...paths], { cwd: repo });
}

export async function commit(repo: string, message: string, amend = false): Promise<void> {
  const args = ["commit", "-m", message];
  if (amend) args.splice(1, 0, "--amend");
  await runGit(args, { cwd: repo });
}

export async function getStashes(repo: string): Promise<StashEntry[]> {
  const out = await runGit(
    ["stash", "list", `--pretty=format:%gd${RECORD}%gs`],
    { cwd: repo }
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const [ref, subject] = line.split(RECORD);
      const branchMatch = subject.match(/on (.+?):/);
      return {
        index,
        ref,
        subject,
        branch: branchMatch ? branchMatch[1] : "",
      };
    });
}

export async function getBranches(repo: string): Promise<BranchInfo[]> {
  const fmt = ["%(refname:short)", "%(HEAD)", "%(upstream:short)", "%(upstream:track)"].join(RECORD);
  const out = await runGit(
    ["for-each-ref", "--sort=-committerdate", `--format=${fmt}`, "refs/heads", "refs/remotes"],
    { cwd: repo }
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream, track] = line.split(RECORD);
      const remote = name.startsWith("origin/") || name.includes("/HEAD");
      const ahead = /ahead (\d+)/.exec(track)?.[1];
      const behind = /behind (\d+)/.exec(track)?.[1];
      return {
        name,
        current: head.trim() === "*",
        remote,
        upstream: upstream || undefined,
        ahead: ahead ? parseInt(ahead, 10) : undefined,
        behind: behind ? parseInt(behind, 10) : undefined,
      };
    });
}

export async function cherryPick(repo: string, hash: string): Promise<void> {
  await runGit(["cherry-pick", hash], { cwd: repo });
}

export async function diffFile(repo: string, path: string, staged = false): Promise<string> {
  const args = ["diff", "--no-color", "-U3"];
  if (staged) args.push("--cached");
  args.push("--", path);
  return await runGit(args, { cwd: repo });
}

export async function applyPatch(repo: string, patch: string, options: { cached?: boolean; reverse?: boolean }): Promise<void> {
  const args = ["apply", "--unidiff-zero", "--whitespace=nowarn"];
  if (options.cached) args.push("--cached");
  if (options.reverse) args.push("--reverse");
  args.push("-");
  await runGit(args, { cwd: repo, stdin: patch });
}

export async function getReflog(repo: string, limit = 200): Promise<Array<{ ref: string; hash: string; subject: string; date: number }>> {
  const fmt = ["%gd", "%H", "%gs", "%at"].join(RECORD);
  const out = await runGit(["reflog", "-z", `--format=${fmt}`, `--max-count=${limit}`], { cwd: repo });
  return out
    .split(NUL)
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, subject, date] = line.split(RECORD);
      return { ref, hash, subject, date: parseInt(date, 10) * 1000 };
    });
}

export async function startInteractiveRebase(repo: string, baseRef: string): Promise<void> {
  await runGit(["rebase", "-i", baseRef], {
    cwd: repo,
    env: { GIT_SEQUENCE_EDITOR: "code --wait" },
  });
}
