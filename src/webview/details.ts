export {};
declare const acquireVsCodeApi: <T>() => {
  postMessage: (msg: unknown) => void;
  getState: <S>() => S | undefined;
  setState: <S>(state: S) => void;
};
declare global {
  interface Window {
    __rebasedL10n?: Record<string, string>;
  }
}
const L = window.__rebasedL10n ?? {};
const t = (key: string, fallback: string, ...args: string[]): string => {
  let s = L[key] ?? fallback;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
  return s;
};

interface CommitFile {
  path: string;
  oldPath?: string;
  status: string;
  additions: number;
  deletions: number;
}
interface CommitDetail {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  authorDate: number;
  committer: string;
  committerDate: number;
  subject: string;
  body: string;
  refs: string[];
  files: CommitFile[];
}

interface UiState {
  view?: "tree" | "flat";
  collapsed?: string[];
}

const vscode = acquireVsCodeApi<UiState>();
const root = document.getElementById("root") as HTMLDivElement;

const initial = vscode.getState<UiState>() ?? {};
let viewMode: "tree" | "flat" = initial.view ?? "tree";
const collapsedKeys = new Set<string>(initial.collapsed ?? []);
let lastDetail: CommitDetail | undefined;

function persist() {
  vscode.setState({ view: viewMode, collapsed: [...collapsedKeys] });
}

function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function statusBadge(s: string): { text: string; cls: string } {
  switch (s) {
    case "A": return { text: "A", cls: "added" };
    case "M": return { text: "M", cls: "modified" };
    case "D": return { text: "D", cls: "deleted" };
    case "R": return { text: "R", cls: "renamed" };
    case "C": return { text: "C", cls: "copied" };
    default: return { text: s, cls: "modified" };
  }
}

interface DirNode {
  kind: "dir";
  name: string;
  fullKey: string;
  children: TreeNode[];
  fileCount: number;
}
interface FileNode {
  kind: "file";
  name: string;
  file: CommitFile;
}
type TreeNode = DirNode | FileNode;

function buildTree(files: CommitFile[]): DirNode {
  const r: DirNode = { kind: "dir", name: "", fullKey: "", children: [], fileCount: 0 };
  for (const f of files) {
    const parts = f.path.split("/");
    let cursor = r;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = cursor.children.find((c) => c.kind === "dir" && c.name === seg) as DirNode | undefined;
      if (!next) {
        next = { kind: "dir", name: seg, fullKey: parts.slice(0, i + 1).join("/"), children: [], fileCount: 0 };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({ kind: "file", name: parts[parts.length - 1], file: f });
  }
  countFiles(r);
  return compact(r) as DirNode;
}

function countFiles(d: DirNode): number {
  let n = 0;
  for (const c of d.children) {
    if (c.kind === "file") n += 1;
    else n += countFiles(c);
  }
  d.fileCount = n;
  return n;
}

// Collapse single-child dir chains into one row. The result has its name joined with "/" so
// "platform-impl > src > com > intellij" renders as "platform-impl/src/com/intellij".
function compact(node: TreeNode): TreeNode {
  if (node.kind === "file") return node;
  // Recurse first.
  node.children = node.children.map(compact);
  // Sort: dirs before files, alphabetical within group.
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  // Collapse only when this dir has exactly one child that is also a dir.
  // Don't collapse the synthetic root (name === "").
  if (node.name !== "" && node.children.length === 1 && node.children[0].kind === "dir") {
    const only = node.children[0];
    return {
      kind: "dir",
      name: `${node.name}/${only.name}`,
      fullKey: only.fullKey,
      children: only.children,
      fileCount: only.fileCount,
    };
  }
  return node;
}

function chevron(open: boolean): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", `chev ${open ? "open" : ""}`);
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M5 3 L11 8 L5 13");
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.5");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.appendChild(p);
  return svg;
}

function folderIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "ficon");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M1.5 3.5h4l1.5 1.5h7.5v8h-13z");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("opacity", "0.65");
  svg.appendChild(p);
  return svg;
}

function fileIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "ficon");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M3 1.5h7l3 3v10h-10z");
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.1");
  p.setAttribute("opacity", "0.65");
  svg.appendChild(p);
  return svg;
}

function renderFlat(container: HTMLElement, files: CommitFile[]) {
  const list = el("ul", "filelist");
  for (const f of files) {
    const li = el("li", "row file-row");
    li.style.paddingLeft = "8px";
    const badge = statusBadge(f.status);
    li.appendChild(el("span", `badge ${badge.cls}`, badge.text));
    const path = el("span", "path");
    if (f.oldPath) path.appendChild(el("span", "old-path", `${f.oldPath} → `));
    path.appendChild(document.createTextNode(f.path));
    path.title = f.path;
    li.appendChild(path);
    const stat = el("span", "file-stats");
    if (f.additions) stat.appendChild(el("span", "additions", `+${f.additions}`));
    if (f.deletions) stat.appendChild(el("span", "deletions", `−${f.deletions}`));
    li.appendChild(stat);
    li.onclick = () => vscode.postMessage({ type: "openDiff", path: f.path });
    list.appendChild(li);
  }
  container.appendChild(list);
}

