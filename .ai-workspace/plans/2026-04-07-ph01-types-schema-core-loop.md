# PH-01: Types, Schema, and Core Loop

## ELI5
We're building the "brain" of forge_generate — the part that decides what to tell the code-writer (Claude Code) to do next. It looks at the plan, the test results, and the history of attempts, then says one of three things: "start implementing this story" (init brief), "fix these specific failures" (fix brief), or "I give up, here's why" (escalation). It never writes code itself — it just assembles instructions.

## Stories (dependency order)

### US01: Schema additions
- Add `baselineCheck?: string` to ExecutionPlan
- Add `lineage?: { tier: string; sourceId: string }` to Story  
- Update validation to accept (not reject) these optional fields
- Add tests for backward compat

### US02: Type definitions
- Create `server/types/generate-result.ts` with:
  - GenerateResult, GenerationBrief, FixBrief, Escalation
  - EscalationDiagnostics, CostEstimate, DiffManifest
  - EvalHint, FailedCriterion types

### US03: Extract plan-loader
- Move loadPlan from evaluate.ts → server/lib/plan-loader.ts
- evaluate.ts imports from plan-loader
- Unit tests for plan-loader (precedence, validation, error cases)

### US04: Init brief assembly (buildBrief)
- Takes plan + storyId + projectPath → GenerationBrief
- Uses scanCodebase for codebaseContext
- Derives gitBranch as `feat/{storyId}`
- Uses plan.baselineCheck or default

### US05: Fix brief assembly (buildFixBrief)
- Extracts FAIL criteria from eval report
- computeScore: PASS / non-SKIPPED ratio
- evalHint with failFastIds
- buildDiffManifest from fileHashes comparison

### US06: Stopping conditions (checkStoppingConditions)
- plateau: 3+ scores where last 2 deltas = 0
- no-op: matching fileHashes
- max-iterations: iteration >= maxIterations
- inconclusive: verdict INCONCLUSIVE (highest precedence)
- baseline-failed: with diagnostics

### US07: Structured escalation reports
- Every escalation has reason, description, hypothesis, lastEvalVerdict, scoreHistory
- Description is reason-specific
- diagnostics only on baseline-failed

### US08: Core orchestrator (assembleGenerateResult)
- No evalReport → action: implement + GenerationBrief
- PASS verdict → action: pass
- Stopping condition met → action: escalate + Escalation
- FAIL + no stop → action: fix + FixBrief

## Test Cases & AC

- `npx tsc --noEmit` exits 0
- All 280 existing tests pass
- `grep -q 'baselineCheck?.*string' server/types/execution-plan.ts` succeeds
- `grep -q 'lineage?' server/types/execution-plan.ts` succeeds
- `grep -q 'export interface GenerateResult' server/types/generate-result.ts` succeeds
- `grep -q 'export interface FixBrief' server/types/generate-result.ts` succeeds
- `grep -q 'plan-loader' server/tools/evaluate.ts` succeeds
- `npx vitest run server/lib/plan-loader.test.ts` all pass
- `npx vitest run server/lib/generator.test.ts` all pass
- `npx vitest run server/validation/execution-plan.test.ts` all pass
- `npx vitest run server/tools/evaluate.test.ts` all pass
- Zero `callClaude` imports in generator.ts or plan-loader.ts

## Checkpoint

- [x] US01: Schema additions + validation + tests
- [x] US02: Type definitions in generate-result.ts
- [x] US03: Extract plan-loader + tests
- [x] US04: buildBrief + tests
- [x] US05: buildFixBrief + computeScore + diffManifest + tests
- [x] US06: checkStoppingConditions + tests
- [x] US07: Structured escalation reports + tests
- [x] US08: assembleGenerateResult orchestrator + tests
- [x] All existing 280 tests still pass (326 total)
- [x] TypeScript compilation clean

## Results
- PR: https://github.com/ziyilam3999/forge-harness/pull/71 (merged)
- Release: v0.13.0
- Tests: 326 passing (280 existing + 46 new)
- Review: PASS (0 bugs, 4 enhancements → 2 issues created: #72, #73)
- Design note: Plateau detection triggers when last 2 of 3+ scores are equal (per PRD REQ-03 examples, not strict "3 identical" interpretation)

Last updated: 2026-04-07T16:10:00Z
