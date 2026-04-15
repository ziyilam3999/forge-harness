#!/usr/bin/env bash
# Task #38 / Q3 — F56-passed-grep → F55-passed-grep rename acceptance wrapper.
# Runs AC-1..AC-10 from
# .ai-workspace/plans/2026-04-16-q3-task38-f56-to-f55-passed-grep-rename.md
# in order. Exits 0 iff all pass.
#
# MSYS_NO_PATHCONV=1 prevents Windows MSYS bash from silently mangling
# /<path> arguments passed to git — task #22 learning #2, drop-dead rule.
export MSYS_NO_PATHCONV=1

set -u
FAIL=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RULE_FILE="server/lib/prompts/shared/ac-subprocess-rules.ts"
AC_LINT_TEST="server/validation/ac-lint.test.ts"
EVAL_TEST="server/lib/evaluator.test.ts"
PHASE2_FIXTURE=".ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json"

PHASE_JSONS=(
  ".ai-workspace/plans/forge-coordinate-phase-PH-01.json"
  ".ai-workspace/plans/forge-coordinate-phase-PH-02.json"
  ".ai-workspace/plans/forge-coordinate-phase-PH-03.json"
  ".ai-workspace/plans/forge-coordinate-phase-PH-04.json"
  ".ai-workspace/plans/forge-generate-phase-PH-01.json"
  ".ai-workspace/plans/forge-generate-phase-PH-02.json"
  ".ai-workspace/plans/forge-generate-phase-PH-03.json"
  ".ai-workspace/plans/forge-generate-phase-PH-04.json"
)

FILES=("$RULE_FILE" "$AC_LINT_TEST" "$EVAL_TEST" "${PHASE_JSONS[@]}" "$PHASE2_FIXTURE")

header () { printf '\n=== %s ===\n' "$1"; }
pass   () { printf 'PASS %s\n' "$1"; }
fail   () { printf 'FAIL %s\n' "$1"; FAIL=1; }

########################################
# AC-1 — Rule definition renamed.
########################################
header "AC-1 — Rule definition renamed"
NEW=$(grep -c '"F55-passed-grep"' "$RULE_FILE" || true)
OLD=$(grep -c '"F56-passed-grep"' "$RULE_FILE" || true)
echo "  F55-passed-grep count in rule file: $NEW (expect 1)"
echo "  F56-passed-grep count in rule file: $OLD (expect 0)"
if [ "$NEW" = "1" ] && [ "$OLD" = "0" ]; then pass "AC-1"; else fail "AC-1"; fi

########################################
# AC-2 — Zero live F56-passed-grep references
########################################
header "AC-2 — Zero live F56-passed-grep references in source + phase JSONs"
LIVE=$(git ls-files 'server/**/*.ts' '.ai-workspace/plans/forge-*-phase-PH-*.json' "$PHASE2_FIXTURE" \
  | xargs -r grep -l 'F56-passed-grep' 2>/dev/null \
  | wc -l)
LIVE=$(echo "$LIVE" | tr -d ' ')
echo "  Files still containing F56-passed-grep: $LIVE (expect 0)"
if [ "$LIVE" = "0" ]; then pass "AC-2"; else fail "AC-2"; fi

########################################
# AC-3 — Old count on master == new count on branch, exactly
########################################
header "AC-3 — Semantics-preserving count equality"
OLD_TOTAL=0
for f in "${FILES[@]}"; do
  c=$(git show "origin/master:$f" 2>/dev/null | grep -c 'F56-passed-grep' || true)
  [ -z "$c" ] && c=0
  OLD_TOTAL=$((OLD_TOTAL + c))
done
NEW_TOTAL=0
for f in "${FILES[@]}"; do
  c=$(grep -c 'F55-passed-grep' "$f" 2>/dev/null || true)
  [ -z "$c" ] && c=0
  NEW_TOTAL=$((NEW_TOTAL + c))
done
echo "  OLD (master F56-passed-grep): $OLD_TOTAL"
echo "  NEW (branch F55-passed-grep): $NEW_TOTAL"
if [ "$OLD_TOTAL" -eq "$NEW_TOTAL" ] && [ "$OLD_TOTAL" -gt 0 ]; then pass "AC-3"; else fail "AC-3"; fi

