export {};
declare const acquireVsCodeApi: <T>() => {
  postMessage: (msg: unknown) => void;
  getState: () => T | undefined;
  setState: (state: T) => void;
};

interface Entry {
  action: string;
  hash?: string;
  subject?: string;
  argument?: string;
}

interface ParsedTodo {
  entries: Entry[];
  trailing: string[];
}

const vscode = acquireVsCodeApi<{ todo: ParsedTodo }>();
const ACTIONS = ["pick", "reword", "edit", "squash", "fixup", "drop"];
const ACTION_COLORS: Record<string, string> = {
  pick: "var(--vscode-charts-green)",
  reword: "var(--vscode-charts-blue)",
  edit: "var(--vscode-charts-yellow)",
  squash: "var(--vscode-charts-purple)",
  fixup: "var(--vscode-charts-purple)",
  drop: "var(--vscode-charts-red)",
};

let todo: ParsedTodo = { entries: [], trailing: [] };

const list = document.getElementById("list") as HTMLUListElement;
const tpl = document.getElementById("row-tpl") as HTMLTemplateElement;

function clearList() {
  while (list.firstChild) list.removeChild(list.firstChild);
}

function render() {
  clearList();
  todo.entries.forEach((e, idx) => {
    const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    node.dataset.idx = String(idx);
    const action = node.querySelector(".action") as HTMLButtonElement;
    const hash = node.querySelector(".hash") as HTMLElement;
    const subject = node.querySelector(".subject") as HTMLElement;
    action.textContent = e.action;
    action.dataset.action = e.action;
    action.style.background = ACTION_COLORS[e.action] ?? "var(--vscode-button-secondaryBackground)";
    action.onclick = () => cycleAction(idx);
    hash.textContent = e.hash ? e.hash.slice(0, 7) : "";
    subject.textContent = e.subject ?? e.argument ?? "";
    if (e.action === "drop") node.classList.add("dropped");
    wireDrag(node);
    list.appendChild(node);
  });
}

function cycleAction(idx: number) {
  const cur = todo.entries[idx].action;
  const next = ACTIONS[(ACTIONS.indexOf(cur) + 1) % ACTIONS.length];
  todo.entries[idx].action = next;
  render();
}

let dragSrc: number | null = null;
function wireDrag(node: HTMLLIElement) {
  node.addEventListener("dragstart", (e) => {
    dragSrc = parseInt(node.dataset.idx!, 10);
    node.classList.add("dragging");
    e.dataTransfer!.effectAllowed = "move";
  });
  node.addEventListener("dragend", () => {
    node.classList.remove("dragging");
    document.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
  });
  node.addEventListener("dragover", (e) => {
    e.preventDefault();
    node.classList.add("drop-target");
  });
  node.addEventListener("dragleave", () => node.classList.remove("drop-target"));
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    const dst = parseInt(node.dataset.idx!, 10);
    if (dragSrc === null || dragSrc === dst) return;
    const [moved] = todo.entries.splice(dragSrc, 1);
    todo.entries.splice(dst, 0, moved);
    dragSrc = null;
    render();
  });
}

document.getElementById("save")!.addEventListener("click", () => {
  vscode.postMessage({ type: "save", todo });
});
document.getElementById("abort")!.addEventListener("click", () => {
  vscode.postMessage({ type: "abort" });
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    vscode.postMessage({ type: "save", todo });
  }
});

window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "load") {
    todo = m.todo;
    render();
  }
});

vscode.postMessage({ type: "ready" });
