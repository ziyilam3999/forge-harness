# forge_coordinate Sessions Plan

**Created:** 2026-04-08
**Parent plan:** `~/.claude/plans/piped-sprouting-island.md`
**Methodology:** Same as forge_generate — PRD → Master Plan → Phase Plans → session-based implementation with dogfooding

## ELI5

Seven sessions to build the foreman. Session 1 writes the job description (PRD). Session 2 makes the project plan. Sessions 3-6 each build one piece. Session 7 checks our work against the blueprint.

## Overview

| # | Activity | Deliverable | Dependencies |
|---|----------|-------------|-------------|
| S1 | PRD via `/prd` | `docs/forge-coordinate-prd.md` | None |
| S2 | Master Plan + Phase Plans + coherence eval | JSON plans + coherence report | S1 |
| S3 | PH-01: Types, Topo Sort, State Readers, Evaluate Write-Side, Core Loop (7 stories) | PR, version bump | S2 |
| S4 | PH-02: Budget, Time, INCONCLUSIVE, Crash Recovery (4 stories) | PR, version bump | S3 |
| S5 | PH-03: ReplanningNote, Reconciliation, Observability (5 stories) | PR, version bump | S3, S4 |
| S6 | PH-04: MCP Handler, Checkpoint Gates, Tests, Dogfood (4 stories) | PR, version bump | S4, S5 |
| S7 | Divergence measurement | Baseline comparison report | S6 |

---

## Session Prompts

### Session 1: Create PRD for forge_coordinate (interactive)
```
I want to create a PRD for the forge_coordinate primitive using the /prd skill.

Before starting the interview, read these reference files so you can help me answer the diagnostic questions efficiently:
- .ai-workspace/PROJECT-INDEX.md — project knowledge index (start here)
- docs/forge-harness-plan.md (lines 157-355) — forge_coordinate architecture, inter-primitive contracts
- docs/primitive-backlog.md (lines 153-205) — coordinate backlog items
- docs/forge-generate-prd.md — reference PRD format (16 REQs, 6 NFRs, 9 SCs — use as style template)
- ~/.claude/plans/piped-sprouting-island.md — detailed implementation plan with verified codebase state

Key context for the interview:
- forge_coordinate is the 4th and final primitive — it orchestrates plan + generate + evaluate into complete workflows
- Advisory mode (v1, default) is $0 — no LLM calls. It reads .forge/runs/*.json files, topologically sorts stories, classifies them as done/ready/blocked/pending, checks budget/time, and returns a PhaseTransitionBrief. The caller decides what to do
- Autonomous mode is deferred to v2 (would make LLM calls for triage)
- Must integrate with existing infrastructure: RunContext, CostTracker, ProgressReporter, AuditLog (shipped in v0.7.0)
- Key pre-requisite: forge_evaluate's handleStoryEval currently does NOT write RunRecords — needs full RunContext infrastructure added (~25 lines) before coordinate can read story eval results
- Dual RunRecord systems exist: run-record.ts (JSON, authoritative for status) vs generator.ts (JSONL, supplementary for velocity). Plan specifies tagged discriminated union
- phaseId is required in v1 — auto-detection deferred because MasterPlan.Phase has no planPath field
- Read-only brief assembler pattern — coordinate never mutates project files, never calls Claude

The implementation plan at ~/.claude/plans/piped-sprouting-island.md has the complete technical design including:
- 4 phases, 20 stories (7+4+5+4)
- State Source Design (dual RunRecord, tagged discriminated union)
- Budget Design (estimatedCostUsd field, incompleteData flag)
- Concrete PhaseTransitionBrief interface
- 9 NFRs with verification commands
- Risk assessment (12 risks, all mitigated)

Use this plan as the primary technical reference. The PRD should capture the WHAT and WHY; the plan already has the HOW.

Run /prd and guide me through it. Save the output PRD to docs/forge-coordinate-prd.md.
```

