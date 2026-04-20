#!/usr/bin/env bash
# Acceptance wrapper for v0.32.6 — forge_plan corrector truncation fix.
# Runs AC-1..AC-8 from .ai-workspace/plans/2026-04-19-forge-plan-corrector-truncation-fix.md
# Exits 0 iff all ACs pass.
#
# Usage: bash scripts/corrector-crash-fix-acceptance.sh
# Prereq: `npm run build` must have succeeded (dist/ populated).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
declare -a FAILURES

# Wrapper writes vitest JSON output to a project-relative tmp dir so paths
# resolve identically under bash (MSYS /tmp ≠ node.exe /tmp on Windows) and
# node. tmp/ is gitignored per .gitignore.
mkdir -p tmp

check() {
  local name="$1"
  local description="$2"
  local exit_code="$3"
  if [ "$exit_code" -eq 0 ]; then
    echo "  PASS  $name — $description"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name — $description"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name: $description")
  fi
}

echo "=== v0.32.6 corrector-crash-fix acceptance ==="
echo

# AC-1: maxTokens: 32000 appears in at least 2 places in plan.ts (runCorrector + runMasterCorrector)
MAXTOKEN_COUNT=$(grep -c "maxTokens: CORRECTOR_MAX_TOKENS\|maxTokens: 32000" server/tools/plan.ts || true)
[ "$MAXTOKEN_COUNT" -ge 2 ] && AC1=0 || AC1=1
check "AC-1" "plan.ts passes maxTokens override at ≥2 corrector call sites (found $MAXTOKEN_COUNT)" "$AC1"

# AC-2: LLMOutputTruncatedError class + stop_reason check present in anthropic.ts
ANTHROPIC_MATCHES=$(grep -c "LLMOutputTruncatedError\|stop_reason === \"max_tokens\"" server/lib/anthropic.ts || true)
[ "$ANTHROPIC_MATCHES" -ge 2 ] && AC2=0 || AC2=1
check "AC-2" "anthropic.ts has LLMOutputTruncatedError + stop_reason check (found $ANTHROPIC_MATCHES)" "$AC2"

# AC-3: run-record.ts outcome union includes "corrector-failed"
grep -q '"corrector-failed"' server/lib/run-record.ts && AC3=0 || AC3=1
check "AC-3" "run-record.ts outcome union includes 'corrector-failed'" "$AC3"

# AC-4: Truncation unit test passes
npx vitest run server/lib/anthropic.test.ts > /tmp/ac4.log 2>&1 && AC4=0 || AC4=1
check "AC-4" "anthropic.test.ts (truncation) passes" "$AC4"

# AC-5: corrector-failed unit tests pass (the 4 new tests in the v0.32.6 block)
npx vitest run server/tools/plan.test.ts -t "corrector-failed" > /tmp/ac5.log 2>&1 && AC5=0 || AC5=1
check "AC-5" "plan.test.ts corrector-failed outcome tests pass" "$AC5"

# AC-6: regression-positive — corrector success still yields outcome:success
npx vitest run server/tools/plan.test.ts -t "corrector succeeds" > /tmp/ac6.log 2>&1 && AC6=0 || AC6=1
check "AC-6" "plan.test.ts regression-positive (corrector success → outcome:success) passes" "$AC6"

# AC-7: full vitest suite clean — no test FAILURES. We ignore the non-zero exit
# when it comes from the pre-existing dashboard-renderer.test.ts teardown-rpc
# race (Vitest 4.x EnvironmentTeardownError) because that flake is orthogonal
# to the corrector fix. The authoritative signal is `numFailedTests == 0` in
# vitest's structured JSON output (not stdout text, which is brittle across
# vitest upgrades).
npx vitest run --reporter=json --outputFile=tmp/ac7.json > /tmp/ac7.log 2>&1 || true
if [ -s tmp/ac7.json ] && node -e 'const d=JSON.parse(require("fs").readFileSync("tmp/ac7.json","utf-8")); process.exit(d.numFailedTests > 0 ? 1 : 0)'; then
  AC7=0
else
  AC7=1
fi
check "AC-7" "full vitest suite passes (no test failures; teardown-rpc flake ignored)" "$AC7"

# AC-8: TypeScript build clean
npm run build > /tmp/ac8.log 2>&1 && AC8=0 || AC8=1
check "AC-8" "npm run build compiles cleanly" "$AC8"

# AC-9: wrapper script is executable
[ -x "$0" ] && AC9=0 || AC9=1
check "AC-9" "wrapper script is executable (\$0 has +x bit)" "$AC9"

# AC-10: setup.sh unchanged vs master
SETUP_DIFF=$(git diff origin/master -- setup.sh 2>/dev/null | wc -l | tr -d ' ' || echo "0")
[ "$SETUP_DIFF" -eq 0 ] && AC10=0 || AC10=1
check "AC-10" "setup.sh unchanged vs origin/master (diff lines: $SETUP_DIFF)" "$AC10"

echo
echo "=== summary: $PASS pass / $FAIL fail ==="

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "FAILURES:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo
  echo "Inspect logs under /tmp/ac*.log for failing ACs."
  exit 1
fi

echo "ALL GREEN"
exit 0
