# Design Doc Divergence — Bidirectional Analysis

**Date:** 2026-04-04
**Source audit:** `.ai-workspace/audits/2026-04-03-design-doc-divergence-phase1-phase2.md`
**Design doc:** `docs/forge-harness-plan.md`
**Commit anchor:** `35cc0dc` (all line references in Part 2 are pinned to this commit)
**Reviewed by:** double-critique pipeline (6-stage, 2 independent critic rounds per part)

---

## Assumed Document Purpose

This analysis assumes the design doc (`docs/forge-harness-plan.md`) was intended as a phase-scoped implementation spec -- i.e., that features listed under Phase 1-2 were meant to be built in Phase 1-2. If the doc was instead intended as a north-star vision document describing the complete system at maturity, with the understanding that each phase would implement a pragmatic subset, then the divergence patterns in Categories 1-3 are expected behavior rather than process failures. In that case, the primary actionable recommendation would be REC-3 (add explicit phase-scope sections to each primitive) to bridge the gap between the vision and per-phase execution plans. The reader should evaluate the findings below with this framing question in mind.

**Concrete next step:** Before acting on Categories 1-3, confirm with the design doc author whether it was intended as a phase-scoped spec or a north-star vision doc. This single determination collapses the interpretation ambiguity for 22 of 25 deferred items.

---

## Part 1: Forward Divergence (Doc -> Code)

> **Verification warning:** Part 1 line references (to `docs/forge-harness-plan.md`) were verified in a prior pipeline run but were **not re-verified** in this review. All Part 1 line numbers should be treated as approximate. If a line reference does not match, check +/-5 lines for the referenced content.

> **Note:** The categorization below assumes the design doc was an implementation spec, not a vision doc (see Assumed Document Purpose above).

> **Note on categories:** Categories overlap conceptually, but each item is assigned to exactly one primary bucket for counting purposes. Several items could fit two buckets (e.g., `cost` on ACs is both schema over-specification and coordinator-dependent). Each item is assigned to its *primary* root cause -- the reason it was most likely deferred.

> **Note on percentages:** The original audit's "Missing / Deferred" tables contain 25 items (12 in Phase 1, 13 in Phase 2). The audit also lists 3 intentional naming/format improvements in separate tables. Categories 1-3 and 5 below cover the 25 deferred items; Category 4 covers the 3 naming improvements. All 28 items are accounted for. Percentages for Categories 1-3 and 5 are shares of the 25 deferred items. Category 4 is reported separately since it draws from a different table.

### Category 1: Aspirational Features Written as Core Requirements (9 of 25 deferred items, 36%)

The design doc lists features as if they are Phase 1-2 requirements, but they are actually Phase 5 aspirations, Phase 2b extensions, or features dependent on unbuilt prerequisites. The doc does not clearly separate "must-have for this phase" from "nice-to-have / future."

**Items:**
- Context7 MCP (Line 167) -- listed in Phase 1 description, deferred to Phase 5
- Multi-perspective critics at thorough tier, Phase 1 (Line 184) -- deferred to Phase 5
- Multi-perspective critics at thorough tier, Phase 2 (Line 262) -- deferred to Phase 5
- UI prototyping auto-trigger (Line 169) -- listed in Phase 1, deferred to Phase 5
- Visual rubric / Playwright (Lines 241-247) -- listed in Phase 2, deferred to Phase 2b
- Specialist analysis / role agents (Line 168) -- deferred to Phase 5; critic subagents partially fill this gap
- Failure mode: Context7 unavailable (Line 191) -- N/A since Context7 itself is deferred
- Failure mode: codebase too large (Line 192) -- partial; `scanCodebase` exists but no explicit large-repo fallback
- Few-shot skepticism / skeptical-evaluator (Line 256) -- no LLM-judged criteria exist yet, so the skill has no surface to operate on

**Root cause:** The design doc uses a narrative structure that mixes "what this primitive does at full maturity" with "what to build now." There is no MoSCoW or priority column on features. We infer these were deferred because they are aspirational based on their nature (Phase 5 features listed in Phase 1-2 scope), but no implementation decision logs exist to confirm the actual reason for each deferral. The structural observation -- that these features require capabilities not yet built -- is the strongest evidence for this categorization.

### Category 2: Coordinator-Dependent Features Built into Wrong Phase (9 of 25 deferred items, 36%)

Several features were specced in Phase 1-2 but actually require -- or were deferred in favor of -- the Phase 4 coordinator.

**Note on dependency types:** Items below are classified as either *logically coordinator-dependent* (cannot function without a coordinator) or *deferred by design choice* (could be built now but were chosen to be deferred to the coordinator phase). This distinction matters: logical dependencies indicate the doc's phasing was wrong; design-choice deferrals indicate a prioritization decision.

**Items:**
- `status` field on stories (Line 213) -- **deferred by design choice.** The current planner has no write path for `status`, but a human user or CI script could update it without a coordinator. The decision to defer it to the coordinator phase was a prioritization call, not a logical necessity.
- `cost`/`time budget` fields (Lines 172, 201-202) -- **deferred by design choice.** The `budget` object's structure (`maxCostUsd`, `maxTimeMinutes`) could serve as advisory fields -- read by a human reviewer, displayed in a report, or enforced by a CI script that checks a billing API after the run. Automated enforcement would require a coordinator, but the schema fields themselves do not.
- Self-tracking `.forge/runs/` (Line 218) -- **deferred by design choice.** An MCP tool could write a run record to disk after each invocation without a coordinator. However, the design decision was to defer run aggregation to the coordinator phase, likely to avoid fragmenting run-tracking logic across individual tools.
- Differential evaluation (Lines 252-254) -- **logically coordinator-dependent.** Requires a previous eval-report, which only exists in GAN loop (Phase 3+). The design doc frames it as part of an iterative improve-evaluate loop, which is the coordinator's GAN cycle. (Note: corrupt previous report fallback at Line 254 is N/A since differential eval itself is not implemented.)
- Ordered eval with fail-fast (Line 249) -- **logically coordinator-dependent.** The optimization only saves cost when multiple evaluations run in sequence, which is the coordinator's iteration loop.
- SKIPPED criterion status (Line 253) -- **logically coordinator-dependent.** Only produced by fail-fast, which is itself coordinator-dependent. Note: the type in `server/types/eval-report.ts` reserves `"SKIPPED"` as a valid status value, but no code path produces it -- reinforcing Category 3 (schema over-specification) as a secondary root cause. See also: Part 2, Category R8, item 11 for the reverse perspective on SKIPPED status.
- Trace logging / JSONL per evaluation (Line 261) -- **deferred by design choice.** Like `.forge/runs/`, an evaluator tool could append a JSONL line to a file without a coordinator. Deferred to avoid fragmenting logging logic across tools before the coordinator provides a unified aggregation point.
- Self-tracking `.forge/evals/` (Line 270) -- **deferred by design choice.** Same reasoning as `.forge/runs/`.
- Corrupt previous report fallback (Line 254) -- **logically coordinator-dependent.** N/A since differential eval is not implemented; subsumed by differential evaluation's deferral.

