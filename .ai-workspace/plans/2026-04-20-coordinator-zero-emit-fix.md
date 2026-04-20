# v0.33.1 — coordinator `checkBudget` / `checkTimeBudget` zero-emit fix

## Context

Monday (monday-bot) filed a dashboard defect on 2026-04-20T11:05Z (mail thread `forge-dashboard-budget-time-zero-bug`). Two adjacent-but-independent bugs in `server/lib/coordinator.ts` cause the Kanban dashboard's BUDGET and TIME stat cards to display `$0.00` / `0m 00s` even when real spend and elapsed time exist. Both diagnoses were re-verified against current master (v0.33.0, `1262d0f`) before planning.

**Bug 1 — `checkBudget` (coordinator.ts:892-931):** when `budgetUsd` is null or undefined (the common case — monday-bot never sets a cap), the function early-returns with hardcoded `usedUsd: 0`, skipping the aggregation loop at L906-914 entirely. The caller (`assessPhase` at L681) passes `options.budgetUsd ?? undefined` unconditionally — when the caller has records worth $0.59 but no cap, the dashboard still shows `$0.00`.

**Bug 2 — `checkTimeBudget` (coordinator.ts:938-942):** when `startTimeMs` is undefined (monday's `forge_coordinate({planPath, phaseId})` call doesn't track a start time), the function returns `elapsedMs: 0` with `warningLevel: "unknown"`. The dashboard renderer doesn't distinguish `"unknown"` from `"none"` — both render as `0m 00s`. Useful fallback exists at L1074-1077 (reduce over records for earliest timestamp) but isn't reused here.

**Single call site each.** `checkBudget` and `checkTimeBudget` are each called exactly once — both from `assessPhase` at L681-682, where `allRecords` is already in scope. Zero ripple to other callers.

**Monday's proposed fix shapes (both approved in reply 2026-04-20T11:15Z):**
- `checkBudget`: unconditional aggregation; only gate the cap/ratio/warning logic on `budgetUsd != null`.
- `checkTimeBudget`: add optional `priorRecords` parameter; when `startTimeMs` is omitted, fall back to earliest record timestamp; when `priorRecords` is also empty/omitted, preserve existing `elapsedMs: 0, warningLevel: "unknown"` behavior. Caller-provided `startTimeMs` stays authoritative when present (not superseded by records-derived value).

## Goal

1. `checkBudget` returns the correct `usedUsd` sum whenever records carry cost data, regardless of whether a budget cap is set.
2. `checkTimeBudget` returns a non-zero `elapsedMs` whenever record history exists, even if the caller didn't track a start time.
3. Call-site behavior for callers that pass all non-optional arguments is unchanged — this is a pure no-regressions fix on the null-arg paths. (Function signatures: `checkBudget` unchanged; `checkTimeBudget` gains an optional third parameter `priorRecords?` with a safe default — non-breaking addition.)

## Binary AC

1. **AC-1** — `server/lib/coordinator.ts` contains a `checkBudget` implementation where the aggregation loop runs BEFORE the `budgetUsd` null-check branch. Directly asserts relative ordering within the function body:
   ```bash
   awk '/^export function checkBudget/,/^}$/' server/lib/coordinator.ts > tmp/v033-1-checkbudget.txt
   AGG=$(grep -n 'usedUsd += ' tmp/v033-1-checkbudget.txt | head -1 | cut -d: -f1)
   GATE=$(grep -n 'budgetUsd === undefined' tmp/v033-1-checkbudget.txt | head -1 | cut -d: -f1)
   [ -n "$AGG" ] && [ -n "$GATE" ] && [ "$AGG" -lt "$GATE" ]
   ```
   (Passes iff both lines exist in the function body and the `usedUsd += …` aggregation line appears above the `budgetUsd === undefined` null-check line.)

2. **AC-2** — `checkTimeBudget` signature accepts an optional third parameter `priorRecords`:
   ```bash
   grep -E '^export function checkTimeBudget\(' server/lib/coordinator.ts | grep -c 'priorRecords' | awk '$1 == 1 { exit 0 } { exit 1 }'
   ```

3. **AC-3** — All existing tests in `server/lib/coordinator.test.ts` still pass:
   ```bash
   npx vitest run server/lib/coordinator.test.ts --reporter=json --outputFile=tmp/v033-1-existing.json > /dev/null 2>&1 || true
   node -e "const r=require('./tmp/v033-1-existing.json'); if (r.numFailedTests === 0 && r.numPassedTests > 0) process.exit(0); process.exit(1);"
   ```

4. **AC-4** — New test exists for the `checkBudget` null-budget aggregation path. Loosely identified by the presence of a new `it(...)` or `test(...)` block whose title mentions the null-budget behavior. Verified by test-count delta rather than source-string matching (more robust to formatting choices):
   ```bash
   BEFORE=$(git show master:server/lib/coordinator.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(")
   AFTER=$(grep -cE "^\s*(it|test)\s*\(" server/lib/coordinator.test.ts)
   [ "$AFTER" -gt "$BEFORE" ]
   ```
   (The test body must invoke `checkBudget(records, undefined)` with non-empty cost-bearing records and assert a non-zero aggregated total. Executor picks the exact assertion shape; reviewer verifies the behavior by reading the added test.)

