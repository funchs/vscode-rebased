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

console.log("Notify (toast helper) tests:");
await runAll();
