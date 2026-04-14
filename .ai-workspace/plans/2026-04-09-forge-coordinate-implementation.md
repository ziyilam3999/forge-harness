# Plan: forge_coordinate Implementation

## Context

forge_generate is complete (v0.16.0). forge_coordinate is the 4th primitive — a lightweight orchestrator composing forge_plan + forge_generate + forge_evaluate. Advisory mode = $0 (read-only brief assembly, no LLM calls). Caller executes.

The plan has been double-critiqued across multiple rounds (R22, R23, R5×2) plus one user-driven schema pivot (R4), totaling ~63 findings with ~79% applied. Historical critique logs are archived to `tmp/dc-*.md`; this document retains only the implementation spec and open checkpoint items.

## ELI5

We already built three workers: one makes plans, one writes code briefs, one grades the code. Now we need a foreman. The foreman looks at a plan, figures out which tasks to do in what order (some tasks depend on others), watches the clock and the budget, and if something goes wrong, flags it for the human boss instead of guessing.

The foreman doesn't DO the work — it assembles a "here's what to do next and why" briefing, and the human (or calling session) runs the actual workers. We'll dogfood forge_generate to build forge_coordinate.

---

## Current State (verified against codebase)

- `server/tools/coordinate.ts` — 16-line stub
- **Cycle detection** (`server/validation/execution-plan.ts`) — private `detectCycles()`, DFS 3-color. Signature will change to accept `Story[]` directly (safe: currently private, no external consumers)
- **Run records** exist in TWO systems with incompatible schemas:
  - `server/lib/run-record.ts` → individual JSON files at `.forge/runs/{tool}-{ts}-{hex}.json`. No `storyId`, no `evalVerdict`, no dollar cost. Used by forge_evaluate coherence/divergence and forge_plan
  - `server/lib/generator.ts` → JSONL at `.forge/runs/data.jsonl`. Has `storyId` + `iteration` + `score`. Used by forge_generate
- **`handleStoryEval`** (evaluate.ts lines 150-166, verified 2026-04-09) does NOT write any RunRecord and has NO RunContext infrastructure — unlike coherence (line 226) and divergence (line 372) handlers
- **Audit logs** at `.forge/audit/{tool}-{ts}.jsonl`, `AuditLog` has write-only API (no reader exists)
- **CostTracker.isOverBudget()** returns `false` when `totalCostUsd` is null (silently hides missing data)
- **RunContext** bundles CostTracker + ProgressReporter + AuditLog
- **MasterPlan.Phase** has no `planPath` field → cannot auto-discover phase plan files

---

## What forge_coordinate Does

**Core role:** Dependency-aware dispatch of stories across forge primitives. Does NOT execute — assembles status and recommendations.

**Advisory mode (default, $0):** Each call:
1. Load execution plan + read prior run state from `.forge/runs/*.json` and `.forge/runs/data.jsonl`
2. Topologically sort stories within the target phase
3. Classify each story per the **6-state machine** (first-match-wins precedence): `done` > `dep-failed` > `failed` > `ready-for-retry` > `ready` > `pending`
4. Check budget/time against accumulated cost from prior primary RunRecords
5. Assemble a `PhaseTransitionBrief` (status per **4-case rule**: `halted` > `complete` > `needs-replan` > `in-progress`)
6. Return the brief — caller decides and acts

**Phase selection:** `phaseId` is **required** in v1. Auto-detection deferred to v2 (MasterPlan.Phase has no planPath field).

**Calling pattern:** Caller invokes coordinate → reads brief → runs forge_generate+evaluate on ready stories → calls coordinate again → repeat until complete/halted. Stateless per call (reads state from files).

---

## State Source Design

**Problem:** Primary RunRecord lacks `storyId` and `evalVerdict`; EvalReport has both but isn't persisted; handleStoryEval has no writeRunRecord call at all.

**Resolution (two parts):**

**(A) Extend RunRecord with optional fields** (P50 — additive, no version bump):
```typescript
storyId?: string;
evalVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
estimatedCostUsd?: number | null;  // in metrics sub-object
```

**(B) Add RunContext infrastructure + writeRunRecord call to `handleStoryEval`** (~25 LOC matching handleCoherenceEval pattern).

**Dual source resolution:** `readRunRecords()` returns a tagged discriminated union. Primary records (`source: "primary"`) are authoritative for status classification; generator records (`source: "generator"`) feed observability/velocity only.

---

## Budget Design

**Problem:** RunRecord.metrics has no dollar-cost field — only token counts.

**Resolution:** Add optional `estimatedCostUsd` to `RunRecord.metrics` AND populate it from **every** `writeRunRecord` call site in `server/` (handleCoherenceEval, handleDivergenceEval, handleStoryEval, forge_generate paths, forge_plan paths). Each site pulls from its local `CostTracker.totalCostUsd`.

`checkBudget` aggregates across all primary records. Null/missing → exclude from total + set `budget.incompleteData = true` + log warning per P45 (never silently $0).

