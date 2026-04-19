#!/usr/bin/env bash
#
# Acceptance wrapper for the 2026-04-18 kanban-dashboard plan.
# Runs every binary AC (18 of them) in order. Exits 0 iff all pass.
#
# Usage:  bash scripts/s8-kanban-dashboard-acceptance.sh
#
# Environment: MSYS/Git-Bash on Windows is fully supported. `jq` is not a
# hard requirement — JSON assertions are performed via `node -e` inline.
# Any tool substitution done here mirrors the brief's fallback clause.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Output bookkeeping ────────────────────────────────────────────────────
pass_count=0
fail_count=0
declare -a failed_ac=()

pass() {
  echo "  PASS — $1"
  pass_count=$((pass_count + 1))
}

fail() {
  echo "  FAIL — $1"
  fail_count=$((fail_count + 1))
  failed_ac+=("$2")
}

section() {
  echo ""
  echo "=================================================================="
  echo "  $1"
  echo "=================================================================="
}

# ── Fixture setup ─────────────────────────────────────────────────────────
# Create an isolated fixture project with:
#   - a minimal execution-plan.json (2 stories: US-01 done, US-02 ready)
#   - 1 RunRecord for US-01 (so the brief reports completedCount=1)
#   - an activity.json pointing forge_generate @ US-03 critic round 2
#     (routes US-03 into col-in-progress even though it is not in the plan)
#   - 15 audit entries spread across 3 JSONL files under .forge/audit/
#
# The fixture lives at a temp path the driver will pass to handleCoordinate
# via the MCP tool signature.

FIXTURE_DIR="$(mktemp -d -t s8-kanban-fixture-XXXXXX)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

mkdir -p "$FIXTURE_DIR/.forge/runs"
mkdir -p "$FIXTURE_DIR/.forge/audit"

# Plan: 9 stories so the fixture can reach completedCount=4, totalCount=9
# (matching AC-07's exact "4/9" substring contract). Deps form a line so
# ordering is deterministic.
cat > "$FIXTURE_DIR/plan.json" <<'JSON'
{
  "schemaVersion": "3.0.0",
  "stories": [
    {"id": "US-01", "title": "Story 1", "dependencies": [], "acceptanceCriteria": [{"id": "US-01-AC01", "description": "done", "command": "true"}]},
    {"id": "US-02", "title": "Story 2", "dependencies": ["US-01"], "acceptanceCriteria": [{"id": "US-02-AC01", "description": "done", "command": "true"}]},
    {"id": "US-03", "title": "Story 3", "dependencies": ["US-02"], "acceptanceCriteria": [{"id": "US-03-AC01", "description": "done", "command": "true"}]},
    {"id": "US-04", "title": "Story 4", "dependencies": ["US-03"], "acceptanceCriteria": [{"id": "US-04-AC01", "description": "done", "command": "true"}]},
    {"id": "US-05", "title": "Story 5", "dependencies": ["US-04"], "acceptanceCriteria": [{"id": "US-05-AC01", "description": "ready", "command": "true"}]},
    {"id": "US-06", "title": "Story 6", "dependencies": ["US-05"], "acceptanceCriteria": [{"id": "US-06-AC01", "description": "pending", "command": "true"}]},
    {"id": "US-07", "title": "Story 7", "dependencies": ["US-06"], "acceptanceCriteria": [{"id": "US-07-AC01", "description": "pending", "command": "true"}]},
    {"id": "US-08", "title": "Story 8", "dependencies": ["US-07"], "acceptanceCriteria": [{"id": "US-08-AC01", "description": "pending", "command": "true"}]},
    {"id": "US-09", "title": "Story 9", "dependencies": ["US-08"], "acceptanceCriteria": [{"id": "US-09-AC01", "description": "pending", "command": "true"}]}
  ]
}
JSON

