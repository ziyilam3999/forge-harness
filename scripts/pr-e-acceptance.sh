#!/usr/bin/env bash
# PR E acceptance wrapper — v0.33.0 cumulative minor-version release.
# Runs AC-E1..E8 in order. Exits 0 iff all pass.

set -euo pipefail
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

pass() { printf '  [PASS] AC-E%s: %s\n' "$1" "$2"; }
fail() { printf '  [FAIL] AC-E%s: %s\n' "$1" "$2"; exit 1; }

mkdir -p tmp

# AC-E1: package.json version == "0.33.0"
VERSION=$(node -e "console.log(require('./package.json').version)")
[ "$VERSION" = "0.33.0" ] || fail 1 "package.json version is '$VERSION', expected '0.33.0'"
pass 1 "package.json version == 0.33.0"

# AC-E2: CHANGELOG.md line 1 is the # Changelog H1
LINE1=$(awk 'NR==1 { print; exit }' CHANGELOG.md)
[ "$LINE1" = "# Changelog" ] || fail 2 "line 1 is '$LINE1', expected '# Changelog'"
pass 2 "CHANGELOG.md line 1 is '# Changelog' H1"

# AC-E3: exactly ONE # Changelog H1 (no stray duplicates)
H1_COUNT=$(grep -cE '^# Changelog$' CHANGELOG.md)
[ "$H1_COUNT" -eq 1 ] || fail 3 "found $H1_COUNT '# Changelog' H1 lines, expected exactly 1"
pass 3 "exactly one '# Changelog' H1"

# AC-E4: first ## [X.Y.Z] version header is [0.33.0]
FIRST_VERSION=$(grep -nE '^## \[' CHANGELOG.md | head -1)
echo "$FIRST_VERSION" | grep -qE '^[0-9]+:## \[0\.33\.0\]' || fail 4 "first version header is '$FIRST_VERSION', expected '## [0.33.0]...'"
pass 4 "first version header is [0.33.0]"

# AC-E5: version headers monotonic-descending
grep -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | awk -F'[][]' '{print $2}' > tmp/pr-e-versions.txt
node -e "
  const fs = require('fs');
  const v = fs.readFileSync('tmp/pr-e-versions.txt', 'utf8').trim().split('\n');
  const cmp = (a, b) => {
    const [a1, a2, a3] = a.split('.').map(Number);
    const [b1, b2, b3] = b.split('.').map(Number);
    return a1 - b1 || a2 - b2 || a3 - b3;
  };
  for (let i = 0; i < v.length - 1; i++) {
    if (cmp(v[i], v[i + 1]) <= 0) {
      console.error('non-monotonic at index ' + i + ': ' + v[i] + ' before ' + v[i + 1]);
      process.exit(1);
    }
  }
" || fail 5 "version headers not strictly descending"
pass 5 "version headers strictly descending"

# AC-E6: v0.33.0 entry references issue #354
awk '/^## \[0\.33\.0\]/,/^## \[0\.32\.14\]/' CHANGELOG.md | grep -q '#354' || fail 6 "v0.33.0 entry does not reference #354"
pass 6 "v0.33.0 entry references #354"

# AC-E7: all tests pass, count unchanged from master baseline of 776
npx vitest run --reporter=json --outputFile=tmp/pr-e-vitest.json > /dev/null 2>&1 || true
node -e "
  const r = require('./tmp/pr-e-vitest.json');
  if (r.numFailedTests === 0 && r.numPassedTests >= 776) process.exit(0);
  console.error('tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed (expected 0 failed, >= 776 passed)');
  process.exit(1);
" || fail 7 "vitest did not meet baseline"
pass 7 "vitest: all pass, >= 776 passed"

# AC-E8: changes confined to release-only surface
UNEXPECTED=$(git diff --name-only master...HEAD | grep -vE '^(CHANGELOG\.md|package\.json|\.ai-workspace/plans/2026-04-20-v0-33-0-pr-e-cumulative-release\.md|scripts/pr-e-acceptance\.sh)$' || true)
if [ -n "$UNEXPECTED" ]; then
  fail 8 "unexpected files changed: $UNEXPECTED"
fi
pass 8 "changes confined to release-only allowlist"

echo ""
echo "ALL PR E ACCEPTANCE CHECKS PASSED"
