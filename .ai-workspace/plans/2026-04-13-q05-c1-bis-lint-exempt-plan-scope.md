# Q0.5/C1-bis — plan-level `lintExempt` (Option B re-decided → Option A executed)

> **Type:** Implementation plan + shipping record for C1-bis, the schema-first prerequisite for C1's hook conversion.
>
> **Parent plans:**
> - `.ai-workspace/plans/2026-04-12-next-execution-plan.md` (Q0.5 execution roadmap)
> - `.ai-workspace/plans/2026-04-13-q05-c1-ac-lint-hook-conversion.md` (C1 hook plan — parked until C1-bis lands)
>
> **Author:** forge-plan (planner) → swift-henry (implementer).
>
> **Branch:** `feat/q05-c1-bis-grandfather-schema`

## ELI5

The repo has 9 plan files carrying 245 old lint findings — author-era paranoia that grep'd stdout instead of using exit codes. Those findings are accumulated from when `ac-lint.yml` ran in advisory-only mode and never blocked anything. Q0.5/C1 flips the linter from advisory to blocking (via a PostToolUse hook). Before flipping, we need a way to silence the 245 pre-existing findings in one auditable move without changing per-AC governance.

C1-bis adds a plan-level `lintExempt` variant that drops specific enumerated rule IDs (e.g. `F36-source-tree-grep`) from `lintPlan()`'s report when the plan file carries a top-level batch entry. This is distinct from per-AC `lintExempt`, which stays capped at 3 per plan and still counts for governance.

Then C1-bis applies one `2026-04-13-c1-bootstrap` batch to the 9 affected files, and — because 4 residual findings surfaced outside the batch's rules — fixes 4 ACs inline by dropping the count-based grep in favor of raw `npx vitest run` exit codes. End result: 245 → 0 findings, and the schema is ready for C1 to ship the hook.

## Context

### Decision history

- **T2045** — forge-plan's first Option B draft proposed a new parallel field `lintGrandfathered`. Rejected mid-thread: it duplicated `lintExempt` machinery without grep-ing the existing module first (F65 admission).
- **T2115** — Option B corrected: reuse `lintExempt` as a discriminated union (`scope: "plan"` vs absent). Plan-level drops findings (bootstrap absorption); per-AC flags them (audit trail). Two separate accounting buckets, per-AC 3-cap preserved.
- **T2155** — "ack, go" from forge-plan: items 1–7 in swift-henry's T2145 ack were verbatim-correct.
- **T2205** — swift-henry STOP: sweep dropped 245 → 4, but the 4 residuals were outside the batch (`F55-vitest-count-grep` ×3 + `F56-multigrep-pipe` ×1). Three options presented to forge-plan.
- **T2210** / **T2215 (superseding)** — Option A: extend batch with `F56-multigrep-pipe`, fix 3 F55 ACs inline using F55's own remediation text. T2215 corrected T2210's wrong hook-parking schedule and wrong F55 fix syntax suggestion.

### Architectural intent

Plan-level `lintExempt` is for **bootstrap absorption** — "this drift already exists; we are quarantining it so we can ship the blocking hook." It is NOT a general escape hatch:

- **Rule-scoped**: every batch entry enumerates rule IDs from `AC_LINT_RULES`. No wildcards, no `*`.
- **Batch-tagged**: every entry carries a `batch: "YYYY-MM-DD-context"` string. One grep unwinds an entire batch.
- **Unbounded count but constrained power**: no cap on how many plan-level entries exist, but each is limited to listed rule IDs with non-empty rationale. Cap-creep threat model is per-AC, handled by the existing `GOVERNANCE_CAP = 3`.

New drift uses per-AC `lintExempt` (still 3-capped) or a real AC rewrite. **C1-bis is not a precedent** — it is a one-shot baseline, enforced going forward by C1's retroactive-critique hook.

## Binary Acceptance Criteria

- [x] **C1bis-AC-01** — `server/validation/ac-lint.ts` supports plan-level `lintExempt`:
  - New `LintExemptPlan` interface: `{ scope: "plan"; rules: string[]; batch: string; rationale: string }`
  - `LintablePlan.lintExempt?: LintExemptPlan[]` field
  - `validateAndCollectPlanLevelExempts()` normalizer throws on: non-array, non-"plan" scope, empty/non-string rules, rule id not in `AC_LINT_RULES`, empty/missing batch, empty/missing rationale
  - `lintPlan()` drops findings whose `ruleId` is in the union of plan-level exempted rules (additive to per-AC filter, not a replacement)
  - New `lintExemptPlanEntriesCount` field on `LintPlanReport`; does NOT feed `governanceViolation`
  - **Verification:** file contains all the above, `npx vitest run server/validation/ac-lint.test.ts` exits 0.

