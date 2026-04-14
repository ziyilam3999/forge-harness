#!/usr/bin/env bash
set -euo pipefail

# Unit tests for scripts/ac-lint-hook.sh
# Covers AC-04 (a) non-matching path, (b) plan-file path triggers lint, (c) malformed stdin,
# (d) clean + dirty lint output shapes.

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
hook="$root/scripts/ac-lint-hook.sh"
fixtures="$root/tests/fixtures/hook-stdin"

fail=0
pass=0

# --- Non-matching path: silent exit, no lint invocation -----------------------
out="$(bash "$hook" < "$fixtures/non-matching.json")"
if [[ -z "$out" ]]; then
  pass=$((pass+1)); echo "PASS: non-matching.json -> silent"
else
  fail=$((fail+1)); echo "FAIL: non-matching.json -> expected silent, got: $out"
fi

# --- Malformed stdin: non-zero exit with stderr -------------------------------
set +e
out="$(bash "$hook" < "$fixtures/malformed.json" 2>/tmp/rc-lint-err)"
rc=$?
set -e
err="$(cat /tmp/rc-lint-err)"; rm -f /tmp/rc-lint-err
if [[ "$rc" -ne 0 && -n "$err" ]]; then
  pass=$((pass+1)); echo "PASS: malformed.json -> exit $rc"
else
  fail=$((fail+1)); echo "FAIL: malformed.json -> rc=$rc err=$err"
fi

# --- Empty stdin: non-zero exit -----------------------------------------------
set +e
out="$(echo -n "" | bash "$hook" 2>/tmp/rc-lint-err)"
rc=$?
set -e
err="$(cat /tmp/rc-lint-err)"; rm -f /tmp/rc-lint-err
if [[ "$rc" -ne 0 && -n "$err" ]]; then
  pass=$((pass+1)); echo "PASS: empty-stdin -> exit $rc"
else
  fail=$((fail+1)); echo "FAIL: empty-stdin -> rc=$rc"
fi

# --- Plan-file path + clean lint: silent or valid JSON ------------------------
# Stub run-ac-lint.mjs to produce empty output (clean).
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/scripts" "$sandbox/.ai-workspace/plans"
cat > "$sandbox/scripts/run-ac-lint.mjs" <<'STUB'
// clean stub
process.exit(0);
STUB

out="$(CLAUDE_PROJECT_DIR="$sandbox" bash "$hook" < "$fixtures/plan-file.json")"
if [[ -z "$out" ]]; then
  pass=$((pass+1)); echo "PASS: plan-file clean lint -> silent"
else
  fail=$((fail+1)); echo "FAIL: plan-file clean lint -> expected silent, got: $out"
fi

# --- Plan-file path + dirty lint: nested JSON with findings --------------------
cat > "$sandbox/scripts/run-ac-lint.mjs" <<'STUB'
console.log("FAIL plans/example.json: AC-01 not binary");
console.log("FAIL plans/example.json: AC-02 missing verification");
process.exit(0);
STUB

out="$(CLAUDE_PROJECT_DIR="$sandbox" bash "$hook" < "$fixtures/plan-file.json")"
if printf '%s' "$out" | grep -q '"hookSpecificOutput"' \
   && printf '%s' "$out" | grep -q '"hookEventName":"PostToolUse"' \
   && printf '%s' "$out" | grep -q '"additionalContext"' \
   && printf '%s' "$out" | grep -q 'AC-01 not binary'; then
  pass=$((pass+1)); echo "PASS: plan-file dirty lint -> nested directive with findings"
else
  fail=$((fail+1)); echo "FAIL: plan-file dirty lint -> got: $out"
fi

echo ""
echo "ac-lint-hook.test.sh: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
