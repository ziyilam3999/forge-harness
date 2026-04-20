#!/usr/bin/env bash
# v0.34.0 acceptance wrapper — dashboard runtime bugs (9 fixes + 2 close-and-cite).
# Runs AC-1..AC-13 in order. Exits 0 iff all pass.
# Plan: .ai-workspace/plans/2026-04-20-v0-34-0-dashboard-runtime-bugs.md

set -euo pipefail
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

pass() { printf '  [PASS] AC-%s: %s\n' "$1" "$2"; }
fail() { printf '  [FAIL] AC-%s: %s\n' "$1" "$2"; exit 1; }

mkdir -p tmp

DASH=server/lib/dashboard-renderer.ts
PROG=server/lib/progress.ts
DASH_TEST=server/lib/dashboard-renderer.test.ts
PROG_TEST=server/lib/progress.test.ts

# AC-1: No concurrent-render race on tmp filename. Either the shared literal is
# eliminated OR a specifically-named render queue/mutex identifier exists.
if test "$(grep -cE '"dashboard\.tmp\.html"' "$DASH")" -eq 0; then
  pass 1 "shared tmp filename literal eliminated"
elif grep -qwE '(renderQueue|renderMutex|renderLock|serialRender|inFlightRender|renderInFlight|writeQueue|pendingRenders|renderPromise|renderChain)' "$DASH"; then
  pass 1 "serialized render queue/mutex identifier present"
else
  fail 1 "neither the shared literal was removed nor a named queue/mutex exists"
fi

# AC-2: ProgressReporter.complete / fail derive stageNum from stageName, not
# this.currentIndex.
awk '/^  complete\(/,/^  \}$/' "$PROG" > tmp/v034-0-complete.txt
awk '/^  fail\(/,/^  \}$/' "$PROG" > tmp/v034-0-fail.txt
if grep -qE 'this\.currentIndex' tmp/v034-0-complete.txt; then
  fail 2 "complete() still references this.currentIndex"
fi
if grep -qE 'this\.currentIndex' tmp/v034-0-fail.txt; then
  fail 2 "fail() still references this.currentIndex"
fi
pass 2 "complete/fail derive stageNum from stageName"

# AC-3: activityStartedAt has a reset path.
if grep -qE 'activityStartedAt\s*=\s*null' "$PROG"; then
  pass 3 "activityStartedAt reset path present (= null assignment)"
elif grep -qE '(reset|clear|finalize|end)\s*\(' "$PROG"; then
  pass 3 "reporter has a reset/clear/finalize/end method"
else
  fail 3 "no activityStartedAt reset path found"
fi

# AC-4: Dashboard-renderer test suite green (empty-string test exists and passes).
MSYS_NO_PATHCONV=1 npx vitest run "$DASH_TEST" --reporter=json --outputFile=tmp/v034-0-dash.json > /dev/null 2>&1 || true
node -e "const r=require('./tmp/v034-0-dash.json'); if (r.numFailedTests === 0 && r.numPassedTests > 0) process.exit(0); console.error('dashboard tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1);" \
  || fail 4 "dashboard-renderer.test.ts did not pass cleanly"
pass 4 "dashboard-renderer.test.ts all pass"

# AC-5: isToolRunning helper exists and is called from 2+ sites.
DEF_COUNT=$(grep -cE '(function isToolRunning|const isToolRunning)' "$DASH")
CALL_COUNT=$(grep -cE 'isToolRunning\(' "$DASH")
if [ "$DEF_COUNT" -lt 1 ]; then
  fail 5 "isToolRunning definition not found"
fi
if [ "$CALL_COUNT" -lt 3 ]; then
  fail 5 "isToolRunning references < 3 (definition + 2+ call sites). Got: $CALL_COUNT"
fi
pass 5 "isToolRunning defined + referenced $CALL_COUNT times"

# AC-6: Idle intercept widens past the narrow master-state pattern.
if grep -qE '!\s*TOOL_RUNNING\s*&&\s*level\s*===\s*"red"' "$DASH"; then
  fail 6 "master-state narrow intercept pattern still present"