5. **AC-5** — New test exists covering `checkTimeBudget`'s priorRecords-fallback path. Same test-count-delta check as AC-4 (shared AFTER/BEFORE computation applies; both new tests count together):
   ```bash
   BEFORE=$(git show master:server/lib/coordinator.test.ts 2>/dev/null | grep -cE "^\s*(it|test)\s*\(")
   AFTER=$(grep -cE "^\s*(it|test)\s*\(" server/lib/coordinator.test.ts)
   [ "$((AFTER - BEFORE))" -ge 2 ]
   ```
   (The test body must invoke `checkTimeBudget(undefined, <maxTimeMs>, <non-empty records>)` and assert `elapsedMs > 0`. Executor picks the exact shape.)

6. **AC-6** — Full test suite still green; test count meets or exceeds master baseline of 776:
   ```bash
   mkdir -p tmp && MSYS_NO_PATHCONV=1 npx vitest run --reporter=json --outputFile=tmp/v033-1-full.json > /dev/null 2>&1 || true
   node -e "const r=require('./tmp/v033-1-full.json'); if (r.numFailedTests === 0 && r.numPassedTests >= 776) process.exit(0); console.error('tests: ' + r.numPassedTests + ' passed / ' + r.numFailedTests + ' failed'); process.exit(1);"
   ```

7. **AC-7** — Changes confined to the fix surface (no drive-by edits):
   ```bash
   git diff --name-only master...HEAD | grep -vE '^(server/lib/coordinator\.ts|server/lib/coordinator\.test\.ts|\.ai-workspace/plans/2026-04-20-coordinator-zero-emit-fix\.md|scripts/v033-1-acceptance\.sh)$' | wc -l | awk '$1 == 0 { exit 0 } { exit 1 }'
   ```

8. **AC-8** — Acceptance wrapper exists, is executable, and passes end-to-end:
   ```bash
   test -x scripts/v033-1-acceptance.sh && bash scripts/v033-1-acceptance.sh | tail -1 | grep -q 'ALL V0.33.1 ACCEPTANCE CHECKS PASSED'
   ```

## Out of scope

1. The underlying `/ship` Stage 7 CHANGELOG H1-prepend bug (tracked as ai-brain-level issue #362; accept the known H1-drift on this release — a future cumulative release will relocate the H1).
2. The dashboard renderer's conflation of `warningLevel: "unknown"` vs `"none"` (queued as v0.34.x dashboard-polish follow-up; the current fix eliminates most `"unknown"` cases by providing a records-derived elapsed time, which already narrows the renderer issue's blast radius).
3. The misleading `anthropic.ts:70-71` "OAuth only works when proxied" comment (separate v0.34.x task #113).
4. Refactoring `coordinator.ts` further — do NOT extract the L1074-1077 earliest-timestamp logic into a shared helper in this PR (the inline duplication keeps the diff tight; consolidation can come with the v0.34.x bundle if the pattern grows a third use).
5. Any change to the `BudgetInfo` / `TimeBudgetInfo` return types or field names — pure internal behavior fix.
6. Package version bump and CHANGELOG edit — `/ship` Stage 7 will handle these during the release. Do NOT pre-bundle them in this PR.
7. All other v0.34.x backlog items (#347-#350, #352, #353, #355, #357-#359, #361, #363, #364, #113 OAuth comment, #111 forge_status proposal).

## Verification procedure

Reviewer runs `bash scripts/v033-1-acceptance.sh` from repo root. The script runs AC-1 through AC-8 in order and exits 0 iff all pass. Print-on-pass: `ALL V0.33.1 ACCEPTANCE CHECKS PASSED`.

## Critical files

- `server/lib/coordinator.ts` — the two functions at L892-958. Only the two function bodies change; no new exports, no new imports, no signature changes for `checkBudget`; `checkTimeBudget` gains one optional parameter.
- `server/lib/coordinator.test.ts` — add at least one new test per bug; existing tests must continue to pass unchanged.
- `scripts/v033-1-acceptance.sh` — new acceptance wrapper. Must be executable (`chmod +x`). Uses `set -euo pipefail` + `export MSYS_NO_PATHCONV=1` for Windows MSYS safety.
- `.ai-workspace/plans/2026-04-20-coordinator-zero-emit-fix.md` — this file (allowlisted in AC-7).

## Checkpoint

- [x] Monday's claims re-verified against master (L892-931, L938-942, L1074-1077 all confirmed)
- [x] Single call site for each function confirmed (coordinator.ts:681-682)
- [x] Existing tests reviewed — both fixes are additive, no test-breakage expected
- [x] Plan written with 8 binary AC
- [ ] `/coherent-plan` review
- [ ] `/delegate --via subagent` to executor
- [ ] Executor returns "branch ready + wrapper green"
- [ ] `/ship` — PR + stateless review + merge + tag v0.33.1 + release

Last updated: 2026-04-20T11:25:00+00:00
