# Forge Primitives — Complete Backlog

> This file is the persistent reference for ALL ideas and items per primitive.
> The plan file captures the current scope; this file captures the full backlog.
> When rewriting plans, check this file to ensure nothing is lost.
>
> Last updated: 2026-04-07

---

## `/plan` (Planner)

### Already Implemented
- Double-critique loop: planner → critic 1 → corrector → critic 2 → corrector (`plan.ts`)
- Mode auto-detection: keyword-based bugfix detection (`plan.ts:42-48`)
- Retry-with-feedback on validation failure (`plan.ts:99-128`)
- Bugfix AC-01 reproduction rule (`planner.ts:13-14`)
- Reserved field prohibition: prdPath, flaky (`planner.ts:68-70`)
- Codebase scan: directory listing + key file reads (`codebase-scan.ts`)
- Critic 6-point review: binary ACs, verifiability, dependencies, scope, coverage, affectedPaths (`critic.ts`)
- Corrector dispositions: applied/skipped per finding (`corrector.ts`)
- Critic failure graceful degradation — returns empty findings (`plan.ts:162-168`)
- Corrector failure fallback — returns original plan (`plan.ts:205, 214`)
- Token usage tracking via UsageAccumulator (`plan.ts:69-72, 311-313`)
- Schema v3.0.0 validation with DFS cycle detection (`execution-plan.ts, validation/`)
- Duplicate story/AC ID detection, non-empty arrays, dependency ref validation
- OAuth token fallback for Claude Code Max (`anthropic.ts:45-68`)
- JSON extraction strategy with regex fallback (`anthropic.ts:90-134`)

### In Design Doc — Not Yet Implemented
- Context7 MCP for library/framework docs (design doc line 167, deferred Phase 5)
- Multi-perspective critics at thorough tier (design doc lines 184, 262, deferred Phase 5)
- UI prototyping auto-trigger (design doc line 169, deferred Phase 5)
- Specialist analysis / role agents (design doc line 168, deferred Phase 5)
- Failure mode: codebase too large — no explicit large-repo fallback (design doc line 192)
- `intent`, `mode`, `tier` persistence in output JSON (design doc lines 199-202, not stored)
- `cost`/`time budget` fields (design doc lines 172, 201-202, deferred Phase 4)
- `status` field on stories (design doc line 213, deferred Phase 4)
- `designCriteria` on stories — visual rubric (design doc, Phase 2b)
- `repo` field — multi-repo (design doc, Phase 5)
- Self-tracking `.forge/runs/` (design doc line 218, deferred Phase 4)
- Critic failure should block per design doc line 94 (contradicts code — see REC-8)

### New Improvement Ideas
- **Three-tier document system**: `documentTier` param (master/phase/update modes)
- **Master plan generation**: vision doc → phased MasterPlan with inputs/outputs
- **Phase plan generation**: contextualized with vision + master plan
- **Update mode**: reconcile plan with implementation reality
- **Context injection**: `context` param — array of {label, content} for memory/KB/prior plans
- **maxContextChars** with entry-level truncation (default 50k)
- **Tool access for planner agent**: Claude tool_use API — read_file, search_codebase (future)
- **Memory/KB access**: inject hive-mind-persist/memory.md and knowledge-base/ into planner context
- **Purely functional ACs**: new planner rule — ACs verify behavior, never implementation method
- **Implementation coupling critic check**: flag ACs that grep source code for patterns
- **CostTracker**: tokens per stage, pricing multiplier, advisory budget, OAuth labeling
- **ProgressReporter**: dynamic stage list, stderr logging, fail() method
- **AuditLog**: structured decisions, .forge/audit/ persistence, 1000-file warning
- **RunContext + trackedCallClaude**: bundles cost/progress/audit without coupling callClaude
- **Richer codebase scan**: dependency graphs from package.json, test patterns, config files

---

## `/evaluate` (Evaluator)