---

## Phase Decomposition (4 phases, 22 stories)

### PH-01: Types, Topological Sort, State Readers, Core Dispatch Loop (8 stories)

| Story | What | File |
|-------|------|------|
| US-00a | **RunRecord interface extension + `handleStoryEval` infrastructure.** Extend `server/lib/run-record.ts` with optional `storyId`, `evalVerdict`, `evalReport`, `estimatedCostUsd` fields (4 fields — `evalReport` added per Decision A for retry context, see v0.16.2 PRD REQ-01 v1.1). Add full RunContext infrastructure to `handleStoryEval` (`server/tools/evaluate.ts` lines 150-166) matching `handleCoherenceEval`: RunContext construction, cost tracking, audit logging, then `writeRunRecord` with all four fields populated. **REQ-01 v1.1 deterministic-serialization AC:** sort `evalReport.findings` by `(failedAcId, description)` before write to preserve NFR-C02 and NFR-C10 byte-identity — the embedded report must serialize identically across runs given the same input. **Storage/perf note:** ~10KB per FAIL record, ~300KB per retry-heavy phase (3 retries × N stories). Acceptable at v1 scale; monitor in dogfood. **Scope:** ~45 LOC | modify existing |
| US-00b | **Cross-site `estimatedCostUsd` population.** Extend every OTHER `writeRunRecord` call site (from `server/lib/run-record.ts` — the canonical writer) to populate `estimatedCostUsd` from local `CostTracker.totalCostUsd`. **VERIFIED enumeration (2026-04-09 grep):** call sites importing from `run-record.ts` are `evaluate.ts:226` (handleCoherenceEval), `evaluate.ts:372` (handleDivergenceEval), and `plan.ts:688` (writeRunRecordIfNeeded wrapper called from 4 sites in plan.ts). **IMPORTANT — duplicate function name:** `server/lib/generator.ts:466` exports a SEPARATE `writeRunRecord` that writes JSONL to `.forge/runs/data.jsonl`. It has an incompatible schema (`{timestamp, storyId, iteration, action, score, durationMs}`) and is called only internally at `generator.ts:442`. **Do NOT extend the generator's `writeRunRecord`** — it has no `metrics` sub-object, `estimatedCostUsd` doesn't belong there, and changing the JSONL shape would break existing generator consumers. No runtime collision risk (different modules, every import site disambiguates by path), but the implementer must not conflate them when reading grep output. **VERIFIED NEEDED:** `grep CostTracker server/tools/evaluate.ts` to confirm tracker is in-scope at each canonical call site; if not, refactor to thread it through (~10-20 LOC extra). **Scope:** ~30-60 LOC | modify existing |
| US-01 | `CoordinateResult`, `StoryStatusEntry`, `PhaseTransitionBrief` (see interface below), `CoordinateMode` types | `server/types/coordinate-result.ts` |
| US-02 | `topoSort(stories: Story[]): Story[]` — Kahn's algorithm. **Change `detectCycles` signature** to `Story[]` (safe: private, no callers). **Export** `detectCycles(stories: Story[]): string \| null` with JSDoc contract (purpose, params, return sentinel, never-throws). topoSort imports and calls with no cast. **Test migration:** update any existing `execution-plan.test.ts` fixtures to use `Story[]`. **Determinism (NFR-C02, NFR-C10):** Kahn's ready-queue processed in stable sorted order by `story.id` lexicographic | `server/lib/topo-sort.ts` |
| US-03 | `readRunRecords(projectPath): ReadonlyArray<PrimaryRecord \| GeneratorRecord>` — reads both `.forge/runs/*.json` and `.forge/runs/data.jsonl`, returns tagged discriminated union sorted by timestamp (`PrimaryRecord = {source: "primary", record}`, `GeneratorRecord = {source: "generator", record}`). Consumers filter inline: `.filter(r => r.source === 'primary')`. Degrade gracefully on missing dir/corrupt JSON (skip + `console.error` per P44). Also `readAuditEntries(projectPath, toolName?)` for `.forge/audit/*.jsonl` | `server/lib/run-reader.ts` |
| US-04 | `assessPhase(plan, projectPath, options)` — walk topo-sorted stories, classify per **6-state machine with explicit top-to-bottom precedence** (first-match-wins): `done` (latest primary record has `evalVerdict === "PASS"`) > `dep-failed` (any transitive dep is `failed` or `dep-failed`) > `failed` (retryCount ≥ 3, where retryCount re-derived from `readRunRecords().filter(r => r.source === 'primary' && r.record.storyId === id && r.record.evalVerdict !== "PASS").length`, counts both FAIL and INCONCLUSIVE) > `ready-for-retry` (deps done, 0 < retryCount < 3, populate `priorEvalReport` from most recent non-PASS record) > `ready` (deps done, retryCount === 0) > `pending` (deps not all done). Precedence prevents `FAIL,FAIL,FAIL,PASS → failed` mis-classification (done wins) and `dep-failed` + `failed` double-attribution (dep-failed wins). Pure status assembly, no story execution | `server/lib/coordinator.ts` |
| US-05 | `assemblePhaseTransitionBrief(result, plan)` — mechanical signal aggregation, recommendation string generation | `coordinator.ts` |
| US-06 | Unit tests: topo sort (5+), run-reader (5+: corrupt JSON, truncated JSONL, schema-mismatch, empty dir, normal, dual-source tagged output), assessPhase dispatch loop (5+), brief (3+) | `coordinator.test.ts`, `run-reader.test.ts` |

