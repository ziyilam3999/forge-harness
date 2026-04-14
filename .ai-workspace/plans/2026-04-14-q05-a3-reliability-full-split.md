# Q0.5/A3 — CriterionResult.reliability full split + divergence forward-split

**Task #13.** Owner: swift-henry (implementer). Grounded directly in the current code on `master` (post-v0.28.0 / PR #183 merged). Phase 1 scope-gate rounds with forge-plan are **complete** — thread `q05-a3` T1510 blessed narrow scope, T1545 blessed Option 2 detection semantics.

## Context

`CriterionResult.reliability` was introduced half-shipped in Q0.5/A1b+C2 with the two-value union `"trusted" | "suspect"` at `server/types/eval-report.ts:29`. The type JSDoc explicitly reserves a third value `"unverified"` for the `lintExempt` override path, stating **"A1 ships only the trusted/suspect split. [...] the full A3 PR will add a third 'unverified' value"**. A3 closes that prefabricated slot.

Two distinct gaps close in this PR:

1. **Schema gap — Option 2 detection.** An AC whose command triggers a subprocess-safety deny-list rule AND whose per-AC `lintExempt` entry FIRED (the exemption actually suppressed a real finding — `lint.findings.some(f => f.exempt === true)`) currently gets `reliability: "trusted"` at `server/lib/evaluator.ts:140`, which is a lie. The safety gate was real and the author overrode it; the correct tag is `"unverified"`. **Vestigial** `lintExempt` entries — declared but never matched — stay `"trusted"` (AC-A3-02b pins this). **Plan-level** `ExecutionPlan.lintExempt[]` (scope "plan") stays `"trusted"` by construction, deferred to Q0.5/A3-bis. Per T1545, the detection rule is `lint.findings.some(f => f.exempt === true)`, NOT `ac.lintExempt !== undefined`.

2. **Divergence-handler gap** — `handleDivergenceEval` (`server/tools/evaluate.ts:398-407`) currently lumps **every** FAIL/INCONCLUSIVE criterion into `forwardDivergences` with no reliability tag. A suspect (ac-lint-skipped) AC and a trusted (real failure) AC land in the same bucket. Task #13 description says explicitly: *"Divergence mode splits real vs suspect failures."* The fix: propagate `reliability` into `ForwardDivergence` so downstream consumers can filter.

## Scope resolution — RESOLVED (thread q05-a3)

Task #13 second sentence mentions *"Dual-trigger refresh: C1c (prompt/rules change) OR 14-day calendar"* — a refresh-cadence tool that is **orthogonal** to the type work. Resolved by forge-plan T1510: **(a) NARROW A3**, ship schema + divergence split only. The refresh tool is deferred to **Q0.5/A3-bis** (dual-trigger refresh, separate PR after A3 merges).

Detection semantics resolved by T1545: **Option 2 (per-AC fired exemption only)**. Options 1 (any presence) and 3 (full coverage including plan-level) were rejected — Option 1 noisy, Option 3 violates AC-A3-10 negative-space by forcing edits into `server/validation/ac-lint.ts`. Vestigial exemptions stay `"trusted"`, plan-level absorptions stay `"trusted"`, only fired per-AC exemptions flip to `"unverified"`.

## Files and code anchors

