# S3 Dogfood Redo Brief — lucky-iris Local Session

> Read this file FIRST when starting the fresh local session.
> Your mailbox name is lucky-iris. Your role is the implementing agent for forge_coordinate PH-01.

## Who you are

You are **lucky-iris**, the implementing agent for forge_coordinate on forge-harness. **forge-plan** is the coordinating/planning agent who maintains the PRD, phase plans, and performs stateless reviews. You communicate via `/mailbox`.

## What happened

You previously implemented PH01-US-00b through US-05 on `feat/forge-coordinate-ph-01` (6 stories, 432 tests, all correct) — but **without dogfooding** forge_generate/forge_evaluate. The cloud Dispatch session lacked forge MCP tools (`.mcp.json` spawns local processes that don't work in cloud).

**Decision: Full revert and redo with proper dogfooding.** The purpose of dogfooding isn't better code — it's validating that the harness produces consistent results. Every story through the generate→evaluate→fix loop is a data point for S7 divergence measurement.

## Project context

- **forge-harness** = composable AI primitives (plan, evaluate, generate, coordinate) as a local MCP server
- **forge_coordinate** = 4th primitive, lightweight orchestrator. Advisory mode = $0 Intelligent Clipboard (no LLM calls). Reads `.forge/runs/*.json`, topo-sorts stories, classifies as done/ready/blocked/pending, returns a `PhaseTransitionBrief`
- **Current version:** v0.16.6 on master
- **PRD:** `docs/forge-coordinate-prd.md` (v1.2, 16 REQ / 10 NFR / 8 SC, 23 stories)
- **Master plan:** `.ai-workspace/plans/forge-coordinate-master-plan.json`
- **PH-01 phase plan:** `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` (8 stories)
- **Full implementation plan:** `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md`

## PH-01 stories (8 total)

| Story | What | Status |
|-------|------|--------|
| PH01-US-00a | RunRecord interface extension + handleStoryEval RunContext | DONE on master (commit `1e085fc`, merged) |
| PH01-US-00b | Cross-site estimatedCostUsd population | REDO with dogfood |
| PH01-US-01 | CoordinateResult, StoryStatusEntry, PhaseTransitionBrief types | REDO with dogfood |
| PH01-US-02 | topoSort (Kahn's) + detectCycles export | REDO with dogfood |
| PH01-US-03 | readRunRecords tagged discriminated union | REDO with dogfood |
| PH01-US-04 | assessPhase — story classification + dispatch | REDO with dogfood |
| PH01-US-05 | assemblePhaseTransitionBrief | REDO with dogfood |
| PH01-US-06 | Unit test scaffold consolidation | REDO with dogfood |

**US-00a is DONE** — already merged to master via PR. Do NOT revert or redo it.

## Setup steps (run these BEFORE any story)

```bash
# 1. Ensure dist is fresh (F-05 bash fix must be in dist)
npm run build

# 2. Verify you're on the feature branch
git checkout feat/forge-coordinate-ph-01

# 3. Revert to pre-implementation state (preserves working tree)
git reset --soft 3b8e69c
git restore --staged .

# 4. Rebase on master (picks up PRs #121, #122)
git rebase master
```

## Pre-flight check (MANDATORY)

Before the first story, verify forge tools work:

1. Call `forge_generate({storyId: "PH01-US-00b", planPath: "<abs>/forge-coordinate-phase-PH-01.json", projectPath: "<abs>/forge-harness"})` — must return a GenerationBrief
2. Call `forge_evaluate({storyId: "PH01-US-00a", planPath: "<abs>/forge-coordinate-phase-PH-01.json"})` — must return per-AC verdicts (not all INCONCLUSIVE)

If either fails: **STOP and `/mailbox send to forge-plan`** to escalate. Do NOT proceed without working forge tools.

## Dogfood loop (for each story)

```
1. forge_generate({storyId, planPath, projectPath, prdContent, masterPlanContent, phasePlanContent})
   → Read the GenerationBrief. Use it as implementation guide.

2. Implement the story based on the brief.
   - Your prior code is still on disk (soft reset preserves working tree)
   - Write guided by the brief, don't just copy-paste prior commits

3. forge_evaluate({storyId, planPath})
   → If PASS: commit, move to next story
   → If FAIL: call forge_generate with evalReport + iteration for fix guidance
   → Max 3 iterations. If still FAIL: escalate to forge-plan.
```

## Key files to read

| File | Why |
|------|-----|
| `docs/forge-coordinate-prd.md` | PRD v1.2 — authoritative spec, feed to forge_generate as prdContent |
| `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` | Phase plan with 8 stories + ACs |
| `.ai-workspace/plans/forge-coordinate-master-plan.json` | Master plan for masterPlanContent |
| `server/lib/run-record.ts` | RunRecord interface (already extended in US-00a) |
| `server/tools/evaluate.ts` | handleStoryEval with RunContext (already done in US-00a) |
| `server/types/execution-plan.ts` | Story type + detectCycles (US-02 will export it) |
| `server/tools/coordinate.ts` | 16-line stub — expands in PH-04, not PH-01 |

## When done

After all 7 stories pass forge_evaluate:
1. `/mailbox send to forge-plan` with: story-by-story dogfood results (brief quality, eval accuracy, iterations needed), commit SHAs, test count, any surprises
2. forge-plan will spawn stateless reviewer + ship via `/ship`

## Process guard

**Hard rule:** Before implementing ANY story, verify forge MCP tools are callable. If not available → STOP and escalate. "Can't dogfood" = "stop and ask", never "skip and ship".
