# Forge Harness — Phase 1: `forge_plan` Implementation

## Context

Phase 0 shipped a working MCP server scaffold with 4 placeholder tools. Phase 1 replaces the `forge_plan` placeholder with a real implementation that transforms intent into a structured execution plan (v3.0.0 schema) using Claude API calls internally.

The key architectural decision: **the MCP tool calls Claude API directly** (via `@anthropic-ai/sdk`). It's a self-contained planning engine, not a prompt template. The calling agent (Claude Code) invokes `forge_plan` and receives a complete execution plan -- no further LLM reasoning needed on the caller's side.

This is extracted from Hive Mind's `plan-stage.ts` (879 lines) and `spec-stage.ts` (597 lines), simplified for the composable MCP primitive model.

VERIFIED: `server/index.ts` registers `forge_plan`, `forge_evaluate`, `forge_generate`, `forge_coordinate` -- confirmed at `server/index.ts:13-59`
VERIFIED: `server/tools/plan.ts:12` returns `"forge_plan for \"${intent}\": not yet implemented. Phase 1 required."` -- found at `server/tools/plan.ts:12`
VERIFIED: `schema/execution-plan.schema.json` exists with `"const": "3.0.0"` at line 10

## ELI5

Right now the planning tool just says "not yet implemented." We're teaching it how to actually think -- it reads your project, asks a smart friend (Claude API) to break the work into stories with checkable tests, then asks two independent reviewers to poke holes in the plan and fix them. The result is a clear list of what to build and how to verify each piece.

---

## Architecture

### Pipeline Overview

```
Intent (string)
    |
[1] Codebase Scan (optional -- reads project structure if projectPath provided)
    |
[2] Planner Agent (Claude API call -> draft execution-plan.json)
    |
[3] Schema Validation (against execution-plan.schema.json v3.0.0)
    |
[4] Critic-1 (Claude API call -- sees ONLY the plan, no drafting context)
    |
[5] Corrector-1 (Claude API call -- reads plan + critique-1)
    |
[6] Critic-2 (Claude API call -- sees ONLY corrected plan, checks for regressions)
    |
[7] Corrector-2 (Claude API call -- reads plan + critique-2)
    |
[8] Final Validation
    |
Return: execution plan JSON + critique summary
```

### Key Design Decisions

1. **Claude API via `@anthropic-ai/sdk`** -- not the REST API. SDK handles retries, streaming, token counting.
2. **`ANTHROPIC_API_KEY` from environment** -- the MCP server process inherits env vars from Claude Code's shell. No config file needed.
3. **Model selection**: `claude-sonnet-4-6` for all pipeline roles (planner, critics, correctors). All roles use the same model for simplicity in Phase 1. Configurable via optional `model` input param -- a future optimization could use a cheaper model for critics since evaluation is less demanding than generation.
4. **No streaming** -- the tool returns a complete result. Streaming would complicate the MCP response format.
5. **Structured output via prompt engineering + JSON parsing** -- instruct Claude to produce JSON via system prompt, then parse and validate the response. The `callClaude` wrapper accepts a `jsonMode` flag that:
   - First tries `JSON.parse(fullResponseText)`.
   - If that fails, extracts the text between the first `{` and last `}` (or first `[` and last `]`) and tries `JSON.parse(extracted)`.
   - If that also fails, throws a descriptive error.
   - If the `@anthropic-ai/sdk` supports `response_format` with JSON schema constraints at implementation time, use that instead (check SDK docs during implementation).
   [UNVERIFIED -- from Researcher: The Researcher claims `response_format` is not an Anthropic API concept. However, the Anthropic SDK may support `response_format` with JSON schema constraints as of 2025. The implementer should check the `@anthropic-ai/sdk` docs at implementation time and use `response_format` if available, falling back to the extraction strategy above otherwise.]
6. **Isolation between critics and planner** -- critics never see the planner's system prompt or reasoning. They see only the artifact (the plan JSON). This is the core double-critique principle from hive-mind.
7. **Schema v3.0.0** -- use the existing schema from Phase 0. It's simpler than hive-mind's v2.0.0 (no specSections, no sourceFiles changeType, no moduleId). This is intentional -- forge is composable primitives, not a monolith.
   VERIFIED: `schema/execution-plan.schema.json` has only `schemaVersion`, `prdPath`, `stories` at top level; Story has `id`, `title`, `dependencies`, `acceptanceCriteria`, `affectedPaths` -- no specSections, sourceFiles, or moduleId.
8. **Codebase scan** -- lightweight: `fs.readdir` recursive (max depth 4, skip node_modules/dist/.git/.ai-workspace) + read key files (package.json, tsconfig.json, README). Scanner output is capped at a character limit of 16,000 characters (~4,000 tokens at a 4:1 char-to-token ratio) via a tunable constant `SCANNER_CHAR_CAP`. The depth-4 limit and character cap are starting heuristics, not researched values -- mark as tunable constants in the code. No tokenizer dependency needed; character truncation is sufficient for Phase 1.

---

## Input Schema Changes

Current (`server/tools/plan.ts:3-5`):
```typescript
{ intent: z.string().describe("What to build -- a PRD, description, or goal statement") }
```
VERIFIED: actual current schema at `server/tools/plan.ts:3-5` already includes `.describe()` -- found at `server/tools/plan.ts:4`: `intent: z.string().describe("What to build -- a PRD, description, or goal statement"),`