### Session 2: Write Master Plan + Phase Plans (three-tier dogfood)
```
Read these files for context:
- .ai-workspace/PROJECT-INDEX.md — project knowledge index (start here)
- docs/forge-coordinate-prd.md — the PRD from Session 1 (your implementation spec)
- ~/.claude/plans/piped-sprouting-island.md — detailed technical design plan
- server/types/execution-plan.ts — ExecutionPlan v3.0.0, Story interface
- server/types/master-plan.ts — MasterPlan schema (Phase has no planPath)
- server/validation/execution-plan.ts — Zod validator + private detectCycles
- server/tools/coordinate.ts — current 16-line stub
- server/lib/run-record.ts — RunRecord interface (needs storyId, evalVerdict, estimatedCostUsd extensions)
- server/tools/evaluate.ts — handleStoryEval (L121-137, no writeRunRecord) vs handleCoherenceEval (L200-217, has writeRunRecord)
- .ai-workspace/plans/forge-generate-master-plan.json — reference format for master plan JSON
- .ai-workspace/plans/forge-generate-phase-PH-01.json — reference format for phase plan JSON

Tasks:

1. Write a MasterPlan v1.0.0 for forge_coordinate, decomposing the PRD into 4 phases matching the plan:

   PH-01: Types, Topological Sort, State Readers, Core Dispatch Loop (7 stories)
   - US-00: Pre-requisite — forge_evaluate write-side update (RunContext infrastructure + writeRunRecord for handleStoryEval, extend RunRecord with storyId/evalVerdict/estimatedCostUsd)
   - US-01: CoordinateResult, StoryStatusEntry, PhaseTransitionBrief, CoordinateMode types
   - US-02: topoSort (Kahn's algorithm) + export detectCycles with type-cast wrapper
   - US-03: readRunRecords (dual-source tagged discriminated union) + readAuditEntries
   - US-04: assessPhase (walk topo-sorted stories, classify by evalVerdict from primary records only)
   - US-05: assemblePhaseTransitionBrief (mechanical signal aggregation)
   - US-06: Unit tests (topo sort 5+, run-reader 5+, dispatch loop 5+, brief 3+)
   Dependencies: None

   PH-02: Safety & Budget Enforcement (4 stories)
   - US-01: checkBudget (aggregate estimatedCostUsd, 80%/100% thresholds, incompleteData flag)
   - US-02: checkTimeBudget (wall-clock with caller-provided startTimeMs, "unknown" when omitted)
   - US-03: INCONCLUSIVE handling (transitive blocking of dependents)
   - US-04: Crash recovery (recoverState using readRunRecords, classify by evalVerdict)
   Dependencies: [PH-01]

   PH-03: ReplanningNote, Reconciliation, Observability (5 stories)
   - US-01: ReplanningNote type (5 categories, 3 severities, mechanical routing)
   - US-02: collectReplanningNotes (EscalationReason→category mapping)
   - US-03: aggregateStatus (both RunRecord sources, cost + velocity)
   - US-04: graduateFindings (detect repeated failure patterns, per-plan threshold)
   - US-05: reconcileState (plan mutation detection, 5+ unit tests)
   Dependencies: [PH-01, PH-02]

   PH-04: MCP Handler, Checkpoint Gates, Integration Tests, Dogfood (4 stories)
   - US-01: Expand coordinateInputSchema (planPath, phaseId required, masterPlanPath, budgetUsd, maxTimeMs, startTimeMs, etc.)
   - US-02: Checkpoint gates (advisory: brief IS checkpoint)
   - US-03: Integration tests (15-20 tests)
   - US-04: Dogfood (run coordinate against multi-story plan)
   Dependencies: [PH-02, PH-03]

   Include crossCuttingConcerns: ["NFR-C01: zero callClaude ($0 advisory mode)", "NFR-C05: Windows-safe paths", "NFR-C06: graceful degradation for parse errors"]

   Save as .ai-workspace/plans/forge-coordinate-master-plan.json

2. Write ExecutionPlan v3.0.0 phase plans for each of the 4 phases. Each plan must:
   - Set documentTier: "phase" and phaseId matching the master plan
   - Have stories with binary, shell-executable acceptance criteria
   - Map every PRD REQ to at least one story
   - Map every NFR to at least one AC or cross-cutting concern
   - US-00 ACs must verify: RunContext construction in handleStoryEval, writeRunRecord call exists, storyId and evalVerdict fields populated, new optional fields on RunRecord interface
   - US-02 ACs must verify: detectCycles is exported, topoSort handles cycles + empty + linear + diamond DAGs
   - US-03 ACs must verify: dual-source reading (JSON + JSONL), tagged output, corrupt file handling, empty dir
   Save each as .ai-workspace/plans/forge-coordinate-phase-{PH-NN}.json

3. Run forge_evaluate(coherence) with:
   - prdContent: the full PRD from docs/forge-coordinate-prd.md
   - masterPlanContent: the master plan JSON
   - phasePlans: all 4 phase plan JSONs with their phaseIds

   Thresholds:
   - Zero CRITICAL gaps (any CRITICAL = fix required)
   - At most 2 MAJOR gaps
   - All REQs mapped to at least one story
   Save the coherence report as .ai-workspace/plans/forge-coordinate-coherence-report.json

4. If coherence gaps are found, fix the plans and re-run (max 2 iterations).

Ship the plans and coherence report as a PR.
```

