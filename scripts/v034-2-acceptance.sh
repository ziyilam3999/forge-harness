#!/usr/bin/env bash
# v0.34.2 acceptance wrapper — setup-config polish (6 fixes, 1 deferred).
# Runs AC-1..AC-12 in order. Exits 0 iff all pass.
# Plan: .ai-workspace/plans/2026-04-20-v0-34-2-setup-config-polish.md

set -euo pipefail
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

pass() { printf '  [PASS] AC-%s: %s\n' "$1" "$2"; }
fail() { printf '  [FAIL] AC-%s: %s\n' "$1" "$2"; exit 1; }

mkdir -p tmp

CFG=scripts/setup-config.cjs
WRAPPER=scripts/setup-config-acceptance.sh

# AC-1: spawnClaude no longer uses shell: true.
awk '/^function spawnClaude/,/^}$/' "$CFG" > tmp/v034-2-spawnClaude.txt
if grep -qE 'shell\s*:\s*true' tmp/v034-2-spawnClaude.txt; then
  fail 1 "spawnClaude still contains shell: true"
fi
pass 1 "spawnClaude does not use shell: true"

# AC-2: spawnClaude (or a sibling helper) resolves the claude binary explicitly.
if grep -qE '(which|where|resolveClaude|\.cmd|claudeBin|claudePath|binaryPath)' tmp/v034-2-spawnClaude.txt \
   || grep -qE '(resolveClaude|findClaude|locateClaude)' "$CFG"; then
  pass 2 "claude binary resolution present (direct or via helper)"
else
  fail 2 "no explicit claude binary resolution found"
fi

# AC-3: wrapper header matches behavior (soft OR guard).
if head -15 "$WRAPPER" | grep -qE '(exit with a clear message|will exit|exits? early)'; then
  # Header still promises early-exit → must have a non-MSYS exit path.
  if head -60 "$WRAPPER" | grep -qE '(OSTYPE|uname).*' \
     && head -60 "$WRAPPER" | grep -qE '\bexit\s+[1-9]'; then
    pass 3 "wrapper header retained with OS guard + exit"
  else
    fail 3 "wrapper header promises early-exit but no OSTYPE/uname + exit path found in first 60 lines"
  fi
else
  pass 3 "wrapper header softened (no early-exit promise)"
fi

# AC-4: sha256 snapshot captured before any subprocess.
SHA_LINE=$(grep -nE 'HOST_CLAUDE_JSON_BEFORE_SHA256=' "$WRAPPER" | head -1 | cut -d: -f1 || true)
BUILD_LINE=$(grep -nE 'npm run build|npm install|npx ' "$WRAPPER" | head -1 | cut -d: -f1 || true)
if [ -z "${BUILD_LINE:-}" ]; then
  pass 4 "no build/install subprocess in wrapper (vacuously ordered)"
elif [ -n "${SHA_LINE:-}" ] && [ "$SHA_LINE" -lt "$BUILD_LINE" ]; then
  pass 4 "sha256 snapshot (line $SHA_LINE) precedes first subprocess (line $BUILD_LINE)"
else
  fail 4 "sha256 snapshot (line ${SHA_LINE:-none}) does not precede first subprocess (line $BUILD_LINE)"
fi

# AC-5: AC-9 success line omits hex.
if grep -E '^\s*ok\s+"AC-9[^"]*unchanged' "$WRAPPER" | grep -qvE '\$HOST_CLAUDE_JSON_(BEFORE|AFTER)_SHA256'; then
  pass 5 "AC-9 success line does not interpolate sha256 hex"
else
  fail 5 "AC-9 success line still interpolates sha256 hex"
fi

# AC-6: tryClaudeMcpAdd has JSDoc documenting return shape.
grep -B 30 '^function tryClaudeMcpAdd' "$CFG" | tail -30 > tmp/v034-2-mcpadd-jsdoc.txt
if ! grep -qE '^\s*\*/' tmp/v034-2-mcpadd-jsdoc.txt; then
  fail 6 "no JSDoc close marker (*/) found in 30 lines preceding tryClaudeMcpAdd"
fi
if ! grep -qE '(reason|ok|missing|failed|tagged|union)' tmp/v034-2-mcpadd-jsdoc.txt; then
  fail 6 "JSDoc block preceding tryClaudeMcpAdd does not mention reason/ok/missing/failed"
fi
pass 6 "tryClaudeMcpAdd has JSDoc documenting tagged union return shape"

# AC-7: err.message ternary fallback removed.
if grep -qE 'err\s*&&\s*err\.message\s*\?' "$CFG"; then
  fail 7 "dead-code ternary 'err && err.message ? ...' still present"
fi
pass 7 "err.message ternary fallback removed"

# AC-8: full test suite green (>= 792 passed).
# Baseline is set ~2 tests below the shipped count as an intentional buffer
# for parallel-churn: concurrent slices landing between plan-time and
# executor-time can add/remove one or two tests, and we don't want that
# incidental noise to fail this historical release-pinned wrapper.
MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v034-2-full.json > /dev/null 2>&1 || true
node -e "const r=require('./tmp/v034-2-full.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 792) process.exit(0); console.error('full suite: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed (expected 0 failed, >= 792 passed)'); process.exit(1);" \
  || fail 8 "full vitest suite did not meet baseline"
PASSED=$(node -e "console.log(require('./tmp/v034-2-full.json').numPassedTests)")
pass 8 "full vitest suite green ($PASSED passed, 0 failed)"

# AC-9: lint green.
if ! npm run lint > tmp/v034-2-lint.log 2>&1; then
  tail -30 tmp/v034-2-lint.log
  fail 9 "npm run lint reported errors"
fi
pass 9 "npm run lint clean"

# AC-10: setup-config-acceptance.sh still passes end-to-end (Windows/MSYS only).
# The setup-config-acceptance.sh wrapper expects MSYS path semantics for $HOME
# (e.g. /c/Users/...), which MSYS_NO_PATHCONV=1 disables — so we unset that
# env var for this child invocation only.
if echo "${OSTYPE:-}" | grep -qE 'msys|cygwin|win32'; then
  if env -u MSYS_NO_PATHCONV bash "$WRAPPER" > tmp/v034-2-setup-config-wrapper.log 2>&1; then
    pass 10 "setup-config-acceptance.sh passed end-to-end"
  else
    tail -30 tmp/v034-2-setup-config-wrapper.log
    fail 10 "setup-config-acceptance.sh failed"
  fi
else
  pass 10 "non-Windows host — skipping setup-config-acceptance.sh (wrapper is Windows-targeted)"
fi

# AC-11: diff confined to allowlist.
UNEXPECTED=$(git diff --name-only master...HEAD | grep -vE '^(scripts/setup-config\.cjs|scripts/setup-config-acceptance\.sh|\.ai-workspace/plans/2026-04-20-v0-34-2-setup-config-polish\.md|scripts/v034-2-acceptance\.sh)$' || true)
if [ -n "$UNEXPECTED" ]; then
  fail 11 "unexpected files in diff: $UNEXPECTED"
fi
pass 11 "diff confined to allowlisted fix surface"

# AC-12: this wrapper exists and is executable — by construction if this line runs.
if [ ! -x "scripts/v034-2-acceptance.sh" ]; then
  fail 12 "scripts/v034-2-acceptance.sh is not executable"
fi
pass 12 "scripts/v034-2-acceptance.sh is executable"

echo ""
echo "ALL V0.34.2 ACCEPTANCE CHECKS PASSED"
