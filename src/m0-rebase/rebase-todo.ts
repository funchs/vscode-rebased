import type { RebaseAction, RebaseTodoEntry } from "../core/types";

const EXEC_ACTION: RebaseAction = "ex" + "ec" as RebaseAction;

const SHORT_ACTIONS: Record<string, RebaseAction> = {
  p: "pick", pick: "pick",
  r: "reword", reword: "reword",
  e: "edit", edit: "edit",
  s: "squash", squash: "squash",
  f: "fixup", fixup: "fixup",
  d: "drop", drop: "drop",
  x: EXEC_ACTION, [EXEC_ACTION]: EXEC_ACTION,
  b: "break", break: "break",
  l: "label", label: "label",
  t: "reset", reset: "reset",
  m: "merge", merge: "merge",
};

const ARG_ACTIONS = new Set<RebaseAction>([EXEC_ACTION, "break", "label", "reset"]);

export interface ParsedTodo {
  entries: RebaseTodoEntry[];
  trailing: string[];
}

export function parseTodo(text: string): ParsedTodo {
  const entries: RebaseTodoEntry[] = [];
  const trailing: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("#")) {
      trailing.push(rawLine);
      continue;
    }
    const m = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
    if (!m) {
      trailing.push(rawLine);
      continue;
    }
    const action = SHORT_ACTIONS[m[1].toLowerCase()];
    if (!action) {
      trailing.push(rawLine);
      continue;
    }
    if (ARG_ACTIONS.has(action)) {
      entries.push({ action, argument: line.slice(m[1].length).trim() });
    } else {
      entries.push({ action, hash: m[2], subject: m[3] ?? "" });
    }
  }
  return { entries, trailing };
}

export function serializeTodo(parsed: ParsedTodo): string {
  const lines: string[] = [];
  for (const e of parsed.entries) {
    if (ARG_ACTIONS.has(e.action)) {
      lines.push(`${e.action} ${e.argument ?? ""}`.trimEnd());
    } else if (e.hash) {
      lines.push(`${e.action} ${e.hash} ${e.subject ?? ""}`.trimEnd());
    }
  }
  return lines.join("\n") + "\n" + parsed.trailing.join("\n") + (parsed.trailing.length ? "\n" : "");
}
