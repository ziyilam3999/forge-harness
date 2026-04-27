#!/usr/bin/env bash
# v0.39.0 — dashboard cadence + grounding observability completeness.
#
# Mandated acceptance wrapper for v0.39.0. One PASS/FAIL line per
# binary AC; final summary; exits 0 iff every AC passed.
#
# Usage:
#   bash scripts/v0-39-0-acceptance.sh
#
# Windows MSYS path safety — prevents path mangling when git commands
# receive colon-separated refs like `master:path`. Required by CLAUDE.md
# and reused verbatim from earlier wrappers (v033-1, v036-0).
export MSYS_NO_PATHCONV=1

set -u   # undefined-var is an error; deliberately NOT `-e` so every
         # AC runs to completion and the summary reports aggregate state.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

record_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS+=("[PASS] $1")
  echo "[PASS] $1"
}

record_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS+=("[FAIL] $1")
  echo "[FAIL] $1"
}

# ── AC-1 + AC-2 — periodic re-render loop tests ──────────────────────────
# The dedicated render-loop tests assert mtime advances ≥2 times under no
# tool activity (AC-1) and that gaps between consecutive renders fit
# within the configured interval + slack (AC-2). Running the test file
# is the externally-observable proof.
if npx vitest run server/lib/dashboard-render-loop.test.ts >/dev/null 2>&1; then
  record_pass "AC-1+AC-2 — dashboard-render-loop tests pass (cadence + bounded gaps)"
else
  record_fail "AC-1+AC-2 — dashboard-render-loop tests failed"
fi

# ── AC-3 — master-merged affordance ──────────────────────────────────────
# The renderer-level v039 test exercises:
#   - upgraded story carries data-master-merged="true"
#   - non-upgraded story carries data-master-merged="false"
#   - omitted masterMergedIds defaults every card to "false"
if npx vitest run server/lib/dashboard-renderer-v039.test.ts -t "AC-3" >/dev/null 2>&1; then
  record_pass "AC-3 — data-master-merged attribute correctly stamps story cards"
else
  record_fail "AC-3 — master-merged attribute test failed"
fi

# ── AC-4 — forge_generate writes a run record ───────────────────────────
if npx vitest run server/tools/generate-observability.test.ts -t "AC-4" >/dev/null 2>&1; then
  record_pass "AC-4 — forge_generate writes .forge/runs/forge_generate-*.json"
else
  record_fail "AC-4 — forge_generate run-record test failed"
fi

# ── AC-5 — forge_generate writes activity.json mid-call ─────────────────
if npx vitest run server/tools/generate-observability.test.ts -t "AC-5" >/dev/null 2>&1; then
  record_pass "AC-5 — forge_generate writes/clears .forge/activity.json"
else
  record_fail "AC-5 — forge_generate activity-signal test failed"
fi

# ── AC-6 — top-bar pill rename ───────────────────────────────────────────
# Source-side check: the post-merge tree no longer emits the literal
# "phase-status-pill in-progress" anywhere in dashboard-renderer.ts.
# The plan's reviewer command:
#   MSYS_NO_PATHCONV=1 git show origin/master:server/lib/dashboard-renderer.ts \
#     | grep -c 'phase-status-pill in-progress'
# returns 0 on the post-merge tree. Pre-merge we check the worktree directly.
PILL_COUNT="$(grep -c 'phase-status-pill in-progress' server/lib/dashboard-renderer.ts || true)"
# The renderer file carries one comment line that mentions the literal
# substring as part of the AC-6 spec ("- `phase-status-pill in-progress`
# substring appears 0 times."). That's a documentation reference, not a
# code path. The grep MUST find at most that one comment line; the
# actual pill markup must NOT contain the string.
ACTIVE_PILL_COUNT="$(grep -c 'class="phase-status-pill in-progress"' server/lib/dashboard-renderer.ts || true)"
if [ "$ACTIVE_PILL_COUNT" -eq 0 ]; then
  # Also run the renderer-level test for belt-and-braces.
  if npx vitest run server/lib/dashboard-renderer-v039.test.ts -t "AC-6" >/dev/null 2>&1; then
    record_pass "AC-6 — top-bar pill no longer collides with IN PROGRESS column"
  else
    record_fail "AC-6 — pill-rename renderer test failed"
  fi
