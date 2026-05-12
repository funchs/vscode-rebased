// Shared helpers for integration tests.
// Spawns isolated git repos in tmpdir with known structure so test assertions
// don't depend on whatever happens to live in the current workspace.
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..");

const ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

function git(cwd, args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...ENV, ...opts.env },
    input: opts.input,
  });
  if (result.status !== 0 && !opts.tolerate) {
    throw new Error(`git ${args.join(" ")} (status ${result.status}): ${result.stderr}`);
  }
  return result;
}

export function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), "rebased-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return {
    dir,
    git: (args, opts) => git(dir, args, opts),
    write(rel, content) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    commit(msg, files = []) {
      if (files.length) git(dir, ["add", ...files]);
      else git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "--allow-empty", "-m", msg]);
      const hash = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
      return hash;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let modulesCache;
export async function loadSrcModules() {
  if (modulesCache) return modulesCache;
  const out = mkdtempSync(join(tmpdir(), "rebased-mods-"));
  await esbuild.build({
    entryPoints: [
      { in: resolve(repoRoot, "src/m0-rebase/rebase-todo.ts"), out: "rebase-todo" },
      { in: resolve(repoRoot, "src/m1-log/graph.ts"), out: "graph" },
      { in: resolve(repoRoot, "src/m2-commit/hunks.ts"), out: "hunks" },
      { in: resolve(repoRoot, "src/core/conventional-commit.ts"), out: "cc" },
    ],
    outdir: out,
    format: "esm",
    bundle: true,
    platform: "node",
    logLevel: "error",
  });
  modulesCache = {
    rebaseTodo: await import(`file://${out}/rebase-todo.js`),
    graph: await import(`file://${out}/graph.js`),
    hunks: await import(`file://${out}/hunks.js`),
    cc: await import(`file://${out}/cc.js`),
  };
  return modulesCache;
}

// Tiny test runner — Node's test runner is fine but adds complexity for our needs.
const tests = [];
export function test(name, fn) {
  tests.push({ name, fn });
}

export async function runAll() {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${e.message}\n${e.stack?.split("\n").slice(1, 4).join("\n")}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// Mimic the production runGit so we can exercise the same git invocations.
export function runGit(args, opts) {
  return new Promise((resolveP, reject) => {
    const result = spawnSync("git", args, {
      cwd: opts.cwd,
      encoding: "utf8",
      env: { ...process.env, ...(opts.env ?? {}) },
      input: opts.stdin,
    });
    if (result.status === 0) resolveP(result.stdout);
    else reject(new Error(`git ${args.join(" ")}: ${result.stderr}`));
  });
}

export function reimplementGetStatus(repo) {
  // Re-implements src/core/git.ts getStatus to test the parse logic without
  // bundling vscode-dependent modules. Keep in sync.
  return runGit(["status", "--porcelain=v1", "-z"], { cwd: repo }).then((out) => {
    const items = [];
    const parts = out.split("\x00");
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry || entry.length < 3) continue;
      const x = entry[0];
      const y = entry[1];
      const path = entry.slice(3);
      let oldPath;
      if (x === "R" || x === "C") {
        oldPath = parts[++i];
      }
      if (x !== " " && x !== "?") {
        items.push({ path, staged: true, status: x, oldPath });
      }
      if (y !== " ") {
        items.push({ path, staged: false, status: y, oldPath });
      }
    }
    return items;
  });
}
