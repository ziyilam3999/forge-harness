#!/usr/bin/env bash
# Promotion PR — README rewrite (cost-discipline angle) acceptance wrapper.
#
# Runs every binary AC (AC-1..AC-11) from the plan in sequence and exits 0
# iff all pass; non-zero on any failure.
#
# Plan: .ai-workspace/plans/2026-04-25-promotion-pr-readme-rewrite.md
# AC-6 uses the flag-based awk slice (mid-flight planner amendment).
#
# Windows MSYS safety: prevents path mangling when git commands receive
# colon-separated refs like "origin/master..HEAD". Export once at the top.
export MSYS_NO_PATHCONV=1

set -u   # undefined-var is an error; deliberately NOT `-e` — we want
         # every AC to run and report aggregate status at the end.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

failures=0
pass()   { printf "  [PASS] %s\n" "$1"; }
fail()   { printf "  [FAIL] %s\n" "$1"; failures=$((failures + 1)); }
banner() { printf "\n=== %s ===\n" "$1"; }

# ── AC-1: PR diff allowlist ──────────────────────────────────────────────
banner "AC-1: PR diff name-only against origin/master is allowlist-only"
oos=$(git diff origin/master..HEAD --name-only \
        | grep -v -E '^(README\.md|CHANGELOG\.md|scripts/[a-z0-9-]+-acceptance\.sh|\.ai-workspace/plans/2026-04-25-(promotion-pr-readme-rewrite|ship-fix-[0-9]+)\.md)$' \
        | wc -l \
        | tr -d ' ')
printf "    out-of-allowlist count: %s\n" "$oos"
if [ "${oos:-0}" -eq 0 ]; then
  pass "AC-1: 0 paths outside allowlist"
else
  fail "AC-1: $oos path(s) outside allowlist"
  printf "    offenders:\n"
  git diff origin/master..HEAD --name-only \
    | grep -v -E '^(README\.md|CHANGELOG\.md|scripts/[a-z0-9-]+-acceptance\.sh|\.ai-workspace/plans/2026-04-25-(promotion-pr-readme-rewrite|ship-fix-[0-9]+)\.md)$' \
    | sed 's/^/      /'
fi

# ── AC-2: 8 primitive names in the Tools table ───────────────────────────
banner "AC-2: README Tools table lists all 8 primitives in code-fence rows"
n=$(grep -c -E '^\| `forge_(plan|evaluate|generate|coordinate|reconcile|lint_refresh|status|declare_story)`' README.md || true)
printf "    count: %s (expect 8)\n" "$n"
if [ "${n:-0}" -eq 8 ]; then
  pass "AC-2"
else
  fail "AC-2: got $n, expected 8"
fi

# ── AC-3: tagline phrase anchors within first 30 lines ───────────────────
banner "AC-3: lede tagline anchors ('harness coordinates' AND 'agent implements') in head -30"
a=$(head -30 README.md | grep -c -i "harness coordinates" || true)
b=$(head -30 README.md | grep -c -i "agent implements" || true)
printf "    'harness coordinates' = %s, 'agent implements' = %s (each expect 1)\n" "$a" "$b"
if [ "${a:-0}" -ge 1 ] && [ "${b:-0}" -ge 1 ]; then
  pass "AC-3"
else
  fail "AC-3: got a=$a b=$b (need both >= 1)"
fi

# ── AC-4: '## Why forge-harness?' heading present exactly once ───────────
banner "AC-4: '## Why forge-harness?' heading appears exactly once"
n=$(grep -c '^## Why forge-harness?$' README.md || true)
printf "    count: %s (expect 1)\n" "$n"
if [ "${n:-0}" -eq 1 ]; then
  pass "AC-4"
else
  fail "AC-4: got $n, expected 1"
fi

# ── AC-5: 'Why forge-harness?' appears BEFORE 'Quick Start' ──────────────
banner "AC-5: 'Why forge-harness?' precedes 'Quick Start'"
if awk '/^## Why forge-harness\?/{w=NR} /^## Quick Start/{q=NR} END{exit !(w>0 && q>0 && w<q)}' README.md; then
  pass "AC-5"
else
  fail "AC-5: ordering check failed"
fi

# ── AC-6: anchor-numbers count in 'Why?' section body (flag-based slice) ─
banner "AC-6: 'Why?' section body contains >= 3 anchor-number tokens (\$0.80, \$0.20, Max plan)"
# Flag-based awk slice — supersedes the original /X/,/Y/ range form which
# collapsed to one line when X and Y both matched the heading line.
n=$(awk '/^## Why forge-harness\?/{f=1;next} /^## /{f=0} f' README.md \
      | grep -oE '\$0\.80|\$0\.20|Max plan' \
      | wc -l \
      | tr -d ' ')
printf "    anchor-number tokens in body: %s (expect >= 3)\n" "$n"
if [ "${n:-0}" -ge 3 ]; then
  pass "AC-6"
else
  fail "AC-6: got $n, expected >= 3"
fi