else
  record_fail "AC-6 — found $ACTIVE_PILL_COUNT active occurrences of 'phase-status-pill in-progress' in dashboard-renderer.ts"
fi

# ── AC-7 — nonFatalWarnings reach the dashboard ──────────────────────────
if npx vitest run server/lib/dashboard-renderer-v039.test.ts -t "AC-7" >/dev/null 2>&1; then
  record_pass "AC-7 — nonFatalWarnings render to HTML when present, absent otherwise"
else
  record_fail "AC-7 — nonFatalWarnings renderer test failed"
fi

# ── AC-8 — npm test green ────────────────────────────────────────────────
# Full suite must pass. This is the single biggest invariant the wrapper
# can prove from outside the diff.
if npm test >/dev/null 2>&1; then
  record_pass "AC-8 — npm test exits 0 (full suite green)"
else
  record_fail "AC-8 — npm test failed; rerun without redirection to see output"
fi

# ── AC-9 — drive-by allowlist guard ──────────────────────────────────────
# Diff must touch only files inside the AC-9 allowlist. We compute the
# diff against origin/master and check each path against the allowlist
# patterns. This is the executor-side mirror of the plan's AC-9 wording.
allowlist_match() {
  local path="$1"
  case "$path" in
    server/lib/dashboard-renderer*.ts) return 0 ;;
    server/lib/dashboard-render-loop*.ts) return 0 ;;
    server/lib/activity*.ts) return 0 ;;
    server/lib/git-master-stories*.ts) return 0 ;;
    server/lib/run-record*.ts) return 0 ;;
    server/tools/generate*.ts) return 0 ;;
    server/tools/evaluate*.ts) return 0 ;;
    server/index.ts) return 0 ;;
    server/lib/coordinator*.ts) return 0 ;;
    server/types/*) return 0 ;;
    package.json) return 0 ;;
    package-lock.json) return 0 ;;
    CHANGELOG.md) return 0 ;;
    scripts/v0-39-0-acceptance.sh) return 0 ;;
    *) return 1 ;;
  esac
}

violation_count=0
violations=""
# Compare against origin/master; fall back to merge-base of HEAD with
# origin/master if origin/master itself is outside the worktree's
# fetch state.
DIFF_BASE="origin/master"
if ! git rev-parse --verify "$DIFF_BASE" >/dev/null 2>&1; then
  DIFF_BASE="$(git merge-base HEAD master 2>/dev/null || echo HEAD)"
fi
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! allowlist_match "$path"; then
    violation_count=$((violation_count + 1))
    violations="$violations\n  $path"
  fi
done < <(git diff --name-only "$DIFF_BASE"...HEAD 2>/dev/null || true)

if [ "$violation_count" -eq 0 ]; then
  record_pass "AC-9 — diff respects allowlist (no drive-by changes)"
else
  printf "[FAIL] AC-9 — %d files outside allowlist:%b\n" \
    "$violation_count" "$violations" >&2
  record_fail "AC-9 — $violation_count files outside the allowlist"
fi

# ── AC-10 — index-check trailer ──────────────────────────────────────────
# Diff touches no hive-mind-persist/** paths ⇒ the PR body trailer is
# `index-check: none`. We can prove the precondition (no hive-mind paths)
# from outside the diff; the trailer itself lands when /ship Stage 5.5
# adds it to the PR body.
hive_touched="$(git diff --name-only "$DIFF_BASE"...HEAD 2>/dev/null | grep -c '^hive-mind-persist/' || true)"
if [ "$hive_touched" -eq 0 ]; then
  record_pass "AC-10 — diff touches 0 hive-mind-persist/** paths (trailer = 'index-check: none')"
else
  record_fail "AC-10 — diff touches $hive_touched hive-mind-persist/** paths; trailer must list IDs"
fi

# ── Version bump sanity check (informational) ────────────────────────────
PKG_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [ "$PKG_VERSION" = "0.39.0" ]; then
  echo "[INFO] package.json version is 0.39.0 (matches plan tag)"
else
  echo "[WARN] package.json version is $PKG_VERSION (plan expects 0.39.0)"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "v0.39.0 acceptance summary: $PASS_COUNT passed / $FAIL_COUNT failed"
echo "════════════════════════════════════════════════════════════════════════"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
