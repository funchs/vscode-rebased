import { runGit } from "./git";
import { parseCC } from "./conventional-commit";

export interface ScopeStat {
  scope: string;
  count: number;
  lastUsedDays: number; // approximate
}

const NUL = "\x00";
const RECORD = "\x1e";

// Mine scopes from the last N commit subjects. Useful for autocomplete:
// recent + frequent scopes float to the top. Author bias is intentionally
// ignored — global frequency is what users actually want.
export async function mineScopes(repo: string, limit = 500): Promise<ScopeStat[]> {
  const out = await runGit(
    ["log", "-z", `--pretty=format:%at${RECORD}%s`, `--max-count=${limit}`],
    { cwd: repo }
  );
  const now = Date.now();
  const stats = new Map<string, { count: number; lastTs: number }>();
  for (const line of out.split(NUL)) {
    if (!line) continue;
    const [tsStr, subject] = line.split(RECORD);
    const ts = parseInt(tsStr, 10) * 1000;
    const parsed = parseCC(subject);
    if (!parsed.scope) continue;
    // Conventional Commits supports comma-separated scopes occasionally; split them.
    for (const raw of parsed.scope.split(",")) {
      const scope = raw.trim();
      if (!scope) continue;
      const cur = stats.get(scope) ?? { count: 0, lastTs: 0 };
      cur.count += 1;
      if (ts > cur.lastTs) cur.lastTs = ts;
      stats.set(scope, cur);
    }
  }
  return [...stats.entries()]
    .map(([scope, s]) => ({
      scope,
      count: s.count,
      lastUsedDays: Math.floor((now - s.lastTs) / 86400000),
    }))
    .sort((a, b) => {
      // Prefer recently used (within 30 days) over absolute count.
      const aRecent = a.lastUsedDays <= 30 ? 1 : 0;
      const bRecent = b.lastUsedDays <= 30 ? 1 : 0;
      if (aRecent !== bRecent) return bRecent - aRecent;
      return b.count - a.count;
    });
}
