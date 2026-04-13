#!/usr/bin/env bash
# Q0.5/B1 — smoke-gate bootstrap detection.
#
# Emits exactly one of two status lines on stdout:
#   smoke-gate: bootstrap-exempt   (B1 landing PR — detection disabled)
#   smoke-gate: active             (subsequent PRs — detection enabled)
#
# Bootstrap-exempt condition (ALL three must hold):
#   (a) `handleSmokeTest` is NOT exported from server/tools/evaluate.ts on origin/master
#   (b) `handleSmokeTest` IS exported from server/tools/evaluate.ts on HEAD
#   (c) zero `.ai-workspace/plans/*.smoke.json` files exist on origin/master
#
# The grep accepts both `export function handleSmokeTest` AND
# `export async function handleSmokeTest` via an optional `async ` group.
# The real handler is async; the regex without the optional group missed it
# on the B1 landing PR, emitting `smoke-gate: active` instead of
# `bootstrap-exempt`. Fix pinned in tests 15-16 and 17-bootstrap.
#
# Uses `git show` and `git ls-tree` (NOT `find`) so the origin/master state is
# inspected via the git object database, not the working tree. `find` would
# only see the current checkout and would lie about master when HEAD is
# diverged or the working tree is dirty.
#
# This script exits 0 in both cases during B1's landing PR (report-only mode,
# per B1 D4). A follow-up PR will flip the "active" branch to non-zero exit
# when a required smoke report is missing, turning the gate binding.

# Note: intentionally NOT using `set -e`. The grep -c calls return 1 when
# they find zero matches, which is a valid state we handle explicitly. Under
# `set -e` those would exit the script prematurely, or interact badly with
# command-substitution exit-code propagation. We handle errors inline.
set -uo pipefail

EVAL_FILE="server/tools/evaluate.ts"
SMOKE_JSON_PATH_RE='^\.ai-workspace/plans/.+\.smoke\.json$'

TMPMASTER=$(mktemp)
TMPHEAD=$(mktemp)

MASTER_HAS=0
if git show "origin/master:${EVAL_FILE}" > "${TMPMASTER}" 2>/dev/null; then
  MASTER_HAS=$(grep -c '^export \(async \)\{0,1\}function handleSmokeTest\b' "${TMPMASTER}")
  [ -z "${MASTER_HAS}" ] && MASTER_HAS=0
fi

HEAD_HAS=0
if git show "HEAD:${EVAL_FILE}" > "${TMPHEAD}" 2>/dev/null; then
  HEAD_HAS=$(grep -c '^export \(async \)\{0,1\}function handleSmokeTest\b' "${TMPHEAD}")
  [ -z "${HEAD_HAS}" ] && HEAD_HAS=0
fi

MASTER_TREE=$(git ls-tree -r --name-only origin/master 2>/dev/null || true)
MASTER_SMOKE_COUNT=$(printf '%s\n' "${MASTER_TREE}" | grep -cE "${SMOKE_JSON_PATH_RE}")
[ -z "${MASTER_SMOKE_COUNT}" ] && MASTER_SMOKE_COUNT=0

rm -f "${TMPMASTER}" "${TMPHEAD}"

if [ "${MASTER_HAS}" -eq 0 ] && [ "${HEAD_HAS}" -ge 1 ] && [ "${MASTER_SMOKE_COUNT}" -eq 0 ]; then
  echo "smoke-gate: bootstrap-exempt"
  echo "  master has handleSmokeTest:     no"
  echo "  HEAD has handleSmokeTest:       yes"
  echo "  master smoke.json file count:   0"
  exit 0
fi

echo "smoke-gate: active"
echo "  master has handleSmokeTest:     $([ "${MASTER_HAS}" -ge 1 ] && echo yes || echo no)"
echo "  HEAD has handleSmokeTest:       $([ "${HEAD_HAS}" -ge 1 ] && echo yes || echo no)"
echo "  master smoke.json file count:   ${MASTER_SMOKE_COUNT}"

# Report-only in B1's landing PR (D4). The follow-up PR that makes this
# binding will add `exit 1` here on a "missing smoke report" check.
exit 0
