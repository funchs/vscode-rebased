export {};
declare const acquireVsCodeApi: <T>() => {
  postMessage: (msg: unknown) => void;
};

interface FileChange {
  path: string;
  staged: boolean;
  status: string;
  oldPath?: string;
}

const vscode = acquireVsCodeApi<unknown>();

// --- Conventional Commits live validator ------------------------------------
const CC_TYPES = ["feat","fix","docs","style","refactor","perf","test","build","ci","chore","revert"];
const HEADER_RE = /^([a-zA-Z][a-zA-Z0-9_-]*)(?:\(([^)]+)\))?(!)?:[ \t]+(.+)$/;

function validateCC(text: string): { type?: string; scope?: string; bang?: boolean; subject?: string; issues: { sev: string; msg: string }[] } {
  const issues: { sev: string; msg: string }[] = [];
  if (!text.trim()) return { issues: [] };
  const first = text.split("\n", 1)[0];
  const m = first.match(HEADER_RE);
  if (!m) {
    issues.push({ sev: "error", msg: "Header must be type(scope)?[!]: subject" });
    return { issues };
  }
  const [, type, scope, bang, subject] = m;
  const out = { type, scope, bang: !!bang, subject, issues };
  if (!CC_TYPES.includes(type.toLowerCase())) {
    issues.push({ sev: "warn", msg: `Unknown type "${type}"` });
  }
  if (type !== type.toLowerCase()) issues.push({ sev: "warn", msg: "Type should be lowercase" });
  if (first.length > 72) issues.push({ sev: "warn", msg: `${first.length} chars (recommended ≤ 72)` });
  if (/\.\s*$/.test(subject)) issues.push({ sev: "warn", msg: "No period at end" });
  if (subject[0] && subject[0] !== subject[0].toLowerCase()) issues.push({ sev: "warn", msg: "Lowercase subject" });
  const lines = text.split("\n");
  if (lines.length > 1 && lines[1].trim() !== "") {
    issues.push({ sev: "warn", msg: "Blank line after header" });
  }
  return out;
}

const stagedEl = document.getElementById("staged") as HTMLUListElement;
const changesEl = document.getElementById("changes") as HTMLUListElement;
const stagedCount = document.getElementById("staged-count") as HTMLSpanElement;
const changesCount = document.getElementById("changes-count") as HTMLSpanElement;
const msgEl = document.getElementById("msg") as HTMLTextAreaElement;
const amendEl = document.getElementById("amend") as HTMLInputElement;
const commitBtn = document.getElementById("commit") as HTMLButtonElement;
const emptyEl = document.getElementById("empty") as HTMLDivElement;
const appEl = document.getElementById("app") as HTMLDivElement;

function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function statusBadge(s: string): string {
  switch (s) {
    case "M": return "M";
    case "A": return "+";
    case "D": return "−";
    case "R": return "R";
    case "?": return "U";
    default: return s;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case "M": return "var(--vscode-gitDecoration-modifiedResourceForeground)";
    case "A": case "?": return "var(--vscode-gitDecoration-addedResourceForeground)";
    case "D": return "var(--vscode-gitDecoration-deletedResourceForeground)";
    case "R": return "var(--vscode-gitDecoration-renamedResourceForeground)";
    default: return "var(--vscode-foreground)";
  }
}

function row(f: FileChange, action: "stage" | "unstage"): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "file";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = statusBadge(f.status);
  badge.style.color = statusColor(f.status);

  const path = document.createElement("span");
  path.className = "path";
  path.textContent = f.path;
  path.title = f.path;
  path.onclick = () => vscode.postMessage({ type: "diff", path: f.path });

  const hunks = document.createElement("button");
  hunks.className = "ghost";
  hunks.textContent = "↹";
  hunks.title = "Stage individual hunks";
  hunks.onclick = (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: "hunks", path: f.path });
  };

  const btn = document.createElement("button");
  btn.className = "ghost";
  btn.textContent = action === "stage" ? "+" : "−";
  btn.title = action === "stage" ? "Stage" : "Unstage";
  btn.onclick = (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: action, paths: [f.path] });
  };

  li.appendChild(badge);
  li.appendChild(path);
  li.appendChild(hunks);
  li.appendChild(btn);
  return li;
}

function render(files: FileChange[]) {
  clear(stagedEl);
  clear(changesEl);
  const staged = files.filter((f) => f.staged);
  const changes = files.filter((f) => !f.staged);
  stagedCount.textContent = String(staged.length);
  changesCount.textContent = String(changes.length);
  for (const f of staged) stagedEl.appendChild(row(f, "unstage"));
  for (const f of changes) changesEl.appendChild(row(f, "stage"));
  commitBtn.disabled = staged.length === 0 && !amendEl.checked;
}

commitBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "commit", message: msgEl.value, amend: amendEl.checked });
  msgEl.value = "";
  amendEl.checked = false;
  updateCC();
});
amendEl.addEventListener("change", () => {
  commitBtn.disabled = false;
});

const badgesEl = document.getElementById("cc-badges") as HTMLSpanElement;
const ccStatus = document.getElementById("cc-status") as HTMLDivElement;
const wizardBtn = document.getElementById("wizard") as HTMLButtonElement;
wizardBtn.textContent = "Wizard…";
wizardBtn.addEventListener("click", () => vscode.postMessage({ type: "wizard" }));

function clearChildren(el: HTMLElement) { while (el.firstChild) el.removeChild(el.firstChild); }

function updateCC() {
  const r = validateCC(msgEl.value);
  clearChildren(badgesEl);
  if (r.type) {
    const chip = document.createElement("span");
    chip.className = `cc-chip cc-type-${r.type.toLowerCase()}`;
    chip.textContent = r.type;
    badgesEl.appendChild(chip);
  }
  if (r.scope) {
    const chip = document.createElement("span");
    chip.className = "cc-chip cc-scope";
    chip.textContent = r.scope;
    badgesEl.appendChild(chip);
  }
  if (r.bang) {
    const chip = document.createElement("span");
    chip.className = "cc-chip cc-breaking";
    chip.textContent = "BREAKING";
    badgesEl.appendChild(chip);
  }
  clearChildren(ccStatus);
  if (!msgEl.value.trim()) { ccStatus.style.display = "none"; return; }
  ccStatus.style.display = "block";
  if (!r.issues.length) {
    ccStatus.className = "cc-status ok";
    ccStatus.textContent = "✓ Conventional Commit";
    return;
  }
  const hasError = r.issues.some((i) => i.sev === "error");
  ccStatus.className = "cc-status " + (hasError ? "error" : "warn");
  ccStatus.textContent = (hasError ? "✕ " : "⚠ ") + r.issues.map((i) => i.msg).join(" · ");
}
msgEl.addEventListener("input", updateCC);
updateCC();

window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "status") {
    emptyEl.style.display = "none";
    appEl.style.display = "";
    render(m.files);
  } else if (m.type === "empty") {
    emptyEl.style.display = "block";
    appEl.style.display = "none";
  }
});

vscode.postMessage({ type: "ready" });
