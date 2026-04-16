#!/usr/bin/env bash
# Task #40 slice 4 — PH01-US-03 AC rewrite acceptance wrapper.
# Runs AC-1, AC-2, AC-3, AC-4, AC-5/AC-10, AC-6, AC-7/8/9 from the task #40 plan.
# Exits 0 iff all pass.
#
# MSYS_NO_PATHCONV=1 prevents Windows MSYS bash from silently mangling
# /<path> arguments passed to git — task #22 learning #2.
export MSYS_NO_PATHCONV=1

set -u
FAIL=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHASE_JSON=".ai-workspace/plans/forge-coordinate-phase-PH-01.json"
STORY="PH01-US-03"
F55_COUNT=7

header () { printf '\n=== %s ===\n' "$1"; }
pass   () { printf 'PASS %s\n' "$1"; }
fail   () { printf 'FAIL %s — %s\n' "$1" "$2"; FAIL=1; }

# ---------------- AC-1 ----------------
# Every AC in PH01-US-03 passes ac-lint without lintExempt (F55 only).
header "AC-1 — zero F55-passed-grep findings in $STORY after stripping lintExempt"
node -e "
const { lintPlan } = require('./dist/validation/ac-lint.js');
const fs = require('fs');
const plan = JSON.parse(fs.readFileSync('$PHASE_JSON', 'utf8'));
const stripped = { ...plan, lintExempt: [] };
const report = lintPlan(stripped);
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
npx vitest run server/validation/ac-lint.test.ts > /tmp/q1t40-s04-aclint.log 2>&1
if [ $? -eq 0 ]; then pass "AC-2"; else fail "AC-2" "see /tmp/q1t40-s04-aclint.log"; fi

# ---------------- AC-3 ----------------
# Every rewritten AC command is mechanically executable.
header "AC-3 — rewritten AC commands are executable"
AC3_FAIL=0
for ACID in PH01-US-03-AC03 PH01-US-03-AC04 PH01-US-03-AC05 PH01-US-03-AC06 PH01-US-03-AC07 PH01-US-03-AC08 PH01-US-03-AC09; do
  SCRIPT=$(mktemp --suffix=.sh)
  node -e "
    const fs = require('fs');
    const plan = JSON.parse(fs.readFileSync('$PHASE_JSON', 'utf8'));
    const story = plan.stories.find(s => s.id === '$STORY');
    const ac = story.acceptanceCriteria.find(a => a.id === process.argv[1]);
    process.stdout.write(ac.command);
  " "$ACID" > "$SCRIPT"
  # Unset MSYS_NO_PATHCONV for the AC command subshell — it interferes
  # with mktemp/vitest --outputFile path translation on Windows MSYS.
  # Empty string is not enough; MSYS checks presence, not value.
  (unset MSYS_NO_PATHCONV; bash "$SCRIPT")
  RC=$?
  rm -f "$SCRIPT"
  if [ $RC -eq 0 ]; then
    printf '  %s: exit 0 (PASS)\n' "$ACID"
  else
    printf '  %s: exit %d (FAIL)\n' "$ACID" "$RC"
    AC3_FAIL=1
  fi
done
if [ $AC3_FAIL -eq 0 ]; then pass "AC-3"; else fail "AC-3" "one or more rewritten ACs failed"; fi

# ---------------- AC-4 ----------------
# Exactly 2*F55_COUNT command-line changes in the diff.
header "AC-4 — exactly $((F55_COUNT * 2)) command-line changes"
COUNT=$(git diff origin/master -- "$PHASE_JSON" | grep -cE '^\+\s*"command"|^-\s*"command"' || true)
EXPECTED=$((F55_COUNT * 2))
if [ "$COUNT" -eq "$EXPECTED" ]; then
  pass "AC-4 (command-line changes: $COUNT)"
else
  fail "AC-4" "command-line changes: $COUNT (expected $EXPECTED)"
fi

# ---------------- AC-5 / AC-10 ----------------
# Diff confined to phase JSON + acceptance wrapper only.
header "AC-5 / AC-10 — diff confined to allowlist"
DIFF_FILES=$(git diff origin/master...HEAD --name-only)
BAD_FILES=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .ai-workspace/plans/forge-coordinate-phase-PH-01.json) ;;
    scripts/q1-t40-04-acceptance.sh) ;;
    *) BAD_FILES="$BAD_FILES $f" ;;
  esac
done <<< "$DIFF_FILES"
if [ -z "$BAD_FILES" ]; then
  pass "AC-5 / AC-10"
else
  fail "AC-5 / AC-10" "unexpected files:$BAD_FILES"
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

# ---------------- AC-7 / AC-8 / AC-9 ----------------
# Build, lint, test delta-clean vs master.
header "AC-7 — npm run build"
npm run build > /tmp/q1t40-s04-build.log 2>&1
if [ $? -eq 0 ]; then pass "AC-7"; else fail "AC-7" "see /tmp/q1t40-s04-build.log"; fi

header "AC-8 — npm run lint"
npm run lint > /tmp/q1t40-s04-lint.log 2>&1
if [ $? -eq 0 ]; then pass "AC-8"; else fail "AC-8" "see /tmp/q1t40-s04-lint.log"; fi

header "AC-9 — npm test"
npm test > /tmp/q1t40-s04-test.log 2>&1
if [ $? -eq 0 ]; then pass "AC-9"; else fail "AC-9" "see /tmp/q1t40-s04-test.log"; fi

# ---------------- Summary ----------------
header "SUMMARY"
if [ "$FAIL" -eq 0 ]; then
  echo "ALL GREEN"
  exit 0
else
  echo "FAILURES PRESENT"
  exit 1
fi
