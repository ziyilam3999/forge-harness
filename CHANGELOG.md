# Changelog

All notable changes to this project will be documented in this file.

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