- [x] **C1bis-AC-02** — ≥8 unit tests in `server/validation/ac-lint.test.ts` covering:
  - (a) baseline: plan without `plan.lintExempt` lints normally
  - (b) plan-level F36 entry drops F36 findings but still surfaces F56 in same plan
  - (c) plan-level AND per-AC: per-AC 3-cap still applies; plan-level does NOT contribute to cap
  - (d) empty `rules` → throws
  - (e) unknown rule id → throws
  - (f) missing `batch` → throws
  - (g) missing `rationale` → throws
  - (h) multiple plan-level entries with different batches → union of rules applies
  - Plus (i) `scope !== "plan"` → throws
  - **Verification:** 9 new tests, 47/47 total pass.

- [x] **C1bis-AC-03** — All 9 affected plan files carry the batch, all residual findings resolved:
  - `lintExempt` entry at plan root: `{scope:"plan", rules:["F36-source-tree-grep","F56-passed-grep","F56-multigrep-pipe"], batch:"2026-04-13-c1-bootstrap", rationale:"..."}` applied to 9 files
  - 4 ACs in `forge-coordinate-phase-PH-01.json` (`PH01-US-06-AC01/02/03/06`) rewritten from `| grep -qE 'Tests[[:space:]]+[N-9]'` / `| grep -q 'passed' && ! grep -q 'failed'` to plain `npx vitest run [file]` (exit-code verification, per F55's own remediation principle "exit code over parsed stdout")
  - Corresponding AC descriptions for PH01-US-06-AC01/02/03 updated from "has at least N passing tests" to "passes (exit 0)" to reflect the relaxed-but-more-robust contract
  - **Verification:** `node scripts/run-ac-lint.mjs` reports `0 with findings, 0 total findings, 0 suspect AC(s), 0 governance violation(s)` across all 9 files.

- [x] **C1bis-AC-04** — `server/types/execution-plan.ts` carries a byte-identical `LintExemptPlan` type mirror + `ExecutionPlan.lintExempt?: LintExemptPlan[]` field. Kept separate from `ac-lint.ts` to keep the types module dependency-free.

- [x] **C1bis-AC-05** — Full test suite green: `npx vitest run` reports `683 passed, 4 skipped` (baseline-matching). Zero regressions in the 34 other test files.

## Governance cap preservation

Per forge-plan's T2115 directive, the C1-bis plan file explicitly records:

- The per-AC `lintExempt` 3-cap (Q0.5/A1) is **unchanged**. `governanceViolation = lintExemptCount > 3` still triggers only on per-AC entries. Plan-level entries are tracked in a separate count (`lintExemptPlanEntriesCount`) that does NOT contribute to `governanceViolation`.
- Plan-level entries are schema-constrained: required `batch`, required `rationale`, `rules` must be non-empty and contain only known rule IDs. Wildcard or unbounded silencing is schema-rejected (no `*` allowlist bypass, no missing-field drift).
- Future batches follow the `{YYYY-MM-DD}-{context-slug}` naming convention so `grep -l <batch> .ai-workspace/plans/*.json` enumerates affected plans for unwind.

The governance boundary is explicit: Option B did not loosen the 3-cap, it added an orthogonal bootstrap-only mechanism.

## Sweep record

| Run | Findings | Suspect ACs | Note |
|---|---|---|---|
| T2045 (master before C1-bis) | 245 | 245 | Pre-C1-bis advisory-era backlog |
| T2205 (after batch with 2 rules) | 4 | 4 | STOP trigger #1 — F55 ×3 + F56-multigrep ×1 |
| T2209 (after batch extended + 4 ACs fixed) | **0** | **0** | Bootstrap absorption complete |

245 → 0. Batch absorbed 241 findings; 4 fixed inline.

## Files changed

### Source
- `server/validation/ac-lint.ts` — +~90 LOC (new interface, validator, filter, result field)
- `server/types/execution-plan.ts` — +~20 LOC (mirror type + field declaration)

### Tests
- `server/validation/ac-lint.test.ts` — +9 test cases: 1 baseline + 1 F36-only filter + 1 cap-preservation + 1 multi-batch union + 5 schema-rejection (the 5th rejection covers the `scope !== "plan"` discriminator). 9 new, 47/47 total.

### Plan files (9 × batch injection + 1 × 4 AC command rewrites)
- `.ai-workspace/plans/2026-04-02-phase2-forge-plan-output.json`
- `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` ← also: 4 AC command rewrites in `PH01-US-06`
- `.ai-workspace/plans/forge-coordinate-phase-PH-02.json`
- `.ai-workspace/plans/forge-coordinate-phase-PH-03.json`
- `.ai-workspace/plans/forge-coordinate-phase-PH-04.json`
- `.ai-workspace/plans/forge-generate-phase-PH-01.json`
- `.ai-workspace/plans/forge-generate-phase-PH-02.json`
- `.ai-workspace/plans/forge-generate-phase-PH-03.json`
- `.ai-workspace/plans/forge-generate-phase-PH-04.json`

### Out of scope
- C1 hook files (`.claude/settings.json`, `scripts/*-hook.sh`, fixtures, tests) stay uncommitted as C1 branch WIP. `.claude/settings.json` is parked as `.claude/settings.json.parked-during-c1bis` throughout C1-bis implementation and will be restored when switching to the C1 branch for the follow-up PR.
- 3 master/coherence plan files (`forge-coordinate-master-plan.json`, `forge-generate-master-plan.json`, `forge-generate-coherence-report.json`) are unchanged — they had zero findings to absorb.

## Pre-merge validation (AC-09 Part A evidence, log-only)

During C1-bis implementation, while editing `server/validation/ac-lint.ts`, the C1 retroactive-critique hook (not yet shipped but present as uncommitted working-tree files) fired same-turn and injected `hookSpecificOutput.additionalContext` with the drift-sweep directive. This confirms AC-09 Part A's same-turn-timing claim from the C1 plan without a dedicated test run. The C1 PR body will log this verbatim under its own "Pre-merge validation" section.

## Checkpoint

- [x] forge-plan: T2115 Option B schema + cap semantics
- [x] forge-plan: T2155 ack-go on T2145 confirmation items 1–7
- [x] forge-plan: T2210/T2215 Option A decision for residual non-batch findings
- [x] swift-henry: grep `ac-lint.ts` + `ac-subprocess-rules.ts` for existing `lintExempt` + `AC_LINT_RULES` (F65 mirror)
- [x] swift-henry: park `.claude/settings.json` to stop self-hook firing mid-edit
- [x] swift-henry: C1bis-AC-01 (ac-lint.ts schema + validator + filter)
- [x] swift-henry: C1bis-AC-02 (9 unit tests, 47/47 total)
- [x] swift-henry: C1bis-AC-04 (execution-plan.ts type mirror)
- [x] swift-henry: inject `2026-04-13-c1-bootstrap` batch into 9 plan files
- [x] swift-henry: C1bis-AC-03 residual sweep — fix 4 non-batch findings inline
- [x] swift-henry: extend batch to include `F56-multigrep-pipe` (forge-plan explicit directive)
- [x] swift-henry: C1bis-AC-05 full-suite test run (683/687 pass, 0 regressions)
- [x] swift-henry: write this plan file
- [x] swift-henry: `/coherent-plan` this plan file (3 MINOR fixed in-place, 2 MINOR noted)
- [ ] swift-henry: commit + `/ship`
- [ ] swift-henry: mail forge-plan with PR URL for round-0 cold review
- [ ] forge-plan: round-0 review via fresh stateless subagent
- [ ] swift-henry: address any round-0 findings
- [ ] PR merged to master
- [ ] swift-henry: return to C1 branch, restore `.claude/settings.json`, resume C1 AC-05..AC-10

Last updated: 2026-04-13T22:25:00+08:00 — /coherent-plan pass: 5 MINOR findings, 3 fixed in-place (ELI5 "rule families" → "rule IDs"; test-count phrasing clarified; self-referential checkpoint stale-tick), 2 noted (sweep-record terminology, "C1 branch WIP" phrasing). No criticals, no majors. Ready to commit + /ship.
