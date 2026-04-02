# Forge Harness: Composable AI Primitives

*Full name: forge-harness. Short name: forge. Successor to Hive Mind v3.*

## Context

Hive Mind v3 is a monolithic 2,168-line orchestrator (`src/orchestrator.ts`). Components can't be used independently. Forge extracts 3 core primitives + 1 optional coordinator as an **MCP server** -- each tool standalone, composable together, with enforced contracts.

VERIFIED: `src/orchestrator.ts` is 2,168 lines -- `wc -l` returned `2168`.

**Core insight:** What matters is Planning, Generation, and Evaluation. Everything else is glue code or handled by existing skills (`/ship`, `/mailbox`).

**Architecture:** Forge is a local MCP server. Machines handle deterministic work (validation, file I/O, schema enforcement). LLMs handle creative work (reasoning, planning, generation). MCP contracts are Tier 1-2 enforcement for inter-primitive communication.

**Dogfood principle:** Build component 1, use it to build component 2, use both to build component 3.

**Name:** "Forge" -- a place where things are made, piece by piece. "Harness" -- the category of AI orchestration tools. `forge-harness` on npm/GitHub, `forge` in conversation.

## ELI5

We're building 4 LEGO blocks: one that plans, one that builds, one that checks quality, and one that connects them. Each works alone. Snap them together for the full factory. Remove any block if it becomes unnecessary -- the others still work.

---

## Source Material

| File | Provides |
|------|---------|
| `docs/harness-improvement-roadmap.md` | Scorecard, cost reduction (7 techniques), tiered depth |
| `docs/harness-comparison-anthropic.md` | Rubric, GAN comparison, cost numbers ($124-200/run) |
| `.hive-mind-persist/constitution.md` | Binary verification, enforcement tiers, 10 principles |
| `.hive-mind-persist/knowledge-base/01-proven-patterns.md` | P5 (dual-critique), P13 (compliance hierarchy), P37 (split->parallel->assemble) |

VERIFIED: All 4 source files exist on disk.

---

## Architecture Foundations

### Communication: MCP-First

**Forge is a local MCP server.** All users (Claude Code, Cursor, CI/CD, scripts) connect via MCP. No cloud hosting -- runs on your machine.

| Layer | Mechanism | Determinism |
|-------|-----------|-------------|
| User -> Claude | Natural language | Probabilistic (LLM interprets) |
| Claude -> Forge | MCP tool call with typed params | **Deterministic** (schema validated) |
| Forge -> Claude API | Structured prompt with methodology | Probabilistic (LLM generates) |
| Forge -> User | MCP response with validated output | **Deterministic** (schema validated) |
| Inter-primitive | `execution-plan.json` (JSON schema) | **Deterministic** (validated on read/write) |
| Cross-session | `/mailbox` (git-backed) | Deterministic |

**Why MCP over skills:** MCP contracts are Tier 1-2 enforcement (mechanical, 90-100% reliable). Skill instructions are Tier 3-4 (behavioral, 70-90% reliable). MCP validates inputs, rejects invalid outputs, and manages state in code -- not left to LLM compliance.

**Phase 5: Agent Teams** (aspirational, for parallel multi-story execution). Communication model not yet designed. Details must be specified before work begins.

### Hybrid Model: Skills + Spawning

Each agent's behavior is separated into three concerns:

| Concern | Mechanism | Example |
|---------|-----------|---------|
| **Who** (personality) | Skill (SKILL.md) | `skeptical-evaluator.md` -- "assume wrong, find evidence" |
| **How** (execution) | Spawn config | model: sonnet, tools: [read, bash], timeout: 5min |
| **What** (task) | Dynamic input | story + code + previous eval-report.md |

Skills are version-controlled, reusable, and the target for self-improvement.

**Tool permissions:** Each primitive's spawn config must specify tool permissions that match its output contract (P42). For example, `/evaluate` needs `[Read, Bash, Glob, Grep]` but NOT `Edit` or `Write` -- it must never modify the code it evaluates.

### Anti-Bias Stack

| Layer | Mitigates |
|-------|-----------|
| Evaluator isolation (no generation context) | "I made this, so it's good" |
| Different model tiers (generator and evaluator use different models -- recommended, not enforced; see note) | Same-model blind spots |
| Few-shot skepticism in evaluator skill | Anchoring on "looks reasonable" |
| Mechanical enforcement (shell exit codes) | All cognitive bias |
| Challenge-framing in critic skill | Confirmation bias |
| Parallel independent critics (thorough tier) | Single-angle blind spots |

**Model-tier note:** Using different models for generator vs. evaluator is a recommended configuration convention, not a hard enforcement. A validation warning is logged if both are configured to the same model, but it is not a blocking error. Rationale: in some scenarios (e.g., cost-constrained runs, model availability), using the same model is acceptable -- the other anti-bias layers still provide value.

---

## Core Patterns

### Pattern 1: Double-Critique (for documents)

Sequential: produce -> independent critic-1 -> revise -> independent critic-2 -> finalize. Exactly 2 rounds. Critics have no shared context with producer or each other. P5: catches 27+ findings. Round 1 catches strategic errors, round 2 catches side-effects from corrections.

**If both critic rounds find zero issues:** Plan is finalized immediately. This is the happy path, not an error.

**If a critic subagent fails to spawn:** Treat as a blocking error. Log the failure, retry once, then escalate to human. Do not finalize a plan that has not been critiqued.

**Used in:** `/plan` (plan -> critique -> revise -> critique -> finalize)

### Pattern 2: GAN Loop (for code)

Iterative: implement -> evaluate -> fix -> evaluate -> ... Variable iterations (default max 3). The implementing session reads eval feedback and iterates. Evaluator is a stateless subagent spawned each time.

**Used in:** `/generate` (implement -> evaluate -> fix -> evaluate)

### Pattern 3: Multi-Perspective (for thorough evaluation)

Parallel: 2-3 independent critic subagents (or agent team) each evaluate from a different angle (security, architecture, UX). Findings combined via any-FAIL-means-FAIL: each critic evaluates the full rubric independently; the combined report takes the worst result per criterion. NOT sequential like double-critique -- parallel and independent. Each critic is stateless relative to the generator.

**Used in:** `/evaluate` at thorough tier only. `/plan` critic at thorough tier.

### Neither Pattern Used

`/evaluate` does NOT self-evaluate (self-grading bias). `/coordinate` does NOT iterate (procedural dispatch).

---

## Production-Grade GAN Elements

8 proven elements for the `/generate` GAN loop:

**1. Separation of concerns.** Generator (the `/generate` session) and evaluator (spawned subagent) have different skills, tools, and models. Evaluator never sees how code was generated. (P5)

**2. Binary evaluation with honest reliability levels.** Code criteria: shell commands, exit 0/non-zero -- Tier 1-2 mechanical (90-100% reliable). Visual criteria: LLM-judged via screenshots -- Tier 3 (70-90% reliable). (P13)

**3. Two-tier feedback speed.**
- **Fast tier:** Claude Hooks exit-code-2. tsc/lint/tests run as pre-commit hooks in the generator session. Feedback via stderr. Generator fixes inline before the commit succeeds. No subagent spawned.
- **Slow tier:** Full `/evaluate` subagent for complex criteria. Fresh stateless agent.
- **Fallback:** If hooks are not configured (tsc/lint not installed, hooks not set up), all feedback goes through the slow tier. No silent degradation -- log a warning that fast-tier is unavailable.

