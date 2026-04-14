#!/usr/bin/env bash
set -euo pipefail

# Unit tests for scripts/retroactive-critique-hook.sh
# Covers AC-04 (a) non-matching path, (b) each rule allowlist entry, (c) malformed stdin.

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
hook="$root/scripts/retroactive-critique-hook.sh"
fixtures="$root/tests/fixtures/hook-stdin"

fail=0
pass=0

assert_silent_pass() {
  local fixture="$1"
  local out
  out="$(bash "$hook" < "$fixtures/$fixture")"
  if [[ -z "$out" ]]; then
    pass=$((pass+1))
    echo "PASS: $fixture -> silent"
  else
    fail=$((fail+1))
    echo "FAIL: $fixture -> expected silent, got: $out"
  fi
}

assert_emits_directive() {
  local fixture="$1"
  local out
  out="$(bash "$hook" < "$fixtures/$fixture")"
  if printf '%s' "$out" | grep -q '"hookSpecificOutput"' \
     && printf '%s' "$out" | grep -q '"hookEventName": "PostToolUse"' \
     && printf '%s' "$out" | grep -q '"additionalContext"' \
     && printf '%s' "$out" | grep -q 'forge_evaluate'; then
    pass=$((pass+1))
    echo "PASS: $fixture -> emitted nested directive"
  else
    fail=$((fail+1))
    echo "FAIL: $fixture -> expected nested hookSpecificOutput JSON with forge_evaluate directive, got: $out"
  fi
}

assert_malformed_errors() {
  local fixture="$1"
  local out err rc
  set +e
  out="$(bash "$hook" < "$fixtures/$fixture" 2>/tmp/rc-hook-err)"
  rc=$?
  set -e
  err="$(cat /tmp/rc-hook-err)"
  rm -f /tmp/rc-hook-err
  if [[ "$rc" -ne 0 && -n "$err" ]]; then
    pass=$((pass+1))
    echo "PASS: $fixture -> exit $rc with stderr: $err"
  else
    fail=$((fail+1))
    echo "FAIL: $fixture -> expected non-zero exit with stderr, got rc=$rc out=$out err=$err"
  fi
}

assert_empty_stdin_errors() {
  local out err rc
  set +e
  out="$(echo -n "" | bash "$hook" 2>/tmp/rc-hook-err)"
  rc=$?
  set -e
  err="$(cat /tmp/rc-hook-err)"
  rm -f /tmp/rc-hook-err
  if [[ "$rc" -ne 0 && -n "$err" ]]; then
    pass=$((pass+1))
    echo "PASS: empty-stdin -> exit $rc"
  else
    fail=$((fail+1))
    echo "FAIL: empty-stdin -> expected non-zero exit, got rc=$rc err=$err"
  fi
}

assert_silent_pass non-matching.json
assert_emits_directive rule-critic.json
assert_emits_directive rule-planner.json
assert_emits_directive rule-ac-subprocess.json
assert_emits_directive rule-ac-lint.json
assert_malformed_errors malformed.json
assert_empty_stdin_errors

echo ""
echo "retroactive-critique-hook.test.sh: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
