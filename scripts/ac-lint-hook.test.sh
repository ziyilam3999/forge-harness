#!/usr/bin/env bash
set -euo pipefail

# Unit tests for scripts/ac-lint-hook.sh
# Covers: non-matching path, plan-file path + clean/dirty/crashed lint,
# malformed stdin, empty stdin.
# Q0.5/C1 polish pass (PR #183): M3 (clean-lint sentinel), M4 (deterministic
# empty-stdin assertion), plus a new crashed-lint test for M2.

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
# M1: the explicit stderr diagnostic must appear (not just a bare non-zero exit).
if [[ "$rc" -ne 0 && "$err" == *"stdin parse failed"* ]]; then
  pass=$((pass+1)); echo "PASS: malformed.json -> rc=$rc + 'stdin parse failed' diagnostic"
else
  fail=$((fail+1)); echo "FAIL: malformed.json -> rc=$rc err=$err"
fi

# --- Empty stdin: deterministic rc=1 + specific 'empty stdin' stderr ---------
# M4: use here-string for deterministic input shape; assert the specific
# failure mode (exit 1 + stderr contains 'empty stdin'), not a generic rc!=0.
set +e
out="$(bash "$hook" <<< "" 2>/tmp/rc-lint-err)"
rc=$?
set -e
err="$(cat /tmp/rc-lint-err)"; rm -f /tmp/rc-lint-err
if [[ "$rc" -eq 1 && "$err" == *"empty stdin"* ]]; then
  pass=$((pass+1)); echo "PASS: empty-stdin -> rc=1 + 'empty stdin' diagnostic"
else
  fail=$((fail+1)); echo "FAIL: empty-stdin -> rc=$rc err=$err"
fi

# --- Sandbox setup for clean/dirty/crashed lint tests ------------------------
sandbox="$(mktemp -d)"
sentinel="$sandbox/stub-invoked"
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/scripts" "$sandbox/.ai-workspace/plans"

# --- Plan-file path + clean lint: silent, AND stub must have been invoked ----
# M3: the stub writes a sentinel file in its own cwd; the test asserts the
# sentinel exists post-run. The old test passed vacuously because the stub
# produced no output AND didn't prove invocation ran at all.
# Relative-path sentinel avoids MSYS↔Windows path translation hazards — the
# hook does `cd "$project_dir"` before invoking node, so node's cwd IS the
# sandbox root and a relative write lands deterministically inside it.
cat > "$sandbox/scripts/run-ac-lint.mjs" <<'STUB'
import { writeFileSync } from "node:fs";
writeFileSync("stub-invoked", "INVOKED\n");
process.exit(0);
STUB

rm -f "$sandbox/stub-invoked"
out="$(CLAUDE_PROJECT_DIR="$sandbox" bash "$hook" < "$fixtures/plan-file.json")"
if [[ -z "$out" && -f "$sandbox/stub-invoked" ]]; then
  pass=$((pass+1)); echo "PASS: plan-file clean lint -> silent AND stub invoked (sentinel present)"
else
  fail=$((fail+1)); echo "FAIL: plan-file clean lint -> out='$out' sentinel-exists=$([[ -f "$sandbox/stub-invoked" ]] && echo yes || echo no)"
fi

# --- Plan-file path + dirty lint: nested JSON with findings ------------------
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

# --- M2: linter crashed -> additionalContext contains "linter crashed" -------
cat > "$sandbox/scripts/run-ac-lint.mjs" <<'STUB'
console.error("boom: simulated linter crash");
process.exit(7);
STUB

out="$(CLAUDE_PROJECT_DIR="$sandbox" bash "$hook" < "$fixtures/plan-file.json")"
if printf '%s' "$out" | grep -q '"hookSpecificOutput"' \
   && printf '%s' "$out" | grep -q 'linter crashed' \
   && printf '%s' "$out" | grep -q 'boom: simulated linter crash'; then
  pass=$((pass+1)); echo "PASS: linter crashed -> additionalContext with 'linter crashed' + captured stderr"
else
  fail=$((fail+1)); echo "FAIL: linter crashed -> got: $out"
fi

echo ""
echo "ac-lint-hook.test.sh: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
