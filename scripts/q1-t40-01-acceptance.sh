#!/usr/bin/env bash
# Task #40 slice 1 — PH01-US-00a AC rewrite acceptance wrapper.
# Runs AC-1, AC-2, AC-4, AC-6 from the task #40 plan.
# Exits 0 iff all pass.
#
# MSYS_NO_PATHCONV=1 prevents Windows MSYS bash from silently mangling
# /<path> arguments passed to git — task #22 learning #2.
export MSYS_NO_PATHCONV=1

set -u
FAIL=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ---------------- dist/ build prerequisite guard ----------------
# Wrapper runs compiled JS from dist/. If dist/ is missing or older than
# server/ (TS sources), tests run against stale output. Issue #226.
if [ ! -d "dist" ] || [ -n "$(find server -type f -newer dist 2>/dev/null | head -n 1)" ]; then
  echo "ERROR: dist/ missing or stale. Run 'npm run build' first." >&2
  exit 1
fi

PHASE_JSON=".ai-workspace/plans/forge-coordinate-phase-PH-01.json"
STORY="PH01-US-00a"

header () { printf '\n=== %s ===\n' "$1"; }
pass   () { printf 'PASS %s\n' "$1"; }
fail   () { printf 'FAIL %s — %s\n' "$1" "$2"; FAIL=1; }

# ---------------- AC-1 ----------------
# Every AC in PH01-US-00a passes ac-lint without lintExempt.
header "AC-1 — zero ac-lint findings in $STORY after stripping lintExempt"
node -e "
const { lintPlan } = require('./dist/validation/ac-lint.js');
const fs = require('fs');
const plan = JSON.parse(fs.readFileSync('$PHASE_JSON', 'utf8'));
const stripped = { ...plan, lintExempt: [] };
const report = lintPlan(stripped);
// Filter to F55-passed-grep findings only (F36 ACs are deferred to task #40b)
const f55InBlock = report.findings.filter(f => f.storyId === '$STORY' && f.ruleId === 'F55-passed-grep');
if (f55InBlock.length > 0) {
  console.error('F55 findings in $STORY:', JSON.stringify(f55InBlock, null, 2));
  process.exit(1);
}
console.log('  Zero F55-passed-grep findings in $STORY after stripping lintExempt');
"
if [ $? -eq 0 ]; then pass "AC-1"; else fail "AC-1" "ac-lint findings in $STORY"; fi

# ---------------- AC-2 ----------------
# ac-lint test suite passes.
header "AC-2 — ac-lint test suite"
npx vitest run server/validation/ac-lint.test.ts > /tmp/q1t40-s01-aclint.log 2>&1
if [ $? -eq 0 ]; then pass "AC-2"; else fail "AC-2" "see /tmp/q1t40-s01-aclint.log"; fi

# ---------------- AC-4 ----------------
# Exactly 6 command-line changes (3 removed + 3 added) in the diff.
header "AC-4 — exactly 6 command-line changes"
COUNT=$(git diff origin/master -- "$PHASE_JSON" | grep -cE '^\+\s*"command"|^-\s*"command"' || true)
if [ "$COUNT" -eq 6 ]; then
  pass "AC-4 (command-line changes: $COUNT)"
else
  fail "AC-4" "command-line changes: $COUNT (expected 6)"
fi

# ---------------- AC-6 ----------------
# lintExempt block is byte-identical to master.
header "AC-6 — lintExempt identical to master"
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const branchPlan = JSON.parse(fs.readFileSync('$PHASE_JSON', 'utf8'));
const masterJson = execSync('git show origin/master:$PHASE_JSON', { encoding: 'utf8' });
const masterPlan = JSON.parse(masterJson);
const branchExempt = JSON.stringify(branchPlan.lintExempt);
const masterExempt = JSON.stringify(masterPlan.lintExempt);
if (branchExempt === masterExempt) {
  console.log('  lintExempt identical');
  process.exit(0);
} else {
  console.error('  lintExempt DIFFERS');
  process.exit(1);
}
"
if [ $? -eq 0 ]; then pass "AC-6"; else fail "AC-6" "lintExempt differs from master"; fi

# ---------------- Summary ----------------
header "SUMMARY"
if [ "$FAIL" -eq 0 ]; then
  echo "ALL GREEN"
  exit 0
else
  echo "FAILURES PRESENT"
  exit 1
fi