### Already Implemented
- Shell command execution with timeout (`executor.ts`, DEFAULT_TIMEOUT_MS=30s)
- Evidence truncation at 4000 chars (`executor.ts:7`)
- INCONCLUSIVE for exec errors (`executor.ts:76-82`)
- Windows bash shell forcing (`executor.ts:41`)
- Empty AC list = vacuous PASS with warning (`evaluator.ts:27-36`)
- computeVerdict priority: FAIL > INCONCLUSIVE > PASS (`evaluator.ts:70-80`)
- EvalReport schema with PASS/FAIL/SKIPPED/INCONCLUSIVE statuses
- Warnings array validation (`validation/eval-report.ts`)
- SKIPPED pre-allocated in VALID_STATUSES but never produced

### In Design Doc — Not Yet Implemented
- Differential evaluation: re-test FAIL+SKIPPED only, cache PASS (design doc lines 252-254, coordinator-dependent)
- Ordered eval with fail-fast: cheap criteria first, stop on FAIL (design doc line 249, coordinator-dependent)
- SKIPPED criterion status: only produced by fail-fast (design doc line 253)
- Flaky criteria retry: `flaky: true` opt-in, retry on failure (design doc lines 250-251, schema exists but no logic)
- Few-shot skepticism / skeptical-evaluator skill (design doc line 256, no LLM-judged criteria yet)
- Visual rubric / Playwright screenshots (design doc lines 241-247, Phase 2b)
- Multi-perspective parallel critics at thorough tier (design doc line 262, Phase 5)
- Trace logging / JSONL per evaluation (design doc line 261, deferred)
- Self-tracking `.forge/evals/` (design doc line 270, deferred)
- Code quality rubric (tsc + lint) — delegated to user ACs (design doc line 237)
- Regression safety (test suite delta) — delegated to user ACs (design doc line 238)
- Architecture checks (export/interface grep) — delegated to user ACs (design doc line 239)

### New Improvement Ideas
- **totalTimeoutMs**: cap entire story evaluation across all ACs
- **Windows process tree kill**: taskkill /T /F or tree-kill for timeouts
- **Command filter**: regex blocklist on raw command string (defense-in-depth, not security boundary)
- **allowDangerous override**: per-AC flag, trust-the-author
- **Parallel AC execution**: opt-in, maxParallelACs default 4, shared-state caveat
- **Coherence evaluation mode**: PRD ↔ master ↔ phase alignment (LLM-judged)
- **Divergence evaluation mode**: forward gaps (AC failures) + reverse gaps (unplanned capabilities)
- **Self-healing integration**: divergence detection → forge_plan(update) → reconcile
- **Guardrail setter for ALL primitives**: evaluate gates every primitive's output (D10)
  - Master plan: vision coverage, phase sequencing, input/output chains
  - Phase plan: phase alignment, AC quality (functional not implementation-coupled), coverage
  - Update plan: consistency, divergence capture, no silent degradation
  - Generate: AC pass/fail + reverse divergence scan
  - Coordinate: budget compliance, story ordering, blocked-phase handling
- **Enforcement tier mapping**: Tier 1 (schema validation, regex), Tier 2 (coherence dimensions), Tier 3 (run record trending), Tier 4 (critic prompts)
- **Constitution.md integration**: evaluate reads constitution.md for verification philosophy and enforcement tiers
- **CostTracker, ProgressReporter, AuditLog, RunContext** (same as /plan)

---

## `/generate` (Generator) — COMPLETE (v0.16.0, all 4 phases shipped)

