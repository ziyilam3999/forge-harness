---
task: v0.32.6 — fix forge_plan corrector JSON parse crash (max_tokens truncation + silent swallow)
status: drafting
owner: forge-plan
created: 2026-04-19
supersedes: none
---

## ELI5

When forge_plan reviews a big plan, it asks Claude to rewrite it with the critic's fixes. Claude can only send back about 27KB of text before it gets cut off. When that happens, forge-harness sees the half-written text, fails to parse it, catches the error quietly, and returns the ORIGINAL un-reviewed plan while claiming "success". The user has no idea the review was thrown away.

Monday hit this trying to plan monday-bot. Her critic flagged 45 issues (35 critical) — 38 of the resulting ACs use a broken `| tail && echo PASS` pattern that always exits 0. None got fixed because the corrector silently crashed.

**Three fixes, in layers:**

1. **Raise the ceiling.** Give the corrector a bigger output budget (32000 tokens ≈ 105KB). Fixes the immediate case.
2. **Detect cut-offs.** When Claude's response is cut off by the token limit, throw a loud error instead of returning truncated text that later fails to parse. Prevents future silent truncations in any LLM call, not just the corrector.
3. **Stop the lie.** When the corrector fails (for ANY reason — truncation, parse error, validation rejection), the RunRecord's `outcome` must be `"corrector-failed"`, not `"success"`. The caller sees the crash.

## Context

**Reporter:** monday, via mailbox thread `forge-harness-monday-bot-support`, 2026-04-19T15:27Z. Priority: blocker. Full triage card: `~/.claude/agent-working-memory/tier-b/topics/monday-bot/forge-plan-corrector-crash-blocker-2026-04-19.md` (to be written post-ship).

