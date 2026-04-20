# v0.32.8 — unconditional streaming in callClaude

## Context

Monday blocker #4 (2026-04-20T03:35Z). v0.32.7's 32000 max_tokens default works (no more
`stop_reason=max_tokens` truncation), but the Anthropic TypeScript SDK now refuses the
planner request synchronously:

```
Streaming is required for operations that may take longer than 10 minutes.
See https://github.com/anthropics/anthropic-sdk-typescript#long-requests
```

The SDK predicts runtime from `model + input size + max_tokens` and throws before any
network call when the prediction exceeds 600s. Same thread (`forge-harness-monday-bot-support`),
same class-of-bug arc:
- v0.32.6 — corrector max_tokens truncation detection
- v0.32.7 — default max_tokens ceiling (8192 → 32000)
- v0.32.8 — streaming for long calls (THIS)

After this ship, `callClaude` is the single seam handling `{max_tokens, streaming,
stop_reason, retries, timeouts}` correctly.

## Goal

1. `callClaude` no longer throws "Streaming is required …" when a call's predicted runtime
   exceeds 10 min.
2. The return shape (`{text, parsed?, usage}`) of `callClaude` is unchanged — no caller
   modification required.
3. `LLMOutputTruncatedError` on `stop_reason: "max_tokens"` still fires through the
   streaming path (v0.32.6 coverage preserved).
4. No extra LLM cost — Anthropic bills per token used, streaming adds zero per-call
   overhead.

## Binary AC

- **AC-1** — `grep -nE "messages\.create\(" server/lib/anthropic.ts | wc -l` prints `0`.
  (All callClaude message sends go through the streaming helper.)
- **AC-2** — code-only (strip JSDoc comment lines with leading `*`) count of `anthropic.messages.stream(` call sites in `server/lib/anthropic.ts` equals `1`. JSDoc references don't count.
- **AC-3** — code-only (strip JSDoc comment lines) count of `.finalMessage()` call sites in `server/lib/anthropic.ts` equals `1`.
- **AC-4** — `npx tsc --noEmit` exits 0.
- **AC-5** — `npx vitest run server/lib/anthropic.test.ts 2>&1 | tee /tmp/anthropic.log` completes,
  and `grep -qE "Tests [0-9]+ passed" /tmp/anthropic.log` AND `! grep -qE "Tests [0-9]+ failed" /tmp/anthropic.log`.
  Tests cover: (a) uses `messages.stream().finalMessage()` — not `messages.create()`;
  (b) `LLMOutputTruncatedError` still fires on `stop_reason: "max_tokens"` through the streaming path;
  (c) default max_tokens=32000 still passed to stream params; (d) explicit maxTokens override wins.
- **AC-6** — `npx vitest run 2>&1 | tee /tmp/fullsuite.log` completes, and
  `grep -qE "Tests [0-9]+ passed" /tmp/fullsuite.log` AND `! grep -qE "Tests [0-9]+ failed" /tmp/fullsuite.log`.
  (The `dashboard-renderer.test.ts` Vitest 4.x teardown-rpc flake may set non-zero exit code
  even with zero test failures — v0.32.6 acceptance wrapper already encoded this; reuse the same
  grep-the-log pattern.)
- **AC-7** — `git grep -nE "messages\.create\(" -- 'server/**/*.ts' ':!server/**/*.test.ts'` returns zero
  matches. (Sanity: no residual non-streaming call site in production code. Test files are allowed
  to reference `messages.create` in comments / test-names as intentional tripwires.)
- **AC-8** — `package.json` version field bumps to `0.32.8`.

## Out of scope

- No changes to caller signatures (plan.ts, coordinator.ts, etc.).
- No max_tokens heuristics / conditional streaming — per monday's recommendation,
  unconditional streaming is explicitly safe for short calls.
- No `requestOptions.timeout` tweaks.
- No retry policy changes. (Flagged as a future hardening target in the v0.32.8 CHANGELOG note,
  not in this patch.)
- No OAuth/auth changes — `getClient()` untouched.
- No dashboard-renderer teardown-rpc flake fix (known Vitest 4.x issue, encoded in AC-6 workaround).

## Ordering constraints

None — single file plus its test file.

## Verification procedure

Run `scripts/unconditional-streaming-acceptance.sh` (new, mandatory wrapper that runs AC-1
through AC-8 in order). The wrapper must exit 0 iff every AC passes.

## Critical files

- `server/lib/anthropic.ts` — swap `messages.create(...)` → `messages.stream(...).finalMessage()`
  inside `callClaude`. Single-file change. Keep `LLMOutputTruncatedError` logic (it reads
  `response.stop_reason`, which is populated on the final `Message`).
- `server/lib/anthropic.test.ts` — update mock shape: stub `messages.stream` to return a
  fake stream-handle whose `finalMessage()` resolves to the Message-shaped value the
  tests previously handed to `messages.create`. Add two new tests (streaming call path,
  truncation through streaming).
- `scripts/unconditional-streaming-acceptance.sh` — NEW. Plan-mandated wrapper.
- `package.json` — version bump 0.32.7 → 0.32.8.
- `CHANGELOG.md` — prepend v0.32.8 entry summarizing streaming + class-of-bug closure.

## Checkpoint

- [x] Plan file created
- [x] `server/lib/anthropic.ts` updated with streaming call
- [x] `server/lib/anthropic.test.ts` mock + tests updated (7 tests, all green)
- [x] Acceptance wrapper script created
- [x] `package.json` bumped to 0.32.8
- [x] `CHANGELOG.md` prepended
- [x] Acceptance wrapper green locally (AC-1..8 pass; 760 tests pass in full suite)
- [ ] `/ship` → PR → CI → stateless review → merge → release → mail monday

Last updated: 2026-04-20T04:00Z — implementation + local AC green, ready for `/ship`.