### Already Implemented
- GenerateResult, GenerationBrief, FixBrief, Escalation, CostEstimate, DiffManifest, EvalHint types (`server/types/generate-result.ts`) (v0.13.0, PH-01)
- Init brief assembly: `buildBrief` — plan + storyId + projectPath → GenerationBrief with codebaseContext, gitBranch, baselineCheck (`server/lib/generator.ts`) (v0.13.0, PH-01)
- Fix brief assembly: `buildFixBrief` — extract FAIL criteria from eval report, `computeScore` (PASS/non-SKIPPED ratio), `buildDiffManifest` (changed/unchanged/new files), `evalHint` with failFastIds (`server/lib/generator.ts`) (v0.13.0, PH-01)
- 5 stopping conditions in `checkStoppingConditions`: plateau (last 2 of 3+ scores equal), no-op (matching fileHashes), max-iterations, inconclusive (highest precedence), baseline-failed with diagnostics (`server/lib/generator.ts`) (v0.13.0, PH-01)
- Structured escalation reports: reason-specific descriptions, hypothesis, scoreHistory, diagnostics on baseline-failed (`server/lib/generator.ts`) (v0.13.0, PH-01)
- Core orchestrator: `assembleGenerateResult` — no evalReport → implement, PASS → pass, stopping condition → escalate, FAIL → fix (`server/lib/generator.ts`) (v0.13.0, PH-01)
- `baselineCheck?: string` on ExecutionPlan, `lineage?: StoryLineage` on Story — optional, backward compatible (`server/types/execution-plan.ts`) (v0.13.0, PH-01)
- Shared `loadPlan` extracted from evaluate.ts → `server/lib/plan-loader.ts` (v0.13.0, PH-01)
- RunContext wiring: `assembleGenerateResultWithContext` wraps pure core with toolName `forge_generate`, ProgressReporter stages (`init`/`iterate`), AuditLog entries, CostTracker at $0 (`server/lib/generator.ts`) (v0.14.0, PH-02)
- JSONL self-tracking: append-only run records to `.forge/runs/data.jsonl` with timestamp, storyId, iteration, action, score, durationMs — graceful on failure (`server/lib/generator.ts`) (v0.14.0, PH-02)
- Cost estimation: `computeCostEstimate` — briefTokens (char_count/4), projectedIterationCostUsd (Opus pricing, $0 for Max users), projectedRemainingCostUsd (`server/lib/generator.ts`) (v0.14.0, PH-02)
- Three-tier document inputs: `buildBrief` accepts optional `prdContent`, `masterPlanContent`, `phasePlanContent` → `brief.documentContext` structured object, omitted when none provided (`server/lib/generator.ts`) (v0.15.0, PH-03)
- Context injection: `buildBrief` accepts optional `contextFiles` string array → reads each file into `brief.injectedContext`, skips missing with warning (`server/lib/generator.ts`) (v0.15.0, PH-03)
- Lineage pass-through: `story.lineage` from plan passes through to `brief.lineage` — read-only, not inferred (`server/lib/generator.ts`) (v0.15.0, PH-03)
- MCP handler: `handleGenerate` with 15-field zod input schema, wired to `assembleGenerateResultWithContext`, JSON-serialized evalReport/baselineDiagnostics parsing, error handling (`server/tools/generate.ts`) (v0.16.0, PH-04)
- Tool registration: `forge_generate` registered with `readOnlyHint: true`, full description documenting brief assembler + stopping conditions (`server/index.ts`) (v0.16.0, PH-04)
- Integration tests: 23 tests covering init/fix/escalate cycle, all 6 NFRs (zero callClaude, response time, Windows paths, read-only, graceful degradation, schema 3.0.0) (`server/tools/generate.test.ts`) (v0.16.0, PH-04)
- Dogfood validated: real PH-04 execution plan tested through all 3 action paths (`.ai-workspace/plans/forge-generate-dogfood-report.md`) (v0.16.0, PH-04)

### In Design Doc — To Be Implemented (forge_coordinate scope)
- GAN loop orchestration: implement → evaluate → fix → evaluate, max 3 rounds (design doc lines 280-310) — forge_generate provides the primitives, forge_coordinate orchestrates
- 8 production-grade GAN elements (core logic done; remaining: git branching, command blocklist, two-tier feedback wiring — all forge_coordinate scope):
  3. Two-tier feedback: fast (hooks exit-code-2) + slow (/evaluate subagent)
  4. Hash-based no-op detection — **logic done** (PH-01), git integration is caller responsibility
- Per-story git branches (feat/{story-id}), squash-merge on finalization — caller responsibility
- Git-native rollback on fail — caller responsibility
- Command blocklist + path-scoped writes (design doc line 290) — forge_coordinate scope

