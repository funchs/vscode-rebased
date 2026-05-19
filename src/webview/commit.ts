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

interface FileChange {
  path: string;
  staged: boolean;
  status: string;
  oldPath?: string;
}
interface ChangelistsInfo {
  names: string[];
  active: string;
  pathToList: Record<string, string>;
}

const vscode = acquireVsCodeApi<unknown>();

// ─── Conventional Commits validator ────────────────────────────────────────
const CC_TYPES = ["feat","fix","docs","style","refactor","perf","test","build","ci","chore","revert"];
const HEADER_RE = /^([a-zA-Z][a-zA-Z0-9_-]*)(?:\(([^)]+)\))?(!)?:[ \t]+(.+)$/;

function validateCC(text: string): { type?: string; scope?: string; bang?: boolean; subject?: string; issues: { sev: string; msg: string }[] } {
  const issues: { sev: string; msg: string }[] = [];
  if (!text.trim()) return { issues: [] };
  const first = text.split("\n", 1)[0];
  const m = first.match(HEADER_RE);
  if (!m) {
    issues.push({ sev: "error", msg: t("ccHeaderFormat", "Header must be type(scope)?[!]: subject") });
    return { issues };
  }
  const [, type, scope, bang, subject] = m;
  const out = { type, scope, bang: !!bang, subject, issues };
  if (!CC_TYPES.includes(type.toLowerCase())) {
    issues.push({ sev: "warn", msg: `${t("ccUnknownType", "Unknown type")} "${type}"` });
  }
  if (type !== type.toLowerCase()) issues.push({ sev: "warn", msg: t("ccLowercaseType", "Type should be lowercase") });
  if (first.length > 72) issues.push({ sev: "warn", msg: t("ccCharCount", "{0} chars (recommended ≤ 72)", String(first.length)) });
  if (/\.\s*$/.test(subject)) issues.push({ sev: "warn", msg: t("ccNoPeriod", "No period at end") });
  if (subject[0] && subject[0] !== subject[0].toLowerCase()) issues.push({ sev: "warn", msg: t("ccLowercaseSubject", "Lowercase subject") });
  const lines = text.split("\n");
  if (lines.length > 1 && lines[1].trim() !== "") {
    issues.push({ sev: "warn", msg: t("ccBlankLineAfterHeader", "Blank line after header") });
  }
  return out;
}

// ─── State ─────────────────────────────────────────────────────────────────
interface UnifiedRow {
  path: string;
  status: string;
  stageState: "off" | "on" | "partial";
}
let unified: UnifiedRow[] = [];
let changelists: ChangelistsInfo = { names: ["Default"], active: "Default", pathToList: {} };
let groupMode: "flat" | "dir" | "changelist" = "flat";
let collapsedGroups = new Set<string>();
let sectionCollapsed = false;
let selectedPaths = new Set<string>();
let anchorPath: string | null = null;       // shift-click anchor
let visibleRows: string[] = [];              // path order currently rendered, for range selection
let diffPreview = false;

function firstSelected(): string | null {
  for (const p of selectedPaths) return p;
  return null;
}

// ─── DOM ───────────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const changesEl = $<HTMLUListElement>("changes");
const filesCount = $<HTMLSpanElement>("files-count");
const sectionHeader = $<HTMLElement>("changes-header");
const bulkRollback = $<HTMLButtonElement>("bulk-rollback");
const msgEl = $<HTMLTextAreaElement>("msg");
const amendEl = $<HTMLInputElement>("amend");
const commitBtn = $<HTMLButtonElement>("commit");
const commitChevron = $<HTMLButtonElement>("commit-chevron");
const emptyEl = $<HTMLDivElement>("empty");
const appEl = $<HTMLDivElement>("app");
const optSignoff = $<HTMLInputElement>("opt-signoff");
const optGpg = $<HTMLInputElement>("opt-gpg");
const optAuthor = $<HTMLInputElement>("opt-author");

