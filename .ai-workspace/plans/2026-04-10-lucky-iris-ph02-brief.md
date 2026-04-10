# PH-02 Implementation Brief — lucky-iris Fresh Session

> Read this file FIRST when starting the fresh local session.
> Your mailbox name is lucky-iris. Your role is the implementing agent for forge_coordinate PH-02.

## Who you are

You are **lucky-iris**, the implementing agent for forge_coordinate on forge-harness. **forge-plan** is the coordinating/planning agent who maintains the PRD, phase plans, and performs stateless reviews. You communicate via `/mailbox`.

## What happened before this session

### PH-01 (complete, shipped)
- **8 stories** (US-00a through US-06) implemented with proper dogfooding
- **444 tests passing**, TypeScript clean
- **Shipped** as PR #128, merged to master, released **v0.17.0**
- **Branch:** master is at v0.17.0 (`0133f7c`)
- **Dogfood results:** 6/7 stories passed forge_evaluate on first iteration; 1 retry on US-02 (AC grep pattern issue, not code defect); US-06 partial was AC command fragility (F-55/F-56), not implementation bugs

### Dogfood findings from PH-01 (documented in KB)
- **F-55 (was F-06):** AC grep regex fails in MCP subprocess (TTY-dependent vitest output). Simple `grep -q 'passed'` works; count-based regex breaks.
- **F-56 (was F-07):** AC pipe chain `cmd | grep && ! grep` hangs forever — second grep has no stdin. Use captured-output pattern: `OUT=$(cmd 2>&1); echo "$OUT" | grep -q 'x' && ! echo "$OUT" | grep -q 'y'`
- **F-08:** TS strict narrowing catches redundant comparisons (cosmetic, not a bug)

The PH-02 phase plan AC commands use the proven `npx vitest run ... 2>&1 | grep -q 'passed'` pattern, which worked reliably across all PH-01 stories. No changes needed.

## Project context

- **forge-harness** = composable AI primitives (plan, evaluate, generate, coordinate) as a local MCP server
- **forge_coordinate** = 4th primitive, lightweight orchestrator. Advisory mode = $0 Intelligent Clipboard (no LLM calls). Reads `.forge/runs/*.json`, topo-sorts stories, classifies as done/ready/blocked/pending/failed/inconclusive, returns a `PhaseTransitionBrief`
- **Current version:** v0.18.0 on master (v0.17.0 = PH-01, v0.17.1 = AC contract, v0.18.0 = brief persistence)
- **PRD:** `docs/forge-coordinate-prd.md` (v1.2)
- **Master plan:** `.ai-workspace/plans/forge-coordinate-master-plan.json`
- **PH-02 phase plan:** `.ai-workspace/plans/forge-coordinate-phase-PH-02.json` (4 stories)
- **Full implementation plan:** `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md`

## PH-02 stories (4 total)

| Story | What | Dependencies |
|-------|------|-------------|
| PH02-US-01 | `checkBudget` — aggregate `estimatedCostUsd` from primary RunRecords. Warning at 80%, exceeded at 100%. Advisory only (NFR-C04). Null cost → `incompleteData: true` (NFR-C09). Pure function (no RunContext). | None |
| PH02-US-02 | `checkTimeBudget` — wall-clock using caller-provided `startTimeMs`. Missing startTimeMs → `warningLevel: 'unknown'` (not 'none'). Pure function. | None |
| PH02-US-03 | INCONCLUSIVE handling — INCONCLUSIVE increments retryCount same as FAIL. `retryCount < 3` → `ready-for-retry`. `retryCount >= 3` → `failed`. Transitive `dep-failed` only on terminal-failed roots. Dep waiting on retry → stays `pending`. | US-01 |
| PH02-US-04 | `recoverState` — pure function over reconciled view. Reads primary RunRecords, classifies by `evalVerdict`. `reconcileState` (PH-03) runs FIRST; keep orphan/new-story logic OUT of recoverState. Idempotent: two consecutive calls → same result. | US-03 |

## Setup steps

```bash
# 1. Ensure you're on master with latest
git checkout master && git pull

# 2. Verify v0.18.0
node -e "import('./package.json', {with: {type: 'json'}}).then(m => console.log(m.default.version))"
# Should print 0.18.0

# 3. Build dist (for MCP tools)
npm run build

# 4. Create feature branch
git checkout -b feat/forge-coordinate-ph-02

# 5. Verify test baseline
npx vitest run 2>&1 | tail -5
# Should show 444 tests passing
```

## Pre-flight check (MANDATORY)

Before the first story, verify forge MCP tools are callable:

