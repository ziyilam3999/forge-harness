#!/usr/bin/env bash
# v0.33.0 PR D acceptance wrapper.
# Runs AC-D1 through AC-D8 in order and exits 0 iff all pass.
# Plan: .ai-workspace/plans/2026-04-20-v0-33-0-pr-d-evaluate-max-tokens-audit.md
# Issue: https://github.com/ziyilam3999/forge-harness/issues/324
set -euo pipefail

# Suppress MSYS path conversion globally for defensive parity with the other
# wrappers — no rev:path git syntax is used here, but a consistent top-of-file
# export means future edits that add one stay safe on Windows Git Bash.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }

section() { cyan "=== $1 ==="; }
pass()    { green "  PASS: $1"; }
fail()    { red   "  FAIL: $1"; exit 1; }

mkdir -p tmp

section "AC-D1 (audit test file runs green)"
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/pr-d-ac-d1.json server/tools/evaluate-max-tokens-audit.test.ts > /dev/null 2>&1
node -e "
const r = JSON.parse(require('fs').readFileSync('tmp/pr-d-ac-d1.json', 'utf8'));
if (r.numPassedTests >= 1 && r.numFailedTests === 0) {
  console.log('audit test:', r.numPassedTests, 'passed /', r.numFailedTests, 'failed');
  process.exit(0);
}
console.error('audit test:', r.numPassedTests, 'passed /', r.numFailedTests, 'failed');
process.exit(1);
" || fail "audit test did not run green"
pass "audit test runs green"

section "AC-D2 (audit test mentions maxTokens >= 3 times)"
d2_count="$(grep -cE 'maxTokens' server/tools/evaluate-max-tokens-audit.test.ts || true)"
[ "${d2_count:-0}" -ge 3 ] \
  || fail "expected >= 3 maxTokens mentions in audit test, got ${d2_count:-0}"
pass "audit test mentions maxTokens ${d2_count} times"

section "AC-D3 (evaluate.ts has zero maxTokens overrides)"
d3_count="$(grep -cE 'maxTokens|max_tokens' server/tools/evaluate.ts || true)"
[ "${d3_count:-0}" = "0" ] \
  || fail "expected 0 maxTokens matches in evaluate.ts, got ${d3_count:-0}"
pass "evaluate.ts has zero maxTokens overrides"

section "AC-D4 (CHANGELOG v0.32.14 entry mentions #324, audit, evaluate.ts)"
node -e "
const s = require('fs').readFileSync('CHANGELOG.md', 'utf8');
const m = s.match(/## \[0\.32\.14\][\s\S]*?(?=\n## \[)/);
if (!m) { console.error('v0.32.14 section not found'); process.exit(1); }
const block = m[0];
if (!/#324/.test(block))        { console.error('missing #324');        process.exit(2); }
if (!/audit/i.test(block))      { console.error('missing audit');       process.exit(3); }
if (!/evaluate\.ts/.test(block)) { console.error('missing evaluate.ts'); process.exit(4); }
" || fail "CHANGELOG v0.32.14 entry is missing required terms"
pass "CHANGELOG v0.32.14 entry is well-formed"

section "AC-D5 (package.json version === 0.32.14)"
node -e "if (require('./package.json').version === '0.32.14') process.exit(0); else { console.error('version:', require('./package.json').version); process.exit(1); }" \
  || fail "package.json version is not 0.32.14"
pass "package.json version is 0.32.14"

section "AC-D6 (full test suite: 0 failures, >= 775 passing)"
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/pr-d-vitest.json > /dev/null 2>&1 || true
node -e "
const r = JSON.parse(require('fs').readFileSync('tmp/pr-d-vitest.json', 'utf8'));
console.log('tests:', r.numPassedTests, 'passed /', r.numFailedTests, 'failed /', r.numTotalTests, 'total');
if (r.numFailedTests === 0 && r.numPassedTests >= 775) process.exit(0);
process.exit(1);
" || fail "full test suite failed or passing count < 775"
pass "full test suite green"

section "AC-D8 (diff allowlist: no drive-by edits)"
git fetch origin master --quiet 2>/dev/null || true
# Prefer origin/master if available (mirrors PR C wrapper); fall back to
# local master when the remote ref can't be fetched (offline executor case).
BASE_REF="origin/master"
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="master"
fi
node -e "
const { execSync } = require('child_process');
const out = execSync('git diff --name-only ${BASE_REF}...HEAD', { encoding: 'utf8' });
const allow = new Set([
  'CHANGELOG.md',
  'package.json',
  'server/tools/evaluate-max-tokens-audit.test.ts',
  'scripts/pr-d-acceptance.sh',
  '.ai-workspace/plans/2026-04-20-v0-33-0-pr-d-evaluate-max-tokens-audit.md',
]);
const files = out.trim().split('\n').filter(Boolean);
const bad = files.filter(f => !allow.has(f));
if (bad.length) { console.error('out-of-scope files:', bad); process.exit(1); }
console.log('allowlist OK:', files.length, 'files');
" || fail "diff contains out-of-scope files"
pass "diff limited to allowlist"

green "ALL PR D ACCEPTANCE CHECKS PASSED"
