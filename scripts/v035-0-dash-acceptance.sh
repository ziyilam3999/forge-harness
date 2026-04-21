#!/usr/bin/env bash
# Acceptance wrapper for v0.35.0 -- dashboard renders active story declarations.
# Runs AC-1..AC-8 from
#   .ai-workspace/plans/2026-04-21-v0-35-0-dashboard-declarations.md
#
# Usage: bash scripts/v035-0-dash-acceptance.sh
# Prereqs: node, npm, git, bash, npx (vitest + tsc via devDeps). No jq (all
# JSON parsing is done inline via `node -e`).
#
# Contract: aborts on first non-zero exit so the executor's self-check
# matches the reviewer's script exactly. AC-1..AC-8 are independent, but
# `npm run build` MUST run first because AC-2 and AC-3 import from `dist/`.

set -euo pipefail

# MSYS_NO_PATHCONV=1 disables Git Bash path mangling when any downstream step
# uses `origin/master...HEAD` syntax in git diff (AC-8). Cheap insurance.
export MSYS_NO_PATHCONV=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== v0.35.0 dashboard declarations acceptance ==="
echo

# ── Build prep ────────────────────────────────────────────────────────────
# Must run BEFORE AC-2 and AC-3 — they import from ./dist/lib/dashboard-renderer.js.
# Omitting this step causes AC-2/AC-3 to fail with ERR_MODULE_NOT_FOUND.
echo "--- prep: npm run build ---"
npm run build
echo "  PASS  build"
echo

# ── AC-1: Type surface ────────────────────────────────────────────────────
echo "--- AC-1: npx tsc --noEmit ---"
npx tsc --noEmit
echo "  PASS  AC-1"
echo

# ── AC-2: Declaration appears in HTML when active ─────────────────────────
echo "--- AC-2: renderDashboardHtml surfaces storyId ---"
node --input-type=module -e "
  import('./dist/lib/dashboard-renderer.js').then(m => {
    const html = m.renderDashboardHtml({
      brief: null, activity: null, auditEntries: [],
      renderedAt: '2026-04-21T09:00:00.000Z',
      declaration: { storyId: 'US-UNIQUE-PROBE-999', phaseId: 'PH-UNIQUE-888', declaredAt: '2026-04-21T09:00:00.000Z' },
    });
    process.exit(html.includes('US-UNIQUE-PROBE-999') ? 0 : 1);
  });
"
echo "  PASS  AC-2"
echo

# ── AC-3: Differential — renderer actually reads declaration ──────────────
echo "--- AC-3: renderer differential probe ---"
node --input-type=module -e "
  import('./dist/lib/dashboard-renderer.js').then(m => {
    const base = { brief: null, activity: null, auditEntries: [], renderedAt: '2026-04-21T09:00:00.000Z' };
    const htmlA = m.renderDashboardHtml({ ...base, declaration: { storyId: 'US-PROBE-AAA', phaseId: null, declaredAt: '2026-04-21T09:00:00.000Z' } });
    const htmlB = m.renderDashboardHtml({ ...base, declaration: { storyId: 'US-PROBE-BBB', phaseId: null, declaredAt: '2026-04-21T09:00:00.000Z' } });
    const ok = htmlA.includes('US-PROBE-AAA') && !htmlA.includes('US-PROBE-BBB')
            && htmlB.includes('US-PROBE-BBB') && !htmlB.includes('US-PROBE-AAA');
    process.exit(ok ? 0 : 1);
  });
"
echo "  PASS  AC-3"
echo

# ── AC-4: Named vitest test exists and passes ─────────────────────────────
echo "--- AC-4: named test 'renderDashboard surfaces active declaration end-to-end' ---"
npx vitest run -t "renderDashboard surfaces active declaration end-to-end" --reporter=json 2>/dev/null | node -e "
  let s=''; process.stdin.on('data',d=>s+=d);
  process.stdin.on('end',()=>{
    const r=JSON.parse(s);
    const matches = r.testResults.flatMap(f=>f.assertionResults||[])
      .filter(a => (a.fullName||a.title||'').includes('renderDashboard surfaces active declaration end-to-end'));
    const ok = r.numFailedTests===0 && matches.length>=1 && matches.every(m=>m.status==='passed');
    process.exit(ok ? 0 : 1);
  });
"
echo "  PASS  AC-4"
echo

# ── AC-5: Existing renderer suite unaffected ──────────────────────────────
echo "--- AC-5: server/lib/dashboard-renderer.test.ts ---"
npx vitest run server/lib/dashboard-renderer.test.ts --reporter=json 2>/dev/null | node -e "
  let s=''; process.stdin.on('data',d=>s+=d);
  process.stdin.on('end',()=>{
    const r=JSON.parse(s);
    process.exit(r.numFailedTests===0 ? 0 : 1);
  });
"
echo "  PASS  AC-5"
echo

# ── AC-6: Net test growth + declaration-name filter ≥ 3 ───────────────────
echo "--- AC-6: full suite green + ≥ 3 tests named /declaration/i ---"
npx vitest run --reporter=json 2>/dev/null | node -e "
  let s=''; process.stdin.on('data',d=>s+=d);
  process.stdin.on('end',()=>{
    const r=JSON.parse(s);
    const names = r.testResults.flatMap(f=>f.assertionResults||[]).map(a=>(a.fullName||a.title||''));
    const decls = names.filter(n => /declaration/i.test(n));
    process.exit((r.numFailedTests===0 && decls.length>=3) ? 0 : 1);
  });
"
echo "  PASS  AC-6"
echo

# ── AC-7 is THIS wrapper's exit 0. Nothing to invoke inline. ──────────────
echo "--- AC-7: this wrapper exits 0 iff AC-1..AC-6 and AC-8 all pass ---"
echo "  (implicit — validated by the final 'all passed' check below)"
echo

# ── AC-8: No drive-by edits outside the allowlist ─────────────────────────
echo "--- AC-8: diff allowlist against origin/master...HEAD ---"
git diff --name-only origin/master...HEAD | node -e "
  let s=''; process.stdin.on('data',d=>s+=d);
  process.stdin.on('end',()=>{
    const allowedExact = new Set([
      'server/lib/dashboard-renderer.ts',
      'server/lib/declaration-store.ts',
      'server/tools/declare-story.ts',
      'server/tools/declare-story.test.ts',
      'CHANGELOG.md',
      'scripts/v035-0-dash-acceptance.sh',
      'package.json',
      'package-lock.json',
    ]);
    const allowedTestPrefixes = ['server/lib/dashboard-renderer', 'server/lib/declaration'];
    const files = s.trim().split('\n').filter(Boolean);
    const offenders = files.filter(f =>
      !allowedExact.has(f) && !(allowedTestPrefixes.some(p => f.startsWith(p)) && f.endsWith('.test.ts'))
    );
    if (offenders.length > 0) {
      console.error('AC-8 offenders:', offenders);
    }
    process.exit(offenders.length===0 ? 0 : 1);
  });
"
echo "  PASS  AC-8"
echo

echo "=== All AC passed ==="
