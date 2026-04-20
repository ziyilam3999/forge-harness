#!/usr/bin/env bash
# v0.33.1 acceptance wrapper — coordinator checkBudget / checkTimeBudget zero-emit fix.
# Runs AC-1..AC-8 in order. Exits 0 iff all pass.
# Monday's 2026-04-20 dashboard report (thread: forge-dashboard-budget-time-zero-bug).

set -euo pipefail
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

pass() { printf '  [PASS] AC-%s: %s\n' "$1" "$2"; }
fail() { printf '  [FAIL] AC-%s: %s\n' "$1" "$2"; exit 1; }

mkdir -p tmp

# AC-1: checkBudget aggregation runs BEFORE the budgetUsd null-check gate.
awk '/^export function checkBudget/,/^}$/' server/lib/coordinator.ts > tmp/v033-1-checkbudget.txt
AGG=$(grep -n 'usedUsd += ' tmp/v033-1-checkbudget.txt | head -1 | cut -d: -f1)
GATE=$(grep -n 'budgetUsd === undefined' tmp/v033-1-checkbudget.txt | head -1 | cut -d: -f1)
if [ -z "$AGG" ] || [ -z "$GATE" ]; then
  fail 1 "could not locate aggregation line ('$AGG') or gate line ('$GATE') in checkBudget"
fi
if [ "$AGG" -ge "$GATE" ]; then
  fail 1 "aggregation line ($AGG) is not above the budgetUsd null-check gate ($GATE)"
fi
pass 1 "checkBudget aggregation runs before budgetUsd null-check (line $AGG < $GATE)"

# AC-2: checkTimeBudget signature accepts an optional priorRecords parameter.
SIG_MATCH=$(grep -E '^export function checkTimeBudget\(' server/lib/coordinator.ts | grep -c 'priorRecords')
if [ "$SIG_MATCH" -ne 1 ]; then
  fail 2 "checkTimeBudget signature does not mention priorRecords (matches: $SIG_MATCH)"
fi
pass 2 "checkTimeBudget signature accepts priorRecords parameter"

# AC-3: all existing coordinator tests still pass.
npx vitest run server/lib/coordinator.test.ts --reporter=json --outputFile=tmp/v033-1-existing.json > /dev/null 2>&1 || true
node -e "const r=require('./tmp/v033-1-existing.json'); if (r.numFailedTests === 0 && r.numPassedTests > 0) process.exit(0); console.error('coordinator tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1);" \
  || fail 3 "coordinator.test.ts did not pass cleanly"
pass 3 "coordinator.test.ts all pass"

# AC-4 / AC-5: test-count delta vs master (≥ 2 new it/test blocks across the two bugs).
BEFORE=$(git show master:server/lib/coordinator.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(")
AFTER=$(grep -cE "^\s*(it|test)\s*\(" server/lib/coordinator.test.ts)
DELTA=$((AFTER - BEFORE))
if [ "$AFTER" -le "$BEFORE" ]; then
  fail 4 "no new test blocks added (BEFORE=$BEFORE, AFTER=$AFTER)"
fi
pass 4 "new test block(s) added (BEFORE=$BEFORE, AFTER=$AFTER, DELTA=$DELTA)"

if [ "$DELTA" -lt 2 ]; then
  fail 5 "fewer than 2 new test blocks (DELTA=$DELTA)"
fi
pass 5 "≥ 2 new test blocks covering checkBudget + checkTimeBudget fallbacks (DELTA=$DELTA)"

# AC-6: full test suite green, ≥ 776 passed.
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v033-1-full.json > /dev/null 2>&1 || true
node -e "const r=require('./tmp/v033-1-full.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 776) process.exit(0); console.error('full suite: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed (expected 0 failed, >= 776 passed)'); process.exit(1);" \
  || fail 6 "full vitest suite did not meet baseline"
PASSED=$(node -e "console.log(require('./tmp/v033-1-full.json').numPassedTests)")
pass 6 "full vitest suite green ($PASSED passed, 0 failed)"

# AC-7: diff confined to the four allowlisted files.
UNEXPECTED=$(git diff --name-only master...HEAD | grep -vE '^(server/lib/coordinator\.ts|server/lib/coordinator\.test\.ts|\.ai-workspace/plans/2026-04-20-coordinator-zero-emit-fix\.md|scripts/v033-1-acceptance\.sh)$' || true)
if [ -n "$UNEXPECTED" ]; then
  fail 7 "unexpected files in diff: $UNEXPECTED"
fi
pass 7 "diff confined to allowlisted fix surface"

# AC-8: wrapper is executable — by construction if this line runs.
if [ ! -x "scripts/v033-1-acceptance.sh" ]; then
  fail 8 "scripts/v033-1-acceptance.sh is not executable"
fi
pass 8 "scripts/v033-1-acceptance.sh is executable"

echo ""
echo "ALL V0.33.1 ACCEPTANCE CHECKS PASSED"