# RunRecords marking US-01 through US-04 PASS. Cost per run = $2.15/4 so
# the aggregated budget.usedUsd is $2.15 total (matching AC-07).
#
# Timestamps are generated relative to NOW (60s ago + 1..4s offset) so they
# fall inside the driver's `currentPlanStartTimeMs = Date.now() - 5min`
# window at server/lib/coordinator.ts:314. Previously the fixture used
# hardcoded absolute timestamps which drifted outside the window, causing
# assessPhase to silently skip them and AC-07 to fail.
TS_LIST=($(node -e '
  const base = Date.now() - 60000;
  const parts = [];
  for (let i = 1; i <= 4; i++) parts.push(new Date(base + i * 1000).toISOString());
  process.stdout.write(parts.join(" "));
'))
for n in 01 02 03 04; do
  idx=$((10#$n - 1))
  ts="${TS_LIST[$idx]}"
  # filesystem-safe variant: replace ':' and '.' with '-'
  safe_ts="${ts//:/-}"
  safe_ts="${safe_ts//./-}"
  # $2.15 / 4 = $0.5375 per record. Four records sum to exactly $2.15.
  cat > "$FIXTURE_DIR/.forge/runs/forge_evaluate-${safe_ts}-00${n}.json" <<JSON_INNER
{
  "timestamp": "${ts}",
  "tool": "forge_evaluate",
  "documentTier": null,
  "mode": null,
  "tier": "standard",
  "storyId": "US-${n}",
  "evalVerdict": "PASS",
  "metrics": {
    "inputTokens": 100,
    "outputTokens": 50,
    "critiqueRounds": 0,
    "findingsTotal": 0,
    "findingsApplied": 0,
    "findingsRejected": 0,
    "validationRetries": 0,
    "durationMs": 1000,
    "estimatedCostUsd": 0.5375
  },
  "outcome": "success"
}
JSON_INNER
done

# activity.json — points forge_generate at US-03 (not in plan).
cat > "$FIXTURE_DIR/.forge/activity.json" <<'JSON'
{
  "tool": "forge_generate",
  "storyId": "US-03",
  "stage": "critic round 2",
  "startedAt": "2026-04-18T10:30:00.000Z",
  "lastUpdate": "2026-04-18T10:32:15.000Z"
}
JSON

# 15 audit entries spread across 3 JSONL files.
for file_idx in 1 2 3; do
  audit_file="$FIXTURE_DIR/.forge/audit/forge_generate-2026-04-18T10-0${file_idx}-00-000Z.jsonl"
  > "$audit_file"
  for line_idx in 1 2 3 4 5; do
    # Compose ISO timestamp so entries are uniquely orderable.
    ts="2026-04-18T10:0${file_idx}:0${line_idx}.000Z"
    printf '{"timestamp":"%s","stage":"critic round %d","agentRole":"critic","decision":"revise","reasoning":"-"}\n' \
      "$ts" "$line_idx" >> "$audit_file"
  done
done

# ── Build + baseline test ─────────────────────────────────────────────────
section "AC-17 — build + tests (delta vs master)"

echo "tsc..."
if npm run build >/dev/null 2>&1; then
  pass "npm run build exited 0"
else
  fail "npm run build exited non-zero" "AC-17"
fi

echo "vitest run (full suite)..."
if npm test >/dev/null 2>&1; then
  pass "npm test exited 0"
else
  fail "npm test exited non-zero" "AC-17"
fi

echo "smoke: mcp-surface..."
if npx vitest run server/smoke/mcp-surface.test.ts >/dev/null 2>&1; then
  pass "vitest run server/smoke/mcp-surface.test.ts exited 0"
else
  fail "server/smoke/mcp-surface.test.ts failed" "AC-17"
fi

# ── Drive handleCoordinate against the fixture ────────────────────────────
section "Invoke forge_coordinate against fixture project"

# Driver lives inside REPO_ROOT so its `./dist/...` relative imports resolve
# against the package we just built.
DRIVER="$REPO_ROOT/_fixture_driver.mjs"
trap 'rm -rf "$FIXTURE_DIR" "$DRIVER"' EXIT

cat > "$DRIVER" <<'JS'
import { handleCoordinate } from "./dist/tools/coordinate.js";
import { renderDashboard } from "./dist/lib/dashboard-renderer.js";

const projectPath = process.argv[2];
const planPath = process.argv[3];

const result = await handleCoordinate({
  planPath,
  phaseId: "default",
  projectPath,
  budgetUsd: 10,
  maxTimeMs: 60 * 60 * 1000,
  currentPlanStartTimeMs: Date.now() - 5 * 60 * 1000,
});

if (result.isError) {
  console.error("handleCoordinate returned error:", JSON.stringify(result, null, 2));
  process.exit(2);
}

// Explicitly trigger a dashboard render so AC-01/02/06/07/11 have input to
// grep over. In production, this happens via ProgressReporter hooks and
// the writeRunRecord hook; for the acceptance fixture we drive it
// directly so the wrapper does not depend on fire-and-forget timing.
await renderDashboard(projectPath);
JS

if node "$DRIVER" "$FIXTURE_DIR" "$FIXTURE_DIR/plan.json"; then
  echo "driver completed"
else
  echo "driver failed"
  fail_count=$((fail_count + 1))
  failed_ac+=("driver")
fi

DASHBOARD_PATH="$FIXTURE_DIR/.forge/dashboard.html"
BRIEF_PATH="$FIXTURE_DIR/.forge/coordinate-brief.json"

# ── AC-01 ─────────────────────────────────────────────────────────────────
section "AC-01 — dashboard.html exists + contains <html>"
if [[ -f "$DASHBOARD_PATH" ]] && [[ "$(grep -c '<html>' "$DASHBOARD_PATH")" == "1" ]]; then
  pass "AC-01"
else
  fail "dashboard.html missing or <html> count != 1" "AC-01"
fi

# ── AC-02 ─────────────────────────────────────────────────────────────────
section "AC-02 — each of 6 column IDs appears exactly once (literal AC wording)"
ac02_all_pass=1
for id in col-backlog col-ready col-in-progress col-retry col-done col-blocked; do
  # Plan's AC-02 literal grep: `grep -c 'id="col-X"'`. Renderer uses
  # class-based CSS accents (not attribute selectors) so this counts the
  # column wrapper exactly once.
  count="$(grep -c "id=\"$id\"" "$DASHBOARD_PATH")"
  if [[ "$count" == "1" ]]; then
    pass "id=\"$id\" appears exactly once (grep -c matches plan's literal wording)"
  else
    fail "id=\"$id\" count = $count (expected 1)" "AC-02"
    ac02_all_pass=0
  fi
done

# ── AC-06 ─────────────────────────────────────────────────────────────────
section "AC-06 — meta refresh tag present exactly once"
if [[ "$(grep -c 'meta http-equiv="refresh" content="5"' "$DASHBOARD_PATH")" == "1" ]]; then
  pass "AC-06"
else
  fail "meta refresh count != 1" "AC-06"
fi

# ── AC-07 ─────────────────────────────────────────────────────────────────
section "AC-07 — header contains 4/9, \$2.15, \$10 substrings"
ac07_ok=1
for substr in "4/9" '$2.15' '$10'; do
  if ! grep -qF "$substr" "$DASHBOARD_PATH"; then
    fail "header missing substring '$substr'" "AC-07"
    ac07_ok=0
  fi
done
if (( ac07_ok )); then
  pass "AC-07 — all three header substrings present"
fi

# ── AC-11 ─────────────────────────────────────────────────────────────────
section "AC-11 — no external deps in HTML"
ext_count="$(grep -cE 'cdn|googleapis|unpkg|cloudflare' "$DASHBOARD_PATH" || true)"
if [[ "$ext_count" == "0" ]]; then
  pass "AC-11 — no CDN / googleapis / unpkg / cloudflare references"
else
  fail "AC-11 — $ext_count external-resource reference(s)" "AC-11"
fi
# Also: no <link rel="stylesheet" href="http...
if grep -qE '<link[^>]*rel="stylesheet"[^>]*href="http' "$DASHBOARD_PATH"; then
  fail "AC-11 — external stylesheet link found" "AC-11"
fi
# Also: no <script src="http...
if grep -qE '<script[^>]*src="http' "$DASHBOARD_PATH"; then
  fail "AC-11 — external script src found" "AC-11"
fi

# ── AC-15 ─────────────────────────────────────────────────────────────────
section "AC-15 — coordinate-brief.json has status/stories/completedCount/totalCount"
if [[ ! -f "$BRIEF_PATH" ]]; then
  fail "coordinate-brief.json missing" "AC-15"
else
  # Use node -e for JSON assertions (jq is optional per tool manifest).
  ac15_ok=$(node -e "
    const fs = require('fs');
    try {
      const brief = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
      const checks = [
        brief.status !== undefined && brief.status !== null,
        Array.isArray(brief.stories),
        typeof brief.completedCount === 'number',
        typeof brief.totalCount === 'number',
      ];
      console.log(checks.every(Boolean) ? 'OK' : 'MISSING');
    } catch (e) {
      console.log('PARSE_ERROR');
    }
  " "$BRIEF_PATH")
  if [[ "$ac15_ok" == "OK" ]]; then
    pass "AC-15 — brief parses + 4 required fields populated"
  else
    fail "AC-15 — brief.json field check: $ac15_ok" "AC-15"
  fi
fi

# ── Unit-test-covered AC (re-run just the dashboard test file) ────────────
section "Unit-test-covered AC (AC-03, 04, 05, 08, 09, 10, 12, 13, 14, 16, 18)"
if npx vitest run server/lib/dashboard-renderer.test.ts server/lib/activity.test.ts server/lib/coordinator-brief-write.test.ts >/dev/null 2>&1; then
  pass "AC-03/04/05/08/09/10/12/13/14/16/18 + activity + brief-write unit tests passed"
else
  fail "unit-test-covered AC failed — run npx vitest run server/lib/dashboard-renderer.test.ts for details" "AC-03..18"
fi

# ── Summary ────────────────────────────────────────────────────────────────
section "Summary"
echo "  pass: $pass_count"
echo "  fail: $fail_count"
if (( fail_count > 0 )); then
  echo "  failed AC: ${failed_ac[*]}"
  exit 1
fi
exit 0
