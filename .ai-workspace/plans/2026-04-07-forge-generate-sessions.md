# Plan: Post Three-Tier — Next Steps & Session Prompts

## Context

The three-tier document system is **100% complete** (v0.5.0 → v0.12.0, all 7 steps shipped). PH-01 shipped (v0.13.0, PR #71). PH-02 shipped (v0.14.0, PR #77). PH-03 shipped (v0.15.0, PR #82). PH-04 shipped (v0.16.0, PR #85). Backlog updated through v0.16.0. **383/383 tests pass.**

**Current state:** PRD, master plan, and 4 phase plans for forge_generate are written and coherence-evaluated. All 4 phases implemented: PH-01 (Types, Schema, Core Loop), PH-02 (Infrastructure Integration), PH-03 (Three-Tier Document Integration), PH-04 (MCP Handler + Integration Tests). **forge_generate is complete.** Divergence measurement done: forward divergence 35% → 0%, 91/92 ACs pass. **All sessions complete. Plan is done.**

## ELI5

The three-tier factory is built and tested. Now we use it to build the next product (forge_generate). Step 1: write the wish list (/prd). Step 2: break it into chapters (master plan). Step 3: write detailed blueprints per chapter (phase plans). Step 4: build it.

---

## Key Decisions

### D1: /prd Cannot Be Fast-Tracked, But Can Be Efficient

The `/prd` skill's diagnostic interview (Q1-Q4) is **mandatory** — no skip mode exists. However:
- Smart routing exists: "new product/feature" asks Q1-Q4, "enhancement"/"internal tooling" asks Q2/Q4 only
- The human decides the routing during the interview — do NOT pre-declare it in the prompt
- You can cite existing docs during answers (the skill incorporates them into premises)
- All requirement sources already exist across 7 files — the interview won't start from zero

**Routing note:** forge_generate is a **user-facing MCP tool primitive** (a product feature), not internal plumbing. The /prd interview should likely route as "new product/feature" (Q1-Q4) to get demand validation (Q1) and target user specificity (Q3). Let the human decide during the interview.

**Approach:** Start `/prd`, cite existing material from `docs/forge-harness-plan.md` (lines 273-310), `docs/primitive-backlog.md` (lines 111-138), `docs/harness-improvement-roadmap.md` (lines 287-399), and the old spec. The diagnostic validates and challenges existing thinking rather than creating from scratch.

### D2: Old Phase 3 Spec Has 8 Major Gaps

The `2026-04-03-phase3-forge-generate.md` was written BEFORE the three-tier system. It's missing:

| Gap | Old Spec | Latest Design |
|-----|----------|---------------|
| RunContext | Absent | Must initialize on every call |
| CostTracker | Absent | Token tracking, advisory budget, OAuth labeling |
| ProgressReporter | Absent | Stderr logging, dynamic stages |
| AuditLog | Absent | .forge/audit/ JSONL, decision logging |
| Run Records | "Deferred to Phase 4" | Phase 3 MUST write to .forge/runs/ |
| Context Injection | Absent | `context` param with memory/KB |
| Three-Tier Docs | Absent | documentTier, visionDoc, masterPlan inputs |
| Document Lineage | Absent | affectedPaths + traceback to master phases |

The old spec's 8 GAN elements and core architecture are still valid. The gap is infrastructure wrapping.

**Important distinction:** 5 of 8 gaps (RunContext, CostTracker, ProgressReporter, AuditLog, Run Records infra) already exist as shipped code (v0.7.0). forge_generate needed to **integrate** with them (initialize RunContext, wire ProgressReporter/AuditLog/CostTracker, write run records), not rebuild them. Note: forge_generate does NOT call Claude (NFR-01) — it assembles briefs for the calling session. The 3 genuinely new items (Context Injection, Three-Tier Doc inputs, Document Lineage) are now shipped in PH-02 (v0.14.0) and PH-03 (v0.15.0). **All 8 gaps are resolved.**

### D3: Master Plan + Phase Plans Written Manually (Option B)

API key exists in `~/.bashrc` but we use mocks when possible. The master plan and phase plans will be **manually written** following the three-tier format, using the existing spec + latest design as input. This dogfoods the document structure without burning API tokens.

**Flow:**
1. `/prd` → Vision Doc (interactive, no API)
2. Manually write master plan (following MasterPlan v1.0.0 schema)
3. Manually write phase plans (following ExecutionPlan v3.0.0 schema with documentTier/phaseId)
4. Run `forge_evaluate(coherence)` to validate alignment (uses API — justified, no mock equivalent)

---

## Task Breakdown

### Task 1: Fix Failing Test + Enhancement Cleanup
**Failing test:** `server/lib/codebase-scan.test.ts:106` — "throws for non-existent path"
- Root cause: Windows platform issue with `stat("/nonexistent/path/xyz")`
- Fix: Make test platform-safe or fix the error path in codebase-scan.ts

**Enhancements #60-62:** All test-quality, narrow scope:
- #60: Replace Unix-only `tail/head` in dogfood ACs
- #61: Extract shared JSON parsing test utility
- #62: Replace magic mock.calls[N] indices

### Task 2: Create PRD for forge_generate via /prd
Interactive session. Cite existing material during the interview:
- `docs/forge-harness-plan.md:273-310` — architecture, GAN loop, 8 elements
- `docs/primitive-backlog.md:111-138` — backlog items for generate
- `docs/harness-improvement-roadmap.md:287-399` — token-saving techniques
- `.ai-workspace/plans/2026-04-03-phase3-forge-generate.md` — old spec (reference, not source of truth)

Output: PRD at a path like `docs/forge-generate-prd.md`

### Task 3: Write Master Plan + Phase Plans (manual, three-tier format)
Using the PRD from Task 2 (16 REQs) + latest design docs:
- Write a MasterPlan v1.0.0 JSON decomposing forge_generate into 4 phases (core loop, infrastructure, three-tier, integration)
- Write ExecutionPlan v3.0.0 phase plans for each phase, mapping all 16 REQs and 6 NFRs
- Schema additions first: `baselineCheck` on ExecutionPlan, `lineage` on Story
- Integrate with existing infrastructure (RunContext, CostTracker, ProgressReporter, AuditLog, run records) — these exist, don't rebuild
- Run `forge_evaluate(coherence)` to validate tier alignment (API call — no mock alternative) with zero CRITICAL gaps threshold

### Task 4: Implement forge_generate (4 sessions, one per phase)
Execute each of the 4 phase plans from Task 3 (PH-01 → PH-02 → PH-03 → PH-04). Each session implements one phase and ships as a PR. Sessions 5 and 6 (PH-02/PH-03) can run in parallel.

### Task 5: Divergence Measurement
Run `forge_evaluate(divergence)` post-implementation. Compare against 93-item baseline.

---

## Session Prompts

### Session 1: Fix Test + Enhancement Cleanup
```
Two tasks:

1. Fix the 1 failing test: `server/lib/codebase-scan.test.ts` line 106 — "throws for non-existent path". It fails on Windows because stat("/nonexistent/path/xyz") doesn't throw as expected — it resolves to a drive-root-relative path. Fix the root cause in codebase-scan.ts or make the test platform-safe. Target: 280/280 tests pass.

2. Fix enhancement issues #60, #61, #62:
   - #60: Replace Unix-only shell commands (tail/head) in dogfood test ACs with cross-platform alternatives
   - #61: Extract shared JSON parsing test utility from three-tier-integration.test.ts
   - #62: Replace magic mock.calls[N] indices with resilient matching (e.g., find by content or .at(-1))

Ship as a single PR. All 280 tests must pass.
```

### Session 2: Create PRD for forge_generate (interactive)
```
I want to create a PRD for the forge_generate primitive using the /prd skill.

Before starting the interview, read these reference files so you can help me answer the diagnostic questions efficiently:
- docs/forge-harness-plan.md (lines 273-342) — forge_generate architecture, GAN loop, 8 elements, cost tracking
- docs/primitive-backlog.md (lines 111-138) — generate backlog items
- docs/harness-improvement-roadmap.md (lines 287-399) — token-saving techniques for GAN loops
- .ai-workspace/plans/2026-04-03-phase3-forge-generate.md — old Phase 3 spec (reference only, has 8 major gaps vs latest design)

Key context for the interview:
- forge_generate is a user-facing MCP tool primitive — let the human decide the /prd routing (new product vs enhancement vs internal tooling) during the interview; do NOT pre-select
- It must integrate with existing three-tier infrastructure (RunContext, CostTracker, ProgressReporter, AuditLog already shipped in v0.7.0) and add new capabilities (context injection param, three-tier doc inputs, document lineage)
- The GAN loop core (8 elements) from the old spec is still valid
- No Claude API calls from the MCP tool itself — it's a brief assembler + loop controller

Run /prd and guide me through it. Save the output PRD to docs/forge-generate-prd.md.
```

### Session 3: Write Master Plan + Phase Plans (three-tier dogfood)
```
Read the forge_generate PRD at docs/forge-generate-prd.md.
Also read:
- server/types/execution-plan.ts — current ExecutionPlan and Story interfaces
- server/types/master-plan.ts — MasterPlan schema
- server/validation/execution-plan.ts — current validation rules
- server/tools/generate.ts — current stub (input schema baseline)
- .ai-workspace/plans/2026-04-03-phase3-forge-generate.md — old spec for reference
- docs/forge-harness-plan.md (lines 273-342) — forge_generate architecture section

Tasks:

1. Write a MasterPlan v1.0.0 for forge_generate, decomposing the PRD's 16 REQs into 4 phases:

   PH-01: Types, Schema, and Core Loop
   - Story 1: Schema additions — add optional `baselineCheck?: string` to ExecutionPlan
     and optional `lineage?: {tier, sourceId}` to Story, with validation updates
     (both optional, backward compatible)
   - Stories 2-N: Core brief assembly (REQ-01 init brief, REQ-02 fix brief), all 5
     stopping conditions (REQ-03 plateau, REQ-04 no-op, REQ-05 max-iterations,
     REQ-07 inconclusive, REQ-15 baseline-failed diagnostics), structured escalation
     reports (REQ-06), and fix-path output additions (REQ-13 fail-fast eval hints,
     REQ-14 diff manifest)
   - This is the largest phase (~6-8 stories). All types (GenerationBrief, FixBrief,
     EscalationReport, etc.) are defined here.

   PH-02: Infrastructure Integration
   - RunContext wiring (REQ-12): create RunContext with toolName "forge_generate",
     wire ProgressReporter stages, AuditLog entries, CostTracker with $0
   - JSONL self-tracking (REQ-08): append to .forge/runs/data.jsonl
   - Cost estimation output (REQ-16): character-count heuristic, projectedIterationCostUsd
   - Dependencies: [PH-01]

   PH-03: Three-Tier Document Integration
   - Three-tier document inputs (REQ-09): prdContent, masterPlanContent,
     phasePlanContent params → brief.documentContext
   - Context injection (REQ-10): contextFiles param → brief.injectedContext
   - Document lineage pass-through (REQ-11): read story.lineage from plan → brief.lineage
   - Dependencies: [PH-01]

   PH-04: MCP Handler, Registration, and Integration Tests
   - Expand the input schema in generate.ts to accept all params: planJson, planPath,
     evalReport, iteration, maxIterations, previousScores, fileHashes, projectPath,
     prdContent, masterPlanContent, phasePlanContent, contextFiles
   - Wire handleGenerate to call the core logic from PH-01/02/03
   - Integration tests: full init→fix→escalate cycle, NFR verification (zero callClaude
     imports, <5s response time, Windows path safety)
   - Dogfood: run forge_generate against a real execution plan with real ACs
   - Dependencies: [PH-02, PH-03]

   Include crossCuttingConcerns: ["NFR-01: zero callClaude usage",
   "NFR-03: Windows-safe paths and timestamps",
   "NFR-05: graceful degradation for observability failures"]

   Save as .ai-workspace/plans/forge-generate-master-plan.json

2. Write ExecutionPlan v3.0.0 phase plans for each of the 4 phases. Each plan must:
   - Set documentTier: "phase" and phaseId matching the master plan
   - Have stories with binary, shell-executable acceptance criteria (commands that
     exit 0 on pass)
   - Include the schema change story in PH-01 with ACs that grep for the new fields
     in types and validation
   - Map every REQ (01-16) to at least one story across all phase plans
   - Map every NFR (01-06) to at least one AC or cross-cutting concern
   Save each as .ai-workspace/plans/forge-generate-phase-{PH-NN}.json

3. Run forge_evaluate(coherence) with:
   - prdContent: the full PRD from docs/forge-generate-prd.md
   - masterPlanContent: the master plan JSON
   - phasePlans: all 4 phase plan JSONs with their phaseIds

   Validate the coherence report against these thresholds:
   - Zero CRITICAL gaps (any CRITICAL = fix required)
   - At most 2 MAJOR gaps (document justification if not fixing)
   - REQ coverage: every REQ-01 through REQ-16 appears in at least one phase plan story
   - SC traceability: every SC-01 through SC-09 is achievable from the combined stories
   Save the coherence report.

4. If coherence gaps are found, fix the plans and re-run coherence eval (max 2 iterations).

Ship the plans and coherence report as a PR.
```

### Session 4: Implement PH-01 — Types, Schema, and Core Loop (8 stories)
```
Read these files for context:
- .ai-workspace/plans/forge-generate-master-plan.json — master plan (focus on PH-01)
- .ai-workspace/plans/forge-generate-phase-PH-01.json — phase plan (8 stories, your implementation spec)
- docs/forge-generate-prd.md — PRD for vision context (REQ-01 through REQ-07, REQ-13 through REQ-15)
- server/types/execution-plan.ts — current interfaces (you'll add baselineCheck and lineage)
- server/validation/execution-plan.ts — current validation (you'll update for new fields)
- server/tools/evaluate.ts — loadPlan logic to extract into server/lib/plan-loader.ts
- server/lib/codebase-scan.ts — scanCodebase used in brief assembly

Implement Phase PH-01: Types, Schema, and Core Loop.

Story order matters — follow dependencies:
1. PH01-US01: Schema additions (baselineCheck on ExecutionPlan, lineage on Story) + validation
2. PH01-US02: Define GenerateResult, GenerationBrief, FixBrief, Escalation, CostEstimate, DiffManifest types
3. PH01-US03: Extract loadPlan from evaluate.ts into server/lib/plan-loader.ts (evaluate.ts must still work)
4. PH01-US04: Init brief assembly (buildBrief) — depends on US02, US03
5. PH01-US05: Fix brief assembly + eval hints + diff manifest (REQ-02, REQ-13, REQ-14)
6. PH01-US06: All 5 stopping conditions (REQ-03/04/05/07/15)
7. PH01-US07: Structured escalation reports (REQ-06) — depends on US06
8. PH01-US08: Core orchestrator (assembleGenerateResult) — depends on US04-US07

Key constraints:
- NFR-01: Zero callClaude imports anywhere in generate's dependency chain
- NFR-03: Windows-safe paths (path.join, no colons in filenames)
- All existing tests must continue passing (currently 280)
- Each story has shell-executable ACs in the phase plan — verify they pass

Ship as a PR.

After shipping, update the sessions plan and backlog:
- Mark this session's checkpoint complete with results
- Review the next session's prompt — update if implementation revealed surprises
- Update docs/primitive-backlog.md: move shipped items to "Already Implemented" with version tags
- Run /coherent-plan on the sessions plan
```

### Session 5: Implement PH-02 — Infrastructure Integration (3 stories)
```
Read these files for context:
- .ai-workspace/plans/forge-generate-master-plan.json — master plan (focus on PH-02)
- .ai-workspace/plans/forge-generate-phase-PH-02.json — phase plan (3 stories)
- docs/forge-generate-prd.md — PRD (REQ-08, REQ-12, REQ-16)
- server/lib/run-context.ts — RunContext, CostTracker, ProgressReporter, AuditLog (already shipped)
- server/lib/generator.ts — core logic from PH-01 (assembleGenerateResult, buildBrief, buildFixBrief, checkStoppingConditions, buildEscalation, buildDiffManifest, computeScore — you'll add infrastructure wiring)
- server/lib/plan-loader.ts — shared loadPlan extracted from evaluate.ts in PH-01
- server/types/generate-result.ts — all types (GenerateResult, CostEstimate already defined here)

Implement Phase PH-02: Infrastructure Integration.
PH-01 is complete (PR #71, v0.13.0). 326 tests currently passing.

Stories:
1. PH02-US01: Wire RunContext with toolName 'forge_generate', ProgressReporter stages, AuditLog, CostTracker ($0)
2. PH02-US02: JSONL self-tracking to .forge/runs/data.jsonl (append-only, graceful on failure)
3. PH02-US03: Cost estimation output (character-count / 4 heuristic, projectedIterationCostUsd)

Key constraint: NFR-05 — all observability failures must degrade gracefully (no blocking core response).
Note: CostEstimate type is already defined in server/types/generate-result.ts (briefTokens, projectedIterationCostUsd, projectedRemainingCostUsd).

All 326 existing tests must still pass.
Ship as a PR.

After shipping, update the sessions plan and backlog:
- Mark this session's checkpoint complete with results
- Review the next session's prompt — update if implementation revealed surprises
- Update docs/primitive-backlog.md: move shipped items to "Already Implemented" with version tags
- Run /coherent-plan on the sessions plan
```

### Session 6: Implement PH-03 — Three-Tier Document Integration (3 stories)
```
Read these files for context:
- .ai-workspace/plans/forge-generate-master-plan.json — master plan (focus on PH-03)
- .ai-workspace/plans/forge-generate-phase-PH-03.json — phase plan (3 stories)
- docs/forge-generate-prd.md — PRD (REQ-09, REQ-10, REQ-11)
- server/lib/generator.ts — core logic from PH-01 (buildBrief already returns lineage from story; you'll add documentContext and injectedContext to the brief assembly)
- server/types/generate-result.ts — types from PH-01 (GenerationBrief already has documentContext?: DocumentContext, injectedContext?: string[], lineage?: StoryLineage fields defined)
- server/types/execution-plan.ts — Story.lineage?: StoryLineage field from PH-01

Implement Phase PH-03: Three-Tier Document Integration.
PH-01 complete (PR #71, v0.13.0). PH-02 complete (PR #77, v0.14.0). 343 tests currently passing.

Note: PH-02 added `assembleGenerateResultWithContext` as the infrastructure-wrapped entry point (decorator pattern over pure `assembleGenerateResult`). PH-03 changes go into `buildBrief` and `AssembleInput` — the wrapper will automatically pick them up. buildBrief already passes through story.lineage (US03 may already be partially done). Verify and add tests.

Stories:
1. PH03-US01: Accept prdContent, masterPlanContent, phasePlanContent → brief.documentContext
2. PH03-US02: Accept contextFiles → brief.injectedContext (skip missing files with warning)
3. PH03-US03: Pass through story.lineage from plan to brief.lineage (partially implemented — verify + test)

All fields are optional — omission produces no error.
All 343 existing tests must still pass.
Ship as a PR.

After shipping, update the sessions plan and backlog:
- Mark this session's checkpoint complete with results
- Review the next session's prompt — update if implementation revealed surprises
- Update docs/primitive-backlog.md: move shipped items to "Already Implemented" with version tags
- Run /coherent-plan on the sessions plan
```

### Session 7: Implement PH-04 — MCP Handler and Integration Tests (4 stories)
```
Read these files for context:
- .ai-workspace/plans/forge-generate-master-plan.json — master plan (focus on PH-04)
- .ai-workspace/plans/forge-generate-phase-PH-04.json — phase plan (4 stories)
- docs/forge-generate-prd.md — PRD (all REQs, all NFRs, all SCs)
- server/tools/generate.ts — stub from PH-01 era (will be replaced with full MCP handler)
- server/index.ts — tool registration
- server/lib/generator.ts — complete core logic from PH-01/02/03

Implement Phase PH-04: MCP Handler, Registration, and Integration Tests.
PH-01 complete (PR #71, v0.13.0). PH-02 complete (PR #77, v0.14.0). PH-03 complete (PR #82, v0.15.0). 360 tests currently passing.

Key architecture from prior phases:
- Entry point: `assembleGenerateResultWithContext(input: AssembleInput)` — infrastructure-wrapped (PH-02 decorator over pure `assembleGenerateResult`)
- `AssembleInput` includes: storyId, planJson, planPath, evalReport, iteration, maxIterations, previousScores, fileHashes, previousFileHashes, projectPath, baselineDiagnostics, isMaxUser, prdContent, masterPlanContent, phasePlanContent, contextFiles
- `BuildBriefOptions` carries PH-03 document fields (prdContent, masterPlanContent, phasePlanContent, contextFiles)
- `buildBrief(plan, storyId, projectPath?, options?)` — 4th param is optional BuildBriefOptions

Stories:
1. PH04-US01: Expand generateInputSchema to accept all AssembleInput fields
2. PH04-US02: Wire handleGenerate to call assembleGenerateResultWithContext (NOT bare assembleGenerateResult)
3. PH04-US03: Integration tests — full init→fix→escalate cycle + all 6 NFR checks
4. PH04-US04: Dogfood — run forge_generate against a real execution plan, document results

NFR verification checklist (must all pass):
- NFR-01: Zero callClaude imports in generate's full dependency chain
- NFR-02: <5s init, <2s iteration response time
- NFR-03: Windows-safe paths
- NFR-04: Read-only (no project file mutations)
- NFR-05: Graceful degradation for observability failures
- NFR-06: Accepts ExecutionPlan schemaVersion 3.0.0

All 360 existing tests must still pass.
Ship as a PR.

After shipping, update the sessions plan and backlog:
- Mark this session's checkpoint complete with results
- Review the next session's prompt — update if implementation revealed surprises
- Update docs/primitive-backlog.md: move shipped items to "Already Implemented" with version tags
- Run /coherent-plan on the sessions plan
- Use /mailbox to send a structured progress update to forge-plan (you are {session-name}):
  - Phase completed, PR number, version, test count
  - Any surprises or deviations from the plan
  - Whether replanning is needed (and why/why not)
  - What's unblocked next
```

### Final Session: Divergence Measurement
```
Read .ai-workspace/plans/2026-04-06-three-tier-document-system.md for context on the divergence evaluation system.

Run forge_evaluate(divergence) on the forge-harness codebase to measure the current divergence count. The pre-three-tier baseline was 93 items (~35% divergence). Compare results and classify each remaining item as:
- Fixed (no longer divergent)
- Intentional/accepted (documented deviation)
- Remaining gap (needs future work)

Save the results to .ai-workspace/divergence-baseline-post-three-tier.md.

After completing, update the sessions plan:
- Mark the Final checkpoint complete with divergence results
- Use /mailbox to send a structured progress update to forge-plan (you are {session-name}):
  - Divergence count vs 93-item baseline
  - Items fixed, accepted, remaining
  - Whether replanning is needed
```

---

## Session Grouping Summary

| Session | Phase | Stories | Dependencies | Notes |
|---------|-------|---------|-------------|-------|
| **1** | Fix test + #60/#61/#62 | — | None | DONE (PR #63, v0.11.1) |
| **2** | /prd for forge_generate | — | None | DONE (docs/forge-generate-prd.md) |
| **3** | Master plan + phase plans | — | Session 2 | DONE (PR #66, v0.12.0) |
| **4** | PH-01: Types + Core Loop | 8 | None | DONE (PR #71, v0.13.0) |
| **5** | PH-02: Infrastructure | 3 | Session 4 | DONE (PR #77, v0.14.0) |
| **6** | PH-03: Three-Tier Docs | 3 | Session 4 | DONE (PR #82, v0.15.0) |
| **7** | PH-04: MCP Handler + Tests | 4 | Sessions 5 + 6 | DONE (PR #85, v0.16.0) |
| **Final** | Divergence measurement | — | Session 7 | DONE (80 items, forward 0%) |

All 8 sessions complete. forge_generate fully shipped (v0.11.1 → v0.16.0) with divergence validated.

## Verification
- Session 1: 280/280 tests pass, issues #60/#61/#62 closeable — **DONE**
- Session 2: PRD file exists with REQ-NN IDs, binary ACs, no HOW sections — **DONE**
- Session 3: MasterPlan (4 phases) + phase plans pass forge_evaluate(coherence) with zero CRITICAL gaps, all 16 REQs mapped, all 9 SCs traceable — **DONE**
- Session 4: PH01-US01 through PH01-US08 ACs pass, TypeScript compiles, 326 tests pass — **DONE**
- Session 5: PH02-US01 through PH02-US03 ACs pass, JSONL append-only verified, graceful degradation verified, 326+ tests pass — **DONE**
- Session 6: PH03-US01 through PH03-US03 ACs pass, all document fields optional, no errors on omission, 360/360 tests pass — **DONE**
- Session 7: PH04-US01 through PH04-US04 ACs pass, all 6 NFRs verified, full test suite green, dogfood report written — **DONE**
- Final: Divergence count < 93 baseline, or remaining items classified

## Checkpoint

- [x] Session 1: Fix failing test + enhancements #60/#61/#62 — PR #63 merged, v0.11.1 released, 280/280 tests, closes #60/#61/#62
- [x] Session 2: Create PRD for forge_generate via /prd — exported to docs/forge-generate-prd.md, 16 REQs (12 base + 4 SELECTIVE EXPAND expansions), routed as "new feature" (Q1-Q4), all 3 open questions resolved, 6 NFRs, 9 success criteria
- [x] Session 3: Write master plan + phase plans + coherence eval — PR #66 merged, v0.12.0 released, MasterPlan (4 phases) + 4 phase plans + coherence report (0C/0M, 16/16 REQs, 9/9 SCs), verified by forge-plan. Enhancement issues created: #67, #68, #69
- [x] Session 4: Implement PH-01 — Types, Schema, and Core Loop (8 stories) — PR #71 merged, v0.13.0 released, 326/326 tests (46 new), review PASS (0 bugs, 4 enhancements → #72, #73). Plateau detection: "last 2 of 3+ scores equal" per PRD examples.
- [x] Session 5: Implement PH-02 — Infrastructure Integration (3 stories) — PR #77 merged, v0.14.0 released, 343/343 tests (17 new), review PASS (0 bugs, 5 enhancements → #78, #79, #80, #81). Wrapper pattern: `assembleGenerateResultWithContext` decorates pure core with RunContext/JSONL/CostEstimate.
- [x] Session 6: Implement PH-03 — Three-Tier Document Integration (3 stories) — PR #82 merged, v0.15.0 released, 360/360 tests (17 new), review PASS (0 bugs, 2 enhancements → #83, #84). BuildBriefOptions pattern: optional 4th param to buildBrief avoids breaking existing callers. Lineage pass-through was already implemented in PH-01, locked down with 4 dedicated tests.
- [x] Session 7: Implement PH-04 — MCP Handler and Integration Tests (4 stories) — PR #85 merged, v0.16.0 released, 383/383 tests (23 new), review PASS (0 bugs, 4 enhancements → #86, #87, #88, #89). Input schema expanded to 15 zod fields. handleGenerate wired to assembleGenerateResultWithContext. All 6 NFRs verified. Dogfood report confirms init/fix/escalate paths work with real plan data. CI had 1 retry (unused import).
- [x] Final: Divergence measurement — 80 items total (down from 93 baseline, -14%). Forward divergence: 0% (was 35%). 91/92 ACs pass (1 false positive). Reverse: 52 pre-existing accepted + 26 new forge_generate accepted. 2 remaining forward gaps (low priority). Full report: `.ai-workspace/divergence-baseline-post-three-tier.md`

Last updated: 2026-04-07T21:35:00+08:00
