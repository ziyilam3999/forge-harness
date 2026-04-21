#!/usr/bin/env bash
# Acceptance wrapper for v0.34.6 -- final v0.34.x polish slice (ci + release).
# Runs AC-1..AC-9 from
#   .ai-workspace/plans/2026-04-21-v0-34-6-ci-release-polish.md
# AC-10..AC-12 are post-ship / post-merge / post-planner-close gates and are
# not checkable from the executor branch alone; they are noted as skipped.
#
# Usage: bash scripts/v034-6-acceptance.sh
# Prereqs: node, npm, git, bash, grep, wc. No jq, no yq.
#
# Convention (matches v034-{3,4,5}-acceptance.sh): collects failures into a
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

echo "=== v0.34.6 ci + release polish acceptance ==="
echo

YAML=.github/workflows/s8-kanban-dashboard-acceptance.yml
PRE=scripts/pr-e-acceptance.sh

# ---------------------------------------------------------------------------
# AC-1 (#298): bare `workflow_dispatch:` present exactly once.
# ---------------------------------------------------------------------------
COUNT=$(grep -c '^  workflow_dispatch:$' "$YAML")
if [ "$COUNT" = "1" ]; then AC1=0; else AC1=1; fi
check "AC-1" "bare 'workflow_dispatch:' present (got=$COUNT want=1)" "$AC1"

# ---------------------------------------------------------------------------
# AC-2 (#298): old empty-mapping form `workflow_dispatch: {}` is gone.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE 'workflow_dispatch:\s*\{\}' "$YAML" || true)
if [ "${COUNT:-0}" = "0" ]; then AC2=0; else AC2=1; fi
check "AC-2" "old 'workflow_dispatch: {}' form removed (got=${COUNT:-0} want=0)" "$AC2"

# ---------------------------------------------------------------------------
# AC-3 (#297): concurrency group uses idiomatic github.workflow form.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE '^\s+group:\s+\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}' "$YAML")
if [ "$COUNT" = "1" ]; then AC3=0; else AC3=1; fi
check "AC-3" "concurrency group uses \${{ github.workflow }} form (got=$COUNT want=1)" "$AC3"

# ---------------------------------------------------------------------------
# AC-4 (#297): hardcoded `s8-dashboard-` group form is gone.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE '^\s+group:\s+s8-dashboard-\$\{\{\s*github\.ref\s*\}\}' "$YAML" || true)
if [ "${COUNT:-0}" = "0" ]; then AC4=0; else AC4=1; fi
check "AC-4" "hardcoded 's8-dashboard-' concurrency group gone (got=${COUNT:-0} want=0)" "$AC4"

# ---------------------------------------------------------------------------
# AC-5 (#364): vitest-specific `|| true` removed from pr-e AC-E7 block.
# Scoped to the vitest invocation line — the legitimate `|| true` on
# AC-E8's `git diff ... | grep -vE ...` line MUST remain untouched.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE 'vitest.*pr-e-vitest\.json.*\|\| true' "$PRE" || true)
if [ "${COUNT:-0}" = "0" ]; then AC5=0; else AC5=1; fi
check "AC-5" "vitest '|| true' masking removed from pr-e (got=${COUNT:-0} want=0)" "$AC5"

# ---------------------------------------------------------------------------
# AC-6 (#364): explicit JSON-file existence check added before node parse.
# Accepts `test -f`, `[ -f ... ]`, or `existsSync(...)` phrasing.
# ---------------------------------------------------------------------------
COUNT=$(grep -cE 'test -f tmp/pr-e-vitest\.json|\[\s+-f\s+tmp/pr-e-vitest\.json|existsSync.*pr-e-vitest' "$PRE")
if [ "$COUNT" -ge 1 ]; then AC6=0; else AC6=1; fi
check "AC-6" "explicit JSON existence check in pr-e (got=$COUNT want>=1)" "$AC6"

