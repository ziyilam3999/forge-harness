#!/usr/bin/env bash
set -euo pipefail

PASS=0; FAIL=0; TOTAL=0

run() {
  TOTAL=$((TOTAL + 1))
  local label="$1"; shift
  if eval "$@" >/dev/null 2>&1; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== q1-t40-06 acceptance: PH01-US-05 AC rewrite ==="
echo ""

# AC-1: JSON lint-clean
run "AC-1 eslint JSON" npx eslint .ai-workspace/plans/forge-coordinate-phase-PH-01.json

# AC-2: No grep -q 'passed' remains in PH01-US-05 ACs
run "AC-2 no grep-q-passed in US-05" bash -c '
  node -e "
    const f = JSON.parse(require(\"fs\").readFileSync(\".ai-workspace/plans/forge-coordinate-phase-PH-01.json\",\"utf8\"));
    const s = f.stories.find(s=>s.id===\"PH01-US-05\");
    const bad = s.acceptanceCriteria.filter(ac=>ac.command && ac.command.includes(\"grep -q\"));
    if(bad.length>0){console.error(\"Found grep -q in:\",bad.map(a=>a.id));process.exit(1);}
    console.log(\"All US-05 ACs use --reporter=json pattern\");
  "
'

# AC-3: All 8 rewritten ACs use --reporter=json pattern
run "AC-3 all 8 use reporter=json" bash -c '
  node -e "
    const f = JSON.parse(require(\"fs\").readFileSync(\".ai-workspace/plans/forge-coordinate-phase-PH-01.json\",\"utf8\"));
    const s = f.stories.find(s=>s.id===\"PH01-US-05\");
    const ids = [\"AC02\",\"AC03\",\"AC04\",\"AC05\",\"AC06\",\"AC07\",\"AC08\",\"AC09\"];
    for(const id of ids){
      const ac = s.acceptanceCriteria.find(a=>a.id===\"PH01-US-05-\"+id);
      if(!ac){console.error(\"Missing \"+id);process.exit(1);}
      if(!ac.command.includes(\"--reporter=json\")){console.error(id+\" missing --reporter=json\");process.exit(1);}
      if(!ac.command.includes(\"--outputFile\")){console.error(id+\" missing --outputFile\");process.exit(1);}
    }
    console.log(\"All 8 ACs verified\");
  "
'

# AC-4: git diff --stat shows exactly 16 line changes (8 ins + 8 del) in the JSON
run "AC-4 diff is 8+8=16" bash -c '
  STAT=$(git diff --numstat .ai-workspace/plans/forge-coordinate-phase-PH-01.json)
  ADDED=$(echo "$STAT" | awk "{print \$1}")
  REMOVED=$(echo "$STAT" | awk "{print \$2}")
  if [ "$ADDED" = "8" ] && [ "$REMOVED" = "8" ]; then
    echo "OK: +8 -8"
  else
    echo "FAIL: expected +8 -8, got +$ADDED -$REMOVED"
    exit 1
  fi
'

# AC-5: diff confined to the phase JSON only
run "AC-5 diff confined to phase JSON" bash -c '
  FILES=$(git diff --name-only)
  if [ "$FILES" = ".ai-workspace/plans/forge-coordinate-phase-PH-01.json" ]; then
    echo "OK: only phase JSON changed"
  else
    echo "FAIL: unexpected files changed: $FILES"
    exit 1
  fi
'

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
