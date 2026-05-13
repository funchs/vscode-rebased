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

export interface LogFilter {
  message?: string;
  author?: string;
  path?: string;
  branch?: string;
  since?: string;
}

export async function getLog(
  repo: string,
  opts: { maxCount: number; allBranches: boolean; filter?: LogFilter }
): Promise<CommitRef[]> {
  // -z separates commits with NUL on stdout; we keep NUL out of argv (node 24+ rejects it).
  const format = ["%H", "%P", "%an", "%ae", "%at", "%s", "%D"].join(RECORD);
  // --topo-order guarantees a child always precedes its parent — required for the
  // graph layout's invariant that parents are resolved against subsequent rows.
  const args = ["log", "-z", "--topo-order", `--pretty=format:${format}`, `--max-count=${opts.maxCount}`];
  const f = opts.filter ?? {};
  if (f.message) args.push(`--grep=${f.message}`, "--regexp-ignore-case");
  if (f.author) args.push(`--author=${f.author}`, "-i");
  if (f.since) args.push(`--since=${f.since}`);
  if (f.branch) args.push(f.branch);
  else if (opts.allBranches) args.push("--all");
  if (f.path) args.push("--", f.path);
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

export interface CommitDetail {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  authorDate: number;
  committer: string;
  committerDate: number;
  subject: string;
  body: string;
  refs: string[];
  files: Array<{ path: string; oldPath?: string; status: string; additions: number; deletions: number }>;
}

export async function getCommitDetail(repo: string, hash: string): Promise<CommitDetail> {
  const fmt = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ct", "%s", "%b", "%D"].join(RECORD);
  const raw = await runGit(["show", "-z", `--format=${fmt}`, "--name-status", "--numstat", hash], { cwd: repo });

  // git show -z separates the commit metadata from the file list with NULs and embeds
  // file status records too. Simpler approach: split into the format chunk + the file chunks.
  const headerEnd = raw.indexOf(NUL);
  const header = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const [hashOut, parents, author, email, authorDate, committer, committerDate, subject, body, refs] =
    header.split(RECORD);

  // After the header NUL, --name-status output follows then --numstat (or interleaved).
  // We'll parse files via a separate, cleaner call.
  // -M enables rename detection; without it renames appear as separate D + A and the
  // UI loses the cross-reference. Same for numstat.
  const fileRaw = await runGit(
    ["show", `--format=`, "--name-status", "-M", "-z", hash],
    { cwd: repo }
  );
  const numRaw = await runGit(
    ["show", `--format=`, "--numstat", "-M", "-z", hash],
    { cwd: repo }
  );

  const statusEntries: Array<{ status: string; path: string; oldPath?: string }> = [];
  const sParts = fileRaw.split(NUL);
  for (let i = 0; i < sParts.length; i++) {
    const tok = sParts[i];
    if (!tok) continue;
    if (/^[RC]\d+$/.test(tok) || tok === "R" || tok === "C") {
      statusEntries.push({ status: tok[0], oldPath: sParts[++i], path: sParts[++i] });
    } else if (/^[MADTUX?]$/.test(tok)) {
      statusEntries.push({ status: tok, path: sParts[++i] });
    }
  }

  const stats = new Map<string, { additions: number; deletions: number }>();
  const nParts = numRaw.split(NUL);
  for (let i = 0; i < nParts.length; i++) {
    const tok = nParts[i];
    if (!tok) continue;
    const m = tok.match(/^(\d+|-)\t(\d+|-)\t(.*)$/);
    if (!m) continue;
    const additions = m[1] === "-" ? 0 : parseInt(m[1], 10);
    const deletions = m[2] === "-" ? 0 : parseInt(m[2], 10);
    let p = m[3];
    if (p === "") {
      // Renamed file: actual paths come on the next two NUL-separated tokens.
      const oldPath = nParts[++i];
      const newPath = nParts[++i];
      p = newPath;
      stats.set(oldPath + "→" + newPath, { additions, deletions });
      stats.set(newPath, { additions, deletions });
    } else {
      stats.set(p, { additions, deletions });
    }
  }

  const files = statusEntries.map((e) => {
    const s = stats.get(e.path) ?? (e.oldPath ? stats.get(e.oldPath + "→" + e.path) : undefined);
    return {
      path: e.path,
      oldPath: e.oldPath,
      status: e.status,
      additions: s?.additions ?? 0,
      deletions: s?.deletions ?? 0,
    };
  });

  return {
    hash: hashOut,
    shortHash: hashOut.slice(0, 7),
    parents: parents ? parents.split(" ").filter(Boolean) : [],
    author,
    email,
    authorDate: parseInt(authorDate, 10) * 1000,
    committer,
    committerDate: parseInt(committerDate, 10) * 1000,
    subject,
    body: body.trimEnd(),
    refs: refs ? refs.split(", ").filter(Boolean) : [],
    files,
  };
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

export interface OperationState {
  kind: "rebase" | "merge" | "cherry-pick" | "revert" | "stash-pop" | null;
  conflicted: string[];
  stashRef?: string; // when kind === "stash-pop": which stash to drop after resolve
}

export async function getOperationState(repo: string): Promise<OperationState> {
  const { existsSync } = await import("fs");
  const path = await import("path");
  const dir = path.join(repo, ".git");
  let kind: OperationState["kind"] = null;
  if (existsSync(path.join(dir, "rebase-merge")) || existsSync(path.join(dir, "rebase-apply"))) kind = "rebase";
  else if (existsSync(path.join(dir, "MERGE_HEAD"))) kind = "merge";
  else if (existsSync(path.join(dir, "CHERRY_PICK_HEAD"))) kind = "cherry-pick";
  else if (existsSync(path.join(dir, "REVERT_HEAD"))) kind = "revert";

  const out = await runGit(["diff", "--name-only", "--diff-filter=U", "-z"], { cwd: repo });
  const conflicted = out.split(NUL).filter(Boolean);

  // Stash-pop pseudo-state: no formal git operation, but UU files are sitting
  // in the working tree AND we just attempted a pop (sentinel file we drop).
  // The sentinel makes the detection deterministic — checking just "UU + no
  // op" would false-positive on hand-edited conflict markers.
  if (!kind && conflicted.length) {
    const sentinel = path.join(dir, "rebased-stash-pop-in-progress");
    if (existsSync(sentinel)) {
      const { readFileSync } = await import("fs");
      let stashRef: string | undefined;
      try {
        stashRef = readFileSync(sentinel, "utf8").trim();
      } catch { /* ignore */ }
      kind = "stash-pop";
      return { kind, conflicted, stashRef };
    }
  }

  return { kind, conflicted };
}

// Writes the sentinel; called by update-project after stash pop reports conflicts.
export async function markStashPopInProgress(repo: string, stashRef: string): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  await fs.writeFile(path.join(repo, ".git", "rebased-stash-pop-in-progress"), stashRef, "utf8");
}

export async function clearStashPopInProgress(repo: string): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  try {
    await fs.unlink(path.join(repo, ".git", "rebased-stash-pop-in-progress"));
  } catch { /* already cleared */ }
}

// "stash-pop" is a pseudo-op resolved by the conflict panel, not by these
// generic helpers — exclude it from the union here.
export type GitOp = Exclude<NonNullable<OperationState["kind"]>, "stash-pop">;

export async function continueOperation(repo: string, op: GitOp): Promise<void> {
  const map: Record<GitOp, string[]> = {
    "rebase": ["rebase", "--continue"],
    "merge": ["commit", "--no-edit"],
    "cherry-pick": ["cherry-pick", "--continue"],
    "revert": ["revert", "--continue"],
  };
  await runGit(map[op], { cwd: repo, env: { GIT_EDITOR: "true" } });
}

export async function abortOperation(repo: string, op: GitOp): Promise<void> {
  const map: Record<GitOp, string[]> = {
    "rebase": ["rebase", "--abort"],
    "merge": ["merge", "--abort"],
    "cherry-pick": ["cherry-pick", "--abort"],
    "revert": ["revert", "--abort"],
  };
  await runGit(map[op], { cwd: repo });
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
