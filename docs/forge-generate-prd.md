# PRD: forge_generate — GAN Loop Controller & Brief Assembler

**Version:** 1.0
**Date:** 2026-04-07
**Author:** Anson Lam (with AI assist)
**Status:** Final

---

## 1. Problem Statement

forge-harness ships two of three core primitives: `forge_plan` (planning engine) and `forge_evaluate` (stateless binary grading via shell commands). The pipeline has a missing middle piece — forge_plan outputs execution plans with stories and acceptance criteria that nobody can auto-execute, and forge_evaluate grades code that nobody auto-generates.

**Current state:** The builder implements stories in a single-shot approach (no structured iteration loop). Fewer than 30% of stories pass all acceptance criteria on the first try. The remaining 70%+ require unstructured manual debugging with:
- No iteration discipline (manually calling forge_evaluate, reading JSON reports, pasting failing criteria back into prompts)
- No stopping logic (no plateau detection, no hash-based no-op detection, no max iteration enforcement)
- Bloated context windows (entire eval reports + full codebase context pasted into each fix attempt)
- Phase 4 (`forge_coordinate`) completely blocked — it requires `forge_generate` as a callable sub-tool

**Billing constraint:** The builder is on Claude Code Max (unlimited subscription). MCP server tools that call `callClaude()` hit api.anthropic.com directly with separate ANTHROPIC_API_KEY billing. forge_generate must NOT make Claude API calls. All LLM work happens in Claude Code (Max, free). forge_generate is a **brief assembler + loop controller** — it provides structured context, runs evaluations via shell commands, and makes stopping decisions.

---

## 2. Objective

Implement `forge_generate` as the third forge-harness MCP tool primitive that:
1. Completes the plan → generate → evaluate pipeline, enabling structured GAN loops (implement → evaluate → fix → evaluate)
2. Assembles context-rich briefs for Claude Code (the free generator) on init and fix iterations
3. Makes intelligent stopping decisions using all 8 GAN elements from the design doc
4. Integrates with existing three-tier infrastructure (RunContext, CostTracker, ProgressReporter, AuditLog)
5. Accepts three-tier document inputs (PRD, master plan, phase plan) and tracks document lineage
6. Provides self-tracking via JSONL for observability and forge_coordinate consumption
7. Serves as the callable interface that unblocks forge_coordinate (Phase 4)

---

## 3. Requirements

### REQ-01: Init Brief Assembly

**User story:** As a Claude Code session implementing a story, I call forge_generate with a story ID and execution plan so that I receive a structured GenerationBrief with all the context I need to start implementation, without manually assembling it.

**Acceptance criteria:**
- `forge_generate({storyId: "US-01", planJson: validPlan})` returns `action: "implement"` with a `brief` object
- `brief` contains all four fields: `story` (from plan), `codebaseContext` (from scanCodebase), `gitBranch` (e.g., `"feat/US-01"`), `baselineCheck` (e.g., `"npm run build && npm test"`)
- `brief.gitBranch === "feat/US-01"` for storyId `"US-01"`

**Example input:**
```json
{
  "storyId": "US-01",
  "planJson": "{\"schemaVersion\":\"3.0.0\",\"stories\":[{\"id\":\"US-01\",\"title\":\"Add login\",\"acceptanceCriteria\":[{\"id\":\"AC-01\",\"description\":\"Login returns 200\",\"command\":\"curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login\"}]}]}"
}
```

**Example output:**
```json
{
  "action": "implement",
  "storyId": "US-01",
  "iteration": 0,
  "maxIterations": 3,
  "brief": {
    "story": {"id": "US-01", "title": "Add login", "acceptanceCriteria": [...]},
    "codebaseContext": "TypeScript project, 12 files, vitest test framework...",
    "gitBranch": "feat/US-01",
    "baselineCheck": "npm run build && npm test"
  }
}
```

---

### REQ-02: Fix Brief Assembly

**User story:** As a Claude Code session that received a FAIL eval report, I call forge_generate with the eval report so that I receive a focused FixBrief containing only failing criteria and their evidence, avoiding context bloat.

**Acceptance criteria:**
- Given an evalReport with 2 PASS, 1 FAIL, 1 SKIPPED criteria, forge_generate returns `action: "fix"`
- `fixBrief.score === 0.667` (2 PASS / 3 non-SKIPPED = 0.667)
- `fixBrief.failedCriteria.length === 1` (only the failing criterion)
- Each failed criterion includes `id`, `description`, and `evidence` (command output)

---

### REQ-03: Plateau Detection

**User story:** As the loop controller, I detect when the generator is stuck (no score improvement across consecutive iterations) so that I can escalate instead of wasting iterations.

