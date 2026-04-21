#!/usr/bin/env bash
# Acceptance wrapper for v0.34.3 -- wrapper-hygiene polish slice.
# Runs AC-1..AC-11 + AC-13 from
#   .ai-workspace/plans/2026-04-20-v0-34-3-wrapper-hygiene.md
# Exits 0 iff every AC passes. AC-12 (this wrapper's own existence + green
# status) is satisfied by the fact that this script is being run; we do not
# self-check AC-12.
#
# Usage: bash scripts/v034-3-acceptance.sh
# Prereqs: node, npm, git, bash, awk, grep, sort, seq, wc, tr, test. No jq.
#
# Convention (matches corrector-crash-fix-acceptance.sh): collects failures
# into a FAILURES array and prints a summary at end rather than `set -e`
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

echo "=== v0.34.3 wrapper-hygiene acceptance ==="
echo

# ---------------------------------------------------------------------------
# AC-1 (#338): corrector-crash-fix-acceptance.sh has contiguous AC labels.
# Non-comment AC-N labels form 1..N with no gaps, no duplicates.
# ---------------------------------------------------------------------------
LABELS=$(grep -vE '^[[:space:]]*#' scripts/corrector-crash-fix-acceptance.sh \
  | grep -oE 'AC-[0-9]+' \
  | sort -u \
  | sed 's/AC-//' \
  | sort -n \
  | tr '\n' ',' \
  | sed 's/,$//')
N=$(echo "$LABELS" | tr ',' '\n' | wc -l | tr -d ' ')
EXPECTED=$(seq 1 "$N" | tr '\n' ',' | sed 's/,$//')
if [ "$LABELS" = "$EXPECTED" ]; then AC1=0; else AC1=1; fi
check "AC-1" "corrector wrapper AC labels contiguous 1..$N (got=$LABELS want=$EXPECTED)" "$AC1"

# ---------------------------------------------------------------------------
# AC-2 (#340a): corrector wrapper type-guards numFailedTests.
# ---------------------------------------------------------------------------
if grep -qE 'typeof[[:space:]]+d\.numFailedTests[[:space:]]*(!==|===)[[:space:]]*"number"' \
  scripts/corrector-crash-fix-acceptance.sh; then AC2=0; else AC2=1; fi
check "AC-2" "corrector wrapper has typeof numFailedTests === 'number' guard" "$AC2"

# ---------------------------------------------------------------------------
# AC-3 (#340b): default-max-tokens wrapper type-guards numFailedTests.
# ---------------------------------------------------------------------------
if grep -qE 'typeof[[:space:]]+d\.numFailedTests[[:space:]]*(!==|===)[[:space:]]*"number"' \
  scripts/default-max-tokens-sweep-acceptance.sh; then AC3=0; else AC3=1; fi
check "AC-3" "default-max-tokens wrapper has typeof numFailedTests === 'number' guard" "$AC3"

# ---------------------------------------------------------------------------
# AC-4 (#341): No /tmp/ac*.log references remain in the three affected
# wrappers. Per-file loop distinguishes grep exit 0 (match=fail), exit 1
# (no match=pass this file), and anything else (grep error=fail) -- avoids
# the `! grep` false-pass where exit 2 would flip to 0.
# ---------------------------------------------------------------------------
AC4=0
for f in \
  scripts/corrector-crash-fix-acceptance.sh \
  scripts/default-max-tokens-sweep-acceptance.sh \
  scripts/q1-cross-phase-acceptance.sh
do
  if [ ! -f "$f" ]; then
    echo "    missing file: $f"
    AC4=1
    continue
  fi
  OUT=$(grep -nE '/tmp/ac[0-9*]' "$f" 2>&1)
  RC=$?
  case $RC in
    0) echo "    /tmp/ac* match in $f:"; echo "$OUT" | sed 's/^/      /'; AC4=1 ;;
    1) : ;;  # no match = pass this file
    *) echo "    grep error (rc=$RC) on $f: $OUT"; AC4=1 ;;
  esac
done
check "AC-4" "no /tmp/ac*.log refs in 3 affected wrappers (corrector, default-max, q1)" "$AC4"