| File | Anchor | Action |
|---|---|---|
| `server/types/eval-report.ts` | line 29 | MODIFY — extend union to `"trusted" \| "suspect" \| "unverified"`; rewrite JSDoc **verbatim per T1545 text** (documents fired-exemption semantics, plan-level exclusion, Q0.5/A3-bis deferral reference). The JSDoc currently committed on the branch was written from the pre-T1545 draft and MUST be re-rewritten before PR-open |
| `server/lib/evaluator.ts` | lines 136-141 (normal path) + 127-132 (flaky-retry trusted path) | MODIFY — retain the `lint` local from line 69 through the push site and emit `reliability: lint.findings.some(f => f.exempt === true) ? "unverified" : "trusted"`. **Option 2 semantics** (per forge-plan T1545): a per-AC `lintExempt` entry must have ACTUALLY FIRED (suppressed a real finding) for this run to count as unverified. Vestigial exemptions (declared but never matched) stay `"trusted"`. Plan-level `ExecutionPlan.lintExempt[]` (scope "plan") is OUT OF SCOPE — those ACs report "trusted" by construction, with plan-level coverage deferred to Q0.5/A3-bis |
| `server/lib/evaluator.ts` | lines 46-58 (warnings) | MODIFY — push an entry to `warnings[]` when any criterion has `reliability: "unverified"` |
| `server/lib/evaluator.ts` | lines 159-180 (`computeVerdict`) | NO CHANGE — see decision table below. `unverified` is a soft signal, never downgrades verdict |
| `server/types/divergence-report.ts` | lines 6-11 (`ForwardDivergence`) | MODIFY — add `reliability?: "trusted" \| "suspect" \| "unverified"` (optional for backward compat) |
| `server/tools/evaluate.ts` | lines 398-407 (divergence forward loop) | MODIFY — copy `criterion.reliability` into `ForwardDivergence` entries |
| `server/tools/evaluate.ts` | lines 525-528 (summary string) | MODIFY — summary reports `N trusted / M suspect / K unverified` instead of a single count |
| `server/lib/generator.ts` | lines 118-124 (`buildFixBrief`) | NO CHANGE — generator trusts upstream classification. Flag as future work if dogfood shows noisy fix briefs |
| `server/tools/evaluate.test.ts` | `makeEvalReport` + divergence tests | ADD tests — see AC list below |
| `server/lib/evaluator.test.ts` (if exists) | — | UPDATE — any fixture asserting `reliability: "trusted"` on a `lintExempt` AC flips to `"unverified"` |
| `.ai-workspace/plans/2026-04-14-q05-a3-reliability-full-split.md` | — | CREATE — persistent plan file (this `.claude/plans/` file is ephemeral) |

### `computeVerdict` decision table — why `unverified` does NOT change verdict semantics

| criterion has | current rule | A3 rule |
|---|---|---|
| any FAIL | → FAIL | → FAIL (unchanged) |
| any INCONCLUSIVE (no FAIL) | → INCONCLUSIVE | → INCONCLUSIVE (unchanged) |
| any SKIPPED+suspect | → INCONCLUSIVE | → INCONCLUSIVE (unchanged) |
| any PASS+unverified (otherwise clean) | → PASS | **→ PASS + warning** in `EvalReport.warnings[]` |
| all clean | → PASS | → PASS (unchanged) |

`lintExempt` is an intentional author choice. Downgrading its verdict would effectively remove the escape hatch. Surfacing a warning is the right middle ground: caller can count unverified-PASS rates over time without the signal blocking the pipeline.

## Test cases & acceptance criteria

All ACs are binary.