### New Improvement Ideas
- **file-ops.ts**: sandboxed file read/write (project directory only, defense-in-depth)
- **git-ops.ts**: branch per story, commit per iteration, squash-merge
- **Max-iteration exit policy**: mark story failed, return last eval report
- **Git failure handling**: abort iteration, record in audit, report as failed
- **Tool-use API**: Claude tool_use for generator agent to decide files to create/modify
- **Cost estimation output token multiplier**: current assumes output ≈ input; real-world is 2-4x (#78)
- **extractScore escalation capture**: use last scoreHistory value instead of null on escalate (#79)

---

## `/coordinate` (Coordinator) — STUB, Phase 4-5

### Architecture Decision: Intelligent Clipboard by Default

forge_coordinate follows the **Intelligent Clipboard pattern** — it assembles a "phase transition brief" containing all signals (divergence report, coherence report, replanning notes, cost/budget status) and returns it with a recommended action. The calling Claude Code session (free inference) makes the triage decision.

**Escape hatch:** `coordinateMode: "autonomous" | "advisory"` parameter. Default = "advisory" ($0, returns recommendations). Autonomous = makes own LLM calls for triage when ambiguous state requires judgment (e.g., multiple divergences + coherence gaps — should next phase proceed?).

### In Design Doc — To Be Implemented
- execution-plan.json IS the state; status fields updated by /generate (design doc line 320)
- Checkpoint gates: human approval at phase boundaries (design doc line 321-324)
- Cost tracking + velocity alerting (design doc lines 327-329, PROVISIONAL)
- Budget exceeded: complete current story, stop (design doc)
- Concurrency: affectedPaths-based file overlap detection, serialize conflicts (design doc lines 331-332)
- Memory graduation: collect findings, graduate to knowledge-base/ (design doc line 334)
- Observability: aggregate JSONL traces into status view (design doc line 335)
- Rollback: only merge passing story branches (design doc line 336)
- Crash recovery: check eval-report for VERDICT, skip to finalization if PASS (design doc line 337-338)
- Time budget enforcement: 80% warning, 100% stop (design doc lines 338-339)
- INCONCLUSIVE handling: mark story blocked, block dependents, continue non-blocked (design doc lines 339-340)
- Double-critique on final report (design doc line 340)
- Mode and tier read from plan (design doc line 341-342)

### New Improvement Ideas
- **Topological story dispatch**: dependency-ordered execution
- **Consolidated dashboard**: per-story status, accumulated cost, progress, aggregated audit
- **Budget enforcement point**: CostTracker is advisory, Coordinate enforces
- **Audit file discovery**: glob .forge/audit/{tool}-*.jsonl
- **Three-tier integration**: after each phase, call forge_plan(documentTier: "update") to reconcile both the completed phase plan AND the master plan with implementation reality. Collect **structured replanning notes** from three sources: (a) divergence findings from forge_evaluate, (b) escalation reports from forge_generate, (c) implementation notes from the session. Feed as `replanningNotes: ReplanningNote[]` alongside existing `implementationNotes` string. Route mechanically: `ac-drift`/`assumption-changed` → master plan update; `partial-completion`/`dependency-satisfied` → phase plan update; `gap-found` → logged, deferred. (Validated by manual workflow: sessions plan updated after each session, /coherent-plan catches drift.)
- **Self-healing loop**: divergence detection → plan update → continue
- **CostTracker, ProgressReporter, AuditLog, RunContext** (same as /plan)

### ReplanningNote Type (Design Sketch)

Structured notes for post-phase plan reconciliation. Created when forge_coordinate is implemented.

```typescript
interface ReplanningNote {
  category: "ac-drift" | "partial-completion" | "dependency-satisfied" | "gap-found" | "assumption-changed";
  description: string;                // free text for LLM to reason over
  affectedPhases?: string[];          // ["PH-02", "PH-04"]
  affectedStories?: string[];         // ["PH02-US01", "PH03-US03"]
  severity: "blocking" | "should-address" | "informational";
}
```

**Routing rules (mechanical, no LLM needed):**
- `ac-drift` + `assumption-changed` → master plan update via forge_plan(update)
- `partial-completion` + `dependency-satisfied` → phase plan update via forge_plan(update)
- `gap-found` → logged to audit, deferred to next planning session
- `severity: "blocking"` → halt phase progression (any note with severity `blocking` halts phase progression)
- `affectedPhases` → targeted updates (only re-plan affected phases, not all remaining)

### Brain-Dump Ideas (2026-04-08, full classification)

On 2026-04-08, user brain-dumped ~15 forge_coordinate ideas. Full disposition recorded in `~/.claude/plans/piped-sprouting-island.md` Part 4. Preserved here so future readers don't re-litigate the decisions from scratch.

**Classification summary:**

| Category | Ideas | Disposition |
|---|---|---|
| Already in MVP | Reasoning per primitive call, audit trails, consolidated view (cost/progress/audit), stop/resume/course-correct (partial), standard failure/recovery patterns, financial observability (partial) | Covered by PH-01 US-05 `PhaseTransitionBrief.recommendation`, `AuditLog` + `readAuditEntries()`, `aggregateStatus()` PH-03 US-03, crash recovery PH-02 US-04, INCONCLUSIVE blocking PH-02 US-03, ReplanningNote routing PH-03 US-01 |
| Net-new MVP | Config file for orchestration behavior | Became PH-04 US-01.5 after 2 rounds of schema redesign |
| Backlog v2 (forge-harness layer) | Parallel multi-agent execution + merge/conflict, richer standard failure taxonomy, full finops (cost per successful task + quality correlation), phase auto-detection, call-time tool/context provisioning | Deferred — need either real-world failure data, bigger use case, or architectural support (e.g., MasterPlan.Phase.planPath field) |
| Out-of-scope (infrastructure layer) | Agent lifecycle as managed service (spawn/health/scale/terminate), supervision hierarchy (meta-agent monitors others) | Not forge-harness's layer — k8s/Temporal territory. forge-harness is stateless MCP calls. Record as long-term research note, not actionable backlog |
| Separate primitive / skill | Persistent memory + SQL-backed search agent (→ potential `forge_recall` primitive or new skill), inspectable/editable artifacts (already done via three-tier documents), compounding context (already running via hive-mind-persist) | Not forge_coordinate scope. Each deserves its own plan when concrete need surfaces |

### Configuration File Design Decisions (forge_coordinate US-01.5)

The config file for forge_coordinate went through two rounds of scope review before landing on its v1 schema. Record here for future reference when adding new fields or designing v2 config modes.

**Rejected in R23 critic review (scope creep, never shipped):**

1. **`phaseGates: boolean`** — Required manual acknowledgment between phases. **Rejected because:** would introduce a new `status: "blocked"` trigger that conflicts with existing semantics (blocked = dep failed or INCONCLUSIVE). No unblock mechanism defined. **Replaced in R4 by:** the richer `phaseBoundaryBehavior` enum (`auto-advance` / `halt-and-notify` / `halt-hard`) which uses the existing `halted` status and optionally emits a synthetic blocking ReplanningNote. **Revisit if:** a multi-phase gating workflow needs per-phase policy (e.g., "halt after PH-02 but auto-advance after PH-01")
2. **`excludePaths: string[]`** — Glob-exclude stories from dispatch. **Rejected because:** no concrete brain-dump grounding, would change `assessPhase` classification semantics (what does "excluded" mean — done? skipped? blocked?). **Revisit if:** a concrete workflow need surfaces, e.g., selective re-runs of specific story subtrees

**Rejected in R4 by user as unsuitable for Max-plan supervised runs:**

3. **`budgetUsd: number`** — Stop coordinate when aggregated prior-run cost exceeds N USD. **Rejected because:** Max-plan users have no hard cost ceiling; halting mid-phase creates work rather than saving it. Brief is called once per cycle, not hot-path — cost aggregation is nearly free but the halt behavior is user-hostile for supervised runs. **Revisit if:** forge-harness is deployed in pay-per-token contexts (enterprise API billing, multi-tenant SaaS), or for nightly/unsupervised batch runs where a human isn't watching
4. **`maxTimeMs: number`** — Stop coordinate when wall-clock elapsed since `startTimeMs` exceeds N ms. **Rejected because:** supervised users accept long runs; interrupting mid-phase loses context. **Revisit if:** CI/CD contexts where hung processes need a hard timeout, or shared-compute environments with time quotas
5. **`escalationThresholds: { consecutiveInconclusive, consecutiveFail }`** — Halt phase after N consecutive ambiguous/failing stories. **Rejected because:** defensive automation hides signal the human would catch live. If 3 stories in a row fail, either the plan is broken or the implementer is stuck — either way, a human should intervene on the plan, not rely on a halt. **Revisit if:** unsupervised/nightly runs where auto-halt is the ONLY failure circuit breaker

**v1 schema (shipped in PH-04 US-01.5):** `storyOrdering`, `phaseBoundaryBehavior`, `briefVerbosity`, `observability.{logLevel, writeAuditLog, writeRunRecord}`. Purpose: **output shaping and observability control**, not resource capping. Designed for supervised power-user workflows (dogfood development, plan-driven solo work, interactive sessions).

**Lesson for future config fields:** before proposing a field, ask "who actually wants this on? For what concrete workflow?" Fields that exist to guard against unsupervised runs are dead weight in a supervised context, and vice versa. A config file schema should be opinionated about its target deployment mode.

---

## Cross-Cutting Infrastructure

### RunContext System
- **CostTracker** (`server/lib/cost.ts`): token accumulation, pricing multiplier, advisory budget, OAuth labeling, PRICING_LAST_UPDATED
- **ProgressReporter** (`server/lib/progress.ts`): dynamic stage list, stderr logging, fail() method, structured output
- **AuditLog** (`server/lib/audit.ts`): structured decisions, .forge/audit/ JSONL persistence, Windows-safe timestamps, 1000-file warning
- **RunContext** (`server/lib/run-context.ts`): bundles all three, trackedCallClaude wrapper keeps callClaude pure

### Three-Tier Document System (Product Feature)
- Tier 1 — Vision Doc: `/prd` skill (reuse as-is)
- Tier 2 — Master Plan: forge_plan(documentTier: "master") with MasterPlan schema
- Tier 3 — Phase Plan: forge_plan(documentTier: "phase") with ExecutionPlan v3.0.0
- Update mode: forge_plan(documentTier: "update") for post-implementation reconciliation
- Human approves PRD once — everything else flows automatically
- Coherence eval: PRD ↔ master ↔ phase alignment
- Divergence eval: forward (AC failures) + reverse (unplanned capabilities)
- Self-healing: method divergence → update plan; functional divergence → best judgment

### Run Records (All Primitives)
- Per-invocation run record: timestamp, tool, tier, mode, token counts, findings, outcome, duration
- Storage: `.forge/runs/{tool}-{timestamp}.jsonl`
- Coordinator aggregates for velocity tracking
- Self-improvement loop: calibration signals from run history

### Memory/KB Integration (Source: ai-brain repo)
- Source of truth: `C:\Users\ziyil\coding_projects\ai-brain\hive-mind-persist\`
- 55 proven patterns (P1-P55), 50+ anti-patterns (F2-F50), constraints, process patterns, measurement data
- forge primitives read via `context` parameter — stay stateless
- Calling agent (Claude Code) reads ai-brain KB and injects relevant entries
- Key patterns to apply: P27 (tight scope), P28 (spec quality), P13 (compliance hierarchy), P43 (single source of truth), P55 (evidence-gating)
- Key anti-patterns to avoid: F2 (behavioral prose), F31 (return-type changes), F40 (misattribution), F50 (string matching)
- Feedback loop: forge runs contribute new discoveries back to ai-brain memory.md
- Future: symlink forge-harness/hive-mind-persist/ → ai-brain/hive-mind-persist/

### Unresolved Design Questions
- Critic failure: block (design doc line 94) vs degrade (code plan.ts:162-168) — REC-8 dual-mode proposed
- Cost tracking: PROVISIONAL per design doc line 327 — verify Claude API token exposure
- Large codebase fallback: scanCodebase exists but no explicit handling for huge repos