**Root cause verified on-disk (Rule #9):**

- `server/lib/anthropic.ts:7` — `const DEFAULT_MAX_TOKENS = 8192;`
- `server/lib/anthropic.ts:154` — `max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS` — uses the default when callers don't override.
- `server/tools/plan.ts:327` — `runCorrector` passes `{system, messages, model, jsonMode}` to `trackedCallClaude` with no `maxTokens`. So the corrector output is capped at 8192 tokens ≈ ~27KB JSON. Monday's crash at character position 26918 confirms truncation boundary.
- `server/lib/anthropic.ts:149-179` — `callClaude` never inspects `response.stop_reason`. A `stop_reason: "max_tokens"` response flows through as a normal completion with truncated text. Downstream `extractJson()` then throws `"Expected ',' or ']' after array element"`.
- `server/tools/plan.ts:349-355` — `runCorrector` catch block swallows the parse error, logs to stderr, returns `{ plan, dispositions: [] }` (the pre-correction plan + empty dispositions). Caller counts `findingsApplied = 0` and `findingsRejected = findingsTotal`, then the top-level run record sets `outcome: "success"` at line 708 — the lie.

**Why it matters beyond monday's case:** every `forge_plan` run on a large plan hits this silently. Users whose plan has < ~8K-token critic output see it succeed honestly; users above that threshold get a silently-uncorrected plan that looks corrected. Since the corrector is the quality gate, downstream `forge_generate` and `forge_evaluate` inherit whatever AC shape the critic flagged but the corrector never fixed.

**Compounding class-of-bug evidence:** this is a form of F7/F13 from hive-mind knowledge-base (silent-success anti-patterns). Fix must not just patch the single site — it must make the class loud.

## Goal

When `./forge_plan()` completes on a PRD that triggers corrector truncation, the following must all hold:

1. The corrector output budget is large enough that a typical full-plan revision fits (~32K tokens ≈ 105KB JSON).
2. Any LLM call whose response is truncated by the token limit throws a typed error rather than returning truncated text.
3. Whenever the corrector path returns the pre-correction plan (for ANY reason — truncation, parse error, validation rejection), the top-level RunRecord's `outcome` is `"corrector-failed"`, NOT `"success"`.
4. Backwards-compatible: existing small-plan runs (where the corrector succeeds) continue to report `outcome: "success"` with `findingsApplied > 0` when findings are applied.

## Binary AC

All ACs verified by `scripts/corrector-crash-fix-acceptance.sh` (plan-mandated wrapper). Wrapper drives in-process unit tests; no LLM calls required (mock the Anthropic SDK). Each AC is a single command with pass/fail observable outside the diff.

- **AC-1** — `grep -n "maxTokens: 32000" server/tools/plan.ts | wc -l` returns `≥ 2`. (Two corrector call sites — `runCorrector` line 327 and `runMasterCorrector` line 466 — both pass the override.)
- **AC-2** — `grep -n "LLMOutputTruncatedError\|stop_reason.*max_tokens" server/lib/anthropic.ts | wc -l` returns `≥ 2`. (The detection site plus the class/export.)
- **AC-3** — `grep -c '"corrector-failed"' server/lib/run-record.ts` returns `≥ 1`. (The outcome union literal includes the new variant.)
- **AC-4** — **Truncation unit test:** `npx vitest run server/lib/anthropic.test.ts -t "truncation"` exits 0 AND stdout contains `PASS` AND the test asserts that a mocked response with `stop_reason: "max_tokens"` causes `callClaude` to throw `LLMOutputTruncatedError`.
- **AC-5** — **Corrector-failed-status unit test:** `npx vitest run server/tools/plan.test.ts -t "corrector-failed"` exits 0. Test sets up `runCorrector` against a mocked `callClaude` that throws, and asserts the returned record has `outcome: "corrector-failed"`.
- **AC-6** — **Regression-positive unit test:** `npx vitest run server/tools/plan.test.ts -t "corrector success still reports outcome success"` exits 0. Test confirms a passing corrector path still yields `outcome: "success"` with non-zero `findingsApplied`.
- **AC-7** — `npx vitest run` full-suite exits 0. No pre-existing tests regress.
- **AC-8** — `npm run build` exits 0. TypeScript compiles.
- **AC-9** — `scripts/corrector-crash-fix-acceptance.sh` exists, is executable, and exits 0 when AC-1..AC-8 all pass.
- **AC-10** — `diff origin/master -- setup.sh package.json` on non-version-related lines — `setup.sh` untouched; `package.json` only the version bump 0.32.5 → 0.32.6 (done by `/ship` Stage 7).

## Out of scope

- **AC-pattern lint for vacuous bash pipelines** (monday's defense-in-depth #4). Separate concern; file as GH issue post-ship. Would catch the `| tail -20 && echo PASS` class of vacuous-AC bug in `ac-lint-hook.sh` at plan-write time. Belongs in `server/validation/ac-lint.ts`, not in this PR.
- **Corrector retry on parse failure.** Monday's fix direction #3. Orthogonal to the truncation fix. File as follow-up issue.
- **Raising max_tokens for planner/critic calls** — only corrector is producing large JSON today; planner output is bounded by plan schema, critic by findings list size. If we discover those also truncate, separate PR.
- **Auto-cleaning stale bad plans** in monday-bot or elsewhere. Post-ship migration; not a code change to forge-harness.
- **Anthropic SDK version bump.** Current `@anthropic-ai/sdk` already surfaces `stop_reason` on the response object (confirmed during investigation). No upgrade needed.

## Ordering constraints

- AC-2 must land before AC-4: the test asserts behavior that doesn't exist until the code is in place.
- AC-3 must land before AC-5: same reason.
- AC-9 is last — the wrapper depends on AC-1..AC-8 passing.

## Verification procedure

Reviewer runs from repo root on PR branch checked out over master:

```bash
# 1. Install + build.
npm ci --ignore-scripts
npm run build

# 2. Wrapper must be executable.
test -x scripts/corrector-crash-fix-acceptance.sh || chmod +x scripts/corrector-crash-fix-acceptance.sh

# 3. Run the wrapper. Must exit 0 and print a PASS summary.
bash scripts/corrector-crash-fix-acceptance.sh

# 4. Spot-check that setup.sh is untouched (AC-10 first half).
git diff origin/master -- setup.sh
# Expected: empty.

# 5. Spot-check package.json changed only version.
git diff origin/master -- package.json | grep '^[+-]' | grep -v '^[+-]\{3\}' | grep -v 'version'
# Expected: empty (only the version line changed).

# 6. Optional manual end-to-end: reviewer with `claude` CLI may run forge_plan against
#    a >30KB PRD. Skip unless reviewer wants to exercise the real LLM path. AC-1..AC-9
#    passing in unit tests already proves correctness.
```

## Critical files

- `server/lib/anthropic.ts` — add `LLMOutputTruncatedError` class; inspect `response.stop_reason` in `callClaude`; throw when `"max_tokens"`. No change to the auth chain (rules #8/#9 — don't touch what isn't relevant).
- `server/tools/plan.ts` — `runCorrector` (line 316) and `runMasterCorrector` (line 455) each pass `maxTokens: 32000` to `trackedCallClaude`. `runCorrector` return type widens to include a discriminator `correctorStatus: "applied" | "failed"`. `writeRunRecordIfNeeded` (line 673) accepts a new param `correctorFailed: boolean` and sets `outcome: "corrector-failed"` when true.
- `server/lib/run-record.ts` — add `"corrector-failed"` to the `outcome` union (line 60).
- `server/lib/anthropic.test.ts` — new test: mock a response with `stop_reason: "max_tokens"`, assert `callClaude` throws `LLMOutputTruncatedError`.
- `server/tools/plan.test.ts` — two new tests: (a) corrector-failed path yields `outcome: "corrector-failed"`, (b) corrector-success path still yields `outcome: "success"` (regression positive).
- `scripts/corrector-crash-fix-acceptance.sh` — new plan-mandated wrapper. Runs AC-1..AC-8 in order; exits 0 iff all green.
- `package.json` — version 0.32.5 → 0.32.6 (done by `/ship` Stage 7, not manually).
- `CHANGELOG.md` — new `### Bug Fixes` entry (done by `/ship` Stage 7).
- `~/.claude/agent-working-memory/tier-b/topics/monday-bot/forge-plan-corrector-crash-blocker-2026-04-19.md` — triage card, written post-ship.

## Checkpoint

- [x] Plan drafted
- [x] Root cause verified on-disk via Rule #9
- [x] ACK mail sent to monday within 600s SLA
- [ ] `server/lib/run-record.ts` — widen outcome union
- [ ] `server/lib/anthropic.ts` — add LLMOutputTruncatedError + stop_reason check
- [ ] `server/tools/plan.ts` — maxTokens override on corrector + correctorStatus propagation
- [ ] `server/lib/anthropic.test.ts` — truncation unit test
- [ ] `server/tools/plan.test.ts` — corrector-failed + regression-positive unit tests
- [ ] `scripts/corrector-crash-fix-acceptance.sh` — wrapper
- [ ] Full test suite green locally
- [ ] `npm run build` green locally
- [ ] GH issue filed for the bug (for `Fixes #<n>`)
- [ ] `/ship` pipeline — PR opened, CI green, stateless review pass, merged, v0.32.6 tagged + released
- [ ] Monday mailed with tag + "just restart Claude Code to pick up the fix"
- [ ] Tier-b card written

Last updated: 2026-04-19T15:35:00Z — plan drafted; implementation next.
