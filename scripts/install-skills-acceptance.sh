#!/usr/bin/env bash
# Acceptance wrapper for the #907 /prd-skill bundling + installer.
# Plan: .ai-workspace/plans/2026-06-14-907-bundle-prd-skill.md
#
# Runs the REAL install (scripts/install-skills.cjs) into a THROWAWAY HOME so the
# reviewer's real ~/.claude/skills is never touched, then asserts the outcome.
# This is the Rule-18 prove-primary smoke: a real install + real assertions, not
# a fixture parse.
#
# Exit 0 iff every AC passes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# ---------- Host-pollution snapshot ----------
# Capture the reviewer's real ~/.claude/skills/prd state BEFORE anything runs so
# we can prove the scratch-HOME isolation didn't leak into the real home.
HOST_PRD_DIR="$HOME/.claude/skills/prd"
if [ -e "$HOST_PRD_DIR" ]; then HOST_PRD_BEFORE="present"; else HOST_PRD_BEFORE="absent"; fi

SCRATCH="$(mktemp -d -t forge-install-skills-XXXXXX)"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

FAIL=0
PASS_COUNT=0
ok() { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  ✗ $1"; FAIL=1; }
ac() { echo; echo "=== $1 ==="; }

DEST="$SCRATCH/.claude/skills/prd"

# ---------- AC-2 — installer lands the skill ----------
ac "AC-2 — install exits 0 + SKILL.md lands"
set +e
HOME="$SCRATCH" node "$REPO_ROOT/scripts/install-skills.cjs" "$REPO_ROOT" \
  >"$SCRATCH/run1.out" 2>"$SCRATCH/run1.err"
RUN1_EXIT=$?
set -e
if [ "$RUN1_EXIT" -eq 0 ]; then ok "first install exited 0"; else fail "first install exit=$RUN1_EXIT"; sed 's/^/    /' "$SCRATCH/run1.err"; fi
[ -f "$DEST/SKILL.md" ] && ok "SKILL.md landed at $DEST" || fail "SKILL.md missing at $DEST"

# ---------- AC-3 — references installed (all 5) ----------
ac "AC-3 — references dir + 5 reference files"
[ -d "$DEST/references" ] && ok "references/ exists" || fail "references/ missing"
REF_COUNT=$(ls "$DEST/references/"*.md 2>/dev/null | wc -l | tr -d ' ')
[ "$REF_COUNT" -ge 5 ] && ok "found $REF_COUNT reference .md files (>=5)" || fail "expected >=5 reference files, found $REF_COUNT"
for f in product-diagnostic scope-modes document-template premise-challenge quality-checklist; do
  [ -f "$DEST/references/$f.md" ] && ok "references/$f.md present" || fail "references/$f.md missing"
done

# ---------- AC-4 — frontmatter well-formed ----------
ac "AC-4 — SKILL.md frontmatter well-formed"
if [ -f "$DEST/SKILL.md" ]; then
  FIRST_LINE=$(head -1 "$DEST/SKILL.md")
  [ "$FIRST_LINE" = "---" ] && ok "first line is '---'" || fail "first line is '$FIRST_LINE' (expected '---')"
  grep -Eq '^name: prd$' "$DEST/SKILL.md" && ok "has 'name: prd'" || fail "missing 'name: prd' line"
  # description: opens a block; assert a non-empty description follows it.
  DESC_OK=$(node -e '
    const fs=require("fs");
    const t=fs.readFileSync(process.argv[1],"utf-8");
    const fm=t.split(/^---\s*$/m)[1]||"";
    const m=fm.match(/description:\s*(\|[\s\S]*?)?\n([\s\S]*?)(?:\n\w+:|$)/);
    // Simpler: check there is a description: key and at least one non-blank line after it within the frontmatter.
    const lines=fm.split(/\r?\n/);
    const i=lines.findIndex(l=>/^description:/.test(l));
    if(i<0){console.log("no-key");process.exit(0);}
    const inline=lines[i].replace(/^description:\s*\|?\s*/,"").trim();
    let nonEmpty = inline.length>0;
    for(let j=i+1;j<lines.length && /^\s/.test(lines[j]);j++){ if(lines[j].trim().length>0) nonEmpty=true; }
    console.log(nonEmpty?"ok":"empty");
  ' "$DEST/SKILL.md")
  [ "$DESC_OK" = "ok" ] && ok "description: is non-empty" || fail "description check: $DESC_OK"
fi

# ---------- AC-5 — idempotent + non-destructive (backup on 2nd run) ----------
ac "AC-5 — second run is idempotent + backs up"
set +e
HOME="$SCRATCH" node "$REPO_ROOT/scripts/install-skills.cjs" "$REPO_ROOT" \
  >"$SCRATCH/run2.out" 2>"$SCRATCH/run2.err"
RUN2_EXIT=$?
set -e
[ "$RUN2_EXIT" -eq 0 ] && ok "second install exited 0" || { fail "second install exit=$RUN2_EXIT"; sed 's/^/    /' "$SCRATCH/run2.err"; }
BACKUP_COUNT=$(ls -d "$SCRATCH/.claude/skills/_prd-backup-"* 2>/dev/null | wc -l | tr -d ' ')
[ "$BACKUP_COUNT" -ge 1 ] && ok "backup dir _prd-backup-* created ($BACKUP_COUNT)" || fail "no _prd-backup-* dir after 2nd run"
[ -f "$DEST/SKILL.md" ] && head -1 "$DEST/SKILL.md" | grep -q '^---$' && ok "re-landed SKILL.md still valid" || fail "SKILL.md invalid/missing after 2nd run"
# Non-destructive: the backup must itself carry a valid SKILL.md (nothing was rm'd).
BK=$(ls -d "$SCRATCH/.claude/skills/_prd-backup-"* 2>/dev/null | head -1)
[ -n "$BK" ] && [ -f "$BK/SKILL.md" ] && ok "backup preserved a valid SKILL.md (non-destructive)" || fail "backup did not preserve SKILL.md"

# ---------- AC-6 — rebrand complete (zero hive-mind in installed skill) ----------
ac "AC-6 — zero hive-mind remnants in installed skill"
if grep -rEi 'hive[- ]?mind' "$DEST" >/dev/null 2>&1; then
  fail "found hive-mind remnant(s) in installed skill"
  grep -rEi 'hive[- ]?mind' "$DEST" | sed 's/^/    /'
else
  ok "no hive-mind string in installed skill"
fi

# ---------- AC-7 — no external-file dependency ----------
ac "AC-7 — no ../.hive-mind-persist dependency"
if grep -rn '\.\./\.hive-mind-persist' "$DEST" >/dev/null 2>&1; then
  fail "found ../.hive-mind-persist reference in installed skill"
else
  ok "no ../.hive-mind-persist reference"
fi

# ---------- AC-8 — no committed home-paths ----------
# Build the needle dynamically so this script's own source never contains the
# literal home-path substring (otherwise the scan would false-positive on its own
# grep pattern). Asserts no absolute macOS home-path leaked into committed files.
ac "AC-8 — no absolute home-path leak in committed files"
HOME_NEEDLE="/$(printf 'Users')/"
SCAN_TARGETS=("$REPO_ROOT/skills" "$REPO_ROOT/scripts/install-skills.cjs" "$REPO_ROOT/scripts/install-skills-acceptance.sh" "$REPO_ROOT/setup.sh")
if grep -rn "$HOME_NEEDLE" "${SCAN_TARGETS[@]}" >/dev/null 2>&1; then
  fail "found absolute home-path leak in committed files"
  grep -rn "$HOME_NEEDLE" "${SCAN_TARGETS[@]}" | sed 's/^/    /'
else
  ok "no absolute home-path leak in committed files"
fi

# ---------- AC-host — real ~/.claude/skills/prd untouched ----------
ac "AC-host — real home untouched (isolation held)"
if [ -e "$HOST_PRD_DIR" ]; then HOST_PRD_AFTER="present"; else HOST_PRD_AFTER="absent"; fi
[ "$HOST_PRD_BEFORE" = "$HOST_PRD_AFTER" ] && ok "real ~/.claude/skills/prd state unchanged ($HOST_PRD_BEFORE)" || fail "real home mutated: before=$HOST_PRD_BEFORE after=$HOST_PRD_AFTER"

# ---------- Summary ----------
echo
echo "=== Summary ==="
echo "  Passed: $PASS_COUNT checks"
if [ "$FAIL" -ne 0 ]; then
  echo "  FAIL — one or more AC failed."
  exit 1
fi
echo "  PASS — all AC green."
