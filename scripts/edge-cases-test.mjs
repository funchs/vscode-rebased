// Edge cases for pure parsing / layout logic.
import assert from "assert";
import { test, runAll, loadSrcModules } from "./test-helpers.mjs";

const { rebaseTodo, graph, hunks } = await loadSrcModules();

// ---------------------------------------------------------------------------
// rebase-todo: exec/break/comments/whitespace/short forms
// ---------------------------------------------------------------------------
test("parseTodo handles exec/break/comments/short forms mixed", () => {
  const text = `p abc1234 first
# this is a comment
   reword def5678 second commit
exec npm test
break
squash 999aaaa squash me

# Trailing notes
# Commands: pick, reword, ...
`;
  const parsed = rebaseTodo.parseTodo(text);
  // Two non-action lines (the comment block at the bottom) go to trailing.
  assert.strictEqual(parsed.entries.length, 5, "5 actionable entries");
  assert.strictEqual(parsed.entries[0].action, "pick");
  assert.strictEqual(parsed.entries[0].hash, "abc1234");
  assert.strictEqual(parsed.entries[1].action, "reword");
  assert.strictEqual(parsed.entries[2].action, "exec");
  assert.match(parsed.entries[2].argument ?? "", /^npm test$/);
  assert.strictEqual(parsed.entries[3].action, "break");
  assert.strictEqual(parsed.entries[4].action, "squash");

  // Round-trip preserves trailing comments verbatim
  const out = rebaseTodo.serializeTodo(parsed);
  assert.ok(out.includes("# Trailing notes"));
  assert.ok(out.includes("# Commands: pick"));
});

test("parseTodo treats malformed lines as trailing instead of crashing", () => {
  const text = `pick abc subject
this is not a valid line
drop def gone
`;
  const parsed = rebaseTodo.parseTodo(text);
  assert.strictEqual(parsed.entries.length, 2);
  assert.ok(parsed.trailing.includes("this is not a valid line"));
});

// ---------------------------------------------------------------------------
// hunks: rename header, no-newline-at-EOF marker, selective rebuild
// ---------------------------------------------------------------------------
test("parsePatch preserves no-newline-at-EOF marker in body", () => {
  const patch = `diff --git a/foo b/foo
index abc..def 100644
--- a/foo
+++ b/foo
@@ -1,2 +1,2 @@
 line one
-line two
\\ No newline at end of file
+line two changed
\\ No newline at end of file
`;
  const parsed = hunks.parsePatch(patch);
  assert.strictEqual(parsed.hunks.length, 1);
  assert.ok(parsed.hunks[0].body.includes("\\ No newline at end of file"));
  const rebuilt = hunks.buildPatch(parsed, [0]);
  assert.ok(rebuilt.includes("\\ No newline at end of file"));
});

test("parsePatch handles multiple files (rare but possible if you pipe `git diff` across files)", () => {
  const patch = `diff --git a/foo b/foo
--- a/foo
+++ b/foo
@@ -1 +1 @@
-foo
+FOO
diff --git a/bar b/bar
--- a/bar
+++ b/bar
@@ -1 +1 @@
-bar
+BAR
`;
  const parsed = hunks.parsePatch(patch);
  // Our current parser only emits hunks; multi-file diff still yields 2 hunks
  // (it's the caller's job to feed single-file diffs). Verify we don't lose either.
  assert.strictEqual(parsed.hunks.length, 2);
});

// ---------------------------------------------------------------------------
// graph layout: merge commits, octopus merges, lane collapse
// ---------------------------------------------------------------------------
test("layout collapses two-branch merge back to one lane", () => {
  // Topology (newest-first / topo-order):
  //   M (merge of A and B)
  //   A on branch alpha
  //   B on branch beta
  //   root
  const commits = [
    { hash: "M", parents: ["A", "B"], subject: "merge", shortHash: "M", refs: [] },
    { hash: "A", parents: ["root"], subject: "alpha", shortHash: "A", refs: [] },
    { hash: "B", parents: ["root"], subject: "beta", shortHash: "B", refs: [] },
    { hash: "root", parents: [], subject: "root", shortHash: "root", refs: [] },
  ];
  const out = graph.layout(commits);
  assert.strictEqual(out.length, 4);
  assert.strictEqual(out[0].lane, 0, "merge sits on lane 0");
  assert.strictEqual(out[0].parentLanes.length, 2);
  // After A consumes its lane, B's lane is dropped — root should collapse to one.
  assert.strictEqual(out[3].active.length, 0, "root has no active lanes after itself (last row)");
});

test("layout handles octopus merge (three parents)", () => {
  const commits = [
    { hash: "O", parents: ["A", "B", "C"], subject: "octopus", shortHash: "O", refs: [] },
    { hash: "A", parents: ["root"], subject: "a", shortHash: "A", refs: [] },
    { hash: "B", parents: ["root"], subject: "b", shortHash: "B", refs: [] },
    { hash: "C", parents: ["root"], subject: "c", shortHash: "C", refs: [] },
    { hash: "root", parents: [], subject: "root", shortHash: "root", refs: [] },
  ];
  const out = graph.layout(commits);
  assert.strictEqual(out[0].parentLanes.length, 3, "octopus has 3 parent lanes");
});

test("layout handles orphan branch tip (parent missing from input)", () => {
  // Useful when log was truncated by --max-count and we still see refs to commits we don't have.
  const commits = [
    { hash: "X", parents: ["missing-parent"], subject: "tip", shortHash: "X", refs: [] },
    { hash: "Y", parents: ["another-missing"], subject: "another tip", shortHash: "Y", refs: [] },
  ];
  const out = graph.layout(commits);
  assert.strictEqual(out.length, 2, "no crash");
  // Each gets its own lane since they share no parents we know about.
  const lanes = new Set(out.map((l) => l.lane));
  assert.strictEqual(lanes.size, 2, "two distinct lanes");
});

// ---------------------------------------------------------------------------
// rebase-todo: drop action is preserved with hash even after reorder
// ---------------------------------------------------------------------------
test("rebase-todo drop action serializes hash properly", () => {
  const text = `pick aaa first
drop bbb second
pick ccc third
`;
  const parsed = rebaseTodo.parseTodo(text);
  // Move the drop to the end
  const [dropped] = parsed.entries.splice(1, 1);
  parsed.entries.push(dropped);
  const out = rebaseTodo.serializeTodo(parsed);
  assert.match(out, /^pick aaa first\npick ccc third\ndrop bbb second\n/);
});

// ---------------------------------------------------------------------------
console.log("Edge case tests:");
await runAll();