**Root cause:** The design doc was written top-down (full vision per primitive) rather than bottom-up (what each phase actually needs). Features were assigned to primitives based on *which tool owns them*, not *when they're needed*. Of the 9 items, 4 are logically coordinator-dependent (the doc's phasing was wrong) and 5 were deferred by design choice (prioritization decisions that could have gone either way).

### Category 3: Schema Over-Specification (4 of 25 deferred items, 16%)

The schema in the design doc includes fields that serve later phases but were specced as part of v3.0.0.

**Items:**
- `intent` at top level + `mode` + `tier` in output JSON -- not stored in implementation (planner uses them internally but doesn't persist to schema)
- `designCriteria` on stories -- visual rubric (Phase 2b)
- `repo` field -- multi-repo (Phase 5)
- Flaky criteria retry (Lines 250-251) -- the schema field `flaky?` exists in the implementation but no retry logic is built; the schema outran the behavior

**Root cause:** The schema was designed for the *final* system, not incrementally. This created a gap where the implementation correctly built a minimal viable schema while the doc specified the complete one.

### Category 4: Intentional Improvements During Implementation (3 items, from naming changes tables)

Some divergences are the implementation being *better* than the spec. These 3 items come from the audit's "Intentional naming changes" and "Intentional format change" tables, not the "Missing / Deferred" tables. They are tracked here for completeness but are not counted in the deferred-item percentages above.

**Items:**
- `intent` -> `title` (naming clarity)
- `verify` -> `command` (more precise)
- `eval-report.md` -> JSON `EvalReport` (machine-parseable for MCP)

**Root cause:** Normal healthy engineering. The doc was not updated after these decisions were made.

> **Interpretive note:** Category 4 represents healthy divergence -- good engineering decisions that happened to differ from the spec. The actionable divergence is concentrated in Categories 1-3 and 5 (all 25 deferred items). Category 4's 3 naming improvements are outside the deferred-item count entirely.

### Category 5: Design Simplification (3 of 25 deferred items, 12%)

Three items from the Phase 2 audit are marked "Not built-in" with the rationale "User's ACs can include these commands." The design doc specified them as built-in evaluator capabilities, but the implementation delegates them to user-authored acceptance criteria instead.

**Items:**
- Code quality rubric (tsc + lint) (Line 237) -- user can include `tsc --noEmit && eslint .` as an AC command
- Regression safety (test suite delta) (Line 238) -- user can include `npm test` as an AC command
- Architecture checks (export/interface grep) (Line 239) -- user can include grep commands as AC commands

**Root cause:** The implementation chose a more generic approach (arbitrary shell commands as ACs) over hard-coded rubric checks. This is more flexible -- it avoids baking in opinionated tooling -- but it diverges from the doc's explicit feature list. The tradeoff: this approach requires users to know which quality checks to include. If users omit them, the evaluator provides no safety net, whereas the design doc's built-in approach would have applied them automatically.

> **Framing revisited:** If the design doc was intended as a vision doc (see Assumed Document Purpose), then Categories 1-3 (22 of 25 deferred items, 88%) are expected behavior -- the doc described the complete system and the implementation correctly built a pragmatic subset. In that reading, the actionable findings from Part 1 reduce to Category 5 (3 items representing a genuine design-philosophy divergence) and the naming improvements in Category 4. The root cause analysis for Categories 1-3 would shift from "process failure" to "missing phase-scope annotations that bridge vision to execution." This does not change the recommendations (especially REC-1 and REC-3), but it changes the severity: from "the doc was wrong about what to build" to "the doc was right about the destination but silent about the route."

---

## Part 2: Reverse Divergence (Code -> Doc)

All line references in this section are pinned to commit `35cc0dc`. If code has changed since that commit, line numbers must be re-verified against the evidence snippets.

> **Note on file paths:** This section uses short filenames (e.g., `executor.ts:5`) rather than full paths (e.g., `server/lib/executor.ts:5`). All filenames in this project are unique, so there is no ambiguity. For readers unfamiliar with the directory structure: prompt files live in `server/lib/prompts/`, library files in `server/lib/`, tool handlers in `server/tools/`, validation in `server/validation/`, and types in `server/types/`.

### Documentation Threshold

**Would a different engineer, reading only the design doc, make the same decision or a compatible one?**

- **Tier A -- Must Document (behavioral contract):** Changes observable behavior, constrains interoperability, or would surprise a second implementer. A second engineer who gets this wrong would produce an incompatible implementation. **22 items.**
- **Tier B -- Should Document (architectural decision):** Deliberate design choice with rejected alternatives. System works either way, but documenting prevents wasted exploration. A second engineer might arrive at a different-but-compatible choice. **34 items.**
- **Tier C -- Acceptable Undocumented (implementation detail):** Internal optimization or inevitable consequence of the stack. A second engineer would likely make the same choice independently. **9 items** (7 original + 2 added in R10).

**Tier assignment rationale:** Each item is classified by asking the threshold question above. Items where a second implementer would produce *incompatible* behavior are Tier A (e.g., `computeVerdict` priority determines test outcomes -- getting the precedence wrong breaks evaluation). Items where a second implementer would produce *different-but-functional* behavior are Tier B (e.g., `DEFAULT_MODEL` could be any capable model without breaking the system). Items where the choice is forced by the stack or obvious are Tier C.

> **Note on R5/R7 tier granularity:** Per-item rationale for the Tier B/C boundary in R5 (prompt engineering) and R7 (MCP registration) is less developed than in other categories. For R5, the boundary is: prompts that define *rules an AC or story must follow* are Tier B (a second implementer must know the rule exists), while prompts that define *phrasing of instructions to the LLM* are Tier C (the exact wording is an implementation detail). For R7, all items are Tier B because a second implementer could choose different names/versions/hints without breaking the system -- though server name "forge" is borderline Tier A since external tooling (e.g., MCP client configs) may reference it by name.

### R1: Behavioral Contracts Not in Doc -- 9 items

- INCONCLUSIVE per-criterion status for exec-level errors (`executor.ts:76-82`) -- **Tier A** -- VERIFIED: `status: "INCONCLUSIVE"` when `error.code` is a string (e.g., ENOENT) at `server/lib/executor.ts:76-82` -- `"if (typeof error.code === \"string\") { resolve({ ... status: \"INCONCLUSIVE\" ..."`
- Critic failure -> zero findings, not blocking error (`plan.ts:162-168`) -- **Tier A** -- **contradicts design doc line 94** (`docs/forge-harness-plan.md:94`). See Key Finding below. VERIFIED: `server/tools/plan.ts:162-168` -- `"return { findings: [] };"` in catch block. Design doc line 94: `"If a critic subagent fails to spawn: Treat as a blocking error."`
- Corrector failure -> fallback to pre-correction plan (`plan.ts:209-214`) -- **Tier A** -- VERIFIED: `server/tools/plan.ts:209-214` -- `"return { plan, dispositions: [] };"` in catch block
- Retry-with-feedback on planner validation failure (`plan.ts:99-128`) -- **Tier A** -- VERIFIED: `server/tools/plan.ts:99-128` -- retry block sends validation errors back as user message content
- Bugfix mode AC-01 reproduction rule (`planner.ts:13-14`) -- **Tier A** -- VERIFIED: `server/lib/prompts/planner.ts:13-14` -- `"The FIRST acceptance criterion (AC-01) of the FIRST story MUST be a reproduction test"`
- Reserved field prohibition in prompts (`planner.ts:68-70`) -- **Tier A** -- VERIFIED: `server/lib/prompts/planner.ts:68-70` -- `"Do NOT include \"prdPath\"... Do NOT include \"flaky\"..."`
- Empty AC list = vacuous PASS with warning (`evaluator.ts:27-36`) -- **Tier A** -- VERIFIED: `server/lib/evaluator.ts:27-36` -- `"verdict: \"PASS\", criteria: [], warnings"`
- computeVerdict priority: FAIL > INCONCLUSIVE > PASS (`evaluator.ts:70-80`) -- **Tier A** -- incorrect precedence would silently flip test verdicts. VERIFIED: `server/lib/evaluator.ts:70-80` -- `"if (hasFail) return \"FAIL\"; ... if (hasInconclusive) return \"INCONCLUSIVE\"; return \"PASS\""`
- Round 2 regression check with [REGRESSION] tag (`critic.ts:7-11`) -- **Tier A** -- VERIFIED: `server/lib/prompts/critic.ts:7-11` -- `"Tag any regression finding with [REGRESSION] at the start of the finding."`

### R2: Operational Constants -- 10 items

- DEFAULT_TIMEOUT_MS = 30,000 (`executor.ts:5`) -- **Tier B** -- VERIFIED: `server/lib/executor.ts:5` -- `"const DEFAULT_TIMEOUT_MS = 30_000;"`
- EVIDENCE_CHAR_CAP = 4,000 (`executor.ts:7`) -- **Tier B** -- VERIFIED: `server/lib/executor.ts:7` -- `"const EVIDENCE_CHAR_CAP = 4_000;"`
- SCANNER_CHAR_CAP = 16,000 (`codebase-scan.ts:5`) -- **Tier B** -- VERIFIED: `server/lib/codebase-scan.ts:5` -- `"export const SCANNER_CHAR_CAP = 16_000;"`
- MAX_DEPTH = 4 (`codebase-scan.ts:8`) -- **Tier B** -- VERIFIED: `server/lib/codebase-scan.ts:8` -- `"const MAX_DEPTH = 4;"`
- DEFAULT_MODEL = "claude-sonnet-4-6" (`anthropic.ts:6`) -- **Tier B** -- any capable model works; choice is a cost/quality tradeoff, not a behavioral contract. VERIFIED: `server/lib/anthropic.ts:6` -- `"const DEFAULT_MODEL = \"claude-sonnet-4-6\";"`
- DEFAULT_MAX_TOKENS = 8,192 (`anthropic.ts:7`) -- **Tier B** -- VERIFIED: `server/lib/anthropic.ts:7` -- `"const DEFAULT_MAX_TOKENS = 8192;"`
- SKIP_DIRS list (`codebase-scan.ts:11-20`) -- **Tier B** -- VERIFIED: `server/lib/codebase-scan.ts:11-20` -- `"node_modules", "dist", ".git", ".ai-workspace", ".forge", "__pycache__", ".next", "coverage"`
- KEY_FILES list (`codebase-scan.ts:23`) -- **Tier B** -- VERIFIED: `server/lib/codebase-scan.ts:23` -- `"package.json", "tsconfig.json", "README.md"`
- OAuth 5-minute expiry buffer (`anthropic.ts:25-26`) -- **Tier B** -- VERIFIED: `server/lib/anthropic.ts:25-26` -- `"if (remainingMs < 5 * 60 * 1000)"`
- DEFAULT_MAX_BUFFER = 10MB (`executor.ts:6`) -- **Tier B** -- VERIFIED: `server/lib/executor.ts:6` -- `"const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;"`

### R3: Internal Data Contracts -- 6 items

- CritiqueFindings interface shape (`plan.ts:50-58`) -- **Tier A** -- VERIFIED: `server/tools/plan.ts:50-58` -- interface with `findings` array containing `severity`, `storyId`, `acId`, `description`, `suggestedFix`
- CorrectorOutput interface shape (`plan.ts:60-67`) -- **Tier A** -- VERIFIED: `server/tools/plan.ts:60-67` -- interface with `plan` and `dispositions` array containing `findingIndex`, `applied`, `reason`
- JSON extraction 2-stage strategy with error throw (`anthropic.ts:90-134`) -- **Tier B** -- a different extraction strategy that still produces valid JSON is compatible. VERIFIED: `server/lib/anthropic.ts:90-134` -- direct parse, then brace/bracket extraction, then throw
- CallClaudeOptions/Result interfaces (`anthropic.ts:72-84`) -- **Tier B** -- VERIFIED: `server/lib/anthropic.ts:72-84`
- ExecuteOptions interface (`executor.ts:9-13`) -- **Tier B** -- VERIFIED: `server/lib/executor.ts:9-13` -- `timeoutMs`, `cwd`, `maxBuffer`
- EvaluateOptions interface (`evaluator.ts:6-8`) -- **Tier B** -- VERIFIED: `server/lib/evaluator.ts:5-8` -- `timeoutMs`, `cwd`

### R4: Platform Adaptations -- 2 items

- Windows bash shell forcing with explicit "bash" (`executor.ts:41`) -- **Tier B** -- VERIFIED: `server/lib/executor.ts:41` -- `"platform() === \"win32\" ? { shell: \"bash\" as const } : {}"`
- Path slash normalization via toSlash() (`codebase-scan.ts:28-30`) -- **Tier B** -- VERIFIED: `server/lib/codebase-scan.ts:28-30` -- `"return p.replace(/\\\\/g, \"/\");"`

### R5: Prompt Engineering Details -- 9 items

- Full planner system prompt with AC rules (`planner.ts:18-76`) -- **Tier B** -- defines the rules that govern plan structure; a second implementer needs to know these rules exist. VERIFIED: `server/lib/prompts/planner.ts:18-76` -- system prompt containing Output Format schema, Story Rules, AC Rules (binary exit codes, portability, substring matching, build prerequisites), Mode-Specific Rules, and Fields NOT to Populate
- Full critic system prompt with 6-point checklist (`critic.ts:14-52`) -- **Tier B** -- the 6 review dimensions (binary ACs, verifiability, dependencies, scope, coverage, affectedPaths) constrain what critics flag. VERIFIED: `server/lib/prompts/critic.ts:14-52` -- `"1. **Binary ACs:** ... 2. **AC Verifiability:** ... 3. **Dependencies:** ... 4. **Story Scope:** ... 5. **Coverage:** ... 6. **affectedPaths:**"`
- Full corrector system prompt (`corrector.ts:6-38`) -- **Tier B** -- the "only fix what was flagged" rule and disposition format are architectural choices. VERIFIED: `server/lib/prompts/corrector.ts:6-38` -- `"Only fix what was flagged. Do NOT introduce new content or refactor the plan."` with JSON output format containing `plan` and `dispositions` array
- JSON mode injection text (`anthropic.ts:146-148`) -- **Tier C** -- exact phrasing is an implementation detail; any "respond with JSON only" instruction achieves the same effect. VERIFIED: `server/lib/anthropic.ts:146-148` -- `"IMPORTANT: Respond with ONLY valid JSON. No markdown fences, no preamble text, no trailing text. Just the JSON object."`
- Mode-specific planner rules (`planner.ts:7-15`) -- **Tier B** -- the bugfix AC-01 rule and full-project decomposition rule define mode-specific behavioral contracts. VERIFIED: `server/lib/prompts/planner.ts:7-15` -- feature mode: `"Prefer a single story"`; full-project mode: `"Decompose into multiple stories ordered by dependency graph"`; bugfix mode: `"The FIRST acceptance criterion (AC-01) of the FIRST story MUST be a reproduction test"`
- AC command portability guidance (`planner.ts:57`) -- **Tier C** -- general best-practice advice; a second implementer would include similar guidance independently. VERIFIED: `server/lib/prompts/planner.ts:57` -- `"Commands should work on both Unix and Windows (Git Bash). Prefer node -e for portability."`
- AC substring matching warning (`planner.ts:58-60`) -- **Tier C** -- defensive prompt guidance that a second implementer would arrive at after encountering the same failure mode. VERIFIED: `server/lib/prompts/planner.ts:58-60` -- `"the checked substring must exactly match what the code will produce"`
- AC build prerequisite rule (`planner.ts:61-63`) -- **Tier B** -- without this rule, ACs fail in clean environments; a second implementer might not anticipate this failure mode. VERIFIED: `server/lib/prompts/planner.ts:61-63` -- `"the command must include the build step as a prerequisite"`
- Planner schema template in prompt (`planner.ts:24-41`) -- **Tier B** -- the exact schema shape (US-XX, AC-XX patterns, field names) constrains interoperability. VERIFIED: `server/lib/prompts/planner.ts:24-41` -- JSON template with `schemaVersion`, `stories` array containing `id: "US-01"`, `acceptanceCriteria` with `id: "AC-01"`, `command`, `affectedPaths`

### R6: Credential/Auth Strategy -- 4 items

- Credential fallback order: API key -> OAuth -> error (`anthropic.ts:45-68`) -- **Tier A** -- VERIFIED: `server/lib/anthropic.ts:45-68` -- checks `ANTHROPIC_API_KEY` first (line 46), then `readOAuthToken()` (line 57), then throws (line 65)
- OAuth token reading from ~/.claude/.credentials.json (`anthropic.ts:17-35`) -- **Tier A** -- VERIFIED: `server/lib/anthropic.ts:19` -- `"join(homedir(), \".claude\", \".credentials.json\")"`
- Client caching with expiry eviction (`anthropic.ts:38-42`) -- **Tier A** -- VERIFIED: `server/lib/anthropic.ts:38-42` -- evicts cached client when OAuth token nears expiry
- OAuth infrastructure limitation (`anthropic.ts:55-56`) -- **Tier B** -- platform constraint discoverable via 401, but documenting prevents hours of debugging. VERIFIED: `server/lib/anthropic.ts:55-56` -- `"OAuth tokens only work when proxied through Claude Code's infrastructure"`

### R7: MCP Registration Details -- 6 items

- Server name "forge" (`index.ts:9`) -- **Tier B** -- borderline Tier A since external MCP client configurations may reference this name; reclassifying would change tier counts to 23A/33B. VERIFIED: `server/index.ts:9` -- `"name: \"forge\""`
- Server version "0.3.0" (`index.ts:10`) -- **Tier B** -- VERIFIED: `server/index.ts:10` -- `"version: \"0.3.0\""`
- readOnlyHint on forge_plan (`index.ts:20`) -- **Tier B** -- VERIFIED: `server/index.ts:20` -- `"annotations: { readOnlyHint: true }"`
- readOnlyHint: false on forge_evaluate (`index.ts:32`) -- **Tier B** -- VERIFIED: `server/index.ts:32` -- `"annotations: { readOnlyHint: false }"`
- destructiveHint on forge_generate (`index.ts:44`) and forge_coordinate (`index.ts:57`) -- **Tier B** -- VERIFIED: `server/index.ts:44,57` -- `"annotations: { destructiveHint: true }"`
- Tool titles and descriptions (`index.ts:16-18, 28-30, 40-42, 52-54`) -- **Tier B** -- VERIFIED: `server/index.ts:16-18,28-30,40-42,52-54`

### R8: Validation Logic -- 13 items

- Circular dependency DFS detection (`execution-plan.ts:162-214`) -- **Tier A** -- VERIFIED: `server/validation/execution-plan.ts:161-214` -- WHITE/GRAY/BLACK DFS cycle detection
- Schema version rejection (`execution-plan.ts:20-24`) -- **Tier A** -- adds to errors array without early-return, so validation continues and collects additional errors even when the schema version is wrong. VERIFIED: `server/validation/execution-plan.ts:20-24` -- no `return` after `errors.push()`
- Self-dependency detection (`execution-plan.ts:77-79`) -- **Tier A** -- VERIFIED: `server/validation/execution-plan.ts:77-79` -- `"if (story.dependencies.includes(story.id))"`
- Missing dependency reference detection (`execution-plan.ts:80-88`) -- **Tier A** -- validates that each dependency string references an existing story ID. VERIFIED: `server/validation/execution-plan.ts:80-89` -- `"!allStoryIds.has(dep)"` check with error push
- Missing reference skip for cycle detection (`execution-plan.ts:149`) -- **Tier B** -- tolerant vs strict is a design choice, not a correctness issue. VERIFIED: `server/validation/execution-plan.ts:149` -- `"if (!hasMissingRefs)"`
- Duplicate story ID detection (`execution-plan.ts:69-72`) -- **Tier A** -- VERIFIED: `server/validation/execution-plan.ts:69-72` -- `"if (storyIds.has(story.id))"`
- Duplicate AC ID detection (`execution-plan.ts:132-139`) -- **Tier A** -- VERIFIED: `server/validation/execution-plan.ts:132-139` -- `"if (acIds.has(ac.id))"`
- Non-empty stories array requirement (`execution-plan.ts:32-35`) -- **Tier A** -- VERIFIED: `server/validation/execution-plan.ts:32-35` -- `"stories must contain at least one story"` with early return
- Non-empty AC array requirement (`execution-plan.ts:100-105`) -- **Tier A** -- VERIFIED: `server/validation/execution-plan.ts:100-105` -- `"acceptanceCriteria must contain at least one criterion"`
- Flaky boolean type enforcement (`execution-plan.ts:142-144`) -- **Tier B** -- VERIFIED: `server/validation/execution-plan.ts:142-144` -- `"typeof ac.flaky !== \"boolean\""`
- SKIPPED in VALID_STATUSES (`validation/eval-report.ts:9`) -- **Tier B** -- pre-allocated status value; present in VALID_STATUSES but absent from VALID_VERDICTS and never produced by executor or evaluator; documents a future extension point rather than a current behavioral contract. VERIFIED: `server/validation/eval-report.ts:9` -- `"VALID_STATUSES = new Set([\"PASS\", \"FAIL\", \"SKIPPED\", \"INCONCLUSIVE\"])"` and line 8: `"VALID_VERDICTS = new Set([\"PASS\", \"FAIL\", \"INCONCLUSIVE\"])"`
- Warnings array validation (`validation/eval-report.ts:79-90`) -- **Tier B** -- VERIFIED: `server/validation/eval-report.ts:79-90`
- EvalReport warnings field (`types/eval-report.ts:5`) -- **Tier B** -- VERIFIED: `server/types/eval-report.ts:5` -- `"warnings?: string[]"`

### R9: Output Formatting -- 4 items

- Evidence truncation with "[truncated] " prefix (`executor.ts:19`) -- **Tier C** -- VERIFIED: `server/lib/executor.ts:19` -- `"return \"[truncated] \" + evidence.slice(-EVIDENCE_CHAR_CAP);"` (note: takes the *last* EVIDENCE_CHAR_CAP characters via negative slice, preserving the tail of output which is typically more informative)
- Critique summary format (`plan.ts:221-242`) -- **Tier C** -- VERIFIED: `server/tools/plan.ts:221-242` -- `formatCritiqueSummary()` builds `"=== CRITIQUE SUMMARY ==="` header followed by per-round lines with finding counts by severity and applied count
- Usage display format (`plan.ts:311-313`) -- **Tier C** -- VERIFIED: `server/tools/plan.ts:311-313` -- `"=== USAGE ===\nTotal tokens: ${usage.inputTokens} input / ${usage.outputTokens} output"`
- Section separator format (`plan.ts:301-302`) -- **Tier C** -- VERIFIED: `server/tools/plan.ts:301-302` -- `"=== EXECUTION PLAN ==="` header before JSON.stringify output

### R10: Failure Modes Not in Doc -- 2 items

NEW_CLAIM: `scanCodebase` throws `"projectPath does not exist"` when given an invalid path, but this failure mode is not documented in the design doc. -- source: Researcher report, verified at `server/lib/codebase-scan.ts:93-94`

NEW_CLAIM: MCP server startup failure exits with code 1 via `main().catch()`, but this failure mode is not documented in the design doc. -- source: Researcher report, verified at `server/index.ts:67-70`

These are minor gaps -- both are straightforward error handling -- but they are undocumented failure modes that belong in the design doc's failure mode tables for completeness. Both are **Tier C** (a second implementer would handle these the same way). Adding these 2 items brings the Part 2 total to **65 items** (22A + 34B + 9C).

---

## Systemic Patterns (Combined)

### Forward Patterns

**FP1: "Full maturity" writing style:** Every primitive section reads as "here's everything this tool will eventually do" rather than "here's what we're building in this phase." The phasing guidance (Lines 490-523) exists but is separated from the feature descriptions (Lines 160-218) by ~270 lines of intervening content.

**FP2: No priority markers on features:** The doc has no MoSCoW labels, no "P0/P1/P2" tags, no "core vs. extension" markers on individual features. The only phasing signal is the bootstrap order section at the bottom.

**FP3: Schema designed for end-state:** The JSON schema was designed once for the complete system rather than evolved incrementally. This guaranteed divergence from day one.

**FP4: Doc not updated after implementation decisions:** The naming improvements and format changes were made during implementation but never back-ported to the doc, letting the gap grow silently.

### Reverse Patterns

**RP1: "Prompt-as-Specification":** Behavioral contracts exist only inside LLM prompt strings (bugfix AC-01 rule, critic review checklist, corrector disposition format, regression tagging). The doc under-documents the present while over-specifying the future.

**RP2: "Defensive Coding Without Design Mandate":** The implementation adds resilience mechanisms (JSON extraction fallback, critic failure degradation, corrector fallback, retry-with-feedback, empty-AC handling) not in the doc. Some contradict it (critic failure should block per design doc line 94, but code gracefully degrades). This pattern deserves nuance: the right resilience posture depends on the deployment context (see Key Finding below).

**RP3: "Constants as Configuration Surface":** 10+ numeric constants and 2 list constants define the operational envelope. None are in the design doc. This is a de facto configuration surface invisible to anyone reading only the doc.

### Cross-Analysis

The forward and reverse patterns are not independent -- they are two sides of the same structural failure in the design doc.

**FP1 + RP1 are mirror images.** FP1 ("full maturity writing") means the doc describes aspirational behavior that does not exist yet. RP1 ("prompt-as-specification") means the doc fails to describe concrete behavior that *does* exist now. Together they reveal a single underlying problem: the design doc is calibrated to the wrong time horizon. It speaks at length about what the system will do someday, while the specification for what the system does today lives in prompt strings invisible to anyone reading the doc. The doc is simultaneously too far in the future and not far enough in the present.

**FP2 + RP3 are the same gap from opposite directions.** FP2 notes that features lack priority markers, making it impossible to know what to build now. RP3 notes that operational constants lack documentation, making it impossible to know what was already built and why. Both stem from the doc treating the system as a monolithic vision rather than a living configuration surface. If the doc had a "current operational defaults" table (addressing RP3), it would implicitly serve as the priority marker for what has been built (addressing FP2).

**FP3 + R8 illustrate schema shape vs. behavioral constraints.** FP3 flags that the schema was over-specified for the end-state (fields like `repo`, `designCriteria` exist in the doc but not in code). R8 flags that the actual validation logic (circular dependency detection, duplicate ID checking, non-empty array enforcement) exists in code but not in the doc. The schema section of the doc specified *shape* ahead of time but omitted the *constraints* that were built in real time. Note: R8's validation logic is a specific instance of RP1 (behavioral contracts not in doc). The FP3-R8 pairing illustrates a narrower point than the FP1-RP1 and FP2-RP3 pairings -- it shows how the shape/constraint split manifests within a single engineering artifact (the schema) rather than across the entire system.

**FP4 + RP2 may form a self-reinforcing cycle.** FP4 notes that implementation improvements were never back-ported to the doc. RP2 notes that defensive behaviors were added without design mandate. One plausible dynamic: once the doc stopped being updated (FP4), engineers stopped consulting it before adding resilience mechanisms (RP2), which further widened the gap, which further reduced the doc's perceived value as a source of truth. However, this causal chain is a hypothesis -- there is no evidence of temporal progression (e.g., that earlier commits had fewer undocumented behaviors than later commits). The correlation between FP4 and RP2 is structural, not necessarily causal.

---

## Recommendations

### REC-1: Add priority tiers to each feature in the design doc
Tag every feature with `[core]`, `[phase-N]`, or `[aspirational]` (where N is the target delivery phase). This makes it obvious during implementation what to build now vs. later. Example: `Context7 MCP [aspirational]`, `Binary ACs [core]`, `Visual rubric [phase-2b]`.

### REC-2: Split schema into "current" and "target"
Add a "v3.0.0 current" schema showing what is actually implemented alongside the "v3.0.0 target" schema. This prevents future audits from flagging intentional omissions as divergence. Note: if REC-5 is fully adopted, REC-2 becomes less critical. Risk: maintaining two schemas doubles the maintenance surface. Consider auto-generating the "current" schema from TypeScript types (e.g., via ts-json-schema-generator) to eliminate manual sync. Note: this approach requires the design doc to adopt JSON Schema format for its schema sections, or to maintain the generated schema as a supplementary artifact alongside the prose descriptions. Evaluate whether the migration cost justifies the sync benefit.

### REC-3: Add a "Phase N scope" section to each primitive
Before each primitive's feature list, add a short section: "Phase N builds: X, Y, Z. Deferred to Phase M: A, B, C." This collocates phasing with features instead of separating them by hundreds of lines.

### REC-4: Back-port implementation improvements to the design doc
Update the design doc with the naming changes (`title`, `command`, JSON EvalReport) so the doc reflects reality. These are improvements -- the doc should adopt them.

### REC-5: Reconcile the doc at each phase boundary
Add a checkpoint to the workflow: before starting Phase N+1, audit the doc against Phase N implementation and update it. This prevents drift from compounding.

### REC-6: Extract behavioral contracts from prompts into the design doc
The bugfix AC-01 rule, critic 6-point checklist, corrector disposition rules, and regression tagging logic are specification living as prompt text. These define observable behavior that a second implementer must replicate. Move them into the design doc's primitive sections so they are discoverable without reading source code.

### REC-7: Add an "Operational Defaults" table to the design doc
All tunable constants (timeouts, buffer sizes, character caps, model selection, skip-dirs list) with their values, rationale, and owning file. This surfaces the de facto configuration surface that currently exists only in scattered source files. Include the credential fallback order (API key -> OAuth -> error) as an architectural decision.

### REC-8: Resolve the critic-failure contradiction
The design doc (`docs/forge-harness-plan.md`, line 94) says block on critic failure. The code (`plan.ts:162-168`) degrades gracefully. Rather than unconditionally updating the doc to match the code, the resolution should be context-dependent: graceful degradation for interactive/standalone use (the current deployment), blocking-with-retry for CI/automated pipelines where silent critic failure could ship an uncritiqued plan. Document both modes and specify when each applies. Additionally, distinguish between spawn failure (e.g., API quota exhausted, out of memory) and execution failure (e.g., critic produces malformed output). The design doc specifically says "fails to spawn," which is narrower than the code's general try/catch. Blocking may be more appropriate for spawn failures (infrastructure problems) while graceful degradation may be more appropriate for execution errors (single bad response).

---

## Key Finding: The Critic-Failure Contradiction

The design doc (`docs/forge-harness-plan.md`, line 94) says: "If a critic subagent fails to spawn: Treat as a blocking error. Log the failure, retry once, then escalate to human. Do not finalize a plan that has not been critiqued."

The implementation (`plan.ts:162-168`) does the opposite: returns empty findings and continues. This is a direct contradiction that must be resolved.

**Verification:** VERIFIED at `server/tools/plan.ts:162-168` -- catch block returns `{ findings: [] }`. VERIFIED at `docs/forge-harness-plan.md:94` -- `"Treat as a blocking error."`

**Recommendation:** Rather than unconditionally updating the doc to match the code, the resolution should be context-dependent. In interactive/standalone use (the current deployment), graceful degradation is preferable -- blocking halts the entire workflow with no human to escalate to. In a CI/automated pipeline, silent critic failure could ship an uncritiqued plan, making blocking-with-retry the safer choice. The doc should specify both modes and which applies when. Note: the design doc says "fails to spawn" while the code catches all errors from the entire critic invocation (including spawn failures, runtime errors, and malformed output). The resolution should also clarify scope: which failure types warrant blocking vs. degradation.

---

## Scope & Methodology

**Direction:** Bidirectional. Part 1 covers features specified in the design doc that were not implemented (forward divergence, 28 items). Part 2 covers capabilities implemented that are not described in the design doc (reverse divergence, 65 items: 63 from original analysis + 2 failure modes identified during review).

**Commit anchor:** All Part 2 line references are pinned to commit `35cc0dc`. If code has changed since that commit, line numbers must be re-verified against the evidence snippets.

**Source of truth:** This analysis treats the original audit (`.ai-workspace/audits/2026-04-03-design-doc-divergence-phase1-phase2.md`) as the source of truth for forward divergence. If the audit itself missed divergences, they will not appear in Part 1. Part 2 was compiled by scanning all implementation files in `server/`.

**Limitation:** Both parts analyze the *presence* of divergence and categorize root causes. Neither part quantifies the *severity* of individual divergences in terms of user impact or system reliability.

**Part 1 verification status:** Part 1 claims (design doc line references) were verified in a prior pipeline run. They were not re-verified in this review. [UNVERIFIED -- from prior pipeline run]

---

## Evidence-Gated Verification Summary

All 65 Part 2 claims were verified against the codebase at commit `35cc0dc`. Of those:

1. **53 items verified with exact evidence:** File path, line number, and quoted code snippet confirmed. All 53 were accurate (line numbers within +/-1, behavioral descriptions correct).
2. **12 items verified in final pass (R5 and R9):** These items previously had plausibility-only review. In the final pipeline stage, all 12 were verified against source with exact file paths and content quotes. All 12 confirmed.
3. **Two minor line number corrections applied during earlier rounds:** `planner.ts:69-70` corrected to `planner.ts:68-70`; `critic.ts:8-12` corrected to `critic.ts:7-11`. Content at those lines was correct in both cases.
4. **Tier A/B count corrected:** Original document claimed 21A/35B/7C. Independent count yields **22A/34B/7C** (total 63 unchanged). One item classified as Tier B in the original was counted as Tier A upon recount. This is consistent with the pipeline's known arithmetic blind spot (see hive-mind-persist/memory.md, Discovery #14).
5. **Two new failure modes added (R10):** `scanCodebase` invalid-path throw and MCP server startup failure, both Tier C. Final total: **65 items (22A + 34B + 9C).**

---

## Critique Log

### Part 1 Critique (Forward Analysis)

#### Round 1 (Critic-1)
- **CRITICAL:** 1
- **MAJOR:** 3
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MINOR | "Not mutually exclusive" contradicts single-assignment counting | Yes | Clarified language |
| 2 | MAJOR | Category 4 conflates healthy divergence with problematic divergence | Yes | Added interpretive note, separated from deferred-item % |
| 3 | MAJOR | No evidence aspirational misclassification *caused* deferrals | Yes | Added epistemic caveat |
| 4 | MAJOR | Coordinator-dependency claims asserted, not demonstrated | Yes | Added per-item justifications |
| 5 | MINOR | REC-2 dual schemas risk same drift problem | Yes | Added maintenance risk note |
| 6 | CRITICAL | Never asks whether design doc was intended as vision doc | Yes | Added "Assumed Document Purpose" section |
| 7 | MINOR | Scope limitation misses reverse divergence | Yes | Added unplanned-additions note |
| 8 | MINOR | Self-review creates false confidence | No | Pipeline structure addresses this |

#### Round 2 (Critic-2)
- **CRITICAL:** 1
- **MAJOR:** 2
- **MINOR:** 3

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | 7+ audit items never assigned to any category | Yes | Added all missing items |
| 2 | MAJOR | Category 4 arithmetic reasoning confused | Yes | Category 4 reported separately |
| 3 | MAJOR | Three "not built-in" items unaddressed | Yes | Created Category 5 |
| 4 | MINOR | REC-1 priority syntax ambiguous | Yes | Changed to `[core]`/`[phase-N]`/`[aspirational]` |
| 5 | MINOR | Asymmetric justification in Category 2 | Yes | Added justifications for all 9 items |
| 6 | MINOR | Assumed Document Purpose should be reinforced | Yes | Added callback note |

#### Summary
- Total findings: 14 across both rounds
- Applied: 13 (93%)
- Rejected: 1 (7%)
- Key changes: Added "Assumed Document Purpose" framing. Added 9 missing audit items and Category 5. Strengthened epistemic claims. Separated healthy divergence from deferred-item percentages.

### Part 2 Critique (Reverse Analysis Plan)

#### Round 1 (Critic-1)
- **CRITICAL:** 0
- **MAJOR:** 3
- **MINOR:** 5

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | 27 of 63 items had blended tier labels (A/B, B/C) instead of single tier | Yes | Split all into per-item single tiers; updated counts to 22A/34B/7C |
| 2 | MAJOR | Overlapping divergence strategy underspecified | Yes | Added concrete cross-reference template |
| 3 | MAJOR | Non-destructive Part 1 policy risks leaving wrong conclusions uncorrected | Yes | Added inline `[Revised in Cross-Analysis]` tag policy |
| 4 | MINOR | SKIPPED status mislabeled as Tier A | Yes | Moved from R1 to R8 as Tier B |
| 5 | MINOR | Schema version rejection description misleading | Yes | Reworded to clarify non-early-return behavior |
| 6 | MINOR | Self-review counts "three" claims but lists four | Yes | Fixed count |
| 7 | MINOR | OAuth infrastructure limitation classified as Tier A | Yes | Reclassified to Tier B |
| 8 | MINOR | No concrete re-verification procedure for line numbers | No | Evidence snippets already serve as anchors |

#### Round 2 (Critic-2)
- **CRITICAL:** 0
- **MAJOR:** 3
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | R8 header says 13 but only 12 bullets | Yes | Added missing item: dependency reference detection (`execution-plan.ts:80-88`) |
| 2 | MAJOR | R7 header says 6 but only 5 bullets | Yes | Split server name and version into separate bullets |
| 3 | MAJOR | Tier counts ~25/~28/~10 don't match actual ~21/~34/~7 | Yes | Recounted all items; updated to exact 22A/34B/7C |
| 4 | MINOR | eval-report.ts:5 ambiguous between types/ and validation/ | Yes | Added directory prefixes |
| 5 | MINOR | Side-effect check replays header numbers | No | Process observation, not document change |
| 6 | MINOR | ExecuteOptions.maxBuffer tier classification | No | No change needed per critic |
| 7 | MINOR | Finding 3 application format differs | No | Application adequate per critic |

#### Summary
- Total findings: 15 across both rounds
- Applied: 12 (80%)
- Rejected: 3 (20%) -- all MINOR process observations or non-actionable notes
- Key changes: Resolved all blended tier labels into per-item classifications. Fixed 3 arithmetic errors (R7 count, R8 count, tier totals). Added overlapping divergence template and Part 1 inline tag policy. Moved SKIPPED to R8. Added missing validation item.

### Corrector-1 Critique

- **CRITICAL:** 0
- **MAJOR:** 5
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | Tier C count in Documentation Threshold not updated after R10 | Yes | Updated 7C to 9C with parenthetical |
| 2 | MAJOR | "Assumed Document Purpose" never resolved or revisited | Partial | Added Part 1 closing note; dual-table rewrite out of scope |
| 3 | MAJOR | Category 2 coordinator-dependency circular for 3 items | Yes | Added logical-dependency vs design-choice distinction per item |
| 4 | MAJOR | Cross-analysis claim 4 presented as fact without evidence | Yes | Softened to hypothesis with explicit caveat |
| 5 | MINOR | R-label namespace collision | Yes | Renamed recommendations to REC-1 through REC-8 |
| 6 | MAJOR | Part 1 verification status buried | Yes | Added prominent warning at top of Part 1 |
| 7 | MINOR | Category 5 hides user-burden tradeoff | Yes | Added tradeoff sentence |
| 8 | MINOR | "All 63 verified" vs "24 spot-checked" tension | Yes | Clarified two verification tiers |
| 9 | MINOR | REC-8 conflates spawn and execution failure | Yes | Added failure-type distinction |

### Critic-2 (Final Round)

- **CRITICAL:** 0
- **MAJOR:** 3
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | R5 and R9 lack VERIFIED tags; evidence standard inconsistent | Yes | Verified all 12 items against source; added VERIFIED tags with evidence |
| 2 | MAJOR | Budget-field coordinator-dependency assumes enforcement schema doesn't require | Yes | Reclassified to "deferred by design choice"; updated split to 4-logical/5-design |
| 3 | MAJOR | Pivotal spec-vs-vision question left without concrete next step | Yes | Added concrete action item in Assumed Document Purpose |
| 4 | MINOR | plan.ts line range mismatch (99-131 vs 99-128) | Yes | Corrected to 99-128 |
| 5 | MINOR | Cross-analysis claim 3 restates RP1 | Yes | Added acknowledgment that R8 is a specific instance of RP1 |
| 6 | MINOR | REC-2 auto-generation has format mismatch with prose doc | Yes | Added qualification about JSON Schema format requirement |
| 7 | MINOR | Self-Review does not verify correction fidelity | Skipped | Meta-process observation about prior stage; no section in final document to modify |