function clear(el: HTMLElement) { while (el.firstChild) el.removeChild(el.firstChild); }
function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}
function icon(name: string, extraClass = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = `codicon codicon-${name}${extraClass ? " " + extraClass : ""}`;
  return s;
}
function iconButton(iconName: string, title: string, onClick: (e: MouseEvent) => void, extraClass = "row-btn"): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = extraClass;
  b.title = title;
  b.appendChild(icon(iconName));
  b.onclick = onClick;
  return b;
}
function gitDecorationClass(status: string): string {
  switch (status) {
    case "M": return "fc-modified";
    case "A": case "?": return "fc-added";
    case "D": return "fc-deleted";
    case "R": return "fc-renamed";
    default:  return "";
  }
}
function statusLetter(s: string): string {
  switch (s) {
    case "?": return "U";
    case "M": case "A": case "D": case "R": return s;
    default:  return s;
  }
}

// ─── File row ──────────────────────────────────────────────────────────────
function fileRow(u: UnifiedRow, indented = false): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "file" + (indented ? " indented" : "");
  li.dataset.path = u.path;
  if (selectedPaths.has(u.path)) li.classList.add("selected");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "cb";
  cb.checked = u.stageState !== "off";
  cb.indeterminate = u.stageState === "partial";
  cb.title = u.stageState === "off" ? t("stageTitle", "Include in commit") : t("unstageTitle", "Exclude from commit");
  cb.onclick = (e) => {
    e.stopPropagation();
    const wantOn = cb.checked || cb.indeterminate;
    vscode.postMessage({ type: wantOn ? "stage" : "unstage", paths: [u.path] });
  };

  const fname = u.path.split("/").pop() ?? u.path;
  const dir = u.path.slice(0, u.path.length - fname.length).replace(/\/$/, "");

  const name = span(`fname ${gitDecorationClass(u.status)}`, fname);
  name.title = u.path;
  const dirEl = span("fpath", dir);

  const right = document.createElement("span");
  right.className = "row-right";
  right.appendChild(iconButton("list-tree", t("hunksTitle", "Stage individual hunks"), (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: "hunks", path: u.path });
  }));
  right.appendChild(iconButton("discard", t("rollbackRow", "Rollback this file"), (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: "rollback", paths: [u.path] });
  }, "row-btn revert"));
  right.appendChild(span(`status-letter ${gitDecorationClass(u.status)}`, statusLetter(u.status)));

  li.appendChild(cb);
  li.appendChild(name);
  li.appendChild(dirEl);
  li.appendChild(right);
  li.addEventListener("click", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    if (shift && anchorPath) {
      const a = visibleRows.indexOf(anchorPath);
      const b = visibleRows.indexOf(u.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        if (!mod) selectedPaths.clear();
        for (let i = lo; i <= hi; i++) selectedPaths.add(visibleRows[i]);
      }
    } else if (mod) {
      if (selectedPaths.has(u.path)) selectedPaths.delete(u.path);
      else selectedPaths.add(u.path);
      anchorPath = u.path;
    } else {
      selectedPaths.clear();
      selectedPaths.add(u.path);
      anchorPath = u.path;
    }
    document.querySelectorAll("li.file.selected").forEach((n) => n.classList.remove("selected"));
    for (const p of selectedPaths) {
      const el = changesEl.querySelector(`li.file[data-path="${cssEscape(p)}"]`);
      if (el) el.classList.add("selected");
    }
    updateSelectionStatus();
    if (diffPreview && selectedPaths.size === 1) vscode.postMessage({ type: "diff", path: u.path });
  });
  return li;
}

