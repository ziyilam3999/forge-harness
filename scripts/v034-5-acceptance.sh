#!/usr/bin/env bash
# Acceptance wrapper for v0.34.5 -- evaluate-max-tokens-audit refinements.
# Runs AC-1..AC-10 from
#   .ai-workspace/plans/2026-04-21-v0-34-5-evaluate-audit-refinements.md
# Exits 0 iff every AC passes. AC-11 (PR body Fixes trailer) is reviewer-only
# and requires the live PR URL. AC-12 (this wrapper's own existence + green
# status) is satisfied by the fact that this script is being run; we do not
# self-check AC-12.
#
# Usage: bash scripts/v034-5-acceptance.sh
# Prereqs: node, npm, git, bash, grep, wc. No jq.
#
# Convention (matches v034-4-acceptance.sh): collects failures into a
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

echo "=== v0.34.5 evaluate-audit refinements acceptance ==="
echo

# ---------------------------------------------------------------------------
# AC-1 (#357): test regex is keyed on option-shape (`<name>:`), not a bare
# substring match. At least one occurrence of `\bmaxTokens\s*:` or
# `\bmax_tokens\s*:` inside the test file.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE '\bmaxTokens\s*:|\bmax_tokens\s*:' server/tools/evaluate-max-tokens-audit.test.ts)
if [ "$COUNT" -ge 1 ]; then AC1=0; else AC1=1; fi
check "AC-1" "option-shape pattern present (got=$COUNT want>=1)" "$AC1"

# ---------------------------------------------------------------------------
# AC-2 (#357): old substring-match literal is gone. `-F` fixed-string match
# on the exact regex literal `/maxTokens|max_tokens/g`.
# ---------------------------------------------------------------------------
COUNT=$(grep -F '/maxTokens|max_tokens/g' server/tools/evaluate-max-tokens-audit.test.ts | wc -l)
if [ "$COUNT" = "0" ]; then AC2=0; else AC2=1; fi
check "AC-2" "old substring-match literal removed (got=$COUNT want=0)" "$AC2"

# ---------------------------------------------------------------------------
# AC-3 (#359): existsSync is wired in -- one import + at least one call site.
# ---------------------------------------------------------------------------
COUNT=$(grep -c "existsSync" server/tools/evaluate-max-tokens-audit.test.ts)
if [ "$COUNT" -ge 2 ]; then AC3=0; else AC3=1; fi
check "AC-3" "existsSync import + call site present (got=$COUNT want>=2)" "$AC3"

# ---------------------------------------------------------------------------
# AC-4: audit test runs green against current evaluate.ts.
# ---------------------------------------------------------------------------
rm -f tmp/v034-5-audit.json
npx vitest run --reporter=json --outputFile=tmp/v034-5-audit.json server/tools/evaluate-max-tokens-audit.test.ts > tmp/v034-5-audit.log 2>&1 || true
if [ -s tmp/v034-5-audit.json ] && node -e 'const r=JSON.parse(require("fs").readFileSync("tmp/v034-5-audit.json","utf8")); if (r.numFailedTests===0 && r.numPassedTests>=2) process.exit(0); else { console.error("audit test:", r.numPassedTests, "passed /", r.numFailedTests, "failed"); process.exit(1); }'; then
  AC4=0
else
  AC4=1
fi
check "AC-4" "audit test file runs green (>=2 passed, 0 failed)" "$AC4"

# ---------------------------------------------------------------------------
# AC-5: audit invariant holds -- evaluate.ts has zero maxTokens/max_tokens.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE 'maxTokens|max_tokens' server/tools/evaluate.ts || true)
if [ "${COUNT:-0}" = "0" ]; then AC5=0; else AC5=1; fi
check "AC-5" "evaluate.ts maxTokens count (got=${COUNT:-0} want=0)" "$AC5"

# ---------------------------------------------------------------------------
# AC-6 (#358): AC-D7 section removed from pr-d-acceptance.sh. Two greps:
# one for the section header, one for the unique pass-message phrase.
# ---------------------------------------------------------------------------
COUNT_HEADER=$(grep -c "AC-D7" scripts/pr-d-acceptance.sh || true)
COUNT_PHRASE=$(grep -c "wrapper script is executable" scripts/pr-d-acceptance.sh || true)
if [ "${COUNT_HEADER:-0}" = "0" ] && [ "${COUNT_PHRASE:-0}" = "0" ]; then AC6=0; else AC6=1; fi
check "AC-6" "AC-D7 section removed (header=${COUNT_HEADER:-0} phrase=${COUNT_PHRASE:-0} want=0/0)" "$AC6"

# ---------------------------------------------------------------------------
# AC-7: full vitest suite clean -- numFailedTests === 0 and
# numPassedTests >= 798 (master baseline 800 with small headroom since the
# audit test count is unchanged but other tests could flake).
# ---------------------------------------------------------------------------
rm -f tmp/v034-5-vitest.json
npx vitest run --reporter=json --outputFile=tmp/v034-5-vitest.json > tmp/v034-5-vitest.log 2>&1 || true
if [ -s tmp/v034-5-vitest.json ] && node -e 'const r=JSON.parse(require("fs").readFileSync("tmp/v034-5-vitest.json","utf8")); if (typeof r.numFailedTests!=="number"){console.error("numFailedTests missing");process.exit(2)} if (r.numFailedTests>0){console.error("numFailedTests=",r.numFailedTests);process.exit(1)} if (typeof r.numPassedTests!=="number"){console.error("numPassedTests missing");process.exit(3)} if (r.numPassedTests<798){console.error("numPassedTests=",r.numPassedTests,"below 798");process.exit(1)} process.exit(0);'; then
  AC7=0
else
  AC7=1
fi
check "AC-7" "full vitest suite: numFailedTests=0 and numPassedTests>=798" "$AC7"

# ---------------------------------------------------------------------------
# AC-8: npm run lint exits 0.
# ---------------------------------------------------------------------------
if npm run lint > tmp/v034-5-lint.log 2>&1; then AC8=0; else AC8=1; fi
check "AC-8" "npm run lint exits 0" "$AC8"

# ---------------------------------------------------------------------------
# AC-9: npm run build exits 0 (tsc strict mode).
# ---------------------------------------------------------------------------
if npm run build > tmp/v034-5-build.log 2>&1; then AC9=0; else AC9=1; fi
check "AC-9" "npm run build exits 0" "$AC9"

# ---------------------------------------------------------------------------
# AC-10: No drive-by edits. Branch diff vs origin/master touches only the
# allowlisted paths. Pre-fetch origin/master so the diff resolves on shallow
# CI clones.
# ---------------------------------------------------------------------------
git fetch --no-tags --prune --depth=100 origin master > tmp/v034-5-fetch.log 2>&1 || true
BAD=$(git diff --name-only origin/master...HEAD 2>/dev/null \
  | grep -vE '^(server/tools/evaluate-max-tokens-audit\.test\.ts|scripts/pr-d-acceptance\.sh|scripts/v034-5-acceptance\.sh|\.ai-workspace/plans/2026-04-21-v0-34-5-evaluate-audit-refinements\.md)$' \
  || true)
if [ -z "$BAD" ]; then AC10=0; else AC10=1; fi
if [ -n "$BAD" ]; then
  echo "    out-of-allowlist paths in diff:"
  echo "$BAD" | sed 's/^/      /'
fi
check "AC-10" "branch diff vs origin/master only touches allowlisted paths" "$AC10"

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
  echo "Inspect logs under tmp/v034-5-*.log for failing ACs."
  exit 1
fi

echo "ALL GREEN"
exit 0
