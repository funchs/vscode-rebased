import assert from "assert";
import { test, runAll, loadSrcModules } from "./test-helpers.mjs";

const { cc } = await loadSrcModules();

test("parseCC basic feat", () => {
  const p = cc.parseCC("feat(api): add user endpoint");
  assert.strictEqual(p.type, "feat");
  assert.strictEqual(p.scope, "api");
  assert.strictEqual(p.subject, "add user endpoint");
  assert.strictEqual(p.breaking, false);
  assert.deepStrictEqual(p.ranges.type, [0, 4]);
  assert.deepStrictEqual(p.ranges.scope, [5, 8]);
  // "feat(api): " is 11 chars; "add user endpoint" is 17 → [11, 28]
  assert.deepStrictEqual(p.ranges.subject, [11, 28]);
});

test("parseCC breaking via bang", () => {
  const p = cc.parseCC("feat!: drop deprecated API");
  assert.strictEqual(p.breaking, true);
  assert.strictEqual(p.scope, undefined);
});

test("parseCC breaking via footer", () => {
  const text = `refactor(auth): rotate tokens

Use opaque tokens instead of JWTs.

BREAKING CHANGE: client must refetch on each session start
Reviewed-by: alice`;
  const p = cc.parseCC(text);
  assert.strictEqual(p.breaking, true);
  assert.strictEqual(p.body, "Use opaque tokens instead of JWTs.");
  assert.strictEqual(p.footers.length, 2);
  assert.strictEqual(p.footers[0].token, "BREAKING-CHANGE");
  assert.strictEqual(p.footers[1].token, "Reviewed-by");
});

test("parseCC malformed header returns no type but no crash", () => {
  const p = cc.parseCC("just a sentence without a colon");
  assert.strictEqual(p.type, undefined);
  assert.strictEqual(p.breaking, false);
});

test("parseCC body with multiple paragraphs", () => {
  const text = `feat(ui): card

First paragraph.

Second paragraph.`;
  const p = cc.parseCC(text);
  assert.strictEqual(p.body, "First paragraph.\n\nSecond paragraph.");
});

test("validateCC empty", () => {
  const issues = cc.validateCC("");
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].code, "empty");
});

test("validateCC unknown type warns", () => {
  const issues = cc.validateCC("widget(ui): hi there");
  assert.ok(issues.find((i) => i.code === "unknown-type"));
});

test("validateCC catches period + capitalized subject + length", () => {
  const longSubject = "feat: " + "x".repeat(80) + ".";
  const issues = cc.validateCC(longSubject);
  assert.ok(issues.find((i) => i.code === "subject-length"), "length");
  assert.ok(issues.find((i) => i.code === "subject-period"), "period");
});

test("validateCC missing blank line after header", () => {
  const text = "feat: x\nbody on next line";
  const issues = cc.validateCC(text);
  assert.ok(issues.find((i) => i.code === "missing-blank"));
});

test("validateCC clean passes with no issues", () => {
  const issues = cc.validateCC("fix(parser): handle leading whitespace");
  assert.deepStrictEqual(issues, []);
});

test("formatCC roundtrips through parseCC", () => {
  const msg = cc.formatCC({
    type: "feat",
    scope: "log",
    breaking: true,
    subject: "filters",
    body: "Adds five inputs.",
    breakingDescription: "log.allBranches now defaults to true",
  });
  assert.match(msg, /^feat\(log\)!: filters\n\nAdds five inputs\.\n\nBREAKING-CHANGE: log\.allBranches/);
  const reparsed = cc.parseCC(msg);
  assert.strictEqual(reparsed.type, "feat");
  assert.strictEqual(reparsed.scope, "log");
  assert.strictEqual(reparsed.breaking, true);
  assert.strictEqual(reparsed.subject, "filters");
  assert.strictEqual(reparsed.body, "Adds five inputs.");
});

test("parseCC scope with hyphens and slashes", () => {
  const p = cc.parseCC("fix(my-pkg/inner): handle null");
  assert.strictEqual(p.scope, "my-pkg/inner");
});

console.log("Conventional Commits tests:");
await runAll();
