# Forge Improvement Research — Three-Tier Document System + Cross-Cutting Infrastructure

**Date:** 2026-04-05
**Source:** Double-critique pipeline R20 on architectural restructuring plan
**Status:** Research complete, needs reframing as forge primitive improvements

## Background

The bidirectional divergence analysis found 93 items (28 forward + 65 reverse) between `docs/forge-harness-plan.md` and the Phase 1-2 implementation. Root causes trace to a structural flaw in how plans are produced: the forge_plan primitive creates monolithic plans that try to be both vision documents and implementation specs, leading to ~35% divergence during implementation.

## Key Insight

The three-tier document system (Vision Doc → Master Plan → Phase Plans) is NOT a one-time documentation restructuring — it is a **product feature to be built into the forge primitives**. When forge_plan creates plans for any project, it should understand and work within this hierarchy.

## Three-Tier Document Architecture

### Tier 1 — Vision Doc
- Final product vision, like an executive summary
- No rigid implementation details
- Should NOT change during implementation (unless a blocker forces a pivot)
- Created via `/prd` skill
- Frozen during implementation

### Tier 2 — Master Plan
- High-level implementation phases, like a table of contents
- Not too rigid on "how"
- Acts as guide of implementation phases, not final detailed spec
- Format: phase table with goal, deliverables, dependencies, status

### Tier 3 — Phase Plans
- Per-phase implementation plan, like a chapter of the book
- Not too rigid on "how" — let implementer decide
- Implementer can request tools needed
- **Updated after implementation** — becomes single source of truth

### Flow
Vision Doc → Master Plan (with phases) → Phase 1 Plan → Implement → Update master + phase plan → Phase N+1 Plan → ... → All phases complete

## Cross-Cutting Infrastructure (for ALL 4 forge tools)

### Cost Estimation
- CostTracker class: tokens per stage, pricing multiplier, running total
- Hardcoded pricing constants + PRICING_LAST_UPDATED
- Advisory budget via isOverBudget(), remainingBudgetUsd()
- OAuth/Max note: "equivalent API cost" label when OAuth detected
- Output: {inputTokens, outputTokens, estimatedCostUsd, breakdown, isOAuthAuth}

### Visible Progress
- ProgressReporter class: dynamic stage list based on tier/config
- Logs to stderr: `forge_plan: [2/4] Running critic round 1...`
- fail() method for partial progress visibility
- Output: {stages: [{name, durationMs, status}]}

### Agent Decision Audit Trail
- AuditLog class: {timestamp, stage, agentRole, decision, reasoning}
- Persisted to .forge/audit/{tool}-{timestamp}.jsonl (Windows-safe)
- Failure policy: warn and continue, never crash
- 1000-file warning threshold
- Coordinate discovers via glob pattern

### RunContext Integration
- Bundles CostTracker + ProgressReporter + AuditLog
- callClaude stays pure — trackedCallClaude wrapper handles observability
- Each tool handler creates RunContext at top

## Per-Tool Improvements

### Plan
- Provide needed tools (context injection, memory/KB access)
- Context parameter: array of {label, content} with maxContextChars truncation
- Future: tool-use API for planner agent

### Generate
- Provide needed tools (file-ops, git-ops)
- GAN loop with max-iteration exit policy
- Git failure handling

### Evaluate
- Proper guardrails (totalTimeoutMs, command filter, parallel ACs)
- Windows process tree kill
- Command filter is defense-in-depth, not security boundary
- maxParallelACs default 4

### Coordinate
- Consolidate cost/progress/audit into meaningful dashboard
- Budget enforcement point
- Topological story dispatch

## Decisions Made (from double-critique R20)
1. Master plan creation: forge creates it (forge_plan + hand-edit)
2. Audit trail: persist to .forge/audit/ JSONL
3. Cost estimation: hardcoded constants, approximate OK
4. Command filter: defense-in-depth, regex on raw string, evasion accepted
5. RunContext: callClaude stays pure, trackedCallClaude wrapper

## Root Cause Mapping
| Root Cause | How Three-Tier Fixes It |
|---|---|
| FP1 (full maturity writing) | Vision doc holds the dream; phase plans scope to NOW |
| FP2 (no priority markers) | Master plan sequences phases explicitly |
| FP3 (schema for end-state) | Each phase plan extends schema only as needed |
| FP4 (doc not updated) | Phase plans updated after implementation |
| RP1 (prompt-as-specification) | Phase plans document behavioral contracts post-implementation |
| RP2 (defensive coding without mandate) | Phase plans document needed guardrails before implementation |
| RP3 (constants as config surface) | Phase plans enumerate operational defaults post-implementation |

## Critique Log (R20)
- Round 1: 0C/3M/6m, 9 findings, 100% applied
- Round 2: 0C/4M/3m, 7 findings, 100% applied
- Total: 16 findings, 100% applied
- Key improvements: dynamic ProgressReporter, trackedCallClaude wrapper, Windows process tree kill, command blocklist as defense-in-depth, OAuth cost labeling, regression TC
