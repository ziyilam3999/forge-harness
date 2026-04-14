# Design Doc Divergence Audit — Phase 1 & Phase 2

**Date:** 2026-04-03
**Design doc:** `docs/forge-harness-plan.md`
**Auditor:** forge-old (previous session)

---

## Phase 1: `/plan` (forge_plan) — ~35% Divergence

**Verdict:** Healthy. Core pipeline is faithful. All cuts are phase-appropriate deferrals.

### Implemented (faithful to design doc)

| Feature | Design Doc Ref | Implementation |
|---------|---------------|----------------|
| Intent → execution-plan.json | Line 160 | `handlePlan()` in `server/tools/plan.ts` |
| Mode detection (feature/bugfix/full-project) | Line 173 | `detectMode()` with keyword matching + explicit `mode` input |
| Tier support (quick/standard/thorough) | Line 175 | `effectiveTier` param, default `thorough` |
| Double-critique loop (plan → critic → revise → critic → finalize) | Lines 178-188 | `runPlanner()` → `runCritic()` → `runCorrector()`, up to 2 rounds |
| Codebase scan | Line 167 | `scanCodebase(projectPath)` before planning |
| Binary ACs (shell commands) | Line 171 | `AcceptanceCriterion.command` field |
| Schema v3.0.0 output | Line 194-216 | `ExecutionPlan` interface with `schemaVersion: "3.0.0"` |
| Validation + retry on malformed output | Implicit | `validateExecutionPlan()` + retry with error feedback |
| Token usage tracking | Line 327 | `UsageAccumulator` tracks input/output tokens |
| Critique summary in output | Implicit | `formatCritiqueSummary()` appended to response |

### Intentional naming changes (improvements, keep these)

| Design Doc | Implementation | Why Better |
|------------|---------------|------------|
| `intent` (story field) | `title` | Clearer — `intent` is the top-level PRD input, `title` is the story label |
| `verify` (AC field) | `command` | More precise — it's a shell command, not a verification concept |

### Missing / Deferred (~35% of spec)

| Feature | Design Doc Ref | Status | Why Deferred |
|---------|---------------|--------|--------------|
| Context7 MCP for library docs | Line 167-168 | Deferred → Phase 5 | Not critical for core planning; training data sufficient for now |
| UI prototyping auto-trigger | Line 169 | Deferred → Phase 5 | Visual features not in scope yet |
| Specialist analysis (role agents) | Line 168 | Deferred → Phase 5 | Critic subagents partially fill this gap; monitor quality |
| Multi-perspective critics at thorough tier | Line 108, 186 | Deferred → Phase 5 | Current double-critique catches enough; add when findings plateau |
| Cost/time budget fields in plan | Line 172, 201 | Deferred → Phase 4 | Coordinator needs this, not standalone planner |
| `status` field on stories | Line 213 | Deferred → Phase 4 | Coordinator tracks status, not planner |
| `designCriteria` on stories | Line 209 | Not implemented | Visual rubric not in scope (Phase 2b) |
| `cost` field on ACs | Line 207 | Not implemented | Fail-fast ordering not yet needed |
| `repo` field on stories | Line 211 | Not implemented | Multi-repo support not in scope |
| Self-tracking (.forge/runs/) | Line 218 | Deferred → Phase 4 | Coordinator needs this |
| Failure mode: Context7 unavailable | Line 191 | N/A | Context7 not integrated yet |
| Failure mode: codebase too large | Line 192 | Partial | `scanCodebase` exists but no explicit large-repo fallback |

### Schema differences

```
Design doc schema:
{
  "schemaVersion": "3.0.0",
  "intent": "...",              ← top-level intent
  "mode": "...",                ← stored in output
  "tier": "...",                ← stored in output
  "budget": { ... },           ← NOT in implementation
  "stories": [{
    "id": "...",
    "intent": "...",            ← implementation uses "title"
    "acceptanceCriteria": [{
      "verify": "...",          ← implementation uses "command"
      "cost": "..."             ← NOT in implementation
    }],
    "designCriteria": { ... },  ← NOT in implementation
    "repo": "...",              ← NOT in implementation
    "status": "..."             ← NOT in implementation
  }]
}

Implementation schema (server/types/execution-plan.ts):
{
  "schemaVersion": "3.0.0",
  "prdPath?": "...",            ← reserved, not populated
  "stories": [{
    "id": "...",
    "title": "...",             ← renamed from "intent"
    "dependencies?": [...],
    "acceptanceCriteria": [{
      "id": "...",
      "description": "...",
      "command": "...",         ← renamed from "verify"
      "flaky?": boolean         ← exists for future use
    }],
    "affectedPaths?": [...]
  }]
}
```

---

## Phase 2: `/evaluate` (forge_evaluate) — ~30% Divergence

**Verdict:** Healthy. Core grading pipeline is faithful. Missing features are optimizations that don't affect correctness.

