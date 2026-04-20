#!/usr/bin/env bash
# v0.33.0 PR C acceptance wrapper.
# Runs AC-C1 through AC-C9 in order and exits 0 iff all pass.
# Plan: .ai-workspace/plans/2026-04-20-v0-33-0-pr-c-changelog-dashboard-polish.md
set -euo pipefail

# Suppress MSYS path conversion globally for rev:path git invocations on
# Windows Git Bash — the plan's AC-C8 requires this, and setting it once
# here keeps individual commands free of the env-var prefix.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }

section() { cyan "=== $1 ==="; }
pass()    { green "  PASS: $1"; }
fail()    { red   "  FAIL: $1"; exit 1; }

section "AC-C1 (CHANGELOG v0.32.8 section: no line > 400 chars)"
node -e "
const s = require('fs').readFileSync('CHANGELOG.md', 'utf8');
const m = s.match(/## \[0\.32\.8\][\s\S]*?(?=\n## \[)/);
if (!m) { console.error('v0.32.8 section not found'); process.exit(2); }
const lines = m[0].split('\n');
const maxLen = Math.max(...lines.map(l => l.length));
if (maxLen > 400) { console.error('max line length', maxLen, '> 400'); process.exit(1); }
console.log('max line length:', maxLen);
" || fail "CHANGELOG v0.32.8 has a line > 400 chars"
pass "CHANGELOG v0.32.8 all lines <= 400 chars"

section "AC-C2 (CHANGELOG v0.32.8 section preserves load-bearing terms)"
node -e "
const s = require('fs').readFileSync('CHANGELOG.md', 'utf8');
const m = s.match(/## \[0\.32\.8\][\s\S]*?(?=\n## \[)/);
if (!m) { console.error('v0.32.8 section not found'); process.exit(2); }
const sec = m[0];
const terms = ['messages.stream', 'finalMessage', 'DEFAULT_MAX_TOKENS', 'LLMOutputTruncatedError', 'stop_reason', 'closes #325'];
const missing = terms.filter(t => !sec.includes(t));
if (missing.length) { console.error('missing terms:', missing); process.exit(1); }
" || fail "CHANGELOG v0.32.8 is missing load-bearing terms"
pass "all 6 load-bearing terms preserved"

section "AC-C3 (TOOL_RUNNING declaration in dashboard-renderer.ts)"
c3_count="$(grep -cE '(var|let|const)[[:space:]]+TOOL_RUNNING[[:space:]]*=' server/lib/dashboard-renderer.ts || true)"
[ "${c3_count:-0}" = "1" ] \
  || fail "expected exactly 1 TOOL_RUNNING declaration, got ${c3_count:-0}"
pass "TOOL_RUNNING declared exactly once"

section "AC-C4 (idle-banner copy 'Idle ... no tool running')"
c4_count="$(grep -cE 'Idle[^\"]*no tool running' server/lib/dashboard-renderer.ts || true)"
[ "${c4_count:-0}" -ge 1 ] \
  || fail "expected >= 1 idle-banner match, got ${c4_count:-0}"
pass "idle-banner copy present (${c4_count} match)"

section "AC-C5 ('may be hung' red-alarm copy preserved)"
c5_count="$(grep -cE 'may be hung' server/lib/dashboard-renderer.ts || true)"
[ "${c5_count:-0}" = "1" ] \
  || fail "expected exactly 1 'may be hung' match, got ${c5_count:-0}"
pass "'may be hung' copy preserved"

section "AC-C6 (idle-banner unit test exists)"
node -e "
const s = require('fs').readFileSync('server/lib/dashboard-renderer.test.ts', 'utf8');
const has = /idle[\s\S]*no tool running|TOOL_RUNNING[\s\S]*false/i.test(s);
if (!has) { console.error('no idle-banner test found'); process.exit(1); }
" || fail "no idle-banner test in dashboard-renderer.test.ts"
pass "idle-banner test is present"

section "AC-C7 (vitest server/ suite: 0 failures)"
mkdir -p tmp
npx vitest run --reporter=json --outputFile=tmp/pr-c-vitest.json server/ 2>&1 | tail -5
node -e "
const r = JSON.parse(require('fs').readFileSync('tmp/pr-c-vitest.json', 'utf8'));
console.log('failed:', r.numFailedTests, 'skipped:', r.numPendingTests, 'passed:', r.numPassedTests);
process.exit(r.numFailedTests === 0 ? 0 : 1);
" || fail "vitest server/ suite has failures"
pass "vitest server/ suite green"

section "AC-C8 (test count delta: dashboard-renderer.test.ts grows by >= 1)"
git fetch origin master --quiet 2>/dev/null || true
before="$(git show origin/master:server/lib/dashboard-renderer.test.ts | grep -cE '^[[:space:]]*it\(' || true)"
after="$(grep -cE '^[[:space:]]*it\(' server/lib/dashboard-renderer.test.ts || true)"
[ "${after:-0}" -gt "${before:-0}" ] \
  || fail "test count did not grow (before=${before:-0}, after=${after:-0})"
pass "test count grew ${before} -> ${after}"

section "AC-C9 (diff allowlist: no drive-by edits)"
git fetch origin master --quiet 2>/dev/null || true
node -e "
const { execSync } = require('child_process');
const out = execSync('git diff --name-only origin/master...HEAD', { encoding: 'utf8' });
const allow = new Set([
  'CHANGELOG.md',
  'server/lib/dashboard-renderer.ts',
  'server/lib/dashboard-renderer.test.ts',
  '.ai-workspace/plans/2026-04-20-v0-33-0-pr-c-changelog-dashboard-polish.md',
  'scripts/pr-c-acceptance.sh',
  'package.json',
]);
const files = out.trim().split('\n').filter(Boolean);
const bad = files.filter(f => !allow.has(f));
if (bad.length) { console.error('out-of-scope files:', bad); process.exit(1); }
console.log('allowlist OK:', files.length, 'files');
" || fail "diff contains out-of-scope files"
pass "diff limited to allowlist"

green "ALL PR C ACCEPTANCE CHECKS PASSED"
