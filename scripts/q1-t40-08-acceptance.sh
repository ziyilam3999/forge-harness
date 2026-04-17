#!/usr/bin/env bash
set -uo pipefail

PASS=0; FAIL=0
report() {
  local label=$1; local rc=$2
  if [[ $rc -eq 0 ]]; then echo "PASS: $label"; ((PASS++)); else echo "FAIL: $label"; ((FAIL++)); fi
}

JSON=".ai-workspace/plans/forge-generate-phase-PH-01.json"

# 1. Valid JSON
node -e "JSON.parse(require('fs').readFileSync('$JSON','utf8'))" 2>/dev/null; report "JSON is valid" $?

# 2. AC03 contains --reporter=json
node -e "const j=JSON.parse(require('fs').readFileSync('$JSON','utf8')); const s=j.stories.find(s=>s.id==='PH01-US03'); const ac=s.acceptanceCriteria.find(a=>a.id==='PH01-US03-AC03'); process.exit(ac.command.includes('--reporter=json') ? 0 : 1)"; report "AC03 contains --reporter=json" $?

# 3. AC04 contains --reporter=json
node -e "const j=JSON.parse(require('fs').readFileSync('$JSON','utf8')); const s=j.stories.find(s=>s.id==='PH01-US03'); const ac=s.acceptanceCriteria.find(a=>a.id==='PH01-US03-AC04'); process.exit(ac.command.includes('--reporter=json') ? 0 : 1)"; report "AC04 contains --reporter=json" $?

# 4. git diff shows exactly 2 insertions and 2 deletions
STATS=$(git diff --numstat origin/master...HEAD -- "$JSON")
ADDS=$(echo "$STATS" | awk '{print $1}')
DELS=$(echo "$STATS" | awk '{print $2}')
[[ "$ADDS" == "2" && "$DELS" == "2" ]]; report "git diff shows exactly 2+/2-" $?

# 5. diff confined to generate phase JSON only
FILES=$(git diff --name-only origin/master...HEAD)
[[ "$FILES" == "$JSON" ]]; report "diff confined to generate phase JSON only" $?

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