function renderTree(container: HTMLElement, tree: DirNode) {
  const list = el("ul", "filelist tree");
  const render = (n: TreeNode, depth: number, parentKey: string) => {
    if (n.kind === "dir") {
      const key = `${parentKey}/${n.name}`;
      const open = !collapsedKeys.has(key);
      const li = el("li", "row dir-row");
      li.style.paddingLeft = `${8 + depth * 14}px`;
      li.appendChild(chevron(open));
      li.appendChild(folderIcon());
      li.appendChild(el("span", "dir-name", n.name));
      const cnt = el("span", "dir-count", t("nFiles", "{0} files", String(n.fileCount)));
      li.appendChild(cnt);
      li.onclick = () => {
        if (open) collapsedKeys.add(key);
        else collapsedKeys.delete(key);
        persist();
        renderAll();
      };
      list.appendChild(li);
      if (open) {
        for (const c of n.children) render(c, depth + 1, key);
      }
    } else {
      const li = el("li", "row file-row");
      li.style.paddingLeft = `${8 + depth * 14 + 12}px`;
      const badge = statusBadge(n.file.status);
      li.appendChild(el("span", `badge ${badge.cls}`, badge.text));
      li.appendChild(fileIcon());
      const name = el("span", "file-name");
      if (n.file.oldPath) {
        const oldName = n.file.oldPath.split("/").pop() ?? n.file.oldPath;
        name.appendChild(el("span", "old-path", `${oldName} → `));
      }
      name.appendChild(document.createTextNode(n.name));
      name.title = n.file.path;
      li.appendChild(name);
      const stat = el("span", "file-stats");
      if (n.file.additions) stat.appendChild(el("span", "additions", `+${n.file.additions}`));
      if (n.file.deletions) stat.appendChild(el("span", "deletions", `−${n.file.deletions}`));
      li.appendChild(stat);
      li.onclick = () => vscode.postMessage({ type: "openDiff", path: n.file.path });
      list.appendChild(li);
    }
  };
  for (const c of tree.children) render(c, 0, "");
  container.appendChild(list);
}

function renderAll() {
  if (!lastDetail) return;
  render(lastDetail);
}

function render(d: CommitDetail) {
  lastDetail = d;
  clear(root);

  const header = el("header", "header");
  const titleRow = el("div", "title-row");
  titleRow.appendChild(el("h1", "subject", d.subject));
  for (const ref of d.refs) {
    const chip = el("span", "ref");
    if (ref.startsWith("HEAD")) chip.classList.add("head");
    else if (ref.includes("/")) chip.classList.add("remote");
    chip.textContent = ref.replace(/^HEAD -> /, "");
    titleRow.appendChild(chip);
  }
  header.appendChild(titleRow);

  const meta = el("div", "meta");
  const hashLink = el("code", "hash-link");
  hashLink.textContent = d.hash;
  hashLink.title = t("copyHashTooltip", "Click to copy");
  hashLink.onclick = () => vscode.postMessage({ type: "copyHash" });
  meta.appendChild(hashLink);
  meta.appendChild(el("span", "dot", "·"));
  meta.appendChild(el("span", undefined, `${d.author} <${d.email}>`));
  meta.appendChild(el("span", "dot", "·"));
  meta.appendChild(el("span", "date", new Date(d.authorDate).toLocaleString()));
  if (d.parents.length > 0) {
    meta.appendChild(el("span", "dot", "·"));
    meta.appendChild(el("span", "parents", `${t("parents", "parents:")} ${d.parents.map((p) => p.slice(0, 7)).join(", ")}`));
  }
  header.appendChild(meta);

  const actions = el("div", "actions");
  const mkBtn = (label: string, type: string) => {
    const b = el("button", undefined, label);
    b.onclick = () => vscode.postMessage({ type });
    return b;
  };
  actions.appendChild(mkBtn(t("cherryPick", "Cherry-pick"), "cherryPick"));
  actions.appendChild(mkBtn(t("interactiveRebaseHere", "Interactive rebase here"), "interactiveRebase"));
  actions.appendChild(mkBtn(t("checkoutDetached", "Checkout (detached)"), "checkout"));
  header.appendChild(actions);

  root.appendChild(header);

  if (d.body) root.appendChild(el("pre", "body", d.body));

  const filesSection = el("section", "files");
  const h2 = el("h2");
  const title = el("span", undefined, t("filesCount", "Files ({0})", String(d.files.length)));
  h2.appendChild(title);
  const totalAdd = d.files.reduce((s, f) => s + f.additions, 0);
  const totalDel = d.files.reduce((s, f) => s + f.deletions, 0);
  const stats = el("span", "stats");
  stats.appendChild(el("span", "additions", `+${totalAdd}`));
  stats.appendChild(el("span", "deletions", `−${totalDel}`));
  h2.appendChild(stats);

  const toggle = el("span", "view-toggle");
  const mkToggleBtn = (label: string, mode: "tree" | "flat") => {
    const b = el("button", `toggle-btn ${viewMode === mode ? "active" : ""}`, label);
    b.onclick = () => {
      if (viewMode !== mode) {
        viewMode = mode;
        persist();
        renderAll();
      }
    };
    return b;
  };
  toggle.appendChild(mkToggleBtn(t("viewTree", "Tree"), "tree"));
  toggle.appendChild(mkToggleBtn(t("viewFlat", "Flat"), "flat"));
  h2.appendChild(toggle);
  filesSection.appendChild(h2);

  if (viewMode === "tree") renderTree(filesSection, buildTree(d.files));
  else renderFlat(filesSection, d.files);
  root.appendChild(filesSection);
}

window.addEventListener("message", (e) => {
  const m = e.data;
  if (m.type === "detail") render(m.detail);
});

vscode.postMessage({ type: "ready" });
