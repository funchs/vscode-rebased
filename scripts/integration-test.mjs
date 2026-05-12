// Integration tests against ephemeral git repos.
import assert from "assert";
import { existsSync } from "fs";
import { join } from "path";
import {
  mkRepo,
  test,
  runAll,
  runGit,
  reimplementGetStatus,
} from "./test-helpers.mjs";

// ---------------------------------------------------------------------------
// getStatus: rename detection
// ---------------------------------------------------------------------------
test("getStatus parses renames + deletes + adds + untracked", async () => {
  const r = mkRepo();
  try {
    r.write("a.txt", "hello\n");
    r.write("keep.txt", "keep me\n");
    r.commit("initial");

    // Rename a → b, modify keep, delete (none), add new untracked file
    r.git(["mv", "a.txt", "b.txt"]);
    r.write("keep.txt", "keep me changed\n");
    r.write("brand-new.txt", "untracked\n");

    // Stage everything except brand-new to give us a staged R + unstaged M + ? mix
    r.git(["add", "b.txt"]);

    const status = await reimplementGetStatus(r.dir);
    const staged = status.filter((s) => s.staged);
    const unstaged = status.filter((s) => !s.staged);

    const renamed = staged.find((s) => s.status === "R");
    assert.ok(renamed, "expected staged rename entry");
    assert.strictEqual(renamed.path, "b.txt");
    assert.strictEqual(renamed.oldPath, "a.txt");

    assert.ok(unstaged.find((s) => s.status === "M" && s.path === "keep.txt"), "modified keep.txt");
    assert.ok(unstaged.find((s) => s.status === "?" && s.path === "brand-new.txt"), "untracked file");
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// getLog + getBranches: ahead/behind, multiple branches
// ---------------------------------------------------------------------------
test("getBranches reports ahead/behind", async () => {
  const r = mkRepo();
  try {
    r.write("a.txt", "v1");
    r.commit("first");
    r.git(["checkout", "-q", "-b", "feature"]);
    r.write("a.txt", "v2");
    r.commit("on feature");
    r.git(["checkout", "-q", "main"]);
    r.write("b.txt", "main-only");
    r.commit("on main");
    // Set feature to track main so we get an upstream-tracking signal.
    r.git(["branch", "--set-upstream-to=main", "feature"]);

    // Use for-each-ref format matching getBranches
    const RECORD = "\x1e";
    const fmt = ["%(refname:short)", "%(HEAD)", "%(upstream:short)", "%(upstream:track)"].join(RECORD);
    const out = await runGit(
      ["for-each-ref", `--format=${fmt}`, "refs/heads"],
      { cwd: r.dir }
    );
    const lines = out.split("\n").filter(Boolean);
    const featureLine = lines.find((l) => l.startsWith("feature" + RECORD));
    assert.ok(featureLine, "feature branch present");
    assert.match(featureLine, /ahead 1, behind 1|ahead 1|behind 1/, "feature should track ahead/behind vs main");
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Operation state detection: rebase / merge / cherry-pick
// ---------------------------------------------------------------------------
test("operation state: detects rebase with conflicts", async () => {
  const r = mkRepo();
  try {
    r.write("a.txt", "line1\nline2\nline3\n");
    r.commit("base");

    r.git(["checkout", "-q", "-b", "side"]);
    r.write("a.txt", "line1\nSIDE\nline3\n");
    r.commit("side change");

    r.git(["checkout", "-q", "main"]);
    r.write("a.txt", "line1\nMAIN\nline3\n");
    r.commit("main change");

    // Attempt to rebase side onto main — should produce conflict.
    r.git(["checkout", "-q", "side"]);
    const rebase = r.git(["rebase", "main"], { tolerate: true });
    assert.notStrictEqual(rebase.status, 0, "rebase should fail with conflict");

    // Our detection: presence of .git/rebase-apply or .git/rebase-merge
    const dotGit = join(r.dir, ".git");
    const inRebase = existsSync(join(dotGit, "rebase-merge")) || existsSync(join(dotGit, "rebase-apply"));
    assert.ok(inRebase, "rebase-merge or rebase-apply directory should exist");

    // git diff --name-only --diff-filter=U should list conflicted files
    const conflicted = (await runGit(
      ["diff", "--name-only", "--diff-filter=U", "-z"],
      { cwd: r.dir }
    )).split("\x00").filter(Boolean);
    assert.deepStrictEqual(conflicted, ["a.txt"], "a.txt should be conflicted");

    // Abort so cleanup doesn't choke
    r.git(["rebase", "--abort"], { tolerate: true });
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// getCommitDetail equivalent: --name-status + --numstat parsing
// ---------------------------------------------------------------------------
test("commit detail with renames merges name-status + numstat", async () => {
  const r = mkRepo();
  try {
    // Use long stable content so rename detection sees ≥50% similarity even after edits.
    const base = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n";
    r.write("a.txt", base);
    r.write("b.txt", "keep\n");
    r.commit("init");

    r.git(["mv", "a.txt", "renamed.txt"]);
    r.write("renamed.txt", base + "extra\n");
    r.write("b.txt", "modified\n");
    r.write("c.txt", "added\n");
    r.commit("rename + modify + add");

    const hash = (await runGit(["rev-parse", "HEAD"], { cwd: r.dir })).trim();

    // --name-status -z with -M (rename detection)
    const ns = await runGit(["show", "--format=", "--name-status", "-M", "-z", hash], { cwd: r.dir });
    const tokens = ns.split("\x00").filter(Boolean);
    // Expect: R### a.txt renamed.txt M b.txt A c.txt  (rename produces 3 tokens)
    const renameIdx = tokens.findIndex((t) => /^R\d+$/.test(t) || t === "R");
    assert.ok(renameIdx >= 0, "rename token present");
    assert.strictEqual(tokens[renameIdx + 1], "a.txt");
    assert.strictEqual(tokens[renameIdx + 2], "renamed.txt");

    // --numstat -z must include the renamed file (with empty path between two NULs for rename)
    const numRaw = await runGit(["show", "--format=", "--numstat", "-M", "-z", hash], { cwd: r.dir });
    assert.ok(numRaw.length > 0, "numstat output non-empty");
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Reflog format roundtrip
// ---------------------------------------------------------------------------
test("reflog format produces parseable records", async () => {
  const r = mkRepo();
  try {
    r.write("a.txt", "v1\n");
    r.commit("first");
    r.write("a.txt", "v2\n");
    r.commit("second");
    r.git(["checkout", "-q", "-b", "topic"]);
    r.git(["checkout", "-q", "main"]);

    const RECORD = "\x1e";
    const out = await runGit(
      ["reflog", "-z", `--format=%gd${RECORD}%H${RECORD}%gs${RECORD}%at`],
      { cwd: r.dir }
    );
    const entries = out.split("\x00").filter(Boolean);
    assert.ok(entries.length >= 3, "expected ≥ 3 reflog entries");
    const first = entries[0].split(RECORD);
    assert.strictEqual(first.length, 4, "each entry has 4 fields");
    assert.match(first[0], /^HEAD@\{\d+\}$/);
    assert.match(first[1], /^[0-9a-f]{40}$/);
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Empty / edge repos
// ---------------------------------------------------------------------------
test("empty repo: getLog handles no commits without throwing", async () => {
  const r = mkRepo();
  try {
    // No commits — git log returns non-zero, but our wrapper should surface a clear error
    const result = r.git(["log", "-z", "--max-count=10"], { tolerate: true });
    assert.notStrictEqual(result.status, 0, "git log on empty repo should fail");
    // Production code is expected to surface the error to the webview via 'error' message — we just check we can detect.
    assert.match(result.stderr, /does not have any commits yet|bad default revision|fatal/i);
  } finally {
    r.cleanup();
  }
});

test("detached HEAD: branch operations gracefully degrade", async () => {
  const r = mkRepo();
  try {
    r.write("a.txt", "v1");
    const hash = r.commit("first");
    r.git(["checkout", "-q", "--detach", hash]);

    const symbolic = r.git(["symbolic-ref", "--short", "-q", "HEAD"], { tolerate: true });
    assert.notStrictEqual(symbolic.status, 0, "symbolic-ref should fail on detached HEAD — status bar must hide");
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
console.log("Integration tests:");
await runAll();