# ---------------------------------------------------------------------------
# AC-7 (#398): each of v034-{1..5} wrappers carries a buffer-policy comment.
# Comment must contain one of buffer|slack|headroom|churn.
# ---------------------------------------------------------------------------
AC7=0
for f in \
  scripts/v034-1-acceptance.sh \
  scripts/v034-2-acceptance.sh \
  scripts/v034-3-acceptance.sh \
  scripts/v034-4-acceptance.sh \
  scripts/v034-5-acceptance.sh
do
  if [ ! -f "$f" ]; then
    echo "    missing file: $f"
    AC7=1
    continue
  fi
  COUNT=$(grep -cE 'buffer|slack|headroom|churn' "$f" || true)
  if [ "${COUNT:-0}" -lt 1 ]; then
    echo "    $f has no buffer|slack|headroom|churn comment"
    AC7=1
  fi
done
check "AC-7" "v034-{1..5} wrappers each document the test-count buffer policy" "$AC7"

# ---------------------------------------------------------------------------
# AC-8 (#398 OOS-1): v034-0-acceptance.sh untouched.
# ---------------------------------------------------------------------------
DIFF=$(git diff master...HEAD -- scripts/v034-0-acceptance.sh 2>/dev/null || true)
if [ -z "$DIFF" ]; then AC8=0; else AC8=1; fi
check "AC-8" "scripts/v034-0-acceptance.sh untouched vs master" "$AC8"

# ---------------------------------------------------------------------------
# AC-9: full vitest suite: numFailedTests=0 and numPassedTests >= 798.
# Baseline 800 at v0.33.7 with a 2-test buffer window for parallel-churn.
# ---------------------------------------------------------------------------
rm -f tmp/v0346-full.json
npx vitest run --reporter=json --outputFile=tmp/v0346-full.json > tmp/v0346-full.log 2>&1 || true
if [ -s tmp/v0346-full.json ] && node -e 'const d=JSON.parse(require("fs").readFileSync("tmp/v0346-full.json","utf8")); if (typeof d.numFailedTests!=="number"){console.error("numFailedTests missing");process.exit(2)} if (d.numFailedTests>0){console.error("numFailedTests=",d.numFailedTests);process.exit(1)} if (typeof d.numPassedTests!=="number"){console.error("numPassedTests missing");process.exit(3)} if (d.numPassedTests<798){console.error("numPassedTests=",d.numPassedTests,"below 798");process.exit(1)} process.exit(0);'; then
  AC9=0
else
  AC9=1
fi
check "AC-9" "full vitest suite: numFailedTests=0 and numPassedTests>=798" "$AC9"

# ---------------------------------------------------------------------------
# AC-10 post-ship only: package.json version == 0.33.8 after /ship Stage 7.
# Not checkable from executor branch alone.
# ---------------------------------------------------------------------------
echo "  SKIP  AC-10  package.json 0.33.8 (post-ship /ship Stage 7 only)"

# ---------------------------------------------------------------------------
# AC-11 post-ship only: CHANGELOG.md has '## [0.33.8]' header referencing
# #297, #298, #364, #398. Not checkable from executor branch alone.
# ---------------------------------------------------------------------------
echo "  SKIP  AC-11  CHANGELOG [0.33.8] entry (post-ship /ship Stage 7 only)"

# ---------------------------------------------------------------------------
# AC-12 post-merge + post-planner-close only: seven issues closed.
# Not checkable from executor branch alone.
# ---------------------------------------------------------------------------
echo "  SKIP  AC-12  seven issues CLOSED (post-merge + post-planner-close only)"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "=== summary: $PASS pass / $FAIL fail (AC-10..AC-12 skipped — post-ship gates) ==="

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "FAILURES:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo
  echo "Inspect logs under tmp/v0346-*.log for failing ACs."
  exit 1
fi

echo "ALL GREEN (AC-1..AC-9)"
exit 0
