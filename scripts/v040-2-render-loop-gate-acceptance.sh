#!/usr/bin/env bash
# v0.40.2 — dashboard render-loop gate acceptance wrapper.
#
# Mandated acceptance wrapper for v0.40.2. Runs AC-1, AC-2, AC-3a, AC-3b,
# AC-4, AC-5, AC-6, AC-7, AC-8 in order (nine assertions). Exits 0 iff
# every AC passed. On green, prints the literal string
#   ALL V0.40.2 ACCEPTANCE CHECKS PASSED
# (matches v0.34.0 / v0.34.1 wrapper convention).
#
# Plan: .ai-workspace/plans/2026-05-08-forge-dashboard-render-loop-gate.md
#
# Usage:
#   bash scripts/v040-2-render-loop-gate-acceptance.sh
#
# Windows MSYS path safety — prevents path mangling when git commands
# receive colon-separated refs.
export MSYS_NO_PATHCONV=1

set -u   # undefined-var is an error; deliberately NOT `-e` so every AC
         # runs to completion and the summary reports aggregate state.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Export FORGE_HARNESS so the AC verifier shell snippets (which mirror
# the plan's literal text) can reference $FORGE_HARNESS as a path anchor
# regardless of where the wrapper was invoked from.
export FORGE_HARNESS="$ROOT"

PASS_COUNT=0
FAIL_COUNT=0

record_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  [PASS] $1"
}
record_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  [FAIL] $1"
}

# Cross-platform mtime helper — `stat -f %m` is BSD/macOS only;
# `stat -c %Y` is the GNU equivalent. Linux CI must not rely on -f.
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }

# ── Pre-check: dist/ must be built ───────────────────────────────────────
if [ ! -f "$FORGE_HARNESS/dist/index.js" ]; then
  echo "[INFO] dist/ missing — running npm run build first"
  if ! npm run build >/dev/null 2>&1; then
    echo "[FATAL] npm run build failed; cannot run AC verifiers"
    exit 1
  fi
fi

# ── AC-1 — empty cwd produces no dashboard ───────────────────────────────
T=$(mktemp -d)
( cd "$T" && sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
if [ ! -e "$T/.forge/dashboard.html" ]; then
  record_pass "AC-1 — empty cwd produces no dashboard"
else
  record_fail "AC-1 — dashboard.html appeared in empty cwd ($T/.forge/dashboard.html)"
fi
rm -rf "$T"

# ── AC-2 — populated cwd renders as before (regression guard + auto-open) ─
T=$(mktemp -d)
cp -R "$FORGE_HARNESS/tests/fixtures/forge-with-runs/.forge" "$T/.forge"

# Fixture-validity probe — fail fast if fixture is malformed (F37/F38 guard).
FIXTURE_OK=1
node -e "
const fs = require('fs');
const path = require('path');
const dir = '$T/.forge/runs';
for (const f of fs.readdirSync(dir)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!j.storyId || !j.metrics || typeof j.metrics.durationMs !== 'number') {
    console.error('FIXTURE INVALID:', f); process.exit(1);
  }
}
" || FIXTURE_OK=0

if [ "$FIXTURE_OK" -eq 0 ]; then
  record_fail "AC-2 — fixture-validity probe failed (malformed runs/*.json)"
