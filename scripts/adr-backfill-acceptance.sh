#!/usr/bin/env bash
# Acceptance wrapper for forge-adr-backfill.mjs (W2 of US-08 regression fix).
# Runs AC-5(a..c) from .ai-workspace/plans/2026-04-27-us08-adr-index-regression.md
# Exits 0 iff all sub-cases pass.
#
# Usage: bash scripts/adr-backfill-acceptance.sh
# Prereq: `npm run build` must have succeeded (dist/ populated).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLI="$REPO_ROOT/scripts/forge-adr-backfill.mjs"
DIST="$REPO_ROOT/dist/lib/adr-extractor.js"

if [ ! -f "$DIST" ]; then
  echo "FAIL: dist/lib/adr-extractor.js missing — run \`npm run build\` first."
  exit 1
fi

PASS=0
FAIL=0
declare -a FAILURES

check() {
  local name="$1"
  local description="$2"
  local exit_code="$3"
  if [ "$exit_code" -eq 0 ]; then
    echo "  [PASS] $name — $description"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $name — $description"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name: $description")
  fi
}

# Each scenario gets its own scratch project. tmp/ is gitignored.
mkdir -p tmp
SCRATCH_BASE="$(mktemp -d "${TMPDIR:-/tmp}/forge-adr-backfill-XXXXXX")"
trap 'rm -rf "$SCRATCH_BASE"' EXIT

echo "=== forge-adr-backfill acceptance ==="
echo

# ── AC-5(a) — PASS record + missing INDEX row → CLI adds the row ─────────
PROJ_A="$SCRATCH_BASE/case-a"
mkdir -p "$PROJ_A/.forge/runs" "$PROJ_A/.forge/staging/adr/US-08" "$PROJ_A/docs/decisions"

# Stage a real ADR stub mirroring the US-08 format (multi-line `|` block scalars).
cat > "$PROJ_A/.forge/staging/adr/US-08/add-slack-bolt-socket-mode.md" <<'EOF'
---
title: Adopt @slack/bolt with Socket Mode
story: US-08
context: |
  US-08 introduces the Slack-facing surface of monday-bot.
  We need a Slack SDK that supports Socket Mode.
decision: |
  Add @slack/bolt v4.x as a runtime dependency.
consequences: |
  Bundle gains @slack/bolt and transitive deps.
alternatives: |
  HTTP Receiver: rejected — requires public ingress.
---

body
EOF

# Write a PASS run record referencing US-08.
cat > "$PROJ_A/.forge/runs/forge_evaluate-2026-04-27T00-00-00-abcdef.json" <<'EOF'
{
  "tool": "forge_evaluate",
  "storyId": "US-08",
  "evalVerdict": "PASS",
  "verdict": "PASS",
  "metrics": { "estimatedCostUsd": 0 }
}
EOF

# Sanity: INDEX.md does not exist yet.
[ ! -f "$PROJ_A/docs/decisions/INDEX.md" ] && AC5A_PRE=0 || AC5A_PRE=1
check "AC-5(a)/pre" "INDEX.md absent before backfill" "$AC5A_PRE"

# Run the CLI.
node "$CLI" --project "$PROJ_A" > "$SCRATCH_BASE/case-a.log" 2>&1
AC5A_EXIT=$?
check "AC-5(a)/exit" "CLI exits 0 with stub on disk" "$AC5A_EXIT"

# Assert: ADR file created with US-08 suffix.
AC5A_ADR=1
if compgen -G "$PROJ_A/docs/decisions/ADR-*-US-08.md" > /dev/null; then AC5A_ADR=0; fi
check "AC-5(a)/adr" "ADR-NNNN-*-US-08.md file created" "$AC5A_ADR"

# Assert: INDEX.md exists and contains a row for ADR-0001 + US-08.
AC5A_INDEX=1
if [ -f "$PROJ_A/docs/decisions/INDEX.md" ] && \
   grep -qE '^\| ADR-0001 \| US-08 \|' "$PROJ_A/docs/decisions/INDEX.md"; then
  AC5A_INDEX=0
fi
check "AC-5(a)/index" "INDEX.md contains row pointing at ADR-0001 + US-08" "$AC5A_INDEX"

# Assert: staging dir cleared.
AC5A_STAGE=1
[ ! -d "$PROJ_A/.forge/staging/adr/US-08" ] && AC5A_STAGE=0
check "AC-5(a)/staging" "staging dir cleared after canonicalisation" "$AC5A_STAGE"

