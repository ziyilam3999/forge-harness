#!/usr/bin/env bash
# Acceptance wrapper for q1-t40-s05: rewrite 8 F55-passed ACs in PH01-US-04
set -euo pipefail
MSYS_NO_PATHCONV=1
export MSYS_NO_PATHCONV

STORY_ID="PH01-US-04"
F55_COUNT=8
PASS=0
FAIL=0

step() { printf "\n=== AC-%s: %s ===\n" "$1" "$2"; }
pass() { PASS=$((PASS+1)); echo "  PASS"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

# AC-1: npm run lint exits clean
step 1 "npm run lint exits clean"
if npm run lint --silent >/dev/null 2>&1; then pass; else fail "npm run lint failed"; fi

# AC-2: ac-lint smoke test passes
step 2 "ac-lint smoke test passes"
if npx vitest run server/smoke/ac-lint.test.ts >/dev/null 2>&1; then pass; else fail "ac-lint smoke test failed"; fi

# AC-3: each rewritten command is executable (all 8 use valid syntax)
step 3 "all $F55_COUNT rewritten commands parse as valid JSON+bash"
CMD_PASS=0
# Extract the 8 rewritten commands from the phase JSON and check each is syntactically valid bash
COMMANDS=$(node -e "
const fs = require('fs');
const plan = JSON.parse(fs.readFileSync('.ai-workspace/plans/forge-coordinate-phase-PH-01.json','utf8'));
const story = plan.stories.find(s => s.id === '$STORY_ID');
const acs = story.acceptanceCriteria.filter(ac => ac.id !== 'PH01-US-04-AC01');
acs.forEach(ac => console.log(ac.command));
")
COUNT=0
while IFS= read -r cmd; do
  COUNT=$((COUNT+1))
  if bash -n <(echo "$cmd") 2>/dev/null; then
    echo "  Command $COUNT: syntax OK"
  else
    echo "  Command $COUNT: syntax FAIL"
    FAIL=$((FAIL+1))
  fi
done <<< "$COMMANDS"
if [ "$COUNT" -eq "$F55_COUNT" ]; then
  pass
else
  fail "expected $F55_COUNT commands, got $COUNT"
fi

# AC-4: git diff shows exactly 16 changed lines (8 removed + 8 added)
step 4 "git diff shows exactly 16 changed content lines"
REMOVED=$(git diff master -- .ai-workspace/plans/forge-coordinate-phase-PH-01.json | grep -c '^-.*"command"' || true)
ADDED=$(git diff master -- .ai-workspace/plans/forge-coordinate-phase-PH-01.json | grep -c '^+.*"command"' || true)
TOTAL=$((REMOVED + ADDED))
if [ "$TOTAL" -eq 16 ]; then
  pass
  echo "  ($REMOVED removed + $ADDED added)"
else
  fail "expected 16 changed lines, got $TOTAL ($REMOVED removed + $ADDED added)"
fi

# AC-5: only 2 files changed vs master
step 5 "git diff --name-only shows exactly 2 files"
FILE_COUNT=$(git diff master --name-only | wc -l | tr -d ' ')
if [ "$FILE_COUNT" -eq 2 ]; then
  pass
  git diff master --name-only | sed 's/^/  /'
else
  fail "expected 2 files, got $FILE_COUNT"
  git diff master --name-only | sed 's/^/  /'
fi

# Summary
printf "\n=== SUMMARY ===\n"
printf "Story: %s | F55 rewrites: %d\n" "$STORY_ID" "$F55_COUNT"
printf "Passed: %d | Failed: %d\n" "$PASS" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "SOME CHECKS FAILED"
  exit 1
fi
