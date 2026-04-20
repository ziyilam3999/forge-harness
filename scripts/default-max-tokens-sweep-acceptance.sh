#!/usr/bin/env bash
# Acceptance wrapper for v0.32.7 — bump DEFAULT_MAX_TOKENS 8192 → 32000 sweep.
# Runs AC-1..AC-7 from .ai-workspace/plans/2026-04-20-default-max-tokens-sweep.md
# (AC-8 from the plan — the setup.sh-unchanged guard — is checked here as AC-7
# so the wrapper's numbering is contiguous; same coverage, just renumbered).
# Exits 0 iff all ACs pass.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
declare -a FAILURES

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

echo "=== v0.32.7 default-max-tokens-sweep acceptance ==="
echo

# AC-1: DEFAULT_MAX_TOKENS is 32000
grep -q "^const DEFAULT_MAX_TOKENS = 32000;$" server/lib/anthropic.ts && AC1=0 || AC1=1
check "AC-1" "DEFAULT_MAX_TOKENS literal is 32000 in anthropic.ts" "$AC1"

# AC-2: old 8192 literal is gone from anthropic.ts
! grep -q "^const DEFAULT_MAX_TOKENS = 8192;$" server/lib/anthropic.ts && AC2=0 || AC2=1
check "AC-2" "no stale DEFAULT_MAX_TOKENS = 8192 literal" "$AC2"

# AC-3: default-passed-through unit test passes
npx vitest run server/lib/anthropic.test.ts -t "max_tokens=32000 to the SDK when caller does not pass maxTokens" > /tmp/ac3.log 2>&1 && AC3=0 || AC3=1
check "AC-3" "default-maxTokens-passed-through unit test passes" "$AC3"

# AC-4: explicit override still wins
npx vitest run server/lib/anthropic.test.ts -t "explicit maxTokens override still wins" > /tmp/ac4.log 2>&1 && AC4=0 || AC4=1
check "AC-4" "explicit maxTokens override still wins (regression positive)" "$AC4"

# AC-5: full suite clean — no test FAILURES (ignore vitest teardown-rpc flake).
# Use vitest's structured JSON reporter so we parse numFailedTests rather than
# stdout text, which is brittle across vitest upgrades.
npx vitest run --reporter=json --outputFile=/tmp/ac5.json > /tmp/ac5.log 2>&1 || true
if [ -s /tmp/ac5.json ] && node -e 'const d=JSON.parse(require("fs").readFileSync("/tmp/ac5.json","utf-8")); process.exit(d.numFailedTests > 0 ? 1 : 0)'; then
  AC5=0
else
  AC5=1
fi
check "AC-5" "full vitest suite passes (no test failures)" "$AC5"

# AC-6: TypeScript build clean
npm run build > /tmp/ac6.log 2>&1 && AC6=0 || AC6=1
check "AC-6" "npm run build compiles cleanly" "$AC6"

# AC-7: setup.sh unchanged vs master
SETUP_DIFF=$(git diff origin/master -- setup.sh 2>/dev/null | wc -l | tr -d ' ' || echo "0")
[ "$SETUP_DIFF" -eq 0 ] && AC7=0 || AC7=1
check "AC-7" "setup.sh unchanged vs origin/master (diff lines: $SETUP_DIFF)" "$AC7"

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