### Implemented (faithful to design doc)

| Feature | Design Doc Ref | Implementation |
|---------|---------------|----------------|
| Stateless grading | Line 228 | `handleEvaluate()` receives plan + storyId, no state |
| Shell command execution | Line 229, 235 | `executeCommand()` in `server/lib/executor.ts` |
| PASS/FAIL per criterion | Line 235 | `CriterionResult` with `passed` boolean |
| Evidence capture | Line 269 | `evidence` field (stdout/stderr, truncated at 4000 chars) |
| Exit code enforcement | Line 235 | `exitCode === 0` → PASS |
| Timeout handling | Line 24 | `timeoutMs` param, default 30000ms |
| Verdict computation | Line 228 | `computeVerdict()`: any FAIL → FAIL, any INCONCLUSIVE → INCONCLUSIVE, else PASS |
| planJson/planPath precedence | Implicit | `loadPlan()` — planJson takes precedence |
| Validation of plan input | Implicit | `validateExecutionPlan()` on load |
| JSON output format | Line 269 | Returns JSON EvalReport (improvement over design doc's eval-report.md) |

### Intentional format change (improvement, keep this)

| Design Doc | Implementation | Why Better |
|------------|---------------|------------|
| `eval-report.md` output | JSON `EvalReport` | Machine-parseable for MCP consumption; forge_generate can parse directly |

### Missing / Deferred (~30% of spec)

| Feature | Design Doc Ref | Status | Why Deferred |
|---------|---------------|--------|--------------|
| Ordered eval with fail-fast | Line 249 | Not implemented | All ACs run regardless; optimization for token savings |
| Differential evaluation | Lines 252-254 | Not implemented | Requires previous eval-report; optimization |
| Flaky criteria retry | Lines 250-251 | Schema exists (`flaky?` field) | Not populated by planner; retry logic not implemented |
| Visual rubric (Playwright screenshots) | Lines 241-247 | Deferred → Phase 2b | Code-only rubric for now |
| Few-shot skepticism (skeptical-evaluator skill) | Line 256 | Not implemented | No LLM-judged criteria yet |
| Multi-perspective critics at thorough tier | Line 262 | Deferred → Phase 5 | Single evaluator sufficient for code rubric |
| Trace logging (JSONL per evaluation) | Line 261 | Not implemented | Self-tracking deferred to Phase 4 |
| Self-tracking (.forge/evals/) | Line 270 | Deferred → Phase 4 | Coordinator needs this |
| Code quality rubric (tsc + lint) | Line 237 | Not built-in | User's ACs can include these commands |
| Regression safety (test suite delta) | Line 238 | Not built-in | User's ACs can include test commands |
| Architecture checks (export/interface grep) | Line 239 | Not built-in | User's ACs can include grep commands |
| SKIPPED criterion status | Line 253 | Not implemented | No fail-fast = no skipping |
| Corrupt previous report fallback | Line 254 | N/A | Differential eval not implemented |

### What the evaluator DOES do well (beyond doc spec)

| Feature | Notes |
|---------|-------|
| Windows bash shell support | `executor.ts` handles Windows shell detection |
| Evidence truncation at 4000 chars | Prevents MCP response bloat |
| INCONCLUSIVE verdict | For criteria where tools are unavailable (exec errors) |
| Error boundary in handler | Returns `isError: true` with message, never crashes MCP server |

---

## Cross-Phase Observations

### Consistent patterns (good)

1. **Validation on input** — both phases validate execution-plan.json on load
2. **Graceful degradation** — critic failures don't crash planner; exec errors produce INCONCLUSIVE
3. **MCP response format** — both return `{ content: [{ type: "text", text: "..." }] }`
4. **Shared types** — `ExecutionPlan`, `Story`, `AcceptanceCriterion` used across phases

### Consistent gaps (expected, track for later)

1. **Self-tracking** (.forge/runs/, .forge/evals/) — deferred to Phase 4 across all phases
2. **Multi-perspective critics** — deferred to Phase 5 across all phases
3. **Visual rubric** — deferred to Phase 2b
4. **Context7 integration** — deferred to Phase 5

### Naming improvements to preserve

These naming changes are intentional improvements over the design doc. Do NOT "fix" them back:

| Design Doc | Implementation | Rationale |
|------------|---------------|-----------|
| `intent` (story field) | `title` | `intent` is overloaded (also top-level PRD input) |
| `verify` (AC field) | `command` | It's literally a shell command |
| `eval-report.md` | JSON EvalReport | Machine-parseable, better for MCP tool consumption |

---

## Recommendation

**No fixes needed.** All divergences fall into two categories:
1. **Intentional improvements** — naming changes and format improvements that are better than the doc
2. **Phase-appropriate deferrals** — features that belong in later phases (coordinator, visual rubric, optimization)

The design doc remains a useful north star. Update it when Phase 4 planning begins to reconcile these tracked deferrals.
