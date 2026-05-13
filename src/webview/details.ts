export {};
declare const acquireVsCodeApi: <T>() => {
  postMessage: (msg: unknown) => void;
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

const vscode = acquireVsCodeApi<unknown>();
const root = document.getElementById("root") as HTMLDivElement;

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

function render(d: CommitDetail) {
  clear(root);

  // Header
  const header = el("header", "header");
  const titleRow = el("div", "title-row");
  const subject = el("h1", "subject", d.subject);
  titleRow.appendChild(subject);
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
    const parentsLabel = t("parents", "parents:");
    const parents = el("span", "parents", `${parentsLabel} ${d.parents.map((p) => p.slice(0, 7)).join(", ")}`);
    meta.appendChild(parents);
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

  // Body
  if (d.body) {
    const pre = el("pre", "body", d.body);
    root.appendChild(pre);
  }

  // Files
  const filesSection = el("section", "files");
  const h2 = el("h2", undefined, t("filesCount", "Files ({0})", String(d.files.length)));
  const stats = el("span", "stats");
  const totalAdd = d.files.reduce((s, f) => s + f.additions, 0);
  const totalDel = d.files.reduce((s, f) => s + f.deletions, 0);
  const a = el("span", "additions", `+${totalAdd}`);
  const r = el("span", "deletions", `−${totalDel}`);
  stats.appendChild(a);
  stats.appendChild(r);
  h2.appendChild(stats);
  filesSection.appendChild(h2);

  const list = el("ul", "filelist");
  for (const f of d.files) {
    const li = el("li", "file");
    const badge = statusBadge(f.status);
    const b = el("span", `badge ${badge.cls}`, badge.text);
    li.appendChild(b);
    const path = el("span", "path");
    if (f.oldPath) {
      path.appendChild(el("span", "old-path", `${f.oldPath} → `));
    }
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
  filesSection.appendChild(list);
  root.appendChild(filesSection);
}

window.addEventListener("message", (e) => {
  const m = e.data;
  if (m.type === "detail") render(m.detail);
});

vscode.postMessage({ type: "ready" });