// Minimal CSS.escape polyfill — webview targets recent Chromium so it should exist,
// but keep this fallback for paths that contain odd characters.
function cssEscape(s: string): string {
  if ((window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape) {
    return (window as unknown as { CSS: { escape: (s: string) => string } }).CSS.escape(s);
  }
  return s.replace(/(["\\])/g, "\\$1");
}

// ─── Group rendering ───────────────────────────────────────────────────────
function renderGroup(
  display: string,
  key: string,
  rows: UnifiedRow[],
  opts?: { changelist?: string; active?: boolean }
) {
  const collapsed = collapsedGroups.has(key);
  const header = document.createElement("li");
  header.className = "group-header";
  header.appendChild(icon(collapsed ? "chevron-right" : "chevron-down", "caret"));
  const name = span("group-name", display);
  if (opts?.active) name.classList.add("active-list");
  header.appendChild(name);
  header.appendChild(span("count-pill", String(rows.length)));
  if (opts?.changelist) {
    header.appendChild(iconButton("check", t("commitOnly", "Commit only this changelist"), (e) => {
      e.stopPropagation();
      const msg = msgEl.value;
      if (!msg.trim()) { msgEl.focus(); return; }
      vscode.postMessage({ type: "commitChangelist", list: opts.changelist, message: msg });
      msgEl.value = ""; updateCC();
    }));
  }
  header.onclick = () => {
    if (collapsedGroups.has(key)) collapsedGroups.delete(key); else collapsedGroups.add(key);
    renderChanges();
  };
  changesEl.appendChild(header);
  if (!collapsed) for (const r of rows) changesEl.appendChild(fileRow(r, true));
}

function renderChanges() {
  clear(changesEl);
  // Track which paths are visible this render so range-select uses the right list,
  // and prune selectedPaths/anchor that no longer exist.
  visibleRows = unified.map((u) => u.path);
  const exists = new Set(visibleRows);
  for (const p of [...selectedPaths]) if (!exists.has(p)) selectedPaths.delete(p);
  if (anchorPath && !exists.has(anchorPath)) anchorPath = null;

  if (sectionCollapsed) { updateSelectionStatus(); return; }
  if (unified.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-inline";
    li.textContent = t("emptyChanges", "No local changes.");
    changesEl.appendChild(li);
    updateSelectionStatus();
    return;
  }
  if (groupMode === "flat") {
    for (const u of unified) changesEl.appendChild(fileRow(u));
  } else if (groupMode === "dir") {
    const groups = new Map<string, UnifiedRow[]>();
    for (const u of unified) {
      const slash = u.path.indexOf("/");
      const key = slash < 0 ? "" : u.path.slice(0, slash);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(u);
    }
    for (const k of [...groups.keys()].sort()) {
      renderGroup(k || t("groupRoot", "(root)"), k || "::root", groups.get(k)!);
    }
  } else {
    const groups = new Map<string, UnifiedRow[]>();
    for (const name of changelists.names) groups.set(name, []);
    for (const u of unified) {
      const list = changelists.pathToList[u.path] ?? changelists.active;
      (groups.get(list) ?? groups.set(list, []).get(list)!).push(u);
    }
    const ordered = [
      changelists.active,
      ...changelists.names.filter((n) => n !== changelists.active),
    ];
    for (const name of ordered) {
      const arr = groups.get(name) ?? [];
      if (arr.length === 0 && name !== changelists.active) continue;
      renderGroup(name, "cl:" + name, arr, { changelist: name, active: name === changelists.active });
    }
  }
  updateSelectionStatus();
}

function updateSelectionStatus() {
  // Reflect selection size in the count pill: e.g. "3 sel · 8/12".
  const total = unified.length;
  const staged = unified.filter((u) => u.stageState !== "off").length;
  const base = total === 0 ? "" : staged === total ? String(total) : `${staged}/${total}`;
  const sel = selectedPaths.size;
  filesCount.textContent = sel > 0 ? `${sel} sel · ${base}` : base;
  // Show the bulk-rollback button only when there are changes; color it
  // differently when there's a multi-row selection.
  bulkRollback.hidden = total === 0;
  bulkRollback.title = sel > 0
    ? t("rollbackBulkSel", "Rollback {0} selected file(s)", String(sel))
    : t("rollbackBulkAll", "Rollback all {0} file(s)", String(total));
  sectionHeader.classList.toggle("has-selection", sel > 0);
}

bulkRollback.addEventListener("click", (e) => {
  e.stopPropagation();
  const paths = selectedPaths.size > 0
    ? [...selectedPaths]
    : unified.map((u) => u.path);
  if (paths.length === 0) return;
  vscode.postMessage({ type: "rollback", paths });
});

// ─── Counts / button state ─────────────────────────────────────────────────
function updateCounts() {
  const total = unified.length;
  const staged = unified.filter((u) => u.stageState !== "off").length;
  filesCount.title = staged === total
    ? t("files", "{0} files", String(total))
    : `${staged} ${t("stagedSuffix", "staged")} / ${total}`;
  const canCommit = staged > 0 || amendEl.checked;
  commitBtn.disabled = !canCommit;
  commitChevron.disabled = !canCommit;
  updateSelectionStatus();
}

// ─── Section header (collapse/expand) ──────────────────────────────────────
sectionHeader.addEventListener("click", () => {
  sectionCollapsed = !sectionCollapsed;
  sectionHeader.setAttribute("aria-expanded", String(!sectionCollapsed));
  const caret = sectionHeader.querySelector(".caret") as HTMLElement;
  caret.classList.toggle("codicon-chevron-down", !sectionCollapsed);
  caret.classList.toggle("codicon-chevron-right", sectionCollapsed);
  changesEl.style.display = sectionCollapsed ? "none" : "";
  renderChanges();
});

// ─── Commit buttons ────────────────────────────────────────────────────────
function commitPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message: msgEl.value,
    amend: amendEl.checked,
    signoff: optSignoff.checked,
    gpgSign: optGpg.checked,
    author: optAuthor.value.trim() || undefined,
    ...extra,
  };
}
function resetMessage() {
  msgEl.value = "";
  amendEl.checked = false;
  updateCC();
  updateCounts();
}
commitBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "commit", ...commitPayload() });
  resetMessage();
});

