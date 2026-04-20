#!/usr/bin/env bash
# v0.33.0 PR B acceptance wrapper.
# Runs AC-B1 through AC-B12 in order and exits 0 iff all pass.
# Plan: .ai-workspace/plans/2026-04-20-v0-33-0-pr-b-anthropic-plan-polish.md
set -euo pipefail

cd "$(dirname "$0")/.."

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }

section() { cyan "=== $1 ==="; }
pass()    { green "  PASS: $1"; }
fail()    { red   "  FAIL: $1"; exit 1; }

section "AC-B1 (callClaude still exported as async function)"
grep -E '^export async function callClaude\(' server/lib/anthropic.ts >/dev/null \
  || fail "callClaude is not exported as an async function"
pass "callClaude exported as async function"

section "AC-B2 (tsc clean + cache field plumbing)"
npx tsc --noEmit -p tsconfig.json
cache_hits="$(grep -c 'cacheCreationInputTokens\|cacheReadInputTokens' server/lib/anthropic.ts || true)"
[ "${cache_hits:-0}" -ge 3 ] \
  || fail "expected >=3 occurrences of cache field names in anthropic.ts, got ${cache_hits}"
pass "tsc --noEmit green; ${cache_hits} cache-field occurrences"

section "AC-B3 (stop_reason bare string comparison is gone)"
bad_hits="$(grep -cE "stop_reason.*=== ['\"]max_tokens['\"]" server/lib/anthropic.ts || true)"
[ "${bad_hits:-0}" = "0" ] \
  || fail "stop_reason === 'max_tokens' still present (${bad_hits} matches)"
pass "no bare stop_reason string comparisons"

section "AC-B4 (CORRECTOR_MAX_TOKENS env override test — named match)"
npx vitest run -t 'CORRECTOR_MAX_TOKENS'
pass "CORRECTOR_MAX_TOKENS tests pass"

section "AC-B5 (CORRECTOR_MAX_TOKENS exported)"
export_hits="$(grep -c '^export const CORRECTOR_MAX_TOKENS' server/tools/plan.ts || true)"
[ "${export_hits:-0}" = "1" ] \
  || fail "expected exactly 1 'export const CORRECTOR_MAX_TOKENS' match, got ${export_hits}"
pass "CORRECTOR_MAX_TOKENS export present"

section "AC-B6 (afterEach tripwire asserts mockCreate not called)"
node -e "const s=require('fs').readFileSync('server/lib/anthropic.test.ts','utf8'); const blocks=s.match(/afterEach\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*\)/g)||[]; process.exit(blocks.some(b=>/mockCreate[\s\S]*not[\s\S]*toHaveBeenCalled/.test(b))?0:1)" \
  || fail "no afterEach block asserts mockCreate was never called"
pass "afterEach tripwire present"

section "AC-B7 (err.message.toContain assertions removed)"
toContain_hits="$(grep -cE 'err\.message[^)]*\)\.toContain' server/lib/anthropic.test.ts || true)"
[ "${toContain_hits:-0}" = "0" ] \
  || fail "err.message().toContain(...) assertions still present (${toContain_hits} matches)"
pass "no err.message toContain assertions"

section "AC-B8 (JSDoc 'Run a corrector agent' consolidated or deleted)"
node -e "const s=require('fs').readFileSync('server/tools/plan.ts','utf8'); const block=s.match(/\/\*\*[\s\S]*?Run a corrector agent[\s\S]*?\*\//); if(!block) process.exit(0); const idx=s.indexOf(block[0]); const after=s.slice(idx+block[0].length, idx+block[0].length+100); process.exit(/^\s*(export\s+)?(async\s+)?(function|const)/.test(after)?0:1)" \
  || fail "'Run a corrector agent' JSDoc is not directly above a declaration"
pass "JSDoc consolidation clean"

section "AC-B9 (focused anthropic test suite)"
npx vitest run server/lib/anthropic.test.ts
pass "server/lib/anthropic.test.ts green"

section "AC-B10 (full test suite)"
npm test
pass "npm test green"

section "AC-B11 (build produces dist files)"
npm run build
[ -f dist/lib/anthropic.js ] || fail "dist/lib/anthropic.js missing"
[ -f dist/tools/plan.js ]    || fail "dist/tools/plan.js missing"
pass "dist/lib/anthropic.js and dist/tools/plan.js produced"

section "AC-B12 (diff allowlist — no drive-by edits)"
ALLOWED='^(server/lib/anthropic\.ts|server/lib/anthropic\.test\.ts|server/tools/plan\.ts|server/tools/plan\.test\.ts|\.ai-workspace/plans/2026-04-20-v0-33-0-pr-b-anthropic-plan-polish\.md|scripts/pr-b-acceptance\.sh|package\.json|CHANGELOG\.md)$'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! printf '%s\n' "$f" | grep -qE "$ALLOWED"; then
    fail "out-of-scope file in diff: $f"
  fi
done < <(git diff master...HEAD --name-only)
pass "diff is a subset of the allowlist"

green "ALL AC PASS"