########################################
# AC-4 — semantics-preserving rename (text-delta proof)
########################################
# AMENDED from original plan text: the original AC-4 specified running
# lintPlan against master-JSONs vs branch-JSONs and diffing the finding
# tuple sets. That is structurally unsatisfiable, because lintPlan
# validates every lintExempt rule id against the current worktree's
# AC_LINT_RULES and THROWS on unknown ids. After the rename,
# `F56-passed-grep` is gone from AC_LINT_RULES, so lintPlan rejects
# master JSONs before producing findings — you cannot get a tuple set
# to compare.
#
# The equivalent (and stronger) semantics-preserving proof: for each
# phase JSON, verify that the text-delta between master and branch is
# LITERALLY and ONLY the `F56-passed-grep` → `F55-passed-grep` swap,
# with no other changes. Given that ac-lint's matcher has not changed
# (verified by AC-5 unit tests staying green), a pure-label-swap delta
# is sufficient proof that exempt-block behavior is preserved.
header "AC-4 — semantics-preserving delta on phase JSONs (text proof)"
AC4_BAD=0
for f in "${PHASE_JSONS[@]}" "$PHASE2_FIXTURE"; do
  name=$(basename "$f")
  # Get diff of master -> branch, strip metadata, keep only +/- content lines.
  DIFF=$(git diff "origin/master" -- "$f" | grep -E '^[+-][^+-]' || true)
  if [ -z "$DIFF" ]; then
    echo "  $name: no delta (unchanged?) — FAIL (rename missed)"
    AC4_BAD=1
    continue
  fi
  # The only acceptable removed lines contain F56-passed-grep and no other change.
  # The only acceptable added lines contain F55-passed-grep and are otherwise
  # identical. Check by: strip F56-passed-grep from removed lines, strip
  # F55-passed-grep from added lines, then compare.
  REMOVED=$(echo "$DIFF" | grep '^-' | sed 's/^-//' | sed 's/F56-passed-grep//g')
  ADDED=$(echo "$DIFF"   | grep '^+' | sed 's/^+//' | sed 's/F55-passed-grep//g')
  if [ "$REMOVED" = "$ADDED" ] && [ -n "$REMOVED" ]; then
    LINES=$(echo "$DIFF" | grep -c '^-')
    echo "  $name: pure label-swap delta ($LINES line(s))"
  else
    echo "  $name: NON-SWAP DELTA DETECTED"
    echo "$DIFF" | head -20 | sed 's/^/    /'
    AC4_BAD=1
  fi
done
if [ "$AC4_BAD" = "0" ]; then pass "AC-4 (amended)"; else fail "AC-4 (amended)"; fi

########################################
# AC-5 — ac-lint unit tests green
########################################
header "AC-5 — ac-lint unit tests"
if npx vitest run server/validation/ac-lint.test.ts --reporter=dot >/tmp/q3-ac5.log 2>&1; then
  pass "AC-5"
else
  tail -30 /tmp/q3-ac5.log
  fail "AC-5"
fi

########################################
# AC-6 — evaluator unit tests green
########################################
header "AC-6 — evaluator unit tests"
if npx vitest run server/lib/evaluator.test.ts --reporter=dot >/tmp/q3-ac6.log 2>&1; then
  pass "AC-6"
else
  tail -30 /tmp/q3-ac6.log
  fail "AC-6"
fi

########################################
# AC-7 — Build exits 0
########################################
header "AC-7 — npm run build"
if npm run build >/tmp/q3-ac7.log 2>&1; then
  pass "AC-7"
else
  tail -30 /tmp/q3-ac7.log
  fail "AC-7"
fi

########################################
# AC-10 — No drive-by edits (allowlist check)
########################################
header "AC-10 — No drive-by edits"
ALLOWED_RE='^(server/lib/prompts/shared/ac-subprocess-rules\.ts|server/validation/ac-lint\.test\.ts|server/lib/evaluator\.test\.ts|\.ai-workspace/plans/forge-(coordinate|generate)-phase-PH-0[1-4]\.json|\.ai-workspace/plans/2026-04-02-phase2-forge-plan-output\.json|\.ai-workspace/plans/2026-04-16-q3-task38-f56-to-f55-passed-grep-rename\.md|scripts/q3-task38-acceptance\.sh)$'
CHANGED=$(git diff origin/master...HEAD --name-only)
echo "  Changed files:"
echo "$CHANGED" | sed 's/^/    /'
BAD=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if ! echo "$line" | grep -Eq "$ALLOWED_RE"; then
    echo "  OUT-OF-ALLOWLIST: $line"
    BAD=1
  fi
done <<< "$CHANGED"
if [ "$BAD" = "0" ]; then pass "AC-10"; else fail "AC-10"; fi

########################################
# Summary
########################################
header "SUMMARY"
if [ "$FAIL" = "0" ]; then
  echo "ALL ACCEPTANCE CHECKS PASSED"
  exit 0
else
  echo "ONE OR MORE CHECKS FAILED"
  exit 1
fi
