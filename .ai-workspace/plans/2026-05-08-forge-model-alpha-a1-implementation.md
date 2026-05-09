---
plan: FORGE_MODEL — α + A1 implementation (Phase 2)
status: DRAFT (pre-light-reviewer-chain)
authors: forge-plan
date: 2026-05-08
ratifies: .ai-workspace/plans/2026-05-08-forge-model-config-decision.md (4-0 ship-it on option α; operator ratified 2026-05-08T1600Z)
ships_in: v0.40.6
---

## ELI5

Phase 1 (decision plan) is done — all four reviewers voted α (single `FORGE_MODEL` env var) with A1 (obsolescence-aware loud failure). Operator ratified.

This Phase-2 plan captures the implementation. Two changes:

1. **α — `FORGE_MODEL` env var.** Read at module-load via IIFE in `anthropic.ts` (same pattern as `FORGE_CORRECTOR_MAX_TOKENS`). Export `DEFAULT_MODEL` constant. `cost.ts:90` imports it (kills the live `"claude-sonnet-4-6"` literal duplicate).
2. **A1 — obsolescence-aware loud failure.** `callClaude` catches `404 model_not_found` from the Anthropic API and re-throws with operator-actionable guidance ("set `FORGE_MODEL` to a current model, see https://docs.anthropic.com/...").

Operator UX: `FORGE_MODEL=claude-opus-4-6 npm test` (or `export` in shell). Restart MCP child after change (F54 trap — module-load reads stick until the child process restarts; same pattern as v0.40.x release transitions).

## Execution model

**Single-PR shipping order.** Three files (`anthropic.ts` + `cost.ts` + tests). A1 and α are tightly coupled — A1 needs the resolver from α. Ship as one PR, v0.40.6.

**Stages:**

1. Worktree from `origin/master` per Rule 12: `.claude/worktrees/forge-model-alpha-20260508/`.
2. Implement α in `anthropic.ts` (export `DEFAULT_MODEL` via module-load IIFE reading `FORGE_MODEL`, with whitespace-trim).
3. Implement A1 in `anthropic.ts`'s `callClaude` (catch `404 model_not_found`, re-throw with operator-actionable guidance).
4. Update `cost.ts:90` to import `DEFAULT_MODEL` (kills the live P43 violation). Add `unknownModelWarned` field + warning method following the `stalePricingWarned` pattern at `cost.ts:44,58`.
5. New test cases (8 total — 4 α + 2 A1 in `anthropic.test.ts`, 2 cost in `cost.test.ts`) using `vi.stubEnv` + `vi.resetModules` OR direct env mutation (see §D for both established patterns).
6. `npm test` PASS, `npm run build` PASS.
7. PR + CI + `/ship` Stages 0-10 → v0.40.6.
8. Mail macbook-monday post-merge: changes + smoke-test request. Restart-Claude-Code F54 trap warning at top.

## Why

Architectural choice (α + A1 over β/γ/δ/ε) is already 4-0 reviewer-validated. See `2026-05-08-forge-model-config-decision.md` for full rationale.

This Phase-2 plan focuses on implementation correctness, not architectural choice. The reviewer chain on this plan should audit:
- A1's error-detection logic (typed instance check on Anthropic API errors, similar to F6's `Anthropic.AuthenticationError` pattern)
- IIFE module-load + test mocking pattern matches the established convention
- `cost.ts:90` import wiring is single-source-of-truth (no third hardcode locus emerges)
- The 7 test cases cover all platform/env-state combinations

## What

### A. `server/lib/anthropic.ts:6-7` — env-var read + export (α core)

**Locus.** Top of file, replacing the existing single-line `const DEFAULT_MODEL = "claude-sonnet-4-6"`.

**Shape.**

