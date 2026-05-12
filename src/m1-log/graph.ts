import type { CommitRef } from "../core/types";

export interface LaidOutCommit {
  commit: CommitRef;
  lane: number;
  parentLanes: number[];
  active: number[]; // lanes alive at this row (for drawing through-lines)
}

// Greedy swim-lane layout. Each commit is placed on a lane derived from the lane
// that its earliest child claimed. Compatible with git log --topo-order semantics.
export function layout(commits: CommitRef[]): LaidOutCommit[] {
  const claimed = new Map<string, number>();
  const liveLanes: (string | null)[] = [];

  function claimLane(hash: string): number {
    const existing = claimed.get(hash);
    if (existing !== undefined && liveLanes[existing] === hash) return existing;
    for (let i = 0; i < liveLanes.length; i++) {
      if (liveLanes[i] === null) {
        liveLanes[i] = hash;
        claimed.set(hash, i);
        return i;
      }
    }
    liveLanes.push(hash);
    claimed.set(hash, liveLanes.length - 1);
    return liveLanes.length - 1;
  }

  const out: LaidOutCommit[] = [];
  for (const c of commits) {
    const lane = claimLane(c.hash);
    liveLanes[lane] = null; // commit consumes its lane

    const parentLanes: number[] = [];
    c.parents.forEach((p, idx) => {
      if (idx === 0) {
        liveLanes[lane] = p;
        claimed.set(p, lane);
        parentLanes.push(lane);
      } else {
        parentLanes.push(claimLane(p));
      }
    });

    const active = liveLanes.map((_, i) => i).filter((i) => liveLanes[i] !== null);
    out.push({ commit: c, lane, parentLanes, active });
  }
  return out;
}
