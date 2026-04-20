---
task: v0.32.7 — bump DEFAULT_MAX_TOKENS 8192→32000 (sweep)
status: in-flight
owner: forge-plan
created: 2026-04-20
supersedes: none
---

## ELI5

When Claude sends back a response, forge-harness tells it "stop after N words". v0.32.6 raised N to 32000 only for the corrector (one call site). Monday hit the same wall a few hours later on the PLANNER — another call site — which was still at the old 8192 ceiling (~27KB of JSON). She got a clean `LLMOutputTruncatedError` instead of silent corruption (that part of v0.32.6 worked), but the plan never got drafted.

Instead of repeating the override at 10 different call sites and hoping we don't miss any future ones, raise the default itself. Single-line change, one place to audit, covers all current and future callers.

## Context

Monday blocker #3, mailbox thread `forge-harness-monday-bot-support`, 2026-04-20T03:05Z. Re-invoked `forge_plan` on the same 242-line PRD from blocker #2 after v0.32.6 shipped. Got:

```
LLMOutputTruncatedError: LLM output truncated: stop_reason=max_tokens hit at
limit 8192. Received 27108 chars before cutoff.
```

`agentRole: planner`, not `corrector` — the planner hit the ceiling first, so the corrector never even ran.

**Audit of all 10 `trackedCallClaude` call sites in `server/tools/plan.ts`:**
- 2 corrector sites (lines 336, 476) — already bumped to `CORRECTOR_MAX_TOKENS = 32000` in v0.32.6 ✓
- 8 planner/critic sites (lines 235, 251, 291, 384, 399, 440, 526, 541, 582, 597) — all still on default 8192 ❌

Plus call sites in `server/tools/evaluate.ts` (not audited yet; same class of risk).

## Goal

1. Default max_tokens ceiling = 32000 for any LLM call whose caller omits `maxTokens`.
2. Existing explicit `maxTokens` overrides continue to win (corrector's `32000` and any hypothetical smaller overrides).
3. No cost impact — Anthropic bills per output-token-used, not per max_tokens-requested.
4. No behavior change for callers that don't actually produce >8192 tokens of output.

## Binary AC

All checkable by `scripts/default-max-tokens-sweep-acceptance.sh`.

- **AC-1** — `grep -n "const DEFAULT_MAX_TOKENS = 32000" server/lib/anthropic.ts | wc -l` returns `1`.
- **AC-2** — `grep -n "const DEFAULT_MAX_TOKENS = 8192" server/lib/anthropic.ts | wc -l` returns `0`.
- **AC-3** — New unit test: `npx vitest run server/lib/anthropic.test.ts -t "max_tokens=32000 to the SDK when caller does not pass maxTokens"` exits 0.
- **AC-4** — Regression positive: `npx vitest run server/lib/anthropic.test.ts -t "explicit maxTokens override still wins"` exits 0.
- **AC-5** — Full vitest suite: no test FAILURES (same log-grep gate as v0.32.6 wrapper).
- **AC-6** — `npm run build` exits 0.
- **AC-7** — `scripts/default-max-tokens-sweep-acceptance.sh` exists, is executable, exits 0.
- **AC-8** — `setup.sh` unchanged vs origin/master.

## Out of scope

- Bumping to something higher than 32000 (e.g., full 64K Sonnet 4 ceiling). 32K is enough for every plan size observed and halves max-runaway-cost headroom.
- Making the default environment-overridable (deferred — see #318 which proposes `FORGE_CORRECTOR_MAX_TOKENS` env var; same idea applies at the default level).
- AC-pattern lint for vacuous bash pipelines (#312 follow-up; still deferred).
- Auditing `server/tools/evaluate.ts` call sites for independent LLM-output-size risk (orthogonal; separate PR if needed).

## Critical files

- `server/lib/anthropic.ts` — line 7: `const DEFAULT_MAX_TOKENS = 8192` → `const DEFAULT_MAX_TOKENS = 32000`. Plus a comment explaining the bump rationale so future maintainers understand.
- `server/lib/anthropic.test.ts` — 2 new tests (default-passed-through + override-wins-regression).
- `scripts/default-max-tokens-sweep-acceptance.sh` — new acceptance wrapper.
- `package.json` — version 0.32.6 → 0.32.7 (done by `/ship` Stage 7).
- `CHANGELOG.md` — new bug-fix entry (done by `/ship` Stage 7).

## Checkpoint

- [x] Monday's mail read + archived
- [x] ACK sent within 600s SLA (T+8min)
- [x] Root cause verified via grep audit
- [x] `server/lib/anthropic.ts` — bumped to 32000
- [x] `server/lib/anthropic.test.ts` — 2 new tests added
- [x] `npm run build` green
- [x] `npx vitest run` — 759 pass, 0 regressions
- [ ] `scripts/default-max-tokens-sweep-acceptance.sh` wrapper
- [ ] GH issue filed
- [ ] `/ship` pipeline
- [ ] Mail monday with v0.32.7 tag

Last updated: 2026-04-20T03:15:00Z — ready for wrapper + ship.
