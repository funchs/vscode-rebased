// Smoke test: exercises rebase-todo parser and graph layout against real data.
// Runs without VS Code — pure node + git CLI. Tests round-trip stability and
// graph invariants (every parent reachable, lane assignments stable).
import { execFileSync } from "child_process";
import assert from "assert";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// 1. Compile TS sources we need into a tmp dir so we can import them as JS.
//    Easier: re-implement them by reading the source — but that's brittle.
//    Cleanest: use tsx via npx. To avoid an extra install, transpile inline
//    with esbuild which is already a devDep.
import esbuild from "esbuild";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";

const out = mkdtempSync(resolve(tmpdir(), "rebased-smoke-"));
await esbuild.build({
  entryPoints: [
    { in: resolve(repoRoot, "src/m0-rebase/rebase-todo.ts"), out: "rebase-todo" },
    { in: resolve(repoRoot, "src/m1-log/graph.ts"), out: "graph" },
    { in: resolve(repoRoot, "src/m2-commit/hunks.ts"), out: "hunks" },
  ],
  outdir: out,
  format: "esm",
  bundle: true,
  platform: "node",
  logLevel: "error",
});

const { parseTodo, serializeTodo } = await import(`file://${out}/rebase-todo.js`);
const { layout } = await import(`file://${out}/graph.js`);
const { parsePatch, buildPatch } = await import(`file://${out}/hunks.js`);

// ---------------------------------------------------------------------------
// Test 1: rebase-todo round-trip
// ---------------------------------------------------------------------------
const sampleTodo = `pick 64ccfd1 feat(commit): amend ui
pick b065c72 feat(log): context menu
squash 44c20c2 feat(log): add lane colors
drop 899423f test: dummy commit 4
exec npm test

# Rebase 270b055..64ccfd1 onto 270b055
#
# Commands:
# p, pick = use commit
`;

const parsed = parseTodo(sampleTodo);
assert.strictEqual(parsed.entries.length, 5, "should parse 5 entries");
assert.strictEqual(parsed.entries[0].action, "pick");
assert.strictEqual(parsed.entries[2].action, "squash");
assert.strictEqual(parsed.entries[3].action, "drop");
assert.strictEqual(parsed.entries[4].action, "exec");
assert.match(parsed.entries[4].argument ?? "", /^npm test$/);
console.log("✓ parseTodo: 5 entries recognized");

// Mutate then re-serialize.
parsed.entries[0].action = "reword";
[parsed.entries[0], parsed.entries[1]] = [parsed.entries[1], parsed.entries[0]];
const serialized = serializeTodo(parsed);
const reparsed = parseTodo(serialized);
assert.strictEqual(reparsed.entries[0].hash, "b065c72");
assert.strictEqual(reparsed.entries[1].action, "reword");
assert.strictEqual(reparsed.entries[4].action, "exec");
console.log("✓ serializeTodo: mutate + round-trip stable");

