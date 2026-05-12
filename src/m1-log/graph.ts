import type { CommitRef } from "../core/types";

export interface LaidOutCommit {
  commit: CommitRef;
  lane: number;
  parentLanes: number[];
  active: number[]; // lanes alive at this row (used to draw through-lines)
}

// Greedy swim-lane layout. Invariant: commits arrive in topological order
// (child before parent), so when we see commit X we can read off every lane
// that has already reserved X as its next parent.
//
// At each row:
//   1. Find every lane currently pointing at this commit (collapsed = those lanes).
//      • Leftmost becomes the row's lane; others die.
//      • If no lane points at it (first commit / disconnected ref tip), allocate.
//   2. The commit consumes its lane.
//   3. First parent inherits the lane; remaining parents claim fresh ones.
export function layout(commits: CommitRef[]): LaidOutCommit[] {
  const liveLanes: (string | null)[] = []; // lane index -> next expected hash

  function allocLane(hash: string): number {
    for (let i = 0; i < liveLanes.length; i++) {
      if (liveLanes[i] === null) {
        liveLanes[i] = hash;
        return i;
      }
    }
    liveLanes.push(hash);
    return liveLanes.length - 1;
  }

  const out: LaidOutCommit[] = [];

  for (const c of commits) {
    const claimingLanes: number[] = [];
    for (let i = 0; i < liveLanes.length; i++) {
      if (liveLanes[i] === c.hash) claimingLanes.push(i);
    }

    let lane: number;
    if (claimingLanes.length === 0) {
      // New root for this commit (branch tip or disconnected component).
      lane = allocLane(c.hash);
    } else {
      lane = claimingLanes[0];
    }

    // All claiming lanes collapse into `lane`; non-primary ones free up.
    for (const cl of claimingLanes) liveLanes[cl] = null;
    // `lane` itself is also freed for now — first parent may re-claim it below.

    const parentLanes: number[] = [];
    c.parents.forEach((p, idx) => {
      if (idx === 0) {
        liveLanes[lane] = p;
        parentLanes.push(lane);
      } else {
        // For a merge commit's extra parents, reuse an existing lane if some
        // other live lane already reserved this parent — otherwise allocate.
        const existing = liveLanes.indexOf(p);
        if (existing !== -1) {
          parentLanes.push(existing);
        } else {
          parentLanes.push(allocLane(p));
        }
      }
    });

    // Trim trailing nulls so `active` reflects actual breadth.
    while (liveLanes.length > 0 && liveLanes[liveLanes.length - 1] === null) {
      liveLanes.pop();
    }

    const active = liveLanes
      .map((v, i) => (v !== null ? i : -1))
      .filter((i) => i >= 0);

    out.push({ commit: c, lane, parentLanes, active });
  }
  return out;
}