// Chevron menu — show/hide
commitChevron.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu("commit-menu", commitChevron, "anchor-right");
});
amendEl.addEventListener("change", updateCounts);

document.querySelectorAll<HTMLElement>("#commit-menu li").forEach((li) => {
  if (li.classList.contains("sep")) return;
  li.addEventListener("click", () => {
    closeAllMenus();
    const cmd = li.dataset.cmd!;
    const sel = [...selectedPaths];
    const first = firstSelected();
    if (cmd === "push") {
      vscode.postMessage({ type: "commitAndPush", ...commitPayload() });
      resetMessage();
    } else if (cmd === "amend") {
      vscode.postMessage({ type: "commit", ...commitPayload({ amend: true }), message: msgEl.value || "(amend)" });
      resetMessage();
    } else if (cmd === "showDiff") {
      if (first) vscode.postMessage({ type: "diff", path: first });
    } else if (cmd === "hunks") {
      if (first) vscode.postMessage({ type: "hunks", path: first });
    } else if (cmd === "move") {
      if (sel.length) vscode.postMessage({ type: "moveToChangelist", paths: sel });
    } else if (cmd === "rollback") {
      const paths = sel.length
        ? sel
        : unified.filter((u) => u.stageState !== "off").map((u) => u.path);
      if (paths.length) vscode.postMessage({ type: "rollback", paths });
    } else if (cmd === "openStashes") {
      vscode.postMessage({ type: "openStashes" });
    }
  });
});

// Keyboard: Delete / Backspace = rollback selected (when focus is not in textarea/input).
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
  if ((e.key === "Delete" || e.key === "Backspace") && selectedPaths.size > 0) {
    e.preventDefault();
    vscode.postMessage({ type: "rollback", paths: [...selectedPaths] });
  } else if (e.key === "Escape" && selectedPaths.size > 0) {
    selectedPaths.clear();
    anchorPath = null;
    renderChanges();
  } else if ((e.ctrlKey || e.metaKey) && e.key === "a" && document.activeElement?.tagName !== "TEXTAREA") {
    e.preventDefault();
    for (const u of unified) selectedPaths.add(u.path);
    renderChanges();
  }
});

// ─── Options popover (cog icon) ────────────────────────────────────────────
document.querySelectorAll<HTMLElement>("[data-act]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btn.dataset.act === "options") toggleMenu("opts-menu", btn);
  });
});