**4. Hash-based no-op detection.** Capture file hashes before fix. If unchanged after fix, escalate -- don't waste an eval cycle. (from `execute-verify.ts:verifyFixApplied()`)

VERIFIED: `verifyFixApplied` found at `src/stages/execute-verify.ts:337` -- `export function verifyFixApplied(`

**5. Confidence-based short-circuit.** If eval parser fails (confidence: "default") but tests passed with high confidence, treat as PASS. (Bug 11 fix)

**6. Last-failure-only context.** Pass ONLY the previous eval-report.md. Growing context causes "context anxiety" (Anthropic finding).

**7. Escalate when stuck (not "kill over fix" literally).** The `/generate` skill IS the generator session -- it can't spawn a fresh copy of itself. Instead: if the session detects it's stuck (no-op, plateau, max iterations), it writes a structured escalation report and stops. The human or coordinator decides next steps. For truly stuck cases at thorough tier, the coordinator can dispatch a fresh `/generate` session on the same story.

**8. Structured escalation.** After max iterations: what was tried, what failed, hypothesis why. Never silent failure. (P34, P44)

### Token-Saving Techniques

| # | Technique | Estimated Savings | Primitive | Evidence |
|---|-----------|-------------------|-----------|----------|
| 1 | Hooks exit-code-2 (fast tier) | TBD -- measure in Phase 3 | `/generate` | Theoretical: avoids subagent spawn |
| 2 | Ordered eval with fail-fast | 10-70% | `/evaluate` | R2-3 roadmap estimate |
| 3 | Differential evaluation | 30-50% | `/evaluate` | R2-2 roadmap estimate |
| 4 | Handoff compression (last report only) | 30-50% | `/generate` | Anthropic context-anxiety finding |
| 5 | Prompt caching | 80-90% | `/evaluate` | Anthropic published pricing |
| 6 | Dynamic stopping | 10-30% | `/generate` | R2-4 roadmap estimate |
| 7 | Tiered models | 20-40% | `/evaluate` | Opus-vs-Sonnet pricing delta |

**Combined savings estimate: TBD.** Individual technique estimates above come from roadmap projections and vendor pricing, not measured data. Actual savings will be measured during Phase 3 dogfood runs. Per 07-measurement-reality.md: "Never claim a number without measuring it."

---

## The 4 Primitives

### 1. `/plan` -- The Planner
**What it does:** Transforms intent into a contract (stories + acceptance criteria). Determines execution depth.

**Core pattern:** Double-critique (plan -> critic -> revise -> critic -> finalize, max 2 rounds).

**Design principles:**
- **Intent at story level, concrete at verification level.** Story describes WHAT, ACs describe HOW TO VERIFY via shell commands.
- **Codebase scan.** Single-pass read of project structure before planning. For large codebases, use directory-listing + targeted file reads rather than reading all files (to avoid token overflow).
- **Context7 MCP** for library/framework documentation lookup -- used alongside codebase analysis, not as a replacement for project-specific specialist analysis.
- **Specialist analysis gap:** v3's role agents (analyst, architect, security, tester-role) produce project-specific analysis via P40 (cross-phase context injection). Context7 only provides library docs, not this kind of analysis. The `/plan` critic subagents (especially at thorough tier with multi-perspective critics) partially fill this gap, but the tradeoff should be monitored. If planning quality degrades without dedicated role agents, reintroduce them as critic specializations.
- **UI prototyping** as first-class output for visual features. Auto-triggers via keyword detection.
- **Binary ACs** -- every AC is a shell command producing PASS/FAIL.
- **Collapse impl + tests** into 1 story by default. (BL-012)
- **Cost/time budget** as optional input. (BL-017)
- **Mode + Tier** (two orthogonal axes, planner decides both):
  - Mode: full-project, feature, bugfix
  - Tier: quick, standard, thorough (auto-detected from PRD complexity)

**Internal double-critique loop:**
```
1. Planner produces execution-plan.json from PRD + codebase scan + Context7
2. Critic subagent (fresh, no planner context, loaded with skeptical-critic skill):
   - Are all ACs binary and testable as shell commands?
   - Are stories independent or properly dependency-sequenced?
   - Does the plan cover all PRD requirements?
   - For thorough tier: 2-3 parallel specialist critics (security, architecture, UX)
3. If issues: planner revises with critique
4. Critic round 2 (fresh, catches side-effects from round 1 corrections)
5. Finalize
```

**Failure modes:**
- Context7 MCP unavailable (server down/timeout): Planning proceeds without library docs. Log warning. Planner relies on training data and codebase context.
- Codebase too large for single-pass scan: Fall back to directory listing + targeted reads. Do not attempt to read 100k+ files.

**Output:** `execution-plan.json` v3.0:

```json
{
  "schemaVersion": "3.0.0",
  "intent": "Build a dashboard for monitoring agent performance",
  "mode": "full-project",
  "tier": "standard",
  "budget": { "maxCostUsd": 20, "maxTimeMinutes": 60 },
  "stories": [{
    "id": "US-01",
    "intent": "Users can see a list of recent pipeline runs with pass/fail status",
    "acceptanceCriteria": [
      { "id": "AC-01", "description": "...", "verify": "curl -s ... | jq ...", "cost": "cheap" }
    ],
    "designCriteria": { "quality": "...", "craft": "...", "functionality": "..." },
    "repo": "hive-mind",
    "dependencies": [],
    "affectedPaths": ["src/dashboard/", "src/types/"],
    "status": "not-started"
  }]
}
```

**Self-tracking:** `.forge/runs/data.jsonl`, `.forge/evals/evals.jsonl`

---

### 2. `/evaluate` -- The Evaluator
**What it does:** Grades work against the contract. Returns PASS/FAIL per criterion with evidence. Never fixes. Stateless.

**Core pattern:** Single-pass grading. No internal GAN or double-critique (self-evaluation = self-grading bias). At thorough tier: multi-perspective parallel critics.

**Design principles:**
- **Stateless.** Receives: (1) story from execution-plan.json, (2) code on disk, (3) optionally previous eval-report.md for differential eval. Produces eval-report.md. No state across invocations.
- **"Run via Bash" enforcement.** The evaluator skill MUST include an explicit instruction: "Execute each verification command via Bash. Do not inspect code and guess the result -- run the command and report the actual output." (F26: measured 0% command execution without this prompt constraint.)
- **Domain-aware rubric:**

  **Code rubric** -- Tier 1-2 (mechanical, 90-100% reliable):
  | Dimension | Enforcement |
  |-----------|-------------|
  | Correctness | AC shell commands -> exit 0/non-zero |
  | Code Quality | tsc + lint exit codes |
  | Regression Safety | Existing test suite delta |
  | Compliance | % ACs passing (100% threshold per P55) |
  | Architecture | Export/interface checks via grep/tsc |

  **Visual rubric** -- Tier 3 (LLM-judged, 70-90% reliable):
  | Dimension | Enforcement |
  |-----------|-------------|
  | Design Quality | Playwright screenshot -> LLM judges coherence |
  | Originality | Playwright screenshot -> LLM detects template defaults |
  | Craft | Playwright + axe-core (WCAG is mechanical, spacing is LLM-judged) |
  | Functionality | Playwright user flow + AC shell commands (mechanical) |