**PhaseTransitionBrief interface:**

```typescript
export interface StoryStatusEntry {
  storyId: string;
  status: "done" | "ready" | "ready-for-retry" | "failed" | "pending" | "dep-failed";
  retryCount: number;                    // re-derived per call from primary records (count of non-PASS evalVerdicts)
  retriesRemaining: number;              // max(0, 3 - retryCount)
  priorEvalReport: EvalReport | null;    // non-optional-with-explicit-null (NFR-C08 "no absent keys"); populated iff status is "ready-for-retry" or "failed"
  evidence: string | null;               // non-optional-with-explicit-null; human-readable status reason
}

export interface PhaseTransitionBrief {
  phaseId: string;
  status: "in-progress" | "complete" | "needs-replan" | "halted";  // 4-case rule: halted > complete > needs-replan > in-progress (first-match-wins). `blocked` phase-level status REMOVED in v1.1.
  stories: StoryStatusEntry[];
  readyStories: string[];            // MAY contain `ready-for-retry` IDs; caller MUST cross-reference `stories[]` before dispatching to pull `priorEvalReport`. v2 may split into `readyStories` + `retryStories`.
  depFailedStories: string[];        // renamed from `blockedStories` in v1.1 — IDs of stories in `dep-failed` state
  completedCount: number;
  totalCount: number;
  budget: {
    usedUsd: number | null;
    budgetUsd: number | null;
    remainingUsd: number | null;
    incompleteData: boolean;
    warningLevel: "none" | "approaching" | "exceeded";
  };
  timeBudget: {
    elapsedMs: number | null;
    maxTimeMs: number | null;
    warningLevel: "none" | "approaching" | "exceeded" | "unknown";
  };
  replanningNotes: ReplanningNote[];
  recommendation: string;            // MUST include substring `LAST RETRY: <storyId>` when any story is at retryCount === 2 (binary-greppable AC)
  configSource: Record<string, "file" | "args" | "default">;
}
```

**4-case `brief.status` rule** (mutually-exclusive top-to-bottom, first-match-wins):
1. **`halted`** iff `phaseBoundaryBehavior: "halt-hard"` state applies AND not cleared via `haltClearedByHuman: true`. **Non-latching:** re-evaluated against current reconciled state every call, not stored. A cleared-then-injected-failure phase flips to `needs-replan` on next call with no stale latch.
2. **`complete`** iff every story is `done`
3. **`needs-replan`** iff any story is `failed` OR `dep-failed`. Brief carries at least one `ReplanningNote` with `severity: "blocking"` (category `ac-drift` for retries-exhausted, `assumption-changed` for dep-failed-chain)
4. **`in-progress`** otherwise (at least one `ready` or `ready-for-retry` story exists)

**Dependencies:** None

### PH-02: Safety & Budget Enforcement (4 stories)

| Story | What |
|-------|------|
| US-01 | `checkBudget(ctx, budgetUsd, priorRecords)` — aggregate `estimatedCostUsd` across primary records only (explicit `.filter(r => r.source === 'primary')` — generator records have no cost field). Warning at 80%, exceeded at 100%. Advisory only: returns `warningLevel: "exceeded"` + "complete current story then stop" recommendation. Caller enforces. Null prior cost → set `budget.incompleteData = true`, exclude from total, log per P45 |
| US-02 | `checkTimeBudget(startTimeMs, maxTimeMs)` — wall-clock 80%/100%. No-op when either param unset. When `startTimeMs` missing: `elapsedMs = null`, `warningLevel = "unknown"`. Known limitation: Date.now() is susceptible to clock jumps (documented, not addressed in v1) |
| US-03 | INCONCLUSIVE handling — **INCONCLUSIVE now flows through the retry counter, not a terminal state** (per REQ-08 v1.1). An INCONCLUSIVE eval increments `retryCount` the same way FAIL does; the story re-enters `ready-for-retry` if retryCount < 3, or `failed` if retryCount ≥ 3. Transitive `dep-failed` propagation still applies when the root story becomes terminally `failed`. Flaky-eval compensation explicitly rejected — fix the eval tool upstream, not coordinate. Story-level isolation preserved; phase-brief-level forward-progress explicitly NOT preserved (any `failed` / `dep-failed` → `needs-replan` per rule 3) |
| US-04 | Crash recovery — `recoverState(plan, projectPath)`: use `readRunRecords()`, filter `source === "primary"`, filter by `storyId`. **Composition note:** `reconcileState` (PH-03 US-05) runs BEFORE `recoverState` in `assessPhase` — keep orphan-filter and new-story-marking logic OUT of `recoverState`. Operates on the already-reconciled view: most-recent PASS → `done`; otherwise re-derive `retryCount` from count of non-PASS primary records (counts both FAIL and INCONCLUSIVE per REQ-04 v1.1), then let the 6-state precedence in `assessPhase` assign the final status. Populate `priorEvalReport` from the most recent non-PASS record's embedded `evalReport` field when status is `ready-for-retry` or `failed`. no-record → pass-through, no-storyId → skip |

