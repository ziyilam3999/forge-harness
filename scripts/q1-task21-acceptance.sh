#!/usr/bin/env bash
# Task #21 — PH01-US-06 AC rewrite acceptance wrapper.
# Runs AC-1..AC-9 from .ai-workspace/plans/2026-04-15-q1-ph01-us-06-ac-rewrite.md
# in order. Exits 0 iff all pass.
#
# MSYS_NO_PATHCONV=1 prevents Windows MSYS bash from silently mangling
# /<path> arguments passed to git — task #22 learning #2.
export MSYS_NO_PATHCONV=1

set -u
FAIL=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHASE_JSON=".ai-workspace/plans/forge-coordinate-phase-PH-01.json"
BASELINE=".ai-workspace/audits/2026-04-15-task21-baseline.md"
IDS=(PH01-US-06-AC01b PH01-US-06-AC02b PH01-US-06-AC03b PH01-US-06-AC04 PH01-US-06-AC05)

# Helper: extract an AC command field from the phase JSON on the current worktree.
get_cmd () {
  node -e "const j=JSON.parse(require('fs').readFileSync('$PHASE_JSON','utf8'));const s=j.stories.find(u=>u.id==='PH01-US-06');const a=s.acceptanceCriteria.find(x=>x.id===process.argv[1]);if(!a){console.error('MISSING',process.argv[1]);process.exit(2)}process.stdout.write(a.command)" "$1"
}

# Helper: extract the same command field from origin/master.
get_cmd_master () {
  git show "origin/master:$PHASE_JSON" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const s=j.stories.find(u=>u.id==='PH01-US-06');const a=s.acceptanceCriteria.find(x=>x.id===process.argv[1]);if(!a){console.error('MISSING',process.argv[1]);process.exit(2)}process.stdout.write(a.command)})" "$1"
}

header () { printf '\n=== %s ===\n' "$1"; }
pass   () { printf 'PASS %s\n' "$1"; }
fail   () { printf 'FAIL %s — %s\n' "$1" "$2"; FAIL=1; }

# ---------------- AC-1 ----------------
# Each of the 5 ACs differs from origin/master.
header "AC-1 — 5 hazardous ACs rewritten"
for id in "${IDS[@]}"; do
  cur=$(get_cmd "$id")
  old=$(get_cmd_master "$id" 2>/dev/null || true)
  if [ -z "$old" ]; then
    fail "AC-1" "could not read $id from origin/master (is origin fetched?)"
  elif [ "$cur" = "$old" ]; then
    fail "AC-1" "$id UNCHANGED vs origin/master"
  else
    pass "AC-1/$id"
  fi
done

# ---------------- AC-2 ----------------
# Zero F-55 hazards in the 5 rewritten commands.
header "AC-2 — zero F-55 hazards"
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(".ai-workspace/plans/forge-coordinate-phase-PH-01.json", "utf8"));
const s = j.stories.find(u => u.id === "PH01-US-06");
const ids = ["PH01-US-06-AC01b","PH01-US-06-AC02b","PH01-US-06-AC03b","PH01-US-06-AC04","PH01-US-06-AC05"];
let bad = 0;
for (const id of ids) {
  const c = s.acceptanceCriteria.find(x => x.id === id).command;
  if (c.includes("2>/dev/null |") || c.includes("2>&1 | grep") || c.includes("| grep -q \u0027passed\u0027")) {
    console.log("HAZARD", id, c);
    bad++;
  }
}
process.exit(bad === 0 ? 0 : 1)
'
if [ $? -eq 0 ]; then pass "AC-2"; else fail "AC-2" "F-55 hazard remains"; fi

# ---------------- AC-3 ----------------
# Zero F-36 source-tree-grep + verification-theatre in AC04.
header "AC-3 — zero F-36 hazards in AC04"
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(".ai-workspace/plans/forge-coordinate-phase-PH-01.json", "utf8"));
const s = j.stories.find(u => u.id === "PH01-US-06");
const c = s.acceptanceCriteria.find(x => x.id === "PH01-US-06-AC04").command;
if (c.includes("grep -n \u0027callClaude") || c.includes("grep -rn callClaude") || c.includes("echo EMPTY-OK | grep -q EMPTY-OK")) {
  console.log("HAZARD", c);
  process.exit(1);
}
'
if [ $? -eq 0 ]; then pass "AC-3"; else fail "AC-3" "F-36 hazard remains"; fi

# ---------------- AC-4 ----------------
# Baseline file exists, every id baselined, and rewritten commands match baseline exit codes.
header "AC-4 — semantics-preserving vs baseline"
if [ ! -f "$BASELINE" ]; then
  fail "AC-4" "missing baseline file $BASELINE"
else
  for id in "${IDS[@]}"; do
    if ! grep -q "^${id}: " "$BASELINE"; then
      fail "AC-4" "MISSING baseline for $id"
    else
      expected=$(grep "^${id}: " "$BASELINE" | head -1 | sed -E 's/^[^:]+: *([0-9]+).*/\1/')
      cmd=$(get_cmd "$id")
      bash -c "$cmd" > /dev/null 2>&1
      got=$?
      if [ "$got" = "$expected" ]; then
        pass "AC-4/$id (baseline=$expected, rewrite=$got)"
      else
        # Allow latent-prior-failure escape hatch.
        if grep -q "^${id}: .*latent-prior-failure" "$BASELINE"; then
          pass "AC-4/$id (latent-prior-failure flagged)"
        else
          fail "AC-4" "$id baseline=$expected rewrite=$got (no latent flag)"
        fi
      fi
    fi
  done
fi

# ---------------- AC-5 ----------------
header "AC-5 — ac-lint clean"
npx vitest run server/validation/ac-lint.test.ts > /tmp/q1t21-aclint.log 2>&1
if [ $? -eq 0 ]; then pass "AC-5"; else fail "AC-5" "see /tmp/q1t21-aclint.log"; fi

# ---------------- AC-6 ----------------
header "AC-6 — npm run build"
npm run build > /tmp/q1t21-build.log 2>&1
if [ $? -eq 0 ]; then pass "AC-6"; else fail "AC-6" "see /tmp/q1t21-build.log"; fi

# ---------------- AC-7 ----------------
header "AC-7 — npm run lint"
npm run lint > /tmp/q1t21-lint.log 2>&1
if [ $? -eq 0 ]; then pass "AC-7"; else fail "AC-7" "see /tmp/q1t21-lint.log"; fi

# ---------------- AC-8 ----------------
header "AC-8 — npm test"
npm test > /tmp/q1t21-test.log 2>&1
if [ $? -eq 0 ]; then pass "AC-8"; else fail "AC-8" "see /tmp/q1t21-test.log"; fi

# ---------------- AC-9 ----------------
# No drive-by edits: diff vs origin/master confined to allowlist.
header "AC-9 — no drive-by edits"
ALLOW_RE='^(\.ai-workspace/plans/forge-coordinate-phase-PH-01\.json|\.ai-workspace/plans/2026-04-15-q1-ph01-us-06-ac-rewrite\.md|\.ai-workspace/audits/2026-04-15-task21-baseline\.md|scripts/q1-task21-acceptance\.sh)$'
unexpected=$(git diff origin/master...HEAD --name-only | grep -vE "$ALLOW_RE" || true)
if [ -z "$unexpected" ]; then
  pass "AC-9"
else
  fail "AC-9" "unexpected files: $unexpected"
fi

# ---------------- Summary ----------------
header "SUMMARY"
if [ "$FAIL" -eq 0 ]; then
  echo "ALL GREEN"
  exit 0
else
  echo "FAILURES PRESENT"
  exit 1
fi
