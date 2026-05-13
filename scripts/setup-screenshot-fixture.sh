#!/usr/bin/env bash
# Build an ephemeral git repo configured exactly for the README screenshots.
#
# All output goes under $TMPDIR/rebased-screenshot-fixture so it's easy to
# wipe and rebuild. Idempotent — re-running blows the previous one away.
#
# Topology after setup:
#
#   * 5193e9d feat(api): pagination          (feature/api)
#   * 8a2c1f0 feat(api): list endpoint
#   | * cb71e30 perf(parser): batch reads    (feature/perf)
#   | * f234bb8 perf(parser): inline hot path
#   |/
#   * 0d44a91 fix(auth): rotate tokens       (main, HEAD)
#   * d8f0c2e refactor(core): extract helper
#   * 3e88a14 docs: add architecture diagram
#   * 9c1de37 chore: bump deps
#   * 7771bbb feat(core): bootstrap          (initial)
#
# Plus:
# - apps/web/server.ts with un-resolved conflict markers (for conflict UI screenshot)
# - apps/web/handlers.ts with mid-edit dirty state (for hunk staging screenshot)
# - .git/rebase-merge/git-rebase-todo (for rebase editor screenshot — set up below)

set -euo pipefail

FIXTURE="${TMPDIR:-/tmp}rebased-screenshot-fixture"
FIXTURE="${FIXTURE%/}"
echo "Fixture path: $FIXTURE"

rm -rf "$FIXTURE"
mkdir -p "$FIXTURE"
cd "$FIXTURE"

git init -q -b main
git config user.email demo@example.com
git config user.name "Demo Author"
git config commit.gpgsign false

mkpkg() {
  mkdir -p apps/web apps/api apps/core
}

mkpkg

# Helper to commit with a fixed timestamp so the screenshot dates stay stable.
EPOCH=1730000000
ts() {
  local offset=$1
  echo $((EPOCH + offset * 3600))
}
commit_at() {
  local hours=$1; shift
  GIT_AUTHOR_DATE="$(ts "$hours")" \
  GIT_COMMITTER_DATE="$(ts "$hours")" \
    git commit -q -m "$@"
}

# --- history on main ---
cat > README.md <<EOF
# demo-project
A pretend monorepo for screenshots.
EOF
echo "console.log('bootstrap');" > apps/core/index.ts
git add -A
commit_at 0 "feat(core): bootstrap"

echo '{ "deps": "1.0" }' > package.json
git add -A
commit_at 1 "chore: bump deps"

mkdir -p docs
cat > docs/ARCHITECTURE.md <<EOF
# Architecture

Pretend diagram lives here.
EOF
git add -A
commit_at 2 "docs: add architecture diagram"

cat > apps/core/helper.ts <<EOF
export function helper(x: number): number { return x + 1; }
EOF
sed -i.bak "1s/.*/export { helper } from '.\/helper';/" apps/core/index.ts && rm apps/core/index.ts.bak
git add -A
commit_at 3 "refactor(core): extract helper"

cat > apps/auth.ts <<EOF
// Auth token handling.
export function rotate(token: string) { return token + ':rotated'; }
EOF
git add -A
commit_at 4 "fix(auth): rotate tokens"

# --- branch off feature/api ---
git checkout -q -b feature/api
cat > apps/api/list.ts <<EOF
import { rotate } from '../auth';
export async function listItems(req: Request) {
  return Response.json({ items: [], token: rotate('x') });
}
EOF
git add -A
commit_at 5 "feat(api): list endpoint"

cat >> apps/api/list.ts <<EOF
export async function listItemsPaginated(req: Request, page = 1) {
  return Response.json({ items: [], page });
}
EOF
git add -A
commit_at 6 "feat(api): pagination"

# --- back to main, branch feature/perf ---
git checkout -q main
git checkout -q -b feature/perf
cat > apps/core/parser.ts <<EOF
export function parse(s: string) {
  return s.split(',').map((t) => t.trim());
}
EOF
git add -A
commit_at 7 "perf(parser): inline hot path"

cat >> apps/core/parser.ts <<EOF
export function parseBatch(lines: string[]) {
  return lines.map(parse);
}
EOF
git add -A
commit_at 8 "perf(parser): batch reads"

git checkout -q main

# --- working-tree state for screenshots ---

# 1. UU conflict on apps/web/server.ts — needed for Conflict resolver panel.
mkdir -p apps/web
cat > apps/web/server.ts <<'EOF'
<<<<<<< HEAD
import { listen } from './http';
const PORT = 3000;
=======
import { listen } from './http';
const PORT = 4000;  // changed for staging
>>>>>>> origin/main
listen(PORT);
EOF
# Stage with index conflict so `git diff --diff-filter=U` reports it.
git update-index --add --cacheinfo 100644,$(git hash-object -w apps/web/server.ts),apps/web/server.ts 2>/dev/null || true

# 2. Dirty hunks on apps/web/handlers.ts — for hunk staging screenshot.
cat > apps/web/handlers.ts <<EOF
export async function getUser(id: string) {
  return { id, name: 'demo' };
}
EOF
git add apps/web/handlers.ts
commit_at 5 "feat(web): user handler"
# Now modify with two distinct hunks
cat > apps/web/handlers.ts <<EOF
import { rotate } from '../auth';

export async function getUser(id: string) {
  const audit = { id, ts: Date.now() };
  return { id, name: 'demo', audit };
}

export async function deleteUser(id: string) {
  console.log('audit:delete', { id });
  return { ok: true };
}
EOF

echo
echo "------------------------------------------------------------------"
echo "Fixture ready at: $FIXTURE"
echo
echo "Branches:"
git --no-pager branch
echo
echo "Log (graph):"
git --no-pager log --all --oneline --graph
echo
echo "Status:"
git --no-pager status --short
echo "------------------------------------------------------------------"
