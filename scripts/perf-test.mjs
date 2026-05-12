// Perf + correctness check against a real repo.
// Usage: node scripts/perf-test.mjs /path/to/repo
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import esbuild from "esbuild";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/perf-test.mjs <repo-path>");
  process.exit(1);
}

const out = mkdtempSync(resolve(tmpdir(), "rebased-perf-"));
await esbuild.build({
  entryPoints: [{ in: resolve(repoRoot, "src/m1-log/graph.ts"), out: "graph" }],
  outdir: out,
  format: "esm",
  bundle: true,
  platform: "node",
  logLevel: "error",
});
const { layout } = await import(`file://${out}/graph.js`);

const RECORD = "\x1e";
const NUL = "\x00";
const format = ["%H", "%P", "%an", "%ae", "%at", "%s", "%D"].join(RECORD);

console.log(`Repo: ${target}`);

const t0 = Date.now();
const raw = execFileSync(
  "git",
  ["log", "-z", "--topo-order", "--all", `--pretty=format:${format}`, "--max-count=5000"],
  { cwd: target, encoding: "utf8", maxBuffer: 1024 * 1024 * 200 }
);
const t1 = Date.now();
console.log(`git log: ${t1 - t0}ms`);

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
const t2 = Date.now();
console.log(`parse:   ${t2 - t1}ms (${commits.length} commits)`);

const laid = layout(commits);
const t3 = Date.now();
console.log(`layout:  ${t3 - t2}ms`);

// Sanity invariants
let badLane = 0;
let maxLane = 0;
const seen = new Set();
for (const l of laid) {
  if (l.lane < 0) badLane++;
  if (l.lane > maxLane) maxLane = l.lane;
  if (seen.has(l.commit.hash)) {
    console.error(`DUPLICATE commit ${l.commit.shortHash}`);
  }
  seen.add(l.commit.hash);
}
console.log(`Invariants: ${badLane} bad lanes, ${maxLane + 1} max breadth, ${seen.size} unique`);

// Sample 20 rows from top
console.log("\nTop 20 rows:");
for (let i = 0; i < Math.min(20, laid.length); i++) {
  const l = laid[i];
  const cols = Array((maxLane + 1) * 2 - 1).fill(" ");
  for (const a of l.active) if (a <= maxLane) cols[a * 2] = "│";
  if (l.lane <= maxLane) cols[l.lane * 2] = "●";
  const refs = l.commit.refs.length ? ` (${l.commit.refs.slice(0, 2).join(", ")})` : "";
  console.log(cols.join("").padEnd(maxLane * 2 + 2) + l.commit.subject.slice(0, 60) + refs);
}
