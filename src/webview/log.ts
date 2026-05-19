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

interface Row {
  hash: string;
  short: string;
  author: string;
  date: number;
  subject: string;
  refs: string[];
  lane: number;
  parentLanes: number[];
  active: number[];
}

const vscode = acquireVsCodeApi<unknown>();

// Toolbar wiring -------------------------------------------------------------
const qMessage     = document.getElementById("q-message") as HTMLInputElement;
const qPath        = document.getElementById("q-path") as HTMLInputElement;
const qPathPick    = document.getElementById("q-path-pick") as HTMLButtonElement;
const qSince       = document.getElementById("q-since") as HTMLSelectElement;
const qSinceDate   = document.getElementById("q-since-date") as HTMLInputElement;
const qUntilDate   = document.getElementById("q-until-date") as HTMLInputElement;
const qHash        = document.getElementById("q-hash") as HTMLInputElement;
const clearBtn     = document.getElementById("clear") as HTMLButtonElement;
const statusEl     = document.getElementById("status") as HTMLDivElement;

// Multi-select widget shared by author + branch filters. Trigger button
// summarises the current selection; clicking opens a popover with a search
// box and checkbox list. Static head items (e.g. "Current branch (HEAD)")
// are added via setStaticItems before dynamic data arrives.
interface MSItem { value: string; label: string; }
class MultiSelect {
  private items: MSItem[] = [];
  private staticItems: MSItem[] = [];
  private selected = new Set<string>();
  private label: HTMLSpanElement;
  private trigger: HTMLButtonElement;
  private popover: HTMLDivElement;
  private listEl: HTMLUListElement;
  private searchEl: HTMLInputElement;
  private resetEl: HTMLButtonElement;

  constructor(
    host: HTMLElement,
    private emptyLabel: string,
    private pluralLabel: string, // "{0} branches" — {0} replaced with count
    private onChange: () => void,
  ) {
    this.trigger = host.querySelector(".ms-trigger") as HTMLButtonElement;
    this.popover = host.querySelector(".ms-popover") as HTMLDivElement;
    this.listEl  = host.querySelector(".ms-list") as HTMLUListElement;
    this.searchEl = host.querySelector(".ms-search") as HTMLInputElement;
    this.resetEl  = host.querySelector(".ms-reset") as HTMLButtonElement;
    this.label   = host.querySelector(".ms-label") as HTMLSpanElement;

    this.trigger.onclick = (e) => { e.stopPropagation(); this.toggle(); };
    this.searchEl.oninput = () => this.renderList();
    this.resetEl.onclick = () => { this.selected.clear(); this.renderList(); this.updateTrigger(); onChange(); };
    document.addEventListener("click", (e) => {
      if (!host.contains(e.target as Node)) this.close();
    });
    this.updateTrigger();
  }

