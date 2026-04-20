#!/usr/bin/env bash
# v0.34.1 acceptance wrapper — dashboard tests + polish (4 real fixes + 3 close-and-cite).
# Runs AC-1..AC-10 in order. Exits 0 iff all pass.
# Plan: .ai-workspace/plans/2026-04-20-v0-34-1-dashboard-tests-polish.md

set -euo pipefail
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

pass() { printf '  [PASS] AC-%s: %s\n' "$1" "$2"; }
fail() { printf '  [FAIL] AC-%s: %s\n' "$1" "$2"; exit 1; }

mkdir -p tmp

DASH=server/lib/dashboard-renderer.ts
DASH_TEST=server/lib/dashboard-renderer.test.ts

# AC-1: `useAutoOpenEnvGate` has a JSDoc docstring that documents the hook
# registration (register/install/hook keyword, case-insensitive).
grep -B 30 '^function useAutoOpenEnvGate' "$DASH_TEST" | tail -30 > tmp/v034-1-envgate-jsdoc.txt
if ! grep -qE '^\s*\*/' tmp/v034-1-envgate-jsdoc.txt; then
  fail 1 "no JSDoc close marker (*/) found in 30 lines preceding useAutoOpenEnvGate"
fi
if ! grep -qiE '(register|install|hook)' tmp/v034-1-envgate-jsdoc.txt; then
  fail 1 "JSDoc block preceding useAutoOpenEnvGate does not mention register/install/hook"
fi
pass 1 "useAutoOpenEnvGate has JSDoc documenting hook registration"

# AC-2: `const eperm = Object.assign(...)` is not present — inlined or removed.
if grep -qE 'const\s+eperm\s*=' "$DASH_TEST"; then
  fail 2 "const eperm = ... still present; should be inlined at its single use-site"
fi
pass 2 "eperm constant inlined"

# AC-3: `maybeAutoOpenBrowser` docstring notes per-invocation env check.
grep -B 30 '^export async function maybeAutoOpenBrowser' "$DASH" | tail -30 > tmp/v034-1-maob-jsdoc.txt
if ! grep -qiE '(per[- ]invocation|per[- ]call|per[- ]render|re[- ]read|each call|each invocation|toggled? mid)' tmp/v034-1-maob-jsdoc.txt; then
  fail 3 "maybeAutoOpenBrowser docstring does not note per-invocation env-var check"
fi
pass 3 "maybeAutoOpenBrowser docstring notes per-invocation env check"

# AC-4: chooseBannerCopy helper exists at top level and is serialized into the IIFE.
if ! grep -qE '^(export )?function chooseBannerCopy\(' "$DASH"; then
  fail 4 "top-level function chooseBannerCopy(...) not declared"
fi
if ! grep -qE 'chooseBannerCopy\.toString\(\)' "$DASH"; then
  fail 4 "chooseBannerCopy.toString() not serialized into dashboard HTML"
fi
if ! grep -qE 'chooseBannerCopy\(' "$DASH"; then
  fail 4 "chooseBannerCopy(...) not called anywhere in the renderer"
fi
pass 4 "chooseBannerCopy defined, serialized via .toString(), and called"

# AC-5: Unit test exercises chooseBannerCopy — helper invoked (call-with-parens).
if ! grep -qE 'chooseBannerCopy\(' "$DASH_TEST"; then
  fail 5 "chooseBannerCopy is not invoked in dashboard-renderer.test.ts"
fi
pass 5 "dashboard-renderer.test.ts invokes chooseBannerCopy"

# AC-6: Test count delta >= 1 vs master.
BEFORE_DASH=$(MSYS_NO_PATHCONV=1 git show origin/master:server/lib/dashboard-renderer.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(" || echo 0)
AFTER_DASH=$(grep -cE "^\s*(it|test)\s*\(" "$DASH_TEST")
DELTA=$(( AFTER_DASH - BEFORE_DASH ))
if [ "$DELTA" -lt 1 ]; then
  fail 6 "test-count delta < 1 (dashboard: $BEFORE_DASH -> $AFTER_DASH, DELTA=$DELTA)"
fi
pass 6 "new tests added (dashboard: $BEFORE_DASH -> $AFTER_DASH, DELTA=$DELTA)"

# AC-7: Full test suite green (>= 785 passed).
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v034-1-full.json > /dev/null 2>&1 || true
node -e "const r=require('./tmp/v034-1-full.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 785) process.exit(0); console.error('full suite: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed (expected 0 failed, >= 785 passed)'); process.exit(1);" \
  || fail 7 "full vitest suite did not meet baseline"
PASSED=$(node -e "console.log(require('./tmp/v034-1-full.json').numPassedTests)")
pass 7 "full vitest suite green ($PASSED passed, 0 failed)"

# AC-8: Lint green.
if ! npm run lint > tmp/v034-1-lint.log 2>&1; then
  tail -30 tmp/v034-1-lint.log
  fail 8 "npm run lint reported errors"
fi
pass 8 "npm run lint clean"

# AC-9: Diff confined to allowlist.
UNEXPECTED=$(git diff --name-only master...HEAD | grep -vE '^(server/lib/dashboard-renderer\.ts|server/lib/dashboard-renderer\.test\.ts|\.ai-workspace/plans/2026-04-20-v0-34-1-dashboard-tests-polish\.md|scripts/v034-1-acceptance\.sh)$' || true)
if [ -n "$UNEXPECTED" ]; then
  fail 9 "unexpected files in diff: $UNEXPECTED"
fi
pass 9 "diff confined to allowlisted fix surface"

# AC-10: Wrapper itself is executable — by construction if this line runs.
if [ ! -x "scripts/v034-1-acceptance.sh" ]; then
  fail 10 "scripts/v034-1-acceptance.sh is not executable"
fi
pass 10 "scripts/v034-1-acceptance.sh is executable"

echo ""
echo "ALL V0.34.1 ACCEPTANCE CHECKS PASSED"
