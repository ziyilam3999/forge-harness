# Plan: forge_coordinate Implementation

## Context

forge_generate is **complete** (v0.16.0, 383 tests, 0% forward divergence — unverified, based on prior session report). All 8 sessions shipped. The forge-harness project has 93 documentation/source files indexed in `.ai-workspace/PROJECT-INDEX.md` (169 lines, 7 topics, 100% freshness coverage).

VERIFIED: package.json version "0.16.0" found at `server/../package.json` — `"version": "0.16.0"`
VERIFIED: PROJECT-INDEX.md is 169 lines with 7 topics and 93 files

**Deliverable:** forge_coordinate implementation — applying the same proven approach (PRD → Master Plan → Phase Plans → session-based implementation) with dogfooding forge_generate during implementation.

**Project Index:** Complete. `/project-index` skill shipped (ai-brain PR #187), forge-harness index generated. All agents read `PROJECT-INDEX.md` first to navigate the codebase.

## ELI5

We already built three workers: one makes plans, one writes code briefs, one grades the code. Now we need a foreman. The foreman looks at a plan, figures out which tasks to do in what order (some tasks depend on others), watches the clock and the budget, and if something goes wrong, flags it for the human boss instead of guessing.

The foreman doesn't DO the work — it assembles a "here's what to do next and why" briefing, and the human (or calling session) runs the actual workers. Think of it as a smart clipboard that organizes all the signals into one clear recommendation.

The twist: we'll use forge_generate (the tool we just built) to help build forge_coordinate. Dogfooding.

---

## Part 1: Project Knowledge Index — COMPLETE

- `/project-index` skill shipped: ai-brain PR #187, 173-line SKILL.md, audit HEALTHY (17/17)
- forge-harness index: 93 files, 7 topics, 169 lines, 12 Quick Start rows, 100% freshness
- File: `.ai-workspace/PROJECT-INDEX.md`

---

## Part 2: forge_coordinate Implementation

### Current State (verified against codebase)

- `server/tools/coordinate.ts` — 16-line stub, exports `coordinateInputSchema` (planPath only) and `handleCoordinate` returning "not yet implemented"
- Design decisions: `docs/primitive-backlog.md` lines 153-205, `docs/forge-harness-plan.md` lines 314-352
- **Cycle detection** in `server/validation/execution-plan.ts` — DFS 3-color algorithm, but `detectCycles()` is **private** (not exported). Must either export it or reimplement in topo-sort.ts. **Note:** `detectCycles` accepts `Array<Record<string, unknown>>`, not `Story[]` — a typed wrapper or cast is needed when calling from topoSort
- **Run records** exist in TWO systems: (a) `server/lib/run-record.ts` writes individual JSON files to `.forge/runs/{tool}-{ts}-{hex}.json` (used by forge_evaluate coherence/divergence modes and forge_plan), (b) `server/lib/generator.ts` writes JSONL to `.forge/runs/data.jsonl` (used by forge_generate, already includes `storyId`). **Important:** `handleStoryEval` does NOT write any RunRecord — only the coherence (line 217) and divergence (line 380) handlers do
- **Audit logs** stored as JSONL in `.forge/audit/{tool}-{ts}.jsonl`. `AuditLog` class has **write-only API** (`log()`, `getFilePath()`). No read/parse API exists — coordinate must create one
- **CostTracker.isOverBudget()** exists and works. Returns true when `totalCostUsd > budgetUsd`. Returns **false when either value is null** (missing data reads as "under budget"). `remainingBudgetUsd()` also available (returns null when data missing)
- **ProgressReporter** accepts dynamic stages (appends unknown stage names). Methods: `begin()`, `complete()`, `fail()`, `skip()`, `getResults()`
- **RunContext** bundles CostTracker + ProgressReporter + AuditLog. Constructor: `{toolName, projectPath, stages, budgetUsd, isOAuth}`
- **RunRecord (run-record.ts) has no storyId field.** The interface contains: `timestamp`, `tool`, `documentTier`, `mode`, `tier`, `metrics`, `outcome`. It cannot associate a run with a specific story. **RunRecord.metrics has no dollar-cost field** — only `inputTokens`, `outputTokens`, `critiqueRounds`, `findingsTotal`, `findingsApplied`, `findingsRejected`, `validationRetries`, `durationMs`
- **RunRecord (generator.ts) HAS storyId.** The interface contains: `timestamp`, `storyId`, `iteration`, `action`, `score`, `durationMs`. Written as JSONL to `data.jsonl`
- **EvalReport has storyId + verdict** (`server/types/eval-report.ts`), but EvalReport is returned as MCP response text — it is NOT persisted to disk by any existing code

VERIFIED: `coordinate.ts` is 16 lines — `wc -l` = 16, exports schema + handler stub
VERIFIED: `detectCycles` is NOT exported — `grep 'export.*detectCycles'` returns no matches; function at line 170 has no `export` keyword
VERIFIED: `detectCycles` accepts `Array<Record<string, unknown>>` — `server/validation/execution-plan.ts:170-172`
VERIFIED: `RunRecord` interface at `server/lib/run-record.ts:9-26` has no `storyId` field
VERIFIED: `RunRecord.metrics` has no `costUsd` field — `server/lib/run-record.ts:15-24` — only has token counts and duration
VERIFIED: `RunRecord` interface at `server/lib/generator.ts:364-371` HAS `storyId: string`
VERIFIED: `generator.ts:writeRunRecord` writes JSONL to `.forge/runs/data.jsonl` — `appendFile(filePath, JSON.stringify(record) + "\n")`
VERIFIED: `run-record.ts:writeRunRecord` writes individual JSON to `.forge/runs/{tool}-{ts}-{hex}.json`
VERIFIED: `EvalReport` at `server/types/eval-report.ts:1-6` has `storyId: string` and `verdict: "PASS" | "FAIL" | "INCONCLUSIVE"`
VERIFIED: No code writes EvalReport to disk — `grep 'writeFile.*eval|\.forge.*eval'` across `server/` returns no matches
VERIFIED: `CostTracker.isOverBudget()` at `server/lib/cost.ts:123-125` returns `false` when `totalCostUsd` is `null`
VERIFIED: `handleStoryEval` (lines 121-137) does NOT call `writeRunRecord` — returns JSON report directly with no RunContext infrastructure
VERIFIED: `handleCoherenceEval` DOES call `writeRunRecord` at line 217; `handleDivergenceEval` at line 380
VERIFIED: `MasterPlan.Phase` has no file path to phase plan — only `id`, `title`, `description`, `dependencies`, `inputs`, `outputs`, `estimatedStories`

### What forge_coordinate Does

**Core role:** Lightweight orchestrator that composes forge_plan + forge_generate + forge_evaluate into complete workflows. Does NOT execute stories — assembles status and recommendations.

**Advisory mode (default, $0):** Each call:
1. Load execution plan + read prior run state from `.forge/runs/*.json` and `.forge/runs/data.jsonl`, plus eval results from persisted state (see State Source Design below)
2. Topologically sort stories within the target phase
3. Walk sorted stories, classify each as: done (prior eval PASS) / ready (deps satisfied) / blocked (dep failed or INCONCLUSIVE) / pending
4. Check budget/time constraints against accumulated token counts from prior runs (see Budget Design below)
5. Assemble a PhaseTransitionBrief with all signals + recommendations
6. Return the brief — caller decides and acts

**Phase selection:** `phaseId` is **required** in v1. The caller specifies which phase to assess. Auto-detection of the first incomplete phase is deferred to v2 because it requires loading all phase plans, and there is no mechanism to discover phase plan file paths from the MasterPlan (the `Phase` interface has no `planPath` field). This keeps v1 simple: one phase plan in, one brief out.

**Calling pattern:** The calling Claude Code session calls coordinate → reads brief → runs forge_generate+evaluate on "ready" stories → calls coordinate again → updated brief → repeat until phase complete or halted. Coordinate is called multiple times per phase, stateless each time (reads state from files).

**Autonomous mode (escape hatch):** Makes LLM calls for triage when state is ambiguous. Not in v1 — deferred.

### State Source Design

**Problem:** Coordinate must know which stories are done/failed/inconclusive. The primary RunRecord (run-record.ts) lacks `storyId` and eval `verdict`. EvalReport has both fields but is not persisted to disk. The generator's RunRecord (generator.ts) has `storyId` but no eval verdict. Additionally, `handleStoryEval` does not call `writeRunRecord` at all — only the coherence and divergence handlers do.

**Resolution — two parts:**

**(A) Extend RunRecord (run-record.ts) with two optional fields** (per pattern P50 — Additive Optional Fields, no version bump needed):

```typescript
// Added to RunRecord interface in server/lib/run-record.ts:
storyId?: string;      // Story this run was for (e.g., "US-01")
evalVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";  // Eval verdict, when tool is forge_evaluate
```

**(B) Add RunContext infrastructure + writeRunRecord call to `handleStoryEval`.** Unlike the coherence and divergence handlers which already have RunContext setup and `writeRunRecord` calls, `handleStoryEval` (lines 121-137) currently has NONE of this infrastructure — it only loads the plan, calls `evaluateStory`, and returns the JSON report. The write-side update requires: (1) adding `RunContext` construction (matching the pattern in `handleCoherenceEval`, ~10 lines), (2) wrapping the evaluation in the tracked context, (3) adding a `writeRunRecord` call with `storyId` and `evalVerdict` populated. This is a ~25-line change, not a one-line field pass-through. Both values needed are already available: `storyId` from the input, `verdict` from the EvalReport returned by `evaluateStory`.

`NEW_CLAIM: handleStoryEval needs full RunContext infrastructure added, not just field population — source: Critic 2 Finding #1; verified that lines 121-137 have no RunContext, no cost tracking, no writeRunRecord call`

**Why RunRecord and not a separate state file:** RunRecord is already the canonical per-invocation artifact written to `.forge/runs/`. Adding optional fields keeps one state source, avoids a second file format, and maintains backward compatibility (old records simply lack these fields — coordinate treats missing storyId as "unmatched" and skips the record for story classification).

**Alternative considered and rejected:** Using EvalReport as state source. EvalReport is only returned as MCP response text and has no disk persistence. Adding disk writes to the evaluator would work but introduces a second state directory and coordination concern. Extending RunRecord is simpler.

**Note on dual RunRecord systems and their distinct roles:** The generator has its own RunRecord interface and JSONL writer in `server/lib/generator.ts`. The two RunRecord types have **incompatible schemas** — they serve different purposes:
- **run-record.ts JSON files** (`.forge/runs/*.json`): Authoritative source for story status classification. After the write-side update, these contain `storyId` + `evalVerdict` for forge_evaluate story-mode runs. `assessPhase` uses `evalVerdict` from these records to classify stories as done/failed/blocked.
- **generator.ts JSONL** (`.forge/runs/data.jsonl`): Supplementary metadata only. Provides `storyId` + `iteration` + `score` for velocity tracking and observability (how many iterations per story, what scores were achieved). These records have NO `evalVerdict` and CANNOT determine story completion status.

`readRunRecords()` reads both sources but returns them in a discriminated union or tagged format so consumers know which source a record came from. `assessPhase` uses only the run-record.ts records for story classification; generator records feed into observability (`aggregateStatus`) only.

### Budget Design

**Problem:** RunRecord.metrics has no dollar-cost field. It stores `inputTokens` and `outputTokens` but not a dollar amount. Token-to-dollar conversion rates vary by model and are not recorded in the RunRecord. CostTracker tracks cost per-run internally but that data is not persisted.

**Resolution — add optional `estimatedCostUsd` to RunRecord.metrics:**

```typescript
// Added to RunRecord.metrics in server/lib/run-record.ts:
estimatedCostUsd?: number | null;  // Dollar cost estimate, from CostTracker.totalCostUsd
```

This is populated at `writeRunRecord` time from `CostTracker.totalCostUsd` (which computes cost from token counts using model pricing). The field is optional and nullable — old records without it are treated as unknown cost (not $0). `checkBudget` aggregates `estimatedCostUsd` across prior records, logging a warning (P45) when any record has null/missing cost data.

`NEW_CLAIM: Add estimatedCostUsd to RunRecord.metrics — source: Critic 2 Finding #6; verified that RunRecord.metrics currently has only inputTokens/outputTokens with no dollar amount, making cross-run budget aggregation infeasible`

**Alternative considered and rejected:** Token-count-based budgeting. Mixing token counts across different models (which have different pricing) would produce meaningless totals. Dollar-cost normalization is the correct unit for cross-run aggregation.

### Phase Decomposition (4 phases, 20 stories)

#### PH-01: Types, Topological Sort, State Readers, Core Dispatch Loop (7 stories)

| Story | What | New File |
|-------|------|----------|
| US-00 | **Pre-requisite: forge_evaluate write-side update.** Add RunContext infrastructure to `handleStoryEval` (matching `handleCoherenceEval` pattern: RunContext construction, cost tracking, audit logging). Add `writeRunRecord` call with `storyId` and `evalVerdict` populated from the evaluation result. Also extend RunRecord interface in `server/lib/run-record.ts` with optional `storyId`, `evalVerdict`, and `estimatedCostUsd` (in metrics) fields. **Scope note:** This is ~25 lines of new infrastructure in a handler that currently has none, not a one-line field assignment | (modify existing files) |
| US-01 | CoordinateResult, StoryStatusEntry, PhaseTransitionBrief (concrete interface — see below), CoordinateMode types | `server/types/coordinate-result.ts` |
| US-02 | `topoSort(stories: Story[]): Story[]` — Kahn's algorithm. Input: `Story[]` from `server/types/execution-plan.ts`. Export `detectCycles()` from `server/validation/execution-plan.ts` as pre-check (currently private, DFS 3-color). **Type note:** `detectCycles` accepts `Array<Record<string, unknown>>`, not `Story[]` — topoSort must cast `Story[] as Array<Record<string, unknown>>` when calling detectCycles, or provide a typed wrapper. Dual cycle detection: `detectCycles()` is the pre-check that fails fast with a descriptive error message naming the cycle; Kahn's incomplete-queue is a defensive assertion (should never fire if pre-check ran, but guards against bugs) | `server/lib/topo-sort.ts` |
| US-03 | `readRunRecords(projectPath)` — read from BOTH sources: glob `.forge/runs/forge_*-*.json` (individual JSON files from run-record.ts) AND parse `.forge/runs/data.jsonl` (JSONL from generator.ts). Return a tagged discriminated union: `{source: "primary", record: RunRecord}` for JSON files and `{source: "generator", record: GeneratorRunRecord}` for JSONL entries, sorted by timestamp. Consumers choose which source to use. Degrade gracefully: missing dir → empty array, corrupt/schema-invalid JSON → skip with `console.error` warning per P44. Also `readAuditEntries(projectPath, toolName?)` — parse `.forge/audit/*.jsonl` files, return sorted `AuditEntry[]`. Per-line try/catch for truncated JSONL lines (skip + warn). Both return empty arrays when files absent | `server/lib/run-reader.ts` |
| US-04 | `assessPhase(plan, projectPath, options)` — walk topo-sorted stories, use `readRunRecords()` to classify each as done/ready/blocked/pending. **Story classification uses only primary (run-record.ts) records** with `evalVerdict` field — generator JSONL records are ignored for status determination. Assemble dispatch recommendations. No story execution — pure status assembly | `server/lib/coordinator.ts` |
| US-05 | `assemblePhaseTransitionBrief(result, plan)` — mechanical signal aggregation, recommendation strings | in `coordinator.ts` |
| US-06 | Unit tests: topo sort (5+ — including detectCycles type-cast path), run-reader (5+ — including corrupt JSON, truncated JSONL, schema-mismatch, empty dir, normal, dual-source tagged output), dispatch loop (5+), phase transition brief (3+) | `server/lib/coordinator.test.ts`, `server/lib/run-reader.test.ts` |

**PhaseTransitionBrief interface (concrete):**

```typescript
export interface PhaseTransitionBrief {
  phaseId: string;
  status: "in-progress" | "complete" | "blocked" | "halted";
  stories: StoryStatusEntry[];       // per-story status + evidence
  readyStories: string[];            // IDs of stories ready for next cycle
  blockedStories: string[];          // IDs of blocked stories + reasons
  completedCount: number;
  totalCount: number;
  budget: {
    usedUsd: number | null;          // null when cost data unavailable
    budgetUsd: number | null;
    remainingUsd: number | null;
    incompleteData: boolean;         // true when any prior record has null/missing estimatedCostUsd
    warningLevel: "none" | "approaching" | "exceeded";
  };
  timeBudget: {
    elapsedMs: number | null;        // null when startTimeMs not provided
    maxTimeMs: number | null;
    warningLevel: "none" | "approaching" | "exceeded" | "unknown";
  };
  replanningNotes: ReplanningNote[];
  recommendation: string;            // Human-readable next-action summary
}
```

`NEW_CLAIM: Concrete PhaseTransitionBrief interface fields — source: own analysis, synthesized from the original plan's conceptual description (lines 50-53) and the NFRs (NFR-C08 brief completeness). Updated with budget.incompleteData flag (Critic 2 Finding #6) and nullable timeBudget.elapsedMs (Critic 2 Finding #5)`

**Key design:** Advisory mode = pure Intelligent Clipboard ($0). Coordinate reads state from `.forge/runs/*.json` files and `.forge/runs/data.jsonl` (written by prior forge_generate/evaluate calls), classifies stories using only the primary RunRecord source (with evalVerdict), and returns a PhaseTransitionBrief. The calling session runs the actual generate→evaluate loop. Coordinate is called repeatedly (once per cycle) to get updated recommendations.

**Note on atomic writes:** Coordinate is read-only (it reads `.forge/runs/*.json`, `.forge/runs/data.jsonl`, and `.forge/audit/*.jsonl` but does not write tracking state for other tools). It writes only its own RunRecord at the end via `writeRunRecord()`. The calling session is responsible for atomic writes of run records from forge_generate and forge_evaluate calls. This delegation is by design — coordinate has no concurrent-write concerns.

**Dependencies:** None

#### PH-02: Safety & Budget Enforcement (4 stories)

| Story | What |
|-------|------|
| US-01 | `checkBudget(ctx, budgetUsd, priorRecords)` — aggregate `estimatedCostUsd` from prior RunRecord.metrics (primary source only). Warning at 80%, stop at 100%. Budget enforcement is advisory: when exceeded, the PhaseTransitionBrief returns `warningLevel: "exceeded"` with a recommendation to "complete current story then stop" — the calling session is responsible for acting on this signal. Uses existing `CostTracker.isOverBudget()` for current-run cost. **Null handling:** when prior run records have missing/null `estimatedCostUsd`, set `budget.incompleteData = true` in the brief and log a warning per P45. Treat those records as unknown (excluded from total, not counted as $0). The brief surfaces this to the caller so they know the total is a lower bound |
| US-02 | `checkTimeBudget(startTimeMs, maxTimeMs)` — wall-clock 80%/100% enforcement, no-op when either parameter is unset. `startTimeMs` is provided by the caller via the input schema (see PH-04 US-01). When `startTimeMs` is not provided, `timeBudget.elapsedMs` is null and `timeBudget.warningLevel` is `"unknown"`. **Known limitation:** wall-clock arithmetic uses `Date.now()` and is susceptible to system clock jumps (NTP sync, DST). Documented as a known edge case — not addressed in v1. The brief's `elapsedMs` is best-effort; callers should not rely on sub-second precision |
| US-03 | INCONCLUSIVE handling — mark story blocked, transitive blocking of dependents, continue non-blocked, terminate-early when all blocked |
| US-04 | Crash recovery — `recoverState(plan, projectPath)`: use `readRunRecords()` from `run-reader.ts` (no duplicate glob+parse logic), filter primary records by `storyId` field. Stories with matching `evalVerdict: "PASS"` → done. Stories with `evalVerdict: "FAIL" \| "INCONCLUSIVE"` → use the last verdict. Records with no `storyId` (legacy/other tools) → skip. Stories with no matching records → pending. Degrades to no-op when no run files found (all stories start as pending). |

**Dependencies:** PH-01

#### PH-03: ReplanningNote, Reconciliation, Observability (5 stories)

| Story | What |
|-------|------|
| US-01 | `ReplanningNote` type with `category` (ac-drift, partial-completion, dependency-satisfied, gap-found, assumption-changed), `severity` (blocking, should-address, informational), `affectedPhases?: string[]`, `affectedStories?: string[]`, `description: string`. Route mechanically: ac-drift/assumption-changed → master update, partial-completion/dependency-satisfied → phase update, gap-found → defer, severity:blocking → halt |
| US-02 | `collectReplanningNotes(result)` — map escalation reasons to ReplanningNote categories. **Explicit mapping:** `plateau` → `partial-completion`, `no-op` → `gap-found`, `max-iterations` → `partial-completion`, `inconclusive` → `ac-drift`, `baseline-failed` → `assumption-changed`. Eval failures with verdict FAIL → `ac-drift`, verdict INCONCLUSIVE → `gap-found` |
| US-03 | `aggregateStatus(projectPath)` — uses `readRunRecords` (both sources) + `readAuditEntries` to produce per-story status + accumulated cost (from primary records' `estimatedCostUsd`) + velocity (stories/hour, from generator records' timestamps). **Edge cases:** zero completed stories → velocity = 0 (not NaN), zero elapsed time → velocity = 0 |
| US-04 | `graduateFindings(result)` — detect repeated failure patterns across stories (same escalation reason 3+ times within the current plan execution). Returns structured findings (caller writes to KB — Intelligent Clipboard). Threshold is per-plan, not global |
| US-05 | `reconcileState(plan, projectPath)` — handle plan mutations between coordinate calls. Compare story IDs in plan against story IDs in run records. Orphaned records (story removed from plan) → logged as warning, excluded from status. New stories (not in run records) → start as pending. Returns list of reconciliation actions taken. **Unit tests:** 5+ tests covering orphaned records, new stories, full plan replacement, story-rename scenario (old orphaned + new pending), and dependency-change scenario (blocked → ready reclassification) |

`NEW_CLAIM: reconcileState function (PH-03 US-05) — source: Researcher finding #6 (MAJOR: plan file mutation between coordinate calls). The original plan had no reconciliation logic for this failure mode`

`NEW_CLAIM: velocity edge case handling (zero → 0 not NaN) — source: Researcher finding #10 (MINOR: division-by-zero)`

`NEW_CLAIM: graduateFindings threshold scoped per-plan — source: Researcher finding #9 (MINOR: ambiguous threshold scope)`

**Dependencies:** PH-01, PH-02

#### PH-04: MCP Handler, Checkpoint Gates, Integration Tests, Dogfood (4 stories)

| Story | What |
|-------|------|
| US-01 | Expand `coordinateInputSchema` — planPath (req), phaseId (req in v1 — auto-detection deferred to v2), masterPlanPath, coordinateMode, budgetUsd, maxTimeMs, startTimeMs (epoch ms — anchor for time budget calculation; when omitted, time budget is reported as unknown), projectPath, prdContent, replanningNotes. Wire `handleCoordinate` to `assessPhase` |
| US-02 | Checkpoint gates — advisory: brief IS the checkpoint; autonomous: emit `checkpointRequired: true`, halt. Resume by re-calling (crash recovery picks up) |
| US-03 | Integration tests (15-20) — multi-story dispatch, budget enforcement (including incomplete cost data), time enforcement (including missing startTimeMs), crash recovery, INCONCLUSIVE blocking, advisory brief, error handling, plan mutation reconciliation, corrupt run records, empty-dependency plans, all-stories-done phase-complete |
| US-04 | Dogfood — run coordinate against a multi-story plan, verify topo sort + advisory brief + status tracking. Write dogfood report |

**Dependencies:** PH-02, PH-03

### Story Count Update

The total is **20 stories** across 4 phases (7+4+5+4=20). PH-01 has 7 stories including US-00 (forge_evaluate write-side update with full RunContext infrastructure), US-03 (readRunRecords with tagged discriminated union), and US-06 (tests). PH-03 US-05 (reconcileState) has 5+ tests.

### Intelligent Clipboard Boundary

**Mechanical ($0, no callClaude):**
- Topological sort (Kahn's algorithm on Story.dependencies)
- Story status classification: read `.forge/runs/*.json` (primary source with evalVerdict) → done/ready/blocked/pending (match by `storyId` field on RunRecord). Generator JSONL records used only for observability, not status classification
- Budget enforcement: aggregate `estimatedCostUsd` from prior primary RunRecords + call `CostTracker.isOverBudget()` for current run. Flag incomplete data when any record has null cost (P45). Signal via brief — caller enforces
- Time enforcement: wall-clock check against `maxTimeMs` using caller-provided `startTimeMs` anchor (80% warning, 100% stop). Unknown when anchor not provided
- Crash recovery: use `readRunRecords()`, filter primary records by `storyId`, classify by `evalVerdict`
- ReplanningNote routing: category → mechanical action (master update / phase update / defer / halt)
- Phase transition brief assembly: aggregate all signals into one structured recommendation
- Observability: parse `.forge/audit/*.jsonl` + `.forge/runs/*.json` + `.forge/runs/data.jsonl` → dashboard data (generator records provide iteration/velocity data)
- Memory graduation: detect repeated failure patterns → structured findings
- INCONCLUSIVE handling: transitive blocking via dependency graph walk
- Checkpoint gates: advisory brief IS the checkpoint (caller reviews and acts)
- State reconciliation: detect plan mutations between calls, log orphaned records, start new stories as pending

**LLM-required (autonomous mode only, deferred to v2):**
- Triage when ambiguous (multiple divergences + coherence gaps → proceed?)
- Phase auto-detection (loading all phase plans to find first incomplete — requires file discovery mechanism)
- NOT in v1 advisory mode

### NFRs for forge_coordinate

| NFR | Description | Verification |
|-----|-------------|-------------|
| NFR-C01 | Advisory mode = $0 API cost | `rg "callClaude|trackedCallClaude" server/lib/coordinator.ts server/lib/topo-sort.ts server/lib/run-reader.ts server/types/coordinate-result.ts server/tools/coordinate.ts --type ts --glob "!*.test.ts"` returns empty |
| NFR-C02 | Deterministic dispatch order | Same plan → same topo sort → same dispatch order |
| NFR-C03 | Crash-safe state | Re-run after kill → no duplicate work, no lost state |
| NFR-C04 | Budget = advisory signal, not kill | Coordinate returns `warningLevel: "exceeded"` in brief with recommendation to complete current story then stop. Caller enforces. Verify: brief contains correct warningLevel and recommendation text when budget exceeded |
| NFR-C05 | Windows compatibility | No colons in filenames, path.join everywhere |
| NFR-C06 | Graceful degradation | Observability failures don't block core logic. Parse errors logged with `console.error` (P44), not silently swallowed |
| NFR-C07 | Schema 3.0.0 compatible | Accept any valid ExecutionPlan v3.0.0 |
| NFR-C08 | Brief completeness | All signals present — nothing omitted silently |
| NFR-C09 | Null-cost visibility | When cost data is missing/null, set `budget.incompleteData = true` on the brief and log a warning (P45). Never silently treat missing data as $0. Callers see the flag and know the total is a lower bound |

`NEW_CLAIM: NFR-C09 (null-cost visibility) — source: Researcher findings #3 and anti-pattern F46. CostTracker.isOverBudget() returns false when totalCostUsd is null, which silently hides missing data`

### Dogfooding forge_generate

Each implementation session (PH-01 through PH-04) will:
1. Call `forge_generate({storyId, planPath, prdContent, masterPlanContent, phasePlanContent})` to assemble the implementation brief
2. Read the brief, implement the story based on its guidance
3. Call `forge_evaluate({storyId, planPath})` to verify ACs
4. If FAIL: call `forge_generate({...evalReport, iteration: N})` for fix guidance
5. Iterate until PASS or escalate

This tests forge_generate in a real multi-phase workflow while building the next primitive.

### Session Plan

| # | Activity | Deliverable |
|---|----------|-------------|
| S1 | PRD via `/prd` | `docs/forge-coordinate-prd.md` |
| S2 | Master Plan + Phase Plans (manually written, three-tier format) + coherence eval | `forge-coordinate-master-plan.json`, `forge-coordinate-phase-PH-{01-04}.json`, coherence report |
| S3 | PH-01: Types, Topo Sort, State Readers, Core Loop, Evaluate Write-Side (7 stories, dogfood forge_generate) | PR, version bump |
| S4 | PH-02: Budget, Time, INCONCLUSIVE, Crash Recovery (4 stories, dogfood) | PR, version bump |
| S5 | PH-03: ReplanningNote, Reconciliation, Observability (5 stories, dogfood) | PR, version bump |
| S6 | PH-04: MCP Handler, Checkpoint Gates, Tests, Dogfood (4 stories, dogfood) | PR, version bump |
| S7 | Divergence measurement | Compare against baseline |

**Total: 7 sessions** (forge_generate had 8 — its Session 1 was a project-specific test fix, not a reusable methodology step)

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| State reconstruction from files (coordinate is stateless, reads `.forge/runs/*.json` + `data.jsonl` each call) | HIGH | Conservative: if file parse fails, skip with warning (P44). If `storyId` missing on record, skip for story classification. Test with corrupt/missing/partial/schema-mismatched files |
| Dual RunRecord systems (run-record.ts JSON vs generator.ts JSONL) with incompatible schemas | HIGH | `readRunRecords()` returns tagged discriminated union — consumers explicitly choose which source to use. assessPhase uses only primary records for status; generator records feed observability only. Tested explicitly in PH-01 US-06 |
| handleStoryEval has no RunContext infrastructure (unlike coherence/divergence handlers) | HIGH | PH-01 US-00 adds full RunContext setup (~25 lines) matching the handleCoherenceEval pattern. Explicit scope note in story description to prevent underestimation |
| Advisory vs autonomous scope creep | MEDIUM | Ship advisory-only in PH-01-04; autonomous deferred to v2. Verify NFR-C01 (no callClaude) at each phase |
| RunRecord format needs extension for story-level data + dollar cost | MEDIUM | Add optional `storyId`, `evalVerdict`, and `estimatedCostUsd` fields per P50 (additive, backward-compatible). Old records without these fields are simply skipped during story classification and flagged as incomplete for budget |
| Write-side dependency (forge_evaluate must populate new fields) | MEDIUM | PH-01 US-00 addresses this as a pre-requisite before any coordinate logic depends on the data. Verified that handleStoryEval needs full RunContext infrastructure added, not just field population |
| Testing assessPhase without real run files | MEDIUM | Create fixture JSON files in test setup. Mock filesystem reads, not Claude calls |
| Crash recovery correctness | MEDIUM | Conservative: if in doubt, reset to pending. Test per crash scenario: mid-story kill, post-eval-pre-commit, corrupt JSON |
| Plan mutation between coordinate calls | MEDIUM | `reconcileState()` in PH-03 detects orphaned records and new stories. Orphaned → warn + exclude. New → pending. 5+ tests including rename and dependency-change scenarios |
| Null/missing cost data silently looks like $0 | MEDIUM | NFR-C09: `budget.incompleteData` flag on brief when any record has null cost. Budget totals exclude null records (lower bound, not false precision). Warning logged per P45 |
| Cross-run budget aggregation requires dollar amounts in RunRecord | MEDIUM | New `estimatedCostUsd` field in RunRecord.metrics, populated from CostTracker.totalCostUsd at write time. Old records without it → flagged as incomplete data |
| Concurrency (design docs describe affectedPaths overlap detection) | LOW (deferred) | v1 is strictly sequential. Design doc's affectedPaths-based concurrency reserved for v2 |
| detectCycles type mismatch (`Array<Record<string, unknown>>` vs `Story[]`) | LOW | topoSort casts `Story[]` when calling detectCycles, or wraps in a typed adapter. Low risk — Story is a superset of Record<string, unknown> |
| detectCycles export may break existing tests | LOW | Export doesn't change behavior. Run full test suite after export to verify |

### Key Files

| File | Action | What |
|------|--------|------|
| `server/tools/coordinate.ts` | Expand | 16-line stub → full MCP handler with expanded schema (phaseId required in v1, startTimeMs added) |
| `server/tools/evaluate.ts` | Modify | Add RunContext infrastructure + writeRunRecord call to `handleStoryEval` (PH-01 US-00). Populate `storyId` and `evalVerdict` on record. ~25-line change |
| `server/lib/coordinator.ts` | Create | Core: `assessPhase()`, `checkBudget()`, `checkTimeBudget()`, `recoverState()`, `reconcileState()` |
| `server/types/coordinate-result.ts` | Create | CoordinateResult, PhaseTransitionBrief (concrete interface with budget.incompleteData and nullable timeBudget), StoryStatusEntry, ReplanningNote |
| `server/lib/topo-sort.ts` | Create | Kahn's algorithm + `detectCycles()` re-export with type cast wrapper |
| `server/lib/run-reader.ts` | Create | `readRunRecords()` (reads both JSON + JSONL sources, returns tagged discriminated union) + `readAuditEntries()` — file-based state readers with parse-error resilience |
| `server/lib/run-record.ts` | Modify | Add optional `storyId`, `evalVerdict` fields to RunRecord interface; add `estimatedCostUsd` to RunRecord.metrics |
| `server/validation/execution-plan.ts` | Modify | Export existing `detectCycles()` function (currently private) |
| `server/lib/coordinator.test.ts` | Create | Unit tests (topo sort 5+, assess phase 5+, brief 3+, reconciliation 5+) |
| `server/lib/run-reader.test.ts` | Create | Unit tests (5+: corrupt JSON, truncated JSONL, schema-mismatch, empty dir, normal, dual-source tagged output) |
| `server/tools/coordinate.test.ts` | Create | Integration tests (15-20) |
| `server/index.ts` | Update | Updated tool description for coordinate |

### Existing Code to Reuse (verified APIs)

| What | Where | How | Key API |
|------|-------|-----|---------|
| Cycle detection | `server/validation/execution-plan.ts` | Export `detectCycles()` (currently private DFS 3-color), call as pre-check. **Accepts `Array<Record<string, unknown>>`, not `Story[]`** — cast needed | `detectCycles(stories: Array<Record<string, unknown>>) → string \| null` |
| CostTracker | `server/lib/cost.ts` | Budget enforcement in assessPhase loop. **Note:** `isOverBudget()` returns false when cost is null — caller must check separately. `totalCostUsd` is in-memory only, not persisted | `isOverBudget()`, `remainingBudgetUsd()`, `recordUsage()`, `summarize()` |
| ProgressReporter | `server/lib/progress.ts` | Per-story stage tracking (dynamic stages OK) | `begin()`, `complete()`, `fail()`, `skip()`, `getResults()` |
| AuditLog | `server/lib/audit.ts` | Log coordination decisions (write-only; reading done by new `run-reader.ts`) | `log({stage, agentRole, decision, reasoning})` |
| RunContext | `server/lib/run-context.ts` | Bundle CostTracker+ProgressReporter+AuditLog, one per coordinate call. Also needed for the handleStoryEval write-side update | `new RunContext({toolName, projectPath, stages, budgetUsd})` |
| Plan loader | `server/lib/plan-loader.ts` | Load + validate execution plan (supports inline JSON or file path) | `loadPlan(planPath?, planJson?) → ExecutionPlan` |
| RunRecord writer | `server/lib/run-record.ts` | Write coordinate's own run records to `.forge/runs/` | `writeRunRecord(projectPath, record)` |
| GenerateResult types | `server/types/generate-result.ts` | EscalationReason enum for ReplanningNote mapping | `"plateau" \| "no-op" \| "max-iterations" \| "inconclusive" \| "baseline-failed"` |
| EvalReport types | `server/types/eval-report.ts` | Story verdicts for status classification (passed via MCP response, not read from disk — but now also persisted as evalVerdict in RunRecord after US-00) | `verdict: "PASS" \| "FAIL" \| "INCONCLUSIVE"`, `storyId: string` |
| MasterPlan types | `server/types/master-plan.ts` | Phase structure (id, deps, inputs, outputs). **No planPath field** — cannot auto-discover phase plan files | `Phase.id`, `Phase.dependencies`, `Phase.estimatedStories` |
| ExecutionPlan types | `server/types/execution-plan.ts` | Story structure with dependencies | `Story.dependencies?: string[]`, `Story.affectedPaths?: string[]` |

---

## Execution Order

1. ~~Send session prompt to lucky-iris~~ — DONE
2. ~~Review PROJECT-INDEX.md + improve plan with codebase research~~ — DONE (this update)
3. **Create sessions plan** at `.ai-workspace/plans/2026-04-08-forge-coordinate-sessions.md` with full session prompts (same format as forge_generate sessions plan)
4. **Execute S1-S7** using mailbox coordination (forge-plan ↔ lucky-iris pattern)

## Verification

- [x] PROJECT-INDEX.md exists, < 200 lines, covers all 93 files by topic — **169 lines, 7 topics, 100% freshness**
- [x] Quick Start table answers the 10 most common agent questions — **12 rows**
- [x] Sessions plan has complete prompts for all 7 sessions — `.ai-workspace/plans/2026-04-08-forge-coordinate-sessions.md`
- [x] Each session prompt references the correct files, constraints, and verification criteria
- [x] Dogfood instructions included in S3-S6 session prompts
- [x] Plan grounded in actual codebase APIs (verified via research agents + Drafter verification + two critic rounds)
- [x] No references to non-existent APIs (detectCycles export noted as needed with type cast, dual RunRecord systems documented with roles clarified, RunRecord storyId/evalVerdict/estimatedCostUsd gaps identified and resolved, handleStoryEval infrastructure gap identified and scoped)

## Checkpoint

- [x] Part 1a: Create /project-index skill — ai-brain PR #187, HEALTHY audit
- [x] Part 1b: Generate PROJECT-INDEX.md — 93 files, 169 lines, 7 topics
- [x] Part 1c: Review index + research codebase + update plan — corrected JSONL→JSON, detectCycles export, added run-reader.ts, enriched ReplanningNote, verified all APIs
- [x] /double-critique (R22): 17 findings (1C/7M/9m), 94% applied — CRITICAL: handleStoryEval writeRunRecord gap, phaseId required v1, tagged discriminated union, estimatedCostUsd added
- [x] Part 2: Create forge_coordinate sessions plan with full session prompts — `.ai-workspace/plans/2026-04-08-forge-coordinate-sessions.md`, 7 sessions, all prompts reference correct files + dogfood instructions
- [x] Session 1: PRD via /prd — v0.16.2→v0.16.5 (16 REQ / 10 NFR / 8 SC)
- [x] Session 2: Master Plan + Phase Plans + coherence eval — 22 stories, coherence PASS → v0.16.4
- [x] Session 3: PH-01 shipped — PR #128 merged → v0.17.0, 444 tests
- [x] Session 4: PH-02 shipped — PR #140 merged, 462 tests
- [x] Session 5: PH-03 shipped — PR #141 merged → v0.19.0, 498 tests
- [x] Session 6: PH-04 shipped — PR #142 merged → v0.20.0, 541 tests
- [x] Session 7: Divergence measurement — PR #148 merged, 0 forward divergence (BUG-DIV-CWD fixed in follow-up PR #151)
- [x] Post-S7: BUG-DIV-CWD + reverseFindings schema + divergence report (PR #151) → v0.20.1
- [x] Q0.5 #168 (computeVerdict suspect-skip) — PR #173 merged → v0.24.1, round-2 cold review PASS 0C/0M/0m
- [x] Q0.5 C2 (flaky-retry shelved-for-future-use anti-pattern closure; no formal ID — retracted 2026-04-13, see hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502) — PR #174 merged → v0.24.2, round-2 cold review PASS 0C/0M/0m
- [x] Q0.5 B1 (forge_evaluate smoke-test mode) — PR #175 merged → v0.25.0, round-2 cold review PASS 0C/0M/4m/2cos
- [x] Comm-schedule protocol lock with swift-henry — `ScheduleWakeup(1500s)` ship pings / `(600s)` blockers / max-2-retries-escalate, heartbeat dropped (shared failure domain), `BLOCKER:` subject prefix
- [x] CLAUDE.md §9 added — "Measure Your Own Infrastructure Before Describing It" (synced to ai-brain/parent-claude.md)
- [x] Steven-mailbox case-study mail sent (T1600) — 10 ranked mailbox skill improvements, rank 1: `/mailbox status` auto-introspect cron via `CronList`
- [ ] Q0.5 C1 (retroactive-critique.yml) — round-2 cold review when ship ping arrives
- [ ] Q0.5 A3 (reliability/suspectFailures/K=10) — round-2 cold review when ship ping arrives
- [ ] P57 KB entry micro-PR — land in `ai-brain/hive-mind-persist/knowledge-base/01-proven-patterns.md` in parallel with C1 (swift-henry opens, forge-plan reviews)
- [ ] B1b (flip smoke-gate to binding mode) — post-Q0.5 micro-PR, NOT in C1 scope

Last updated: 2026-04-13T16:35:00+08:00 — swift-henry acked B1 round-1 PASS via 1500s ScheduleWakeup (T1619 read, 7-min end-to-end latency); holding idle for user direction on C1-vs-P57 ordering per one-at-a-time rule

---

## Corrector Self-Review & Disposition Log

Trimmed after checkpoint — full artifacts preserved in `tmp/dc-4-corrector1.md` and `tmp/dc-6-final.md`. Key outcomes: all 17 findings addressed, 16 applied, 1 skipped (readAuditEntries YAGNI). 15 evidence-gated verifications passed. Story count 20 (7+4+5+4) confirmed consistent across all sections.

*(Edge cases, interactions, new-addition traces, evidence-gated verifications, and full disposition log preserved in `tmp/dc-6-final.md`)*

---

## Critic Finding Disposition Log

Full per-finding disposition with SIDE-EFFECT-CHECKs preserved in `tmp/dc-6-final.md`. Summary: Round 1 (10 findings: 9 applied, 1 skipped), Round 2 (7 findings: 7 applied). See Critique Log below for compact table.

*(Full per-finding dispositions with SIDE-EFFECT-CHECKs preserved in `tmp/dc-6-final.md`)*

---

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 0
- **MAJOR:** 4
- **MINOR:** 6

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | No write-side for RunRecord storyId/evalVerdict | Yes | Added US-00, documented dual RunRecord system |
| 2 | MAJOR | Story count header 18 vs body 19 | Yes | Updated to 20 |
| 3 | MAJOR | No phase selection logic when phaseId omitted | Yes | Made phaseId required in v1, auto-detect deferred |
| 4 | MAJOR | topoSort type unspecified + dual cycle detection ambiguous | Yes | Added type signature + detectCycles type-cast note |
| 5 | MINOR | "0% divergence" unverified | Yes | Qualified with "(unverified)" |
| 6 | MINOR | Budget "complete story" has no mechanism in coordinator | Yes | Reframed as advisory signal |
| 7 | MINOR | reconcileState has no PH-03 unit tests | Yes | Added 3+ tests (later expanded to 5+ in Round 2) |
| 8 | MINOR | readAuditEntries created early (YAGNI) | No | Same file, same patterns, tested together |
| 9 | MINOR | Wall-clock time budget not surfaced to caller | Yes | Added best-effort note + startTimeMs input |
| 10 | MINOR | EscalationReason mapping incomplete | Yes | Added explicit mapping table |

### Round 2 (Critic-2)
- **CRITICAL:** 1
- **MAJOR:** 3
- **MINOR:** 3

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | handleStoryEval has no writeRunRecord call — US-00 understated | Yes | Rewrote US-00 to specify full RunContext infrastructure (~25 lines) |
| 2 | MAJOR | Phase auto-detection unimplementable (no planPath in MasterPlan) | Yes | phaseId required in v1, auto-detect deferred to v2 |
| 3 | MAJOR | Two incompatible RunRecord schemas, no normalization spec | Yes | Tagged discriminated union; primary=authoritative, generator=supplementary |
| 4 | MAJOR | detectCycles accepts Record<string,unknown>[], not Story[] | Yes | Added type-cast note to US-02 and Reuse table |
| 5 | MINOR | timeBudget.elapsedMs has no start-time anchor | Yes | Added startTimeMs to input schema, null-safe semantics |
| 6 | MINOR | RunRecord.metrics has no dollar-cost field | Yes | Added estimatedCostUsd + incompleteData flag |
| 7 | MINOR | reconcileState 3 tests too thin | Yes | Expanded to 5+ tests |

### Summary
- Total findings: 17 across both rounds
- Applied: 16 (94%)
- Rejected: 1 (6%) — readAuditEntries early creation justified by co-location
- Key changes: handleStoryEval write-side infrastructure (CRITICAL), phaseId required in v1, tagged discriminated union for dual RunRecord, estimatedCostUsd field, startTimeMs input, 5+ reconcileState tests