**Dependencies:** PH-01

### PH-03: ReplanningNote, Reconciliation, Observability (5 stories)

| Story | What |
|-------|------|
| US-01 | `ReplanningNote` type with `category` (ac-drift, partial-completion, dependency-satisfied, gap-found, assumption-changed), `severity` (blocking, should-address, informational), `affectedPhases?`, `affectedStories?`, `description`. Mechanical routing: ac-drift/assumption-changed → master update; partial-completion/dependency-satisfied → phase update; gap-found → defer; blocking → halt. **New v1.1 blocking triggers** (both feed `brief.status: "needs-replan"` via rule 3): (a) `retries-exhausted` — category `ac-drift`, severity `blocking`, **emitted per terminal-failed story** (one note per story, not one union note). (b) `dep-failed-chain` — category `assumption-changed`, severity `blocking`, **one note per distinct root failed story** (not one per dep-failed downstream). Binary AC: `replanningNotes.filter(n => n.description.includes("dep-failed-chain")).length === distinctRootFailedCount` |
| US-02 | `collectReplanningNotes(result)` — map escalation reasons: `plateau` → partial-completion, `no-op` → gap-found, `max-iterations` → partial-completion, `inconclusive` → ac-drift, `baseline-failed` → assumption-changed. Eval FAIL → ac-drift, INCONCLUSIVE → gap-found |
| US-03 | `aggregateStatus(projectPath)` — per-story status + accumulated cost from primary records' `estimatedCostUsd` + velocity (stories/hour from generator timestamps). Edge cases: zero completed or zero elapsed → velocity = 0 (not NaN) |
| US-04 | `graduateFindings(result)` — detect repeated failure patterns (3+ same escalation within current plan execution). Returns structured findings (caller writes to KB). **Counter re-derived each call** from `readRunRecords().filter(r => r.source === 'primary')` (stateless). **REQ-12 v1.1 dedup fix (Round 3 critical):** before applying the ≥3 threshold, dedupe by `(storyId, escalationReason)` — otherwise a single retry-exhausted story (3 primary records, all escalation `plateau`) would cross the threshold alone and self-graduate, defeating the "≥3 DISTINCT stories = real pattern" intent. Plan-execution window = records with timestamp ≥ first record for a current-plan storyId, optionally clipped by `currentPlanStartTimeMs` input to prevent cross-plan contamination on story-ID reuse. Generator records ignored (no evalVerdict) |
| US-05 | `reconcileState(plan, projectPath)` — handle plan mutations. Orphaned records (story removed) → log warning + exclude. New stories → pending. Returns reconciliation actions. **v1.1 REQ-13 guarantees:** `failed` and `dep-failed` preserved across plan mutations automatically via record persistence + re-derivation (no special-case logic). **Dangling-dependency rule:** when a story references a dep ID that no longer exists in the plan, classify downstream as `pending` with `evidence: "dep <id> missing from plan"` + P45 warning. **6+ tests:** orphaned, new stories, full replacement, rename (old orphan + new pending), dependency-change, **`failed → rename → pending`** (retry budget reset via rename is an acknowledged escape hatch), **`dep-failed → upstream-replanned-away → pending`**, dangling-dep. **Composition:** runs FIRST in `assessPhase`, before `recoverState` |

**Dependencies:** PH-01, PH-02

### PH-04: MCP Handler, Config Loader, Checkpoint Gates, Integration Tests, Dogfood (5 stories)

