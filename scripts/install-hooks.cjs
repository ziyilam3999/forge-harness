#!/usr/bin/env node
// Cross-platform git hook installer — runs on npm install (postinstall)
// Installs commit-msg (Conventional Commits) and pre-commit (tsc) hooks

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

const hooks = [
  { name: "commit-msg", content: commitMsgHook },
  { name: "pre-commit", content: preCommitHook },
];

for (const hook of hooks) {
  const hookPath = path.join(hooksDir, hook.name);
  fs.writeFileSync(hookPath, hook.content, { mode: 0o755 });
  console.log(`install-hooks: installed ${hook.name}`);
}