- **Ordered evaluation with fail-fast.** Cheap criteria first (lint, tsc) -> stop on first FAIL -> expensive only if cheap pass.
  - **Flaky criteria handling:** Criteria annotated with `flaky: true` in the execution plan are retried once on failure before declaring FAIL. Criteria without this annotation fail immediately (no retry). Default is no-retry -- authors must explicitly opt in. This prevents intermittent failures (e.g., Playwright tests, network-dependent checks) from blocking evaluation while preserving fail-fast cost savings for deterministic criteria (tsc, lint, unit tests).

- **Differential evaluation.** When previous eval-report.md provided, re-test all criteria that were FAIL or never evaluated (skipped by fail-fast) in the previous report. Criteria that were PASS in the previous report are omitted from the output entirely (no RESULT line). This keeps the report short and makes it unambiguous which criteria were actually re-evaluated.
  - **How "never evaluated" is detected:** Fail-fast produces explicit `RESULT: SKIPPED` for criteria not reached. Differential mode re-tests FAIL + SKIPPED. Only PASS is cached.
  - **Corrupt previous report:** If the previous eval-report.md cannot be parsed, fall back to full evaluation. Log a warning. Do not crash.

- **Few-shot skepticism.** Evaluator loaded with `skeptical-evaluator` skill.
- **Evaluator "eyes" (tiered rollout):**
  - Phase 2: Code-only (shell commands, tsc, lint)
  - Phase 2b: Visual (Playwright screenshots, axe-core)
  - Phase 5: Interactive (computer use / browser-use)
- **Trace logging.** JSONL per evaluation.
- **At thorough tier:** 2-3 parallel independent critics (each a subagent with a specialist skill -- security, architecture, UX). They evaluate independently; findings combined via any-FAIL-means-FAIL (worst result per criterion). This is multi-perspective, not double-critique.

**Failure modes:**
- Playwright not installed or app not running (Phase 2b): Skip visual rubric criteria, mark as SKIPPED (not FAIL). Log the reason. Code rubric still runs.
- eval-report.md format variance: See eval-report.md format contract below.

**Inputs:** Story + code + optionally previous eval-report.md
**Output:** `eval-report.md` (see format contract below) with per-criterion PASS/FAIL + evidence + findings.
**Self-tracking:** `.forge/runs/data.jsonl`, `.forge/evals/evals.jsonl`

---

### 3. `/generate` -- The Generator
**What it does:** Implements one feature at a time. Commits to git. Runs GAN loop with evaluator subagent. Manages iterations.

**Core pattern:** GAN loop (implement -> evaluate -> fix -> evaluate, up to 3 rounds).

**Design principles:**
- **The skill IS the generator.** `/generate` runs in a Claude session (like `/ship`). The session implements code, spawns evaluator subagents, reads feedback, and iterates. It does NOT spawn "fresh generator agents" -- it IS the generator.
- **Story assignment.** The story to implement is passed as input. In standalone mode, the user specifies the story ID as a CLI argument (e.g., `/generate US-01`). In coordinated mode, the coordinator includes the full story object in the subagent spawn prompt. The generator reads the story from `execution-plan.json` by matching the provided ID.
- **Two-tier feedback:**
  - Fast tier: Hooks exit-code-2 (tsc/lint as pre-commit hooks, fixes inline before commit succeeds)
  - Slow tier: `/evaluate` subagent (stateless, fresh each call)
- **Dynamic stopping.** Score = count of PASS criteria / total criteria evaluated (excluding SKIPPED). Cached PASS results from previous iterations count as evaluated; denominator = total criteria minus SKIPPED (constant across iterations). Tracks score delta. If delta = 0 (no improvement) for 2 consecutive iterations, writes escalation report and stops.
- **Hash-based no-op detection.** If files unchanged after a fix attempt, escalate.
- **Git-native.** Per-story branches. Discard on fail = clean rollback.
  - **Commit strategy:** Each iteration produces a commit (implementation or fix). On finalization (PASS), the branch is squash-merged into the target branch to produce a single clean commit per story.
  - **Dirty working tree:** If `git checkout` fails due to dirty working tree, stash first. If branch already exists from a prior failed run, delete and recreate.
- **Command blocklist + path-scoped writes.** Generator sandboxed to project directory.
- **Max iterations** configurable (default 3). Structured escalation on exhaust.
- **Escalation protocol.** When stuck: write what was tried, what failed, hypothesis why. Human or coordinator decides next steps. At thorough tier, coordinator may dispatch a fresh `/generate` session for the same story.

**Loop:**
```
0. Run baseline check (build + test). If FAIL -> abort with diagnostics
1. Read story from execution-plan.json (by story ID passed as input)
2. Create branch: feat/{story-id}
3. Implement (code + tests)
4. git commit (pre-commit hooks run tsc + lint via exit-code-2; fix inline until clean)
5. Spawn /evaluate subagent (story + code + prev eval-report.md)  <- slow tier
6. If PASS -> finalize: update execution-plan.json status, squash-merge branch, done
7. If INCONCLUSIVE -> escalate immediately: evaluation tools unavailable, do not iterate (mark story as blocked)
8. If FAIL + delta = 0 for 2 consecutive iterations -> escalate, stop
9. If FAIL + no-op (hashes unchanged) -> escalate, stop
10. If FAIL + iterations < max -> read eval-report.md, fix, go to 3
11. If FAIL + iterations = max -> structured escalation report
```

**Self-tracking:** `.forge/runs/data.jsonl`, `.forge/evals/evals.jsonl`

---

### 4. `/coordinate` -- The Coordinator (optional)
**What it does:** Composes plan -> generate -> evaluate into workflows. Lightweight orchestration.

**Core pattern:** None (procedural dispatch, no iteration).

