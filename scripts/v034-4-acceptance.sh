#!/usr/bin/env bash
# Acceptance wrapper for v0.34.4 -- anthropic/plan max-tokens follow-ups.
# Runs AC-1..AC-11 from
#   .ai-workspace/plans/2026-04-21-v0-34-4-anthropic-plan-max-tokens-followups.md
# Exits 0 iff every AC passes. AC-12 (this wrapper's own existence + green
# status) is satisfied by the fact that this script is being run; we do not
# self-check AC-12. AC-13 (PR body post-merge-close trailer for #350) is
# enforced at /ship + reviewer time against the live PR body -- cannot be
# checked from the branch alone, so this wrapper does not attempt it.
#
# Usage: bash scripts/v034-4-acceptance.sh
# Prereqs: node, npm, git, bash, grep, wc, sort. No jq.
#
# Convention (matches v034-3-acceptance.sh): collects failures into a
# FAILURES array and prints a summary at end rather than `set -e`
# first-fail-exit, so a single AC failure does not hide downstream failures.

set -u
# MSYS_NO_PATHCONV=1 disables Git Bash path mangling when any downstream step
# uses `origin/master:<path>` syntax. Cheap insurance; harmless when unused.
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
declare -a FAILURES

# tmp/ hosts vitest JSON output + logs. Project-relative so MSYS bash and
# node.exe see the same path on Windows (#341).
mkdir -p tmp

check() {
  local name="$1"
  local description="$2"
  local exit_code="$3"
  if [ "$exit_code" -eq 0 ]; then
    echo "  PASS  $name  $description"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name  $description"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name: $description")
  fi
}

echo "=== v0.34.4 anthropic/plan max-tokens follow-ups acceptance ==="
echo

# ---------------------------------------------------------------------------
# AC-1 (#347): exactly one `expect(mockCreate).not.toHaveBeenCalled` remains
# in anthropic.test.ts -- the suite-scoped afterEach tripwire. The in-test
# duplicate inside the `callClaude -- transport` describe block is gone.
# ---------------------------------------------------------------------------
COUNT=$(grep -c 'expect(mockCreate)\.not\.toHaveBeenCalled' server/lib/anthropic.test.ts)
if [ "$COUNT" = "1" ]; then AC1=0; else AC1=1; fi
check "AC-1" "exactly one mockCreate tripwire remains (got=$COUNT want=1)" "$AC1"

# ---------------------------------------------------------------------------
# AC-2 (#347): transport test still asserts its specific mockStream count.
# ---------------------------------------------------------------------------
COUNT=$(grep -c 'expect(mockStream)\.toHaveBeenCalledTimes(1)' server/lib/anthropic.test.ts)
if [ "$COUNT" -ge 1 ]; then AC2=0; else AC2=1; fi
check "AC-2" "mockStream toHaveBeenCalledTimes(1) present (got=$COUNT want>=1)" "$AC2"

# ---------------------------------------------------------------------------
# AC-3 (#348): console.error fires in the IIFE fallback branch with the
# FORGE_CORRECTOR_MAX_TOKENS token on the same line.
# ---------------------------------------------------------------------------
COUNT=$(grep -c 'console\.error.*FORGE_CORRECTOR_MAX_TOKENS' server/tools/plan.ts)
if [ "$COUNT" = "1" ]; then AC3=0; else AC3=1; fi
check "AC-3" "console.error with FORGE_CORRECTOR_MAX_TOKENS in plan.ts (got=$COUNT want=1)" "$AC3"

# ---------------------------------------------------------------------------
# AC-4 (#348): test asserts console.error was called. Two-stage grep --
# stage 1 filters to lines mentioning console.error or FORGE_CORRECTOR_MAX_TOKENS,
# stage 2 counts how many of those also contain toHaveBeenCalledWith or
# `spyOn.*console`. Need >= 1.
# ---------------------------------------------------------------------------
COUNT=$(grep -E 'console\.error|FORGE_CORRECTOR_MAX_TOKENS' server/tools/plan.test.ts \
  | grep -c 'toHaveBeenCalledWith\|spyOn.*console')
if [ "$COUNT" -ge 1 ]; then AC4=0; else AC4=1; fi
check "AC-4" "plan.test.ts asserts console.error via spy (got=$COUNT want>=1)" "$AC4"

# ---------------------------------------------------------------------------
# AC-5a (#349): the `const _exhaustive: never = stopReason` compile-time
# guard is preserved inside isMaxTokensStop.
# ---------------------------------------------------------------------------
COUNT=$(node -e "const s = require('fs').readFileSync('server/lib/anthropic.ts', 'utf8'); const m = s.match(/function isMaxTokensStop[\s\S]*?\n}/); process.stdout.write(m ? m[0] : 'NOT_FOUND');" \
  | grep -c 'const _exhaustive: never = stopReason')
if [ "$COUNT" = "1" ]; then AC5a=0; else AC5a=1; fi
check "AC-5a" "exhaustiveness never-guard preserved in isMaxTokensStop (got=$COUNT want=1)" "$AC5a"

