import assert from "assert";
import { test, runAll, loadSrcModules } from "./test-helpers.mjs";

const { notify } = await loadSrcModules();

test("stripCodicons removes $(icon) tokens", () => {
  assert.strictEqual(notify.stripCodicons("$(git-merge) Merge into current"), "Merge into current");
  assert.strictEqual(notify.stripCodicons("$(check) Done"), "Done");
  assert.strictEqual(notify.stripCodicons("plain text"), "plain text");
  assert.strictEqual(notify.stripCodicons("$(a)$(b) twice"), "twice");
});

test("stripCodicons preserves dollar signs that aren't codicons", () => {
  assert.strictEqual(notify.stripCodicons("price $5.00"), "price $5.00");
  assert.strictEqual(notify.stripCodicons("$variable"), "$variable");
});

test("firstNonEmptyLine skips fatal: prefix lines", () => {
  const err = `fatal: too many fatal lines
error: Your local changes to the following files would be overwritten by merge
Please commit your changes or stash them before you merge.`;
  assert.strictEqual(
    notify.firstNonEmptyLine(err),
    "error: Your local changes to the following files would be overwritten by merge"
  );
});

test("firstNonEmptyLine handles single line", () => {
  assert.strictEqual(notify.firstNonEmptyLine("just one line"), "just one line");
});

test("isWorkingTreeDirtyError matches common git dirty-tree phrases", () => {
  const samples = [
    "Your local changes to the following files would be overwritten by merge",
    "error: local changes prevent checkout",
    "You have uncommitted changes",
    "Not a fast-forward",
    "untracked working tree files would be overwritten",
  ];
  for (const s of samples) {
    assert.ok(notify.isWorkingTreeDirtyError(s), `should match: ${s}`);
  }
});

test("isWorkingTreeDirtyError does NOT match unrelated errors", () => {
  const samples = [
    "fatal: ambiguous argument 'HEAD~5': unknown revision",
    "error: pathspec 'foo.txt' did not match any files",
    "no such ref",
  ];
  for (const s of samples) {
    assert.strictEqual(notify.isWorkingTreeDirtyError(s), false, `should not match: ${s}`);
  }
});

test("parseUntrackedCollisions handles modern git (no numbering) wrapped by runGit", () => {
  // Real format captured from git 2.x: bare path, followed by 'could not restore' tail.
  const msg = `git stash pop exited 1: .dockerignore already exists, no checkout
error: could not restore untracked files from stash`;
  assert.deepStrictEqual(notify.parseUntrackedCollisions(msg), [".dockerignore"]);
});

test("parseUntrackedCollisions handles multiple bare-path collisions", () => {
  const msg = `git stash pop exited 1: .dockerignore already exists, no checkout
src/foo bar.txt already exists, no checkout
deeply/nested/file.cfg already exists, no checkout
error: could not restore untracked files from stash`;
  assert.deepStrictEqual(notify.parseUntrackedCollisions(msg), [
    ".dockerignore",
    "src/foo bar.txt",
    "deeply/nested/file.cfg",
  ]);
});

test("parseUntrackedCollisions handles older numbered git output", () => {
  const msg = `git stash pop exited 1: 1: .dockerignore already exists, no checkout
2: src/foo.txt already exists, no checkout
error: could not restore untracked files from stash`;
  assert.deepStrictEqual(notify.parseUntrackedCollisions(msg), [
    ".dockerignore",
    "src/foo.txt",
  ]);
});

test("parseUntrackedCollisions returns empty for unrelated stash errors", () => {
  assert.deepStrictEqual(notify.parseUntrackedCollisions("CONFLICT (content): Merge conflict in foo.ts"), []);
  assert.deepStrictEqual(notify.parseUntrackedCollisions(""), []);
});

test("isStashConflictMessage matches conflict phrasing", () => {
  assert.ok(notify.isStashConflictMessage("CONFLICT (content): Merge conflict in a.txt"));
  assert.ok(notify.isStashConflictMessage("Auto-merging foo.ts\nCONFLICT in foo.ts"));
  assert.strictEqual(notify.isStashConflictMessage(".dockerignore already exists, no checkout"), false);
});

console.log("Notify (toast helper) tests:");
await runAll();
