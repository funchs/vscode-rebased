export {};
declare const acquireVsCodeApi: <T>() => {
  postMessage: (msg: unknown) => void;
};

interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string[];
}
interface FilePatch {
  fileHeader: string[];
  hunks: Hunk[];
}

const vscode = acquireVsCodeApi<unknown>();
const unstagedEl = document.getElementById("unstaged") as HTMLDivElement;
const stagedEl = document.getElementById("staged") as HTMLDivElement;

let unstagedSel = new Set<number>();
let stagedSel = new Set<number>();

function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function lineClass(line: string): string {
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  if (line.startsWith("@@")) return "hunk-header";
  return "context";
}

function renderPatch(host: HTMLElement, patch: FilePatch, sel: Set<number>) {
  clear(host);
  if (!patch.hunks.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No hunks.";
    host.appendChild(e);
    return;
  }
  patch.hunks.forEach((h, idx) => {
    const card = document.createElement("div");
    card.className = "hunk";
    const head = document.createElement("div");
    head.className = "head";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = sel.has(idx);
    cb.addEventListener("change", () => {
      if (cb.checked) sel.add(idx);
      else sel.delete(idx);
    });
    const label = document.createElement("span");
    label.className = "header-text";
    label.textContent = h.header;
    head.appendChild(cb);
    head.appendChild(label);
    card.appendChild(head);
    const body = document.createElement("pre");
    body.className = "body";
    for (const line of h.body) {
      const ln = document.createElement("div");
      ln.className = lineClass(line);
      ln.textContent = line || " ";
      body.appendChild(ln);
    }
    card.appendChild(body);
    host.appendChild(card);
  });
}

document.getElementById("stage-selected")!.addEventListener("click", () => {
  vscode.postMessage({ type: "stage", selected: [...unstagedSel] });
  unstagedSel.clear();
});
document.getElementById("unstage-selected")!.addEventListener("click", () => {
  vscode.postMessage({ type: "unstage", selected: [...stagedSel] });
  stagedSel.clear();
});

window.addEventListener("message", (e) => {
  const m = e.data;
  if (m.type === "diff") {
    unstagedSel = new Set();
    stagedSel = new Set();
    renderPatch(unstagedEl, m.unstaged, unstagedSel);
    renderPatch(stagedEl, m.staged, stagedSel);
  }
});

vscode.postMessage({ type: "ready" });