**Acceptance criteria:**
- `forge_generate({..., previousScores: [0.5, 0.5, 0.5]})` returns `action: "escalate"`, `escalation.reason: "plateau"`
- Plateau triggers when score delta = 0 for 2 consecutive iterations (3 identical scores in the history)
- `forge_generate({..., previousScores: [0.3, 0.5, 0.5]})` also triggers plateau (last 2 deltas are 0)
- `forge_generate({..., previousScores: [0.3, 0.5]})` does NOT trigger plateau (only 1 zero-delta)

---

### REQ-04: No-Op Detection (Hash-Based)

**User story:** As the loop controller, I detect when the generator's fix attempt produced no actual code changes so that I can escalate immediately instead of re-evaluating identical code.

**Acceptance criteria:**
- When `fileHashes` from the current iteration match the previous iteration's hashes exactly, forge_generate returns `escalation.reason: "no-op"`
- The caller is responsible for computing and passing SHA-256 file hashes
- forge_generate compares hash maps, not file contents

---

### REQ-05: Max Iterations Gate

**User story:** As the loop controller, I enforce a hard stop when the maximum iteration count is reached so that runaway loops are prevented.

**Acceptance criteria:**
- `forge_generate({..., iteration: 3, maxIterations: 3})` returns `escalation.reason: "max-iterations"`
- Default `maxIterations` is 3 when not specified
- `forge_generate({..., iteration: 2, maxIterations: 3})` does NOT trigger max-iterations (still has headroom)

---

### REQ-06: Structured Escalation Reports

**User story:** As a Claude Code session or forge_coordinate, when forge_generate escalates I receive a structured report explaining what went wrong so that I (or the coordinator) can decide next steps without re-investigating.

**Acceptance criteria:**
- Every escalation result contains: `reason` (enum), `description` (non-empty string), `hypothesis` (string or null for baseline failures), `lastEvalVerdict` (FAIL or INCONCLUSIVE), `scoreHistory` (number array)
- `description` is a human-readable explanation specific to the failure (not generic)

---

### REQ-07: INCONCLUSIVE Handling

**User story:** As the loop controller, when evaluation tools are unavailable (INCONCLUSIVE verdict) I escalate immediately rather than iterating blindly.

**Acceptance criteria:**
- `forge_generate({..., evalReport with verdict: "INCONCLUSIVE"})` returns `escalation.reason: "inconclusive"` regardless of iteration count or score history
- INCONCLUSIVE takes precedence over all other stopping conditions

---

### REQ-08: Self-Tracking (JSONL)

**User story:** As forge_coordinate or a human reviewing pipeline runs, I can read structured run data from JSONL files to understand what happened during generation.

**Acceptance criteria:**
- After a successful forge_generate call with `projectPath` set, `.forge/runs/data.jsonl` contains a new JSONL line
- Each line contains: `timestamp`, `storyId`, `iteration`, `action`, `score` (if available), `durationMs`
- File is append-only (new calls add lines, never overwrite)
- If `projectPath` is not set, no JSONL is written (no error)

---

### REQ-09: Three-Tier Document Inputs

**User story:** As a Claude Code session working in a three-tier document pipeline, I pass PRD/master-plan/phase-plan content to forge_generate so that the generation brief includes document context, not just codebase context.

**Acceptance criteria:**
- forge_generate accepts optional `prdContent`, `masterPlanContent`, and `phasePlanContent` string parameters
- When provided, document content appears in a `brief.documentContext` field (structured, not dumped into codebaseContext)
- When none are provided, `brief.documentContext` is omitted or null (no error)

---

### REQ-10: Context Injection Parameter

**User story:** As a caller, I pass specific file paths to forge_generate so that their contents are included in the brief, giving me control over what additional context the generator sees.

**Acceptance criteria:**
- forge_generate accepts optional `contextFiles: string[]` parameter (array of absolute file paths)
- Contents of each file are read and included in the brief under `brief.injectedContext`
- If a file does not exist, it is skipped with a warning in the brief (not an error)
- Empty array or omitted parameter: no injected context (no error)

---

### REQ-11: Document Lineage

**User story:** As forge_coordinate or a human auditing, I can trace each story back to the document tier it originated from (PRD, master plan, or phase plan).

**Acceptance criteria:**
- When a story's execution plan includes lineage metadata (source tier and ID), `brief.lineage` contains `{tier: "phase-plan" | "master-plan" | "prd", sourceId: string}`
- When no lineage metadata is present in the plan, `brief.lineage` is omitted (no error)
- Lineage is pass-through — forge_generate reads it from the plan, not infers it

---

### REQ-12: RunContext Integration

**User story:** As the observability infrastructure, forge_generate uses RunContext for progress reporting and audit logging so that all tool calls are traceable.

