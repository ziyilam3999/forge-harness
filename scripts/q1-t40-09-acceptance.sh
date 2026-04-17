#!/usr/bin/env bash
# Acceptance wrapper for task #40 slice 9 (gen US04, 5 F55 ACs)
set -euo pipefail
export MSYS_NO_PATHCONV=1
PASS=0; FAIL=0
check() { if eval "$2"; then echo "  PASS: $1"; ((PASS++)); else echo "  FAIL: $1"; ((FAIL++)); fi; }

echo "=== AC-1: eslint clean ==="
check "eslint" "npx eslint .ai-workspace/plans/forge-generate-phase-PH-01.json >/dev/null 2>&1"

echo "=== AC-2: all 5 ACs contain --reporter=json ==="
COUNT=$(node -e "const j=JSON.parse(require('fs').readFileSync('.ai-workspace/plans/forge-generate-phase-PH-01.json','utf8')); const us=j.stories.find(s=>s.id==='PH01-US04'); const n=us.acceptanceCriteria.filter(ac=>ac.command.includes('--reporter=json')).length; console.log(n)")
check "reporter-json-count" "[ '$COUNT' = '5' ]"

echo "=== AC-3: zero grep -q in US04 vitest commands ==="
GREPQ=$(node -e "const j=JSON.parse(require('fs').readFileSync('.ai-workspace/plans/forge-generate-phase-PH-01.json','utf8')); const us=j.stories.find(s=>s.id==='PH01-US04'); const n=us.acceptanceCriteria.filter(ac=>/vitest/.test(ac.command) && /grep -q/.test(ac.command)).length; console.log(n)")
check "zero-grep-q" "[ '$GREPQ' = '0' ]"

echo "=== AC-4: diff is 5+/5- ==="
ADDED=$(git diff --numstat origin/master...HEAD -- .ai-workspace/plans/forge-generate-phase-PH-01.json | awk '{print $1}')
REMOVED=$(git diff --numstat origin/master...HEAD -- .ai-workspace/plans/forge-generate-phase-PH-01.json | awk '{print $2}')
check "diff-lines" "[ '$ADDED' = '5' ] && [ '$REMOVED' = '5' ]"

echo "=== AC-5: diff confined to generate phase JSON ==="
FILES=$(git diff --name-only origin/master...HEAD)
check "diff-scope" "[ '$FILES' = '.ai-workspace/plans/forge-generate-phase-PH-01.json' ]"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
