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
});
amendEl.addEventListener("change", () => {
  commitBtn.disabled = false;
});

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