### Session 3: Implement PH-01 — Types, Topo Sort, State Readers, Evaluate Write-Side, Core Loop (7 stories)
```
Read these files for context:
- .ai-workspace/PROJECT-INDEX.md — project knowledge index (start here)
- .ai-workspace/plans/forge-coordinate-master-plan.json — master plan (focus on PH-01)
- .ai-workspace/plans/forge-coordinate-phase-PH-01.json — phase plan (7 stories, your implementation spec)
- docs/forge-coordinate-prd.md — PRD for vision context
- server/tools/evaluate.ts — handleStoryEval (L121-137, NO RunContext/writeRunRecord) vs handleCoherenceEval (L200-217, HAS RunContext/writeRunRecord — use as pattern)
- server/lib/run-record.ts — RunRecord interface (L9-26, needs storyId/evalVerdict extensions) + writeRunRecord function
- server/lib/generator.ts — generator RunRecord (L364-371, HAS storyId) + JSONL writer
- server/lib/run-context.ts — RunContext constructor pattern
- server/validation/execution-plan.ts — detectCycles (L170, private, accepts Array<Record<string, unknown>>)
- server/types/execution-plan.ts — Story interface (dependencies?: string[])
- server/types/eval-report.ts — EvalReport (storyId + verdict)
- server/lib/cost.ts — CostTracker (isOverBudget, totalCostUsd)
- server/lib/audit.ts — AuditLog (write-only, JSONL in .forge/audit/)

Implement Phase PH-01: Types, Topological Sort, State Readers, Evaluate Write-Side, Core Dispatch Loop.

Story order matters — follow dependencies:
1. US-00: forge_evaluate write-side update — add RunContext infrastructure to handleStoryEval matching handleCoherenceEval pattern (~25 lines: RunContext construction, cost tracking, audit logging, writeRunRecord call with storyId + evalVerdict). Also extend RunRecord interface with optional storyId, evalVerdict fields + add estimatedCostUsd to RunRecord.metrics. THIS IS THE CRITICAL PRE-REQ — without it, coordinate cannot read story eval results.
2. US-01: Define CoordinateResult, StoryStatusEntry, PhaseTransitionBrief (concrete interface from plan), CoordinateMode types in server/types/coordinate-result.ts. Also define a minimal ReplanningNote interface (category, severity, description, optional affectedPhases/affectedStories) — just enough for PhaseTransitionBrief to compile. PH-03 adds the routing logic and collectReplanningNotes function
3. US-02: topoSort in server/lib/topo-sort.ts — Kahn's algorithm, export detectCycles from execution-plan.ts (currently private). Type note: detectCycles accepts Array<Record<string, unknown>>, cast Story[] when calling. Dual cycle detection: detectCycles as pre-check (fail fast), Kahn's incomplete-queue as defensive assertion
4. US-03: readRunRecords + readAuditEntries in server/lib/run-reader.ts — read both .forge/runs/*.json (glob) and .forge/runs/data.jsonl (JSONL parse). Return tagged discriminated union: {source: "primary", record: RunRecord} | {source: "generator", record: GeneratorRunRecord}. Graceful degradation: missing dir → empty array, corrupt JSON → skip + console.error (P44)
5. US-04: assessPhase in server/lib/coordinator.ts — walk topo-sorted stories, classify using ONLY primary RunRecord source (with evalVerdict). done/ready/blocked/pending
6. US-05: assemblePhaseTransitionBrief — mechanical signal aggregation, recommendation strings
7. US-06: Unit tests — topo sort 5+ (including type-cast path, cycles, empty, linear, diamond DAG), run-reader 5+ (corrupt JSON, truncated JSONL, schema-mismatch, empty dir, dual-source tagged output), dispatch loop 5+, brief 3+

Dogfood forge_generate for each story:
- Call forge_generate({storyId, planPath: "forge-coordinate-phase-PH-01.json", prdContent, masterPlanContent, phasePlanContent}) to get the implementation brief
- Read the brief, implement
- Call forge_evaluate({storyId, planPath, projectPath: "<abs-path>/forge-harness"}) to verify ACs
  ⚠ projectPath is REQUIRED — without it, eval results are ephemeral (no RunRecord written)
- If FAIL: call forge_generate with evalReport for fix guidance, iterate

Key constraints:
- NFR-C01: Zero callClaude imports in coordinate's dependency chain (advisory mode = $0)
- NFR-C05: Windows-safe paths (path.join, no colons in filenames)
- All existing 383 tests must continue passing
- Each story has shell-executable ACs in the phase plan — verify they pass

Ship as a PR.

After shipping, update the sessions plan and backlog:
- Mark this session's checkpoint complete with results
- Review the next session's prompt — update if implementation revealed surprises
- Update docs/primitive-backlog.md: move shipped items to "Already Implemented"
- Run /coherent-plan on the sessions plan
- Use /mailbox to send a structured progress update to forge-plan:
  - Phase completed, PR number, version, test count
  - Any surprises or deviations from the plan
  - Whether replanning is needed
  - What's unblocked next
```