  setStaticItems(items: MSItem[]) { this.staticItems = items; this.renderList(); }
  setItems(items: MSItem[]) { this.items = items; this.renderList(); }
  values(): string[] { return [...this.selected]; }
  // For backend-driven setSelection (e.g. "Show in Log").
  setSelection(values: string[]) {
    this.selected = new Set(values);
    this.renderList();
    this.updateTrigger();
  }
  toggle() { this.popover.hidden ? this.open() : this.close(); }
  open() {
    this.popover.hidden = false;
    this.searchEl.value = "";
    this.searchEl.focus();
    this.renderList();
  }
  close() { this.popover.hidden = true; }
  private updateTrigger() {
    const n = this.selected.size;
    if (n === 0) this.label.textContent = this.emptyLabel;
    else if (n === 1) {
      const v = [...this.selected][0];
      const found = [...this.staticItems, ...this.items].find((i) => i.value === v);
      this.label.textContent = found ? found.label : v;
    } else this.label.textContent = this.pluralLabel.replace("{0}", String(n));
  }
  private renderList() {
    while (this.listEl.firstChild) this.listEl.removeChild(this.listEl.firstChild);
    const filter = this.searchEl.value.toLowerCase();
    const render = (it: MSItem, isStatic: boolean) => {
      if (filter && !it.label.toLowerCase().includes(filter)) return;
      const li = document.createElement("li");
      li.className = "ms-item" + (isStatic ? " ms-static" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.selected.has(it.value);
      cb.onchange = () => {
        if (cb.checked) this.selected.add(it.value);
        else this.selected.delete(it.value);
        this.updateTrigger();
        this.onChange();
      };
      const lbl = document.createElement("span");
      lbl.className = "ms-item-label";
      lbl.textContent = it.label;
      li.appendChild(cb);
      li.appendChild(lbl);
      li.onclick = (e) => { if (e.target !== cb) cb.click(); };
      this.listEl.appendChild(li);
    };
    for (const it of this.staticItems) render(it, true);
    if (this.staticItems.length && this.items.length) {
      const sep = document.createElement("li");
      sep.className = "ms-sep";
      this.listEl.appendChild(sep);
    }
    for (const it of this.items) render(it, false);
    if (!this.listEl.firstChild) {
      const li = document.createElement("li");
      li.className = "ms-empty";
      li.textContent = (window.__rebasedL10n?.msNoMatches ?? "No matches.");
      this.listEl.appendChild(li);
    }
  }
}

const msAuthorEl = document.getElementById("ms-author") as HTMLDivElement;
const msBranchEl = document.getElementById("ms-branch") as HTMLDivElement;
const msAuthor = new MultiSelect(
  msAuthorEl,
  msAuthorEl.dataset.empty ?? "All users",
  msAuthorEl.dataset.plural ?? "{0} users",
  () => emitFilter(),
);
const msBranch = new MultiSelect(
  msBranchEl,
  msBranchEl.dataset.empty ?? "All branches",
  msBranchEl.dataset.plural ?? "{0} branches",
  () => emitFilter(),
);
// Pre-populate branch widget with the "Current branch (HEAD)" sentinel that
// always appears even before the branches list arrives from the backend.
msBranch.setStaticItems([
  { value: "HEAD", label: (window.__rebasedL10n?.currentBranchHead ?? "Current branch (HEAD)") },
]);

function readDateFilter(): { since?: string; until?: string } {
  if (qSince.value === "__custom__") {
    return { since: qSinceDate.value || undefined, until: qUntilDate.value || undefined };
  }
  return { since: qSince.value || undefined };
}

let filterTimer: number | undefined;
function emitFilter() {
  clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => {
    const date = readDateFilter();
    const authors = msAuthor.values();
    const branches = msBranch.values();
    vscode.postMessage({
      type: "setFilter",
      filter: {
        message: qMessage.value.trim() || undefined,
        author:  authors.length === 0 ? undefined : authors.length === 1 ? authors[0] : authors,
        path:    qPath.value.trim() || undefined,
        branch:  branches.length === 0 ? undefined : branches.length === 1 ? branches[0] : branches,
        since:   date.since,
        until:   date.until,
        hash:    qHash.value.trim() || undefined,
      },
    });
  }, 220);
}
for (const el of [qMessage, qPath, qHash, qSinceDate, qUntilDate]) el.addEventListener("input", emitFilter);
qSince.addEventListener("change", emitFilter);

qPathPick.addEventListener("click", () => vscode.postMessage({ type: "pickPath" }));

// Show/hide from/until date pickers when "Custom range…" is picked.
qSince.addEventListener("change", () => {
  const custom = qSince.value === "__custom__";
  qSinceDate.hidden = !custom;
  qUntilDate.hidden = !custom;
  if (custom) qSinceDate.focus();
  else { qSinceDate.value = ""; qUntilDate.value = ""; }
});

clearBtn.addEventListener("click", () => {
  qMessage.value = qPath.value = qHash.value = "";
  qSinceDate.value = qUntilDate.value = "";
  qSince.value = "";
  qSinceDate.hidden = qUntilDate.hidden = true;
  msAuthor.setSelection([]);
  msBranch.setSelection([]);
  emitFilter();
});

