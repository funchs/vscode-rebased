// Conventional Commits 1.0.0 parser + validator.
// https://www.conventionalcommits.org/en/v1.0.0/
//
// Format:
//   <type>[optional scope][!]: <description>
//
//   [optional body]
//
//   [optional footer(s)]
//
// Footers are RFC822-ish "Token: value" lines, with the special tokens
// "BREAKING CHANGE" / "BREAKING-CHANGE" indicating breaking changes.

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;
export type CommitType = (typeof COMMIT_TYPES)[number];

export interface ParsedCC {
  type?: string;
  scope?: string;
  breaking: boolean;
  subject?: string;
  body?: string;
  footers: Array<{ token: string; value: string }>;
  // Indexes within the original string so a UI can highlight.
  ranges: {
    type?: [number, number];
    scope?: [number, number];
    bang?: [number, number];
    subject?: [number, number];
  };
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

const HEADER_REGEX = /^([a-zA-Z][a-zA-Z0-9_-]*)(?:\(([^)]+)\))?(!)?:[ \t]+(.+)$/;

export function parseCC(text: string): ParsedCC {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const header = lines[0] ?? "";
  const m = header.match(HEADER_REGEX);
  const parsed: ParsedCC = {
    breaking: false,
    footers: [],
    ranges: {},
  };

  if (m) {
    const [, type, scope, bang, subject] = m;
    parsed.type = type;
    parsed.scope = scope || undefined;
    parsed.breaking = !!bang;
    parsed.subject = subject;

    let idx = 0;
    parsed.ranges.type = [idx, idx + type.length];
    idx += type.length;
    if (scope) {
      const open = idx + 1; // skip "("
      parsed.ranges.scope = [open, open + scope.length];
      idx += scope.length + 2; // "(...)"
    }
    if (bang) {
      parsed.ranges.bang = [idx, idx + 1];
      idx += 1;
    }
    idx += 2; // ": "
    parsed.ranges.subject = [idx, idx + subject.length];
  }

  // Body + footers — body is everything after the first blank line until footers start.
  // Footers are trailing "Token: value" lines (RFC822-style) at the end.
  const tail = lines.slice(1);
  // Strip leading blank line if present (it's the separator).
  while (tail.length && tail[0].trim() === "") tail.shift();

  // Find the start of footer block by scanning from the bottom.
  let footerStart = tail.length;
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i];
    if (line.trim() === "") continue;
    if (/^(BREAKING[ -]CHANGE|[A-Za-z0-9_-]+)(:\s|\s#)/.test(line)) {
      footerStart = i;
    } else {
      break;
    }
  }

  const bodyLines: string[] = [];
  for (let i = 0; i < footerStart; i++) bodyLines.push(tail[i]);
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();
  if (bodyLines.length) parsed.body = bodyLines.join("\n");

  for (let i = footerStart; i < tail.length; i++) {
    const line = tail[i];
    const fm = line.match(/^(BREAKING[ -]CHANGE|[A-Za-z0-9_-]+)(?::\s+|\s+#)(.+)$/);
    if (!fm) continue;
    const token = fm[1].replace(/^BREAKING /, "BREAKING-");
    parsed.footers.push({ token, value: fm[2] });
    if (token === "BREAKING-CHANGE") parsed.breaking = true;
  }
  return parsed;
}

export function validateCC(text: string, options?: { knownTypes?: readonly string[]; maxSubjectLength?: number }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!text.trim()) {
    issues.push({ severity: "error", code: "empty", message: "Commit message is empty." });
    return issues;
  }
  const firstLine = text.split("\n", 1)[0];
  const m = firstLine.match(HEADER_REGEX);
  if (!m) {
    issues.push({
      severity: "error",
      code: "format",
      message: 'Header must be "<type>[(<scope>)][!]: <description>".',
    });
    return issues;
  }
  const [, type, , , subject] = m;
  const known = options?.knownTypes ?? COMMIT_TYPES;
  if (!known.includes(type.toLowerCase() as CommitType)) {
    issues.push({
      severity: "warning",
      code: "unknown-type",
      message: `Unknown type "${type}". Known: ${known.join(", ")}`,
    });
  }
  if (type !== type.toLowerCase()) {
    issues.push({ severity: "warning", code: "case", message: "Type should be lowercase." });
  }
  const max = options?.maxSubjectLength ?? 72;
  if (firstLine.length > max) {
    issues.push({
      severity: "warning",
      code: "subject-length",
      message: `Header is ${firstLine.length} chars (recommended ≤ ${max}).`,
    });
  }
  if (/\.\s*$/.test(subject)) {
    issues.push({ severity: "warning", code: "subject-period", message: "Subject should not end with a period." });
  }
  if (subject[0] && subject[0] !== subject[0].toLowerCase()) {
    issues.push({ severity: "warning", code: "subject-case", message: "Subject should start lowercase." });
  }

  // Body lines should be separated from header by blank line.
  const lines = text.split("\n");
  if (lines.length > 1 && lines[1].trim() !== "") {
    issues.push({
      severity: "warning",
      code: "missing-blank",
      message: "Body must be separated from header by a blank line.",
    });
  }
  return issues;
}

export function formatCC(input: {
  type: string;
  scope?: string;
  breaking?: boolean;
  subject: string;
  body?: string;
  breakingDescription?: string;
  footers?: Array<{ token: string; value: string }>;
}): string {
  let header = input.type;
  if (input.scope) header += `(${input.scope})`;
  if (input.breaking) header += "!";
  header += `: ${input.subject}`;

  const parts = [header];
  if (input.body?.trim()) parts.push("", input.body.trim());
  const footers = [...(input.footers ?? [])];
  if (input.breaking && input.breakingDescription?.trim()) {
    footers.push({ token: "BREAKING-CHANGE", value: input.breakingDescription.trim() });
  }
  if (footers.length) {
    parts.push("", footers.map((f) => `${f.token}: ${f.value}`).join("\n"));
  }
  return parts.join("\n");
}
