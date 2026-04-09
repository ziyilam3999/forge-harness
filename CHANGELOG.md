# Changelog

All notable changes to this project will be documented in this file.

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