# ── AC-7: Status section reads 'eight'/'8', not 'all four' ───────────────
banner "AC-7: Status section says 'eight primitives' (not 'all four primitives')"
a=$(grep -i 'eight primitives\|all 8 primitives\|all eight' README.md | wc -l | tr -d ' ')
b=$(grep -i 'all four primitives' README.md | wc -l | tr -d ' ')
printf "    'eight/8' matches: %s (expect >= 1); 'all four' matches: %s (expect 0)\n" "$a" "$b"
if [ "${a:-0}" -ge 1 ] && [ "${b:-0}" -eq 0 ]; then
  pass "AC-7"
else
  fail "AC-7: a=$a (need >=1), b=$b (need 0)"
fi

# ── AC-8: mermaid (if present) lists all 8 primitives ────────────────────
banner "AC-8: mermaid block (if present) names all 8 primitives"
mermaid_count=$(grep -c '^```mermaid$' README.md || true)
if [ "${mermaid_count:-0}" -ge 1 ]; then
  uniq=$(awk '/^```mermaid$/,/^```$/' README.md \
           | grep -oE 'forge_(plan|evaluate|generate|coordinate|reconcile|lint_refresh|status|declare_story)' \
           | sort -u | wc -l | tr -d ' ')
  printf "    mermaid present; unique primitive names = %s (expect 8)\n" "$uniq"
  if [ "${uniq:-0}" -eq 8 ]; then
    pass "AC-8"
  else
    fail "AC-8: mermaid lists $uniq unique primitives, expected 8"
  fi
else
  printf "    no mermaid block; AC-8 vacuously passes\n"
  pass "AC-8 (no mermaid present)"
fi

# ── AC-9: privacy — no employer-brand strings anywhere in PR diff ────────
# Per CLAUDE.md privacy hard-rule, regulated tokens may only appear in rule-spec
# files (the privacy card + per-project memory files). This script intentionally
# contains NO regulated literals — extraction is prefix-agnostic. Fail closed if
# the privacy card is missing or yields no extractable tokens.
banner "AC-9: privacy grep — no employer-brand tokens in PR diff"
PRIVACY_CARD="$HOME/.claude/agent-working-memory/tier-b/topics/privacy/no-employer-brand.md"
if [ ! -f "$PRIVACY_CARD" ]; then
  printf "    privacy card not found at %s — failing closed\n" "$PRIVACY_CARD" >&2
  fail "AC-9: privacy card missing (failing closed; rule-spec must be present)"
else
  # Generic extraction: capitalized backticked tokens from the rule-spec card.
  # No regulated prefix is named here.
  tokens=$(grep -oE '`[A-Z][^`]*`' "$PRIVACY_CARD" | tr -d '`' | sort -u)
  if [ -z "$tokens" ]; then
    printf "    privacy card has no extractable backticked tokens — failing closed\n" >&2
    fail "AC-9: privacy card has no extractable tokens (failing closed)"
  else
    ac9_failures=0
    diff_out=$(git diff origin/master..HEAD 2>/dev/null || true)
    while IFS= read -r token; do
      [ -z "$token" ] && continue
      if printf "%s\n" "$diff_out" | grep -i -F -e "$token" >/dev/null 2>&1; then
        printf "    [token: redacted] MATCH FOUND in PR diff\n"
        ac9_failures=$((ac9_failures + 1))
      else
        printf "    [token: redacted] no match\n"
      fi
    done <<<"$tokens"
    if [ "$ac9_failures" -eq 0 ]; then
      pass "AC-9: no employer-brand tokens in PR diff"
    else
      fail "AC-9: $ac9_failures token(s) matched in PR diff"
    fi
  fi
fi

# ── AC-10: relative .md links in README resolve ──────────────────────────
banner "AC-10: relative .md links referenced from README exist on disk"
if node -e 'const fs=require("fs"); const md=fs.readFileSync("README.md","utf8"); const links=[...md.matchAll(/\]\(([^)]+\.md)\)/g)].map(m=>m[1]).filter(l=>!l.startsWith("http")); const missing=links.filter(l=>!fs.existsSync(l)); if(missing.length){console.error("missing:",missing);process.exit(1)} console.log("relative md links checked:",links.length); process.exit(0)'; then
  pass "AC-10"
else
  fail "AC-10: at least one relative .md link missing"
fi

# ── AC-11: build + test sanity ───────────────────────────────────────────
banner "AC-11: npm run build && npm test"
SCRATCH_REL=".forge/scratch/promo-pr-acceptance-$$"
mkdir -p "$SCRATCH_REL"
trap 'rm -rf "$SCRATCH_REL"' EXIT

if npm run build >"$SCRATCH_REL/build.log" 2>&1; then
  pass "AC-11a: npm run build exited 0"
else
  fail "AC-11a: npm run build failed — see $SCRATCH_REL/build.log"
fi

if npm test >"$SCRATCH_REL/test.log" 2>&1; then
  pass "AC-11b: npm test exited 0"
else
  fail "AC-11b: npm test failed — see $SCRATCH_REL/test.log"
  tail -40 "$SCRATCH_REL/test.log" | sed 's/^/      /'
fi

# ── Summary ───────────────────────────────────────────────────────────────
banner "Summary"
if [ "$failures" -eq 0 ]; then
  printf "ALL ACCEPTANCE CHECKS PASSED\n"
  exit 0
else
  printf "%d CHECK(S) FAILED\n" "$failures"
  exit 1
fi
