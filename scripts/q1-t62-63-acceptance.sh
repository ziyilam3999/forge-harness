#!/usr/bin/env bash
# Acceptance wrapper for q1 tasks #62 + #63 — runs AC-1 through AC-6 in order,
# halts on first failure, and exits 0 only if every AC passes.
#
# AC list:
#   AC-1: scripts 06-09 reference a base-branch-scoped diff (master...HEAD)
#   AC-2: no raw unscoped `git diff --numstat` remains in scripts 06-09
#   AC-3: generate-phase JSON mktemp/trap parity is 32/32 globally
#   AC-4: every mktemp command in generate-phase JSON has a matching trap
#         (AC-3 parity script also emits offenders for AC-4)
#   AC-5: this wrapper itself exits 0 (self-referential — AC-5 passes iff
#         AC-1..AC-4 + AC-6 all pass)
#   AC-6: no drive-by edits — only files in the allowlist are modified
#         relative to origin/master...HEAD

set -euo pipefail
export MSYS_NO_PATHCONV=1

PASS=0; FAIL=0

check() {
  local label="$1"; shift
  if "$@"; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    FAIL=$((FAIL + 1))
    return 1
  fi
}

ac1_base_branch_scoped() {
  for f in scripts/q1-t40-06-acceptance.sh scripts/q1-t40-07-acceptance.sh scripts/q1-t40-08-acceptance.sh scripts/q1-t40-09-acceptance.sh; do
    local c
    c=$(grep -c "master\.\.\.HEAD" "$f" || true)
    if [ "$c" -lt 1 ]; then
      echo "    $f has $c matches (need >= 1)"
      return 1
    fi
  done
  return 0
}

ac2_no_unscoped_numstat() {
  local bad
  bad=$(grep -En "git diff --numstat" \
    scripts/q1-t40-06-acceptance.sh \
    scripts/q1-t40-07-acceptance.sh \
    scripts/q1-t40-08-acceptance.sh \
    scripts/q1-t40-09-acceptance.sh \
    | grep -vE "master\.\.\.HEAD" || true)
  if [ -n "$bad" ]; then
    echo "    Unscoped numstat calls found:"
    echo "$bad" | sed 's/^/      /'
    return 1
  fi
  return 0
}

ac3_ac4_parity_and_colocation() {
  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync(".ai-workspace/plans/forge-generate-phase-PH-01.json","utf8"));
    let mk=0, tr=0, offenders=[];
    const visit = (n,p="root") => {
      if (typeof n === "string") {
        const m = (n.match(/mktemp/g)||[]).length;
        const t = (n.match(/trap [\x27"]?rm -f/g)||[]).length;
        mk += m; tr += t;
        if (m > 0 && t === 0) offenders.push(p);
      } else if (Array.isArray(n)) n.forEach((v,i) => visit(v,p+"["+i+"]"));
      else if (n && typeof n === "object") for (const k of Object.keys(n)) visit(n[k],p+"."+k);
    };
    visit(j);
    console.log("    mktemp="+mk+" trap="+tr+" offenders="+offenders.length);
    if (mk < 1 || mk !== tr || offenders.length > 0) {
      console.error("    FAIL offenders:", offenders);
      process.exit(1);
    }
  '
}

ac6_no_drive_by_edits() {
  local allowed_regex='^(scripts/q1-t40-0[6-9]-acceptance\.sh|\.ai-workspace/plans/forge-generate-phase-PH-01\.json|\.ai-workspace/plans/2026-04-17-q1-t62-63-acceptance-and-mktemp-polish\.md|scripts/q1-t62-63-acceptance\.sh)$'
  local bad
  bad=$(git diff --name-only origin/master...HEAD | grep -vE "$allowed_regex" || true)
  if [ -n "$bad" ]; then
    echo "    Unexpected files in diff:"
    echo "$bad" | sed 's/^/      /'
    return 1
  fi
  return 0
}

echo "=== q1 task #62 + #63 acceptance wrapper ==="
echo ""

echo "AC-1: scripts 06-09 reference a base-branch-scoped diff"
check "AC-1 base-branch-scoped diff" ac1_base_branch_scoped || exit 1
echo ""

echo "AC-2: no raw unscoped numstat remains in scripts 06-09"
check "AC-2 no unscoped numstat" ac2_no_unscoped_numstat || exit 1
echo ""

echo "AC-3 + AC-4: generate-phase JSON mktemp/trap parity and co-location"
check "AC-3/AC-4 parity + co-location" ac3_ac4_parity_and_colocation || exit 1
echo ""

echo "AC-6: no drive-by edits (allowlist enforcement)"
check "AC-6 no drive-by edits" ac6_no_drive_by_edits || exit 1
echo ""

echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -eq 0 ]; then
  echo "AC-5 (wrapper green): PASS"
  exit 0
else
  echo "AC-5 (wrapper green): FAIL"
  exit 1
fi