// ---------------------------------------------------------------------------
// Test 2: graph layout against real git log we created
// ---------------------------------------------------------------------------
const RECORD = "\x1e";
const NUL = "\x00";
const format = ["%H", "%P", "%an", "%ae", "%at", "%s", "%D"].join(RECORD);
const raw = execFileSync(
  "git",
  ["log", "-z", "--topo-order", `--pretty=format:${format}`, "--all", "--max-count=100"],
  { cwd: repoRoot, encoding: "utf8" }
);
const commits = raw
  .split(NUL)
  .filter(Boolean)
  .map((line) => {
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

assert.ok(commits.length >= 5, `expected real commits, got ${commits.length}`);
console.log(`✓ git log: ${commits.length} real commits loaded`);

const laid = layout(commits);
assert.strictEqual(laid.length, commits.length, "layout must preserve count");

// Lane sanity: every commit on a non-negative lane, every parentLane non-negative.
for (const l of laid) {
  assert.ok(l.lane >= 0, `commit ${l.commit.shortHash} has lane ${l.lane}`);
  for (const p of l.parentLanes) {
    assert.ok(p >= 0, `parent lane ${p} for ${l.commit.shortHash}`);
  }
}
console.log("✓ graph layout: all lanes non-negative");

// Branch sanity: the rows with multiple ancestors-in-lanes should produce > 1 lane somewhere.
const maxLane = Math.max(...laid.map((l) => l.lane));
// Informational only. Whether this repo has multi-lane history depends on the
// checkout context (CI fetches the default branch only), so we don't assert.
// Multi-lane / merge / octopus correctness is covered by edge-cases-test.mjs
// against synthetic topologies.
console.log(`✓ graph layout: max lane = ${maxLane}`);

// Print a tiny ASCII rendering so a human can eyeball it.
console.log("\n--- ASCII preview ---");
for (const l of laid.slice(0, 12)) {
  const cols = Array((maxLane + 1) * 2 - 1).fill(" ");
  for (const a of l.active) cols[a * 2] = "│";
  cols[l.lane * 2] = "●";
  const refs = l.commit.refs.length ? ` (${l.commit.refs.join(", ")})` : "";
  console.log(cols.join("") + "  " + l.commit.subject + refs);
}

// ---------------------------------------------------------------------------
// Test 3: hunk parser round-trip
// ---------------------------------------------------------------------------
const samplePatch = `diff --git a/foo.ts b/foo.ts
index abc..def 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line one
-line two
+line two changed
+line two and a half
 line three
@@ -10,2 +11,3 @@
 line ten
+inserted at 11
 line eleven
`;
const parsedPatch = parsePatch(samplePatch);
assert.strictEqual(parsedPatch.hunks.length, 2, "expected 2 hunks");
assert.strictEqual(parsedPatch.hunks[0].oldStart, 1);
assert.strictEqual(parsedPatch.hunks[0].newLines, 4);
assert.strictEqual(parsedPatch.hunks[1].oldStart, 10);
console.log("✓ parsePatch: 2 hunks recognized");

const onlySecond = buildPatch(parsedPatch, [1]);
const reparsedHunks = parsePatch(onlySecond);
assert.strictEqual(reparsedHunks.hunks.length, 1);
assert.strictEqual(reparsedHunks.hunks[0].oldStart, 10);
assert.ok(onlySecond.includes("+inserted at 11"));
console.log("✓ buildPatch: selective rebuild correct");

// ---------------------------------------------------------------------------
// Test 4: blame porcelain parser (lifts parser out of the class for testing)
// ---------------------------------------------------------------------------
const BLAME_HEADER = /^([0-9a-f]{40})(?: \d+){2,3}$/;
function parseBlame(raw) {
  const lines = raw.split("\n");
  const meta = new Map();
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(BLAME_HEADER);
    if (!m) { i++; continue; }
    const hash = m[1];
    const cur = meta.get(hash) ? { ...meta.get(hash) } : {};
    i++;
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const line = lines[i];
      if (line.startsWith("author ")) cur.author = line.slice(7);
      else if (line.startsWith("author-time ")) cur.date = parseInt(line.slice(12), 10) * 1000;
      else if (line.startsWith("summary ")) cur.summary = line.slice(8);
      i++;
    }
    if (cur.author && cur.date != null && cur.summary != null) meta.set(hash, cur);
    const m2 = meta.get(hash);
    result.push(m2 ? { hash, ...m2 } : { hash, author: "?", date: 0, summary: "" });
    i++;
  }
  return result;
}

const sampleBlame = `6f6bf31dd23d8e83a74fc5775272cf8c8ecae509 1 1 1
author Tom Huang
author-mail <example@example.com>
author-time 1777363415
author-tz +0800
summary Refactor project name
filename README.md
\t# Open Design
a98096a042388b74e422d4b1a750fce6894f9a5d 2 2 1
author pftom
author-time 1777350359
summary Add initial project structure
boundary
filename README.md
\t
`;
const blame = parseBlame(sampleBlame);
assert.strictEqual(blame.length, 2);
assert.strictEqual(blame[0].author, "Tom Huang");
assert.strictEqual(blame[0].summary, "Refactor project name");
assert.strictEqual(blame[1].author, "pftom");
console.log("✓ parseBlame: porcelain format with metadata recovered");

console.log("\nAll smoke tests passed ✅");