```ts
/**
 * α (v0.40.6) — operator-overridable default model for callClaude.
 *
 * Default model for callClaude when the caller does not pass `options.model`.
 *
 * Resolution order:
 *   1. FORGE_MODEL env var (if set + non-whitespace, trimmed)
 *   2. Built-in fallback: claude-sonnet-4-6
 *
 * Reading happens at module-load (IIFE) — matches FORGE_CORRECTOR_MAX_TOKENS
 * (plan.ts:336-348) convention. Operators who change FORGE_MODEL mid-process
 * must restart the MCP child to pick it up (F54 trap — same as v0.40.x release
 * transitions).
 *
 * EXPORTED so cost.ts can use the same default for its PRICING-table lookup —
 * single source-of-truth per F49 (no dual-locus drift between API client's
 * default and cost tracker's fallback). Same export pattern as
 * KEYCHAIN_SERVICE_NAME (line 26, F6 v0.40.5 precedent).
 *
 * Whitespace handling: `raw.trim()` treats whitespace-only env values as
 * unset. INTENTIONAL DIVERGENCE from FORGE_CORRECTOR_MAX_TOKENS (which
 * doesn't trim). Plan's behavior is strictly safer (catches "   " typo).
 */
export const DEFAULT_MODEL: string = (() => {
  const raw = process.env.FORGE_MODEL;
  if (raw && raw.trim()) return raw.trim();
  return "claude-sonnet-4-6";
})();
```

### B. `server/lib/anthropic.ts:callClaude` — A1 obsolescence-aware loud failure

**Locus.** `callClaude` function, inside the existing try/catch around `messages.stream(...).finalMessage()` at **`anthropic.ts:366-376`** (the F6 v0.40.5 401-retry block). P1 verified the line numbers — the previous draft cited `:289-300`, which is actually inside `extractJson`'s error path.

**Shape.** Add an `if (err instanceof Anthropic.NotFoundError)` branch BEFORE the existing F6 `AuthenticationError` check. **A1 (NotFoundError = 404) and F6 (AuthenticationError = 401) are type-disjoint subclasses of `APIError`** — ordering between them is safe either way; we place A1 first for read-clarity. P1 verified `Anthropic.NotFoundError` is exposed in SDK 0.82.0 at `node_modules/@anthropic-ai/sdk/index.d.ts:6` (re-export from `core/error.d.ts:40`: `export declare class NotFoundError extends APIError<404, Headers> {}`) AND as a static on the default Anthropic class at `client.d.ts:202`. The plan's `err instanceof Anthropic.NotFoundError` check will work.

**Terminal-path semantics (P2 catch).** A1's `throw new Error(...)` is **terminal for the catch block** — it exits `callClaude` entirely. F6's downstream `isAuthError` block runs ONLY in the non-NotFoundError path. The implementer must NOT add a `return` or fall-through after the A1 throw; the throw IS the exit. Code shape:

```ts
} catch (err) {
  if (err instanceof Anthropic.NotFoundError) {
    throw new Error(/* A1 message */); // ← terminal; rest of catch is skipped
  }
  // F6 401-retry path — only reached when err is NOT a NotFoundError:
  const isAuthError = err instanceof Anthropic.AuthenticationError;
  // ... existing F6 retry logic unchanged ...
}
```

```ts
// Inside callClaude, alongside the existing AuthenticationError retry:
try {
  response = await getClient().messages.stream(streamArgs).finalMessage();
} catch (err) {
  // A1: obsolescence-aware loud failure (v0.40.6).
  // Anthropic API returns 404 model_not_found when the requested model has
  // been deprecated. Re-throw with operator-actionable guidance instead of
  // letting the cryptic SDK error bubble up.
  if (err instanceof Anthropic.NotFoundError) {
    const modelName = streamArgs.model;
    throw new Error(
      `Anthropic API rejected model "${modelName}" — likely deprecated. ` +
        `Set FORGE_MODEL to a current model: https://docs.anthropic.com/en/docs/about-claude/models. ` +
        `Forge-harness ships an in-code default that gets bumped each release; ` +
        `if you set FORGE_MODEL=${modelName} explicitly, that name has been deprecated separately. ` +
        `Restart the MCP child after the change (F54 trap).`,
    );
  }

  // Existing F6 401-retry logic stays unchanged ...
  const isAuthError = err instanceof Anthropic.AuthenticationError;
  // ...
}
```

**SDK probe — DONE in plan-time.** P1 verified `Anthropic.NotFoundError` is the right symbol (typed class, not interface). Implementer can skip re-probing; the typed instance check is correct. **Caveat:** the SDK ALSO exposes `BetaNotFoundError` (interface) and `shared.NotFoundError` (interface). Implementer must use the class form via `Anthropic.NotFoundError` (default namespace static) — NOT the structural interfaces.

### C. `server/lib/cost.ts:90` — single-source-of-truth (P43 fix + P45 warning)

**Locus 1: the fallback (live P43 violation).** Line 90 currently reads `const effectiveModel = model ?? "claude-sonnet-4-6";`. Change to:

```ts
import { DEFAULT_MODEL } from "./anthropic.js";
// ...
const effectiveModel = model ?? DEFAULT_MODEL;
```

**Locus 2: the unknown-model warning.** Add a one-time-per-instance warning when `isPricingModel(effectiveModel)` returns false — mirrors `stalePricingWarned` at `cost.ts:44,58`:

```ts
private unknownModelWarned = false;

