# Fix #189 (v2): derive handleCriticEval RunRecord outcome from results.error

## ELI5
When the critic runs evaluations on a batch of plans, the record it writes currently always says "success" — even if every plan errored. This is a lie in the data. The fix reads each plan's error field and sets the outcome to "failure" (all errored), "partial" (some errored), or "success" (none errored). Also widens the type to allow those two new outcome values — it previously only allowed API-level outcomes like "timeout" and "api-error".

## Context
- Issue #189 (forge-harness): handleCriticEval buildRunRecord hardcodes `outcome: "success"` even when every plan errored. Downstream SQL index consumers cannot distinguish clean sweep from fully-failed sweep.
- Prior attempt: PR #220 (branch fix/housekeep-189) — 9 days old, failed CI with TS2322 because it used new outcome values without widening the union. Closed in favor of this v2.
- Precedent: #313 widened the union to include "corrector-failed" — same pattern applies here.

## Goal
- `handleCriticEval` sets outcome based on per-result errors, not hardcoded "success"
- Type union accepts "failure" and "partial"
- No regression to existing outcome consumers (all check `typeof === "string"`, no enum match)
- dist/ rebuilt in sync with source/

## Binary AC
1. `npm run build` exits 0 (TS compiler accepts the derivation).
2. `npm test -- --run server/tools/evaluate-critic.test.ts server/lib/run-record.test.ts` exits 0.
3. `git show HEAD:server/lib/run-record.ts | grep -c '"partial"'` returns ≥ 1.
4. `git show HEAD:server/tools/evaluate.ts | grep -c 'results.every.*error'` returns ≥ 1.

## Out of scope
- Dashboard / coordinator consumers of outcome — none case-match on the enum today; widening is safe.
- Renaming `outcome` to `sweepOutcome` — orthogonal, would be a larger design change.

## Critical files
- `server/lib/run-record.ts:70` — type union declaration.
- `server/tools/evaluate.ts:~740` — handleCriticEval's writeRunRecord call site.

## Checkpoint
- [x] Edit run-record.ts union
- [x] Edit evaluate.ts handleCriticEval outcome derivation
- [x] `npm run build` passes
- [x] Tests pass
- [ ] Commit
- [ ] Push + PR
- [ ] /ship review + merge
- [ ] Close PR #220 as superseded

Last updated: 2026-04-24