| Story | What |
|-------|------|
| US-01 | Expand `coordinateInputSchema`: planPath (req), phaseId (req v1), masterPlanPath, coordinateMode, budgetUsd, maxTimeMs, **startTimeMs** (epoch ms anchor for time budget), projectPath, prdContent, replanningNotes, **haltClearedByHuman?** (boolean override for halt-hard clearing). Wire `handleCoordinate` to `assessPhase` |
| US-01.5 | **Config file loader (output-shaping policy).** `loadCoordinateConfig(projectPath)` in `coordinator.ts`. Reads `.forge/coordinate.config.json` (not walked upward). **4 fields, all optional:** `storyOrdering`, `phaseBoundaryBehavior`, `briefVerbosity`, `observability.{logLevel, writeAuditLog, writeRunRecord}`. Per-field merge with MCP args overriding config. Surface provenance via `PhaseTransitionBrief.configSource`. Corrupt/missing/schema-invalid → log warning per P44, fall back to args-only. Single-shot read (one `fs.readFile` syscall). **7+ unit tests:** (a) no file → defaults + empty configSource, (b) full file → all fields applied, (c) args override some fields → mixed provenance, (d) corrupt JSON → graceful fallback, (e) schema-invalid type (e.g. `storyOrdering: "random"`) → skip field + warn, (f) mid-write race → graceful, (g) **behavioral:** `depth-first` on 6-story 2-chain plan verifies same-chain continuation vs cross-chain jumping. **Integration points:** `storyOrdering` reorders topoSort output; `phaseBoundaryBehavior` branches brief phase-complete path; `briefVerbosity` shapes recommendation; `observability.*` gates console/audit/run-record writes |
| US-02 | Checkpoint gates — advisory: brief IS the checkpoint. Autonomous (v2): emit `checkpointRequired: true`, halt. Resume via re-call |
| US-03 | Integration tests (17-22): multi-story dispatch, budget enforcement (incl. incomplete cost data), time enforcement (incl. missing startTimeMs), crash recovery, INCONCLUSIVE blocking, advisory brief, error handling, plan mutation reconciliation, corrupt run records, empty-dependency plans, all-stories-done. **Existing tests updated** to assert `configSource` present. **New coverage tests:** (1) **configSource end-to-end:** fixture `.forge/coordinate.config.json` with `storyOrdering: "depth-first"` + `briefVerbosity: "detailed"`, call with arg `briefVerbosity: "concise"` → assert `brief.configSource` shows mixed file/args provenance. (2) **halt-hard clearing state machine:** fixture config `phaseBoundaryBehavior: "halt-hard"`. Call 1 at phase completion → `status: "halted"` + synthetic blocking note. Call 2 without flag → still halted (idempotent). Call 3 with `haltClearedByHuman: true` → `status: "complete"`, note absent |
| US-04 | Dogfood — run coordinate against a multi-story plan, verify topo sort + brief + status tracking. Write dogfood report |

**Dependencies:** PH-02, PH-03

---

## Config File Schema (US-01.5 reference)

```typescript
interface CoordinateConfig {
  storyOrdering?: "topological" | "depth-first" | "small-first";
  // topological (default): matches pre-config behavior byte-for-byte (NFR-C10)
  // depth-first: finish one dependency chain before starting another
  // small-first: prefer stories with fewest descendants (quick wins first)

  phaseBoundaryBehavior?: "auto-advance" | "halt-and-notify" | "halt-hard";
  // auto-advance (default): status = "complete", recommend next phase
  // halt-and-notify: status = "halted", recommend human review
  // halt-hard: + synthetic blocking ReplanningNote (brief-only, not persisted).
  //            Cleared via `haltClearedByHuman: true` input arg on next call (idempotent).

  briefVerbosity?: "concise" | "detailed";
  // concise (default): one-sentence next action
  // detailed: + rationale + caveats + alternatives

  observability?: {
    logLevel?: "debug" | "info" | "warn" | "silent";
    // Parse errors and degraded-state warnings ALWAYS emitted regardless (P44 carve-out)
    writeAuditLog?: boolean;   // default true
    writeRunRecord?: boolean;  // default true
    // WARNING: writeRunRecord: false voids NFR-C03 (crash recovery). Loader emits P45
    // warning and brief.recommendation prepends "WARNING: crash recovery disabled."
  };
}
```

**Cut from v1 config schema** (documented in `docs/primitive-backlog.md` "Configuration File Design Decisions"): `budgetUsd`, `maxTimeMs`, `escalationThresholds` (resource caps unsuitable for Max-plan supervised runs); `phaseGates` (replaced by `phaseBoundaryBehavior`); `excludePaths` (no concrete grounding). **Note:** `budgetUsd` and `maxTimeMs` remain accepted as MCP input args on `coordinateInputSchema` — they're only excluded from the project-local config file.

---

## NFRs