### Session 4: Implement PH-02 — Safety & Budget Enforcement (4 stories)
```
Read these files for context:
- .ai-workspace/PROJECT-INDEX.md — project knowledge index (start here)
- .ai-workspace/plans/forge-coordinate-master-plan.json — master plan (focus on PH-02)
- .ai-workspace/plans/forge-coordinate-phase-PH-02.json — phase plan (4 stories)
- docs/forge-coordinate-prd.md — PRD (budget/time/INCONCLUSIVE/crash recovery requirements)
- server/lib/coordinator.ts — core logic from PH-01 (assessPhase, assemblePhaseTransitionBrief)
- server/lib/run-reader.ts — readRunRecords (tagged discriminated union from PH-01)
- server/types/coordinate-result.ts — PhaseTransitionBrief (budget.incompleteData, timeBudget nullable fields)
- server/lib/cost.ts — CostTracker (isOverBudget returns false when null — caller must handle)
- server/lib/run-record.ts — RunRecord.metrics.estimatedCostUsd (optional, from PH-01 US-00)
- server/lib/topo-sort.ts — topoSort from PH-01

Implement Phase PH-02: Safety & Budget Enforcement.
PH-01 is complete (PR #??, v??). Check current test count.

Stories:
1. US-01: checkBudget — aggregate estimatedCostUsd from prior primary RunRecords. Warning at 80%, stop at 100%. When records have null/missing estimatedCostUsd → set budget.incompleteData = true, log warning per P45, exclude from total (lower bound). Advisory: brief signals "exceeded", caller enforces.
2. US-02: checkTimeBudget — wall-clock using caller-provided startTimeMs (from input schema). When startTimeMs omitted → timeBudget.elapsedMs = null, warningLevel = "unknown". 80%/100% thresholds. Known limitation: susceptible to clock jumps (documented, not addressed in v1).
3. US-03: INCONCLUSIVE handling — mark story blocked, walk dependency graph to transitively block all dependents. Continue with non-blocked stories. Terminate-early when all remaining stories are blocked.
4. US-04: Crash recovery via recoverState — use readRunRecords from run-reader.ts (no duplicate code). Filter primary records by storyId. PASS → done, FAIL/INCONCLUSIVE → last verdict wins, no storyId → skip, no matching records → pending. Degrades to no-op (all pending) when no run files found.

Key constraints:
- NFR-C04: Budget enforcement is advisory. Coordinate returns warningLevel in brief — it does NOT kill processes
- NFR-C09: Never silently treat missing cost data as $0. Flag with incompleteData
- All existing tests must still pass
- Verify each story's shell-executable ACs from the phase plan

Dogfood forge_generate for each story (same pattern as Session 3).
Ship as a PR.

After shipping:
- Update sessions plan checkpoint + backlog
- Run /coherent-plan on the sessions plan
- /mailbox send to forge-plan: phase completed, PR, version, surprises, next
```

