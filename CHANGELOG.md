# Changelog

All notable changes to this project will be documented in this file.

## [0.35.0](https://github.com/ziyilam3999/forge-harness/compare/v0.34.0...v0.35.0) (2026-04-21)

### Features

- **Dashboard now surfaces active story declarations.** `.forge/dashboard.html` reads the `forge_declare_story` declaration store at render time and shows a "Declared US-XX" pill in the header whenever an agent has declared a story — independent of whether any tool is currently running. Closes the implementation-gap window: between `forge_generate`-complete and `forge_evaluate`-begin, the HTML on disk previously showed "idle" even though the declared story was still being implemented.
- `DashboardRenderInput` grows an optional `declaration: StoryDeclaration | null` field (default null, no regression for existing callers). `renderDashboard` reads `getDeclaration()` synchronously alongside its existing `Promise.all` disk reads — mirrors the union pattern `forge_status` already uses in `buildActiveRun` (`server/tools/status.ts:242-276`).
- Declaration pill hides entirely when no declaration is active (no placeholder strings, no false positives). CSS additions are minimal — a single `.declaration-pill` rule set.

### Provenance

- Field report from monday on 2026-04-21 in thread `v034-field-report-2026-04-21` after her first successful v0.34.0 US-04 end-to-end (PASS 6/6). She proposed three options (a, b, c); option (a) — "dashboard reads declarations" — was chosen because (b) conflated ephemeral activity signal with persistent declarations and (c) was overkill. Rationale in full in `.ai-workspace/plans/2026-04-21-v0-35-0-dashboard-declarations.md`.

### Miscellaneous

- New `scripts/v035-0-dash-acceptance.sh` wrapper runs AC-1..AC-8 sequentially; exit 0 iff all pass. Build step runs first (AC-2/AC-3 import from `dist/`).
- Test count +7 (827 → 834); zero new failures. 12 tests now match the `/declaration/i` name filter (up from 5).

## [0.34.0](https://github.com/ziyilam3999/forge-harness/compare/v0.33.9...v0.34.0) (2026-04-21)

### Features