| NFR | Description | Verification |
|-----|-------------|-------------|
| NFR-C01 | Advisory mode = $0 | `rg "callClaude\|trackedCallClaude" server/lib/coordinator.ts server/lib/topo-sort.ts server/lib/run-reader.ts server/types/coordinate-result.ts server/tools/coordinate.ts --type ts --glob "!*.test.ts"` returns empty |
| NFR-C02 | Deterministic dispatch | Same plan → same topo sort. Kahn's ready-queue in stable lex order by `story.id` |
| NFR-C03 | Crash-safe state | Re-run after kill → no duplicate work, no lost state |
| NFR-C04 | Budget = advisory, not kill | Brief returns `warningLevel: "exceeded"` + recommendation; caller enforces |
| NFR-C05 | Windows compatibility | No colons in filenames, `path.join` everywhere |
| NFR-C06 | Graceful degradation | Observability failures don't block core. Parse errors logged via `console.error` (P44) |
| NFR-C07 | Schema 3.0.0 compatible | Accept any valid ExecutionPlan v3.0.0 |
| NFR-C08 | Brief completeness | All signals present — nothing omitted silently |
| NFR-C09 | Null-cost visibility | `budget.incompleteData = true` when any cost missing; warn per P45; never silent $0 |
| NFR-C10 | Config file zero-impact when absent/empty | Run full test suite twice (no config file, empty `{}`). Goldens compare all fields **EXCEPT `configSource`**. Golden-file byte-comparison on 3+ fixtures. Binary pass/fail |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| State reconstruction from files | HIGH | Parse fails → skip + warn (P44). Missing storyId → skip for classification. Test corrupt/partial/schema-mismatch |
| Dual RunRecord systems with incompatible schemas | HIGH | Tagged discriminated union + explicit consumer filter. assessPhase uses primary only; generator feeds observability only |
| handleStoryEval has no RunContext infrastructure | HIGH | PH-01 US-00a adds full setup (~25 LOC) matching handleCoherenceEval pattern |
| `observability.writeRunRecord: false` voids NFR-C03 | MEDIUM | P45 warning in loader + "WARNING: crash recovery disabled." recommendation prefix. Loudly documented in US-01.5 |
| RunRecord format extension (storyId, evalVerdict, estimatedCostUsd) | MEDIUM | P50 additive optional fields. Old records skipped for classification, flagged incomplete for budget |
| Cross-site writeRunRecord population | MEDIUM | US-00b enumerates via grep before implementation; per-site CostTracker scope verified pre-req |
| Plan mutation between calls | MEDIUM | `reconcileState` in PH-03 US-05: orphan → warn+exclude, new → pending. 5+ tests including rename and dep-change |
| Null cost silently = $0 | MEDIUM | NFR-C09 `incompleteData` flag. Totals exclude null (lower bound, not false precision) |
| Testing assessPhase without real run files | MEDIUM | Fixture JSON in test setup; mock filesystem, not Claude calls |
| Crash recovery correctness | MEDIUM | Conservative: if in doubt → pending. Test mid-story kill, post-eval-pre-commit, corrupt JSON |
| Concurrency (affectedPaths overlap) | LOW (deferred) | v1 sequential. Concurrency reserved for v2 |
| `detectCycles` signature change | LOW | Private, no external callers — safe surgical change. Full test suite after |
| Config schema drift | LOW | P50: unknown fields → warn, not error. Old configs remain valid |
| `storyOrdering` masking missing-dependency bugs | LOW | `topological` is default (byte-identical). depth-first/small-first applied ON TOP of valid topo sort — never violate dependencies. US-01.5 test (g) verifies |

---

## Key Files

| File | Action | What |
|------|--------|------|
| `server/tools/coordinate.ts` | Expand | 16-line stub → full MCP handler with expanded schema (phaseId required, startTimeMs, haltClearedByHuman) |
| `server/tools/evaluate.ts` | Modify | Add RunContext to `handleStoryEval` + writeRunRecord with storyId/evalVerdict/estimatedCostUsd. Populate estimatedCostUsd on existing coherence/divergence writeRunRecord calls |
| `server/lib/coordinator.ts` | Create | Core: `assessPhase`, `checkBudget`, `checkTimeBudget`, `recoverState`, `reconcileState`, `loadCoordinateConfig` |
| `server/types/coordinate-result.ts` | Create | `CoordinateResult`, `PhaseTransitionBrief`, `StoryStatusEntry`, `ReplanningNote` |
| `server/lib/topo-sort.ts` | Create | Kahn's algorithm; imports `detectCycles(stories: Story[])` directly |
| `server/lib/run-reader.ts` | Create | `readRunRecords` (tagged union) + `readAuditEntries` |
| `server/lib/run-record.ts` | Modify | Add optional `storyId`, `evalVerdict`; add `estimatedCostUsd` to `metrics` |
| `server/validation/execution-plan.ts` | Modify | Change `detectCycles` signature to `Story[]` and export with JSDoc contract |
| `server/lib/coordinator.test.ts` | Create | Unit tests, cumulative across PH-01/PH-02/PH-03 sessions (topo sort 5+ in PH-01 US-06, assessPhase 5+ in PH-01 US-06, brief 3+ in PH-01 US-06, reconciliation 5+ in PH-03 US-05) |
| `server/lib/run-reader.test.ts` | Create | Unit tests (5+ including dual-source tagged output) |
| `server/tools/coordinate.test.ts` | Create | Integration tests (17-22) |
| `server/index.ts` | Update | Tool description for coordinate |

## Existing Code to Reuse