1. Call `forge_generate({storyId: "PH02-US-01", planPath: "<abs-path>/forge-coordinate-phase-PH-02.json", projectPath: "<abs-path>/forge-harness"})` — must return a GenerationBrief
2. Call `forge_evaluate({storyId: "PH02-US-01", planPath: "<abs-path>/forge-coordinate-phase-PH-02.json", projectPath: "<abs-path>/forge-harness"})` — must return per-AC verdicts (not all INCONCLUSIVE) AND write a RunRecord to `.forge/runs/`

If either fails: **STOP and `/mailbox send to forge-plan`** to escalate. Do NOT proceed without working forge tools.

## Dogfood loop (for each story)

```
1. forge_generate({storyId, planPath, projectPath, prdContent, masterPlanContent, phasePlanContent})
   → Read the GenerationBrief. Use it as implementation guide.

2. Implement the story based on the brief.

3. forge_evaluate({storyId, planPath, projectPath: "<abs-path>/forge-harness"})
   → If PASS: commit, move to next story
   → If FAIL: call forge_generate with evalReport + iteration for fix guidance
   → Max 3 iterations. If still FAIL: escalate to forge-plan.
   ⚠ projectPath is REQUIRED — without it, eval results are ephemeral (no RunRecord written).
     With projectPath, forge_generate also persists briefs to .forge/runs/briefs/ (v0.18.0).
```

## Key files to read

| File | Why |
|------|-----|
| `docs/forge-coordinate-prd.md` | PRD v1.2 — budget/time/INCONCLUSIVE/crash recovery requirements |
| `.ai-workspace/plans/forge-coordinate-phase-PH-02.json` | Phase plan with 4 stories + ACs |
| `.ai-workspace/plans/forge-coordinate-master-plan.json` | Master plan for masterPlanContent |
| `server/lib/coordinator.ts` | Core logic from PH-01 — assessPhase, assemblePhaseTransitionBrief (~342 LOC) |
| `server/lib/coordinator.test.ts` | Existing 18 tests from PH-01 — add PH-02 tests here |
| `server/lib/run-reader.ts` | readRunRecords tagged union (160 LOC, from PH-01) |
| `server/types/coordinate-result.ts` | PhaseTransitionBrief — note budget.incompleteData, timeBudget.warningLevel fields |
| `server/lib/run-record.ts` | RunRecord.metrics.estimatedCostUsd (optional, added in PH-01 US-00a) |
| `server/lib/cost.ts` | CostTracker — isOverBudget returns false when null (beware!) |
| `server/lib/topo-sort.ts` | topoSort from PH-01 (66 LOC) |

## Key design decisions for PH-02

1. **checkBudget is PURE** — takes `(priorRecords, budgetUsd)`, returns a result object. No RunContext, no logging, no side effects. The caller (assessPhase) handles logging.
2. **checkTimeBudget is PURE** — takes `(startTimeMs, maxTimeMs)`, returns a result object. `Date.now()` is the only external read.
3. **Advisory only (NFR-C04)** — coordinator never throws on budget exceeded. It returns `warningLevel: 'exceeded'` in the brief. The caller decides what to do.
4. **Null cost ≠ $0 (NFR-C09)** — missing `estimatedCostUsd` records are excluded from sum and `incompleteData` is set to true. Never silently default to zero.
5. **INCONCLUSIVE = retry, not immediate failure** — INCONCLUSIVE increments retryCount same as FAIL. Story stays `ready-for-retry` until cap (3) is reached.
6. **recoverState operates on reconciled view** — reconcileState (PH-03) runs before recoverState in assessPhase. Orphan filtering and new-story marking are NOT recoverState's job.
7. **Dep-failed only on terminal roots** — a dependency that is `ready-for-retry` does NOT dep-fail its downstream. The downstream stays `pending` until the retry resolves.

## Implementation notes from PH-01

- **assessPhase already has a 6-state classifier** at `server/lib/coordinator.ts`. PH-02 extends it with `ready-for-retry` and integrates checkBudget/checkTimeBudget into assemblePhaseTransitionBrief.
- **StoryStatusEntry.retryCount** and **StoryStatusEntry.priorEvalReport** fields already exist on the type in `coordinate-result.ts` — populate them in PH-02.
- **The tagged discriminated union** from readRunRecords returns `{source: "primary", record: RunRecord}` — filter with `.filter(r => r.source === 'primary')` for budget aggregation and status classification.

## When done

After all 4 stories pass forge_evaluate:
1. `/mailbox send to forge-plan` with: story-by-story dogfood results (brief quality, eval accuracy, iterations needed), commit SHAs, test count, any surprises
2. forge-plan will spawn stateless reviewer + ship via `/ship`

## Process guard

**Hard rule:** Before implementing ANY story, verify forge MCP tools are callable. If not available → STOP and escalate. "Can't dogfood" = "stop and ask", never "skip and ship".