### Session 5: Implement PH-03 — ReplanningNote, Reconciliation, Observability (5 stories)
```
Read these files for context:
- .ai-workspace/PROJECT-INDEX.md — project knowledge index (start here)
- .ai-workspace/plans/forge-coordinate-master-plan.json — master plan (focus on PH-03)
- .ai-workspace/plans/forge-coordinate-phase-PH-03.json — phase plan (5 stories)
- docs/forge-coordinate-prd.md — PRD (replanning, observability, reconciliation requirements)
- server/lib/coordinator.ts — core logic from PH-01/02 (assessPhase, checkBudget, checkTimeBudget, recoverState)
- server/types/coordinate-result.ts — ReplanningNote minimal interface (defined in PH-01, routing logic added in this phase)
- server/types/generate-result.ts — EscalationReason: "plateau" | "no-op" | "max-iterations" | "inconclusive" | "baseline-failed"
- server/lib/run-reader.ts — readRunRecords (both sources), readAuditEntries
- server/lib/run-record.ts — RunRecord with storyId, evalVerdict, estimatedCostUsd (from PH-01)

Implement Phase PH-03: ReplanningNote, Reconciliation, Observability.
PH-01 and PH-02 are complete. Check current test count.

Stories:
1. US-01: ReplanningNote routing logic — the type interface was defined minimally in PH-01 US-01 (category, severity, description, affectedPhases, affectedStories). This story adds the mechanical routing table: ac-drift/assumption-changed → master update, partial-completion/dependency-satisfied → phase update, gap-found → defer, severity:blocking → halt. Also add any missing category/severity values if the minimal PH-01 definition was incomplete
2. US-02: collectReplanningNotes — explicit mapping: plateau→partial-completion, no-op→gap-found, max-iterations→partial-completion, inconclusive→ac-drift, baseline-failed→assumption-changed. Eval FAIL→ac-drift, INCONCLUSIVE→gap-found
3. US-03: aggregateStatus — uses readRunRecords (BOTH sources) + readAuditEntries. Produces per-story status + accumulated cost (from primary estimatedCostUsd) + velocity (stories/hour from generator timestamps). Edge cases: zero completed → velocity=0, zero elapsed time → velocity=0
4. US-04: graduateFindings — detect repeated failure patterns (same escalation reason 3+ times within current plan). Returns structured findings for KB (Intelligent Clipboard). Threshold is per-plan, not global
5. US-05: reconcileState — compare plan story IDs vs run record storyIds. Orphaned records → warn + exclude. New stories → pending. 5+ unit tests: orphaned records, new stories, full plan replacement, story-rename (old orphaned + new pending), dependency-change (blocked→ready reclassification)

Key constraints:
- NFR-C01: Zero callClaude — all replanning logic is mechanical classification
- NFR-C06: Observability failures (audit parse errors, missing JSONL) don't block core logic
- All existing tests must still pass

Dogfood forge_generate for each story (same pattern as Session 3).
Ship as a PR.

After shipping:
- Update sessions plan checkpoint + backlog
- Run /coherent-plan on the sessions plan
- /mailbox send to forge-plan: phase completed, PR, version, surprises, next
```