# ---------------------------------------------------------------------------
# AC-5 (#343): F57-cd-basename rule-object exists in AC_LINT_RULES.
# Matches the id property shape, tolerating single or double quotes.
# ---------------------------------------------------------------------------
if grep -qE 'id:[[:space:]]*["'\'']F57-cd-basename["'\'']' \
  server/lib/prompts/shared/ac-subprocess-rules.ts; then AC5=0; else AC5=1; fi
check "AC-5" "F57-cd-basename rule object present in AC_LINT_RULES" "$AC5"

# ---------------------------------------------------------------------------
# AC-6 (#343): F57 unit test exists and passes (and is actually discovered
# by vitest -- `numPassedTests >= 1` defeats --passWithNoTests silent-exit-0).
# ---------------------------------------------------------------------------
rm -f tmp/v034-3-f57.json
npx vitest run server/validation/ac-lint.test.ts -t "F57-cd-basename" \
  --reporter=json --outputFile=tmp/v034-3-f57.json > tmp/v034-3-f57.log 2>&1 || true
if [ -s tmp/v034-3-f57.json ] && node -e 'const d=JSON.parse(require("fs").readFileSync("tmp/v034-3-f57.json","utf8")); if (typeof d.numPassedTests !== "number" || d.numPassedTests < 1) { console.error("F57 test missing: numPassedTests=", d.numPassedTests); process.exit(1); } if (typeof d.numFailedTests !== "number") process.exit(2); if (d.numFailedTests > 0) process.exit(1); process.exit(0);'; then
  AC6=0
else
  AC6=1
fi
check "AC-6" "F57-cd-basename vitest filter yields numPassedTests>=1 and 0 failures" "$AC6"

# ---------------------------------------------------------------------------
# AC-7 (#344): ac-subprocess-rules.ts is fully ASCII (no byte > 0x7F).
# Node (not grep -P) to avoid the MSYS "unibyte/UTF-8 locale" exit-2 flip.
# ---------------------------------------------------------------------------
if node -e 'const s=require("fs").readFileSync("server/lib/prompts/shared/ac-subprocess-rules.ts","utf8"); process.exit(/[^\x00-\x7F]/.test(s)?1:0)'; then
  AC7=0
else
  AC7=1
fi
check "AC-7" "ac-subprocess-rules.ts is fully ASCII (no bytes > 0x7F)" "$AC7"

# ---------------------------------------------------------------------------
# AC-8 (#345): Each of the five cwd-policy tokens appears exactly once -- in
# its AC_CWD_POLICY_* constant declaration -- and nowhere else under
# server/lib/prompts/. Token 4 contains literal backticks so the assignments
# MUST be single-quoted in shell context.
# ---------------------------------------------------------------------------
AC8=0
# shellcheck disable=SC2016
TOKENS=(
  'cwd is ALREADY the project root'
  'cd <project-basename>'
  'cd my-project && npx tsc'
  'RIGHT: `npx tsc --noEmit`'
  'monday-bot/monday-bot/'
)
for TOKEN in "${TOKENS[@]}"; do
  COUNT=$(grep -rnF "$TOKEN" server/lib/prompts/ \
    | grep -vE 'AC_CWD_POLICY_[A-Z_]+[[:space:]]*=' \
    | wc -l | tr -d ' ')
  if [ "$COUNT" != "0" ]; then
    echo "    token leak: \"$TOKEN\" has $COUNT non-assignment occurrence(s)"
    grep -rnF "$TOKEN" server/lib/prompts/ | grep -vE 'AC_CWD_POLICY_[A-Z_]+[[:space:]]*=' | sed 's/^/      /'
    AC8=1
  fi
done
check "AC-8" "all 5 cwd-policy tokens single-sourced behind AC_CWD_POLICY_* constants" "$AC8"

# ---------------------------------------------------------------------------
# AC-9: Full vitest suite clean -- numFailedTests === 0 and numPassedTests
# >= 793 (master 792 + 1 for additive F57 coverage; our branch adds 7 F57
# tests so the real count is 799, which comfortably exceeds 793).
# The gap between the threshold and the real count is an intentional buffer
# for parallel-churn — concurrent slices landing between plan-time and
# executor-time can add/remove one or two tests and we don't want that
# noise to fail this historical release-pinned wrapper.
# ---------------------------------------------------------------------------
rm -f tmp/v034-3-full.json
npx vitest run --reporter=json --outputFile=tmp/v034-3-full.json > tmp/v034-3-full.log 2>&1 || true
if [ -s tmp/v034-3-full.json ] && node -e 'const d=JSON.parse(require("fs").readFileSync("tmp/v034-3-full.json","utf-8")); if (typeof d.numFailedTests !== "number") { console.error("numFailedTests missing"); process.exit(2); } if (d.numFailedTests > 0) { console.error("numFailedTests=", d.numFailedTests); process.exit(1); } if (typeof d.numPassedTests !== "number") { console.error("numPassedTests missing"); process.exit(3); } if (d.numPassedTests < 793) { console.error("numPassedTests=", d.numPassedTests, "below 793"); process.exit(1); } process.exit(0);'; then
  AC9=0
else
  AC9=1
fi
check "AC-9" "full vitest suite: numFailedTests=0 and numPassedTests>=793" "$AC9"

# ---------------------------------------------------------------------------
# AC-10: npm run lint exits 0.
# ---------------------------------------------------------------------------
if npm run lint > tmp/v034-3-lint.log 2>&1; then AC10=0; else AC10=1; fi
check "AC-10" "npm run lint exits 0" "$AC10"

# ---------------------------------------------------------------------------
# AC-11: npm run build exits 0.
# ---------------------------------------------------------------------------
if npm run build > tmp/v034-3-build.log 2>&1; then AC11=0; else AC11=1; fi
check "AC-11" "npm run build exits 0" "$AC11"

# ---------------------------------------------------------------------------
# AC-13: No drive-by edits. Branch diff vs origin/master touches only the
# allowlisted paths. Pre-fetch origin/master so the diff resolves on shallow
# CI clones.
# ---------------------------------------------------------------------------
git fetch --no-tags --prune --depth=100 origin master > tmp/v034-3-fetch.log 2>&1 || true
BAD=$(git diff --name-only origin/master...HEAD 2>/dev/null \
  | grep -vE '^(scripts/v034-3-acceptance\.sh|scripts/corrector-crash-fix-acceptance\.sh|scripts/default-max-tokens-sweep-acceptance\.sh|scripts/q1-cross-phase-acceptance\.sh|server/lib/prompts/shared/ac-subprocess-rules\.ts|server/lib/prompts/planner\.test\.ts|server/validation/ac-lint\.test\.ts|server/lib/lint-audit\.test\.ts|\.ai-workspace/plans/.+)$' \
  || true)
if [ -z "$BAD" ]; then AC13=0; else AC13=1; fi
if [ -n "$BAD" ]; then
  echo "    out-of-allowlist paths in diff:"
  echo "$BAD" | sed 's/^/      /'
fi
check "AC-13" "branch diff vs origin/master only touches allowlisted paths" "$AC13"

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
  echo "Inspect logs under tmp/v034-3-*.log for failing ACs."
  exit 1
fi

echo "ALL GREEN"
exit 0