# ---------------------------------------------------------------------------
# AC-5b (#349): isMaxTokensStop has at least two `return false;` statements
# (the known-non-truncation case block AND the default fail-safe).
# ---------------------------------------------------------------------------
COUNT=$(node -e "const s = require('fs').readFileSync('server/lib/anthropic.ts', 'utf8'); const m = s.match(/function isMaxTokensStop[\s\S]*?\n}/); process.stdout.write(m ? m[0] : 'NOT_FOUND');" \
  | grep -cE 'return\s+false\s*;')
if [ "$COUNT" -ge 2 ]; then AC5b=0; else AC5b=1; fi
check "AC-5b" "isMaxTokensStop returns false in >=2 branches (got=$COUNT want>=2)" "$AC5b"

# ---------------------------------------------------------------------------
# AC-6 (#349): a fail-safe test exists in anthropic.test.ts referencing
# unknown stop_reason / unknown variant / fail-safe / _exhaustive wording.
# ---------------------------------------------------------------------------
COUNT=$(grep -c 'unknown.*stop_reason\|unknown.*variant\|stop_reason.*unknown\|_exhaustive\|fail-safe' server/lib/anthropic.test.ts)
if [ "$COUNT" -ge 1 ]; then AC6=0; else AC6=1; fi
check "AC-6" "fail-safe test present for isMaxTokensStop default branch (got=$COUNT want>=1)" "$AC6"

# ---------------------------------------------------------------------------
# AC-7 (#350): JSDoc in plan.ts acknowledges the module-load trade-off
# using one of the four sanctioned phrasings.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE 'runtime reconfig|runtime override requires|process restart|resolved at module load' server/tools/plan.ts)
if [ "$COUNT" -ge 1 ]; then AC7=0; else AC7=1; fi
check "AC-7" "CORRECTOR_MAX_TOKENS JSDoc documents module-load design (got=$COUNT want>=1)" "$AC7"

# ---------------------------------------------------------------------------
# AC-8: full vitest suite clean -- numFailedTests === 0 and
# numPassedTests >= 800 (master baseline 799 + at least 1 new test for #349).
# ---------------------------------------------------------------------------
rm -f tmp/v034-4-full.json
npx vitest run --reporter=json --outputFile=tmp/v034-4-full.json > tmp/v034-4-full.log 2>&1 || true
if [ -s tmp/v034-4-full.json ] && node -e 'const d=JSON.parse(require("fs").readFileSync("tmp/v034-4-full.json","utf8")); if (typeof d.numFailedTests !== "number") { console.error("numFailedTests missing"); process.exit(2); } if (d.numFailedTests > 0) { console.error("numFailedTests=", d.numFailedTests); process.exit(1); } if (typeof d.numPassedTests !== "number") { console.error("numPassedTests missing"); process.exit(3); } if (d.numPassedTests < 800) { console.error("numPassedTests=", d.numPassedTests, "below 800"); process.exit(1); } process.exit(0);'; then
  AC8=0
else
  AC8=1
fi
check "AC-8" "full vitest suite: numFailedTests=0 and numPassedTests>=800" "$AC8"

# ---------------------------------------------------------------------------
# AC-9: npm run lint exits 0.
# ---------------------------------------------------------------------------
if npm run lint > tmp/v034-4-lint.log 2>&1; then AC9=0; else AC9=1; fi
check "AC-9" "npm run lint exits 0" "$AC9"

# ---------------------------------------------------------------------------
# AC-10: npm run build exits 0.
# ---------------------------------------------------------------------------
if npm run build > tmp/v034-4-build.log 2>&1; then AC10=0; else AC10=1; fi
check "AC-10" "npm run build exits 0" "$AC10"

# ---------------------------------------------------------------------------
# AC-11: No drive-by edits. Branch diff vs origin/master touches only the
# allowlisted paths. Pre-fetch origin/master so the diff resolves on shallow
# CI clones. CHANGELOG.md, package.json, package-lock.json are deliberately
# excluded from the allowlist -- those are /ship Stage 7 release-stage edits.
# ---------------------------------------------------------------------------
git fetch --no-tags --prune --depth=100 origin master > tmp/v034-4-fetch.log 2>&1 || true
BAD=$(git diff --name-only origin/master...HEAD 2>/dev/null \
  | grep -vE '^(server/lib/anthropic\.ts|server/lib/anthropic\.test\.ts|server/tools/plan\.ts|server/tools/plan\.test\.ts|scripts/v034-4-acceptance\.sh|\.ai-workspace/plans/)' \
  || true)
if [ -z "$BAD" ]; then AC11=0; else AC11=1; fi
if [ -n "$BAD" ]; then
  echo "    out-of-allowlist paths in diff:"
  echo "$BAD" | sed 's/^/      /'
fi
check "AC-11" "branch diff vs origin/master only touches allowlisted paths" "$AC11"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "=== summary: $PASS pass / $FAIL fail ==="

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "FAILURES:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo
  echo "Inspect logs under tmp/v034-4-*.log for failing ACs."
  exit 1
fi

echo "ALL GREEN"
exit 0