- **New MCP tools — `forge_status` + `forge_declare_story`** ([#404](https://github.com/ziyilam3999/forge-harness/pull/404)). Ships two new primitives in one minor bump, resolving four scenarios monday-bot reported from US-01/US-02/US-03 iteration:
  - **`forge_status`** — read-only, side-effect-free status query. Unions `.forge/runs/*.json` disk records with live process-scoped declarations. Output kinds: `snapshot` / `differential` / `empty` / `corrupted`. Partial data on corruption rather than total-fail. Scope narrowing by `{planPath, storyId, phaseId}`. Safe to call in tight polling loops.
  - **`forge_declare_story`** — agent-owned declaration primitive. An agent calls `forge_declare_story({ storyId, phaseId })` to say "I am implementing US-XX from now until I say otherwise." Writes to a module-level store on the MCP server process; does NOT persist to disk or across process restarts (by design — avoids stale state from crashed sessions).
- MCP surface now exposes 8 tools (up from 6); smoke test asserts the expanded list. Purely additive — no existing tool's input/output contract changes.

### Scenarios closed

- **A** — 55ms init-window where dashboard had no active-story signal (now populated via `activeRun.storyId` after `forge_declare_story`).
- **B** — liveness check on in-flight `forge_generate` during `/ship` retries (now observable via `activeRun.elapsedMs`).
- **C** — cheap `{storyId, phaseId} → last verdict` lookup (now one `forge_status({ scope })` call instead of 3 manual scripting steps).
- **D** — post-`/compact` state recovery (now one `forge_status({})` call instead of cross-referencing 4 sources).

### Miscellaneous

- New `scripts/v035-0-acceptance.sh` acceptance wrapper runs all 11 AC sequentially; exit 0 iff all pass.
- Test count +23 (804 → 827); zero new failures; integration tests cover AC-5/6/7/8a/8b/11 behaviors.
- 6 enhancement issues filed by the stateless reviewer for v0.34.x follow-up: [#405](https://github.com/ziyilam3999/forge-harness/issues/405) (wrapper log-path), [#406](https://github.com/ziyilam3999/forge-harness/issues/406) (state/lastVerdict divergence), [#407](https://github.com/ziyilam3999/forge-harness/issues/407) (scope filters unenforced), [#408](https://github.com/ziyilam3999/forge-harness/issues/408) (double-walk performance), [#409](https://github.com/ziyilam3999/forge-harness/issues/409) (multi-project singleton), [#410](https://github.com/ziyilam3999/forge-harness/issues/410) (scratch dir .gitignore).
- Provenance: monday-bot's evidence-backed proposal delivered in thread `forge-status-proposal-2026-04-21`. User picked Option 2 (bundle both tools in one minor release) over Option 1 (ship `forge_status` alone, defer declaration) or Option 3 (add storyId field to existing tools).

## [0.33.9](https://github.com/ziyilam3999/forge-harness/compare/v0.33.8...v0.33.9) (2026-04-21)

### Miscellaneous

* **anthropic**: correct OAuth fallback comment on direct API call support — the prior note at `server/lib/anthropic.ts:69-73` claimed OAuth tokens only work via a Claude Code proxy and that direct API calls return 401, both contradicted by the adjacent `new Anthropic({ authToken })` call that succeeds for Max-plan users. Rewrote to accurately describe direct-SDK support with reference to the existing 5-minute cache eviction. Comment-only; no runtime behavior or tests changed. ([#403](https://github.com/ziyilam3999/forge-harness/pull/403), closes [#113](https://github.com/ziyilam3999/forge-harness/issues/113))

## [0.33.8](https://github.com/ziyilam3999/forge-harness/compare/v0.33.7...v0.33.8) (2026-04-21)

### CI + Release Polish (7 issues — final v0.34.x sweep slice)

- **#297** — Switched concurrency group on `.github/workflows/s8-kanban-dashboard-acceptance.yml` to the idiomatic `${{ github.workflow }}-${{ github.ref }}` form (self-scoping, copy-paste-safe).
- **#298** — Dropped empty mapping from `workflow_dispatch: {}` → bare `workflow_dispatch:` (cosmetic, matches GitHub Actions examples).
- **#364** — Fixed `scripts/pr-e-acceptance.sh` AC-E7: vitest crashes are now surfaced via explicit `VITEST_RC` capture + JSON file existence check + no `|| true` masking. Previous behavior produced a confusing "Cannot find module" when vitest crashed before writing the JSON report.
- **#398** — Added inline buffer-policy comments to `scripts/v034-{1,2,3,4}-acceptance.sh` documenting the 2-test headroom pattern. `v034-5` already carried "headroom" wording from its own ship and needed no edit.

### Closed as already shipped (3 issues)

- **#287** — `.github/workflows/s8-kanban-dashboard-acceptance.yml:1` already uses title-case `name: S8 Kanban Dashboard Acceptance` (landed incidentally in an earlier sweep slice).
- **#288** — Lines 34-37 already carry the `--ignore-scripts` rationale comment (landed incidentally).
- **#289** — Lines 17-19 already define the concurrency block (landed incidentally).

### Miscellaneous

- New `scripts/v034-6-acceptance.sh` acceptance wrapper runs AC-1..AC-9 internally (AC-10..AC-12 are post-ship/post-merge/post-planner-close gates).
- Invariants preserved: 800/800 vitest green (unchanged from v0.33.7), AC-8 verified `scripts/v034-0-acceptance.sh` untouched, 12-AC plan file rides the executor's branch.
- 3 enhancement issues filed by the stateless reviewer: #400 (AC-8 silent-pass when master ref unavailable), #401 (PR body wording inconsistency v034-{1,2,3,4} vs plan's v034-{1..5}), #402 (pr-e-acceptance.sh doesn't cross-check VITEST_RC with JSON completeness).
- **Marks the end of the v0.34.x polish sweep** — 7 consecutive iter-1 PASS slices (v0.33.2..v0.33.8).

## [0.33.7](https://github.com/ziyilam3999/forge-harness/compare/v0.33.6...v0.33.7) (2026-04-21)

### Bug Fixes

- evaluate audit refinements slice — 3 quality-of-signal fixes from PR #356 (v0.33.0 PR D) stateless review:
  - **#357** — Tightened audit-test regex from substring match (`/maxTokens|max_tokens/g`) to SDK-option shape (`/\bmaxTokens\s*:|\bmax_tokens\s*:/g`). Future contributors can write `// note: maxTokens is intentionally omitted` in comments without tripping CI.
  - **#358** — Removed self-referential AC-D7 section from `scripts/pr-d-acceptance.sh` (it checked "this script is executable" — but the AC only runs *because* the script is executable; pure tautology).
  - **#359** — Added `existsSync` pre-check in the audit test via an extracted `readAuditTarget()` helper that throws `audit target missing: <path>` with a reference to issue #324, replacing the raw `readFileSync` ENOENT error when `server/tools/evaluate.ts` is moved.

### Miscellaneous

- New `scripts/v034-5-acceptance.sh` acceptance wrapper runs AC-1..AC-10 internally (AC-11 is PR-body-only; AC-12 is the wrapper's own existence).
- Invariants preserved: `evaluate.ts` maxTokens count still 0, audit test still 2/2 green, full suite still green, diff limited to 4-file allowlist.
- 3 enhancement issues filed by the stateless reviewer: #396 (regex misses JSON-quoted `"max_tokens":`), #397 (undocumented D7 gap in pr-d-acceptance.sh), #398 (AC-7 `>= baseline-2` slack pattern-wide across v034-N wrappers).

## [0.33.6](https://github.com/ziyilam3999/forge-harness/compare/v0.33.5...v0.33.6) (2026-04-21)

### Bug Fixes

- anthropic/plan max-tokens follow-ups slice — 3 code fixes + 1 documented design choice, all ship-review enhancements from PR #346 (v0.33.0 PR B):
  - **#347** — dropped redundant in-test `expect(mockCreate).not.toHaveBeenCalled()` at `server/lib/anthropic.test.ts:68`; the suite-scoped `afterEach` tripwire at line 50 is now the sole enforcer.
  - **#348** — loud stderr warning when `FORGE_CORRECTOR_MAX_TOKENS` is invalid (non-numeric, zero, or negative). Matches the `getClient()`/`readOAuthToken()` loud-failure pattern; operator mistypes no longer silently fall back.
  - **#349** — `isMaxTokensStop` default branch now returns a well-defined `false` (fail-safe) while preserving the `const _exhaustive: never = stopReason;` compile-time guard. Unknown SDK stop_reason variants no longer produce truthy returns that would trigger spurious `LLMOutputTruncatedError`.
  - **#350** — kept `CORRECTOR_MAX_TOKENS` as module-load IIFE constant per the issue's own guidance ("fine for v0.33.0; flag only if runtime reconfig becomes a goal"); added JSDoc note documenting the module-load trade-off.

### Miscellaneous

- New `scripts/v034-4-acceptance.sh` acceptance wrapper runs all 12 checkable AC internally with per-AC exit-code discrimination.
- Test count: 800 passed / 4 skipped (baseline 799 + 1 new fail-safe test for #349).
- 4 enhancement issues filed by the stateless reviewer: #391 (tighter `.includes("0")` assertion), #392 (drop trivially-true defensive asserts), #393 (align test commits with their fix commits), #394 (fuse never-cast + fail-safe into single expression).

## [0.33.5](https://github.com/ziyilam3999/forge-harness/compare/v0.33.4...v0.33.5) (2026-04-21)

### Bug Fixes

- acceptance wrapper hygiene slice — 6 fixes bundled:
  - **#338** — contiguous AC numbering in `corrector-crash-fix-acceptance.sh` (see also #367).
  - **#340** — `typeof numFailedTests === "number"` type guard in `corrector-crash-fix-acceptance.sh` and `default-max-tokens-sweep-acceptance.sh` (defeats `undefined > 0` vacuous-pass).
  - **#341** — relocate 23 `/tmp/ac*.log` references to project-relative `tmp/` across 3 wrappers (corrector, default-max, q1-cross-phase).
  - **#343** — add `F57-cd-basename` rule to `AC_LINT_RULES` with unit-test coverage in `server/validation/ac-lint.test.ts`.
  - **#344** — `server/lib/prompts/shared/ac-subprocess-rules.ts` is now fully ASCII (removed 13 em-dashes).
  - **#345** — extract 5 cwd-policy prose tokens as `AC_CWD_POLICY_*` shared constants; `planner.test.ts` imports by name instead of re-spelling.

### Miscellaneous

- New `scripts/v034-3-acceptance.sh` wrapper runs AC-1..AC-11 + AC-13 end-to-end.
- Pre-existing `fix:` commits on master since v0.33.4: CHANGELOG TBD-link repair (#361/#380), pr-e baseline parameterization (#363/#381), checkTimeBudget upper-bound tighten (#371/#382), #272-test label assertion (#373/#383).

## [0.33.4](https://github.com/ziyilam3999/forge-harness/compare/v0.33.3...v0.33.4) (2026-04-20)

### Bug Fixes

- **setup-config:** v0.34.2 bundle — 6 setup-config fixes + 1 deferred (Fixes #310, #333, #334, #335, #336, #337). PR #379.
  - **#310** — `spawnClaude` refactored from `shell: true` to explicit binary resolution (`where claude` / `which claude`, prefers `.cmd` on Windows) with `shell: false`. Paths containing spaces now work on all platforms. Cached in `claudeBinaryPathCache` at module scope.
  - **#333** — `setup-config-acceptance.sh` header softened: removed "will exit with a clear message" claim that didn't match behavior.
  - **#334** — `HOST_CLAUDE_JSON_BEFORE_SHA256` snapshot hoisted to the top of the wrapper before `npm run build` or any subprocess runs.
  - **#335** — AC-9 success line now prints `sha256 before=after` without interpolating the full hex; fail branch still prints both for debugging.
  - **#336** — `tryClaudeMcpAdd` got a JSDoc block documenting the `{ ok: boolean, reason: "missing" | "failed" | null }` tagged-union return.
  - **#337** — Dead `err && err.message ?` ternary fallback removed from `JSON.parse` catch.
  - **Deferred:** #279 (intermittent Windows-backslash-stripping mkdir) — still unreproduced.
  - Iter-1 PASS, zero enhancements filed. 792/0 suite.

## [0.33.3](https://github.com/ziyilam3999/forge-harness/compare/v0.33.2...v0.33.3) (2026-04-20)

### Bug Fixes

- **dashboard:** v0.34.1 bundle — 4 test/doc polish fixes + 3 close-and-cite (Fixes #301, #302, #303, #355; Closes #293, #294, #295). PR #378.
  - **#301** — `useAutoOpenEnvGate` helper gets a JSDoc docstring explaining it registers `beforeEach`/`afterEach` against the enclosing describe at call-time. Prevents future test authors from mis-reading the helper as a pure utility.
  - **#302** — `const eperm` constant inlined at its single use-site. Removes a stray named constant that read like it was shared.
  - **#303** — `maybeAutoOpenBrowser` JSDoc now notes the `FORGE_DASHBOARD_AUTO_OPEN` env check runs per invocation, so toggling mid-process takes effect on the next render.
  - **#355** — `chooseBannerCopy(level, toolRunning, elapsedMs)` extracted as a pure top-level helper returning `{ className, textContent }`. Serialized into the `updateBanner` IIFE via `.toString()` mirroring `classifyStaleness`. 7 new tests cover all 6 `(level, toolRunning)` branch combinations + an `elapsedMs`-affects-only-green regression guard.
  - **#293, #294, #295**: already fixed on master (landed with PRs #290/#299 follow-ups but issues weren't closed at the time). Close-and-cite via PR body only.
  - Suite: 792 passed / 0 failed (up from 785 baseline). Iter-1 PASS with zero enhancements filed — cleanest v0.34.x ship so far.

## [0.33.2](https://github.com/ziyilam3999/forge-harness/compare/v0.33.1...v0.33.2) (2026-04-20)

### Bug Fixes

- **dashboard:** v0.34.0 bundle — nine runtime bug fixes + two close-and-cite (Fixes #271, #272, #273, #274, #275, #276, #300, #352, #353; Closes #282, #283). PR #372.
  - **#271** (race on `dashboard.tmp.html`): added per-project `renderQueue` Map that serializes background `writeDashboardHtml` calls — two hooks firing close together on the same project now chain via `prior.catch().then()` instead of both racing on the shared tmp filename. Different projects still write in parallel.
  - **#272** (`ProgressReporter.complete/fail` stage-label): `stageNum` is now derived from `stages.indexOf(stageName)`, not from the last `begin()`'s `currentIndex`. Unknown stage name → early no-op (no `-1 + 1` leak). Out-of-order closes report the correct `[N/total]`.
  - **#273** (fire-and-forget isolation test): old AC-18 asserted `.not.toThrow()` on a `void (async () => ...)()` — trivially true. Rewritten with `vi.doMock` + microtask drain + assertions that `writeActivity` and `renderDashboard` spies were both invoked.
  - **#274** (dynamic import in hot path): `readAuditFeed` no longer does `await import('node:fs/promises')`; `readdir` is in the static top-of-file import block.
  - **#275** (`activityStartedAt` reset discipline): new `maybeClearActivityStartedAt()` clears the field when `stageStartTimes.size === 0`. Reporter reuse no longer carries a stale start timestamp across runs.
  - **#276** (empty-string tool hygiene): both `readActivity` and the `renderBoard` guard now reject `{tool: ""}` alongside null / undefined — empty-pill render eliminated.
  - **#300** (typeof guard on err cast): `maybeAutoOpenBrowser` stat-catch now checks `err !== null && typeof err === "object"` before reading `.code`. Primitive throws (`throw "string"`, `throw null`) fall safely through.
  - **#352** (amber-idle banner): `updateBanner` intercept widened from `level === "red"` to `level !== "green"`. Amber-idle now also collapses to "Idle — no tool running."
  - **#353** (`isToolRunning` helper): extracted as top-level function; replaces duplicated `activity && activity.tool` checks at `renderBoard`, `readActivity` (inline), and `renderDashboardHtml`'s `TOOL_RUNNING` serializer.
  - **#282, #283**: already fixed on master; close-and-cite via PR body only (no code diff — `maybeAutoOpenBrowser` already takes `io: AutoOpenIo` seam and the ENOENT narrowing at `:686-702` already in place).
  - 5 new tests (dashboard 25→28, progress 7→9); full suite 785 / 0 failed (up from 780 baseline). 5 enhancement follow-ups filed (#373-#377).

## [0.33.1](https://github.com/ziyilam3999/forge-harness/compare/v0.33.0...v0.33.1) (2026-04-20)

### Bug Fixes

- **coordinator:** non-zero `usedUsd` / `elapsedMs` emitted to the dashboard BUDGET and TIME cards even when the caller doesn't pass a budget cap or a plan start time (Fixes #368, reported by monday-bot via mailbox). Two adjacent coordinator bugs were emitting hardcoded zeros to the dashboard whenever optional args were null:
  - `checkBudget` now runs the cost-aggregation loop unconditionally; the `budgetUsd == null` branch only gates the cap / ratio / warning logic, not the `usedUsd` sum. Dashboard now shows real cumulative spend (e.g. `$0.59`) in the "no limit" case instead of `$0.00`.
  - `checkTimeBudget` gained an optional `priorRecords?: ReadonlyArray<TaggedRunRecord>` third parameter. When the caller doesn't pass `startTimeMs`, the function falls back to the earliest primary-record timestamp (matching the pattern at `coordinator.ts:1074-1077`). Caller-provided `startTimeMs` stays authoritative when present. Empty / omitted records preserve the original `elapsedMs: 0, warningLevel: "unknown"` behavior for backward compat.
  - Single call site (`assessPhase` at L682) wired to pass `allRecords`; zero ripple to other callers.
  - 4 new unit tests + 1 existing test updated (was encoding the buggy zero-emit behavior); 780 tests pass (up from 776). PR #369.

## [0.33.0](https://github.com/ziyilam3999/forge-harness/compare/v0.32.14...v0.33.0) (2026-04-20)

### Miscellaneous

- **v0.33.0 — cumulative minor-version release** closing the five-slice polish bundle that shipped as v0.32.9 through v0.32.14 on 2026-04-20.

  **Arc summary.** The v0.33.0 bundle landed in five PRs (A1/A2/B/C/D/E) over a single day, each a narrow polish surface with its own stateless-reviewer pass:

  - **v0.32.9 (PR A1, #332)** — `setup-config` hardening: drop dead `EXPECTED_DIST` (#306), OS-guard System32 path (#307), host-pollution sha256 assertion (#308), CLI-missing vs CLI-failed fallback wording (#309), stderr note on invalid `settings.json` (#311).
  - **v0.32.10 (PR A2, #339)** — acceptance-wrapper JSON-reporter migration: `vitest --reporter=json` + `numFailedTests` structured parse replaces brittle stdout grep (#315, retires #322), AC numbering gap closed (#321), `wc -l` whitespace trimmed for BSD portability (#323), project-relative `tmp/` for Windows MSYS path asymmetry.
  - **v0.32.11 (#342)** — planner cwd-policy fix: forbid `cd <project-basename> && ...` prefix in AC commands. `forge_evaluate` already sets `cwd=projectPath` — the planner's spurious `cd` prefix caused every first-run evaluate to fail (`cd: <project>: No such file or directory`). Reported by monday-bot operator during US-01 bootstrap.
  - **v0.32.12 (PR B, #346)** — anthropic + plan surface: widen `CallClaudeResult.usage` with optional cache-token fields (#329), typed exhaustive `isMaxTokensStop()` helper replaces bare string-equality (#314), `CORRECTOR_MAX_TOKENS` with env override (#317), suite-scoped `mockCreate.not.toHaveBeenCalled()` tripwire (#318), drop redundant `err.message.toContain` assertions (#316), consolidate orphaned `runCorrector` JSDoc (#330), plan amendment AC-B13 deleted stale `reconcile.test.ts` AC8 guard from PR #164.
  - **v0.32.13 (PR C, #351)** — CHANGELOG + dashboard polish: split the dense v0.32.8 entry (1315-char single-paragraph) into readable problem/fix/arc-closure paragraphs (#328); dashboard liveness banner now distinguishes `TOOL_RUNNING` true/false, adding a neutral "Idle — no tool running" state when idle > 120s (#331).
  - **v0.32.14 (PR D, #356)** — evaluate.ts max_tokens audit: confirmed zero explicit `maxTokens` overrides across all 3 `trackedCallClaude` sites in `server/tools/evaluate.ts` (coherence, reverse, critic); locked as a structural invariant via `evaluate-max-tokens-audit.test.ts` with rot-guard companion assertion ensuring at least one `trackedCallClaude` site remains (#324).

  **CHANGELOG header ordering fix (closes #354).** Prior to this release, the `# Changelog` H1 and its intro paragraph were buried between v0.32.9 and v0.32.8 because `/ship` Stage 7 prepends every new version section to the file top without special-casing an existing title block. Each PR in the bundle compounded the drift. This release relocates the H1 + intro back to lines 1-3, restoring readable top-down navigation. The underlying `/ship` skill prepend-logic bug remains a separate candidate for the ai-brain-owned `/ship` skill definition and is out of scope for this repo.

  **What did not change.** Zero runtime code in this release — no `server/**/*.ts` edits. Only `package.json` (version bump 0.32.14 → 0.33.0), `CHANGELOG.md` (this entry + H1 relocation), and a plan/acceptance-wrapper pair under `.ai-workspace/` and `scripts/`.

  **Thanks to monday-bot operator** for the mid-bundle bug reports (#312, #319, #325, #342) that drove the v0.32.6/7/8 streaming-triad closure; the v0.33.0 milestone is the natural capstone for that arc. ([#360](https://github.com/ziyilam3999/forge-harness/pull/360))

## [0.32.14](https://github.com/ziyilam3999/forge-harness/compare/v0.32.13...v0.32.14) (2026-04-20)

### Miscellaneous

- v0.33.0 polish bundle — PR D of 5 (evaluate.ts max_tokens audit, 1 issue).

  Final audit slice before the cumulative v0.33.0 release. v0.32.7 (PR #320) raised `DEFAULT_MAX_TOKENS` 8192 → 32000 for every LLM call site riding the default; issue #324 asked whether `server/tools/evaluate.ts` contains any *explicit* `maxTokens` override that would have opted out of that sweep (an override of, say, `maxTokens: 4096` would silently cap a coherence / reverse / critic eval at the old low ceiling).

  Audit outcome (measured against master SHA `2de7e1d`): `server/tools/evaluate.ts` contains zero `maxTokens` / `max_tokens` references across its 3 `trackedCallClaude` sites (coherence-eval L282, reverse-eval L489, critic-eval L676) — all three ride the raised default. The companion file `server/lib/evaluator.ts` is LLM-free (pure shell-command execution), so it has nothing to audit.

  No runtime code change. The audit is locked as a structural invariant via a new test (`server/tools/evaluate-max-tokens-audit.test.ts`) that reads `evaluate.ts` from disk and asserts zero `maxTokens` matches — any future edit that reintroduces an explicit ceiling fails CI with a diff pointer and a reminder to re-open the #324 decision trail. Sanity companion assertion: at least one `trackedCallClaude` site must remain, so a full refactor of the LLM calls out of this file visibly breaks the test rather than leaving it silently green on an empty file. (closes #324)

## [0.32.13](https://github.com/ziyilam3999/forge-harness/compare/v0.32.12...v0.32.13) (2026-04-20)

### Miscellaneous

- v0.33.0 polish bundle — PR C of 5 (CHANGELOG + dashboard surface, 2 issues).

  CHANGELOG polish: split the dense v0.32.8 entry (1315-char single-paragraph) into readable problem/fix/arc-closure paragraphs; max line dropped to 229 chars. All load-bearing technical terms preserved (`messages.stream`, `finalMessage`, `DEFAULT_MAX_TOKENS`, `LLMOutputTruncatedError`, `stop_reason`, `closes #325`). Pure textual edit (#328).

  Dashboard liveness banner: serialize a `TOOL_RUNNING` boolean into the client-side `<script>` block alongside `LAST_UPDATE`/`ACTIVITY_STARTED`. `updateBanner` now branches — when `TOOL_RUNNING === false` and elapsed > 120s, banner reads "Idle — no tool running" with neutral `.liveness-banner.neutral` styling; when `TOOL_RUNNING === true` and stale, the existing red "may be hung" alarm is preserved for the legitimate stuck-tool case. Fixes the post-bootstrap / between-invocation false alarm reported by monday-bot operator (#331). +2 unit tests cover idle branch + `TOOL_RUNNING` serialization.

  Scope note: monday-bot's concurrent feature request for richer Kanban column visibility (in-progress / retry / blocked) was deliberately out-of-scope — research confirmed all three columns already exist and route correctly via `activity.storyId` + `statusToColumn`; the gap she observed is a telemetry contract question, not a renderer bug. 4 follow-up polish issues filed from stateless review (#352 amber-window idle, #353 `isToolRunning` helper extraction, #354 non-monotonic CHANGELOG header, #355 runtime-branch test via `vm` sandbox). ([#351](https://github.com/ziyilam3999/forge-harness/pull/351))

## [0.32.12](https://github.com/ziyilam3999/forge-harness/compare/v0.32.11...v0.32.12) (2026-04-20)

### Miscellaneous

- v0.33.0 polish bundle — PR B of 5 (anthropic + plan surface, 6 issues + 1 AC8 cleanup). Widen `CallClaudeResult.usage` with optional `cacheCreationInputTokens` + `cacheReadInputTokens` (#329). Replace bare `stop_reason === "max_tokens"` string-equality check with a typed exhaustive `isMaxTokensStop()` helper so new SDK variants break at compile time (#314). Export `CORRECTOR_MAX_TOKENS` with `FORGE_CORRECTOR_MAX_TOKENS` env override for operators (#317). Hoist `mockCreate.not.toHaveBeenCalled()` tripwire into suite-scoped `afterEach` so every test enforces the "never falls back to non-streaming" invariant (#318). Drop redundant `err.message.toContain(...)` assertions in truncation test — structured fields cover the contract (#316). Consolidate orphaned `runCorrector` JSDoc (#330). Plan amendment AC-B13 during execution: delete stale `server/tools/reconcile.test.ts` AC8 unit-test guard from PR #164 (one-time PR-scope check that tripped on any branch legitimately editing `plan.ts`; AC9's `documentTier:"update"` invariant is the proper perpetual guard and is retained). ([#346](https://github.com/ziyilam3999/forge-harness/pull/346))

## [0.32.11](https://github.com/ziyilam3999/forge-harness/compare/v0.32.10...v0.32.11) (2026-04-20)

### Bug Fixes

- Forbid `cd <project-basename> && ...` prefix in planner-generated AC commands. `forge_evaluate` already sets `cwd=projectPath`, but the planner prompt was silent on cwd policy — so the LLM defaulted to prepending `cd <basename> && ...` to every AC, causing every first-run evaluate to fail with `cd: <project>: No such file or directory`. Reported by monday-bot during US-01 bootstrap (`cd: monday-bot: No such file or directory`). Adds a `Working directory:` paragraph to `AC_SUBPROCESS_RULES_PROMPT` (shared by planner + critic) with WRONG/RIGHT examples; pure rule-surface addition. `getAcLintRulesHash()` output changes — cached `lint-audit` entries become stale as designed. ([#342](https://github.com/ziyilam3999/forge-harness/pull/342))

## [0.32.10](https://github.com/ziyilam3999/forge-harness/compare/v0.32.9...v0.32.10) (2026-04-20)

### Miscellaneous

- v0.33.0 polish bundle — PR A2 of 5 (acceptance-wrapper surface). Switch both acceptance wrappers from brittle `Tests N passed` stdout grep to `vitest --reporter=json` + `numFailedTests` structured parse (#315, retires #322). Close AC numbering gap in max-tokens-sweep wrapper (#321). Trim `wc -l` whitespace for BSD portability in both wrappers (#323). Unplanned in-scope fix: project-relative `tmp/` for vitest JSON output to avoid Windows MSYS `/tmp` vs node.exe drive-root asymmetry. ([#339](https://github.com/ziyilam3999/forge-harness/pull/339))

## [0.32.9](https://github.com/ziyilam3999/forge-harness/compare/v0.32.8...v0.32.9) (2026-04-20)

### Miscellaneous

- v0.33.0 polish bundle — PR A1 of 5 (setup-config surface, 5 issues). Drop dead EXPECTED_DIST (#306), OS-guard System32 path (#307), add host-pollution sha256 assertion (#308, wrapper check count 11→12), distinguish CLI-missing vs CLI-failed fallback wording (#309), stderr note on invalid settings.json (#311). ([#332](https://github.com/ziyilam3999/forge-harness/pull/332))

## [0.32.8](https://github.com/ziyilam3999/forge-harness/compare/v0.32.7...v0.32.8) (2026-04-20)

### Bug Fixes

- **anthropic:** `callClaude` now uses `messages.stream(...).finalMessage()` unconditionally instead of `messages.create(...)`. (closes #325)

  **Problem.** After v0.32.7 raised `DEFAULT_MAX_TOKENS` to 32000, the Anthropic SDK's synchronous pre-flight check began refusing planner calls with `"Streaming is required for operations that may take longer than 10 minutes"`.
  The SDK predicts runtime from model + input size + max_tokens and rejects non-streaming requests projected beyond the 600s cap.
  Reported by monday during monday-bot bootstrap (mailbox thread `forge-harness-monday-bot-support`, 2026-04-20T03:35Z).

  **Fix.** `messages.stream().finalMessage()` is the SDK-recommended path and returns the same `Message` object (same `content`, `stop_reason`, `usage`), so callers and `LLMOutputTruncatedError` detection are unchanged.
  Streaming is explicitly safe for short calls per Anthropic docs — zero per-call overhead — so this is flipped at the helper level rather than via a fragile heuristic.
  Coverage: 5 retrofitted tests (existing truncation + max_tokens reused via streaming mock) + 1 new transport regression test (`messages.stream` invoked, `messages.create` never invoked).

  **Arc closure.** Closes the class-of-bug arc v0.32.6 → v0.32.7 → v0.32.8: `callClaude` is now the single seam handling max_tokens, stop_reason, and streaming correctly.

## [0.32.7](https://github.com/ziyilam3999/forge-harness/compare/v0.32.6...v0.32.7) (2026-04-20)

### Bug Fixes
- **anthropic:** `DEFAULT_MAX_TOKENS` raised from 8192 to 32000 across all LLM call sites. v0.32.6 had raised only the 2 corrector-specific call sites to 32000; the other 8 call sites in `server/tools/plan.ts` (planner, planner-retry, critic, master-planner, master-planner-retry, master-critic, phase-planner, phase-planner-retry, update-planner, update-planner-retry) remained on the 8192 default and truncated for any plan >~27KB. Monday hit this on the planner itself at 2026-04-20T03:05Z, ~10h after v0.32.6 shipped — truncation surfaced correctly as `LLMOutputTruncatedError` (thanks to v0.32.6 fix #2) but the plan never drafted. Rather than repeat the override at 10 call sites (and risk missing future ones), raise the default itself. Single-line change. Sonnet 4 supports 64K output; 32000 is halfway with headroom. Anthropic bills per output-token-used, not per max_tokens-requested, so non-plan callers pay nothing extra. Explicit `maxTokens: CORRECTOR_MAX_TOKENS` overrides in plan.ts retained as documentation of intent. 2 new tests (default-passed-through-to-SDK + explicit-override-wins regression). (closes #319) (#320)

## [0.32.6](https://github.com/ziyilam3999/forge-harness/compare/v0.32.5...v0.32.6) (2026-04-19)

### Bug Fixes
- **forge_plan:** corrector stage no longer silently swallows max_tokens truncation. Three concentric fixes: (1) corrector call sites now pass `CORRECTOR_MAX_TOKENS = 32000` (~105KB JSON output, vs. the 8192-token default that truncated at ~27KB — matches monday's crash at position 26918); (2) `callClaude` inspects `response.stop_reason` and throws a typed `LLMOutputTruncatedError` when the response was cut off — any future silent truncation across any LLM call site becomes a loud failure; (3) `runCorrector` / `runMasterCorrector` return a `correctorFailed` boolean, `RunRecord["outcome"]` widens to include `"corrector-failed"`, and all four handlers (default/master/phase/update) plumb an `anyCorrectorFailed` flag through to `writeRunRecordIfNeeded`. A run that previously reported `outcome: "success"` with `findingsApplied: 0, findingsRejected: 45` now reports `outcome: "corrector-failed"` and the caller knows the critique was not applied. 8 new tests (4 anthropic truncation-detection + 4 corrector-failed outcome including regression-positive + any-round-failed sticky). Reported by monday during monday-bot bootstrap (mailbox thread `forge-harness-monday-bot-support`, 2026-04-19T15:27Z). (closes #312) (#313)

## [0.32.5](https://github.com/ziyilam3999/forge-harness/compare/v0.32.4...v0.32.5) (2026-04-19)

### Bug Fixes
- **setup:** `scripts/setup-config.cjs` now registers the forge MCP server to Claude Code's canonical user-scope path (`~/.claude.json` top-level `mcpServers`, written via `claude mcp add ... -s user`) instead of the dead-letter `~/.claude/settings.json.mcpServers` (which Claude Code never read). Primary path uses the `claude` CLI with an absolute path to `dist/index.js` (sidesteps the missing `--cwd` flag in CLI v2.1.114, so relative paths no longer break for users whose session cwd is not forge-harness). Fallback path atomically writes `~/.claude.json` directly when the CLI is not on PATH, preserving all other keys. Migration warnings (non-fatal, no auto-delete) cover stale `~/.claude/settings.json.mcpServers.forge` and stray `~/.claude/mcp.json`. New acceptance wrapper `scripts/setup-config-acceptance.sh` drives 10 AC against an isolated scratch HOME. Reported by monday during monday-bot bootstrap (2026-04-19). **Users who previously ran `./setup.sh` should: `claude mcp remove forge -s user` (optional cleanup) → re-run `./setup.sh` → quit-and-relaunch Claude Code.** (closes #304) (#305)

## [0.32.4](https://github.com/ziyilam3999/forge-harness/compare/v0.32.3...v0.32.4) (2026-04-19)

### Miscellaneous
- **dashboard:** auto-open polish bundle from PR #290 ship-review. `stat`-catch guard widened to treat errors without a `code` property as skip rather than "marker absent" (closes #291). Test fixture renamed to a neutral label instead of misleading `/tmp/…nonexistent-xyz` naming (closes #293). Shared env-gate setup factored into `useAutoOpenEnvGate()` helper (closes #294). Env-gate test extracted to its own describe block (closes #295). Zero behavior change on the happy path. Full suite 748 → 749 tests (+1 for the new undefined-code coverage). (#299)

## [0.32.3](https://github.com/ziyilam3999/forge-harness/compare/v0.32.2...v0.32.3) (2026-04-19)

### Miscellaneous
- **ci:** S8 Kanban dashboard workflow polish. Adds `workflow_dispatch` (closes #286) for manual reruns, friendly `name:` label (closes #287), inline `--ignore-scripts` rationale comment matching ci.yml (closes #288), and a `concurrency:` block with `cancel-in-progress: true` so stacked PR pushes cancel in-flight runs instead of queuing (closes #289). Zero behavior change on the happy path. (#296)

## [0.32.2](https://github.com/ziyilam3999/forge-harness/compare/v0.32.1...v0.32.2) (2026-04-19)

### Bug Fixes
- **dashboard:** harden auto-open path per PR #280 ship-review. Three fixes bundled: (1) `.forge/.dashboard-opened` marker is now written only after the child process emits its `"spawn"` event, so a failed spawn (e.g. `xdg-open` missing) no longer permanently disables auto-open — closes #281; (2) `maybeAutoOpenBrowser` exported with a new `AutoOpenIo` seam so the env-gated path is unit-testable — closes #282; (3) `stat` catch narrowed to ENOENT, other errors logged and skipped rather than treated as "marker absent" — closes #283. Opt-in contract (`FORGE_DASHBOARD_AUTO_OPEN=1`) unchanged. (#290)

## [0.32.1](https://github.com/ziyilam3999/forge-harness/compare/v0.32.0...v0.32.1) (2026-04-19)

### Miscellaneous
- **ci:** wire S8 Kanban dashboard acceptance wrapper (`scripts/s8-kanban-dashboard-acceptance.sh`) into a path-filtered GH Actions workflow so PRs touching `server/lib/{dashboard-renderer,coordinator,progress,run-record,activity}.ts` or the wrapper itself run the wrapper as a required PR check. Closes #284 — prevents the class of fixture drift that regressed AC-07 between PR #269 and PR #280. (#285)

## [0.32.0](https://github.com/ziyilam3999/forge-harness/compare/v0.31.1...v0.32.0) (2026-04-19)

### Features
- **dashboard:** env-gated OS-native browser auto-open on first render. `renderDashboard()` spawns the default browser when `FORGE_DASHBOARD_AUTO_OPEN=1` is in the environment and the per-project `.forge/.dashboard-opened` marker is absent. Uses `spawn` with an argv array (no shell interpolation) and `detached+unref` so the MCP subprocess stays independent. Failure is swallowed per the existing renderer error policy — tests and CI are unaffected when the var is unset. Delete the marker to re-open the tab. (#280)

### Bug Fixes
- **dashboard-acceptance:** S8 Kanban acceptance wrapper (`scripts/s8-kanban-dashboard-acceptance.sh`) was silently failing AC-07 because the fixture used hardcoded past timestamps (`2026-04-18T10:00:0X`) while the driver passed `currentPlanStartTimeMs = Date.now() - 5min`; under `assessPhase`'s time-window filter the records were dropped and the header rendered `0/9` instead of `4/9`. Fixture timestamps now generated relative to `Date.now() - 60s`. CI never caught it because no workflow invoked the wrapper; follow-up tracked at #284. (#280)

## [0.31.1](https://github.com/ziyilam3999/forge-harness/compare/v0.31.0...v0.31.1) (2026-04-19)

### Miscellaneous
- **cleanup:** remove memory-cli `$HOME`-leak pollution dirs + add task #74 acceptance wrapper. Forge-harness contribution to the cross-repo memory-cli `$HOME` non-expansion fix (companions: ai-brain v0.19.2, agent-working-memory v0.1.2). Adds `.ai-workspace/plans/2026-04-19-memory-cli-home-leak-fix.md` and `scripts/memory-cli-home-leak-fix-acceptance.sh`. (#278)

## [0.31.0](https://github.com/ziyilam3999/forge-harness/compare/v0.30.23...v0.31.0) (2026-04-18)

### Features
- **dashboard:** S8 Kanban dashboard for forge_coordinate — display-only HTML at `.forge/dashboard.html`, 6-column Kanban (backlog/ready/in-progress/retry/done/blocked), 5s meta-refresh, no server/WebSocket/npm deps. Reads `.forge/coordinate-brief.json` + `.forge/activity.json` + `.forge/audit/*.jsonl`. New `server/lib/dashboard-renderer.ts`, `server/lib/activity.ts`, coordinator-brief-write in `assessPhase()`, and opt-in `ProgressReporter.setProjectContext()` hook. 18 binary AC, 744 tests pass, closes forge_coordinate roadmap. (#269)

### Bug Fixes
- **dashboard-tests:** use `/nonexistent/forge-root` for Linux bogus-path fast-fail in activity and coordinator-brief-write tests; `/proc/self/root-nonexistent-xyz` hung past 5000ms timeout on Ubuntu CI (#269)

### Miscellaneous
- **plans:** add PH-05 Kanban Dashboard to forge_coordinate master plan as adjacent post-primitive phase (#269)

## [0.30.23](https://github.com/ziyilam3999/forge-harness/compare/v0.30.22...v0.30.23) (2026-04-17)

### Bug Fixes
- **scripts:** scope q1-t40-06..09 numstat diffs to origin/master...HEAD so post-commit measurements compare feature-branch to master (issue #240 partial re-fix) (#261)
- **plans:** add EXIT trap cleanup to 32 mktemp commands in forge-generate-phase-PH-01.json, reaching parity with coord-phase JSON (issue #239 partial re-fix) (#261)

## [0.30.22](https://github.com/ziyilam3999/forge-harness/compare/v0.30.21...v0.30.22) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 5 F55-passed ACs in PH01-US08 (task #40 s13, final slice) (#249)

## [0.30.21](https://github.com/ziyilam3999/forge-harness/compare/v0.30.20...v0.30.21) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 3 F55-passed ACs in PH01-US07 (task #40 s12) (#248)

## [0.30.20](https://github.com/ziyilam3999/forge-harness/compare/v0.30.19...v0.30.20) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 8 F55-passed ACs in PH01-US06 (task #40 s11) (#247)

## [0.30.19](https://github.com/ziyilam3999/forge-harness/compare/v0.30.18...v0.30.19) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 6 F55-passed ACs in PH01-US05 (task #40 s10) (#246)

## [0.30.18](https://github.com/ziyilam3999/forge-harness/compare/v0.30.17...v0.30.18) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 5 F55-passed ACs in PH01-US04 (task #40 s09) (#244)

## [0.30.17](https://github.com/ziyilam3999/forge-harness/compare/v0.30.16...v0.30.17) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 2 F55-passed ACs in PH01-US03 (task #40 s08) (#242)

## [0.30.16](https://github.com/ziyilam3999/forge-harness/compare/v0.30.15...v0.30.16) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 3 F55-passed ACs in PH01-US01 (task #40 s07) (#241)

## [0.30.15](https://github.com/ziyilam3999/forge-harness/compare/v0.30.14...v0.30.15) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 8 F55-passed ACs in PH01-US-05 (task #40 s06) (#238)

## [0.30.14](https://github.com/ziyilam3999/forge-harness/compare/v0.30.13...v0.30.14) (2026-04-16)

### Bug Fixes

- **hooks:** add de-dup + 401 fallback to retroactive-critique hook ([#234](https://github.com/ziyilam3999/forge-harness/pull/234))

## [0.30.13](https://github.com/ziyilam3999/forge-harness/compare/v0.30.12...v0.30.13) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 8 F55-passed ACs in PH01-US-04 (task #40 s05) (#231)

## [0.30.12](https://github.com/ziyilam3999/forge-harness/compare/v0.30.11...v0.30.12) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 7 F55-passed ACs in PH01-US-03 (task #40 s04) (#230)

## [0.30.11](https://github.com/ziyilam3999/forge-harness/compare/v0.30.10...v0.30.11) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 6 F55-passed ACs in PH01-US-02 (task #40 s03) (#229)

## [0.30.10](https://github.com/ziyilam3999/forge-harness/compare/v0.30.9...v0.30.10) (2026-04-16)

### Miscellaneous
- **ac-rewrite:** rewrite 2 F55-passed ACs in PH01-US-00b (task #40 s02) (#227)

## [0.30.9](https://github.com/ziyilam3999/forge-harness/compare/v0.30.8...v0.30.9) (2026-04-16)

### Bug Fixes
- recursive walk for nested plan dirs in handleCriticEval (#224)
- handleCriticEval guard parsed !== null && typeof parsed === 'object' (#221)
- aggregate unverified warning should include the offending AC ids (#222)
- apply 5 clarity/future polish items to windows-env-setup.md (#217)
- pin backward-compat for undefined reliability (#218)
- scope dual-flag warning to retry-PASS branch only (#219)

### Miscellaneous
- **ac-rewrite:** rewrite 3 F55 ACs in PH01-US-00a (task #40 s01) (#223)

## [0.30.8](https://github.com/ziyilam3999/forge-harness/compare/v0.30.7...v0.30.8) (2026-04-16)

### Bug Fixes

* **ac-lint (F56→F55 rename):** rename F56 test names and comments to F55 ([#215](https://github.com/ziyilam3999/forge-harness/pull/215)). Follow-up to [#213](https://github.com/ziyilam3999/forge-harness/pull/213) which renamed the rule itself — this PR catches the stray test/comment references that still said "F56" and makes them consistent with the new label. Pure rename, no matcher/finding changes.

### Documentation

* **compaction plan (audit artifact):** add `parent-claude.md` compaction plan + verification ACs ([#216](https://github.com/ziyilam3999/forge-harness/pull/216)). Pure documentation — adds a 298-line planning document at `.ai-workspace/plans/2026-04-16-claude-md-compaction-slate-b.md` capturing the full deletion plan with paired deletion+survival citations for the ai-brain `parent-claude.md` compaction that shipped as `ai-brain` v0.16.2. Serves as a template for future compaction passes: every deletion cites the downstream line that still carries the rule, and a `/coherent-plan` pass scoped to "verify each survival citation mechanically, one site at a time" catches silent rule loss before execution. No runtime behavior change.

## [0.30.7](https://github.com/ziyilam3999/forge-harness/compare/v0.30.6...v0.30.7) (2026-04-16)

### Miscellaneous

* **ac-lint:** rename `F56-passed-grep` to `F55-passed-grep` — corrects a rule mis-labeling; the rule detects the F55 class (TTY-dependent runner-output grep), not F56 (pipe-chain stdin bug). Pure label swap; no matcher or finding behavior changes. Sibling rule `F56-multigrep-pipe` remains unchanged. ([#213](https://github.com/ziyilam3999/forge-harness/pull/213))

## [0.30.6](https://github.com/ziyilam3999/forge-harness/compare/v0.30.5...v0.30.6) (2026-04-16)

### Bug Fixes

* **q1/task-21:** rewrite 5 hazardous PH01-US-06 ACs to F-rule-safe patterns ([#212](https://github.com/ziyilam3999/forge-harness/pull/212))

### Miscellaneous

* **plan:** sync task #22 plan to shipped reality (v0.30.5) ([#211](https://github.com/ziyilam3999/forge-harness/pull/211))

## [0.30.5](https://github.com/ziyilam3999/forge-harness/compare/v0.30.4...v0.30.5) (2026-04-15)

### Documentation

- **docs(q22):** AFFIRM the C1-bootstrap `lintExempt` exemption (F36/F56 rule family) across 9 phase JSONs under `.ai-workspace/plans/` with a refreshed rationale citing post-v0.20.0 / post-PR#208 state. Decision was driven by 7 independent runtime-consumer probes (`grep -rn` against `server/**`, workflow file inspection, critic-mode loader read-path audit) that all returned zero hits for automated consumption of the phase JSONs — the ACs are treated as opaque string content by `evaluate.ts`'s critic-mode loader and are never shell-executed. AFFIRM cost = 9 rationale edits; UNWIND cost would have been 177 AC command rewrites for files nobody runs. Decision and full measurement memo recorded at `.ai-workspace/audits/2026-04-15-c1-bootstrap-exemption-decision.md`. Acceptance wrapper `scripts/q1-cross-phase-acceptance.sh` added per hard-rule 8 precedent from PR #208. Planner-side regression caught mid-PR: original brief undercounted PH-01 phase JSONs as 0 `grep -q` ACs when they actually carry 65 (same failure mode as PR #208's `audit.ts` undercount and Cairn Gap 4's `cp` clobber — third instance in three runs); resolved via 4-patch amendment on the executor branch narrowing PH-01 carve-out to AC-command rewrite only, with rationale refresh uniformly in-scope across all 9 files. PH-01's ~59 orphaned non-US-06 ACs tracked as follow-up task #22-followup. First real run of the freshly shipped `/delegate` skill (ai-brain v0.15.0 / PR #277). ([#210](https://github.com/ziyilam3999/forge-harness/pull/210))

## [0.30.4](https://github.com/ziyilam3999/forge-harness/compare/v0.30.3...v0.30.4) (2026-04-15)

### Bug Fixes

- **fix(q05-task34):** kill 40 pre-existing `server/**` lint errors and wire `npm run lint` into `.github/workflows/ci.yml` as a required step. 10 files touched: `server/lib/audit.ts` (rewrote `for await (const _entry of dir)` → `while ((await dir.read()) !== null)` to drop the unused iteration var without touching ESLint config), plus 9 test files where `no-explicit-any` was replaced with real imported types (`LintablePlan`, `LintExempt`, `CallClaudeOptions`-shaped structural types), `no-this-alias` inlined (arrow functions already closed over `this`), and one `no-unsafe-function-type` narrowed to the real `exec` callback signature. Zero `eslint-disable` comments introduced, zero rule-config changes. CI now runs lint as a required step with no `continue-on-error`, so the AC-11 contract from PR #207 can be promoted back to `npm run lint exits 0` on future PRs. Plan file `.ai-workspace/plans/2026-04-14-q05-task34-lint-debt-ci-wiring.md` was amended mid-PR from a 9-file baseline to 10 after `server/lib/audit.ts` was surfaced by the executor on first-pass re-enumeration; amendment rode the PR branch per planner/executor doctrine. ([#208](https://github.com/ziyilam3999/forge-harness/pull/208))

## [0.30.3](https://github.com/ziyilam3999/forge-harness/compare/v0.30.2...v0.30.3) (2026-04-14)

### Miscellaneous

- **chore(q05-q1):** decouple npm publish scope from `.gitignore`. `package.json` now carries an explicit `files:` whitelist (`dist/`, `server/`, `scripts/`, `schema/`, `README.md`, `CHANGELOG.md`), so `.gitignore` can be relaxed without leaking plans/audits into the npm tarball. `.ai-workspace/plans/` and `.ai-workspace/audits/` are now tracked in git (42 newly-visible files); `dogfood/`, `sessions/`, `reports/`, `lessons/`, `lint-audit/` and loose scratch files stay ignored via `.ai-workspace/*` + `!plans/` + `!audits/` allowlist-by-exception. Ends the `git add -f` friction that task #20 surfaced. AC-11 amended mid-PR to "no new lint errors vs master" after discovering 40 pre-existing `no-explicit-any` errors in `server/**/*.test.ts` have been latent on master because CI never ran `npm run lint`; fix tracked as separate follow-up task #34. ([#207](https://github.com/ziyilam3999/forge-harness/pull/207))

## [0.30.2](https://github.com/ziyilam3999/forge-harness/compare/v0.30.1...v0.30.2) (2026-04-14)

### Miscellaneous

- **docs(q0.5):** verification sweep — F59 phantom citations replaced across 4 plan files; line 288 self-reflexive AC marked RETRACTED; 5 P62/P63 + 3 F55/F56 mis-citations flagged without auto-correction; SUPERSEDED note on `ac-authoring-guidelines.md:3` verified PASS; new audit report at `.ai-workspace/audits/2026-04-14-q05-verification-sweep.md`; 4 gitignored plan files force-added for reviewability. Zero code changes. ([#206](https://github.com/ziyilam3999/forge-harness/pull/206))

## [0.30.1](https://github.com/ziyilam3999/forge-harness/compare/v0.30.0...v0.30.1) (2026-04-14)

### Miscellaneous

- **q05-a3bis polish:** batch-close ship-review enhancements #198–#203 ([#204](https://github.com/ziyilam3999/forge-harness/pull/204))
  - **#198:** force branch reports `"forced"` instead of a fabricated `"rule-change"`. `LintRefreshTriggerReason` gains `"forced"`.
  - **#199:** `LintRefreshStaleEntry.isObsolete` flags exemptions whose re-lint produced zero findings (safe to drop).
  - **#200:** `collectStaleEntries` caches `lintAcCommand(ac.command)` by `ac.id` across per-AC and plan-level loops, eliminating redundant re-lints on overlapping plan-level exempts.
  - **#201:** `computePlanSlug` uses `path.parse(planPath).name`, handling arbitrary extensions (yaml, json, none).
  - **#202:** `plan.test.ts` lintRefresh block hoists `node:fs`/`node:path`/`node:os` to top-of-file ESM imports.
  - **#203:** Exports `__resetAcLintRulesHashCache()` test helper (underscore prefix signals test-only API).
  - 4 new micro-tests (AC-bis-polish-01..04); full suite 719 passed, 4 skipped.
- **q05-a3 follow-up filed:** retroactive-critique hook de-dup + in-session fallback tracked as #205 (sibling of #192/#193/#194), per forge-plan's q05-a3bis round-0 verdict ask. Not in this release.

## [0.30.0](https://github.com/ziyilam3999/forge-harness/compare/v0.29.1...v0.30.0) (2026-04-14)

### Features

- **q05-a3bis:** dual-trigger lintExempt refresh + plan.ts hook ([#197](https://github.com/ziyilam3999/forge-harness/pull/197))
  - New `forge_lint_refresh` primitive re-validates every `lintExempt` (per-AC AND plan-level) against the current ac-lint rule surface. Two staleness triggers: `rule-change` (sha256 drift of `AC_SUBPROCESS_RULES_PROMPT` + `AC_LINT_RULES` via new `getAcLintRulesHash()`) and `14d-elapsed` (calendar timeout).
  - Auto-fires as a non-fatal side effect at the end of `forge_plan(documentTier: "update")` when `planPath` is provided. Hook failure is swallowed into `lintRefresh: { error }` so the update path is never blocked.
  - Reports only — never mutates the plan. Humans (or a follow-up `forge_reconcile`) decide whether to drop, rewrite, or re-accept each stale exemption.
  - Audit state persists under `.ai-workspace/lint-audit/{planSlug}.audit.json`. Slug format `<parentDir>__<basename>` for cross-dir collision resistance.
  - 16 new tests: AC-bis-01..13 all binary-pass. 720 total tests green.
  - Follow-up polish issues #198–203 tracked from ship-review.

## [0.29.1](https://github.com/ziyilam3999/forge-harness/compare/v0.29.0...v0.29.1) (2026-04-14)

### Miscellaneous

- **docs:** Windows env handoff setup guide for MCP authentication ([#195](https://github.com/ziyilam3999/forge-harness/pull/195))
  - Document the launch-context mismatch that causes MCP child processes to 401 on every `trackedCallClaude` call when `ANTHROPIC_API_KEY` is only in `~/.bashrc` and Claude Code is launched from a non-Git-Bash context (Start menu, cmd, PowerShell, Task Scheduler).
  - Includes `setx` one-liner fix that writes the key to `HKCU\Environment` so every Windows launcher inherits it, plus 5 binary verification ACs validated against envy-chan cross-session probes on 2026-04-14.
  - Non-functional change; no code touched. Mac/Linux not affected.

## [0.29.0](https://github.com/ziyilam3999/forge-harness/compare/v0.28.0...v0.29.0) (2026-04-14)

### Features

- **q05-a3:** CriterionResult.reliability full split + divergence forward-split ([#191](https://github.com/ziyilam3999/forge-harness/pull/191))
  - Extend `CriterionResult.reliability` union from `trusted|suspect` to `trusted|suspect|unverified` (closes the slot reserved in A1b's type JSDoc).
  - **Option 2 detection** (per forge-plan T1545 thread `q05-a3`): an AC is tagged `unverified` iff `lint.findings.some(f => f.exempt === true)` — a per-AC `lintExempt` entry actually suppressed a real finding this run. Vestigial exemptions (declared but nothing matched) stay `trusted`. Plan-level `ExecutionPlan.lintExempt[]` (scope "plan") is OUT OF SCOPE and reports `trusted` by construction; plan-level coverage deferred to Q0.5/A3-bis.
  - `ForwardDivergence` gains an optional `reliability?` field; `handleDivergenceEval` propagates it per-entry and the `DivergenceReport.summary` string now reports `N trusted / M suspect / K unverified` instead of a single count. Task #13 headline: "Divergence mode splits real vs suspect failures."
  - `EvalReport.warnings[]` carries an aggregate unverified-count entry when any criterion is unverified. When `ac.flaky === true` AND the exemption fired, a dedicated per-AC warning is pushed (greppable via `/flaky.*lintExempt|lintExempt.*flaky/i`) so analytics can find degraded-confidence ACs without a rolled-up count hiding the signal.
  - `computeVerdict` unchanged: `unverified` is a soft signal, never downgrades verdict. `lintExempt` is an intentional author escape hatch; downgrading would neuter it. Surfacing as a warning is the middle ground.
  - Tests: 6 new cases (AC-A3-02 firing, AC-A3-02b vestigial, AC-A3-03 firing+FAIL, AC-A3-04 no-exempt, dual-flag collision, AC-A3-06/-07 divergence split + summary string). Suite: 699 pass (up from 693).
  - Round-0 self-review found 0 bugs, 3 enhancements filed as [#192](https://github.com/ziyilam3999/forge-harness/issues/192)/[#193](https://github.com/ziyilam3999/forge-harness/issues/193)/[#194](https://github.com/ziyilam3999/forge-harness/issues/194).

## [0.28.0](https://github.com/ziyilam3999/forge-harness/compare/v0.27.0...v0.28.0) (2026-04-14)

### Features

- **q05-c1:** critic eval mode + ac-lint polish + retroactive-critique hook (#183)
  - `forge_evaluate(evaluationMode: "critic")` — new handler globs `.ai-workspace/plans/*.json` (or explicit `planPaths`), per-plan failure tolerance, aggregates into `CriticEvalReport.results[]`, writes `RunRecord.criticReport?` additive optional field.
  - `scripts/ac-lint-hook.sh` polish (8/9 items): E1+E5 anchored glob, E2 whitespace strip, E4 script-location root with `CLAUDE_PROJECT_DIR` override, M1 explicit stdin-parse diagnostic, M2 linter-crashed `additionalContext`, M3 deterministic sentinel test, M4 here-string empty-stdin test. E3 (single-file lint passthrough) deferred to a follow-up micro-PR per forge-plan T1135.
  - Retroactive-critique hook unparked from `.deferred-c1-retroactive/`: `scripts/retroactive-critique-hook.sh` + test + 4 rule fixtures, wired via `.claude/settings.json` PostToolUse chain (now 2 commands), `.github/workflows/retroactive-critique.yml` CI stub deleted.
  - Closes BUG-C1-CRITIC-MODE, AC-09 Part B (retroactive-critique same-turn timing validated live on `server/lib/prompts/critic.ts`).

## [0.27.0](https://github.com/ziyilam3999/forge-harness/compare/v0.26.0...v0.27.0) (2026-04-14)

### Features

- **q05-c1:** ship ac-lint hook standalone, defer retroactive-critique (BUG-C1-CRITIC-MODE) (#177)

## [0.26.0](https://github.com/ziyilam3999/forge-harness/compare/v0.25.0...v0.26.0) (2026-04-13)

### Features

* **ac-lint:** Q0.5/C1-bis plan-level lintExempt + bootstrap absorption (#176)

## [0.25.0](https://github.com/ziyilam3999/forge-harness/compare/v0.24.2...v0.25.0) (2026-04-13)

### Features

- **evaluate:** Q0.5/B1 `forge_evaluate(mode: "smoke-test")` — authoring-time AC characterization ([#175](https://github.com/ziyilam3999/forge-harness/pull/175)). New permanent evaluator mode that runs each AC in a plan ONCE in a headless subprocess at authoring time and reports one of five verdicts: `ok` (terminated cleanly under 80% of budget), `slow` (terminated but > 80% of budget — optionally `timeoutRisk: true` if no explicit `smokeTimeoutMs` override), `empty-evidence` (non-zero exit with zero stdout+stderr bytes), `hung` (hit timeout kill), or `skipped-suspect` (ac-lint flagged the command shape before execution, no subprocess spawned). Defense in depth alongside Q0.5/A1 ac-lint: A1 catches bad command *shapes* statically, B1 catches bad runtime *behavior* dynamically. New `smokeExecute` primitive in `server/lib/executor.ts` returns raw characterization (exitCode, elapsedMs, byte counts, hungOnTimeout) — sibling of `executeCommand`, shares bash-resolution logic, does NOT translate to PASS/FAIL. New `smokeTestPlan` orchestrator in `server/lib/smoke-runner.ts` applies D2 clamp rules (undefined/NaN/negative/zero → 30000, >180000 → 180000), Windows cold-start 800ms warmup on first *spawned* AC (not first plan AC — corrected in review to handle the AC01-lint-skipped case), catches executor rejections to preserve the `entries.length === ac-count` completeness invariant, and applies strict `typeof === "number" && Number.isFinite && > 0` check for `hadExplicitOverride` so typos like `smokeTimeoutMs: 0 / -5 / NaN` don't silently suppress the slow-verdict warning. New `handleSmokeTest` handler in `server/tools/evaluate.ts` (exact identifier load-bearing for bootstrap detection) writes sidecar `{plan}.smoke.json` next to `planPath` with entries sorted by `acId` for byte-stable output. Schema: `smokeTimeoutMs?: number` added to `AcceptanceCriterion` as plain number — clamp is the single source of truth. Bootstrap detection in `scripts/smoke-gate-check.sh` uses `git ls-tree` (NOT `find`) to inspect origin/master via the git object database, emits `smoke-gate: bootstrap-exempt` iff handleSmokeTest absent on master + present on HEAD + zero `.smoke.json` files on master. Report-only `.github/workflows/smoke-gate.yml` — the C1-analog follow-up PR will flip the gate to binding. +23 new tests (17 smoke-runner + 3 bootstrap including a real-file sanity check + 3 round-1 review-fix pin tests for executor-throw / tight-override / first-spawn warmup). Plan critique trail: v1 → `/coherent-plan` → 0C/3M/7m fixed → v2 → `/coherent-plan` → 0C/1M/6m fixed → v3 implementation. Round-1 cold review: PASS with 0 critical / 0 major / 3 minor / 4 cosmetic — all fixed in-commit (same pattern as #168/#174). CI revealed a P57-class producer/consumer seam bug: the bash regex missed `export async function handleSmokeTest` because local tests used synthetic fixtures without `async`. Fixed in ship-fix-1 commit `0907be1` with a new sanity-check test that reads the real `evaluate.ts` on disk and asserts the regex matches it.

## [0.24.2](https://github.com/ziyilam3999/forge-harness/compare/v0.24.1...v0.24.2) (2026-04-13)

### Bug Fixes

- **evaluator:** Q0.5/C2 reactivate `flaky` field with retry-on-failure ([#174](https://github.com/ziyilam3999/forge-harness/pull/174)) — closes **F59** ("Reserved for Future Use" escape hatches become dead code). The `flaky?: boolean` field on `AcceptanceCriterion` was inert metadata since Phase 1; this wires it up as a runtime retry gate. When `flaky: true` and run-1 returns FAIL, the evaluator waits `flakyRetryGapMs` (default 500ms) and retries once. Semantics: run-1 PASS → PASS/trusted; run-1 FAIL + run-2 PASS → PASS with `reliability: "suspect"` and evidence prefix `flaky-retry: first-run FAIL, retry PASS — ...`; both FAIL → FAIL/trusted. ac-lint-flagged ACs bypass the retry gate structurally via the A1b short-circuit. PASS+suspect does NOT poison `computeVerdict` (only `SKIPPED+suspect` does, per #168). Planner prompt updated: removed "Do NOT include flaky" directive and added when-to-annotate guidance with explicit anti-laundering warning. +7 new evaluator tests (5 core semantics + 2 edge-case run-1-INCONCLUSIVE and run-2-INCONCLUSIVE pinning the evidence-prefix accuracy). Input-validation clamp `Math.max(0, ...)` + `Number.isFinite` on `flakyRetryGapMs`. First of three parallel unblocker tracks {B1, C1, C2} — unblocks A3.

## [0.24.1](https://github.com/ziyilam3999/forge-harness/compare/v0.24.0...v0.24.1) (2026-04-13)

### Bug Fixes

- **evaluator:** #168 `computeVerdict` must not launder `SKIPPED+suspect` as PASS ([#173](https://github.com/ziyilam3999/forge-harness/pull/173)) — Q0.5 closure blocker. A story whose ACs were ALL short-circuited by ac-lint (`SKIPPED` with `reliability:"suspect"`) previously returned verdict `PASS`. Now returns `INCONCLUSIVE`. Precedence: `FAIL > INCONCLUSIVE > suspect-skip > PASS`. +4 aggregation tests; existing A1b suspect test extended to assert `report.verdict`.

## [0.24.0](https://github.com/ziyilam3999/forge-harness/compare/v0.23.0...v0.24.0) (2026-04-13)

### Features

* **q0.5-a2:** critic parity + structured AC_LINT_RULES export + regex hardening ([#169](https://github.com/ziyilam3999/forge-harness/pull/169)) — critic.ts now imports `AC_SUBPROCESS_RULES_PROMPT` + `AC_LINT_RULES` from shared module, new check category #9 "Subprocess Safety", and `renderAcLintRulesForCritic()` emits structured markdown bullets so critic findings can cite rule ids with wrong/right examples. `AcLintRule` extended with `wrongExample`/`rightExample` fields (populated from old JSDoc; zero behavior change to `lintAcCommand`). Regex hardening from forge-plan round-2 cold review: **MAJOR-2** F36-source-tree-grep false positive on `&&`/`||`/`;` chains fixed via structural anchoring (require path as direct grep argument, not trailing text); **MINOR-3** F36-raw-rg now matches bare-word args with negative lookahead allowing `rg --help`/`--version`; **MINOR-4** F56-multigrep matches `||` and `;`, not just `&&`; **MINOR-5** F56-passed-grep matches `grep -qE 'passed|failed'` and `grep -q passed` (unquoted). 640 tests pass, 4 skipped (+18 new). Follow-ups: #170 (tighter --help lookahead), #171 (passed.txt FP edge), #172 (multi-`-e` grep form).

## [0.23.0](https://github.com/ziyilam3999/forge-harness/compare/v0.22.0...v0.23.0) (2026-04-13)

### Features

* **q0.5-a1:** ac-lint module + shared subprocess rules + primitive wiring ([#167](https://github.com/ziyilam3999/forge-harness/pull/167)) — new `server/lib/prompts/shared/ac-subprocess-rules.ts` single-source-of-truth for F55/F56/F36 subprocess-safety rules; `planner.ts` now imports; new `server/validation/ac-lint.ts` with 5 deny-list rules + per-rule `lintExempt` override + governance cap of 3. Wired into `forge_plan` (advisory + `strictLint: true` throw mode) and `forge_evaluate` (suspect ACs short-circuit to SKIPPED without spawning subprocesses). Minimum A3 slice: optional `CriterionResult.reliability?: "trusted" | "suspect"`. `.github/workflows/ac-lint.yml` advisory-only with preflight ordering gate; `retroactive-critique.yml` stub lands same PR to satisfy gate (Q0.5/C1 replaces the stub body later). PH01-US-06 lint verification: exactly 6 suspect findings matching plan Appendix A. 622 tests pass (+31 new).
* **q0-l6-followup:** Q0/L4 anchor `q0L4ProvenBy` set to L6 merge SHA ([#166](https://github.com/ziyilam3999/forge-harness/pull/166)) — watchdog "proven" state activated.

### Miscellaneous

None.

## [0.22.0](https://github.com/ziyilam3999/forge-harness/compare/v0.21.0...v0.22.0) (2026-04-13)

### Features

* **reconcile:** L4 audit log accuracy + failure-status disambiguation ([#161](https://github.com/ziyilam3999/forge-harness/pull/161)) — `conflicts[].winningCategory` Pass 2b rewrite fixes stale values in 3-way precedence overlaps; `ReconcileStatus` gains `"failed"` to distinguish all-failed from half-success; `haltedOnNoteId` → `haltedOnNoteIndex` rename (zero live consumers pre-v0.21.0)
* **q0-l4:** anchor file + deadline watchdog + fill workflow ([#162](https://github.com/ziyilam3999/forge-harness/pull/162)) — 14-day deferred-dogfood proof mechanism. `.ai-workspace/q0-l4-anchor.json` ships with real Q0 merge metadata + new `q0FillMode: "bootstrap"` enum. Post-merge fill workflow uses `gh pr merge --auto --squash`. Daily cron watchdog opens `q0-l4-anchor-incomplete` (sha256-idempotent) and `q0-l4-unproven` tracking issues. Pure TypeScript evaluator at `server/lib/q0-l4-deadline.ts` is the authoritative logic source; YAML delegates via `node --input-type=module`
* **plan,reconcile:** structured `updatedPlan`/`critiqueRounds` sidecar ([#164](https://github.com/ziyilam3999/forge-harness/pull/164)) — Q0/L5 closes the `forge_plan(documentTier: "update")` orphan. `handleUpdatePlan` now returns additive top-level fields alongside the existing text envelope (P50 additive). `server/tools/reconcile.ts` drops the brittle brace-counting `parseHandlePlanOutput` extractor in favor of structured reads. Plan.ts negative AC was lifted for this layer only; non-update branches unaffected

### Miscellaneous

* **test(plan):** envelope contract test for `handleUpdatePlan` output ([#163](https://github.com/ziyilam3999/forge-harness/pull/163)) — Q0/L5 pre-flight
* **docs(plan):** clarify gap-found is pre-pass, not `CATEGORY_PRECEDENCE` ([#160](https://github.com/ziyilam3999/forge-harness/pull/160)) — Caveat B amendment

### Breaking changes (internal only)

* **reconcile-output.ts**: `haltedOnNoteId` field renamed to `haltedOnNoteIndex`. Pre-v0.22 serialized records use the old name. Zero live consumers outside this repo — no external migration required
* **reverseFindings[].id**: continues the v0.21.0 migration from LLM-sequential (`REV-NN`) to deterministic hash (`rev-<sha256-12hex>`). Fresh-run-only — no retroactive rewrite

## [0.21.0](https://github.com/ziyilam3999/forge-harness/compare/v0.20.2...v0.21.0) (2026-04-13)

### Features

* **reconcile:** Q0/L2+L3 `forge_reconcile` tool + PhaseTransitionBrief drift fields ([#159](https://github.com/ziyilam3999/forge-harness/pull/159)) — new MCP primitive closing the plan-writeback loop via Intelligent Clipboard pattern (gap-found → JSONL audit, precedence-sorted routing to `handlePlan(update)`, atomic halt on blocking severity). `PhaseTransitionBrief` gains `driftSinceLastPlanUpdate: {reverse, orphaned, dangling}` derived from real reconcileState+masterPlan+phasePlans inputs, with 50-cap overflow spill. `reverseFindings[].id` migrated from LLM-generated `REV-NN` to deterministic `rev-<sha256-12hex>` (fresh-run-only). `server/tools/plan.ts` unmodified (negative AC).

## [0.20.2](https://github.com/ziyilam3999/forge-harness/compare/v0.20.1...v0.20.2) (2026-04-12)

### Miscellaneous

* **plan:** L1b amendment — mark L1a merged, add 5 nit follow-ups + n=2 graduation ([#153](https://github.com/ziyilam3999/forge-harness/pull/153))

## [0.20.1](https://github.com/ziyilam3999/forge-harness/compare/v0.20.0...v0.20.1) (2026-04-12)

### Bug Fixes

- **evaluate:** Add `cwd: input.projectPath` to both `evaluateStory` call sites (BUG-DIV-CWD) — fixes 55 false-negative forward divergence failures where AC commands ran in wrong directory (#151)
- **evaluate:** Add `reverseFindings` optional input to divergence schema — enables session-does-LLM architectural split for OAuth 401 workaround (#151)
- **evaluate:** Add `progress.begin` for reverseFindings branch (ship review B1)

### Miscellaneous

- Tighten REQ-01 AC-3 handleCoherenceEval pattern description (#135)
- Rename generator.ts RunRecord to GeneratorIterationRecord (#136)
- Remove redundant estimatedCostUsd override in handleStoryEval (#137)
- Deduplicate filtered deps in classifyStory/hasFailedTransitiveDep (#138)
- Rename misleading permission-denied test in run-reader (#139)
- S7 divergence measurement post-coordinate docs (#148)

## [0.20.0](https://github.com/ziyilam3999/forge-harness/compare/v0.19.0...v0.20.0) (2026-04-11)

### Features

- **coordinate:** PH-04 MCP handler, config loader, checkpoint gates, integration tests, dogfood — 12-field coordinateInputSchema wired to assessPhase, Zod .strict() config loader with 4 output-shaping fields, halt-hard 3-step state machine, spec-vocabulary-check for PRD drift detection, 43 new tests (#142)

## [0.19.0](https://github.com/ziyilam3999/forge-harness/compare/v0.18.0...v0.19.0) (2026-04-11)

### Features

- **coordinate:** PH-03 replanning notes, reconciliation, graduation, observability — ReplanningNote type (5 categories, 3 severities), collectReplanningNotes, aggregateStatus with velocity/cost, graduateFindings with dedup, reconcileState with orphan/dangling-dep detection (#141)

### Miscellaneous

- **coordinate:** PH-02 budget, time, INCONCLUSIVE, crash recovery (#140)
- **docs:** add projectPath to forge_evaluate in dogfood briefs

## [0.18.0](https://github.com/ziyilam3999/forge-harness/compare/v0.17.1...v0.18.0) (2026-04-10)

### Features

- **generator:** persist GenerationBrief to `.forge/runs/briefs/` — writes full GenerateResult (init brief, fix brief, or escalation) after each forge_generate call for dogfood data traceability (#133)

## [0.17.1](https://github.com/ziyilam3999/forge-harness/compare/v0.17.0...v0.17.1) (2026-04-10)

### Miscellaneous

- **plan:** add AC subprocess contract to forge_plan prompt — prevents F-55/F-56 patterns in generated AC commands (#134)
- **plan:** fix 2 broken AC commands in PH-04 phase plan (captured-output pattern)

## [0.17.0](https://github.com/ziyilam3999/forge-harness/compare/v0.16.6...v0.17.0) (2026-04-10)

### Features

- **coordinate:** PH-01 types, topo sort, state readers, core dispatch loop (#128)
  - CoordinateResult, StoryStatusEntry, PhaseTransitionBrief type definitions
  - Kahn's topological sort with lex tie-break (NFR-C02 determinism)
  - readRunRecords tagged discriminated union (JSON + JSONL dual-source)
  - assessPhase 6-state story classifier (done/ready/blocked/pending/failed/inconclusive)
  - assemblePhaseTransitionBrief signal aggregation
  - Cross-site estimatedCostUsd population at all writeRunRecord call sites
  - detectCycles exported with Story[] signature + JSDoc

### Bug Fixes

- **executor:** resolve absolute bash.exe on Windows (F-05) (#122)
- **codebase-scan:** prune .claude/worktrees and .git/worktrees (F-01) (#121)

## [0.16.6](https://github.com/ziyilam3999/forge-harness/compare/v0.16.5...v0.16.6) (2026-04-10)

### Miscellaneous

* forge_coordinate PH04-US-05 — new story adds mechanical spec-vs-types vocabulary-drift check to forge_evaluate coherence mode (F-03 secondary fix). Multi-root parser walks both `server/types/` and `server/lib/` so co-located types like RunRecord are covered. PH-04 grows from 5 to 6 stories (master plan total 22 → 23). Pure planning/spec change, no code touched yet ([#126](https://github.com/ziyilam3999/forge-harness/pull/126))

## [0.16.5](https://github.com/ziyilam3999/forge-harness/compare/v0.16.4...v0.16.5) (2026-04-10)

### Miscellaneous

* forge_coordinate PRD v1.2 + PH-01 vocabulary fixes (F-03 + F-04) — Round 4 micro-revision reconciling spec with the EvalReport type (`findings`/`failedAcId` → `criteria`/`id`/`evidence`) and moving canonicalization location from writer to handler via the exported `canonicalizeEvalReport` helper ([#123](https://github.com/ziyilam3999/forge-harness/pull/123))
* dist/ rebuild + postinstall freshness fix ([#120](https://github.com/ziyilam3999/forge-harness/pull/120))
* dist/ drift CI guard + MCP surface smoke test + Build/Release Rigor backlog entry
* forge_evaluate mock-mode affordance backlog entry ([#119](https://github.com/ziyilam3999/forge-harness/pull/119))

## [0.16.4](https://github.com/ziyilam3999/forge-harness/compare/v0.16.3...v0.16.4) (2026-04-09)

### Miscellaneous

* forge_coordinate S2 plans — master plan + 4 phase plans (22 stories) + Option B hand-authored coherence report (PASS — 0 CRITICAL / 0 MAJOR / 3 MINOR; 16/16 REQ, 10/10 NFR, 8/8 SC coverage) ([#118](https://github.com/ziyilam3999/forge-harness/pull/118))

## [0.16.3](https://github.com/ziyilam3999/forge-harness/compare/v0.16.2...v0.16.3) (2026-04-09)

### Miscellaneous

* rename generator writeRunRecord to appendGeneratorIterationRecord to eliminate auto-import name collision with canonical run-record.ts writer — prerequisite cleanup before forge_coordinate PH-01 US-00b (Surprise 5) ([#115](https://github.com/ziyilam3999/forge-harness/pull/115))

## [0.16.2](https://github.com/ziyilam3999/forge-harness/compare/v0.16.1...v0.16.2) (2026-04-09)

### Miscellaneous

* forge_coordinate PRD v1.1 — state-machine revision (6-state machine, auto-retry cap=3, embedded EvalReport, needs-replan terminal state) ([#114](https://github.com/ziyilam3999/forge-harness/pull/114))
* add windows-latest matrix to unblock NFR-C05 verification ([#113](https://github.com/ziyilam3999/forge-harness/pull/113))

## [0.16.1](https://github.com/ziyilam3999/forge-harness/compare/v0.16.0...v0.16.1) (2026-04-09)

### Bug Fixes

* renumber GAN elements list after PH-01 split (#75) ([#103](https://github.com/ziyilam3999/forge-harness/pull/103))
* remove no-op meta-test in generator.test.ts (#73) ([#102](https://github.com/ziyilam3999/forge-harness/pull/102))
* clarify REQ-03 plateau detection parenthetical in PRD (#68) ([#101](https://github.com/ziyilam3999/forge-harness/pull/101))
* findCallByContent searches across all messages (#65) ([#100](https://github.com/ziyilam3999/forge-harness/pull/100))
* remove hardcoded year from AuditLog cleanup suggestion (#48) ([#97](https://github.com/ziyilam3999/forge-harness/pull/97))
* defensive copy of stages in ProgressReporter (#47) ([#96](https://github.com/ziyilam3999/forge-harness/pull/96))
* clarify test name for multi-pattern AC coupling detection (#41) ([#95](https://github.com/ziyilam3999/forge-harness/pull/95))
* add resetClient() for Anthropic singleton (#7) ([#94](https://github.com/ziyilam3999/forge-harness/pull/94))
* use import.meta.url instead of process.cwd() in NFR-01 tests (#88) ([#93](https://github.com/ziyilam3999/forge-harness/pull/93))
* static readdir import + merge duplicate audit tests (#81) ([#92](https://github.com/ziyilam3999/forge-harness/pull/92))
* extractScore captures last score on escalation (#79) ([#91](https://github.com/ziyilam3999/forge-harness/pull/91))
* replace pseudocode in ReplanningNote routing rules (#76) ([#90](https://github.com/ziyilam3999/forge-harness/pull/90))
* runtime guards for baselineCheck and lineage ([#108](https://github.com/ziyilam3999/forge-harness/pull/108))

### Miscellaneous

* add forge_coordinate PRD (22-story plan) ([#109](https://github.com/ziyilam3999/forge-harness/pull/109)) — Session 1 deliverable for the 4th forge primitive: 16 REQs / 10 NFRs / 8 SCs, full REQ→story traceability table, 22 findings applied from `/double-critique`
* use opendir() with early exit for file count check ([#107](https://github.com/ziyilam3999/forge-harness/pull/107))
* per-stage start time map for robustness ([#106](https://github.com/ziyilam3999/forge-harness/pull/106))
* remove redundant type assertions in readOAuthToken ([#105](https://github.com/ziyilam3999/forge-harness/pull/105))
* parallelize readContextFiles with Promise.all (#84) ([#104](https://github.com/ziyilam3999/forge-harness/pull/104))
* extract buildRunRecord helper for evaluate handlers (#58) ([#99](https://github.com/ziyilam3999/forge-harness/pull/99))
* share ValidationResult interface across validators (#53) ([#98](https://github.com/ziyilam3999/forge-harness/pull/98))

## [0.16.0](https://github.com/ziyilam3999/forge-harness/compare/v0.15.0...v0.16.0) (2026-04-07)

### Features

- implement PH-04 MCP handler, registration, and integration tests for forge_generate (#85) — expands input schema with all 15 AssembleInput fields, wires handleGenerate to assembleGenerateResultWithContext, adds 23 integration tests covering full init→fix→escalate cycle and all 6 NFRs, includes dogfood report

## [0.15.0](https://github.com/ziyilam3999/forge-harness/compare/v0.14.0...v0.15.0) (2026-04-07)

### Features

- implement PH-03 three-tier document integration for forge_generate (#82) — documentContext (REQ-09), contextFiles injection (REQ-10), lineage pass-through (REQ-11)

## [0.14.0](https://github.com/ziyilam3999/forge-harness/compare/v0.13.1...v0.14.0) (2026-04-07)

### Features

- implement PH-02 infrastructure integration for forge_generate (#77) — RunContext wiring, JSONL self-tracking, cost estimation (REQ-08, REQ-12, REQ-16)

## [0.13.1](https://github.com/ziyilam3999/forge-harness/compare/v0.13.0...v0.13.1) (2026-04-07)

### Miscellaneous

- Intelligent Clipboard per-primitive classification, ReplanningNote type sketch, and PH-01 backlog update (#74)

## [0.13.0](https://github.com/ziyilam3999/forge-harness/compare/v0.12.1...v0.13.0) (2026-04-07)

### Features

- implement PH-01 types, schema, and core loop for forge_generate (#71)

## [0.12.1](https://github.com/ziyilam3999/forge-harness/compare/v0.12.0...v0.12.1) (2026-04-07)

### Miscellaneous

- Clarify three-tier integration scope in coordinator backlog — explicitly specify reconciliation of both phase plans and master plans after each phase (#70)

## [0.12.0](https://github.com/ziyilam3999/forge-harness/compare/v0.11.1...v0.12.0) (2026-04-07)

### Features

- forge_generate master plan, phase plans, and coherence report — PRD with 16 REQs/6 NFRs/9 SCs, MasterPlan v1.0.0 (4 phases), 4 ExecutionPlan v3.0.0 phase plans (18 stories, 93 ACs), coherence eval zero gaps (#66)

## [0.11.1](https://github.com/ziyilam3999/forge-harness/compare/v0.11.0...v0.11.1) (2026-04-06)

### Bug Fixes

- Windows compat & test resilience — fix non-existent path test on Windows, replace Unix-only tail/head in dogfood ACs, extract shared test utils, replace magic mock indices (#60, #61, #62) (#63)

## [0.11.0](https://github.com/ziyilam3999/forge-harness/compare/v0.10.0...v0.11.0) (2026-04-06)

### Features

- Step 6 dogfood + integration tests for three-tier document system — mocked 3-tier flow integration test (PRD → master → phase → coherence eval, 6 tests) and forward divergence dogfood test verifying built deliverables against real codebase (10 tests, 16 ACs) (#59)

## [0.10.0](https://github.com/ziyilam3999/forge-harness/compare/v0.9.0...v0.10.0) (2026-04-06)

### Features

- Coherence and divergence evaluation modes for `forge_evaluate` — LLM-judged tier alignment (PRD ↔ master plan ↔ phase plans) and forward/reverse divergence detection with graceful degradation, discriminated input schema, and 32 tests (#56)

## [0.9.0](https://github.com/ziyilam3999/forge-harness/compare/v0.8.0...v0.9.0) (2026-04-06)

### Features

- Tier-aware prompts and `documentTier` pipeline routing for three-tier document system — master (vision → phases), phase (phase → stories with ACs), update (revise from implementation notes), with full backward compatibility (#54)

## [0.8.0](https://github.com/ziyilam3999/forge-harness/compare/v0.7.0...v0.8.0) (2026-04-06)

### Features

- MasterPlan v1.0.0 types and validation for three-tier document system — phases with dependencies, I/O chains, and DFS cycle detection (#52)
- ExecutionPlan gains optional `documentTier` and `phaseId` fields (backward compatible)

## [0.7.0](https://github.com/ziyilam3999/forge-harness/compare/v0.6.0...v0.7.0) (2026-04-06)

### Features

- cross-cutting observability infrastructure: CostTracker (token/USD accounting), ProgressReporter (stderr stage logging), AuditLog (JSONL decision trail), RunContext bundle, and trackedCallClaude wrapper (#46)
- all 4 callClaude sites in plan.ts migrated to trackedCallClaude for automatic token tracking, progress, and audit

## [0.6.0](https://github.com/ziyilam3999/forge-harness/compare/v0.5.0...v0.6.0) (2026-04-06)

### Features

- context injection parameter for forge_plan — inject memory, KB, and prior plans via `context` array with whole-entry truncation at `maxContextChars` (#42)
- enhanced codebase scanner extracts structured dependency names+versions from package.json (#42)
- run records written to `.forge/runs/` after each forge_plan invocation for self-improvement analytics (#42)

## [0.5.0](https://github.com/ziyilam3999/forge-harness/compare/v0.4.2...v0.5.0) (2026-04-06)

### Features

- functional AC rules, implementation coupling detection (Tier 1 regex), and evidence-gating for planner claims (#38)
- improve mode auto-detection with word boundaries (#32)

### Refactors

- callClaude jsonMode returns parsed JSON (#31)
- test planner prompt rules with direct buildPlannerPrompt() calls (#37)
- route timeout/error evidence through truncateEvidence (#36)
- remove dead extractJson branch in loadPlan (#35)

### Miscellaneous

- align CHANGELOG style to plain prose (#34)
- remove unused asExecutionPlan export (#33)

## [0.4.2](https://github.com/ziyilam3999/forge-harness/compare/v0.4.1...v0.4.2) (2026-04-03)

### Bug Fixes

- prioritize API key over OAuth and use model alias (#29)

### Miscellaneous

- remove CI code-review (replaced by /ship self-review)

## [0.4.1](https://github.com/ziyilam3999/forge-harness/compare/v0.4.0...v0.4.1) (2026-04-02)

### Bug Fixes

- calibrate planner prompt with D1 and D2 rules (#27)

## [0.4.0](https://github.com/ziyilam3999/forge-harness/compare/v0.3.1...v0.4.0) (2026-04-02)

### Features

- implement forge_evaluate — stateless binary grading tool (Phase 2) (#22)

### Bug Fixes

- use OAuth token directly as Bearer instead of key exchange (#21)

## [0.3.2](https://github.com/ziyilam3999/forge-harness/compare/v0.3.1...v0.3.2) (2026-04-02)

### Bug Fixes

* use OAuth token directly as Bearer instead of key exchange
  - The create_api_key endpoint requires org:create_api_key scope which is not a valid OAuth scope (anthropics/claude-code#20325)
  - Pass authToken to Anthropic SDK constructor — sends Authorization: Bearer header
  - Makes getClient() synchronous; no network call needed for auth setup
  - Explicit clientExpiresAt reset in API-key path prevents stale expiry from evicting a valid cached client

## [0.3.1](https://github.com/ziyilam3999/forge-harness/compare/v0.3.0...v0.3.1) (2026-04-02)

### Bug Fixes

* exchange OAuth token for API key before inference calls (#14)
  - OAuth access tokens cannot be used as Bearer tokens with api.anthropic.com
  - Exchange via /api/oauth/claude_cli/create_api_key (same as Claude Code)
  - Promise-based singleton to deduplicate concurrent cold-start requests
  - Evict cached client 10 min before OAuth token expiry to prevent dead zone
  - Clear rejected promise so callers retry on transient failure

## [0.3.0](https://github.com/ziyilam3999/forge-harness/compare/v0.2.0...v0.3.0) (2026-04-02)

### Features

* use Claude OAuth token as primary auth, fall back to API key (#11)
  - Reads OAuth token from ~/.claude/.credentials.json (Claude Code Max)
  - Falls back to ANTHROPIC_API_KEY for standalone/CI use
  - No separate API billing needed

## [0.2.0](https://github.com/ziyilam3999/forge-harness/compare/v0.1.0...v0.2.0) (2026-04-02)

### Features

* implement forge_plan with double-critique pipeline (#4)
  - Claude API integration via @anthropic-ai/sdk
  - Planner/critic/corrector prompt pipeline
  - Schema validation with DFS cycle detection
  - Codebase scanner with depth and character limits
  - Three critique tiers: quick, standard, thorough
  - 46 unit tests

## [0.1.0](https://github.com/ziyilam3999/forge-harness/commits/v0.1.0) (2026-04-02)

### Features

* project initialization with ESM TypeScript scaffold