### Session 6: Implement PH-04 — MCP Handler, Checkpoint Gates, Integration Tests, Dogfood (4 stories)
```
Read these files for context:
- .ai-workspace/PROJECT-INDEX.md — project knowledge index (start here)
- .ai-workspace/plans/forge-coordinate-master-plan.json — master plan (focus on PH-04)
- .ai-workspace/plans/forge-coordinate-phase-PH-04.json — phase plan (4 stories)
- docs/forge-coordinate-prd.md — PRD (all REQs, all NFRs)
- server/tools/coordinate.ts — current 16-line stub (will be replaced with full MCP handler)
- server/index.ts — tool registration
- server/lib/coordinator.ts — complete core logic from PH-01/02/03 (assessPhase, checkBudget, checkTimeBudget, recoverState, reconcileState, collectReplanningNotes, aggregateStatus, graduateFindings, assemblePhaseTransitionBrief)
- server/lib/topo-sort.ts — topoSort from PH-01
- server/lib/run-reader.ts — readRunRecords, readAuditEntries from PH-01
- server/types/coordinate-result.ts — all types from PH-01 + PH-03

Implement Phase PH-04: MCP Handler, Checkpoint Gates, Integration Tests, Dogfood.
PH-01, PH-02, PH-03 are complete. Check current test count.

Key architecture from prior phases:
- Entry point will be: assessPhase(plan, projectPath, options) → CoordinateResult
- assemblePhaseTransitionBrief(result, plan) → PhaseTransitionBrief
- readRunRecords returns tagged discriminated union
- Budget/time checks are integrated into assessPhase
- recoverState and reconcileState handle crash recovery and plan mutation

Stories:
1. US-01: Expand coordinateInputSchema — planPath (required), phaseId (required in v1), masterPlanPath, coordinateMode, budgetUsd, maxTimeMs, startTimeMs (epoch ms for time budget anchor), projectPath, prdContent, replanningNotes. Wire handleCoordinate to assessPhase + assemblePhaseTransitionBrief
2. US-02: Checkpoint gates — advisory mode: the brief IS the checkpoint (caller reviews and acts). No autonomous-mode gates in v1. Return checkpointRequired: false always in advisory mode
3. US-03: Integration tests (15-20) — multi-story dispatch, budget enforcement (including incomplete cost data), time enforcement (including missing startTimeMs → "unknown"), crash recovery, INCONCLUSIVE blocking + transitive propagation, advisory brief completeness (NFR-C08), error handling (corrupt run records, missing files), plan mutation reconciliation, empty-dependency plans, all-stories-done phase-complete, deterministic dispatch order (NFR-C02)
4. US-04: Dogfood — run forge_coordinate against a real multi-story plan (e.g., one of the forge_generate phase plans that has actual run records in .forge/runs/). Verify topo sort produces correct order, advisory brief contains all signals, status tracking works. Write dogfood report to .ai-workspace/plans/forge-coordinate-dogfood-report.md

NFR verification checklist (must all pass):
- NFR-C01: Zero callClaude imports in coordinate's full dependency chain
- NFR-C02: Deterministic dispatch order (same plan → same order)
- NFR-C03: Crash-safe state (re-run after kill → no duplicate work)
- NFR-C04: Budget = advisory signal (warningLevel in brief, not kill)
- NFR-C05: Windows-safe paths (path.join everywhere, no colons)
- NFR-C06: Graceful degradation (parse errors logged, not thrown)
- NFR-C07: Schema 3.0.0 compatible (accepts valid ExecutionPlan v3.0.0)
- NFR-C08: Brief completeness (all signals present)
- NFR-C09: Null-cost visibility (incompleteData flag when cost missing)

All existing tests must still pass.

Dogfood forge_generate for each story (same pattern as Session 3).
Ship as a PR.

After shipping:
- Update sessions plan checkpoint + backlog
- Run /coherent-plan on the sessions plan
- /mailbox send to forge-plan: phase completed, PR, version, test count, all NFRs verified, surprises, what's next (divergence measurement)
```

