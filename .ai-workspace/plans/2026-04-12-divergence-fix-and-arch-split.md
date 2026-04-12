# Plan: BUG-DIV-CWD Fix + Session-LLM Architectural Split + Divergence Re-measurement

## ELI5

We have a bug where the divergence checker runs its tests from the wrong folder, so everything looks broken when it's actually fine. That's a 1-line fix.

But there's a deeper problem: the MCP server (a helper program) tries to call Claude's brain for judgment calls, but its login badge doesn't work for direct API calls — it only works through Claude Code's front door. So we're going to let Claude Code (which HAS a working badge) do the thinking, and pass the answers to the helper program for filing.

Think of it like: instead of sending the intern to interview the expert (and getting blocked by security), have the expert do the interview and hand the intern the transcript to file.

## Context

- **BUG-DIV-CWD** discovered during S7 divergence measurement (PR #148, now merged)
- `server/tools/evaluate.ts:350` — `handleDivergenceEval` calls `evaluateStory(plan, story.id, { timeoutMs })` without `cwd: input.projectPath`
- All AC commands execute in MCP server's `process.cwd()` instead of the target project root
- 55/55 raw forward failures were false negatives — all pass from correct directory [UNVERIFIED — from PR #148 run data, not independently confirmed]
- Reverse scan fails with OAuth 401 — `anthropic.ts:65-66` documents that OAuth tokens don't work for direct API calls, only through Claude Code's proxy

VERIFIED: `evaluateStory` call at `server/tools/evaluate.ts:350-352` — `const report = await evaluateStory(plan, story.id, { timeoutMs: input.timeoutMs, });` (no `cwd` field)

VERIFIED: OAuth limitation at `server/lib/anthropic.ts:64-66` — `"Note: OAuth tokens only work when proxied through Claude Code's infrastructure. Direct API calls with OAuth return 401"`

## Architectural Discussion: Session-Does-LLM vs MCP-Does-Mechanical

### The Problem

The MCP server (forge-harness) is a child process spawned by Claude Code. When it needs to call the Anthropic API, it reads the OAuth token from `~/.claude/.credentials.json` and makes a direct HTTPS call to `api.anthropic.com`. But OAuth tokens are scoped to Claude Code's proxy infrastructure — they return 401 for direct API calls.

This affects ALL LLM-dependent MCP operations:

| Tool | Mechanical ($0) | LLM-dependent | Broken on Max plan? |
|------|-----------------|---------------|---------------------|
| forge_coordinate | assessPhase, topoSort, budget | — | No |
| forge_generate | brief assembly | — | No |
| forge_evaluate (story) | AC command execution | — | No |
| forge_evaluate (forward) | AC command execution | — | No |
| forge_evaluate (reverse) | — | `trackedCallClaude` | **Yes** |
| forge_evaluate (coherence) | — | `trackedCallClaude` | **Yes** |
| forge_plan | — | `callClaude` (entire tool) | **Yes** |

VERIFIED: forge_evaluate reverse path calls `trackedCallClaude` at `server/tools/evaluate.ts:390-399`
VERIFIED: forge_evaluate coherence path calls `trackedCallClaude` at `server/tools/evaluate.ts:238`
VERIFIED: forge_evaluate story path is mechanical only at `server/tools/evaluate.ts:177` (calls `evaluateStory`, no LLM)
UNVERIFIED: forge_coordinate and forge_generate being "$0, no LLM" — design intent per memory file `project_intelligent_clipboard.md`, not independently verified in their source

### The Insight

The Intelligent Clipboard pattern ($0, no LLM) wasn't just a design philosophy — it's the **reliability boundary**. Tools that don't call Claude work perfectly. Tools that do are broken on Max plan OAuth. This aligns with P6 (Mechanical Detection Over Judgment) and P58 (Scope Boundary Rule: LLM calls belong outside the primitive).

### Proposed Split

```
┌──────────────────────────────────────────────────────────┐
│ Claude Code Session (working LLM auth, Max plan OAuth)   │
│                                                          │
│  LLM Judgment Layer:                                     │
│  • Reverse divergence analysis (read code + PRD, judge)  │
│  • Coherence alignment (read tiers, judge)               │
│  • Plan generation (future — forge_plan rethink)         │
│                                                          │
│  ────── pre-computed findings passed down ──────          │
│                                                          │
│  MCP Tools ($0, mechanical):                             │
│  • Forward eval (AC commands)                            │
│  • Coordinate (topo sort, budget, status)                │
│  • Generate (brief assembly)                             │
│  • Report structuring (DivergenceReport, RunRecord)      │
│  • Audit logging, run tracking                           │
└──────────────────────────────────────────────────────────┘
```

### Why This Is Right

1. **Auth works.** The Claude Code session has working auth. The child process doesn't. Route LLM calls through working auth.
2. **Not deterministic anyway.** The reverse scan is LLM judgment — two runs produce different results. There's no determinism to protect by routing through MCP.
3. **Same billing.** Max plan OAuth covers both conversation and MCP tools. No billing difference. [UNVERIFIED — assumed from Anthropic Max plan billing model; no documentation citation available. If session tokens are billed differently from MCP tool tokens, this assumption may be wrong.]
4. **MCP stays in its sweet spot.** Mechanical, $0, deterministic, structured output. The Intelligent Clipboard pattern, extended. Aligns with P58 (primitive vs skill scope boundary).
5. **Backward-compatible.** Old callers with `ANTHROPIC_API_KEY` still work — the existing `trackedCallClaude` path fires when `reverseFindings` is NOT provided (the `else if (input.projectPath)` guard at line 379 falls through). New callers pass pre-computed findings.
6. **Additive optional field.** Adding `reverseFindings` as an optional input follows P50 (Additive Optional Fields for Schema Evolution) — no breaking changes for existing callers.

### What We're NOT Doing (Yet)

- **Not changing forge_plan.** Its entire purpose is the LLM call. Needs a different solution (MCP sampling protocol, proxy passthrough, or rethink as a session-native operation).
- **Not changing coherence mode.** Same pattern applies but out of scope for this PR. Track as issue.
- **Not removing LLM code from evaluate.ts.** The `trackedCallClaude` path remains as fallback for callers with API key auth.

### Decision Record

| Option | Verdict | Reason |
|--------|---------|--------|
| Fix OAuth in MCP server | Can't — platform limitation (Anthropic infra) | Not actionable |
| Use ANTHROPIC_API_KEY | Violates billing rule (Max plan = OAuth) | Wrong billing path |
| Session does LLM, passes findings to MCP | **Adopted** | Auth works, same billing, backward-compatible |
| MCP sampling protocol (server asks client for LLM) | Future — proper long-term fix | Not supported in current Claude Code MCP impl |

## Changes

### Change 1: BUG-DIV-CWD fix (evaluate.ts — TWO call sites)

**File:** `server/tools/evaluate.ts`

**Site A — `handleDivergenceEval` (line 350-352):**
```typescript
// Before:
const report = await evaluateStory(plan, story.id, {
  timeoutMs: input.timeoutMs,
});
// After:
const report = await evaluateStory(plan, story.id, {
  timeoutMs: input.timeoutMs,
  cwd: input.projectPath,
});
```

**Site B — `handleStoryEval` (line 177-179):**
```typescript
// Before:
const report = await evaluateStory(plan, input.storyId, {
  timeoutMs: input.timeoutMs,
});
// After:
const report = await evaluateStory(plan, input.storyId, {
  timeoutMs: input.timeoutMs,
  cwd: input.projectPath,
});
```

**Why:** `evaluateStory` already accepts `cwd` in its options (`evaluator.ts:39-42`) and passes it to the subprocess executor. The field was never provided by either handler. Fixing both prevents the same bug from manifesting in story-mode eval when called with `projectPath`.

VERIFIED: `evaluateStory` accepts `cwd` at `server/lib/evaluator.ts:39-42` — `const execOptions: ExecuteOptions = { timeoutMs: options?.timeoutMs, cwd: options?.cwd, };`

### Change 2: Add `reverseFindings` input to divergence schema

**File:** `server/tools/evaluate.ts`

Add to Zod input schema under the `// -- Divergence mode params --` section comment, after `projectPath` (line 91):
```typescript
reverseFindings: z
  .string()
  .optional()
  .describe(
    "Pre-computed reverse divergence findings as JSON string (array of ReverseDivergence). " +
    "When provided, replaces the LLM reverse scan entirely — projectPath is still used " +
    "for forward AC execution but not for reverse analysis. " +
    "Use when the calling session performs the reverse analysis itself " +
    "(e.g., OAuth 401 prevents MCP server LLM calls)."
  ),
```

Add to `EvaluateInput` type (at `server/tools/evaluate.ts:107-118`):
```typescript
reverseFindings?: string; // JSON string of ReverseDivergence[]
```

**Both the Zod schema and the manual `EvaluateInput` type must be updated** — they are maintained separately (Zod at lines 31-103, type at lines 107-118).

**Precedence rule:** When `reverseFindings` is provided, it takes full precedence over the LLM reverse scan. Even if `projectPath` is also provided, the LLM `trackedCallClaude` path and `scanCodebase` call are skipped for reverse analysis. `projectPath` continues to be used for forward AC command execution. This is by design: the caller has already done the reverse analysis and is passing results.

**In `handleDivergenceEval`** (lines 375-417), add pre-computed path **before** the existing `if (input.projectPath)` block:

```typescript
// ── Reverse divergence: LLM-judged unplanned capabilities ──
let reverseDivergences: ReverseDivergence[] = [];
let reverseSummary = "...";

if (input.reverseFindings) {
  // Pre-computed by calling session (architectural split: session does LLM, MCP structures)
  ctx.progress.begin("reverse-eval");
  try {
    const parsed = JSON.parse(input.reverseFindings);
    if (!Array.isArray(parsed)) throw new Error("reverseFindings must be a JSON array");
    // Validate each element has ALL required ReverseDivergence fields
    const REQUIRED_FIELDS = ["id", "description", "location", "classification", "alignsWithPrd"] as const;
    const VALID_CLASSIFICATIONS = ["method-divergence", "extra-functionality", "scope-creep"] as const;
    for (const item of parsed) {
      for (const field of REQUIRED_FIELDS) {
        if (item[field] === undefined || item[field] === null) {
          throw new Error(`Invalid ReverseDivergence: missing required field '${field}' in ${JSON.stringify(item).slice(0, 80)}`);
        }
      }
      if (typeof item.alignsWithPrd !== "boolean") {
        throw new Error(`Invalid ReverseDivergence: 'alignsWithPrd' must be boolean in ${JSON.stringify(item).slice(0, 80)}`);
      }
      if (!VALID_CLASSIFICATIONS.includes(item.classification)) {
        throw new Error(`Invalid ReverseDivergence: 'classification' must be one of ${VALID_CLASSIFICATIONS.join(", ")} in ${JSON.stringify(item).slice(0, 80)}`);
      }
    }
    reverseDivergences = parsed as ReverseDivergence[];
    reverseSummary = `${reverseDivergences.length} pre-computed reverse finding(s) from caller`;
    ctx.progress.complete("reverse-eval");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`forge_evaluate: failed to parse reverseFindings: ${message}`);
    reverseSummary = `reverseFindings parse failed: ${message}`;
    ctx.progress.fail("reverse-eval");
  }
} else if (input.projectPath) {
  // Existing LLM path (works with ANTHROPIC_API_KEY, fails with OAuth-only)
  try {
    // ... existing trackedCallClaude code unchanged ...
  }
}
```

**Note on progress tracking:** The new `reverseFindings` branch calls `ctx.progress.begin/complete/fail("reverse-eval")`. The existing LLM path (lines 379-414) does NOT call progress begin/complete for reverse-eval — it relies on `trackedCallClaude` which has its own internal progress tracking (via `RunContext.trackLlmCall` at `server/lib/run-context.ts:49-71`). The `else` branch (no projectPath, no reverseFindings) calls `ctx.progress.skip("reverse-eval")`. This asymmetry is intentional: the new pre-computed path is fast enough to track as a single begin/complete pair; the existing LLM path delegates progress to the LLM tracking infrastructure. `"reverse-eval"` is pre-registered in the stages array at line 334, so `begin()` finds it at index 1 — no dynamic append needed.

VERIFIED: `"reverse-eval"` pre-registered at `server/tools/evaluate.ts:334` — `const stages = ["forward-eval", "reverse-eval"];`
VERIFIED: `ProgressReporter.begin()` handles unknown stages dynamically at `server/lib/progress.ts:34-38` — appends to `this.stages` if `indexOf` returns -1

**Note on parse failure behavior:** When `reverseFindings` is provided but fails parsing/validation, the handler continues with `reverse: []` and `status: "complete"`. This matches the existing codebase pattern — the current `trackedCallClaude` path (line 409-414) has identical graceful degradation behavior (catches errors, logs to console.error, sets a failure summary string, continues with empty reverse array and `status: "complete"`). Changing the new path to return `status: "eval-failed"` would create an inconsistency where pre-computed input failures are treated more harshly than LLM call failures. Both paths surface the failure in `reverseSummary` for consumers that inspect it.

**Changes from original plan:**
- Added `alignsWithPrd` to required field validation (was missing — `ReverseDivergence` interface requires it as `boolean`, see `server/types/divergence-report.ts:21`)
- Added type check for `alignsWithPrd` (`typeof item.alignsWithPrd !== "boolean"`)
- Added `classification` enum validation against the three allowed values (`"method-divergence" | "extra-functionality" | "scope-creep"`, see `server/types/divergence-report.ts:17-20`)
- Specified Zod schema placement: under `// -- Divergence mode params --` section, after `projectPath`

VERIFIED: `ReverseDivergence` interface at `server/types/divergence-report.ts:13-22` — includes `alignsWithPrd: boolean` as required field and `classification` as `"method-divergence" | "extra-functionality" | "scope-creep"` union type

VERIFIED: Existing `trackedCallClaude` catch block at `server/tools/evaluate.ts:409-414` — graceful degradation with `console.error`, failure summary string, empty reverse array, `status: "complete"` — identical pattern to the proposed `reverseFindings` catch block

### Change 3: Regression test for BUG-DIV-CWD

**File:** `server/tools/divergence-cwd.test.ts` (new file, following the project's pattern of dedicated test files like `dogfood-divergence.test.ts`)

Test: Create a fixture plan with AC commands that check for a file only present at a specific path. Call `handleDivergenceEval` with `projectPath` set to a temp directory containing that file. Assert: forward divergences count is 0 (commands ran in correct cwd).

### Change 4: Tests for reverseFindings input (6 tests)

**File:** `server/tools/divergence-cwd.test.ts` (same file as Change 3)

- **Valid input:** Call with `reverseFindings` JSON string containing 2 valid `ReverseDivergence` items (including `alignsWithPrd` and valid `classification`). Assert: report.reverse has 2 items, summary mentions "pre-computed".
- **Invalid JSON:** Call with `reverseFindings: "not json"`. Assert: report.reverse is empty, summary mentions "parse failed".
- **Malformed shape (missing fields):** Call with `reverseFindings: '[{"id":"x"}]'` (missing description/location/classification/alignsWithPrd). Assert: report.reverse is empty, summary mentions "missing required field".
- **Invalid classification enum:** Call with a complete item but `classification: "unknown"`. Assert: report.reverse is empty, summary mentions "classification must be one of".
- **Both reverseFindings and projectPath provided:** Call with valid `reverseFindings` AND `projectPath`. Assert: report.reverse matches the pre-computed findings (LLM scan was skipped), forward eval still ran against `projectPath`.
- **Empty array `"[]"`:** Call with `reverseFindings: "[]"`. Assert: report.reverse is empty array, summary contains "0 pre-computed" (NOT "No codebase context").

### Change 5: Reverse divergence emulation (in-conversation)

Read all forge_coordinate source files + PRD. Identify implementation details NOT documented in the PRD:
- Undocumented behaviors (e.g., fallback logic, edge case handling)
- Extra functionality beyond PRD requirements
- Implicit contracts between modules
- Behavioral assumptions not in any spec

**File scope:** The forge_coordinate source is 3 files: `server/tools/coordinate.ts` (handler), `server/lib/coordinator.ts` (core logic), `server/types/coordinate-result.ts` (types). Enumerate with `ls server/{tools,lib,types}/*coordinate*`. If the PRD is large, prioritize handler + core logic over types.

Produce structured `ReverseDivergence[]` findings. Pass to `forge_evaluate(mode: "divergence", reverseFindings: JSON.stringify(findings))` after the code fix ships.

**Quality gate:** The emulation must produce at least 3 reverse findings spanning at least 2 distinct `classification` values. If the analysis produces fewer, the emulation step is incomplete — either the codebase genuinely has minimal divergence (document why) or the analysis was insufficiently thorough (repeat with deeper inspection).

### Change 6: Forward re-validation

After BUG-DIV-CWD fix ships and session restarts (F54), re-run:
```
forge_evaluate({
  mode: "divergence",
  planPath: ".ai-workspace/plans/forge-coordinate-phase-PH-01.json",
  projectPath: "."
})
```
...for all 8 phase plans. Expect 0 forward failures (mechanically validated, not manually).

### Change 7: Updated divergence report

Write `.ai-workspace/audits/2026-04-12-divergence-post-coordinate-v2.md` with:
- Mechanically-validated forward results (0 gaps, confirmed by fixed tool)
- Session-emulated reverse findings (first reverse data since baseline)
- Comparison with baseline (93 → 80 → final number)

### Change 8: GitHub issues

1. **OAuth 401 in MCP LLM calls** — track the platform limitation, link to anthropic.ts:65-66
2. **Apply reverseFindings pattern to coherence mode** — same architectural split opportunity

## Test Cases & AC

| # | Test | Pass Criteria |
|---|------|---------------|
| AC-01 | Both cwd call sites fixed | `grep -n "cwd: input.projectPath" server/tools/evaluate.ts` returns 2 matches (line ~177 story-mode, line ~350 divergence-mode) |
| AC-02 | Forward divergence returns 0 false negatives (PH-02) | Precondition: code fix applied, `npm run build` completed, session restarted (F54). Run forge_evaluate divergence on forge-coordinate-phase-PH-02.json with projectPath=".": report.forward is empty array |
| AC-02b | Forward divergence returns 0 false negatives (all 8 plans) | Precondition: code fix applied, `npm run build` completed, session restarted (F54). Verify 8 plan files exist matching `forge-coordinate-phase-PH-*.json`, then run forge_evaluate divergence on each with projectPath=".": every report.forward is empty array |
| AC-03 | `reverseFindings` field in schema | `grep "reverseFindings" server/tools/evaluate.ts` returns ≥3 matches (Zod schema + EvaluateInput type + handler branch) |
| AC-04 | Pre-computed reverseFindings bypasses LLM | Unit test: call with valid reverseFindings JSON (including `alignsWithPrd` and valid `classification`) → report.reverse length matches input length, summary contains "pre-computed" |
| AC-05 | Invalid reverseFindings degrades gracefully | Unit test: call with `reverseFindings: "not json"` → report.reverse is empty array, summary contains "parse failed" |
| AC-06 | Malformed reverseFindings (missing fields) rejected | Unit test: call with `reverseFindings: '[{"id":"x"}]'` (missing description/location/classification/alignsWithPrd) → report.reverse is empty, summary contains "missing required field" |
| AC-06b | Invalid classification enum rejected | Unit test: call with complete item but `classification: "unknown"` → report.reverse is empty, summary contains "classification must be one of" |
| AC-06c | Both reverseFindings and projectPath: pre-computed wins | Unit test: call with valid `reverseFindings` AND `projectPath` → report.reverse matches pre-computed findings, forward eval still executed |
| AC-06d | Empty array reverseFindings: semantically distinct from "not analyzed" | Unit test: call with `reverseFindings: "[]"` → report.reverse is empty array, summary contains "0 pre-computed" (NOT "No codebase context") |
| AC-07 | Reverse emulation report exists with quality gate | `grep -c "REV-" .ai-workspace/audits/2026-04-12-divergence-post-coordinate-v2.md` returns ≥3, AND findings span at least 2 distinct classification values |
| AC-08 | All existing tests pass | `npm test` exits 0, test count ≥ 541 |
| AC-09 | New tests added | Test count ≥ 548 (541 + at least 7 new: cwd regression + reverseFindings valid + reverseFindings invalid + reverseFindings malformed + reverseFindings enum + reverseFindings precedence + reverseFindings empty array) |

**Changes from original plan:**
- AC-02 and AC-02b: added explicit precondition "code fix applied, `npm run build` completed, session restarted (F54)"
- AC-02b added to cover all 8 phase plans (original AC-02 only covered PH-02, per Researcher finding #2 / P26)
- AC-02b updated with precondition: verify 8 plan files exist before running evaluations (Critic 1 Finding 3)
- AC-03 match count raised from ≥2 to ≥3 (must appear in Zod schema, EvaluateInput type, AND handler)
- AC-04 updated to require `alignsWithPrd` and valid `classification` in test data
- AC-06b added for classification enum validation
- AC-06c added for both-provided precedence test (Critic 1 Finding 2)
- AC-06d added for empty array edge case (Critic 2 Finding 3)
- AC-07 raised from ≥1 to ≥3 with classification diversity requirement (Critic 1 Finding 5)
- AC-09 test count raised to 7 (added precedence test + empty array test), threshold updated to ≥548

## Checkpoint

- [x] BUG-DIV-CWD fix applied (BOTH call sites: story-mode line ~177 + divergence-mode line ~350)
- [x] reverseFindings input added to schema + handler (with FULL field validation including `alignsWithPrd` and `classification` enum)
- [x] Both Zod schema AND EvaluateInput type updated (they are maintained separately)
- [x] Zod field placed under `// -- Divergence mode params --` section, after `projectPath`
- [x] Regression test for cwd fix
- [x] Tests for reverseFindings (valid input + invalid JSON + malformed shape + invalid classification enum + both-provided precedence + empty array)
- [x] All tests pass (`npm test` exit 0, count = 548 ≥ 541)
- [x] `npm run build` to compile changes to dist/
- [x] Reverse divergence emulation completed (7 findings, 3 classification values) — `.ai-workspace/audits/2026-04-12-reverse-divergence-findings.json`
- [ ] **Session restart** (F54 — MCP server loads compiled JS, mid-session build has no effect) — DEFERRED: forward re-validation requires new session
- [ ] Forward divergence re-validated with fixed tool via MCP — **all 8 plans** (0 failures expected) — depends on steps 8 + 10 (build + restart)
- [x] Updated divergence report written (`.ai-workspace/audits/2026-04-12-divergence-post-coordinate-v2.md`)
- [x] GitHub issues created (#149 OAuth 401 tracking, #150 coherence mode same-pattern)
- [ ] PR shipped via /ship

Last updated: 2026-04-12T09:10:00+08:00 (11/14 items complete, forward re-validation deferred to post-restart)

---

## Critic Findings Disposition

### Critic 1, Finding 1 — MAJOR: Parse failure silently swallows errors — ACKNOWLEDGED, NOT FIXED

The critic is right that a parse failure with `status: "complete"` is semantically imprecise. However, the existing codebase already has this exact pattern: the `trackedCallClaude` catch block at `server/tools/evaluate.ts:409-414` does the same thing — catches the error, logs it, sets a failure summary, continues with empty reverse array and `status: "complete"`. Changing the new code path to use `status: "eval-failed"` would create an inconsistency where pre-computed input failures are treated more harshly than LLM call failures. The right fix is to address both paths together (a separate issue). Added an explanatory note to Change 2.

SIDE-EFFECT-CHECK: Added explanatory note to Change 2 about parse failure behavior
  format: ok
  naming: ok
  shape:  ok — no field or type changes; behavior matches existing pattern
  refs:   ok

### Critic 1, Finding 2 — MAJOR: Both reverseFindings and projectPath provided — FIXED

Valid concern. Applied two fixes: (1) documented the precedence rule explicitly in the Zod schema description for `reverseFindings`, and (2) added a test case (AC-06c) for the both-provided scenario.

SIDE-EFFECT-CHECK: Documented precedence rule in Zod description + added AC-06c + added test to Change 4
  format: ok
  naming: ok
  shape:  ok — no new fields; only clarified existing behavior
  refs:   "AC-09 test count updated to include precedence test"

### Critic 1, Finding 3 — MINOR: AC-02b assumes plan file naming — FIXED

Valid. Added precondition to AC-02b: "Verify 8 plan files exist matching `forge-coordinate-phase-PH-*.json`" before running evaluations.

SIDE-EFFECT-CHECK: Added precondition check to AC-02b
  format: ok
  naming: ok
  shape:  ok
  refs:   ok

### Critic 1, Finding 4 — MINOR: No `id` format validation — SKIPPED

The critic acknowledges impact is low. The `id` field is a display-only opaque identifier — it has no downstream logic that depends on format. Adding format validation would be over-engineering for no behavioral benefit. The `classification` field gets enum validation because it IS a controlled vocabulary used for categorization logic. The asymmetry is intentional, not accidental.

### Critic 1, Finding 5 — MAJOR: Change 5 has no quality AC — FIXED

Valid. Added a quality gate to Change 5: "at least 3 reverse findings spanning at least 2 distinct classification values." Updated AC-07 to match. This ensures the emulation actually exercised judgment rather than producing a single trivial finding.

SIDE-EFFECT-CHECK: Added quality gate to Change 5 + updated AC-07
  format: ok
  naming: ok
  shape:  ok
  refs:   "AC-07 criteria updated in Test Cases table AND Change 5 text"

### Critic 1, Finding 6 — MINOR: "Same billing" claim unverified — FIXED

Valid. Added `[UNVERIFIED]` tag with explanatory note to point 3 of "Why This Is Right."

SIDE-EFFECT-CHECK: Added UNVERIFIED tag to billing claim
  format: ok
  naming: ok
  shape:  ok
  refs:   ok

### Critic 1, Finding 7 — MINOR: Checkpoint ordering dependency — FIXED

Valid but minimal impact. Added explicit dependency note to step 11 (forward re-validation): "depends on steps 8 + 10 (build + restart)."

SIDE-EFFECT-CHECK: Added dependency note to checkpoint step 11
  format: ok
  naming: ok
  shape:  ok
  refs:   ok

### Critic 2, Finding 2 — MAJOR: Progress tracking asymmetry between new and existing LLM path — ACKNOWLEDGED, DOCUMENTED

The critic raised a concern that the new `reverseFindings` branch uses `ctx.progress.begin/complete/fail("reverse-eval")` while the existing LLM path does not. Three facts resolve this:

1. `"reverse-eval"` is already pre-registered in the stages array at `server/tools/evaluate.ts:334` — `const stages = ["forward-eval", "reverse-eval"];` — so `begin()` finds it at index 1.
2. Even if it weren't, `ProgressReporter.begin()` at `server/lib/progress.ts:34-38` handles unknown stages dynamically by appending to `this.stages`.
3. The existing LLM path delegates progress tracking to `trackedCallClaude` which calls `RunContext.trackLlmCall` (which has its own `begin/complete/fail` internally at `server/lib/run-context.ts:49-71`). So the asymmetry is intentional: different progress granularity for different code paths.

Added an explanatory note to Change 2.

### Critic 2, Finding 3 — MINOR: Empty array `"[]"` not tested — FIXED

Valid. The self-review described the behavior but it wasn't captured in the AC table. Added AC-06d: unit test for `reverseFindings: "[]"` verifying summary contains "0 pre-computed" (not "No codebase context"). Added the test to Change 4's test list. Updated AC-09 count.

SIDE-EFFECT-CHECK: Added AC-06d + updated Change 4 test list + updated AC-09 count
  format: ok
  naming: ok
  shape:  ok — no new fields; tests existing behavior
  refs:   AC-09 threshold updated to ≥548

### Critic 2, Finding 4 — MINOR: AC-02/AC-02b missing session-restart precondition — FIXED

Valid. Added explicit precondition to both: "Precondition: code fix applied, `npm run build` completed, session restarted (F54)."

SIDE-EFFECT-CHECK: Added preconditions to AC-02 and AC-02b
  format: ok
  naming: ok
  shape:  ok
  refs:   ok

### Critic 2, Finding 6 — MINOR: AC-09 says "5 new" but lists 6 tests — FIXED

The count was wrong. With the addition of the empty-array test (from Finding 3 above), the total is now 7 new tests: cwd regression + reverseFindings valid + invalid JSON + malformed shape + invalid classification enum + both-provided precedence + empty array. Updated the parenthetical and the numeric threshold to ≥548 (541 + 7).

SIDE-EFFECT-CHECK: Updated AC-09 count and threshold
  format: ok
  naming: ok
  shape:  ok
  refs:   Checkpoint step 6 also lists all 6 reverseFindings sub-tests — consistent

### Critic 2, Finding 7 — MAJOR: Change 5 reverse emulation has no file scope — FIXED

Valid. Added a concrete file manifest to Change 5: "The forge_coordinate source is 3 files: `server/tools/coordinate.ts` (handler), `server/lib/coordinator.ts` (core logic), `server/types/coordinate-result.ts` (types)." Also added to the Checkpoint step for emulation. This scopes the analysis to a manageable set.

SIDE-EFFECT-CHECK: Added file manifest to Change 5 + checkpoint
  format: ok
  naming: ok
  shape:  ok
  refs:   ok

### Critic 2, Finding 8 — MINOR: Zod schema placement not specified — FIXED

Valid. Added to Change 2: "Add to Zod input schema under the `// -- Divergence mode params --` section comment, after `projectPath` (line 91)." Also added a checkpoint item.

SIDE-EFFECT-CHECK: Added placement spec to Change 2 + checkpoint item
  format: ok
  naming: ok
  shape:  ok
  refs:   ok

---

## TC-CHECK (Mechanical Self-Check)

The test cases in this plan are specification-level descriptions, not executable code. The ACs that use shell commands are grep-based checks. Checking all ACs:

- `TC-CHECK: AC-01 — ESM:n/a (grep), target:ok (checks actual file content), ext:n/a, precond:ok (file must have fix applied), async:n/a, cleanup:n/a, paths:ok (relative from project root)`
- `TC-CHECK: AC-02 — ESM:n/a (MCP call), target:ok, ext:n/a, precond:ok (fix applied + build + restart — now explicit), async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-02b — ESM:n/a (MCP call), target:ok, ext:n/a, precond:ok (8 plan files verified to exist first + build + restart), async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-03 — ESM:n/a (grep), target:ok (checks actual file content), ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-04 — ESM:ok (vitest, import-only), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-05 — ESM:ok (vitest, import-only), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-06 — ESM:ok (vitest, import-only), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-06b — ESM:ok (vitest, import-only), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-06c — ESM:ok (vitest, import-only), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-06d — ESM:ok (vitest, import-only), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-07 — ESM:n/a (grep + manual), target:ok, ext:n/a, precond:ok (emulation done first with quality gate), async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-08 — ESM:n/a (npm test), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`
- `TC-CHECK: AC-09 — ESM:n/a (count check), target:ok, ext:n/a, precond:ok, async:n/a, cleanup:n/a, paths:ok`

Unit test ACs (AC-04, AC-05, AC-06, AC-06b, AC-06c, AC-06d) are specifications, not code. The implementing agent will write them in the project's ESM style (vitest, import-only, no require). No code to mechanically check at this stage.

## Self-Review Checklist

**1. Conflicts:** No internal contradictions found. The new AC-06c does not conflict with AC-04 — AC-04 tests valid input alone, AC-06c tests valid input when projectPath is also present. AC-06d does not conflict with AC-05 — AC-05 tests invalid JSON, AC-06d tests valid JSON (empty array). AC-02b's precondition ("verify 8 plan files exist") does not conflict with AC-02 (single-plan smoke test). AC-07's raised threshold (≥3 findings, ≥2 classifications) is consistent with Change 5's quality gate. The Finding 1 disposition (keep `status: "complete"` on parse failure) does not conflict with AC-05 — AC-05 only checks summary string, not status field, which is consistent with the acknowledged-but-not-fixed approach. AC-09's threshold (≥548 = 541+7) matches the 7 tests listed in the parenthetical (1 cwd + 6 reverseFindings).

**2. Edge cases:** The both-provided scenario (Critic 1 Finding 2 fix) is now documented and tested. The empty-array scenario (Critic 2 Finding 3 fix) is now tested. What if `reverseFindings` is an empty string `""`? → `JSON.parse("")` throws SyntaxError, caught by the catch block, summary says "parse failed" — covered by AC-05's pattern. What if `reverseFindings` is `"null"`? → `JSON.parse("null")` returns `null`, `!Array.isArray(null)` throws "must be a JSON array" — caught by the validation, covered by the "malformed shape" pattern.

**3. Interactions:** The Critic 1 Finding 2 fix (precedence documentation in Zod schema) interacts with the Critic 1 Finding 2 test (AC-06c). Both are consistent — the schema says "replaces the LLM reverse scan entirely" and the test verifies that behavior. The Critic 1 Finding 5 fix (quality gate in Change 5) interacts with Finding 5's AC-07 update — both say ≥3 findings, ≥2 classifications. Consistent. The Critic 2 Finding 3 fix (AC-06d) interacts with Change 4's test list — both include the empty-array test. The AC-09 threshold (≥548) is consistent with 7 new tests across Changes 3 and 4.

**4. New additions (cumulative across all critique rounds):**
- `NEW_CLAIM: AC-06c (both-provided precedence test) — source: Critic 1 Finding 2`
- `NEW_CLAIM: AC-06d (empty array test) — source: Critic 2 Finding 3`
- `NEW_CLAIM: AC-07 quality gate ≥3 findings, ≥2 classifications — source: Critic 1 Finding 5`
- `NEW_CLAIM: AC-09 test count raised to 7, threshold ≥548 — source: Critic 2 Finding 6 + Critic 2 Finding 3`
- `NEW_CLAIM: Precedence rule documented in Zod description — source: Critic 1 Finding 2`
- `NEW_CLAIM: UNVERIFIED tag on billing claim — source: Critic 1 Finding 6`
- `NEW_CLAIM: Dependency note on checkpoint step 11 — source: Critic 1 Finding 7`
- `NEW_CLAIM: Preconditions on AC-02 and AC-02b — source: Critic 2 Finding 4`
- `NEW_CLAIM: Progress tracking note in Change 2 — source: Critic 2 Finding 2`
- `NEW_CLAIM: Zod schema placement specified — source: Critic 2 Finding 8`
- `NEW_CLAIM: File manifest in Change 5 — source: Critic 2 Finding 7`

**5. Evidence-gated verification:**
- VERIFIED: `evaluateStory` missing `cwd` at `server/tools/evaluate.ts:350-352` — `"const report = await evaluateStory(plan, story.id, { timeoutMs: input.timeoutMs, });"`
- VERIFIED: `evaluateStory` missing `cwd` at `server/tools/evaluate.ts:177-179` — `"const report = await evaluateStory(plan, input.storyId, { timeoutMs: input.timeoutMs, });"`
- VERIFIED: `evaluateStory` accepts `cwd` at `server/lib/evaluator.ts:39-42` — `"const execOptions: ExecuteOptions = { timeoutMs: options?.timeoutMs, cwd: options?.cwd, };"`
- VERIFIED: OAuth limitation at `server/lib/anthropic.ts:64-66` — `"Note: OAuth tokens only work when proxied through Claude Code's infrastructure. Direct API calls with OAuth return 401 'OAuth authentication is currently not supported.'"`
- VERIFIED: `ReverseDivergence` full interface at `server/types/divergence-report.ts:13-22` — includes `alignsWithPrd: boolean` (line 21) and `classification: "method-divergence" | "extra-functionality" | "scope-creep"` (lines 17-20)
- VERIFIED: `DivergenceReport.status` type at `server/types/divergence-report.ts:26` — `"status: "complete" | "eval-failed""`
- VERIFIED: `EvaluateInput` type at `server/tools/evaluate.ts:107-118` — manual type definition separate from Zod schema (Zod at lines 31-103)
- VERIFIED: `trackedCallClaude` reverse path at `server/tools/evaluate.ts:390-399` — `"const result = await trackedCallClaude(ctx, "reverse-eval", "divergence-evaluator", { system, messages: [{ role: "user", content: userMessage }], jsonMode: true, });"`
- VERIFIED: `trackedCallClaude` coherence path at `server/tools/evaluate.ts:238` — `"const result = await trackedCallClaude(ctx, "coherence-eval", "coherence-evaluator", {"`
- VERIFIED: Existing `trackedCallClaude` catch block at `server/tools/evaluate.ts:409-414` — `"console.error(...forge_evaluate: reverse divergence scan failed: ${message}...); reverseSummary = ...Reverse divergence scan failed: ${message}...;"` with empty `reverseDivergences`, continues to `status: "complete"` at line 423
- VERIFIED: `"reverse-eval"` pre-registered at `server/tools/evaluate.ts:334` — `"const stages = ["forward-eval", "reverse-eval"];"`
- VERIFIED: `ProgressReporter.begin()` handles unknown stages at `server/lib/progress.ts:32-38` — `"begin(stageName: string): void { this.currentIndex = this.stages.indexOf(stageName); if (this.currentIndex === -1) { this.stages.push(stageName); this.currentIndex = this.stages.length - 1; }"`
- VERIFIED: `reverseFindings` does not exist in `server/tools/evaluate.ts` — grep returned zero matches (field is new)
- VERIFIED: project uses ESM — `package.json` contains `"type": "module"`
- VERIFIED: Zod schema section comment at `server/tools/evaluate.ts:85` — `"// ── Divergence mode params ──"` with `projectPath` at lines 86-91
- VERIFIED: forge_coordinate source files: `server/tools/coordinate.ts`, `server/lib/coordinator.ts`, `server/types/coordinate-result.ts` found via glob `server/**/*coordinate*`
- UNVERIFIED: 55/55 false negatives claim — from PR #148, not independently confirmed
- UNVERIFIED: forge_coordinate and forge_generate being "$0, no LLM" — design intent per memory, not source-verified
- UNVERIFIED: Max plan billing treats session and MCP tool tokens identically — no documentation citation available

---

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 0
- **MAJOR:** 3
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | Parse failure silently continues with `status: "complete"` + empty reverse | No | Existing LLM path (evaluate.ts:409-414) has identical graceful-degradation pattern — changing only the new path creates inconsistency |
| 2 | MAJOR | Both `reverseFindings` AND `projectPath` precedence undocumented | Yes | Added precedence rule to Zod description + AC-06c test |
| 3 | MAJOR | Change 5 (reverse emulation) has no quality AC | Yes | Added >=3 findings, >=2 classifications quality gate to AC-07 |
| 4 | MINOR | AC-02b assumes plan files exist without verifying | Yes | Added precondition check |
| 5 | MINOR | `id` field not validated (asymmetry with `classification`) | No | `id` is display-only opaque identifier — asymmetry intentional |
| 6 | MINOR | "Same billing" claim unsupported | Yes | Added [UNVERIFIED] tag |
| 7 | MINOR | Checkpoint dependency implicit | Yes | Added explicit dependency note |

### Round 2 (Critic-2)
- **CRITICAL:** 0
- **MAJOR:** 2 (+ 2 retracted)
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | MAJOR | `reverseFindings` summary field loss on parse failure | Retracted | Summary string already surfaces the error |
| 2 | MAJOR | Progress tracking asymmetry (`begin/complete` vs existing path) | Acknowledged | `reverse-eval` pre-registered at line 334; existing path delegates to `trackedCallClaude`; added note |
| 3 | MINOR | Empty array `"[]"` edge case untested | Yes | Added AC-06d test |
| 4 | MINOR | AC-02/AC-02b missing restart precondition | Yes | Added explicit precondition text |
| 5 | MAJOR | Import dead code when `reverseFindings` provided | Retracted | Imports remain reachable via fallback path |
| 6 | MINOR | AC-09 says "5 new" but lists 6, threshold too loose | Yes | Corrected to 7 new tests, threshold >=548 |
| 7 | MAJOR | Change 5 file scope unbounded | Yes | Added 3-file manifest with enumeration command |
| 8 | MINOR | Zod schema placement unspecified | Yes | Specified location after `projectPath` |

### Summary
- Total findings: 13 across both rounds (7 Round 1 + 6 Round 2, excluding 2 retracted)
- Applied: 10 (77%)
- Rejected/Acknowledged: 3 (23%) — F1-R1 (consistency with existing pattern), F5-R1 (intentional asymmetry), F2-R2 (documented, not a bug)
- Key changes: (1) full `ReverseDivergence` field validation including `alignsWithPrd` + `classification` enum, (2) precedence rule documented + tested, (3) reverse emulation quality gate added, (4) AC preconditions tightened, (5) file scope bounded to 3-file manifest, (6) test count corrected to 7 with threshold >=548
