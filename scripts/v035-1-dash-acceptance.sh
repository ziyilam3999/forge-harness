#!/usr/bin/env bash
# v0.35.1 — dashboard + coordinator polish acceptance wrapper.
#
# Runs every binary AC (AC-1..AC-8) in sequence. AC-9 IS this wrapper's
# existence. AC-10 (touched-paths allowlist) runs as a sub-mode:
#   bash scripts/v035-1-dash-acceptance.sh                   # default mode
#   bash scripts/v035-1-dash-acceptance.sh --mode=allowlist-check  # AC-10 only
#
# Exits 0 iff all checks pass; non-zero otherwise. Reviewer invokes the
# default mode to validate the PR end-to-end.
#
# Windows MSYS safety: prevents path mangling when git commands receive
# colon-separated refs like "master:path". Export once at the top.
export MSYS_NO_PATHCONV=1

set -u   # undefined-var is an error; deliberately NOT `-e` — we want
         # every AC to run and report aggregate status at the end.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── allowlist-check sub-mode ─────────────────────────────────────────────

MODE="default"
for arg in "$@"; do
  case "$arg" in
    --mode=allowlist-check) MODE="allowlist-check" ;;
    --mode=default) MODE="default" ;;
    *) ;;
  esac
done

# Allowlist patterns from AC-10 of the plan. Each line is a shell glob
# anchored at the repo root. The hard-rule above the list (per the plan)
# guarantees `scripts/v035-1-dash-acceptance.sh` is in-scope regardless.
allowlist_match() {
  local path="$1"
  case "$path" in
    server/lib/dashboard-renderer.ts) return 0 ;;
    server/lib/dashboard-renderer*.test.ts) return 0 ;;
    server/lib/coordinator.ts) return 0 ;;
    server/lib/coordinator*.test.ts) return 0 ;;
    server/lib/declaration-store.ts) return 0 ;;
    server/lib/declaration-store*.test.ts) return 0 ;;
    server/lib/anthropic.ts) return 0 ;;
    server/lib/anthropic*.test.ts) return 0 ;;
    server/lib/cost.ts) return 0 ;;
    server/lib/cost*.test.ts) return 0 ;;
    server/lib/run-context.ts) return 0 ;;
    server/lib/run-context*.test.ts) return 0 ;;
    server/lib/run-record.ts) return 0 ;;
    server/lib/run-record*.test.ts) return 0 ;;
    server/tools/evaluate.ts) return 0 ;;
    server/tools/evaluate*.test.ts) return 0 ;;
    server/tools/coordinate.ts) return 0 ;;
    server/tools/coordinate*.test.ts) return 0 ;;
    server/tools/status.ts) return 0 ;;
    server/tools/status*.test.ts) return 0 ;;
    server/types/coordinate-result.ts) return 0 ;;
    server/types/eval-report.ts) return 0 ;;
    server/types/status-output.ts) return 0 ;;
    scripts/v035-1-dash-acceptance.sh) return 0 ;;
    scripts/v035-1-dash-acceptance*.test.ts) return 0 ;;
    CHANGELOG.md) return 0 ;;
    package.json) return 0 ;;
    package-lock.json) return 0 ;;
    .ai-workspace/plans/2026-04-21-v0-35-1-dashboard-coordinator-polish.md) return 0 ;;
  esac
  return 1
}

if [ "$MODE" = "allowlist-check" ]; then
  # Read paths from stdin (one per line). Verify each is in the allowlist.
  failures=0
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if allowlist_match "$path"; then
      printf "  [PASS] %s (allowlisted)\n" "$path"
    else
      printf "  [FAIL] %s (NOT in allowlist)\n" "$path"
      failures=$((failures + 1))
    fi
  done
  if [ "$failures" -eq 0 ]; then
    printf "ALLOWLIST CHECK: ALL PATHS ALLOWLISTED\n"
    exit 0
  fi
  printf "ALLOWLIST CHECK: %d PATH(S) OUTSIDE ALLOWLIST\n" "$failures"
  exit 1
fi

# ── default mode (AC-1..AC-8) ────────────────────────────────────────────

failures=0
pass() { printf "  [PASS] %s\n" "$1"; }
fail() { printf "  [FAIL] %s\n" "$1"; failures=$((failures + 1)); }
banner() { printf "\n=== %s ===\n" "$1"; }

# Scratch dir inside the repo (relative path sidesteps MSYS/Windows path
# quirks). `.forge/` is .gitignored.
SCRATCH_REL=".forge/scratch/v035-1-acceptance-$$"
mkdir -p "$SCRATCH_REL"
SCRATCH_DIR="$SCRATCH_REL"
printf "scratch dir (relative): %s\n" "$SCRATCH_DIR"
trap 'rm -rf "$SCRATCH_DIR"' EXIT

banner "Build — npm run build"
if npm run build >"$SCRATCH_DIR/build.log" 2>&1; then
  pass "build succeeded"
