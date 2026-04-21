#!/usr/bin/env bash
# v0.35.0 — forge_status + forge_declare_story acceptance wrapper.
#
# Runs every binary AC from the plan in sequence. Exits 0 iff all pass.
# Mirrors the Verification procedure in
# .ai-workspace/plans/2026-04-21-v0-35-0-forge-status-and-declare-story.md
#
# Windows MSYS safety: prevents path mangling when git commands receive
# colon-separated refs like "master:path". Export once at the top.
export MSYS_NO_PATHCONV=1

set -u   # undefined-var is an error; deliberately NOT `-e` — we want
         # every AC to run and report aggregate status at the end.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

failures=0
pass() { printf "  [PASS] %s\n" "$1"; }
fail() { printf "  [FAIL] %s\n" "$1"; failures=$((failures + 1)); }
banner() { printf "\n=== %s ===\n" "$1"; }

# MSYS /tmp mangling: MSYS bash maps /tmp to C:\tmp on this install, which
# doesn't exist. Derive a safe scratch dir via `mktemp -d` (returns a real
# path on this platform) and use it for every artifact the wrapper writes.
SCRATCH_DIR="$(mktemp -d)"
printf "scratch dir: %s\n" "$SCRATCH_DIR"

banner "AC-1: npm run build exits 0"
if npm run build >"$SCRATCH_DIR/build.log" 2>&1; then
  pass "build succeeded"
else
  fail "build failed — see $SCRATCH_DIR/build.log"
fi

banner "AC-2 & AC-3: npm test — no new failures & N >= 814"
# Use the JSON reporter to extract totals. jq is NOT installed on this
# machine per the executor's ack — substitute node -e JSON parse.
TEST_JSON="$SCRATCH_DIR/vitest.json"
npx vitest run --reporter=json >"$TEST_JSON" 2>/dev/null
# Vitest may also emit stderr noise; the JSON is on stdout.

# Extract counts via node (jq substitution, per the plan's AC-3 note).
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
  pass "AC-2: zero test failures (delta vs master baseline 0)"
else
  fail "AC-2: $NUM_FAILED test failures"
fi

if [ "${NUM_TOTAL:-0}" -ge 814 ]; then
  pass "AC-3: N_branch=$NUM_TOTAL >= 814"
else
  fail "AC-3: N_branch=$NUM_TOTAL < 814"
fi

banner "AC-4: smoke test — exactly 8 tools including forge_status + forge_declare_story"
if npx vitest run server/smoke/mcp-surface.test.ts >"$SCRATCH_DIR/smoke.log" 2>&1; then
  pass "smoke test passed"
else
  fail "smoke test failed — see ${TEMP:-/tmp}/v035-smoke.log"
fi

banner "AC-5, AC-6, AC-7, AC-8a, AC-8b, AC-11: integration tests for status + declare-story"
if npx vitest run server/tools/status.test.ts server/tools/declare-story.test.ts >"$SCRATCH_DIR/integration.log" 2>&1; then
  pass "integration tests passed"
else
  fail "integration tests failed — see ${TEMP:-/tmp}/v035-integration.log"
fi

banner "AC-9: touched paths allowlist"
# Compute touched files vs master. The allowlist is a set of glob patterns
# from the plan. We validate each touched path against the allowlist.
BASE_REF="$(git merge-base origin/master HEAD 2>/dev/null || git merge-base master HEAD 2>/dev/null || echo master)"
DIFF_FILES="$(git diff --name-only "$BASE_REF"...HEAD)"
printf "    diff base: %s\n" "$BASE_REF"
printf "    touched files:\n"
printf "%s\n" "$DIFF_FILES" | sed 's/^/      /'

# Allowlist check: every path must match one of these shell-glob patterns.
# Unknown paths accumulate in $unknown.
unknown=""
while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    server/tools/status.ts|server/tools/declare-story.ts) ;;
    server/tools/status.test.ts|server/tools/declare-story.test.ts) ;;
    server/lib/declaration-store.ts) ;;
    server/lib/*.test.ts|server/tools/*.test.ts|server/*/*.test.ts) ;;
    server/lib/*) ;;
    server/index.ts) ;;
    server/smoke/mcp-surface.test.ts) ;;
    schema/forge-status.schema.json) ;;
    scripts/v035-0-acceptance.sh) ;;
    CHANGELOG.md|package.json|package-lock.json) ;;
    *) unknown="${unknown}${path}\n" ;;
  esac
done <<< "$DIFF_FILES"

if [ -z "$unknown" ]; then
  pass "AC-9: every touched file matches the allowlist"
else
  printf "    unknown paths:\n"
  printf "$unknown" | sed 's/^/      /'
  fail "AC-9: paths outside the allowlist present"
fi

banner "AC-10: npm run lint — no new failures"
if npm run lint >"$SCRATCH_DIR/lint.log" 2>&1; then
  pass "lint clean"
else
  fail "lint failed — see ${TEMP:-/tmp}/v035-lint.log"
fi

banner "Summary"
if [ "$failures" -eq 0 ]; then
  printf "ALL ACCEPTANCE CHECKS PASSED\n"
  exit 0
else
  printf "%d CHECK(S) FAILED\n" "$failures"
  exit 1
fi