private warnUnknownModel(model: string): void {
  if (this.unknownModelWarned) return;
  console.error(
    `forge: model "${model}" is not in the cost-tracking PRICING table ` +
    `(known: ${Object.keys(PRICING).join(", ")}). ` +
    `Estimates will be null for this run; calls still proceed.`,
  );
  this.unknownModelWarned = true;
}
```

Wired into `recordUsage()` at the existing `if (isPricingModel(effectiveModel)) { … }` site: add an `else { this.warnUnknownModel(effectiveModel); }` branch.

### D. Tests (`anthropic.test.ts` + `cost.test.ts`)

**Pattern (mandatory).** Two equivalent options — implementer picks one and uses it consistently:

1. **Direct `process.env` mutation with manual save/restore** (the established in-repo pattern — see `plan.test.ts:1313-1389` FORGE_CORRECTOR_MAX_TOKENS test block). Save original via `const ORIGINAL = process.env.FORGE_MODEL; delete process.env.FORGE_MODEL;` in `beforeEach`; restore in `afterEach`. Combined with `vi.resetModules() + await import("./anthropic.js")` for the IIFE re-evaluation.
2. **Vitest `vi.stubEnv` + `vi.unstubAllEnvs`** (no in-repo precedent — divergence justified by cleaner restore semantics; Vitest officially recommends this for env-stubbing). Pair with `vi.resetModules()` + dynamic import as above. Sibling-test contamination guard: `afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); })`.

P1 caught that the previous draft cited `plan.test.ts:1313-1389` as the precedent for `vi.stubEnv` — that block actually uses pattern #1 (direct mutation). Either pattern is correct; pick one.

**Mock-class wiring (mandatory) — P1 catch.** `anthropic.test.ts:24-27` defines `MockAnthropic` with `static AuthenticationError = MockAuthenticationError` so production code's `err instanceof Anthropic.AuthenticationError` resolves correctly against thrown mocks. **Tests for AC-D cases (v) and (vi) MUST extend `MockAnthropic` with `static NotFoundError = MockNotFoundError`** (and define `class MockNotFoundError extends Error {}` similarly). Without this, `err instanceof Anthropic.NotFoundError` returns `false` against test-thrown errors and case (v) silently fails to assert what it claims.

**Suite-scoped beforeEach gotcha (P2 catch).** `anthropic.test.ts:65-87` sets `process.env.ANTHROPIC_API_KEY = "sk-test-key"` in the suite's `beforeEach`. **Case (vi)** (regression-positive on F6 401-retry path) MUST `delete process.env.ANTHROPIC_API_KEY` in its own `beforeEach` to actually exercise the retry path — otherwise the test silently runs with the API-key set and the F6 retry never triggers. Established precedent: `anthropic.test.ts:313, 353, 395` all `delete process.env.ANTHROPIC_API_KEY` for the same reason. Cases (i)-(iv) (α-cases) inherit the suite-scoped API-key default safely — no override needed.

**New cases (8 total — 4 α-cases + 2 A1-cases in `anthropic.test.ts` + 2 cost cases in `cost.test.ts`):**

`anthropic.test.ts`:
- (i) `FORGE_MODEL=claude-3-7-sonnet` → `DEFAULT_MODEL` reflects it; `messages.stream` receives that model.
- (ii) `FORGE_MODEL` unset → `DEFAULT_MODEL = "claude-sonnet-4-6"`.
- (iii) `FORGE_MODEL="   "` (whitespace-only) → trimmed and treated as unset; default applied.
- (iv) per-call override (`callClaude({ model: "claude-opus-4-6" })`) wins over `FORGE_MODEL`.
- (v) **A1: `Anthropic.NotFoundError` thrown by `messages.stream` → re-thrown as Error with model name + docs URL + FORGE_MODEL guidance + restart instruction.** Assert exact substrings.
- (vi) **A1: non-404 errors (`AuthenticationError`, `APIConnectionError`) NOT caught by A1 — they pass through to existing handlers.** Regression-positive on F6's 401-retry logic.

`cost.test.ts`:
- (vii) unknown model → warning emitted exactly once per `CostTracker` instance, `costUsd === null`.
- (viii) `DEFAULT_MODEL` import from `anthropic.ts` is used as the fallback at `cost.ts:90` (test-mock observation; verifies P43 violation fix landed).

## Critical files

- `server/lib/anthropic.ts` (current 414 LOC post-F6; +20-30 LOC for IIFE + A1 catch + JSDoc).
- `server/lib/cost.ts` (current 144 LOC; +1 import, +1 line replacement at :90, +5-10 LOC for warning method + field).
- `server/lib/anthropic.test.ts` (current 614 LOC post-F6; +6 cases — see AC-D).
- `server/lib/cost.test.ts` (current 123 LOC; +2 cases).
- `dist/lib/anthropic.js` + `dist/lib/cost.js` — auto-built.

## Considered alternatives

Architectural choice ratified in Phase 1 (decision plan); 4-0 reviewer verdict. See `.ai-workspace/plans/2026-05-08-forge-model-config-decision.md` §The five candidate options for full comparison. Rejected (with reasons): β (per-stage env vars — premature, no current EASY stage); γ (HARD/EASY tiers — same issue); δ (config file — F66 risk + 12-factor break); ε (config + env hybrid — six-layer resolution).

This Phase-2 plan does NOT re-litigate option choice. Reviewers evaluate implementation correctness only.

## Out of scope for this Phase-2 PR

- Plumbing `model:` through `forge_evaluate`, `forge_generate`, `forge_coordinate`, `forge_reconcile` MCP tool surfaces (deferred — file as enhancement issue if reviewers want).
- Per-stage routing (β shape) — deferred to v0.40.7+; file issue #547 with the plan-time TODO comment in code.
- Recording per-stage model name in run records — separable enhancement (additive field — fits P50). File if demand surfaces.
- `run-record.ts:307-308` rate-drift trap (`SPEC_GEN_INPUT_PER_MILLION` literal duplicate of sonnet PRICING row) — acknowledged in v1 plan §Out-of-scope, drift risk is intentional (avoids circular import); file separate issue if cost-accuracy bug surfaces.

## Cairn references

- **F49 (Dual-Level Enforcement of Same Rule) — ANTI-pattern (refusal-class).** Verified at `02-anti-patterns.md:343`. RISK if `cost.ts:90` keeps a hardcoded `"claude-sonnet-4-6"` separately from `anthropic.ts:DEFAULT_MODEL`. Mitigation (mandatory in this PR): import `DEFAULT_MODEL` so the fallback lives at one source-of-truth.
- **P43 (Single Source of Truth for EC Commands)** — tighter mechanical fit than F49 for the `DEFAULT_MODEL` export-import shape. F49 names the *risk*, P43 names the *mitigation*.
- **P44 (Loud Failure on Parse Errors)** — A1's typed `404 model_not_found` re-throw with operator-actionable guidance is canonical P44.
- **P45 (Warn on Missing Data Defaults — Never Silent $0)** — unknown-model fires `console.error` once per `CostTracker` instance and lets `estimatedCostUsd` stay `null`. Operators distinguish "no PRICING row" from "actual zero."
- **F46 (Silent Numeric Default When Data Missing) — anti-pattern correctly avoided.** This plan keeps `null` as the sentinel + emits the P45 warning, staying on the right side of F46.
- **F54 (Stale MCP Server After dist/ Rebuild)** — module-load IIFE means `FORGE_MODEL` changes require MCP restart. macbook-monday smoke-test mail MUST lead with the restart instruction.
- **F45 (Empty Catch Block) — none.** A1's catch is non-empty (re-throws with guidance).
- **F66 (Hybrid-First Design Reflex) — anti-pattern correctly avoided.** α is single-locus (one env var, one resolver, one in-code fallback) — no hybrid.
- **F6 v0.40.5 precedent.** `KEYCHAIN_SERVICE_NAME` exported from `anthropic.ts:26`, imported by `spec-generator.ts`. Same export-import shape used here for `DEFAULT_MODEL`.
- **Tier-b card to write at ship time:** `2026-05-08-forge-model-alpha-a1-shipped.md` under `tier-b/topics/forge-harness/` — placed via `memory write`.

## Notes for implementer (originally for reviewer chain — most resolved at plan-time)

The four-reviewer chain on this plan was a LIGHT pass — architectural choice ratified by Phase-1 4-0 verdict. Reviewers focused on implementation correctness; their findings are folded into §What and §Binary AC. The notes below remain as **implementer-facing** guidance:

1. ~~**A1 SDK probe.**~~ **RESOLVED at plan-time (P1):** `Anthropic.NotFoundError` is exposed in SDK 0.82.0 at `node_modules/@anthropic-ai/sdk/index.d.ts:6` (typed class re-export from `core/error.d.ts:40` as `export declare class NotFoundError extends APIError<404, Headers> {}`) AND as a static on the default Anthropic class at `client.d.ts:202`. Implementer can use `err instanceof Anthropic.NotFoundError` directly. Caveat: do NOT confuse with `BetaNotFoundError` (interface) or `shared.NotFoundError` (interface) — use the class form via `Anthropic.NotFoundError` (default namespace static).
2. ~~**Test pattern coherence.**~~ **RESOLVED at plan-time (P1):** §D offers two equivalent patterns — direct `process.env` mutation (precedent at `plan.test.ts:1313-1389`) or `vi.stubEnv` (no in-repo precedent but cleaner restore). Implementer picks one and uses it consistently.
3. **No new third hardcode locus.** Implementer must `grep -n '"claude-sonnet-4-6"' server/lib/` after wiring; expected: matches ONLY in `anthropic.ts` (JSDoc + IIFE fallback) and `cost.ts:11` (PRICING table KEY — legitimate, exempt). Zero matches in `cost.ts:90`'s default-fallback site. Verify before commit.
4. **A1 error-message coherence.** No `forge.config.json` reference (would mislead operators under α). Lead with "set FORGE_MODEL." Restart-MCP instruction included. Match the existing voice at `anthropic.ts:179-184` (no-creds error) and `executor.ts:80-95` (no-bash error) — concrete instructions + URL pointer + reason for failure.
5. **F6 401-retry regression-positive.** A1's catch is for `NotFoundError`; F6's `AuthenticationError` retry must continue to work. AC-D case (vi) tests this; per P2's catch, the test MUST `delete process.env.ANTHROPIC_API_KEY` (suite-scoped beforeEach sets it; established precedent at `anthropic.test.ts:313,353,395`).
6. **`cost.ts:90` literal must be GONE.** Phase-2 AC verifies via grep (AC-G). If implementer leaves it, that's a P43 violation re-introduced.
7. **A1 throw is terminal (P2 catch).** Inside the `catch` block, A1's `throw new Error(...)` exits `callClaude` entirely. F6's `isAuthError` block runs ONLY in the non-NotFoundError path. Don't add `return` or fall-through — the throw IS the exit. See §B for the full code shape.

## Binary AC

- **AC-A (FORGE_MODEL respected).** With `FORGE_MODEL=claude-3-7-sonnet`, `DEFAULT_MODEL` (read after `vi.resetModules`) equals `"claude-3-7-sonnet"`. `callClaude({ system, messages })` sends that model to the SDK. Test-mock observation.
- **AC-B (default unchanged when unset).** With `FORGE_MODEL` unset, `DEFAULT_MODEL = "claude-sonnet-4-6"`. Existing 1060 tests pass without modification.
- **AC-C (per-call override wins).** `callClaude({ system, messages, model: "claude-opus-4-6" })` overrides `FORGE_MODEL` regardless. Test-mock observation.
- **AC-D (test coverage).** 8 new cases (6 in `anthropic.test.ts`, 2 in `cost.test.ts`) all PASS. Patterns: `Object.defineProperty` for platform mocking (n/a here — no platform check; this is env-only); `vi.stubEnv` + `vi.resetModules` + `afterEach(unstubAllEnvs+resetModules)`.
- **AC-E (build clean).** `npm run build` exits 0.
- **AC-F (existing tests unchanged).** All 1060 existing tests pass without modification.
- **AC-G (P43 violation killed).** Post-implementation, `cost.ts` has ZERO `"claude-sonnet-4-6"` literal as a default-model fallback (currently lives at `cost.ts:90` — the target to kill). PRICING table KEYS at `cost.ts:11` are EXEMPT — those are pricing-row identifiers, not default-model fallbacks. Refined verification: `grep -n '"claude-sonnet-4-6"' server/lib/cost.ts | grep -v 'PRICING\|inputPerMillion'` returns zero matches. The `anthropic.ts:7` literal survives in the IIFE fallback (intentional). P1 catch — earlier framing didn't carve out the legitimate PRICING-table exemption.
- **AC-H (A1 fires correctly).** Mocked `Anthropic.NotFoundError` thrown by `messages.stream` → `callClaude` re-throws with `Error.message` containing: (i) model name verbatim, (ii) `https://docs.anthropic.com/en/docs/about-claude/models`, (iii) `FORGE_MODEL`, (iv) `Restart the MCP child`. Substring assertions in test.
- **AC-I (A1 doesn't catch non-404).** `Anthropic.AuthenticationError` thrown → A1 doesn't intercept; F6's existing 401-retry logic runs. Regression-positive.
- **AC-J (PR shipped).** PR for α+A1 merged to master; tag `v0.40.6` published with GitHub Release; CHANGELOG updated. **Cadence note (P2 raised):** Phase-2 ships more user-visible behavior than F6 (new env var, new error message, new console warning) — gating tag-and-release on macbook-monday smoke would lower release-defect risk. **Operator decision:** ship-then-mail-then-smoke cadence retained per explicit instruction (2026-05-08T1610Z); fix-forward in v0.40.7 is the recovery path if smoke surfaces a regression. Tests + light reviewer chain catch most regressions; the residual risk is "behavior macbook-monday observes that we couldn't predict at plan-time," which fix-forward handles cleanly.
- **AC-K (operator-runnable smoke).** macbook-monday can run `FORGE_MODEL=claude-3-7-sonnet forge_evaluate('US-13')` and observe (a) the run completes, (b) the run record's `estimatedCostUsd` is null, (c) console warning fires once with: `forge: model "claude-3-7-sonnet" is not in the cost-tracking PRICING table (known: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5). Estimates will be null for this run; calls still proceed.`

## Revision log

- **2026-05-08T1605Z** — initial draft. Phase-2 implementation plan for α + A1. Architectural choice ratified by Phase-1 4-0 reviewer verdict + operator confirmation. All Phase-1 reviewer concerns folded into AC: cost.ts:90 P43 fix (AC-G); A1 error-message scrub of `forge.config.json` reference; F54 IIFE-restart caveat; SDK NotFoundError probe (note 1); F6 401-retry regression-positive (AC-I); whitespace-trim divergence documented; F49 reclassified to ANTI-pattern; P32 5-7-knob threshold removed (extrapolation). Author: forge-plan.
- **2026-05-08T1620Z** — P1 light-pass review applied. VERDICT: iterate (6 edits). Changes: (1) **A1 SDK probe DONE in plan-time** — `Anthropic.NotFoundError` confirmed at SDK 0.82.0 `index.d.ts:6` (typed class, not interface); implementer can skip re-probing; (2) §B locus corrected — F6 401-retry block is at `anthropic.ts:366-376` (not `:289-300` as draft said; that range is inside `extractJson`); (3) §B ordering note added — A1 (404) and F6 (401) are type-disjoint subclasses of `APIError`; ordering is safe either way, A1 first chosen for read-clarity; (4) §D test pattern: TWO equivalent options offered (direct `process.env` mutation matching `plan.test.ts:1313-1389` precedent, OR `vi.stubEnv`/`vi.unstubAllEnvs` with no in-repo precedent but cleaner restore semantics); P1 caught that the draft falsely cited `plan.test.ts:1313-1389` as `vi.stubEnv` precedent (that block uses direct mutation); (5) §D mock-class wiring mandate added — tests must extend `MockAnthropic` with `static NotFoundError = MockNotFoundError` (mirrors F6's `AuthenticationError` pattern at `anthropic.test.ts:24-27`); without it `err instanceof Anthropic.NotFoundError` resolves false and AC-D cases (v)/(vi) silently fail; (6) AC-G grep refined — PRICING table KEYS at `cost.ts:11` are exempt (legitimate pricing-row identifiers, not default-model fallbacks); grep scoped accordingly. AC-D framing reworded: "4 α + 2 A1 + 2 cost" instead of "6 from v1 + 2 for A1." Author: forge-plan (applying P1 edits).
- **2026-05-08T1635Z** — P2 light-pass review applied. VERDICT: iterate (4 edits). Comparative-axis catches: (1) JSDoc tone — added "α (v0.40.6) — operator-overridable default model for callClaude." version-tag header to mirror F6's "F6 (v0.40.5) — …" opener at `anthropic.ts:9`; future readers grep version tags for context. (2) §B A1 terminal-throw semantics now explicit — implementer cannot accidentally add fall-through; F6's `isAuthError` block runs ONLY in non-NotFoundError path. (3) §D suite-scoped beforeEach gotcha — case (vi) MUST `delete process.env.ANTHROPIC_API_KEY` to exercise F6 retry path; established precedent at `anthropic.test.ts:313,353,395`. (4) AC-J cadence note — operator chose ship-then-mail-then-smoke; fix-forward to v0.40.7 is the recovery path if smoke surfaces unforeseen behavior. P2 verified zero circular-import risk between `anthropic.ts` and `cost.ts`. Author: forge-plan (applying P2 edits).
- **2026-05-08T1655Z** — P3 light-pass cairn-grounded review complete. **VERDICT: ship-it (zero required edits).** All 8 cairn citations audited against canonical KB phrasing — F49, P43, P44, P45, F46, F54, F45, F66 ALL CORRECT. Findings: (1) F49 vs P43 framing internally coherent (F49 names risk, P43 names mitigation); (2) A1 catch is safe against typo accidents — TypeScript catches `Anthropic.NotFoundEror` at compile time; F45 doesn't apply (catch is non-empty, re-throws loudly); (3) A1 error-message voice matches forge convention (numbered-list / URL pointer / "Set FORGE_*" — consistent with `anthropic.ts:183-187` no-creds and `executor.ts:86-92` no-bash); (4) IIFE precedent confirmed at `plan.ts:336-348`; (5) test-pollution risk bounded by `resetClient()` in beforeEach + new `vi.resetModules()`; (6) F33 (Ambiguous File Locations) avoided — every locus pinned to file:line; (7) tier-b precedent `2026-05-08-v0404-shipped-i8-i6-merged-i7-deferred.md` supports F54-restart messaging — plan §Stage 8 follows the established mail pattern; (8) zero KB hand-edit violations. Optional non-blocking suggestions: cite P56 (Research-First Delegation) crediting the SDK-probe work and F33 (Ambiguous File Locations) crediting the file:line discipline — left out of cairn-references to keep the section tight. Author: forge-plan (recording P3 verdict; no edits to apply).
- **2026-05-08T1710Z** — P4 mechanical-sweep complete. VERDICT: iterate (4 micro-edits — all cosmetic, no architectural problems). Changes: (1) §Execution model Stage 5: "~7 cases" → "8 total — 4 α + 2 A1 + 2 cost" matching §D + AC-D; (2) §Critical files: refreshed stale LOC counts (anthropic.ts 338→414 post-F6; anthropic.test.ts 441→614 post-F6; cost.ts ~200→144; cost.test.ts added 123); (3) §ELI5: glossed "(F54 trap)" inline so cold readers don't hit unexplained jargon; (4) §Notes-for-reviewer-chain renamed to §Notes-for-implementer with notes 1+2 marked RESOLVED at plan-time (no need for a fifth reviewer to redo SDK probe + test-pattern verification). All 8 ACs verifiability-clean. No internal contradictions. No reviewer-edit collision. No new pattern miscitations. **Final 4-round verdict: ship-it.** Author: forge-plan (applying P4 edits).