**Acceptance criteria:**
- forge_generate creates a `RunContext` with `toolName: "forge_generate"`
- Progress stages are reported via `ProgressReporter` (at minimum: "init" or "iterate")
- Audit entries are written via `AuditLog` (at minimum: one entry per call with the action taken)
- After a forge_generate call with `projectPath`, `.forge/audit/forge_generate-*.jsonl` exists with at least one entry
- CostTracker records $0 cost (no API calls) but is wired for aggregation

---

### REQ-13: Fail-Fast Eval Hint (Expansion)

**User story:** As the caller orchestrating the eval step, I receive a priority-ordered list of failing ACs from the fix brief so that I can configure forge_evaluate to short-circuit on hard failures, saving evaluation time.

**Acceptance criteria:**
- `fixBrief.failedCriteria` is ordered by severity/priority (functionality failures first, design failures last)
- `fixBrief.evalHint` contains `{failFastIds: string[]}` listing the AC IDs that should be checked first
- If all criteria have equal priority, order matches the plan's original AC order

---

### REQ-14: Diff Manifest Output (Expansion)

**User story:** As the caller, after a fix iteration I receive a structured change manifest so that I can pass it to forge_evaluate for differential evaluation (only re-test what changed).

**Acceptance criteria:**
- On fix iterations (iteration >= 1), the result includes `diffManifest: {changed: string[], unchanged: string[], new: string[]}` listing file paths
- The manifest is computed by comparing `fileHashes` from the current and previous iterations
- On init calls (iteration = 0), `diffManifest` is omitted

---

### REQ-15: Baseline Failure Diagnostics (Expansion)

**User story:** As a Claude Code session, when the baseline check (build+test) fails before the loop starts, I receive structured diagnostics so that I can attempt auto-repair without manual investigation.

**Acceptance criteria:**
- When baseline check fails, `escalation.reason: "baseline-failed"` and `escalation.diagnostics` contains: `exitCode` (number), `stderr` (string, truncated to 2000 chars), `failingTests` (string array, best-effort parsed from output)
- `escalation.diagnostics` is only present on baseline failures (not other escalation reasons)

---

### REQ-16: Iteration Cost Estimation (Expansion)

**User story:** As forge_coordinate managing a budget, I receive token cost estimates per iteration so that I can make budget-aware stopping decisions.

**Acceptance criteria:**
- Each forge_generate result includes `costEstimate: {briefTokens: number, projectedIterationCostUsd: number, projectedRemainingCostUsd: number}`
- `briefTokens` is the approximate token count of the assembled brief (character count / 4 heuristic)
- `projectedIterationCostUsd` estimates the cost of one generator + evaluator iteration based on brief size and Opus pricing
- `projectedRemainingCostUsd = projectedIterationCostUsd * (maxIterations - iteration)`
- When on Claude Code Max (no API calls from this tool), `projectedIterationCostUsd` reflects the caller's cost ($0 for Max users), with a note that coordinator API calls would cost more

---

## 4. Non-Functional Requirements

- **NFR-01: Zero API calls.** forge_generate must not call the Claude API (callClaude). All LLM work happens in the calling Claude Code session (Max, free).
- **NFR-02: Response time.** forge_generate must return within 5 seconds for init calls and 2 seconds for iteration calls (excluding file I/O for large codebases).
- **NFR-03: Windows compatibility.** All file paths, timestamps, and JSONL output must work on Windows (no colons in filenames, forward-slash-safe paths).
- **NFR-04: Idempotent reads.** forge_generate must not modify the execution plan, project files, or git state. It is a read-only advisor — the caller (Claude Code) performs all mutations.
- **NFR-05: Graceful degradation.** If self-tracking (JSONL), audit logging, or cost estimation fails, forge_generate must still return the brief/decision. Observability failures must not block the core loop.
- **NFR-06: Plan schema compatibility.** forge_generate must accept execution plans produced by the current forge_plan (schemaVersion 3.0.0).

---

## 5. User Workflow

### Happy Path: Story Implementation

1. **Caller** invokes `forge_generate({storyId: "US-01", planJson: plan})` → receives GenerationBrief
2. **Caller** runs baseline check command from brief
3. **Caller** creates git branch `feat/US-01`
4. **Caller** implements code based on brief context
5. **Caller** commits (pre-commit hooks handle fast-tier feedback)
6. **Caller** invokes `forge_evaluate({storyId: "US-01", planJson: plan})` → receives EvalReport
7. If PASS → squash-merge branch, done
8. If FAIL → **Caller** invokes `forge_generate({storyId: "US-01", planJson: plan, evalReport: report, iteration: 1, previousScores: [0.5], fileHashes: hashes})` → receives FixBrief or Escalation
9. If fix → Caller fixes code, go to step 5
10. If escalate → Caller writes escalation report, stops

### Escalation Path

1. forge_generate returns `action: "escalate"` with structured report
2. Caller (or forge_coordinate) reads the report: reason, hypothesis, score history
3. Decision: retry with fresh context, reassign story, or mark as blocked

---