const ROW_H = 26;
const LANE_W = 14;
const DOT_R = 4;
const OVERSCAN = 12; // rows above/below the viewport we still render
const COLORS = ["#6cb6ff", "#f47067", "#e3b341", "#7ee787", "#d2a8ff", "#ff9eb0", "#56d4dd", "#ffa657"];

let rows: Row[] = [];
let lanes = 1;
let graphWidth = LANE_W * 2;
let rafPending = false;

const logEl = document.getElementById("log") as HTMLDivElement;
const emptyEl = document.getElementById("empty") as HTMLDivElement;

const wrapper = document.createElement("div");
wrapper.className = "wrapper";
const spacer = document.createElement("div");
spacer.className = "spacer";
const visibleHost = document.createElement("div");
visibleHost.className = "visible";
const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.classList.add("graph");
wrapper.appendChild(spacer);
wrapper.appendChild(svg);
wrapper.appendChild(visibleHost);
logEl.appendChild(wrapper);

function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function laneColor(lane: number): string {
  return COLORS[lane % COLORS.length];
}

function computeLanes() {
  let max = 0;
  for (const r of rows) {
    if (r.lane > max) max = r.lane;
    for (const p of r.parentLanes) if (p > max) max = p;
    for (const a of r.active) if (a > max) max = a;
  }
  lanes = max + 1;
  graphWidth = lanes * LANE_W + LANE_W;
}

function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderVisible();
  });
}

function renderVisible() {
  if (!rows.length) {
    clear(svg);
    clear(visibleHost);
    return;
  }
  const scrollTop = logEl.scrollTop;
  const viewport = logEl.clientHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);

  // SVG: full virtual height, but only paint visible lines/dots in window.
  svg.setAttribute("width", String(graphWidth));
  svg.setAttribute("height", String(rows.length * ROW_H));
  clear(svg);
  for (let i = startIdx; i < endIdx; i++) {
    paintRowGraph(i);
  }

  // DOM rows
  clear(visibleHost);
  for (let i = startIdx; i < endIdx; i++) {
    visibleHost.appendChild(buildRowDom(i));
  }
}

function paintRowGraph(i: number) {
  const r = rows[i];
  const y = i * ROW_H + ROW_H / 2;
  const x = r.lane * LANE_W + LANE_W / 2;

  for (const lane of r.active) {
    if (lane === r.lane) continue;
    const tx = lane * LANE_W + LANE_W / 2;
    drawLine(tx, y - ROW_H / 2, tx, y + ROW_H / 2, laneColor(lane));
  }

  if (i + 1 < rows.length) {
    r.parentLanes.forEach((pl) => {
      const px = pl * LANE_W + LANE_W / 2;
      const ny = (i + 1) * ROW_H + ROW_H / 2;
      if (pl === r.lane) {
        drawLine(x, y, px, ny, laneColor(r.lane));
      } else {
        drawPath(x, y, px, ny, laneColor(pl));
      }
    });
  }

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", String(x));
  dot.setAttribute("cy", String(y));
  dot.setAttribute("r", String(DOT_R));
  dot.setAttribute("fill", laneColor(r.lane));
  dot.setAttribute("stroke", "var(--vscode-editor-background)");
  dot.setAttribute("stroke-width", "1.5");
  svg.appendChild(dot);
}