New:
```typescript
{
  intent: z.string().describe("What to build -- a PRD, description, or goal statement"),
  projectPath: z.string().optional().describe("Absolute path to project root for codebase context. If omitted, plans without codebase awareness."),
  mode: z.enum(["feature", "full-project", "bugfix"]).optional().describe("Planning mode. Auto-detected from intent if omitted -- see known limitations below."),
  tier: z.enum(["quick", "standard", "thorough"]).optional().describe("Critique depth. quick=no critique, standard=1 round, thorough=2 rounds. Default: thorough."),
}
```

**Tier behavior:**
- `quick` -- planner only, no critique (fast, cheap, for trivial tasks)
- `standard` -- planner + 1 critique round (faster, but ~77% chance of uncaught Corrector-1 regressions based on hive-mind P56 data)
- `thorough` -- planner + 2 critique rounds (the full double-critique). **Default.** P56 evidence shows Corrector-2 produces zero regressions across 13 runs, while Corrector-1 regresses in ~77% of runs. The second critique round is load-bearing.

---

## Output Format

The tool returns MCP text content containing:
1. The execution plan JSON (validated against schema v3.0.0)
2. A critique summary (if critique rounds were run)
3. Token usage stats

```
=== EXECUTION PLAN ===
{
  "schemaVersion": "3.0.0",
  "stories": [ ... ]
}

=== CRITIQUE SUMMARY ===
Round 1: 3 findings (1 CRITICAL, 1 MAJOR, 1 MINOR) -- all applied
Round 2: 1 finding (0 CRITICAL, 0 MAJOR, 1 MINOR) -- applied

=== USAGE ===
Total tokens: 12,450 input / 3,200 output
```

Note: Cost estimation is deferred to a future phase. Token-to-dollar conversion requires hardcoded per-model pricing that goes stale quickly -- not worth the complexity in Phase 1.

---

## Detailed Implementation

### Feature 1: Core Infrastructure

**Goal:** Add Anthropic SDK dependency, create shared client wrapper, TypeScript types, and codebase scanner.

**New dependency:**
- `@anthropic-ai/sdk` (production dependency)

**Directories to create:** `server/lib/`, `server/types/`, `server/lib/prompts/`
VERIFIED: `server/lib/` and `server/types/` do not yet exist -- `ls server/` shows only `index.ts`, `tools/`, `validation/`.

**Files to create:**

- **`server/lib/anthropic.ts`** -- Anthropic client singleton
  ```typescript
  // Creates Anthropic client from ANTHROPIC_API_KEY env var
  // Exports: getClient(), callClaude(options) wrapper that handles:
  //   - model selection
  //   - token counting (input + output)
  //   - error wrapping (missing API key -> clear error message)
  //   - error wrapping (invalid/expired API key -> clear error with status code)
  //   - JSON mode (jsonMode flag):
  //     1. Adds JSON formatting instructions to system prompt
  //     2. Parses response: try JSON.parse(fullText) first
  //     3. If that fails: extract between first { and last } (or [ and ]),
  //        try JSON.parse(extracted)
  //     4. If that also fails: throw descriptive error
  //     5. If SDK supports response_format, use that instead of prompt-based extraction
  ```
  - `callClaude({ system, messages, model?, jsonMode? })` -> `{ text: string, usage: { inputTokens, outputTokens } }`
  - If `ANTHROPIC_API_KEY` is not set, throw a descriptive error (not a crash)
  - If `ANTHROPIC_API_KEY` is invalid (401 from API), catch and throw a descriptive error mentioning the key may be expired/invalid
  - Timeout: rely on `@anthropic-ai/sdk` default timeout behavior (check SDK docs at implementation time for the actual default value). Do not set a custom timeout in Phase 1 unless the SDK has no default.

- **`server/types/execution-plan.ts`** -- TypeScript interfaces matching schema v3.0.0
  ```typescript
  export interface ExecutionPlan {
    schemaVersion: "3.0.0";
    prdPath?: string;  // Reserved for future use; not populated by the planner in Phase 1.
    stories: Story[];
  }
  export interface Story {
    id: string;
    title: string;
    dependencies?: string[];
    acceptanceCriteria: AcceptanceCriterion[];
    affectedPaths?: string[];
  }
  export interface AcceptanceCriterion {
    id: string;
    description: string;
    command: string;
    flaky?: boolean;  // Not populated by the planner in Phase 1. Exists for future manual annotation.
  }
  ```

- **`server/lib/codebase-scan.ts`** -- Lightweight project scanner
  ```typescript
  // scanCodebase(projectPath: string): Promise<string>
  // Returns a text summary of the project structure:
  //   1. Recursive directory listing (max depth 4, skip node_modules/dist/.git/.ai-workspace)
  //   2. Contents of key files: package.json, tsconfig.json, README.md (first 100 lines each)
  //   3. Total: capped at SCANNER_CHAR_CAP (16,000 characters, ~4000 tokens at 4:1 ratio)
  //      Truncation: if output exceeds SCANNER_CHAR_CAP, truncate from the end with a
  //      "[truncated]" marker. No tokenizer dependency needed.
  //
  // Error handling:
  //   - If projectPath doesn't exist or is not a directory -> throw descriptive error
  //   - If permission denied on a subdirectory -> skip it silently, continue scan
  //   - Normalize all paths to forward slashes before embedding in prompt text (Windows compat)
  ```