echo

# ── AC-5(b) — re-running case (a) is a no-op (INDEX byte-identical) ──────
INDEX_BEFORE_HASH=$(sha256sum "$PROJ_A/docs/decisions/INDEX.md" | awk '{print $1}')

node "$CLI" --project "$PROJ_A" > "$SCRATCH_BASE/case-b.log" 2>&1
AC5B_EXIT=$?
check "AC-5(b)/exit" "CLI re-run exits 0" "$AC5B_EXIT"

INDEX_AFTER_HASH=$(sha256sum "$PROJ_A/docs/decisions/INDEX.md" | awk '{print $1}')
[ "$INDEX_BEFORE_HASH" = "$INDEX_AFTER_HASH" ] && AC5B_HASH=0 || AC5B_HASH=1
check "AC-5(b)/idempotent" "INDEX.md byte-identical after re-run" "$AC5B_HASH"

# Assert: still exactly one ADR file (no duplicate).
ADR_COUNT_B=$(find "$PROJ_A/docs/decisions" -maxdepth 1 -name 'ADR-*.md' -type f | wc -l)
[ "$ADR_COUNT_B" -eq 1 ] && AC5B_NODUP=0 || AC5B_NODUP=1
check "AC-5(b)/nodup" "ADR file count remains 1 (no duplicate created), got $ADR_COUNT_B" "$AC5B_NODUP"

echo

# ── AC-5(c) — project with all rows already present → no-op ─────────────
PROJ_C="$SCRATCH_BASE/case-c"
mkdir -p "$PROJ_C/.forge/runs" "$PROJ_C/docs/decisions"

# Pre-populate: one canonical ADR + matching INDEX, no staging.
cat > "$PROJ_C/docs/decisions/ADR-0001-something-US-09.md" <<'EOF'
---
adr: 1
status: "Accepted"
story: "US-09"
date: "2026-04-26"
title: "Something"
---

# ADR-0001: Something

## Context

ctx

## Decision

dec

## Consequences

cons

## Alternatives considered

alts
EOF

# Write a PASS run record referencing US-09.
cat > "$PROJ_C/.forge/runs/forge_evaluate-2026-04-26T00-00-00-cafe01.json" <<'EOF'
{
  "tool": "forge_evaluate",
  "storyId": "US-09",
  "evalVerdict": "PASS",
  "verdict": "PASS",
  "metrics": { "estimatedCostUsd": 0 }
}
EOF

# Run once to materialise the INDEX (first-call effect — building the index
# from the existing ADR file is expected; AC-5(c) measures stability against
# RE-runs, not first-touch).
node "$CLI" --project "$PROJ_C" > "$SCRATCH_BASE/case-c-priming.log" 2>&1
INDEX_C_HASH_BEFORE=$(sha256sum "$PROJ_C/docs/decisions/INDEX.md" | awk '{print $1}')

# Re-run: must be a byte-stable no-op.
node "$CLI" --project "$PROJ_C" > "$SCRATCH_BASE/case-c.log" 2>&1
AC5C_EXIT=$?
check "AC-5(c)/exit" "CLI re-run on already-current project exits 0" "$AC5C_EXIT"

INDEX_C_HASH_AFTER=$(sha256sum "$PROJ_C/docs/decisions/INDEX.md" | awk '{print $1}')
[ "$INDEX_C_HASH_BEFORE" = "$INDEX_C_HASH_AFTER" ] && AC5C_HASH=0 || AC5C_HASH=1
check "AC-5(c)/idempotent" "INDEX.md byte-identical across two consecutive re-runs" "$AC5C_HASH"

# Assert: still no spurious 'no new decisions' row appended for US-09 (it has an ADR).
NO_DEC_COUNT_C=$(grep -cE '^\| US-09 \| no new decisions \|' "$PROJ_C/docs/decisions/INDEX.md" || true)
[ "$NO_DEC_COUNT_C" -eq 0 ] && AC5C_NODEC=0 || AC5C_NODEC=1
check "AC-5(c)/no-spurious-row" "no 'no new decisions' row added when story already has an ADR" "$AC5C_NODEC"

echo

# ── Summary ──────────────────────────────────────────────────────────────
echo "=== Summary ==="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
echo "All AC-5 sub-cases pass."
exit 0
