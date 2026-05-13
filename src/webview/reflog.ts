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

interface Entry {
  ref: string;
  hash: string;
  subject: string;
  date: number;
}

const vscode = acquireVsCodeApi<unknown>();
const list = document.getElementById("list") as HTMLDivElement;

function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let menu: HTMLDivElement | null = null;
function showMenu(x: number, y: number, e: Entry) {
  hideMenu();
  menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const items: Array<[string, () => void]> = [
    [t("menuCheckout", "Checkout {0}", e.hash.slice(0, 7)), () => vscode.postMessage({ type: "checkout", hash: e.hash })],
    [t("menuReset", "Reset HEAD to {0}…", e.hash.slice(0, 7)), () => vscode.postMessage({ type: "reset", hash: e.hash })],
    [t("menuCherryPick", "Cherry-pick {0}", e.hash.slice(0, 7)), () => vscode.postMessage({ type: "cherryPick", hash: e.hash })],
  ];
  for (const [label, fn] of items) {
    const it = document.createElement("div");
    it.className = "ctx-item";
    it.textContent = label;
    it.onclick = () => { fn(); hideMenu(); };
    menu.appendChild(it);
  }
  document.body.appendChild(menu);
}
function hideMenu() {
  if (menu) { menu.remove(); menu = null; }
}
document.addEventListener("click", hideMenu);

function render(entries: Entry[]) {
  clear(list);
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "row";
    const ref = document.createElement("code");
    ref.className = "ref";
    ref.textContent = e.ref;
    const short = document.createElement("code");
    short.className = "hash";
    short.textContent = e.hash.slice(0, 7);
    const subject = document.createElement("span");
    subject.className = "subject";
    subject.textContent = e.subject;
    const date = document.createElement("span");
    date.className = "date";
    date.textContent = new Date(e.date).toLocaleString();
    row.appendChild(ref);
    row.appendChild(short);
    row.appendChild(subject);
    row.appendChild(date);
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      showMenu(ev.clientX, ev.clientY, e);
    });
    list.appendChild(row);
  }
}

window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "reflog") render(m.entries);
});

vscode.postMessage({ type: "ready" });
