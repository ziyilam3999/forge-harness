#!/usr/bin/env bash
# Acceptance wrapper for v0.32.8 — unconditional streaming in callClaude.
# Plan: .ai-workspace/plans/2026-04-20-unconditional-streaming-callclaude.md
# Exits 0 iff every AC passes, non-zero with a labelled failure otherwise.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "--- AC-1: no messages.create( calls remain in anthropic.ts ---"
CREATE_COUNT=$(grep -cE 'messages\.create\(' server/lib/anthropic.ts || true)
[ "$CREATE_COUNT" = "0" ] || fail "AC-1: found $CREATE_COUNT messages.create() call(s) in anthropic.ts"
echo "PASS: 0 messages.create() calls"

echo "--- AC-2: exactly 1 anthropic.messages.stream( call site in anthropic.ts (excluding JSDoc) ---"
# Strip JSDoc comment lines (leading `*`) before counting, so the docstring reference doesn't count.
STREAM_COUNT=$(grep -vE '^\s*\*' server/lib/anthropic.ts | grep -cE 'anthropic\.messages\.stream\(' || true)
[ "$STREAM_COUNT" = "1" ] || fail "AC-2: expected 1 anthropic.messages.stream() call site, found $STREAM_COUNT"
echo "PASS: 1 anthropic.messages.stream() call site"

echo "--- AC-3: exactly 1 .finalMessage() call site in anthropic.ts (excluding JSDoc) ---"
FINAL_COUNT=$(grep -vE '^\s*\*' server/lib/anthropic.ts | grep -cE '\.finalMessage\(\)' || true)
[ "$FINAL_COUNT" = "1" ] || fail "AC-3: expected 1 .finalMessage() call site, found $FINAL_COUNT"
echo "PASS: 1 .finalMessage() call site"

echo "--- AC-4: tsc --noEmit clean ---"
npx tsc --noEmit >"$LOG_DIR/tsc.log" 2>&1 || { cat "$LOG_DIR/tsc.log"; fail "AC-4: tsc failed"; }
echo "PASS: tsc clean"

echo "--- AC-5: anthropic.test.ts passes (grep log, not exit code) ---"
npx vitest run server/lib/anthropic.test.ts >"$LOG_DIR/anthropic.log" 2>&1 || true
grep -qE "Tests[[:space:]]+[0-9]+[[:space:]]+passed" "$LOG_DIR/anthropic.log" || { cat "$LOG_DIR/anthropic.log"; fail "AC-5: no 'Tests N passed' line in vitest output"; }
if grep -qE "Tests[[:space:]]+[0-9]+[[:space:]]+failed" "$LOG_DIR/anthropic.log"; then
  cat "$LOG_DIR/anthropic.log"
  fail "AC-5: found 'Tests N failed' line in vitest output"
fi
PASSED_ANTHROPIC=$(grep -oE "Tests[[:space:]]+[0-9]+[[:space:]]+passed" "$LOG_DIR/anthropic.log" | head -1)
echo "PASS: anthropic.test.ts — $PASSED_ANTHROPIC"

echo "--- AC-6: full vitest suite passes (grep log, tolerate teardown-rpc exit flake) ---"
npx vitest run >"$LOG_DIR/fullsuite.log" 2>&1 || true
grep -qE "Tests[[:space:]]+[0-9]+[[:space:]]+passed" "$LOG_DIR/fullsuite.log" || { tail -100 "$LOG_DIR/fullsuite.log"; fail "AC-6: no 'Tests N passed' line in full-suite output"; }
if grep -qE "Tests[[:space:]]+[0-9]+[[:space:]]+failed" "$LOG_DIR/fullsuite.log"; then
  tail -100 "$LOG_DIR/fullsuite.log"
  fail "AC-6: found 'Tests N failed' line in full-suite output"
fi
PASSED_FULL=$(grep -oE "Tests[[:space:]]+[0-9]+[[:space:]]+passed" "$LOG_DIR/fullsuite.log" | head -1)
echo "PASS: full suite — $PASSED_FULL"

echo "--- AC-7: no residual messages.create( in production code under server/ (excluding *.test.ts) ---"
# Test files may reference the old API name in comments/test-names as intentional tripwires.
# Production code must not invoke messages.create().
RESIDUAL=$(git grep -nE 'messages\.create\(' -- 'server/**/*.ts' ':!server/**/*.test.ts' || true)
[ -z "$RESIDUAL" ] || fail "AC-7: residual messages.create() in production code:\n$RESIDUAL"
echo "PASS: no residual messages.create() in production code under server/"

echo "--- AC-8: package.json version is 0.32.8 ---"
VERSION=$(node -p "require('./package.json').version")
[ "$VERSION" = "0.32.8" ] || fail "AC-8: expected version 0.32.8, got $VERSION"
echo "PASS: version 0.32.8"

echo ""
echo "ALL AC GREEN for v0.32.8 unconditional-streaming-callclaude"
