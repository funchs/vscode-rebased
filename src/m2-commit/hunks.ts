// Parse unified-diff output from `git diff -- <path>` (working tree vs index)
// or `git diff --cached -- <path>` (index vs HEAD) into discrete hunks suitable
// for staging selection via `git apply --cached`.

export interface Hunk {
  header: string;          // e.g. "@@ -10,5 +10,7 @@ optional context"
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string[];          // diff lines (including leading +/-/space)
}

export interface FilePatch {
  fileHeader: string[];    // everything before the first @@
  hunks: Hunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(diff: string): FilePatch {
  const lines = diff.split("\n");
  const fileHeader: string[] = [];
  const hunks: Hunk[] = [];
  let i = 0;

  // File header: everything up to the first @@.
  while (i < lines.length && !lines[i].startsWith("@@")) {
    fileHeader.push(lines[i]);
    i++;
  }

  while (i < lines.length) {
    if (!lines[i].startsWith("@@")) {
      i++;
      continue;
    }
    const m = lines[i].match(HUNK_HEADER);
    if (!m) {
      i++;
      continue;
    }
    const header = lines[i];
    const oldStart = parseInt(m[1], 10);
    const oldLines = m[2] ? parseInt(m[2], 10) : 1;
    const newStart = parseInt(m[3], 10);
    const newLines = m[4] ? parseInt(m[4], 10) : 1;
    i++;
    const body: string[] = [];
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff ")) {
      body.push(lines[i]);
      i++;
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    hunks.push({ header, oldStart, oldLines, newStart, newLines, body });
  }
  return { fileHeader, hunks };
}

// Build a minimal valid patch containing only the selected hunks, ready for
// `git apply --cached`.
export function buildPatch(patch: FilePatch, selectedIndices: number[]): string {
  const out: string[] = [...patch.fileHeader];
  for (const idx of selectedIndices) {
    const h = patch.hunks[idx];
    out.push(h.header);
    for (const line of h.body) out.push(line);
  }
  return out.join("\n") + "\n";
}