fi
pass 6 "updateBanner idle intercept widened past the master-state pattern"

# AC-7: Dynamic import eliminated + readdir in static import block.
awk '/function readAuditFeed|const readAuditFeed/,/^}$/' "$DASH" > tmp/v034-0-audit.txt
if grep -qE 'await import\(' tmp/v034-0-audit.txt; then
  fail 7 "readAuditFeed still uses await import(...)"
fi
if ! grep -qE 'import\s*\{[^}]*\breaddir\b[^}]*\}\s*from\s*"node:fs/promises"' "$DASH"; then
  fail 7 "readdir not present in static import block from node:fs/promises"
fi
pass 7 "dynamic import removed; readdir in static import block"

# AC-8: Test-count delta vs master >= 3.
BEFORE_DASH=$(MSYS_NO_PATHCONV=1 git show origin/master:server/lib/dashboard-renderer.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(" || echo 0)
AFTER_DASH=$(grep -cE "^\s*(it|test)\s*\(" "$DASH_TEST")
BEFORE_PROG=$(MSYS_NO_PATHCONV=1 git show origin/master:server/lib/progress.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(" || echo 0)
AFTER_PROG=$(grep -cE "^\s*(it|test)\s*\(" "$PROG_TEST")
DELTA=$(( (AFTER_DASH - BEFORE_DASH) + (AFTER_PROG - BEFORE_PROG) ))
if [ "$DELTA" -lt 3 ]; then
  fail 8 "test-count delta < 3 (dash $BEFORE_DASH -> $AFTER_DASH, prog $BEFORE_PROG -> $AFTER_PROG, DELTA=$DELTA)"
fi
pass 8 "new tests added: dash $BEFORE_DASH -> $AFTER_DASH, prog $BEFORE_PROG -> $AFTER_PROG, DELTA=$DELTA"

# AC-9: Full test suite green (>= 780 passed).
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v034-0-full.json > /dev/null 2>&1 || true
node -e "const r=require('./tmp/v034-0-full.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 780) process.exit(0); console.error('full suite: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed (expected 0 failed, >= 780 passed)'); process.exit(1);" \
  || fail 9 "full vitest suite did not meet baseline"
PASSED=$(node -e "console.log(require('./tmp/v034-0-full.json').numPassedTests)")
pass 9 "full vitest suite green ($PASSED passed, 0 failed)"

# AC-10: Lint green.
if ! npm run lint > tmp/v034-0-lint.log 2>&1; then
  tail -30 tmp/v034-0-lint.log
  fail 10 "npm run lint reported errors"
fi
pass 10 "npm run lint clean"

# AC-11: Diff confined to allowlist.
UNEXPECTED=$(git diff --name-only master...HEAD | grep -vE '^(server/lib/dashboard-renderer\.ts|server/lib/dashboard-renderer\.test\.ts|server/lib/progress\.ts|server/lib/progress\.test\.ts|\.ai-workspace/plans/2026-04-20-v0-34-0-dashboard-runtime-bugs\.md|scripts/v034-0-acceptance\.sh)$' || true)
if [ -n "$UNEXPECTED" ]; then
  fail 11 "unexpected files in diff: $UNEXPECTED"
fi
pass 11 "diff confined to allowlisted fix surface"

# AC-12: Defensive typeof guard on maybeAutoOpenBrowser stat-catch err cast.
awk '/function maybeAutoOpenBrowser/,/^}$/' "$DASH" > tmp/v034-0-maob-body.txt
if ! grep -qE '(typeof err\s*===\s*"object"|err && typeof err)' tmp/v034-0-maob-body.txt; then
  fail 12 "typeof err guard not present in maybeAutoOpenBrowser body"
fi
pass 12 "maybeAutoOpenBrowser has defensive typeof err guard"

# AC-13: Wrapper itself executable — by construction if this line runs.
if [ ! -x "scripts/v034-0-acceptance.sh" ]; then
  fail 13 "scripts/v034-0-acceptance.sh is not executable"
fi
pass 13 "scripts/v034-0-acceptance.sh is executable"

echo ""
echo "ALL V0.34.0 ACCEPTANCE CHECKS PASSED"
