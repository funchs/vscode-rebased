export {};
declare const acquireVsCodeApi: <T>() => {
  postMessage: (msg: unknown) => void;
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
    ["Interactive rebase from here", () => vscode.postMessage({ type: "interactiveRebase", hash: row.hash })],
    ["Cherry-pick this commit", () => vscode.postMessage({ type: "cherryPick", hash: row.hash })],
  ];
  for (const ref of row.refs) {
    if (ref.startsWith("HEAD")) continue;
    items.push([`Checkout ${ref}`, () => vscode.postMessage({ type: "checkout", ref })]);
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
    renderVisible();
  } else if (m.type === "empty") {
    rows = [];
    spacer.style.height = "0";
    clear(svg);
    clear(visibleHost);
    emptyEl.style.display = "block";
  }
});

vscode.postMessage({ type: "ready" });
