#!/usr/bin/env node
// Cross-platform git hook installer — runs on npm install (postinstall)
// Installs commit-msg (Conventional Commits), pre-commit (tsc),
// post-merge + post-rewrite (auto-rebuild dist/ when source is newer).

const fs = require("fs");
const path = require("path");

// Find .git directory (walk up from this script's location)
function findGitDir(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const gitDir = path.join(dir, ".git");
    if (fs.existsSync(gitDir)) return gitDir;
    dir = path.dirname(dir);
  }
  return null;
}

const gitDir = findGitDir(__dirname);
if (!gitDir) {
  console.log("install-hooks: .git directory not found — skipping hook install.");
  process.exit(0);
}

const hooksDir = path.join(gitDir, "hooks");
if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

const commitMsgHook = `#!/bin/sh
# Conventional Commits validation hook
commit_msg_file="$1"
commit_msg=$(head -1 "$commit_msg_file")

if echo "$commit_msg" | grep -qE "^Merge "; then exit 0; fi

if ! echo "$commit_msg" | grep -qE "^(feat|fix|docs|chore|refactor|test|style|perf|ci|build|revert)(\\\\(.+\\\\))?(!)?: .+"; then
  echo ""
  echo "ERROR: Commit message does not follow Conventional Commits format."
  echo "  Expected: <type>[scope]: <description>"
  echo "  Got:      $commit_msg"
  echo "  Valid types: feat, fix, docs, chore, refactor, test, style, perf, ci, build, revert"
  echo "  Use --no-verify to bypass."
  exit 1
fi
`;

const preCommitHook = `#!/bin/sh
# Pre-commit: type-check staged .ts/.tsx files
staged_ts=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\\\.(ts|tsx)$')
if [ -z "$staged_ts" ]; then exit 0; fi

echo "Running TypeScript type-check..."
npx tsc --noEmit
if [ $? -ne 0 ]; then
  echo "ERROR: TypeScript type-check failed. Use --no-verify to bypass."
  exit 1
fi
`;

// ----------------------------------------------------------------------
// Auto-rebuild hooks (forge-harness, plan 2026-05-10-auto-rebuild-after-ship-or-merge)
// Closes the F54-build-variant trap: git pull after /ship merge leaves dist/ stale because
// npm install / npm run build is not part of git pull. Hook detects source-vs-dist drift
// via a node-based mtime comparison, runs `npm run build` when source is newer, and writes
// an execution marker .git/.forge-rebuild-hook-marker on every invocation (so AC-5 can
// verify hook fired on real merges where source under server/ may not have changed).
//
// Cross-platform within POSIX-shell-providing matrix (macOS BSD, Linux GNU, Git-for-Windows
// MSYS bash). Native Windows CMD/PowerShell out of scope.
// Bypass single invocation: `git -c hooks.post-merge=false pull` (and similar for post-rewrite).
// ----------------------------------------------------------------------

function rebuildHookBody(trigger) {
  return `#!/bin/sh
# auto-rebuild — forge-harness ${trigger} hook (plan 2026-05-10-auto-rebuild-after-ship-or-merge)
# Detects source-newer-than-dist drift; runs \`npm run build\` if needed; writes execution marker.

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
if [ -z "$REPO_ROOT" ] || [ -z "$GIT_DIR" ]; then exit 0; fi
cd "$REPO_ROOT" || exit 0
# Resolve GIT_DIR to absolute (git may return relative ".git").
case "$GIT_DIR" in
  /*) ;;
  *) GIT_DIR="$REPO_ROOT/$GIT_DIR" ;;
esac

# Freshness check via node (portable across BSD/GNU stat).
NEEDS_REBUILD=$(node -e "
  const fs = require('fs');
  const path = require('path');
  function walk(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }
  const sources = walk('server').filter(f => f.endsWith('.ts'));
  if (sources.length === 0) { console.log('no'); process.exit(0); }
  const dists = walk('dist').filter(f => f.endsWith('.js'));
  if (dists.length === 0) { console.log('yes'); process.exit(0); }
  const newestSource = Math.max(...sources.map(f => fs.statSync(f).mtimeMs));
  const newestDist = Math.max(...dists.map(f => fs.statSync(f).mtimeMs));
  console.log(newestSource > newestDist ? 'yes' : 'no');
" 2>/dev/null || echo "no")
# Fail-open on freshness-check error (e.g., node not on PATH): treat as "fresh" → skip rebuild,
# don't block git pull. Operator can manually \`npm run build\` if dist/ is actually stale.

REBUILT="false"
REBUILD_FAILED="false"
if [ "$NEEDS_REBUILD" = "yes" ]; then
  echo "[forge-harness ${trigger}] source newer than dist/ — running 'npm run build'..."
  if npm run build > /dev/null 2>&1; then
    REBUILT="true"
    echo "[forge-harness ${trigger}] dist/ rebuilt. NOTE: restart your Claude Code session for the new dist/ to take effect (F54 runtime variant)."
  else
    REBUILD_FAILED="true"
    echo "[forge-harness ${trigger}] 'npm run build' FAILED — dist/ may be in mixed state. Run 'npm run build' manually after fixing." >&2
    # Continue to marker write so AC-5 still records "I ran"; then exit non-zero per plan R4.
  fi
fi

# Always write execution marker (even on no-op or rebuild failure).
# lastRunAt advances every invocation; lastRebuildAt only on successful rebuild (sticky across no-ops).
# Pass REBUILT + GIT_DIR via env so the node subprocess sees them (POSIX VAR=val cmd).
REBUILT="$REBUILT" GIT_DIR="$GIT_DIR" node -e "
  const fs = require('fs');
  const path = require('path');
  const markerPath = path.join(process.env.GIT_DIR, '.forge-rebuild-hook-marker');
  const now = Date.now();
  const rebuilt = process.env.REBUILT === 'true';
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch (_) {}
  const lastRebuildAt = rebuilt ? now : (typeof prior.lastRebuildAt === 'number' ? prior.lastRebuildAt : null);
  fs.writeFileSync(markerPath,
    JSON.stringify({ lastRunAt: now, lastRebuildAt, trigger: '${trigger}' }, null, 2));
"

# Per plan R4: marker write completes BEFORE failure exit so AC-5 still records the hook fired.
if [ "$REBUILD_FAILED" = "true" ]; then exit 1; fi
exit 0
`;
}

const hooks = [
  { name: "commit-msg", content: commitMsgHook },
  { name: "pre-commit", content: preCommitHook },
  { name: "post-merge", content: rebuildHookBody("post-merge") },
  { name: "post-rewrite", content: rebuildHookBody("post-rewrite") },
];

for (const hook of hooks) {
  const hookPath = path.join(hooksDir, hook.name);
  fs.writeFileSync(hookPath, hook.content, { mode: 0o755 });
  console.log(`install-hooks: installed ${hook.name}`);
}
