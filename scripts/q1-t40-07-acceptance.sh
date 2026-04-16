#!/usr/bin/env bash
# Acceptance wrapper for task #40 slice 7 — PH01-US01 AC rewrite
set -euo pipefail

FAIL=0
JSON=".ai-workspace/plans/forge-generate-phase-PH-01.json"

echo "=== AC1: JSON is valid ==="
if node -e "JSON.parse(require('fs').readFileSync('$JSON','utf8'))"; then
  echo "PASS"
else
  echo "FAIL: $JSON is not valid JSON"
  FAIL=1
fi

echo ""
echo "=== AC2: Each rewritten AC contains --reporter=json ==="
for AC in PH01-US01-AC03 PH01-US01-AC04 PH01-US01-AC05; do
  CMD=$(node -e "
    const p=JSON.parse(require('fs').readFileSync('$JSON','utf8'));
    const s=p.stories.find(s=>s.id==='PH01-US01');
    const ac=s.acceptanceCriteria.find(a=>a.id==='$AC');
    process.stdout.write(ac.command);
  ")
  if echo "$CMD" | grep -q -- '--reporter=json'; then
    echo "PASS: $AC contains --reporter=json"
  else
    echo "FAIL: $AC missing --reporter=json"
    FAIL=1
  fi
done

echo ""
echo "=== AC3: git diff shows exactly 3 added, 3 removed ==="
ADDED=$(git diff --numstat -- "$JSON" | awk '{print $1}')
REMOVED=$(git diff --numstat -- "$JSON" | awk '{print $2}')
if [[ "$ADDED" == "3" && "$REMOVED" == "3" ]]; then
  echo "PASS: 3 added, 3 removed"
else
  echo "FAIL: expected 3/3, got $ADDED/$REMOVED"
  FAIL=1
fi

echo ""
echo "=== AC4: diff confined to generate phase JSON only ==="
CHANGED=$(git diff --name-only)
if [[ "$CHANGED" == "$JSON" ]]; then
  echo "PASS: only $JSON changed"
else
  echo "FAIL: unexpected files changed: $CHANGED"
  FAIL=1
fi

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
  exit 1
fi
