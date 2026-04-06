# Changelog

All notable changes to this project will be documented in this file.

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