else
  fail "build failed — see $SCRATCH_DIR/build.log"
  printf "BUILD FAILED — aborting early (remaining AC depend on dist/)\n"
  exit 1
fi

banner "AC-1: activeRun clears when forge_coordinate marks story done"
npx vitest run -t "activeRun clears when forge_coordinate marks story done" \
  >"$SCRATCH_DIR/ac1.log" 2>&1
if grep -q "1 passed" "$SCRATCH_DIR/ac1.log"; then
  pass "AC-1"
else
  fail "AC-1 — grep '1 passed' missed; see $SCRATCH_DIR/ac1.log"
fi

banner "AC-2: forge_evaluate captures gitSha on PASS"
npx vitest run -t "forge_evaluate captures gitSha on PASS" \
  >"$SCRATCH_DIR/ac2.log" 2>&1
if grep -q "1 passed" "$SCRATCH_DIR/ac2.log"; then
  pass "AC-2"
else
  fail "AC-2 — grep '1 passed' missed; see $SCRATCH_DIR/ac2.log"
fi

banner "AC-3: TIME widget reads totals.elapsedMs not timeBudget.elapsedMs"
npx vitest run -t "TIME widget reads totals.elapsedMs not timeBudget.elapsedMs" \
  >"$SCRATCH_DIR/ac3.log" 2>&1
if grep -q "1 passed" "$SCRATCH_DIR/ac3.log"; then
  pass "AC-3"
else
  fail "AC-3 — grep '1 passed' missed; see $SCRATCH_DIR/ac3.log"
fi

banner "AC-4: TIME widget formats as Dd Hh Mm Ss past 24h"
npx vitest run -t "TIME widget formats as Dd Hh Mm Ss past 24h" \
  >"$SCRATCH_DIR/ac4.log" 2>&1
if grep -q "1 passed" "$SCRATCH_DIR/ac4.log"; then
  pass "AC-4"
else
  fail "AC-4 — grep '1 passed' missed; see $SCRATCH_DIR/ac4.log"
fi

banner "AC-5: activity list renders dates alongside times"
npx vitest run -t "activity list renders dates alongside times" \
  >"$SCRATCH_DIR/ac5.log" 2>&1
if grep -q "1 passed" "$SCRATCH_DIR/ac5.log"; then
  pass "AC-5"
else
  fail "AC-5 — grep '1 passed' missed; see $SCRATCH_DIR/ac5.log"
fi

banner "AC-6: BUDGET widget distinguishes OAuth vs API-key"
npx vitest run -t "BUDGET widget distinguishes OAuth vs API-key" \
  >"$SCRATCH_DIR/ac6.log" 2>&1
if grep -q "1 passed" "$SCRATCH_DIR/ac6.log"; then
  pass "AC-6"
else
  fail "AC-6 — grep '1 passed' missed; see $SCRATCH_DIR/ac6.log"
fi

banner "AC-7: activity panel surfaces all non-silent tools"
npx vitest run -t "activity panel surfaces all non-silent tools" \
  >"$SCRATCH_DIR/ac7.log" 2>&1
if grep -q "1 passed" "$SCRATCH_DIR/ac7.log"; then
  pass "AC-7"
else
  fail "AC-7 — grep '1 passed' missed; see $SCRATCH_DIR/ac7.log"
fi

banner "AC-8: build passes, no new test failures, count >= 834"
# Use the vitest JSON reporter to extract totals — jq is not on this machine
# (per executor ack), so node -e substitutes.
TEST_JSON="$SCRATCH_DIR/vitest.json"
npx vitest run --reporter=json >"$TEST_JSON" 2>/dev/null

read -r NUM_TOTAL NUM_FAILED NUM_PASSED NUM_PENDING < <(
  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
    const total = j.numTotalTests ?? 0;
    const failed = j.numFailedTests ?? 0;
    const passed = j.numPassedTests ?? 0;
    const pending = j.numPendingTests ?? 0;
    process.stdout.write(total + " " + failed + " " + passed + " " + pending);
  ' "$TEST_JSON"
)
printf "    numTotalTests=%s numFailedTests=%s numPassedTests=%s numPendingTests=%s\n" \
  "$NUM_TOTAL" "$NUM_FAILED" "$NUM_PASSED" "$NUM_PENDING"

if [ "${NUM_FAILED:-0}" -eq 0 ]; then
  pass "AC-8a: zero test failures"
else
  fail "AC-8a: $NUM_FAILED test failures"
fi

if [ "${NUM_TOTAL:-0}" -ge 834 ]; then
  pass "AC-8b: count=$NUM_TOTAL >= 834"
else
  fail "AC-8b: count=$NUM_TOTAL < 834"
fi

banner "Summary"
if [ "$failures" -eq 0 ]; then
  printf "ALL ACCEPTANCE CHECKS PASSED\n"
  exit 0
else
  printf "%d CHECK(S) FAILED\n" "$failures"
  exit 1
fi