## 6. Success Criteria

All criteria are binary pass/fail:

- **SC-01:** `forge_generate` is registered as an MCP tool and callable via Claude Code
- **SC-02:** Init call returns a complete GenerationBrief for any valid story in a valid execution plan
- **SC-03:** Fix iteration call returns a FixBrief with correct score computation (PASS/non-SKIPPED ratio)
- **SC-04:** All 5 stopping conditions (plateau, no-op, max-iterations, inconclusive, baseline-failed) trigger correctly with the specified inputs
- **SC-05:** JSONL self-tracking produces parseable run records after each call
- **SC-06:** Three-tier document inputs appear in the brief when provided and are absent without error when omitted
- **SC-07:** Full test suite (`npm test`) passes with forge_generate tests included
- **SC-08:** TypeScript compilation (`tsc --noEmit`) succeeds with zero errors
- **SC-09:** Zero Claude API calls originate from forge_generate (verified by grepping for `callClaude` in the tool's dependency chain)

---

## 7. Out of Scope

| Excluded | Rationale |
|----------|-----------|
| **Code generation / LLM calls** | forge_generate is a brief assembler + loop controller. The caller (Claude Code) does all LLM work. This is the fundamental architecture constraint. |
| **Git operations** | forge_generate returns branch names and merge instructions. The caller performs all git operations (branch creation, commits, squash-merge). |
| **File writes to project** | forge_generate reads the codebase (via scanCodebase) but never writes to project files. Write operations are the caller's responsibility. |
| **Command blocklist enforcement** | Deferred to Phase 4 (forge_coordinate sandbox). forge_generate doesn't execute user commands; it assembles briefs. |
| **Concurrent story execution** | Single-story, single-threaded. Concurrency is forge_coordinate's responsibility. |
| **Prompt engineering** | No prompt builders needed because forge_generate makes no API calls. Brief content is structured data, not LLM prompts. |
| **Evaluator integration changes** | forge_evaluate is called separately by the caller, not by forge_generate. No changes to evaluator needed. |

---

## 8. Future Scope / Roadmap

- **Phase 4: forge_coordinate integration** — Coordinator dispatches forge_generate per story, aggregates costs, manages concurrency and dependency ordering
- **Differential evaluation mode** — forge_evaluate consumes the diff manifest (REQ-14) to skip unchanged criteria
- **Fail-fast evaluation** — forge_evaluate consumes eval hints (REQ-13) to short-circuit on hard failures
- **Tiered model selection** — Future cost optimization: evaluator on Haiku, generator stays on Opus
- **Memory graduation** — Collect patterns from eval reports across stories, graduate stable findings to knowledge-base
- **Specialist parallel critics** — Thorough tier: multiple evaluator subagents for different concern areas (security, performance, correctness)

---

## 9. Open Questions

All questions resolved during the diagnostic interview:

- **Baseline check command source (RESOLVED):** Read from an optional `baselineCheck` field in the execution plan. If absent, fall back to `"npm run build && npm test"`. This enables cross-ecosystem use without requiring schema changes for existing plans.
- **Document lineage schema (RESOLVED):** Add an optional `lineage: {tier: "phase-plan" | "master-plan" | "prd", sourceId: string}` field to each story in the ExecutionPlan schema. forge_plan populates it when three-tier documents are provided as input. Backward compatible (optional field).
- **fileHashes responsibility (RESOLVED):** Entirely the caller's responsibility. forge_generate takes hashes as input and compares them. No helper utility needed — keeps the MCP tool simple and the caller in control.

---

## 10. Evidence Base

### Demand Evidence (Q1)
forge_plan and forge_evaluate are shipped primitives that create an incomplete pipeline. forge_plan outputs execution plans with stories nobody can auto-execute; forge_evaluate grades code nobody auto-generates. The pipeline is structurally broken without forge_generate.

### Status Quo (Q2)
Current workaround is single-shot implementation with no structured iteration loop. <30% of stories pass all ACs on first try. 70%+ require unstructured manual debugging — manually calling forge_evaluate, reading JSON, pasting criteria back into prompts, with no stopping logic or context management.

### User Research (Q3)
Primary user is the solo builder (author + first customer of forge-harness). Needs to validate the GAN architecture end-to-end. Secondary consumer is forge_coordinate (Phase 4), which requires forge_generate as a callable sub-tool.

### Agreed Premises
1. forge_generate is the missing middle piece — the pipeline is broken without it
2. Target user is the solo builder (author + first customer), with forge_coordinate as secondary consumer
3. Scope is the full Phase 3 spec + expansions (brief assembler, all 8 GAN elements, self-tracking, three-tier inputs, document lineage, fail-fast hints, diff manifest, baseline diagnostics, cost estimation)
4. Doing nothing costs 70%+ manual debugging, no iteration discipline, and Phase 4 completely blocked
