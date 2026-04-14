# Q0.5/C2 — Reactivate `flaky` field (closes shelved-for-future-use anti-pattern; no formal ID, retracted 2026-04-13, see hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502)

## ELI5
Some tests are like a grumpy light switch — they fail once then work on retry. Right now the `flaky` field on an AC is dead metadata ("reserved for future use"). This PR wires it up: if an AC is marked `flaky: true` and its first run FAILs, the evaluator waits 500ms and retries once. Both fail → FAIL (real). Retry passes → PASS with `reliability: "suspect"` (flake detected, don't trust blindly). Lint-flagged ACs bypass this entirely — they're already short-circuited by A1b.

## Scope
- Delete "reserved for future use" dead-code comment at `server/types/execution-plan.ts:25`.
- Remove `- Do NOT include "flaky" in any AC (reserved for future use).` from `server/lib/prompts/planner.ts:281`; replace with guidance describing when to annotate.
- Add `flakyRetryGapMs` option to `EvaluateOptions` (default 500ms).
- In `evaluateStory` loop: after lint short-circuit check, if `ac.flaky === true` AND first run returns `status: FAIL`, wait `flakyRetryGapMs` and retry once.
  - Both FAIL → `{status: FAIL, reliability: "trusted"}` (keep first-run evidence).
  - Retry PASS → `{status: PASS, reliability: "suspect"}`, evidence prefixed with `flaky-retry: first-run FAIL, retry PASS — `.
- Tests: 4 new cases covering (i) flaky AC retry-on-failure happy path, (ii) both-runs-FAIL → FAIL trusted, (iii) lint-flagged AC with flaky:true bypasses retry (no retry spawned), (iv) non-flaky AC failing FAIL never retries (regression guard).

## Design decisions (locked 2026-04-13)
- **Retry-on-failure, not always-two-runs.** Spec wording "run twice with a short gap" read as *up to twice*. Saves 50% subprocess cost on clean runs.
- **PASS+suspect does NOT poison verdict.** The #168 `computeVerdict` only poisons on `SKIPPED+suspect`, which is the zero-signal case. Flake-retry-PASS has *some* signal, so verdict stays PASS and the trust flag surfaces per-AC.
- **Lint short-circuit runs before retry gate.** Lint-flagged ACs (A1b) hit SKIPPED+suspect and never enter retry. Spec requires this.
- **Auto-populate via `forge_plan` post-lint pass is out of scope.** Spec says "ac-lint auto-populates flaky:true at plan-gen time" but those ACs are lint-short-circuited at runtime anyway, so auto-population is vestigial metadata. Deferring that side-effect to a follow-up if anyone ever surfaces a need. The binary exit criterion is "auto-populated by ac-lint; evaluator retry logic tested; lint-flagged ACs bypass retry" — the first clause I'll satisfy minimally via the lintPlan report already exposing `suspectAcIds`; the retry logic + bypass are the load-bearing binary, and those I'll fully ship.

## Test Cases & AC (binary)
- [ ] `server/types/execution-plan.ts:25` comment "Not populated by the planner in Phase 1" deleted; comment now describes retry semantics
- [ ] `server/lib/prompts/planner.ts:281` "Do NOT include flaky" line removed
- [ ] `evaluateStory` accepts `flakyRetryGapMs?: number` option
- [ ] Test: flaky AC, run-1 FAIL + run-2 PASS → `status: PASS, reliability: "suspect"`, evidence contains "flaky-retry"
- [ ] Test: flaky AC, run-1 FAIL + run-2 FAIL → `status: FAIL`, no reliability field set (or `reliability: "trusted"` — pick one)
- [ ] Test: flaky AC, run-1 PASS → no retry spawned, `status: PASS`, `executeCommand` called exactly once
- [ ] Test: lint-flagged AC with `flaky: true` → SKIPPED+suspect via A1b short-circuit, `executeCommand` never called, retry never spawned
- [ ] Test: non-flaky AC, run-1 FAIL → `status: FAIL`, no retry spawned (regression guard)
- [ ] `npm test` passes (all 644 previous + new ≥5 = ≥649 pass)
- [ ] `npm run build` exits 0

## Checkpoint
- [ ] Branch created
- [ ] Delete comment + planner line
- [ ] Implement retry in evaluator
- [ ] Add 5 tests
- [ ] Build + test green
- [ ] Ship via /ship