function buildRowDom(i: number): HTMLDivElement {
  const r = rows[i];
  const rowEl = document.createElement("div");
  rowEl.className = "row";
  rowEl.style.top = `${i * ROW_H}px`;
  rowEl.style.paddingLeft = `${graphWidth + 6}px`;

  for (const ref of r.refs) {
    const chip = document.createElement("span");
    chip.className = "ref";
    if (ref.startsWith("HEAD")) chip.classList.add("head");
    else if (ref.includes("/")) chip.classList.add("remote");
    chip.textContent = ref.replace(/^HEAD -> /, "");
    rowEl.appendChild(chip);
  }

  const subject = document.createElement("span");
  subject.className = "subject";
  subject.textContent = r.subject;
  rowEl.appendChild(subject);

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = r.author;
  rowEl.appendChild(author);

  const date = document.createElement("span");
  date.className = "date";
  date.textContent = new Date(r.date).toLocaleDateString();
  rowEl.appendChild(date);

  const short = document.createElement("code");
  short.className = "hash";
  short.textContent = r.short;
  rowEl.appendChild(short);

  rowEl.addEventListener("click", () => {
    vscode.postMessage({ type: "showCommit", hash: r.hash });
  });
  rowEl.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY, r);
  });
  return rowEl;
}

function drawLine(x1: number, y1: number, x2: number, y2: number, color: string) {
  const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l.setAttribute("x1", String(x1));
  l.setAttribute("y1", String(y1));
  l.setAttribute("x2", String(x2));
  l.setAttribute("y2", String(y2));
  l.setAttribute("stroke", color);
  l.setAttribute("stroke-width", "1.5");
  svg.appendChild(l);
}

function drawPath(x1: number, y1: number, x2: number, y2: number, color: string) {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const mid = (y1 + y2) / 2;
  p.setAttribute("d", `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`);
  p.setAttribute("stroke", color);
  p.setAttribute("stroke-width", "1.5");
  p.setAttribute("fill", "none");
  svg.appendChild(p);
}

let menu: HTMLDivElement | null = null;
function showMenu(x: number, y: number, row: Row) {
  hideMenu();
  menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const items: Array<[string, () => void]> = [
    [t("menuInteractiveRebase", "Interactive rebase from here"), () => vscode.postMessage({ type: "interactiveRebase", hash: row.hash })],
    [t("menuCherryPick", "Cherry-pick this commit"), () => vscode.postMessage({ type: "cherryPick", hash: row.hash })],
  ];
  for (const ref of row.refs) {
    if (ref.startsWith("HEAD")) continue;
    items.push([t("menuCheckout", "Checkout {0}", ref), () => vscode.postMessage({ type: "checkout", ref })]);
  }
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
  if (menu) {
    menu.remove();
    menu = null;
  }
}
document.addEventListener("click", hideMenu);

logEl.addEventListener("scroll", scheduleRender, { passive: true });
window.addEventListener("resize", scheduleRender);

window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "log") {
    rows = m.rows;
    computeLanes();
    spacer.style.height = `${rows.length * ROW_H}px`;
    spacer.style.width = `${graphWidth}px`;
    emptyEl.style.display = "none";
    statusEl.textContent = m.filtered
      ? t("statusFiltered", "{0} commit{1} match · clear filters to show all", String(rows.length), rows.length === 1 ? "" : "s")
      : "";
    statusEl.style.display = m.filtered ? "block" : "none";
    renderVisible();
  } else if (m.type === "empty") {
    rows = [];
    spacer.style.height = "0";
    clear(svg);
    clear(visibleHost);
    emptyEl.style.display = "block";
    statusEl.style.display = "none";
  } else if (m.type === "branches") {
    msBranch.setItems((m.branches as string[]).map((b) => ({ value: b, label: b })));
  } else if (m.type === "authors") {
    msAuthor.setItems((m.authors as string[]).map((a) => ({ value: a, label: a })));
  } else if (m.type === "setBranchFilter") {
    // Programmatically replace the branch selection (e.g. from "Show in Log").
    const target = (m.branch as string) ?? "";
    msBranch.setSelection(target ? [target] : []);
    emitFilter();
  } else if (m.type === "setPathFilter") {
    qPath.value = (m.path as string) ?? "";
    emitFilter();
  } else if (m.type === "error") {
    statusEl.textContent = t("errorPrefix", "Error: {0}", m.message);
    statusEl.style.display = "block";
  }
});

vscode.postMessage({ type: "ready" });
