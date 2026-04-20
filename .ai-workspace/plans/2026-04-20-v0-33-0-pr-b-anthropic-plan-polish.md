# v0.33.0 PR B — anthropic + plan polish (6 issues)

Slice B of the v0.33.0 polish bundle. Retires GitHub issues #314, #316, #317, #318, #329, #330.

## ELI5

Clean up six small things in the LLM-call helper and the plan corrector:
1. Make the "LLM was cut off" check harder to silently break if Anthropic adds a new reason-code (#314).
2. Drop a redundant "check the error message text" line from a test — the structured fields already cover it (#316).
3. Let operators raise the corrector token budget via an env var without recompiling (#317).
4. Hoist a test-scope guard into a suite-wide guard so every test proves the non-streaming path stays dead (#318).
5. Surface cache-hit/creation token counts that the SDK already returns but we were throwing away (#329).
6. Merge a dangling JSDoc comment back onto the function it was meant to describe (#330).

No new behavior, no API breaking change, no dependency bump. Pure cleanup of the cost/type/test surfaces touched by v0.32.6–v0.32.8.

## Context

v0.32.6 → v0.32.8 shipped three monday-bot blockers in five days:
- v0.32.6 raised corrector `max_tokens` 8192 → 32000 after monday-bot's plan truncated mid-string.
- v0.32.7 swept that bump to every `callClaude` site.
- v0.32.8 flipped `callClaude` unconditionally to `messages.stream(...).finalMessage()` because 32000 tokens tipped the predicted runtime over the 10-minute non-streaming ceiling.

Each of those three ship-reviews surfaced nits that were triaged to issues rather than folded in-flight (correctly — ship-review's scope was the bug fix, not the surrounding tidy-up). This PR is that deferred follow-up batch.

**Why now:** these issues sit on the `callClaude` and `runCorrector` seams, which are about to see more pressure:
- monday-bot's next forge_plan invocation will stress the same paths and is the first real external user of `callClaude`.
- Future cost/usage telemetry work (queued in the v0.34.x triage backlog) will extend the reconcile loop's pricing surface; widening `CallClaudeResult.usage` now (#329) lets that work inherit the richer shape.
- Every non-polished assertion is one copy-paste away from becoming the idiom for future tests.

**Non-goals:** this PR does not touch the OAuth/API-key auth branch, the `extractJson` helper, the planner/critic/corrector prompts, or any pricing logic. Those live in adjacent files and belong to different slices.

## Goal

When PR B merges, the following invariants hold:

1. `CallClaudeResult.usage` exposes `cacheCreationInputTokens` and `cacheReadInputTokens` as optional numeric fields, populated from `response.usage` when the SDK returns them. Existing fields (`inputTokens`, `outputTokens`) are unchanged.
2. The truncation check in `callClaude` uses a typed stop-reason comparison that surfaces a TypeScript compile error if the SDK's `stop_reason` union gains a new variant and the new variant is not handled. Runtime behavior for the existing `"max_tokens"` path is unchanged.
3. `CORRECTOR_MAX_TOKENS` in `server/tools/plan.ts` is exported, and its value falls back to `32000` unless `process.env.FORGE_CORRECTOR_MAX_TOKENS` is set to a positive integer.
4. `anthropic.test.ts` hoists `expect(mockCreate).not.toHaveBeenCalled()` into a suite-scoped `afterEach`, so the "never falls back to non-streaming" guarantee applies to every test case in the file, not just the one that asserts it today.
5. `anthropic.test.ts` truncation assertion relies only on the structured `maxTokensLimit` / `outputChars` fields; the two `err.message.toContain(...)` lines are removed.
6. The orphaned JSDoc block above `CORRECTOR_MAX_TOKENS` in `plan.ts` is consolidated so that every JSDoc block sits directly above the declaration it documents. No function or constant is left with a dangling comment.

## Binary AC

Reviewer runs each command; exit code 0 = pass. All commands runnable from repo root against the merged branch.

1. **AC-B1 (exports — #329 regression guard, source-based):**
   `grep -E '^export async function callClaude\(' server/lib/anthropic.ts` returns a non-empty match — `callClaude` is still exported as an async function. Source-based (not dist-based) so AC-B1 does not implicitly depend on the build step.
2. **AC-B2 (types — #329 usage shape, observable via TS):**
   `npx tsc --noEmit -p tsconfig.json` exits 0. A follow-on grep proves the widening landed: `grep -c 'cacheCreationInputTokens\|cacheReadInputTokens' server/lib/anthropic.ts` returns ≥ 3 (the type field, the test, the extraction).
3. **AC-B3 (stop_reason — #314 compile-time guard):**
   `grep -E "stop_reason.*=== ['\"]max_tokens['\"]" server/lib/anthropic.ts` returns **0** matches — the bare string literal comparison must be gone, replaced by a typed narrowing.
4. **AC-B4 (corrector env override — #317 observable via test):**
   `npx vitest run -t 'CORRECTOR_MAX_TOKENS'` exits 0 and reports ≥ 1 passing test. The new test asserts (a) the default 32000 when env is unset and (b) the override when `FORGE_CORRECTOR_MAX_TOKENS=12345`.
5. **AC-B5 (corrector export — #317 structural):**
   `grep -c '^export const CORRECTOR_MAX_TOKENS' server/tools/plan.ts` returns 1.
6. **AC-B6 (test tripwire — #318 suite-scoped):**
   `node -e "const s=require('fs').readFileSync('server/lib/anthropic.test.ts','utf8'); const blocks=s.match(/afterEach\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*\)/g)||[]; process.exit(blocks.some(b=>/mockCreate[\s\S]*not[\s\S]*toHaveBeenCalled/.test(b))?0:1)"` exits 0 — at least one `afterEach` block body contains the `mockCreate` not-called assertion. Multi-line safe; would pass on both inline-arrow and block-body afterEach styles.
7. **AC-B7 (test simplification — #316):**
   `grep -cE 'err\.message[^)]*\)\.toContain' server/lib/anthropic.test.ts` returns 0. (Baseline on master: 2 — source is `expect(err.message).toContain(...)`; the `)` between `message` and `.toContain` requires the `[^)]*\)` bridge in the pattern. A naive `err.message.toContain` grep with unescaped dots and single-char `.` wildcards returns 0 on master and would silently false-PASS the AC — caught by /delegate's baseline check on 2026-04-20.)
8. **AC-B8 (JSDoc consolidation — #330):**
   `node -e "const s=require('fs').readFileSync('server/tools/plan.ts','utf8'); const block=s.match(/\\/\\*\\*[\\s\\S]*?Run a corrector agent[\\s\\S]*?\\*\\//); if(!block) process.exit(0); const idx=s.indexOf(block[0]); const after=s.slice(idx+block[0].length, idx+block[0].length+100); process.exit(/^\\s*(export\\s+)?(async\\s+)?(function|const)/.test(after)?0:1)"` exits 0 — if the "Run a corrector agent" JSDoc still exists, the first non-whitespace token after it is a declaration keyword (not a separate JSDoc).
9. **AC-B9 (test suite regression — focused):**
   `npx vitest run server/lib/anthropic.test.ts` exits 0 with 0 failing and 0 skipped tests. All pre-existing transport / truncation / max_tokens cases continue to pass. The new CORRECTOR_MAX_TOKENS test has its own observable check in AC-B4; the executor picks where to colocate it (inside `anthropic.test.ts`, a new `server/tools/plan.test.ts`, or an existing plan test file) — AC-B4 verifies it by name regardless of file.
10. **AC-B10 (full test suite):**
    `npm test` exits 0.
11. **AC-B11 (build):**
    `npm run build` exits 0 and produces `dist/lib/anthropic.js`, `dist/tools/plan.js`.
12. **AC-B12 (no drive-by edits — allowlist):**
    `git diff master...HEAD --name-only` returns a subset of `{server/lib/anthropic.ts, server/lib/anthropic.test.ts, server/tools/plan.ts, server/tools/plan.test.ts, server/tools/reconcile.test.ts, .ai-workspace/plans/2026-04-20-v0-33-0-pr-b-anthropic-plan-polish.md, scripts/pr-b-acceptance.sh, package.json, CHANGELOG.md}`. Notes: `server/tools/plan.test.ts` is in the allowlist regardless of whether it pre-exists — the executor may create it for AC-B4's test home. `server/tools/reconcile.test.ts` was added by amendment 2026-04-20 so the executor can remove the stale AC8 guard (see AC-B13).

13. **AC-B13 (stale reconcile AC8 guard removed — plan amendment 2026-04-20):**
    `node -e "const s=require('fs').readFileSync('server/tools/reconcile.test.ts','utf8'); const has=/AC8:\s*(plan\.ts not modified|git diff master\.\.HEAD -- server\/tools\/plan\.ts is empty)/.test(s); process.exit(has?1:0)"` exits 0 — both the `describe(\"handleReconcile — plan.ts untouched\", ...)` block and its single `it(\"AC8: ...\")` case are removed entirely (not renamed or skipped). Rationale: AC8 was a one-time PR-scope guard from PR #164 verifying that that PR did not directly edit plan.ts; it has no perpetual architectural value, and it deterministically fails on any future branch that legitimately edits plan.ts (e.g., PR B for #317 + #330). `AC9: handlePlan called with documentTier:"update"` is the proper perpetual invariant for the reconcile→plan contract and is retained unchanged.

## Out of scope

- Changing the `callClaude` signature (input shape) — only the return-shape's `usage` field widens.
- Changing the `DEFAULT_MAX_TOKENS` value (32000 stays).
- Changing the OAuth / API-key auth branch, `getClient()`, or `resetClient()`.
- Adding pricing logic for cache tokens (that lives in `server/lib/cost.ts`, belongs to a v0.34.x slice).
- Touching the planner/critic/corrector prompt constants.
- Widening `CallClaudeOptions` or adding new call sites.
- Fixing or refactoring `extractJson` (not a PR B surface).
- Any changes to monday-bot or monday-bot's plan files.
- Changing how `tsconfig.json` or `vitest.config.ts` resolve files.
- **Any test in `server/tools/reconcile.test.ts` other than the stale AC8 guard.** AC1–AC7 and AC9 are untouched — PR B only removes the AC8 `describe`+`it` pair that was a one-time PR-scope check left lingering (see AC-B13).

## Ordering constraints

None — the 6 issues are independent. The executor may pick any internal order; AC-B9 and AC-B10 only pass when all six land.

## Verification procedure

```bash
# 1. Build
npm run build

# 2. Fast focused tests
npx vitest run server/lib/anthropic.test.ts server/tools/plan.test.ts

# 3. Full suite
npm test

# 4. Structural checks
grep -c 'cacheCreationInputTokens\|cacheReadInputTokens' server/lib/anthropic.ts   # ≥ 3
grep -E "stop_reason.*=== ['\"]max_tokens['\"]" server/lib/anthropic.ts            # 0 lines
grep -c '^export const CORRECTOR_MAX_TOKENS' server/tools/plan.ts                  # 1
grep -cE 'err\.message[^)]*\)\.toContain' server/lib/anthropic.test.ts             # 0 (post-fix); 2 on master
grep -E "afterEach[\s\S]*mockCreate[\s\S]*not[\s\S]*toHaveBeenCalled" server/lib/anthropic.test.ts  # matches

# 5. Env-override test — test self-manages process.env via vi.resetModules()
#    (no shell-level env prefix needed; the test sets/unsets the var internally)
npx vitest run -t 'CORRECTOR_MAX_TOKENS'

# 6. Diff allowlist
git diff master...HEAD --name-only

# 7. AC-B13: stale AC8 guard removed
node -e "const s=require('fs').readFileSync('server/tools/reconcile.test.ts','utf8'); process.exit(/AC8:\s*(plan\.ts not modified|git diff master\.\.HEAD -- server\/tools\/plan\.ts is empty)/.test(s)?1:0)"
```

## Critical files

- `server/lib/anthropic.ts` — callClaude, CallClaudeResult, LLMOutputTruncatedError. Target for #314 (typed stop_reason) and #329 (usage widening).
- `server/lib/anthropic.test.ts` — streaming transport + truncation + max_tokens tests. Target for #316 (drop message substring), #318 (afterEach tripwire).
- `server/tools/plan.ts` — `CORRECTOR_MAX_TOKENS` constant + `runCorrector`. Target for #317 (export + env override) and #330 (JSDoc consolidation).
- `server/tools/reconcile.test.ts` — delete the stale AC8 one-time PR-scope guard at approximately lines 323–339 (`describe("handleReconcile — plan.ts untouched", ...)` block + its single `it("AC8: ...")`). Do not touch AC1–AC7 or AC9.
- `scripts/pr-b-acceptance.sh` — plan-mandated acceptance wrapper; must run every AC in order and exit 0 iff all pass.
- `package.json` — version bump in the release stage only (not by the executor).
- `CHANGELOG.md` — release entry in the release stage only.

## Checkpoint

- [ ] Plan file saved and critiqued via /coherent-plan
- [ ] Branch created
- [ ] #329 — CallClaudeResult.usage widened, optional cache fields populated when SDK returns them
- [ ] #314 — stop_reason check typed so new SDK variants break at compile time
- [ ] #317 — CORRECTOR_MAX_TOKENS exported; FORGE_CORRECTOR_MAX_TOKENS env override respected
- [ ] #316 — redundant `err.message.toContain(...)` assertions removed
- [ ] #318 — `afterEach` tripwire added asserting `mockCreate` was never called
- [ ] #330 — orphaned JSDoc consolidated; no dangling comment blocks
- [ ] AC-B13 — stale reconcile AC8 guard removed (plan amendment 2026-04-20; unblocks AC-B10)
- [ ] `scripts/pr-b-acceptance.sh` written and green
- [ ] Full `npm test` green
- [ ] PR created, CI green, stateless review passes
- [ ] Merged via /ship; 6 issues auto-closed by "fixes" trailer
- [ ] v0.33.0 still pending (bundle release is after PR D)

Last updated: 2026-04-20 — amended mid-execution after AC-B10 blocker: stale `reconcile.test.ts` AC8 guard from PR #164 trips on any branch legitimately editing plan.ts. Added AC-B13 to remove it, widened AC-B12 allowlist, updated Out of scope + Critical files + Verification procedure to match. Executor applies this amendment as a `docs(plan):` commit on the feature branch per CLAUDE.md's mid-flight-amendment rule.