// ─── Generic menu helper ───────────────────────────────────────────────────
function closeAllMenus() {
  document.querySelectorAll(".dropdown-menu.open").forEach((m) => m.classList.remove("open"));
}
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest(".dropdown-menu") && !target.closest("[data-act]") && !target.closest(".chevron")) closeAllMenus();
});
function toggleMenu(id: string, anchor: HTMLElement, mode: "anchor-left" | "anchor-right" = "anchor-left") {
  const menu = document.getElementById(id);
  if (!menu) return;
  const wasOpen = menu.classList.contains("open");
  closeAllMenus();
  if (!wasOpen) {
    menu.classList.add("open");
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.top - menu.offsetHeight - 4}px`;
    if (mode === "anchor-right") {
      // Right-align to anchor — keeps menu inside narrow sidebars.
      menu.style.right = `${document.documentElement.clientWidth - r.right}px`;
      menu.style.left = "auto";
    } else {
      menu.style.left = `${Math.max(4, r.left)}px`;
      menu.style.right = "auto";
    }
    // If overflows top, place below
    if (menu.getBoundingClientRect().top < 0) {
      menu.style.top = `${r.bottom + 4}px`;
    }
  }
}

// ─── CC validator chips ────────────────────────────────────────────────────
const badgesEl = $<HTMLSpanElement>("cc-badges");
const ccStatus = $<HTMLDivElement>("cc-status");
const wizardBtn = $<HTMLButtonElement>("wizard");
wizardBtn.addEventListener("click", () => vscode.postMessage({ type: "wizard" }));

function updateCC() {
  const r = validateCC(msgEl.value);
  clear(badgesEl);
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
    chip.textContent = t("breakingChip", "BREAKING");
    badgesEl.appendChild(chip);
  }
  clear(ccStatus);
  if (!msgEl.value.trim()) { ccStatus.style.display = "none"; return; }
  ccStatus.style.display = "block";
  if (!r.issues.length) {
    ccStatus.className = "cc-status ok";
    ccStatus.appendChild(icon("pass"));
    ccStatus.appendChild(document.createTextNode(" " + t("ccValid", "Conventional Commit")));
    return;
  }
  const hasError = r.issues.some((i) => i.sev === "error");
  ccStatus.className = "cc-status " + (hasError ? "error" : "warn");
  ccStatus.appendChild(icon(hasError ? "error" : "warning"));
  ccStatus.appendChild(document.createTextNode(" " + r.issues.map((i) => i.msg).join(" · ")));
}
msgEl.addEventListener("input", updateCC);
updateCC();

// ─── Inbound messages ──────────────────────────────────────────────────────
function unify(files: FileChange[]): UnifiedRow[] {
  const byPath = new Map<string, { staged?: FileChange; unstaged?: FileChange }>();
  for (const f of files) {
    const cur = byPath.get(f.path) ?? {};
    if (f.staged) cur.staged = f; else cur.unstaged = f;
    byPath.set(f.path, cur);
  }
  const out: UnifiedRow[] = [];
  for (const [path, { staged, unstaged }] of byPath) {
    let state: UnifiedRow["stageState"];
    if (staged && unstaged) state = "partial";
    else if (staged) state = "on";
    else state = "off";
    out.push({ path, status: (staged ?? unstaged)!.status, stageState: state });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "status") {
    emptyEl.style.display = "none";
    appEl.style.display = "";
    unified = unify(m.files as FileChange[]);
    if (m.changelists) changelists = m.changelists as ChangelistsInfo;
    renderChanges();
    updateCounts();
  } else if (m.type === "empty") {
    emptyEl.style.display = "block";
    appEl.style.display = "none";
  } else if (m.type === "error") {
    emptyEl.style.display = "block";
    emptyEl.textContent = m.message;
    appEl.style.display = "none";
  } else if (m.type === "setGroupMode") {
    groupMode = m.mode as typeof groupMode;
    renderChanges();
  } else if (m.type === "toggleDiffPreview") {
    diffPreview = !diffPreview;
  }
});

vscode.postMessage({ type: "ready" });