| What | Where | API |
|------|-------|-----|
| Cycle detection | `server/validation/execution-plan.ts` | `detectCycles(stories: Story[]) → string \| null` (after signature change + export) |
| CostTracker | `server/lib/cost.ts` | `isOverBudget()` (returns false on null!), `totalCostUsd`, `recordUsage` |
| ProgressReporter | `server/lib/progress.ts` | `begin/complete/fail/skip/getResults` — dynamic stages OK |
| AuditLog | `server/lib/audit.ts` | `log({stage, agentRole, decision, reasoning})` — write-only |
| RunContext | `server/lib/run-context.ts` | `new RunContext({toolName, projectPath, stages, budgetUsd})` |
| Plan loader | `server/lib/plan-loader.ts` | `loadPlan(planPath?, planJson?) → ExecutionPlan` |
| RunRecord writer | `server/lib/run-record.ts` | `writeRunRecord(projectPath, record)` |
| EscalationReason | `server/types/generate-result.ts` | `plateau \| no-op \| max-iterations \| inconclusive \| baseline-failed` |
| EvalReport | `server/types/eval-report.ts` | `verdict: PASS \| FAIL \| INCONCLUSIVE`, `storyId` |
| ExecutionPlan | `server/types/execution-plan.ts` | `Story.dependencies?`, `Story.affectedPaths?` |

---

## Session Plan

| # | Activity | Deliverable |
|---|----------|-------------|
| S1 | PRD via `/prd` | `docs/forge-coordinate-prd.md` |
| S2 | Master Plan + Phase Plans + coherence eval via `forge_evaluate(mode: 'coherence', ...)` | `forge-coordinate-master-plan.json`, `forge-coordinate-phase-PH-{01-04}.json`, coherence report |
| S3 | PH-01 (8 stories, dogfood forge_generate) | PR, version bump |
| S4 | PH-02 (4 stories, dogfood) | PR, version bump |
| S5 | PH-03 (5 stories, dogfood) | PR, version bump |
| S6 | PH-04 (5 stories, dogfood) | PR, version bump |
| S7 | Divergence measurement vs baseline | Divergence report |

---

## Checkpoint

### Immediate blockers (in order)