| AC | Verify |
|---|---|
| **AC-A3-01** | `grep -c '"unverified"' server/types/eval-report.ts` ≥ 1 |
| **AC-A3-02** | `evaluateStory` with 1 AC whose command matches a real deny-list rule (e.g., contains a subprocess-safety pattern) AND carries a `lintExempt: [{ruleId: <that rule>, rationale: ...}]` entry that FIRES and suppresses the finding → `criteria[0].reliability === "unverified"` AND `status === "PASS"` (command executes, exemption was real) |
| **AC-A3-02b** | **Vestigial-exemption negative test (pins Option 2 vs Option 1).** `evaluateStory` with 1 AC carrying a `lintExempt` entry whose `ruleId` does NOT match any finding in the run (e.g. command is `"echo ok"`, exemption declares a rule that won't trip) → `criteria[0].reliability === "trusted"` (exemption was vestigial, never fired, so tag stays trusted) |
| **AC-A3-03** | `evaluateStory` with 1 AC whose command matches a deny-list rule AND carries a firing `lintExempt` entry AND the command exits non-zero → `reliability === "unverified"` AND `status === "FAIL"` (tag survives failure) |
| **AC-A3-04** | `evaluateStory` with 1 AC carrying NO `lintExempt` field at all, running `"echo ok"` → `criteria[0].reliability === "trusted"` (backward compat — clean ACs with no override never tag unverified) |
| **AC-A3-05** | `ForwardDivergence` interface includes optional `reliability?` field — `tsc --noEmit` passes with a test file constructing `{...rest, reliability: "unverified"}` |
| **AC-A3-06** | `handleDivergenceEval` fixture with 3 failing ACs (1 trusted-FAIL, 1 suspect-SKIPPED, 1 unverified-FAIL) → `forward[]` entries each carry the correct `reliability` matching the source criterion |
| **AC-A3-07** | `DivergenceReport.summary` on AC-A3-06 fixture contains substrings `"trusted"` AND `"suspect"` with numeric counts |
| **AC-A3-08** | `EvalReport.warnings[]` contains at least one entry matching `/unverified/i` when any criterion has `reliability: "unverified"` |
| **AC-A3-09** | `npx vitest run` exit 0, zero regressions |
| **AC-A3-10** | `git diff --stat master` touches ONLY the files listed above. No drift into `coordinate.ts`, `plan.ts`, critic-eval, smoke-test, MEMORY.md |

## Implementation order (binary, do not reorder)

### Phase 1 — Scope confirmation (GATE) — ✅ DONE

1. ✅ Mail forge-plan scope gate T1455 — reply T1510 blessed (a) narrow + flaky-wins corner case.
1b. ✅ Phase 3 surprise escalation T1535 (`lintExempt` is not a boolean) — reply T1545 blessed Option 2 (fired exemption only) + verbatim JSDoc text + new AC-A3-02b.

### Phase 2 — Schema change

2. ✅ `git checkout master && git pull && git checkout -b feat/q05-a3-reliability-full-split`
3. **Edit `server/types/eval-report.ts:29` — replace current JSDoc with T1545 verbatim text.** The union extension is already committed; only the JSDoc body needs re-rewriting. T1545 text documents: fired-exemption semantics, vestigial exemptions stay trusted, plan-level `ExecutionPlan.lintExempt[]` (scope "plan") is out-of-scope and reports "trusted" by construction, plan-level coverage deferred to Q0.5/A3-bis.
4. `npx tsc --noEmit` — JSDoc-only rewrite compiles clean by construction.

### Phase 3 — Producer side (evaluator.ts)

5. Read `server/lib/evaluator.ts` end-to-end. Note the push sites: ac-lint short-circuit (lines 75-81), flaky-retry-suspect PASS (lines 108-113), flaky-retry-trusted non-PASS (lines 127-132), normal path (lines 136-141). The `lint` local is computed at line 69 and currently discarded for non-suspect ACs — Phase 3 needs to retain it through to the push sites.
6. Extend the normal-path push (136-141) with **Option 2 detection** (per forge-plan T1545):
   ```ts
   const exemptionFired = lint.findings.some(f => f.exempt === true);
   const reliability: "trusted" | "unverified" = exemptionFired ? "unverified" : "trusted";
   ```
   emit `reliability` on the push. The `lint` variable already exists in scope from line 69 — no new computation.
7. Extend the flaky-retry-trusted non-PASS push (127-132) identically using the same `exemptionFired` derivation.
8. **Leave the ac-lint-short-circuit path UNTOUCHED** — it's `"suspect"`, not `"unverified"`. ACs whose `lintExempt` entries clear every finding never reach this block (they fall through to executeCommand with `lint.suspect === false`).
9. **Leave the flaky-retry-suspect PASS push UNTOUCHED** — `flaky-retry suspect` has different semantics from `lintExempt unverified`; both can coexist. If both conditions apply simultaneously (flaky AC whose exemption also fired), ship `"suspect"` (flaky wins per T1510 — runtime instability outranks successful override). Document in commit message.
10. After the evaluator loop:
    (a) if `criteria.some(c => c.reliability === "unverified")`, push an aggregate warning: `"${count} AC(s) ran with a fired lintExempt override — reliability is unverified"`.
    (b) **Dual-flag dedicated warning** (per T1510 blessed, T1545 clarified): for each AC where `ac.flaky === true` AND `lint.findings.some(f => f.exempt === true)` — i.e. the exemption ACTUALLY fired — push a per-AC warning with precise T1545 text: `"AC '${ac.id}' has flaky: true AND a lintExempt entry whose exemption fired during this run — reporting as suspect (flake takes precedence). Override review recommended."` NOT rolled up, so analytics can grep `/flaky.*lintExempt|lintExempt.*flaky/i` to find degraded-confidence ACs. The `"whose exemption fired during this run"` qualifier is load-bearing — it documents Option 2 semantics inline.
11. `npx vitest run server/lib` — fix any fixture assertions that hardcoded `reliability: "trusted"` on `lintExempt` ACs.

### Phase 4 — Divergence-handler split

12. Edit `server/types/divergence-report.ts:6-11` — add optional `reliability?` field.
13. Edit `server/tools/evaluate.ts:398-407` — pass `criterion.reliability` through in the forward push.
14. Edit summary construction at `server/tools/evaluate.ts:525-528` — compute `trustedCount / suspectCount / unverifiedCount` and emit them.

### Phase 5 — Tests

15. Add test block in `server/tools/evaluate.test.ts` for AC-A3-02 through AC-A3-08. Reuse `makeEvalReport`. For divergence-split tests, mock `evaluateStory` to return mixed-reliability criteria.
16. `npx vitest run` — full suite green.

### Phase 6 — Ship

17. `npm run build` clean.
18. `git diff --stat master` matches AC-A3-10 allowlist.
19. `/ship` (plan-refresh: `no-op`).
20. Mail forge-plan with merge SHA for round-0 review.
21. Address round-0 findings if any, merge, update Q0.5 tally.

## Verification (post-merge, end-to-end)

1. `git checkout master && git pull`
2. `grep '"unverified"' server/types/eval-report.ts` → ≥ 1 match
3. `npx vitest run` → full suite green
4. `npm run build` → exit 0
5. **Live MCP smoke test** (requires session restart per F54): author a two-story plan. Story A = clean AC with no `lintExempt`. Story B = AC whose command contains a real subprocess-safety pattern (so ac-lint would normally flag it) AND carries a firing `lintExempt: [{ruleId: <matched rule>, rationale: ...}]` entry. Run `forge_evaluate mode: "divergence"`. Confirm (a) `forward[]` is empty (both pass), (b) `warnings[]` mentions "unverified" for Story B's fired exemption, (c) Story B's criterion has `reliability: "unverified"` in the RunRecord audit, Story A's has `"trusted"`.
6. **Negative test — failing case:** same plan shape, but Story B's command exits non-zero. Confirm `forward[]` has the failing criterion with `reliability: "unverified"` and summary reports `0 trusted / 0 suspect / 1 unverified`.
7. **Vestigial-exemption regression test (pins Option 2):** third plan where Story B's AC runs `"echo ok"` AND carries a `lintExempt` entry whose `ruleId` matches nothing in the actual command. Confirm Story B's criterion has `reliability: "trusted"` (NOT `"unverified"`). This mirrors AC-A3-02b at runtime.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `computeVerdict` bikeshed drags the PR | LOW | Decision table pins answer: unverified is a warning, never downgrades verdict |
| Existing evaluator tests hardcode `reliability: "trusted"` on `lintExempt` ACs | LOW-MED | Phase 3 step 11 catches this; fixture updates are trivial |
| ~~Forge-plan wants wide A3~~ | ~~MED~~ | **RESOLVED T1510** — narrow blessed. Refresh tool deferred to Q0.5/A3-bis |
| `ForwardDivergence` schema change breaks unknown consumer | LOW | Grep confirmed only `evaluate.ts` produces/consumes. Optional field is additive |
| `flaky + lintExempt` corner case: which wins? | LOW | Step 9 pins it: flaky wins (runtime signal > authoring choice). Documented in commit |
| F54 MCP stale dist after rebuild | LOW | Verification step 5 requires session restart — captured in the verification list, not a surprise |
| Option 2 blind spot: plan-level `ExecutionPlan.lintExempt[]` absorptions never tag `unverified` | LOW | Plan-level is bootstrap absorption by design (one-shot clearing house, not an ongoing override pattern). Deferred coverage tracked as Q0.5/A3-bis (dual-trigger refresh tool). If post-merge analytics reveal plan-level hiding real risk, widening Option 2→3 is a purely additive ~30-line follow-up |
| Option 2 regression — future refactor slides back to Option 1 (declared-not-fired flags unverified) | LOW | AC-A3-02b negative test pins semantics: vestigial exemption must stay `"trusted"`. Any slide breaks the test immediately |

## Files NOT to touch (AC-A3-10 negative-space)

- `server/tools/coordinate.ts`, `server/tools/generate.ts`, `server/tools/plan.ts`, `server/tools/reconcile.ts`
- Any `server/tools/evaluate.ts` handler OTHER than `handleDivergenceEval` (story handler propagates naturally via the evaluator return value — no code change there)
- `server/lib/prompts/*`, `server/validation/ac-lint.ts` — **REAFFIRMED T1545** Option 3 (extending `LintResult` with `droppedByPlanLevel`) was specifically rejected to preserve this line. Plan-level coverage deferred to Q0.5/A3-bis
- `server/lib/generator.ts` (flagged as "consider" but A3 takes no change)
- `scripts/*`, `.claude/settings.json`, `.github/workflows/*`
- `MEMORY.md`

## Checkpoint

- [x] Phase 1 — mail forge-plan scope question (T1455 sent, T1510 reply: narrow blessed)
- [x] Phase 1b — Phase 3 surprise escalation (T1535 sent, T1545 reply: Option 2 blessed + JSDoc text + AC-A3-02b)
- [x] Phase 2.2 — branch cut `feat/q05-a3-reliability-full-split`
- [x] Phase 2.3 — eval-report.ts union extended (JSDoc rewrite **pending** T1545 text replacement in Phase 3.5b below)
- [x] Phase 2.4 — tsc --noEmit clean
- [x] Phase 3.5 — evaluator.ts read-through
- [ ] Phase 3.5b — replace eval-report.ts JSDoc with T1545 verbatim text
- [ ] Phase 3.6 — normal-path fired-exemption → unverified (Option 2 detection)
- [ ] Phase 3.7 — flaky-retry-trusted non-PASS fired-exemption → unverified
- [ ] Phase 3.10 — warnings[] push for any unverified count
- [ ] Phase 3.11 — evaluator vitest green (fixture updates as needed)
- [ ] Phase 4.12 — ForwardDivergence.reliability optional field
- [ ] Phase 4.13 — forward-loop reliability propagation
- [ ] Phase 4.14 — summary string split counts
- [ ] Phase 5.15 — AC-A3-02..08 test block added
- [ ] Phase 5.16 — full vitest green
- [ ] Phase 6.17 — npm run build clean
- [ ] Phase 6.18 — negative-space audit
- [ ] Phase 6.19 — /ship pipeline
- [ ] Phase 6.20 — merge-SHA round-0 mail
- [ ] Phase 6.21 — round-0 findings, Q0.5 tally update

Last updated: 2026-04-14T15:55 (post-T1545 Option 2 bless; Phase 1+1b DONE; Phase 2 DONE except JSDoc rewrite; ready to resume Phase 3.5b).
