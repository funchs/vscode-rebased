export {};
declare const acquireVsCodeApi: <T>() => {
  postMessage: (msg: unknown) => void;
};

interface File {
  path: string;
  code: string;
}

const vscode = acquireVsCodeApi<unknown>();
const filesEl = document.getElementById("files") as HTMLUListElement;
const tpl = document.getElementById("row-tpl") as HTMLTemplateElement;
const emptyEl = document.getElementById("empty") as HTMLDivElement;
const banner = document.getElementById("state-banner") as HTMLDivElement;
const finalizeBtn = document.getElementById("finalize") as HTMLButtonElement;
const abortBtn = document.getElementById("abort") as HTMLButtonElement;
const resolveAllBtn = document.getElementById("resolve-all") as HTMLButtonElement;

function clearList(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function kindLabel(kind: string | null): string {
  switch (kind) {
    case "rebase": return "Rebase";
    case "merge": return "Merge";
    case "cherry-pick": return "Cherry-pick";
    case "revert": return "Revert";
    case "stash-pop": return "Stash pop";
    case "orphan-unmerged": return "Orphan unmerged";
    default: return "—";
  }
}

function render(state: { kind: string | null; files: File[]; flippedOurs: boolean }) {
  clearList(filesEl);
  if (!state.files.length) {
    emptyEl.style.display = "block";
    filesEl.style.display = "none";
    banner.textContent = `${kindLabel(state.kind)} · ready to finalize`;
    finalizeBtn.disabled = !state.kind && true;
    finalizeBtn.disabled = state.kind ? false : true;
  } else {
    emptyEl.style.display = "none";
    filesEl.style.display = "";
    banner.textContent = `${kindLabel(state.kind)} · ${state.files.length} conflict${state.files.length === 1 ? "" : "s"}`;
    finalizeBtn.disabled = true;
  }

  for (const f of state.files) {
    const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    const badge = node.querySelector(".badge") as HTMLSpanElement;
    const path = node.querySelector(".path") as HTMLSpanElement;
    const ours = node.querySelector(".ours") as HTMLButtonElement;
    const theirs = node.querySelector(".theirs") as HTMLButtonElement;
    const merge = node.querySelector(".merge") as HTMLButtonElement;
    const reset = node.querySelector(".reset") as HTMLButtonElement;

    badge.textContent = f.code;
    badge.classList.add(`code-${f.code}`);
    path.textContent = f.path;
    path.title = f.path;
    // Hover tooltip clarifies which side is which when rebase flips them.
    if (state.flippedOurs) {
      ours.title = "git checkout --theirs (rebase flips the semantics; this is YOUR branch's version)";
      theirs.title = "git checkout --ours (rebase flips the semantics; this is the upstream version)";
    } else {
      ours.title = "git checkout --ours";
      theirs.title = "git checkout --theirs";
    }
    ours.onclick = () => vscode.postMessage({ type: "useOurs", path: f.path });
    theirs.onclick = () => vscode.postMessage({ type: "useTheirs", path: f.path });
    merge.onclick = () => vscode.postMessage({ type: "openMerge", path: f.path });
    reset.onclick = () => vscode.postMessage({ type: "reset", path: f.path });

    filesEl.appendChild(node);
  }
}

resolveAllBtn.addEventListener("click", () => vscode.postMessage({ type: "resolveAll" }));
abortBtn.addEventListener("click", () => vscode.postMessage({ type: "abort" }));
finalizeBtn.addEventListener("click", () => vscode.postMessage({ type: "finalize" }));

window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "state") {
    render(m);
  }
});

vscode.postMessage({ type: "ready" });