### Session 7: Divergence Measurement
```
Read these files for context:
- .ai-workspace/PROJECT-INDEX.md — project knowledge index (start here)
- .ai-workspace/divergence-baseline-post-three-tier.md — current baseline (80 items, forward 0% after forge_generate)
- docs/forge-harness-plan.md — master design doc
- docs/forge-coordinate-prd.md — PRD for what was planned
- server/tools/coordinate.ts — what was implemented

Run forge_evaluate(divergence) on the forge-harness codebase to measure the current divergence count after forge_coordinate implementation.

Compare against the 80-item baseline from the post-forge_generate measurement. Classify each item as:
- Fixed (no longer divergent)
- Intentional/accepted (documented deviation)
- Remaining gap (needs future work)

Focus especially on:
- Whether forge_coordinate implementation matches the design doc's description at docs/forge-harness-plan.md lines 314-352
- Whether the advisory mode / $0 constraint is verified
- Whether the inter-primitive contracts from the design doc are satisfied

Save the results to .ai-workspace/divergence-baseline-post-coordinate.md.

After completing:
- Update the sessions plan with final checkpoint
- /mailbox send to forge-plan:
  - Divergence count vs 80-item baseline
  - Items fixed, accepted, remaining
  - forge_coordinate fully shipped status
  - Whether any replanning is needed for future work
```

---

## Session Grouping Summary

| Session | Phase | Stories | Dependencies | Notes |
|---------|-------|---------|-------------|-------|
| **1** | PRD via /prd | — | None | Interactive, user-guided |
| **2** | Master plan + phase plans | — | Session 1 | Three-tier JSON format |
| **3** | PH-01: Types + State + Core | 7 | Session 2 | Largest phase, includes evaluate write-side fix |
| **4** | PH-02: Budget + Safety | 4 | Session 3 | Advisory enforcement |
| **5** | PH-03: Replanning + Observability | 5 | Sessions 3, 4 | ReplanningNote routing, reconciliation |
| **6** | PH-04: MCP Handler + Tests | 4 | Sessions 4, 5 | 15-20 integration tests, dogfood |
| **7** | Divergence measurement | — | Session 6 | Compare against 80-item baseline |

## Verification

- [ ] Session 1: PRD file exists with REQ-NN IDs, binary ACs, no HOW sections
- [ ] Session 2: MasterPlan (4 phases) + phase plans pass forge_evaluate(coherence) with zero CRITICAL gaps, all REQs mapped
- [ ] Session 3: PH-01 US-00 through US-06 ACs pass, TypeScript compiles, 383+ tests pass, handleStoryEval now writes RunRecord
- [ ] Session 4: PH-02 US-01 through US-04 ACs pass, budget advisory verified, crash recovery verified
- [ ] Session 5: PH-03 US-01 through US-05 ACs pass, reconcileState 5+ tests, replanning mapping verified
- [ ] Session 6: PH-04 US-01 through US-04 ACs pass, all 9 NFRs verified, full test suite green, dogfood report written
- [ ] Session 7: Divergence count measured, compared against 80-item baseline

## Checkpoint

- [ ] Session 1: Create PRD for forge_coordinate via /prd
- [ ] Session 2: Write master plan + phase plans + coherence eval
- [ ] Session 3: Implement PH-01 — Types, Topo Sort, State Readers, Evaluate Write-Side, Core Loop (7 stories)
- [ ] Session 4: Implement PH-02 — Budget, Time, INCONCLUSIVE, Crash Recovery (4 stories)
- [ ] Session 5: Implement PH-03 — ReplanningNote, Reconciliation, Observability (5 stories)
- [ ] Session 6: Implement PH-04 — MCP Handler, Checkpoint Gates, Tests, Dogfood (4 stories)
- [ ] Session 7: Divergence measurement

Last updated: 2026-04-08T01:45:00+08:00
