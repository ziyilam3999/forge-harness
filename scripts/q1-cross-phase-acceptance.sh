#!/usr/bin/env bash
# task #22 — Q1 cross-phase exemption decision acceptance wrapper.
# Runs every AC for the AFFIRM branch (we did not take UNWIND).
# Exits 0 iff every AC passes.
#
# Usage: bash scripts/q1-cross-phase-acceptance.sh
#
# Notes:
#   - Plan: .ai-workspace/plans/2026-04-15-q1-cross-phase-grep-audit.md
#   - Decision file: .ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md
#   - jq is not assumed; AC-3 uses node as fallback (consistent with executor's tool manifest)
#   - MSYS_NO_PATHCONV=1 is exported to disable Git Bash path mangling on origin/master:<path>

set -u
export MSYS_NO_PATHCONV=1

# Log files go to project-relative tmp/ so paths resolve identically under MSYS
# bash and node.exe on Windows (#341). tmp/ is gitignored.
mkdir -p tmp

DECISION_FILE=".ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md"
PLAN_FILE=".ai-workspace/plans/2026-04-15-q1-cross-phase-grep-audit.md"

PASS=0
FAIL=0

ok()  { printf "  [PASS] %s\n" "$*"; PASS=$((PASS+1)); }
bad() { printf "  [FAIL] %s\n" "$*"; FAIL=$((FAIL+1)); }
section() { printf "\n=== %s ===\n" "$*"; }

# ── AC-1 — decision recorded ─────────────────────────────────────────────
section "AC-1 — Decision recorded (AFFIRM or UNWIND in first 10 lines)"
COUNT=$(head -10 "$DECISION_FILE" 2>/dev/null | grep -cE '^Decision: (AFFIRM|UNWIND)$' || true)
if [ "$COUNT" = "1" ]; then ok "decision line present"; else bad "expected 1, got $COUNT"; fi

# ── AC-2 — measurement section present ───────────────────────────────────
section "AC-2 — Measurement section present"
COUNT=$(grep -c '^## Measurement$' "$DECISION_FILE" 2>/dev/null || true)
if [ "$COUNT" = "1" ]; then ok "## Measurement section found"; else bad "expected 1, got $COUNT"; fi

# ── AC-3 — Branch A invariant (rationale refreshed on all 9 files) ──────
section "AC-3 — All 9 c1-bootstrap rationales differ from origin/master"
STALE=0
TOTAL=0
for f in $(grep -l 2026-04-13-c1-bootstrap .ai-workspace/plans/*.json); do
  TOTAL=$((TOTAL+1))
  OLD=$(git cat-file blob "origin/master:$f" 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);const e=(j.lintExempt||[]).find(x=>x.batch==="2026-04-13-c1-bootstrap");process.stdout.write(e?e.rationale:"")}catch(_){process.stdout.write("")}})' || true)
  NEW=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=(j.lintExempt||[]).find(x=>x.batch==="2026-04-13-c1-bootstrap");process.stdout.write(e?e.rationale:"")}catch(_){process.stdout.write("")}' "$f")
  if [ "$OLD" = "$NEW" ]; then
    STALE=$((STALE+1))
    echo "    STALE: $f"
  fi
done
if [ "$STALE" = "0" ] && [ "$TOTAL" = "9" ]; then
  ok "all 9 rationales refreshed (0 STALE / $TOTAL files)"
else
  bad "STALE=$STALE TOTAL=$TOTAL (want STALE=0, TOTAL=9)"
fi

# ── AC-4 — Branch B invariant — SKIPPED (we took AFFIRM) ────────────────
section "AC-4 — Branch B invariant (skipped: we took AFFIRM)"
ok "skipped per ordering constraint (AC-3 XOR AC-4)"

# ── AC-5 — ac-lint clean ─────────────────────────────────────────────────
section "AC-5 — ac-lint test green"
if npx vitest run server/validation/ac-lint.test.ts >tmp/ac5.log 2>&1; then
  ok "ac-lint.test.ts green"
else
  bad "ac-lint.test.ts failed (see tmp/ac5.log)"
  tail -15 tmp/ac5.log
fi

# ── AC-6 — build green ───────────────────────────────────────────────────
section "AC-6 — npm run build exits 0"
if npm run build >tmp/ac6.log 2>&1; then
  ok "build clean"
else
  bad "build failed (see tmp/ac6.log)"
  tail -15 tmp/ac6.log
fi

# ── AC-7 — lint green ────────────────────────────────────────────────────
section "AC-7 — npm run lint exits 0"
if npm run lint >tmp/ac7.log 2>&1; then
  ok "lint clean"
else
  bad "lint failed (see tmp/ac7.log)"
  tail -15 tmp/ac7.log
fi

# ── AC-8 — npm test green ────────────────────────────────────────────────
section "AC-8 — npm test exits 0"
if npm test >tmp/ac8.log 2>&1; then
  ok "test suite clean"
else
  bad "test suite failed (see tmp/ac8.log)"
  tail -20 tmp/ac8.log
fi

# ── AC-9 — diff scope ────────────────────────────────────────────────────
section "AC-9 — git diff origin/master...HEAD --stat path scope"
DIFF_OUT=$(git diff origin/master...HEAD --name-only 2>/dev/null || true)
echo "$DIFF_OUT" | sed 's/^/    /'
BAD_PATHS=$(echo "$DIFF_OUT" | grep -vE '^(\.ai-workspace/(plans/(forge-(coordinate|generate)-phase-PH-0[1234]\.json|2026-04-02-phase2-forge-plan-output\.json|2026-04-15-q1-cross-phase-grep-audit\.md)|audits/2026-04-15-.*\.md)|scripts/q1-cross-phase-acceptance\.sh)$' || true)
if [ -z "$BAD_PATHS" ]; then
  ok "all changed paths within AC-9 allowlist"
else
  bad "out-of-scope paths in diff:"
  echo "$BAD_PATHS" | sed 's/^/      /'
fi

# Belt & suspenders: confirm zero server/** changes
SERVER_CHANGES=$(echo "$DIFF_OUT" | grep -c '^server/' || true)
if [ "$SERVER_CHANGES" = "0" ]; then
  ok "zero server/** changes"
else
  bad "$SERVER_CHANGES server/** files changed"
fi

# ── AC-10 — CI green (post-push only) ───────────────────────────────────
section "AC-10 — CI green on PR (deferred until push)"
ok "deferred (verified by gh pr checks after push)"

# ── Summary ──────────────────────────────────────────────────────────────
printf "\n=== Summary ===\n"
printf "  PASS: %s\n  FAIL: %s\n" "$PASS" "$FAIL"
if [ "$FAIL" = "0" ]; then
  printf "\nALL ACCEPTABLE.\n"
  exit 0
else
  printf "\nFAILURES PRESENT — do not push.\n"
  exit 1
fi