**Design principles:**
- **Lightweight orchestration.** Reads execution-plan.json, dispatches stories to `/generate` in dependency order, tracks progress. Handles story sequencing, budget enforcement, and concurrency.
- **execution-plan.json IS the state.** Status fields updated by `/generate`. Coordinator polls. Mutations use `writeFileAtomic` (carry forward from v3's `src/utils/file-io.ts:writeFileAtomic`).

VERIFIED: `writeFileAtomic` found at `src/utils/file-io.ts:16` -- `export function writeFileAtomic(path: string, content: string): void {`
VERIFIED: Already used for execution-plan writes at `src/state/execution-plan.ts:34` -- `writeFileAtomic(planPath, JSON.stringify(plan, null, 2) + "\n");`

- **Checkpoint gates.** Human approval at boundaries.
- **Cost tracking + velocity alerting (PROVISIONAL).** Reads budget from plan. Alerts at 2x velocity. Cost is estimated from input/output token counts reported by the spawner (via `usage` fields in Claude API responses), multiplied by published model pricing. The v3 cost-tracking infrastructure (`src/stages/execute-verify.ts` token counting + `runs/data.jsonl` cost field) carries forward. Pricing is maintained as a config constant, updated when Anthropic changes pricing.
  - **PROVISIONAL:** The mechanism assumes Claude Code exposes token usage programmatically. This is UNVERIFIED. Phase 1 prerequisite: verify that the spawner exposes token counts. If not, design an alternative (e.g., prompt character count heuristic, or direct API calls for cost-sensitive operations).

  - **Budget exceeded mid-story:** Complete the current story (don't kill mid-implementation), then stop. Log budget exhaustion and remaining stories.
- **Concurrency management.** Parallel independent stories. Respects rate limits.
  - **Shared-file conflicts:** Stories that modify the same files must be dependency-linked in the execution plan. The planner populates `affectedPaths` per story during codebase scan. `affectedPaths` values MUST be directory prefixes (not file paths, not globs), e.g., `"src/dashboard/"`, `"src/types/"`. The coordinator checks overlap via bidirectional `startsWith()` comparison (overlap if either path is a prefix of the other). If overlap detected, serialize the conflicting stories. If `affectedPaths` is missing (e.g., manually-written plans), the coordinator logs a warning and runs stories sequentially as a safe default. **Accuracy caveat:** `affectedPaths` is populated by the planner (an LLM) and may be incomplete. Concurrent execution is a best-effort optimization -- sequential execution is always safe. If concurrent stories produce merge conflicts, the coordinator falls back to sequential for the conflicting pair.

- **Memory graduation.** Collects findings from eval-reports. Graduates stable patterns to knowledge-base/.
- **Observability.** Aggregates JSONL traces into status view.
- **Rollback.** Only merges passing story branches. Failed branches discarded.
- **Coordinator crash recovery.** If the coordinator process dies, recovery reads execution-plan.json. Stories marked `in-progress`: (1) check if story branch has eval-report.md with parseable `VERDICT: PASS` -- if so, skip to finalization, (2) if eval-report.md exists but cannot be parsed or has no VERDICT, treat as absent, (3) otherwise reset to `not-started`. Re-dispatch from recovered state.
- **Time budget enforcement.** Tracks wall-clock time from pipeline start. At 80% of `maxTimeMinutes`, log warning. At 100%, stop dispatching new stories (complete current in-progress story first). Expected overshoot: up to one full story duration past budget. Users should set `maxTimeMinutes` with margin (e.g., CI limit 60 min -> set to 45). If `maxTimeMinutes` not set, no time enforcement.
- **INCONCLUSIVE story handling.** When `/generate` reports INCONCLUSIVE (evaluation tools unavailable), coordinator marks story as `blocked` and continues dispatching non-blocked stories. Stories that depend on a blocked story are also blocked (transitive). At pipeline end, blocked stories reported in summary with reason. If all remaining stories blocked, pipeline terminates with diagnostic.
- **Double-critique on final report.** Runs `/double-critique` skill on deliverables before shipping.
- **Mode and tier read from plan** -- coordinator doesn't detect them.

**Scenario routing:**
| Scenario | Plan | Generate | Evaluate | Coordinate |
|----------|------|----------|----------|------------|
| Full project | All stories + tier | Dependency order | Full rubric | Required |
| Feature | Single story | One story | Full rubric | Optional |
| Bug fix | Skipped | Diagnose + fix | Code rubric only | Optional |
| Design iteration | UI stories | Prototypes | Visual rubric | Optional |
| Code review | Skipped | Skipped | Full rubric | Not needed |

**Self-tracking:** `.forge/runs/data.jsonl`

---

## Inter-Primitive Contracts

### eval-report.md Format Contract

NEW_CLAIM: eval-report.md structured format specification -- source: own analysis, addressing Researcher gap #3 and KB patterns P25/F34/F50.

The evaluator produces and the generator consumes `eval-report.md`. To prevent parser fragility (F34, F50, P25), the format is a contract:

```markdown
# Eval Report: {story-id}

## Summary
VERDICT: PASS | FAIL
SCORE: {n}/{total}
ITERATION: {n}

## Criteria

### {criterion-id}: {description}
RESULT: PASS | FAIL | SKIPPED
EVIDENCE: {command output or screenshot path}
DETAILS: {explanation}

### {criterion-id}: {description}
RESULT: PASS | FAIL | SKIPPED
EVIDENCE: {command output or screenshot path}
DETAILS: {explanation}

## Findings
- {finding 1}
- {finding 2}
```

**SKIPPED status:** Used when a criterion is not evaluated -- either because fail-fast stopped evaluation early, or because a prerequisite (e.g., Playwright) is unavailable. SKIPPED criteria are re-tested in differential mode.

**Differential mode:** When re-evaluating after a fix (previous eval-report.md provided), only criteria that were FAIL or SKIPPED in the previous report are re-tested. Criteria that were PASS in the previous report are omitted entirely -- no RESULT line is written for them. This means a differential report will have fewer `### {criterion-id}` sections than a full report.

**Parsing rules for `/generate`:**
- Scan for `VERDICT:` line anywhere in the document (P25: scan for keywords, don't rely on position).
- Scan for `RESULT:` lines to extract per-criterion outcomes.
- If parsing fails entirely, treat as evaluation failure and re-run `/evaluate`. Do not treat parse failure as PASS.

### execution-plan.json Schema Contract

Current v3 schema is version 2.0.0. v4 introduces version 3.0.0 with additive new fields and one structural change (ACs gain a `verify` field for shell commands). Stories gain an optional `affectedPaths` field (array of directory prefix strings) for coordinator file-overlap detection. See Migration Strategy below.

### Self-Tracking Schema

NEW_CLAIM: Self-tracking schema specification -- source: own analysis, addressing Researcher gap #13.

Each primitive writes to `{project-root}/.forge/runs/data.jsonl` and `{project-root}/.forge/evals/evals.jsonl`. Format is JSONL (one JSON object per line, append-safe for concurrent writes from parallel `/generate` sessions).

**runs/data.jsonl entry (one per line):**
```json
{"timestamp":"ISO-8601","primitive":"/plan | /evaluate | /generate | /coordinate","storyId":"US-01","durationMs":12345,"outcome":"pass | fail | escalated","iterations":2,"costUsd":0.45}
```

**evals/evals.jsonl entry (one per line):**
```json
{"timestamp":"ISO-8601","storyId":"US-01","criteriaTotal":5,"criteriaPassed":4,"criteriaFailed":1,"criteriaSkipped":0,"findings":["..."]}
```

---

## Platform Considerations

NEW_CLAIM: Windows platform section -- source: Researcher report + verified project environment (Windows 11, Git Bash).

This project runs on Windows (NTFS, Git Bash). Platform-specific requirements:

- **P41 (stdin prompt passing):** All subagent spawns must pipe prompts via stdin, not CLI arguments. Windows has a ~8,191 character command-line limit. The current codebase already handles this (Bug 16 fix).
- **Forward-slash paths:** All file paths in generated configs and commands must use forward slashes. NTFS accepts both, but shell tools may not.
- **`shell: true` for spawns:** When spawning subprocesses, use `shell: true` to ensure Git Bash is used (not cmd.exe).
- **Atomic writes on NTFS:** `writeFileAtomic` (already in v3) handles this via write-to-temp-then-rename. NTFS rename is atomic.

---

## Migration Strategy

NEW_CLAIM: Migration strategy section -- source: own analysis, addressing Researcher critical gap #1 and KB pattern P50.

The v3-to-v4 transition is a major architectural change. Migration plan:

1. **Schema evolution (2.0.0 -> 3.0.0):** New fields (`intent`, `mode`, `tier`, `budget`, AC `verify` field, story `affectedPaths` field) are added as optional with defaults. Existing 2.0.0 plans can be read by the new primitives -- missing fields get default values. This follows P50 (additive optional fields).
2. **Coexistence period:** During Phases 1-3, v3 orchestrator.ts remains functional. New primitives are additive -- they don't replace v3 until Phase 4.
3. **Test migration:** The project currently has 850+ tests. Tests for removed stages (normalize, design, report, compliance, learn) will be archived, not deleted, until v4 primitives have equivalent coverage.
4. **Rollback plan:** If any phase fails, fall back to v3. The v3 orchestrator is not deleted until all 4 primitives are proven via dogfood runs.

VERIFIED: Test count -- `grep -r "it(" src/__tests__/ | wc -l` returned 851.

---

## Graceful Degradation

| Remove... | What still works |
|-----------|------------------|
| `/coordinate` | Run plan, generate, evaluate manually |
| `/plan` | Write your own execution-plan.json |
| `/generate` | Use `/evaluate` on code you wrote yourself |
| `/evaluate` | Use `/generate` without automated checks |

---

## Independent Primitive Improvement

Each primitive self-tracks without depending on `/coordinate`:

| Primitive | Tracks | Signal |
|---|---|---|
| `/plan` | AC quality, planning time, mode/tier | Generator fails AC often -> bad ACs -> improve planner |
| `/evaluate` | Pass/fail rate, false pos/neg, cost | Human overrides -> wrong evaluation -> improve rubric |
| `/generate` | First-attempt pass rate, iterations, escalations | High iteration count -> improve generation or planning |
| `/coordinate` | Pipeline cost, wall-clock time, rollback rate | Identifies bottleneck primitive |

**Schema contract test (no coordinator needed):**
```
1. /plan produces execution-plan.json -> validate schema
2. /evaluate reads plan + test code -> produces eval-report.md
3. /generate reads plan + iterates with /evaluate -> marks story complete
4. Verify execution-plan.json valid after mutations
```

**Learning flow:**
```
/evaluate captures findings in eval-report.md
  -> /generate reads, decides if worth remembering
  -> Appends to memory.md (fast loop)
  -> Manual graduation to knowledge-base/ (until /coordinate automates)
```

**Version management:** Each SKILL.md has version in frontmatter. Contract test catches breaking changes.

---

## Dogfood Bootstrap Order

### Phase 0: MCP Server Scaffold (Week 0)
**Build:** Minimal MCP server with 1 placeholder tool (`forge_plan` that returns "not implemented").
**Why first:** The server IS the product. All primitives are MCP tools. The scaffold must exist before any tool implementation.
**Includes:** Server entry point, tool registration, JSON schema validation, setup.sh for Claude Code config.
**Verify:** Claude Code starts, Forge server starts, `forge_plan` tool appears in Claude's toolbox.

### Phase 1: `forge_plan` (Weeks 1-2)
**Build with:** MCP scaffold + `/prd` skill for requirements input
**Dogfood:** Use `forge_plan` to plan the `forge_evaluate` tool.
**Includes:** Codebase scan (server code), Context7 call (server code), Claude API call with planning methodology, output validation against execution-plan.json schema, double-critique (spawn 2 critic subagents via API).
**Prerequisites:** Verify Claude API exposes token usage (for cost tracking). If not, design alternative before Phase 4.
**Rollback:** Write execution-plan.json by hand.

### Phase 2: `forge_evaluate` (Weeks 3-4)
**Build with:** `forge_plan` output
**Dogfood:** Grade `forge_generate` as it's built.
**Includes:** Code rubric (Tier 1-2), ordered eval with fail-fast, differential eval, skepticism (via agent-skills/skeptical-evaluator.md), trace logging. Visual rubric deferred to Phase 2b.
**Rollback:** Manual code review + test runs.

### Phase 3: `forge_generate` (Weeks 5-6)
**Build with:** `forge_plan` + `forge_evaluate`
**Dogfood:** Implement `forge_coordinate` using GAN loop.
**Includes:** GAN loop (8 elements), pre-commit hooks, per-story branches, dynamic stopping, escalation. Server manages iteration state; Claude API does creative work.
**Rollback:** Implement manually, use `forge_evaluate` for grading.

### Phase 4: `forge_coordinate` (Weeks 7-8)
**Build with:** All 3 tools
**Dogfood:** Full system on real PRD.
**Includes:** Sequencing, cost tracking, graduation, observability, rollback, double-critique on final report. Concurrency uses `affectedPaths`-based overlap detection.
**Rollback:** Run tools manually in sequence.

**Timeline caveat:** The 8-week estimate is aspirational. No historical velocity data supports it. Track actual velocity in Phase 1 and re-estimate after.

### Phase 5: Extensions
- Visual rubric with Playwright "eyes" (Phase 2b)
- Agent teams for parallel coordination (requires communication model design)
- Multi-perspective critic teams (thorough tier)
- LSP, Docker sandbox, computer use
- Multi-repo routing, mobile approval
- Self-improvement loop

---

## Packaging & Distribution

### Repository Structure

```
forge-harness/                      # Public GitHub repo (npm: forge-harness)
├── server/                         # MCP server (the product)
│   ├── index.ts                    # Entry point, tool registration
│   ├── tools/                      # One handler per primitive (thin dispatchers to shared modules)
│   │   ├── plan.ts
│   │   ├── evaluate.ts
│   │   ├── generate.ts
│   │   └── coordinate.ts
│   └── validation/                 # Schema validators
│       └── execution-plan.ts
├── methodology/                    # SKILL.md files (the knowledge)
│   ├── plan.md                     # Planning methodology
│   ├── evaluate.md                 # Evaluation rubric + methodology
│   ├── generate.md                 # Generation + GAN loop methodology
│   └── coordinate.md               # Coordination methodology
├── agent-skills/                   # Agent personalities (loaded by server)
│   ├── skeptical-evaluator.md
│   ├── skeptical-critic.md
│   └── implementer.md
├── schema/                         # Formal contracts (JSON Schema)
│   ├── execution-plan.schema.json
│   └── eval-report.schema.json
├── setup.sh                        # Adds forge to Claude Code mcpServers config
├── package.json                    # npm: forge-harness
├── README.md
└── LICENSE
```

**Separation of concerns:**
- `server/` — deterministic code (validation, file I/O, state management, schema enforcement)
- `methodology/` — creative instructions (planning approach, evaluation rubric, GAN loop logic)
- `agent-skills/` — agent personalities (WHO each agent is)
- `schema/` — inter-primitive contracts (typed, validated)

### Installation

```bash
git clone https://github.com/{user}/forge-harness.git
cd forge-harness && ./setup.sh
```

`setup.sh` does two things:
1. Adds Forge to Claude Code's MCP config (`~/.claude/settings.json`):
   ```json
   { "mcpServers": { "forge": { "command": "node", "args": ["path/to/server/index.js"] } } }
   ```
2. Installs npm dependencies (if any)

After setup, Claude Code automatically starts the Forge MCP server and makes `forge_plan`, `forge_evaluate`, `forge_generate`, `forge_coordinate` tools available.

**For non-Claude-Code users:** Any MCP-compatible client can connect to the Forge server.

### Working Directory Structure

All Forge artifacts live in a single `.forge/` directory in the target project:

```
project-root/
├── .forge/                         # ALL working files
│   ├── execution-plan.json         # The contract
│   ├── stories/                    # Per-story artifacts
│   │   ├── US-01/
│   │   │   ├── eval-report.md
│   │   │   ├── escalation.md
│   │   │   └── trace.jsonl
│   │   └── US-02/
│   ├── runs/                       # Self-tracking
│   │   └── data.jsonl
│   ├── evals/
│   │   └── evals.jsonl
│   └── memory.md                   # Fast-loop learnings
├── .gitignore
└── src/
```

**Git lifecycle:**

| Phase | .gitignore | Why |
|-------|------------|-----|
| Development | `.forge/` tracked | Debug, audit, reproduce |
| Pre-release | `.forge/stories/` ignored | Keep plan + config, drop per-story artifacts |
| Production | `.forge/` fully ignored | No pipeline artifacts in release |

Transition: `git rm --cached -r .forge/stories/` when ready.

---

## What Gets Removed

**Dead weight:** orchestrator.ts (2,168 lines), normalize/design/report/compliance/learn stages, 41 agent types in AGENT_REGISTRY, ~28 top-level config fields (plus nested sub-fields).

VERIFIED: AgentType union has 41 members (lines 4-44 of `src/types/agents.ts`).
VERIFIED: AGENT_REGISTRY has 41 entries (`grep -c` on registry.ts).
VERIFIED: HiveMindConfig has 28 top-level fields, ~36 including nested (from `src/config/schema.ts`).

**Survives:** `/ship`, `/mailbox`, `/prd`, `/double-critique` (as standalone Claude Code skills), binary evaluation, file-based state, P13 enforcement tiers, knowledge base, constitution, `writeFileAtomic`. MCP server replaces the orchestrator and adds schema-enforced contracts.

---

## R1-R4 Ideas Integrated

| Item | Primitive |
|------|-----------|
| R1-3: Context7 MCP | `/plan` |
| R1-4: Few-shot skepticism | `/evaluate` |
| R2-2: Differential eval | `/evaluate` |
| R2-3: Fail-fast | `/evaluate` |
| R2-4: Dynamic stopping | `/generate` |
| R2-7: Command blocklist | `/generate` |
| R4-1: Tiered modes | `/plan` |
| BL-011: Complexity scaling | `/plan` |
| BL-012: Collapse stories | `/plan` |
| BL-015: Pass rate analysis | `/generate` + `/evaluate` |
| BL-017: Budget field | `/plan` |
| Q17: Observability | All (JSONL traces) |

---

## Test Cases & AC

- [ ] **TC-1:** `/plan` produces valid execution-plan.json v3.0 -- `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('.forge/execution-plan.json','utf8')); process.exit(p.schemaVersion==='3.0.0' && Array.isArray(p.stories) && p.stories.every(s=>s.acceptanceCriteria.every(ac=>ac.verify)) ? 0 : 1)"`
- [ ] **TC-2:** `/plan` feature mode produces single story -- `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('.forge/execution-plan.json','utf8')); process.exit(p.mode==='feature' && p.stories.length===1 ? 0 : 1)"`
- [ ] **TC-3:** `/plan` bugfix mode produces story with reproduction AC -- `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('.forge/execution-plan.json','utf8')); process.exit(p.mode==='bugfix' && p.stories[0].acceptanceCriteria.some(ac=>ac.description.includes('repro')) ? 0 : 1)"`
- [ ] **TC-4:** `/plan` auto-detects tier from PRD complexity -- `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('.forge/execution-plan.json','utf8')); process.exit(['quick','standard','thorough'].includes(p.tier) ? 0 : 1)"`
- [ ] **TC-5:** `/plan` double-critique produces 2 critic reports -- `ls plans/critic-round-1.md plans/critic-round-2.md && exit 0 || exit 1`
- [ ] **TC-6:** `/evaluate` produces eval-report.md with VERDICT line -- `grep -q '^VERDICT: ' eval-report.md && exit 0 || exit 1`
- [ ] **TC-7:** `/evaluate` ordered evaluation -- cheap criteria appear before expensive in eval-report.md -- `node -e "const r=require('fs').readFileSync('eval-report.md','utf8'); const i1=r.indexOf('tsc'); const i2=r.indexOf('Playwright'); process.exit(i1<i2 ? 0 : 1)"`
- [ ] **TC-8:** `/evaluate` differential -- given prev report with 1 FAIL + 3 PASS + 1 SKIPPED, re-evaluates only the FAIL + SKIPPED criteria -- `grep -c 'RESULT:' eval-report.md | xargs -I{} test {} -eq 2 && exit 0 || exit 1`
- [ ] **TC-9:** `/generate` GAN loop completes at least 1 eval cycle -- `test -f eval-report.md && git branch | grep -q 'feat/' && exit 0 || exit 1`
- [ ] **TC-10:** `/generate` no-op detection escalates when files unchanged -- `grep -q 'ESCALATION.*no-op' escalation-report.md && exit 0 || exit 1`
- [ ] **TC-11:** `/generate` dynamic stopping escalates on plateau -- `grep -q 'ESCALATION.*plateau' escalation-report.md && exit 0 || exit 1`
- [ ] **TC-12:** `/generate` structured escalation includes hypothesis -- `grep -q 'hypothesis' escalation-report.md && exit 0 || exit 1`
- [ ] **TC-13:** `/generate` per-story branch created then discarded on fail -- `grep -q 'branch.*feat/US-01.*created' generate.log && ! git branch | grep -q 'feat/US-01' && exit 0 || exit 1`
- [ ] **TC-14:** `/coordinate` completes 2-story PRD with dependency ordering -- `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('.forge/execution-plan.json','utf8')); process.exit(p.stories.every(s=>s.status==='complete') ? 0 : 1)"`
- [ ] **TC-15:** `/coordinate` stops when budget exceeded -- `grep -q 'budget.*exceeded' coordinate.log && exit 0 || exit 1`
- [ ] **TC-16:** Schema contract test -- `npx ajv validate -s schema/execution-plan.schema.json -d .forge/execution-plan.json && exit 0 || exit 1`
- [ ] **TC-17:** Each primitive works standalone (no `/coordinate` needed) -- run `/evaluate` on hand-written code, verify eval-report.md produced
- [ ] **TC-18:** Each primitive writes .forge/runs/data.jsonl -- `node -e "const fs=require('fs'); const d=fs.readFileSync('.forge/runs/data.jsonl','utf8').trim().split('\n').map(JSON.parse); process.exit(d.length>0 ? 0 : 1)"`
- [ ] **TC-19:** Dogfood: `/plan` plans `/evaluate` -- run `/plan` with `/evaluate` PRD, verify execution-plan.json produced with stories

## Checkpoint

- [x] Explore codebase, roadmap, knowledge base
- [x] Design composable architecture
- [x] Honest feedback + cross-reference with existing docs
- [x] Communication analysis, R1-R4 mapping, blindspots
- [x] GAN patterns, token-saving, independent improvement
- [x] Bias, hybrid model, double-critique decisions
- [x] Consistency review + contradiction fixes
- [x] Double-critique (16 findings, 100% applied)
- [x] Packaging, file structure, and naming (forge-harness)
- [x] Distribution strategy: MCP-first (all users via MCP server)
- [ ] User alignment
- [ ] Phase 0: MCP server scaffold
- [ ] Phase 1: `forge_plan`
- [ ] Phase 2: `forge_evaluate`
- [ ] Phase 3: `forge_generate`
- [ ] Phase 4: `forge_coordinate`

Last updated: 2026-04-02T01:00+08:00

---

## Corrector 2 Disposition

### Finding 1: Loop step ordering -- hooks fire after commit -- VALID, FIXED
Merged steps 4 and 5: hooks are pre-commit hooks (exit-code-2) that fire during `git commit`. The commit only succeeds after hooks pass. Removed the separate step 5. Also updated the "Two-tier feedback" description in GAN Element 3 and `/generate` design principles to say "pre-commit hooks."

### Finding 2: TC-9 branch check is backwards -- VALID, FIXED
Commit messages don't contain branch names. Changed from `git log --oneline | head -1 | grep -q 'feat/'` to `git branch | grep -q 'feat/'` to check branch existence.

### Finding 3: JSONL files named .json -- VALID, FIXED
Renamed all self-tracking files from `.json` to `.jsonl` extension throughout the document: `data.jsonl`, `evals.jsonl`. Updated all references in self-tracking schema, primitive self-tracking lines, and TC-18.

### Finding 4: TCs use require() in ESM project -- VALID, FIXED
Confirmed `"type": "module"` in package.json. Rewrote all TCs that used `require('./execution-plan.json')` to use `require('fs').readFileSync()` + `JSON.parse()` instead. The `fs` builtin works with `require()` in both CJS and ESM contexts. Affected: TC-1, TC-2, TC-3, TC-4, TC-14, TC-18.

### Finding 5: Differential eval + fail-fast leaves criteria untested -- VALID, FIXED
This was a real interaction bug. Fail-fast skips criteria after the first FAIL, so they are never evaluated. Differential mode previously only re-tested FAIL criteria. Fixed: (1) fail-fast now produces explicit `RESULT: SKIPPED` for criteria not reached, (2) differential mode re-tests FAIL + SKIPPED, (3) only PASS is cached. Updated the eval-report format contract to document the SKIPPED status. Updated TC-8 to reflect 2 re-tested criteria (1 FAIL + 1 SKIPPED) instead of 1.

### Finding 6: Cost tracking mechanism unverified -- VALID, FIXED
Added PROVISIONAL label to cost tracking description. Added Phase 1 prerequisite to verify spawner exposes token counts, with fallback alternatives listed.

### Finding 7: affectedPaths glob matching unspecified -- VALID, FIXED
Changed `affectedPaths` from globs to directory prefixes. Updated the story schema example (e.g., `"src/dashboard/"` not `"src/dashboard/**"`). Specified `startsWith()` comparison for overlap detection. This is simpler and deterministic.

### Finding 8: No spec for how /generate receives story assignment -- VALID, FIXED
Added "Story assignment" bullet to `/generate` design principles. Specified: story ID passed as CLI arg in standalone mode, full story object in spawn prompt in coordinated mode. Updated loop step 1 to reference this.

---

## Corrector 2 Self-Review

### 1. Conflicts Check
- `.jsonl` extension: referenced in self-tracking schema section (data.jsonl, evals.jsonl), all 4 primitive self-tracking lines, TC-18, `/coordinate` cost tracking line. All consistent.
- SKIPPED status: referenced in eval-report format contract (new paragraph), differential eval description, fail-fast + differential interaction fix, TC-8. All consistent.
- `affectedPaths` as directory prefixes: referenced in story schema example, `/coordinate` shared-file section (startsWith comparison), schema contract section. All consistent. The migration strategy section says "story `affectedPaths` field" without specifying prefix-vs-glob -- acceptable since the full spec is in the schema contract section.
- Story assignment via CLI arg: referenced in `/generate` design principles and loop step 1. No other section contradicts this.
- Pre-commit hooks: GAN Element 3 says "pre-commit hooks," `/generate` two-tier feedback says "pre-commit hooks," loop step 4 says "pre-commit hooks run tsc + lint." All consistent.
- No conflicts detected.

### 2. Edge Cases Check
- TC-8 now expects 2 RESULT lines (1 FAIL re-tested + 1 SKIPPED re-tested). What if fail-fast stops before any SKIPPED criteria exist (e.g., the first criterion fails and it's the only cheap one)? Then there are no SKIPPED criteria, and differential mode only re-tests the 1 FAIL. TC-8's specific scenario (1 FAIL + 3 PASS + 1 SKIPPED) is valid for its stated precondition, but won't cover all cases. Acceptable -- TC-8 tests the specific scenario it describes.
- `affectedPaths` as directory prefixes with `startsWith()`: `"src/"` starts with `"src/"` (overlap detected). `"src/dashboard/"` does NOT start with `"src/types/"` (no overlap). `"src/"` starts with... wait, `startsWith` is directional. Story A has `"src/"`, Story B has `"src/dashboard/"`. Does `"src/dashboard/".startsWith("src/")` return true? Yes. Does `"src/".startsWith("src/dashboard/")` return false? Yes. So the check must be bidirectional: overlap if A.startsWith(B) OR B.startsWith(A). The document says "checks overlap via `startsWith()` comparison" without specifying bidirectionality. SELF-CAUGHT: Added "bidirectional" to the overlap check description -- either path being a prefix of the other counts as overlap.
- Story assignment `require('fs')` in TC-18: TC-18 uses `require('fs')` which is a Node builtin. This works in ESM mode because Node allows `require()` for builtins even with `"type": "module"` since Node 22 (and we're in 2026). Acceptable.

### 3. Interactions Check
- Finding 5 fix (SKIPPED status) interacts with Finding 3 fix (.jsonl extension) -- no conflict, different concerns.
- Finding 1 fix (pre-commit hooks) interacts with Finding 5 fix (fail-fast SKIPPED) -- no conflict. Hooks are fast-tier (tsc/lint), fail-fast is slow-tier (/evaluate). Different tiers.
- Finding 4 fix (ESM-compatible TCs) interacts with TC-8 update (Finding 5) -- TC-8 uses `grep -c`, not `require()`. No conflict.
- Finding 7 fix (directory prefixes) interacts with Finding 8 fix (story assignment) -- no conflict, different concerns.

### 4. New Additions Trace
- **SKIPPED status in eval-report:** Success: fail-fast writes SKIPPED for unevaluated criteria, differential mode re-tests them. Failure: evaluator forgets to write SKIPPED lines (prompt compliance issue). Mitigated by: the evaluator skill template should include explicit instructions to write SKIPPED for fail-fast-skipped criteria. This is a skill implementation detail, not a design doc issue. Acceptable.
- **Bidirectional startsWith:** Success: detects that `"src/"` and `"src/dashboard/"` overlap. Failure: paths like `"src/dashboard"` (no trailing slash) vs `"src/dashboard-v2/"` -- `startsWith` would incorrectly detect overlap. Mitigated by: document says paths are directory prefixes, implying trailing slash convention. The schema example shows trailing slashes. Acceptable.
- **Story assignment via CLI arg:** Success: `/generate US-01` reads the story. Failure: story ID doesn't exist in execution-plan.json. Should error clearly. This is implementation-level detail. Acceptable.
- **PROVISIONAL cost tracking:** Success: Phase 1 verifies mechanism, fixes if needed. Failure: nobody checks during Phase 1. Mitigated by: added as explicit Phase 1 prerequisite. Acceptable.

### 5. Evidence-Gated Verification
- VERIFIED: `src/orchestrator.ts` is 2,168 lines -- `wc -l` returned `2168`
- VERIFIED: `verifyFixApplied` found at `src/stages/execute-verify.ts:337` -- `export function verifyFixApplied(`
- VERIFIED: `writeFileAtomic` found at `src/utils/file-io.ts:16` -- `export function writeFileAtomic(path: string, content: string): void {`
- VERIFIED: Already used for execution-plan writes at `src/state/execution-plan.ts:34` -- `writeFileAtomic(planPath, ...)`
- VERIFIED: AgentType union has 41 members (lines 4-44 of `src/types/agents.ts`)
- VERIFIED: HiveMindConfig has 28 top-level fields (from reading `src/config/schema.ts` lines 4-43)
- VERIFIED: Test count -- `grep -r "it(" src/__tests__/ | wc -l` returned 851
- VERIFIED: All 4 source material files exist on disk
- VERIFIED: `"type": "module"` in package.json at line 5
- UNVERIFIED: could not locate where v3 extracts token counts from Claude API responses for cost calculation. Marked as PROVISIONAL in document.

---

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 1
- **MAJOR:** 4
- **MINOR:** 3

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | TC-13 tests wrong condition (passes trivially if branch never created) | Yes | Split into creation + cleanup verification |
| 2 | MAJOR | TC-8 differential eval assumes cached criteria omitted, but format unspecified | Yes | Added SKIPPED status and clarified differential output format |
| 3 | MAJOR | Shared-file conflict detection has no mechanism | Yes | Added `affectedPaths` field to story schema |
| 4 | MAJOR | "Different model tiers" anti-bias not enforced | Yes | Reworded as recommended convention with validation warning |
| 5 | MAJOR | Cost tracking has no measurement mechanism described | Yes | Added cost estimation description, referenced v3 infra |
| 6 | MINOR | Flaky criteria retry scope ambiguous | Yes | Extended retry to all criteria tiers |
| 7 | MINOR | Self-tracking file location and concurrency ambiguous | Yes | Specified `.forge/` base path, switched to JSONL |
| 8 | MINOR | Agent-team references leak into Phase 4 | Yes | Moved all agent-team refs to Phase 5 |

### Round 2 (Critic-2)
- **CRITICAL:** 0
- **MAJOR:** 4
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | Loop step ordering: hooks fire after commit | Yes | Clarified hooks are pre-commit hooks firing during git commit |
| 2 | MAJOR | TC-9 greps commit message for branch name | Yes | Changed to `git branch` check |
| 3 | MINOR | JSONL files named .json confuse tooling | Yes | Renamed to .jsonl throughout |
| 4 | MAJOR | TCs use require() in ESM-only project | Yes | Rewrote to use require('fs').readFileSync + JSON.parse |
| 5 | MAJOR | Differential eval + fail-fast leaves criteria untested | Yes | Added SKIPPED status, differential re-tests FAIL + SKIPPED |
| 6 | MINOR | Cost tracking relies on unverified v3 infrastructure | Yes | Added PROVISIONAL label and Phase 1 prerequisite |
| 7 | MINOR | affectedPaths glob overlap detection unspecified | Yes | Changed to directory prefixes with bidirectional startsWith |
| 8 | MINOR | No spec for how /generate receives story assignment | Yes | Added story assignment design principle |

### Summary
- Total findings: 16 across both rounds
- Applied: 16 (100%)
- Rejected: 0 (0%)
- Key changes: Added SKIPPED eval status for fail-fast/differential interaction, switched self-tracking to JSONL, fixed 6 ESM-incompatible TCs, clarified pre-commit hook timing, added affectedPaths for conflict detection, added PROVISIONAL cost tracking with Phase 1 verification gate

### Round 3 (Critic-1, MCP pivot review)
- **CRITICAL:** 0
- **MAJOR:** 6
- **MINOR:** 6

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | Fail-fast retry contradicts fail-fast cost savings (deterministic checks don't need retry) | Yes | Changed to explicit `flaky: true` opt-in |
| 2 | MAJOR | INCONCLUSIVE verdict has no /generate loop branch | Yes | Added step 7 (escalate immediately, mark blocked) |
| 3 | MAJOR | Dynamic stopping threshold undefined, denominator unstable | Yes | Defined score formula, cached PASS counts, delta=0 threshold |
| 4 | MAJOR | Loop commits failing code before evaluation | Yes | Clarified as intentional + squash-merge on finalization |
| 5 | MAJOR | TC-21 placeholder always passes | Yes | Deferred to Phase 0 (MCP server doesn't exist yet) |
| 6 | MAJOR | affectedPaths false-negative gap (LLM-populated) | Yes | Added accuracy caveat + merge conflict fallback |
| 7 | MINOR | Smoke test uses require() in ESM | N/A | Not present in current doc |
| 8 | MINOR | maxTimeMinutes has no enforcement | Yes | Added time budget enforcement to /coordinate |
| 9 | MINOR | "~50 lines each" unsupported claim | Yes | Changed to "thin dispatchers" |
| 10 | MINOR | Crash recovery re-does passing work | Yes | Added eval-report check before reset |
| 11 | MINOR | TC paths inconsistent (root vs .forge/) | Yes | Standardized to .forge/ |
| 12 | MINOR | Multi-perspective aggregation unspecified | Yes | Added any-FAIL-means-FAIL rule |

### Round 4 (Critic-2, MCP pivot review)
- **CRITICAL:** 0
- **MAJOR:** 3
- **MINOR:** 5

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | TC-21 replacement uses require() in ESM + fragile pipeline parsing | Yes | Deferred TC-21 entirely to Phase 0 |
| 2 | MINOR | Squash-merge "audit trail" rationale misleading | Yes | Dropped audit trail claim |
| 3 | MAJOR | INCONCLUSIVE has no coordinator-level handling | Yes | Added blocked status + transitive blocking + diagnostic |
| 4 | MAJOR | Crash recovery doesn't validate eval-report integrity | Yes | Added parseable VERDICT check |
| 5 | MINOR | Flaky criteria heuristic has no detection mechanism | Yes | Dropped heuristic, require explicit `flaky: true` |
| 6 | MINOR | Score definition ambiguous re: cached results | Yes | Explicit: cached PASS = evaluated |
| 7 | MINOR | Time budget overshoot unbounded | Partial | Documented expected overshoot, recommend margin (no hard-kill) |
| 8 | MINOR | TC-16 path identified but not fixed | Yes | Fixed to .forge/execution-plan.json |

### Run 2 Summary
- Total findings: 20 across rounds 3-4
- Applied: 19 fully, 1 partially (time budget overshoot)
- Rejected: 0
- Key changes: Explicit flaky:true opt-in, INCONCLUSIVE handling (generator + coordinator), dynamic stopping score formula, squash-merge commit strategy, crash recovery with integrity validation, time budget enforcement, affectedPaths accuracy caveat, any-FAIL aggregation, standardized TC paths

### Combined Totals (Both Runs)
- Run 1: 16 findings, 16 applied (100%)
- Run 2: 20 findings, 19 fully + 1 partially applied (97.5%)
- Grand total: 36 findings across 4 critic rounds
