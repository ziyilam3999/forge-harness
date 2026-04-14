---
date: 2026-04-13
issue: #168
scope: Q0.5 closure blocker
---

# #168 — computeVerdict SKIPPED+suspect aggregation fix

## ELI5
Today, if the AC-lint flags every check as "don't trust this, it's broken", the evaluator throws its hands up and says "well, nothing failed, so PASS!". That's obviously wrong — we didn't prove anything worked, we just didn't run it. Fix: treat suspect-skipped checks as "I don't know" (INCONCLUSIVE), not "yes" (PASS).

## Root cause
`server/lib/evaluator.ts:96-106` — `computeVerdict` only checks for FAIL and INCONCLUSIVE statuses. SKIPPED is ignored, so a story where every AC was short-circuited by ac-lint falls through to PASS.

The existing test at `evaluator.test.ts:154` asserts criterion status/reliability but NEVER asserts `report.verdict` — which is how the bug shipped.

## Fix
Add a suspect-skip check at the tail of `computeVerdict`:

```ts
const hasSuspectSkip = criteria.some(
  (c) => c.status === "SKIPPED" && c.reliability === "suspect",
);
if (hasSuspectSkip) return "INCONCLUSIVE";
```

Priority order stays: FAIL > INCONCLUSIVE > suspect-skip → INCONCLUSIVE > PASS.

## Test Cases & AC (binary)
- [ ] `computeVerdict` on `[{SKIPPED, suspect}]` → returns `"INCONCLUSIVE"` (not PASS)
- [ ] `computeVerdict` on `[{PASS, trusted}, {SKIPPED, suspect}]` → returns `"INCONCLUSIVE"`
- [ ] `computeVerdict` on `[{FAIL}, {SKIPPED, suspect}]` → returns `"FAIL"` (hard fail wins)
- [ ] `computeVerdict` on `[{INCONCLUSIVE}, {SKIPPED, suspect}]` → returns `"INCONCLUSIVE"`
- [ ] `computeVerdict` on `[{PASS, trusted}, {PASS, trusted}]` → still `"PASS"` (regression)
- [ ] Existing A1b test at `evaluator.test.ts:154` extended to also assert `report.verdict === "INCONCLUSIVE"`
- [ ] `npm run build` exits 0
- [ ] `npm test` — all 640+ tests pass, zero regressions
- [ ] `npm run lint` exits 0

## Checkpoint
- [ ] Edit `server/lib/evaluator.ts` — add suspect-skip branch to `computeVerdict`
- [ ] Edit `server/lib/evaluator.test.ts` — add 4 aggregation tests + extend A1b suspect test
- [ ] Build + test + lint green
- [ ] Stateless cold review
- [ ] /ship with `plan-refresh: no-op`
- [ ] Round-2 ping to forge-plan

Last updated: 2026-04-13T11:50:00+08:00