**Ship:** `/ship` -- PR

---

### Feature 2: Planning Prompts

**Goal:** Create the prompt templates for planner, critic, and corrector agents.

**Files to create:**

- **`server/lib/prompts/planner.ts`** -- System prompt for the planner agent
  - Receives: intent, codebase summary (optional), mode
  - Instructs Claude to produce execution-plan.json v3.0.0
  - Key rules embedded in prompt:
    - Every AC must be a shell command (exit 0 = PASS, non-zero = FAIL)
    - Story IDs follow pattern US-01, US-02, ...
    - AC IDs follow pattern AC-01, AC-02, ... (scoped per story)
    - Dependencies must reference existing story IDs
    - affectedPaths are directory prefixes (e.g., "server/tools/")
    - For `feature` mode: prefer single story unless complexity warrants splitting
    - For `bugfix` mode: first AC must be reproduction (fails before fix, passes after)
    - For `full-project` mode: order stories by dependency graph
    - Do not populate `prdPath` or `flaky` fields (reserved for future use)
  - Output: JSON (via structured output -- see Design Decision #5)

- **`server/lib/prompts/critic.ts`** -- System prompt for critic agents
  - Receives: ONLY the execution plan JSON (isolation principle)
  - Instructs Claude to review for:
    - Are all ACs truly binary? (shell command -> exit code)
    - Are ACs actually verifiable? (no "check that code is clean" -- must be concrete)
    - Are dependencies correct? (no circular deps, no missing refs)
    - Are story scopes reasonable? (not too broad, not too narrow)
    - Does the plan cover all aspects of the intent?
    - Are affectedPaths accurate?
  - For Round 2: additional regression check -- did Round 1 corrections introduce new problems?
  - Output: structured findings with severity (CRITICAL / MAJOR / MINOR) and suggested fix
  - Evidence rule: every finding must cite a specific story ID + AC ID

- **`server/lib/prompts/corrector.ts`** -- System prompt for corrector agents
  - Receives: execution plan JSON + critic findings
  - Instructs Claude to:
    - Apply valid findings (fix the plan)
    - Skip invalid findings with explanation
    - Maintain cross-story consistency
    - Output the corrected execution plan JSON
  - Output: corrected plan JSON + disposition log (applied/skipped per finding)

**Ship:** `/ship` -- PR

---

### Feature 3: Plan Pipeline + Validation

**Goal:** Wire the planning pipeline end-to-end: planner -> validate -> critique -> correct -> validate -> return.

**Note on `server/index.ts`:** No modifications needed. `index.ts` imports `planInputSchema` by reference from `plan.ts`, so updating the schema object in `plan.ts` automatically propagates the new fields to the MCP registration. The `handlePlan` function signature is likewise imported by reference.
VERIFIED: `server/index.ts:3` imports `{ planInputSchema, handlePlan }` from `"./tools/plan.js"` -- the schema object is passed by reference at line 19.

`// readOnlyHint: true` at `index.ts:20` -- this tool reads filesystem only (via `scanCodebase`); outbound API costs are not considered "writes" in the MCP annotation model. No change needed.

**Files to modify:**

- **`server/tools/plan.ts`** -- Replace placeholder with real implementation

  Updated function signature:
  ```typescript
  export async function handlePlan({ intent, projectPath, mode, tier }: {
    intent: string;
    projectPath?: string;
    mode?: "feature" | "full-project" | "bugfix";
    tier?: "quick" | "standard" | "thorough";
  })
  ```

  Pipeline logic:
  ```typescript
  // handlePlan({ intent, projectPath?, mode?, tier? })
  //
  // 1. Validate inputs
  //    - If projectPath provided: verify it exists and is a directory
  // 2. If projectPath: scanCodebase(projectPath)
  // 3. Auto-detect mode if not provided:
  //    - Intent contains "fix", "bug", "broken", "crash", "error" (case-insensitive) -> bugfix
  //    - Otherwise -> feature
  //    - (full-project mode is only set explicitly -- auto-detection does not guess it)
  //    NEW_CLAIM: full-project is never auto-detected -- source: own analysis, safer to require explicit opt-in for the most expensive mode
  //    KNOWN LIMITATION: keyword-based auto-detection can produce false positives.
  //    For example, "add error handling" would be classified as bugfix because it
  //    contains "error". Users should pass `mode` explicitly when the intent is
  //    ambiguous. This is acceptable for Phase 1; a future phase could use the
  //    planner LLM call to classify mode instead.
  // 4. Tier defaults to "thorough" if not provided
  // 5. Call planner agent -> draft plan JSON
  // 6. Parse JSON from response + validate against schema
  //    - If JSON parse fails: retry planner once with error feedback
  //    - If retry also fails: return error to caller
  //    NEW_CLAIM: single retry on JSON parse failure -- source: industry convention for LLM structured output
  // 7. If tier !== "quick": run critique loop
  //    - standard: 1 round (critic-1 -> corrector-1)
  //    - thorough: 2 rounds (critic-1 -> corrector-1 -> critic-2 -> corrector-2)
  //    - After each corrector: re-validate corrected plan against schema
  //    - If corrector output fails validation (schema validation OR JSON parse failure):
  //      use pre-correction plan and log warning
  //    NEW_CLAIM: fallback to pre-correction plan on validation failure -- source: own analysis, defensive design
  //    - If critic output is malformed (non-JSON or unparseable): treat as zero findings,
  //      skip corrector for that round, log warning
  //    - Zero findings from a critic: treat as "plan is sound", skip corrector for that round
  // 8. Final validation
  // 9. Return plan JSON + critique summary + usage stats
  ```

- **`server/validation/execution-plan.ts`** -- Real validation
  VERIFIED: current validation at `server/validation/execution-plan.ts:6` is a stub -- `"return { valid: true };"` found at line 8.
  ```typescript
  // validateExecutionPlan(data: unknown): ValidationResult
  //
  // Validates:
  // 1. schemaVersion === "3.0.0"
  // 2. stories is non-empty array
  // 3. Each story has id, title, acceptanceCriteria (non-empty)
  // 4. Each AC has id, description, command (non-empty strings)
  // 5. No duplicate story IDs
  // 6. No duplicate AC IDs within a story
  // 7. All dependency references point to existing story IDs (run BEFORE cycle detection)
  // 8. No circular dependencies (DFS-based cycle detection on the story dependency graph)
  //    - Self-dependency (story lists its own ID in dependencies) must be caught with
  //      a specific error message: "Story {id} depends on itself"
  // 9. flaky is boolean if present
  //
  // Ordering requirement: check 7 (missing refs) must run before check 8 (cycles).
  // If missing refs exist, DFS would silently skip unknown nodes and could miss cycles.
  // If check 7 fails, skip check 8 entirely (the dependency graph is incomplete).
  //
  // Returns { valid: true } or { valid: false, errors: [...] }
  ```
  - **Note:** Hand-written validation, NOT ajv/JSON Schema validator. This keeps dependencies minimal and error messages human-readable. The schema file remains as documentation/contract.
  - The JSON Schema file does not enforce `minItems` on `stories` or `acceptanceCriteria` arrays -- the hand-written validator handles this.
    VERIFIED: `grep minItems schema/execution-plan.schema.json` returns no matches.

- **`server/tools/plan.ts` input schema** -- Update to include new optional fields

**Ship:** `/ship` -- PR

---

### Feature 4: Tests

**Goal:** Comprehensive test coverage for the planning pipeline.

**Note:** Features 1-3 can be shipped as a single PR if preferred, since Features 1 and 2 are not independently testable without the pipeline wiring in Feature 3. The separate PR markers above are the maximum granularity; combining them is acceptable.

**Files to create:**

- **`server/tools/plan.test.ts`** -- Replace smoke test with real tests
  VERIFIED: current test at `server/tools/plan.test.ts` is a single smoke test checking "not yet implemented" message.
  - **Unit tests (mocked Claude API):**
    - Planner returns valid execution plan JSON -> parsed correctly
    - Planner returns malformed JSON -> error handled gracefully (retry attempted)
    - Planner returns valid JSON that fails schema validation -> error reported
    - Critic returns findings -> corrector receives them
    - Critic returns zero findings -> corrector skipped for that round
    - Critic returns malformed response -> treated as zero findings, corrector skipped
    - Corrector returns malformed JSON -> falls back to pre-correction plan
    - Tier "quick" skips critique loop
    - Tier "standard" runs 1 critique round
    - Tier "thorough" runs 2 critique rounds
    - Missing ANTHROPIC_API_KEY -> descriptive error (not crash)
    - Invalid projectPath (nonexistent) -> descriptive error
    - Mode auto-detection: "fix the login bug" -> bugfix, "add dark mode" -> feature
    - Corrector output fails validation -> falls back to pre-correction plan
  - **Schema validation tests:**
    - Valid plan -> passes
    - Missing schemaVersion -> fails
    - Empty stories -> fails
    - Duplicate story IDs -> fails
    - Circular dependencies -> fails
    - Self-dependency -> fails with message "Story {id} depends on itself"
    - AC missing command -> fails

- **`server/lib/codebase-scan.test.ts`** -- Scanner tests
  - Scans a temp directory -> returns expected structure
  - Respects max depth
  - Skips node_modules, dist, .git
  - Handles missing projectPath gracefully (throws descriptive error)
  - Handles permission-denied subdirectory (skips, continues)
  - Paths in output use forward slashes (Windows compat)

- **`server/validation/execution-plan.test.ts`** -- Validation tests
  - All validation rules tested individually

**Ship:** `/ship` -- PR

---

### Feature 5: Integration Verification

**Goal:** Prove forge_plan works end-to-end via the MCP transport.

**Steps:**
1. Build project (`npx tsc`)
2. Set `ANTHROPIC_API_KEY` env var
3. Send MCP `tools/call` with `forge_plan` and a real intent
4. Verify response contains valid execution plan JSON
5. Verify critique summary is present (thorough tier)

**No PR needed** -- manual verification step.

**Known UX gap:** In thorough mode, the pipeline may take several minutes (5 API calls in sequence). There is no progress feedback mechanism in Phase 1 -- the MCP tool appears silent until it returns. This is a known limitation to address in a future phase (e.g., via MCP progress notifications or logging to stderr).

---

## Error Handling Summary

The following error paths are specified for the pipeline:

| Condition | Behavior |
|-----------|----------|
| `ANTHROPIC_API_KEY` not set | Throw descriptive error mentioning the env var name |
| `ANTHROPIC_API_KEY` invalid (401) | Throw descriptive error mentioning key may be expired |
| `projectPath` does not exist | Throw descriptive error before any API calls |
| `projectPath` is not a directory | Throw descriptive error before any API calls |
| Permission denied during scan | Skip inaccessible path, continue scanning |
| Planner returns non-JSON | Retry once with error feedback; if still fails, return error |
| Planner returns wrong-schema JSON | Return validation error to caller (no retry -- the JSON structure is wrong, not malformed) |
| Critic returns non-JSON / malformed | Treat as zero findings, skip corrector for that round, log warning |
| Corrector returns non-JSON / malformed | Use pre-correction plan, log warning (same as schema-validation failure) |
| Corrector output fails schema validation | Use pre-correction plan, log warning |
| Critic returns zero findings | Skip corrector for that round, plan is considered sound |
| API rate limit / network error | Let SDK retry (default behavior); if exhausted, propagate error |
| API call timeout | Rely on SDK default timeout; do not set custom timeout in Phase 1 |

---

## Test Cases & AC

| # | Test | Pass Condition | Verification Command |
|---|------|---------------|---------------------|
| AC-1 | `npx tsc` compiles | Exit code 0 | `cd C:/Users/ziyil/coding_projects/forge-harness && npx tsc && echo PASS` |
| AC-2 | All tests pass | `vitest run` exit 0, all tests green | `cd C:/Users/ziyil/coding_projects/forge-harness && npx vitest run && echo PASS` |
| AC-3 | `@anthropic-ai/sdk` in dependencies | Listed in package.json dependencies | `node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));process.exit(p.dependencies?.['@anthropic-ai/sdk']?0:1)"` |
| AC-4 | Input schema accepts all 4 fields | `intent` required, `projectPath`/`mode`/`tier` optional | Covered by unit tests in AC-2 |
| AC-5 | Planner returns v3.0.0 plan | Mocked test: planner output validates against schema | Covered by unit tests in AC-2 |
| AC-6 | Validation rejects invalid plans | Missing fields, duplicate IDs, circular deps all caught | Covered by unit tests in AC-2 |
| AC-7 | Tier "quick" skips critique | No critic/corrector calls when tier=quick | Covered by unit tests in AC-2 |
| AC-8 | Tier "standard" runs 1 round | Exactly 1 critic + 1 corrector call | Covered by unit tests in AC-2 |
| AC-9 | Tier "thorough" runs 2 rounds | Exactly 2 critic + 2 corrector calls | Covered by unit tests in AC-2 |
| AC-10 | Missing API key -> clear error | Error message contains "ANTHROPIC_API_KEY" | Covered by unit tests in AC-2 |
| AC-11 | Codebase scan respects limits | Max depth 4, skips excluded dirs | Covered by unit tests in AC-2 |
| AC-12 | Mode auto-detection works | "fix bug" -> bugfix, "add feature" -> feature | Covered by unit tests in AC-2 |
| AC-13 | Lint passes | `eslint server/` exit 0 | `cd C:/Users/ziyil/coding_projects/forge-harness && npx eslint server/ && echo PASS` |
| AC-14 | MCP tool callable | forge_plan responds via MCP transport (manual) | Manual: call forge_plan from Claude Code with real intent |
| AC-15 | Test count gate | At least 20 test cases pass | `cd C:/Users/ziyil/coding_projects/forge-harness && npx vitest run --reporter=json --outputFile=tmp/test-results.json && node -e "const r=JSON.parse(require('fs').readFileSync('tmp/test-results.json','utf8'));process.exit(r.numPassedTests>=20?0:1)"` |

NEW_CLAIM: AC-15 minimum 20 tests -- source: own analysis counting the test cases listed in Feature 4 (14 unit + 7 validation + 6 scanner = ~27 tests minimum)

**Note on AC-3:** The verification command uses `require('fs')` which is CJS syntax. This works because `node -e` runs in CJS mode by default, even though the project is ESM. This is intentional -- the check only reads package.json, it doesn't import project code.
VERIFIED: `package.json:4` has `"type": "module"` confirming the project is ESM.

VERIFIED: vitest `--reporter=json` includes `numPassedTests` -- confirmed by running `npx vitest run --reporter=json --outputFile=tmp/test-results.json` and observing `"numPassedTests":1` in the output.

---

## Files Summary

```
forge-harness/
  server/
    index.ts                          # (unchanged -- imports planInputSchema by reference;
                                      #  readOnlyHint: true refers to filesystem state, not API costs)
    tools/
      plan.ts                       # MODIFIED -- full implementation
      plan.test.ts                  # MODIFIED -- real tests replacing smoke test
      evaluate.ts                   # (unchanged)
      generate.ts                   # (unchanged)
      coordinate.ts                # (unchanged)
    lib/                              # NEW directory
      anthropic.ts                  # NEW -- Claude API client wrapper
      codebase-scan.ts              # NEW -- project structure scanner
      codebase-scan.test.ts         # NEW -- scanner tests
      prompts/                      # NEW directory
        planner.ts                # NEW -- planner system prompt
        critic.ts                 # NEW -- critic system prompt
        corrector.ts              # NEW -- corrector system prompt
    types/                            # NEW directory
      execution-plan.ts             # NEW -- TypeScript interfaces
    validation/
      execution-plan.ts             # MODIFIED -- real validation
      execution-plan.test.ts        # NEW -- validation tests
  schema/
    execution-plan.schema.json        # (unchanged)
  package.json                        # MODIFIED -- add @anthropic-ai/sdk
```

---

## Checkpoint

- [x] Feature 1: Core infrastructure (Anthropic client, types, codebase scanner)
- [x] Feature 2: Planning prompts (planner, critic, corrector)
- [x] Feature 3: Plan pipeline + validation (wire everything together)
- [x] Feature 4: Tests (unit + validation + scanner) — 46 tests passing
- [ ] Feature 5: Integration verification (manual MCP test) — dispatched to cloud agent, awaiting reply
- [x] PR #4 merged, v0.2.0 released (Phase 1 core)
- [x] PR #11 merged, v0.3.0 released (OAuth token auth — primary, API key fallback)
- [x] CLAUDE_CODE_OAUTH_TOKEN secret added to repo — both CI checks now pass
- [x] Mailbox sent to dispatch for Feature 5 verification

Last updated: 2026-04-02T10:35+08:00

---

## Corrector-1 Disposition Log

### Finding 1 -- MAJOR: `readOnlyHint` annotation / `index.ts` unchanged claim
**Disposition: APPLIED (partially)**
- The core concern is valid: the plan says `index.ts` is unchanged but doesn't explain why. Added a note in Feature 3 confirming that `planInputSchema` is imported by reference, so `index.ts` needs no changes. Also updated the Files Summary comment for `index.ts`.
- The `readOnlyHint` concern itself is a non-issue: the plan only adds filesystem *reads* (via `scanCodebase`), and `readOnlyHint: true` means "this tool does not write." Reading is fine. No change needed there.

### Finding 2 -- CRITICAL: Mode auto-detection false positives
**Disposition: APPLIED**
- Valid concern. "Add error handling" would be misclassified as bugfix. Added a KNOWN LIMITATION note in Feature 3 step 3 acknowledging false positives and directing users to pass `mode` explicitly when intent is ambiguous. Chose option (a) from the critic's suggestion -- simple documentation, appropriate for Phase 1.

### Finding 3 -- MAJOR: Scanner token cap measurement method undefined
**Disposition: APPLIED**
- Valid concern. Changed from "~4000 tokens" to "16,000 characters (SCANNER_CHAR_CAP)" with explicit 4:1 ratio explanation. Updated both Design Decision #8 and the `codebase-scan.ts` spec. No tokenizer dependency needed.

### Finding 4 -- MAJOR: 720s worst-case UX gap dismissed too easily
**Disposition: APPLIED**
- Valid concern. Removed "no action needed" language. Added a "Known UX gap" note at the end of Feature 5 acknowledging the multi-minute silence problem and marking it for a future phase. Also changed the timeout approach: instead of a custom 120s NEW_CLAIM, the plan now says to rely on the SDK's default timeout and check SDK docs at implementation time.

### Finding 5 -- MINOR: `flaky` field has no planner guidance
**Disposition: APPLIED**
- Valid concern. Added inline comment on the `flaky` field in the TypeScript interface and a bullet in the planner prompt spec saying the planner should not populate `prdPath` or `flaky` (reserved for future use).

### Finding 6 -- MAJOR: No error handling for malformed critic/corrector API responses
**Disposition: APPLIED**
- Valid concern. The asymmetry was real -- planner had retry logic but critics/correctors had none. Added explicit handling:
  - Malformed critic output -> treat as zero findings, skip corrector, log warning
  - Malformed corrector output -> same as schema-validation failure (use pre-correction plan, log warning)
  - Added both to Feature 3 step 7 and the Error Handling Summary table.
  - Added a new test case for malformed critic response in Feature 4.

### Finding 7 -- MINOR: AC-15 test count verification command is fragile
**Disposition: APPLIED**
- Valid concern. The `grep -E "Tests.*passed"` pattern is format-dependent and doesn't actually check the count. Replaced with `--reporter=json --outputFile` approach that programmatically checks `numPassedTests >= 20`.

### Finding 8 -- MINOR: `prdPath` is a dead field
**Disposition: APPLIED**
- Valid concern. Added inline comment on the TypeScript interface: "Reserved for future use; not populated by the planner in Phase 1."

### Finding 9 -- MAJOR: JSON extraction strategy unspecified
**Disposition: APPLIED**
- Valid concern. Specified the 3-step extraction strategy in Design Decision #5 and in the `anthropic.ts` spec: (1) try `JSON.parse(fullText)`, (2) extract between first `{`/last `}`, (3) throw if both fail. This is the standard LLM JSON extraction pattern.

### Finding 10 -- MINOR: Feature shipping order creates testing gap
**Disposition: APPLIED (lightly)**
- Valid concern but doesn't require restructuring the plan. Added a note in Feature 4 that Features 1-3 can be shipped as a single PR since they aren't independently testable. The separate markers represent maximum granularity, not mandatory split points.

---

## Corrector-2 Disposition Log

### Finding 1 -- MAJOR: `handlePlan` TypeScript signature not updated in plan
**Disposition: APPLIED**
- Valid concern. The plan specified new input fields but never showed the updated `handlePlan` destructuring signature. Added the explicit function signature in Feature 3's `server/tools/plan.ts` section showing all four parameters with their types.

### Finding 2 -- MAJOR: AC-15 verification command has a piping issue on Windows
**Disposition: APPLIED**
- Valid concern. `/dev/stdin` does not exist on Windows. The dev environment is Windows 11. Replaced the piped approach with `--outputFile=tmp/test-results.json` followed by reading the file, which is cross-platform.

### Finding 3 -- MINOR: Corrector-1 self-review says "SCANNER_TOKEN_CAP -> SCANNER_CHAR_CAP" but plan body only uses SCANNER_CHAR_CAP
**Disposition: APPLIED**
- Valid concern. The Corrector-1 self-review referenced a rename that doesn't appear in the document. Removed the Corrector-1 self-review section entirely -- it was a process artifact, not part of the plan spec. The disposition logs are retained for traceability.

### Finding 4 -- MAJOR: Circular dependency detection -- self-dependency and ordering
**Disposition: APPLIED**
- Valid concern. Added explicit self-dependency check with specific error message ("Story {id} depends on itself") to the validation spec. Added ordering requirement: check 7 (missing refs) must run before check 8 (cycles). If check 7 fails, skip check 8 entirely (incomplete graph). Also added a self-dependency test case to Feature 4.

### Finding 5 -- MINOR: Cost estimation in output format has no formula
**Disposition: APPLIED**
- Valid concern. Chose option (a): dropped cost estimate from Phase 1 output. Token-to-dollar conversion requires hardcoded per-model pricing that goes stale. The usage section now shows only token counts.

### Finding 6 -- MINOR: `vitest run --reporter=json` `numPassedTests` field is unverified
**Disposition: APPLIED**
- Verified by actually running `npx vitest run --reporter=json --outputFile=tmp/test-results.json` against the project. The output contains `"numPassedTests":1`. Promoted from UNVERIFIED to VERIFIED.

### Finding 7 -- MINOR: `readOnlyHint: true` could confuse future maintainers
**Disposition: APPLIED (lightly)**
- Valid concern but doesn't warrant changing `index.ts` in this plan (the plan says `index.ts` is unchanged). Added a comment in the Files Summary and in the Feature 3 notes clarifying that `readOnlyHint: true` refers to filesystem state, not API costs.

---

## Corrector-2 Self-Review Checklist

### 1. Conflicts
- No conflicts found. The `handlePlan` signature addition is consistent with the input schema changes section. Both show the same four parameters with the same types.
- The cost estimation removal is consistent: removed from the output format example and no formula is referenced anywhere else.
- The AC-15 command change (`--outputFile` instead of pipe) is self-consistent -- the command writes to `tmp/test-results.json` then reads from the same path.
- The validation ordering requirement (check 7 before check 8) does not conflict with any other section -- the error handling table still lists missing refs and circular deps as separate conditions.

### 2. Edge cases
- AC-15 writes to `tmp/test-results.json`. If the `tmp/` directory doesn't exist, vitest's `--outputFile` creates parent directories. Low risk.
- Self-dependency error message ("Story {id} depends on itself") -- if a story has duplicate entries in its `dependencies` array (e.g., `["US-01", "US-01"]`), this is not a self-dependency but a duplicate ref. The DFS would handle it correctly (visiting an already-visited node), but a specific "duplicate dependency" check would produce a better error message. Acceptable for Phase 1.

### 3. Interactions
- The validation ordering requirement (check 7 before 8) interacts with the error accumulation strategy. If check 7 finds missing refs, check 8 should be skipped entirely (DFS on an incomplete graph is unreliable). This is explicitly stated in the spec: "If check 7 fails, skip check 8 entirely."
- The `readOnlyHint` comment in Files Summary interacts with the "index.ts unchanged" claim -- both are consistent. The comment is documentation-only, no code change.
- The malformed-critic handling interacts with tier selection: in `standard` mode (1 round), a malformed critic means zero critique. In `thorough` mode, the second critic still runs. This makes `thorough` even more important as the default, which is already the case.

### 4. New additions -- execution path trace
- **Self-dependency check (success):** Story US-01 has `dependencies: ["US-01"]` -> check 7 passes (US-01 exists) -> check 8 DFS finds US-01 in "visiting" set -> error: "Story US-01 depends on itself". Clean.
- **Self-dependency check (failure):** N/A -- it always produces a clear error.
- **AC-15 with --outputFile (success):** `vitest run` passes -> writes JSON to `tmp/test-results.json` -> `node -e` reads file -> `numPassedTests >= 20` -> exit 0. Clean.
- **AC-15 with --outputFile (failure -- tests fail):** `vitest run` exits non-zero -> `&&` short-circuits -> `node -e` never runs -> overall exit non-zero. The test count is not checked, but the failure is correctly detected. Clean.
- **AC-15 with --outputFile (failure -- fewer than 20 tests):** `vitest run` exits 0 -> writes JSON -> `node -e` reads file -> `numPassedTests < 20` -> exit 1. Clean.
- **Cost estimation removed (success):** Output format shows tokens only, no dollar amount. No code references a pricing formula. Clean.
- **Malformed critic (success path):** critic returns garbage -> parse fails -> treat as zero findings -> skip corrector -> proceed to next round (thorough) or final validation (standard). Clean.
- **Malformed corrector (success path):** corrector returns garbage -> parse fails -> use pre-correction plan (already validated) -> proceed. Clean.
- **JSON extraction (success path):** full parse fails -> extract between braces -> parse succeeds -> continue pipeline. Clean.
- **JSON extraction (failure path):** full parse fails -> extract fails -> throw error -> triggers retry (planner) or fallback (corrector). Clean.

### 5. Evidence-gated verification

VERIFIED: `server/index.ts:3` imports by reference -- `import { planInputSchema, handlePlan } from "./tools/plan.js";` found at `server/index.ts:3`
VERIFIED: `server/index.ts:19` passes `planInputSchema` to `registerTool` -- `inputSchema: planInputSchema,` found at `server/index.ts:19`
VERIFIED: `server/index.ts:20` has `readOnlyHint: true` -- `annotations: { readOnlyHint: true },` found at `server/index.ts:20`
VERIFIED: `server/tools/plan.ts:7` current signature is `handlePlan({ intent }: { intent: string })` -- found at `server/tools/plan.ts:7`
VERIFIED: `server/tools/plan.ts:4` current schema has `.describe()` -- `intent: z.string().describe(...)` found at `server/tools/plan.ts:4`
VERIFIED: `server/validation/execution-plan.ts` is a stub -- `return { valid: true };` found at line 8
VERIFIED: `schema/execution-plan.schema.json` has `"const": "3.0.0"` -- found at line 10
VERIFIED: `schema/execution-plan.schema.json` has no `minItems` constraints -- grep returns 0 matches
VERIFIED: `server/lib/` and `server/types/` do not exist -- `ls server/` returns `index.ts tools validation`
VERIFIED: `package.json:4` has `"type": "module"` -- found at line 4
VERIFIED: vitest `--reporter=json` includes `numPassedTests` -- observed `"numPassedTests":1` in actual test run output
UNVERIFIED: Hive-mind P56 evidence for 77% Corrector-1 regression rate -- from Researcher, cannot access knowledge base
UNVERIFIED: `@anthropic-ai/sdk` default timeout value -- must be checked at implementation time

---

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 1
- **MAJOR:** 5
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | `readOnlyHint: true` annotation and `index.ts` unchanged claim need explicit confirmation | Yes | Added note confirming ESM live bindings propagate schema changes |
| 2 | CRITICAL | Mode auto-detection is fragile — "error", "crash" keywords cause false positives | Yes | Added KNOWN LIMITATION block directing users to pass `mode` explicitly |
| 3 | MAJOR | Scanner token cap has no defined measurement method | Yes | Changed to 16,000 character cap (`SCANNER_CHAR_CAP`) with 4:1 ratio explanation |
| 4 | MAJOR | 720s worst-case duration dismissed as "no action needed" | Yes | Removed dismissal, added Known UX gap note, rely on SDK default timeout |
| 5 | MINOR | `flaky` field in schema but planner never instructed when to use it | Yes | Marked as "not populated in Phase 1, exists for future manual annotation" |
| 6 | MAJOR | No error handling for malformed critic/corrector responses | Yes | Added: malformed critic = zero findings, malformed corrector = use pre-correction plan |
| 7 | MINOR | AC-15 verification command relies on fragile grep of vitest output | Yes | Replaced with `--reporter=json` approach checking `numPassedTests` |
| 8 | MINOR | `prdPath` is a dead field with no documentation | Yes | Added "Reserved for future use" comment |
| 9 | MAJOR | JSON extraction strategy for prompt-based output unspecified | Yes | Specified 3-step strategy: full parse → brace extraction → throw |
| 10 | MINOR | Features 1-2 ship as separate PRs with no tests until Feature 4 | Yes | Added note that Features 1-3 can ship as a single PR |

### Round 2 (Critic-2)
- **CRITICAL:** 0
- **MAJOR:** 3
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | `handlePlan` function signature not explicitly updated in plan | Yes | Added explicit updated signature in Feature 3 |
| 2 | MAJOR | AC-15 uses `/dev/stdin` — regression from Corrector-1, breaks on Windows | Yes | Replaced with `--outputFile=tmp/test-results.json` approach |
| 3 | MINOR | Self-review references a rename (`SCANNER_TOKEN_CAP` → `SCANNER_CHAR_CAP`) that doesn't exist in the document | Yes | Removed stale self-review section |
| 4 | MAJOR | DFS cycle detection doesn't address self-dependencies or check ordering | Yes | Added self-dependency check, ordering requirement (check 7 before 8), skip-8-if-7-fails |
| 5 | MINOR | Cost estimation in output format has no formula | Yes | Dropped cost estimate from Phase 1, added deferral note |
| 6 | MINOR | `numPassedTests` field unverified against vitest 4.x | Yes | Ran actual vitest and confirmed field exists — promoted to VERIFIED |
| 7 | MINOR | `readOnlyHint: true` could confuse future maintainers | Yes | Added clarifying comment in Files Summary and Feature 3 |

### Summary
- Total findings: 17 across both rounds
- Applied: 17 (100%)
- Rejected: 0 (0%)
- 1 regression identified: Corrector-1's AC-15 fix introduced `/dev/stdin` Windows incompatibility (caught and fixed by Critic-2/Corrector-2)
- Key changes: mode auto-detection documented as limited, scanner cap defined in characters, JSON extraction strategy specified, error handling for all pipeline stages, DFS validation ordering, Windows-compatible test verification