else
  # Verifier shell tweak (deviation from plan literal): the plan text
  # `FORGE_DASHBOARD_AUTO_OPEN=1 sleep 40 | node ...` only sets the env
  # var for `sleep` (one-shot inline-env grammar), so the `node` process
  # never sees `FORGE_DASHBOARD_AUTO_OPEN`. Export at the subshell level
  # so the entire pipeline inherits the var.
  ( cd "$T" && export FORGE_DASHBOARD_AUTO_OPEN=1 && sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
  if [ -s "$T/.forge/dashboard.html" ] \
      && [ "$(wc -c < "$T/.forge/dashboard.html")" -gt 1024 ] \
      && grep -iqE '<title>[^<]*forge' "$T/.forge/dashboard.html" \
      && [ -e "$T/.forge/.dashboard-opened" ]; then
    record_pass "AC-2 — populated cwd renders dashboard >1KB w/ forge title + auto-open marker"
  else
    record_fail "AC-2 — populated cwd did not produce expected dashboard + auto-open marker"
    echo "    dashboard.html size: $(wc -c < "$T/.forge/dashboard.html" 2>/dev/null || echo missing)"
    echo "    .dashboard-opened present: $([ -e "$T/.forge/.dashboard-opened" ] && echo yes || echo no)"
  fi
fi
rm -rf "$T"

# ── AC-3a — empty cwd, then disk-state appears, dashboard appears ────────
T=$(mktemp -d)
( cd "$T" && sleep 50 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) &
SERVER_PID=$!
sleep 5
DORMANT_OK=1
[ -e "$T/.forge/dashboard.html" ] && DORMANT_OK=0   # dormant phase
mkdir -p "$T/.forge/runs"
cp "$FORGE_HARNESS/tests/fixtures/forge-with-runs/.forge/runs/"*.json "$T/.forge/runs/"
sleep 35
AWAKE_OK=1
[ -s "$T/.forge/dashboard.html" ] || AWAKE_OK=0     # awake phase
wait "$SERVER_PID" 2>/dev/null || true

if [ "$DORMANT_OK" -eq 1 ] && [ "$AWAKE_OK" -eq 1 ]; then
  record_pass "AC-3a — disk-state wake: dormant at t=5s, dashboard at t=40s"
else
  record_fail "AC-3a — dormant=$DORMANT_OK awake=$AWAKE_OK (both must be 1)"
fi
rm -rf "$T"

# ── AC-3b — empty cwd, then forge_declare_story (in-memory), dashboard ───
if npx tsx "$FORGE_HARNESS/tests/render-loop-gate/ac3b-declare-story-wake.test.ts" >/tmp/ac3b-out.log 2>&1; then
  record_pass "AC-3b — declare_story wakes loop via SDK StdioClientTransport"
else
  record_fail "AC-3b — declare_story wake test failed (see /tmp/ac3b-out.log)"
  tail -20 /tmp/ac3b-out.log | sed 's/^/    /'
fi

# ── AC-4 — auto-open does not fire in empty cwd ──────────────────────────
T=$(mktemp -d)
# Same env-export deviation from plan literal as AC-2 (see comment above).
( cd "$T" && export FORGE_DASHBOARD_AUTO_OPEN=1 && sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
if [ ! -e "$T/.forge/.dashboard-opened" ] && [ ! -e "$T/.forge/dashboard.html" ]; then
  record_pass "AC-4 — empty cwd does not auto-open even with FORGE_DASHBOARD_AUTO_OPEN=1"
else
  record_fail "AC-4 — empty cwd produced .dashboard-opened or dashboard.html with auto-open env var"
fi
rm -rf "$T"

# ── AC-5 — existing test suite passes ────────────────────────────────────
if npm test >/tmp/ac5-out.log 2>&1; then
  record_pass "AC-5 — npm test exits 0 (full suite green)"
else
  record_fail "AC-5 — npm test failed (see /tmp/ac5-out.log)"
  tail -30 /tmp/ac5-out.log | sed 's/^/    /'
fi

# ── AC-6 — wake-signal contract: call-expression grep ────────────────────
PATTERN='(ensureDashboardLoopRunning|notifyForgeStateWrite)[[:space:]]*\('
AC6_OK=1
for f in server/tools/plan.ts server/tools/generate.ts server/tools/evaluate.ts server/tools/coordinate.ts server/tools/declare-story.ts; do
  if [ ! -f "$f" ]; then
    echo "    [FAIL] $f missing (handler renamed or deleted?)"
    AC6_OK=0
    continue
  fi
  count=$(grep -cE "$PATTERN" "$f" || echo 0)
  if [ "$count" -ne 1 ]; then
    echo "    [FAIL] $f has $count wake-signal call-expressions (expected exactly 1)"
    AC6_OK=0
  fi
done
if [ "$AC6_OK" -eq 1 ]; then
  record_pass "AC-6 — exactly one wake-signal call-expression per state-writing handler"
else
  record_fail "AC-6 — wake-signal grep failed (see per-file detail above)"
fi

# ── AC-7 — leaky-leftover .forge/ does not count as active ───────────────
T=$(mktemp -d)
mkdir -p "$T/.forge"
echo "<html>stale</html>" > "$T/.forge/dashboard.html"
mtime_before=$(mtime "$T/.forge/dashboard.html")
( cd "$T" && sleep 40 | node "$FORGE_HARNESS/dist/index.js" >/dev/null 2>&1 ) || true
mtime_after=$(mtime "$T/.forge/dashboard.html")
file_count=$(ls "$T/.forge/" | wc -l | tr -d ' ')
if [ "$mtime_before" = "$mtime_after" ] && [ "$file_count" -eq 1 ]; then
  record_pass "AC-7 — leaky-leftover .forge/ stays untouched (mtime unchanged, no extra files)"
else
  record_fail "AC-7 — mtime_before=$mtime_before mtime_after=$mtime_after files=$file_count"
fi
rm -rf "$T"

# ── AC-8 — diff scope confined to allowlist ──────────────────────────────
ALLOWED='^(server/index\.ts|server/lib/dashboard-render-loop\.ts|server/tools/(plan|generate|evaluate|coordinate|declare-story)\.ts|tests/fixtures/forge-with-runs/.*|tests/render-loop-gate/.*|server/lib/dashboard-render-loop\.test\.ts|scripts/v040-2-render-loop-gate-acceptance\.sh|CHANGELOG\.md|package\.json|package-lock\.json|dist/.*)$'
SCOPE_OUT=$(mktemp)
DIFF_BASE="origin/master"
if ! git rev-parse --verify "$DIFF_BASE" >/dev/null 2>&1; then
  DIFF_BASE="$(git merge-base HEAD master 2>/dev/null || echo HEAD)"
fi
git diff --name-only "$DIFF_BASE"...HEAD | grep -vE "$ALLOWED" > "$SCOPE_OUT" || true

if [ ! -s "$SCOPE_OUT" ]; then
  record_pass "AC-8 — diff scope confined to allowlist"
else
  record_fail "AC-8 — diff touches files outside allowlist:"
  sed 's/^/    /' "$SCOPE_OUT"
fi
rm -f "$SCOPE_OUT"

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "v0.40.2 acceptance summary: $PASS_COUNT passed / $FAIL_COUNT failed"
echo "════════════════════════════════════════════════════════════════════════"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

echo "ALL V0.40.2 ACCEPTANCE CHECKS PASSED"
exit 0
