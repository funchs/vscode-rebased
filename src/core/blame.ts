import { runGit } from "./git";

export interface BlameLine {
  hash: string;
  author: string;
  date: number;
  summary: string;
}

const HEADER = /^([0-9a-f]{40})(?: \d+){2,3}$/;

export function parseBlamePorcelain(raw: string): BlameLine[] {
  const lines = raw.split("\n");
  const meta = new Map<string, { author: string; date: number; summary: string }>();
  const result: BlameLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(HEADER);
    if (!m) { i++; continue; }
    const hash = m[1];
    const cur: Partial<{ author: string; date: number; summary: string }> = meta.get(hash) ? { ...meta.get(hash)! } : {};
    i++;
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const line = lines[i];
      if (line.startsWith("author ")) cur.author = line.slice(7);
      else if (line.startsWith("author-time ")) cur.date = parseInt(line.slice(12), 10) * 1000;
      else if (line.startsWith("summary ")) cur.summary = line.slice(8);
      i++;
    }
    if (cur.author && cur.date != null && cur.summary != null) {
      meta.set(hash, { author: cur.author, date: cur.date, summary: cur.summary });
    }
    const final = meta.get(hash);
    result.push(final ? { hash, ...final } : { hash, author: "?", date: 0, summary: "" });
    i++; // skip \t content line
  }
  return result;
}

export async function blameFile(repo: string, relPath: string): Promise<BlameLine[]> {
  const out = await runGit(["blame", "--porcelain", "--", relPath], { cwd: repo });
  return parseBlamePorcelain(out);
}

export function relTime(ms: number): string {
  if (!ms) return "";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo`;
  return `${Math.floor(diff / 31536000)}y`;
}