- [x] **Regenerate Session 1 prompt** — saved to `.ai-workspace/plans/2026-04-09-forge-coordinate-s1-prompt.md` (2026-04-09)
- [x] **Sync mailbox message to lucky-iris** — updated in place at `C:\Users\ziyil\claude-code-mailbox\mailbox\inbox\2026-04-08T0215-forge-plan-to-lucky-iris-s1-coordinate-prd.md` (2026-04-09)
- [x] **Answer lucky-iris's 7 clarifying questions** — sent 2026-04-09T14:55 confirming all 7 stances + Q4 fold (SC-09→SC-01) + Q7 full-read (2026-04-09)
- [x] **Lucky-iris ships S1** — `docs/forge-coordinate-prd.md` merged via [PR #109](https://github.com/ziyilam3999/forge-harness/pull/109), released as v0.16.1. Final shape: **16 REQ / 10 NFR / 8 SC**. `/double-critique` ran with 22 findings / 100% applied / 0 rejected (2026-04-09T17:03)

### Pre-S2 action items (from lucky-iris's S1 interview surprises)

- [x] **Surprise 1 — phantom section:** Created "Configuration File Design Decisions" section in `docs/primitive-backlog.md` (4 fields landed + 5 rejected, with promotion criteria per rejected field + derived design principle). Survives post-PH-04 archival (2026-04-09)
- [x] **Surprise 2 — duplicate `writeRunRecord`:** Updated US-00b scope in this plan with verified grep enumeration (3 canonical call sites: `evaluate.ts:226`, `evaluate.ts:372`, `plan.ts:688`) and explicit exclusion of `generator.ts:466` (JSONL writer, incompatible schema, only called internally). Rename cleanup skipped — no runtime collision risk (different modules, imports disambiguate by path). Not worth the churn (2026-04-09)
- [x] **Surprise 3 — stale line range:** Updated `handleStoryEval` location from lines 121-137 to **lines 150-166** in both Current State section and US-00a row (verified via grep 2026-04-09). Also corrected coherence/divergence handler line numbers (226/372, not 217/380)
- [x] **Surprise 4 — Windows CI matrix:** Shipped via [PR #113](https://github.com/ziyilam3999/forge-harness/pull/113) (merge commit `fa90e7b`). Both `ubuntu-latest` and `windows-latest` green on first try (29s and 1m37s respectively) — no Windows-specific bugs surfaced in the existing codebase. `shell: bash` pinned on commit-validation step for cross-OS compatibility. Auto-closed [#112](https://github.com/ziyilam3999/forge-harness/issues/112). NFR-C05 verification chain now unblocked (2026-04-09)

### Design decisions — RESOLVED (sent to lucky-iris 2026-04-09T17:20, awaiting v0.16.2 PRD revision)

- [x] **Decision A — auto-retry with max 3:** Retries feed prior EvalReport to next forge_generate. Counter re-derived from primary RunRecords (stateless, NFR-C03 preserved). **Requires structural addition:** embed full `evalReport?: EvalReport` field in RunRecord alongside `evalVerdict` (US-00a scope grows by +1 field)
- [x] **Decision B — collapse `blocked` → `needs-replan`:** New 6-state story machine (`done` / `ready` / `ready-for-retry` / `failed` / `pending` / `dep-failed`). New 4-case `brief.status` rule: `halted` > `complete` > `needs-replan` > `in-progress`. `blocked` as phase-level terminal is removed — dep-failed-chain + retries-exhausted both collapse into `needs-replan` with blocking `ReplanningNote`
- [x] **Decision C — `readAuditEntries` in REQ-11:** Confirmed as-is. `aggregateStatus(..., { includeAudit?: boolean })` signature
- [x] **Lucky-iris ships v0.16.2 PRD revision** — [PR #114](https://github.com/ziyilam3999/forge-harness/pull/114) merged, `3088212`, tag `v0.16.2`. 7 directed REQs edited + bonus REQ-15 halt-hard non-latching. Round 3 scoped `/double-critique`: 26 findings, 24 applied (92%). Two CRITICALs caught: (a) REQ-04 precedence bug (`FAIL,FAIL,FAIL,PASS` mis-classification), (b) REQ-12 graduation double-count on unchanged REQ — requires dedup by `(storyId, escalationReason)`. One MAJOR rejected with rationale: `proceedWithPartialFailure` escape hatch (would re-introduce v1.0 phase-level `blocked` ambiguity). Counts stable 16/10/8. CI green on both OSes. Accepted 2026-04-09T18:45 (2026-04-09)
- [x] **Impl plan v1.1 resync** — this plan updated for the v1.1 state machine (2026-04-09T18:45): 6-state story machine with explicit precedence chain, 4-case `brief.status` rule with non-latching halt-hard, `blockedStories` → `depFailedStories`, `StoryStatusEntry` gains `retryCount`/`retriesRemaining`/`priorEvalReport`/`evidence`, `readyStories` now MAY contain `ready-for-retry` (caller cross-references), INCONCLUSIVE flows through retry counter, `retries-exhausted` + `dep-failed-chain` ReplanningNote triggers, REQ-12 dedup fix in `graduateFindings`, REQ-13 `failed`/`dep-failed` preservation + dangling-dep rule in `reconcileState`, REQ-01 deterministic-serialization AC + ~10KB/FAIL storage note in US-00a. Closes Surprise 6 (highest-impact wire-level risk per lucky-iris)

### Ship-review follow-up issues

- [ ] [#110](https://github.com/ziyilam3999/forge-harness/issues/110) — PRD: clarify `detectCycles` export status (REQ-02 AC-3). Fold into PH-01 US-02 spec refinement before S3
- [ ] [#111](https://github.com/ziyilam3999/forge-harness/issues/111) — PRD: tighten REQ-01 AC-3 `handleCoherenceEval` pattern description. Doc nit; fold into PH-01 US-00a spec refinement before S3
- [x] [#112](https://github.com/ziyilam3999/forge-harness/issues/112) — CI matrix windows-latest: CLOSED by PR #113 merge (2026-04-09)

### Session 3 pre-reqs (can run anytime before S3)

- [ ] `grep -rn "writeRunRecord" server/` to enumerate US-00b scope (now informed by Surprise 2 — expect 2 hits, only one in scope)
- [ ] `grep CostTracker server/tools/evaluate.ts` to resolve VERIFIED NEEDED on US-00b

### Sessions (execute in order)

- [x] Session 1: PRD via `/prd` — `docs/forge-coordinate-prd.md` shipped in [PR #109](https://github.com/ziyilam3999/forge-harness/pull/109), v0.16.1 (2026-04-09)
- [ ] Session 2: Master Plan + Phase Plans + coherence eval **(prompt to be written after pre-S2 action items above are resolved)**
- [ ] Session 3: PH-01 — Types, Topo Sort, State Readers, US-00a + US-00b, Core Loop (8 stories) **(prompt fresh after S2)**
- [ ] Session 4: PH-02 — Budget, Time, INCONCLUSIVE, Crash Recovery (4 stories) **(prompt fresh after S3)**
- [ ] Session 5: PH-03 — ReplanningNote, Reconciliation, Observability (5 stories) **(prompt fresh after S4)**
- [ ] Session 6: PH-04 — MCP Handler, Config Loader (US-01.5), Checkpoint Gates, Tests, Dogfood (5 stories) **(prompt fresh after S5)**
- [ ] Session 7: Divergence measurement **(prompt fresh after S6)**

### Queued behind coordinate (post-ship)

- [ ] Memory architecture (T1/T2/T3 + indexer + `/recall` skill) — design at `.ai-workspace/plans/2026-04-09-forge-memory-ui-package-design.md` Part B
- [ ] UI prototype workflow (`/prototype` skill + forge-harness type integration) — design at same file Part C
- [ ] Public monorepo packaging (setup.sh, examples, docs) — design at same file Part C
- [ ] Promote P57/P58 from PROPOSED to ratified after memory architecture ships and validates them

Last updated: 2026-04-09T18:45:00+08:00
