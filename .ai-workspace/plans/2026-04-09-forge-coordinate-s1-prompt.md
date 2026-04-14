# Session 1 Prompt: forge_coordinate PRD via /prd skill

> **Context:** This is the regenerated Session 1 prompt for the forge_coordinate implementation, replacing the stale prompt in `.ai-workspace/plans/2026-04-08-forge-coordinate-sessions.md`. Reflects the current 22-story plan after 6 critique rounds.
>
> **Target agent:** lucky-iris (or any Claude Code session with `/prd` skill installed)
>
> **Delivery:** Copy the prompt body below into the mailbox message at `C:\Users\ziyil\claude-code-mailbox\mailbox\inbox\2026-04-09-forge-plan-to-lucky-iris-s1-coordinate-prd.md` (or update the existing stale file in place).
>
> **Expected output:** `docs/forge-coordinate-prd.md` + PR via `/ship`

---

## Prompt body (copy into mailbox)

```
I want to create a PRD for the forge_coordinate primitive using the /prd skill.

## Read these reference files FIRST (in this order)

1. `.ai-workspace/PROJECT-INDEX.md` — project knowledge index, orient here first
2. `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` — **the authoritative implementation plan** (22 stories, 4 phases, 10 NFRs, post-critique final state)
3. `docs/forge-harness-plan.md` — parent design doc for the forge ecosystem (forge_coordinate section around lines 314-352)
4. `docs/primitive-backlog.md` — coordinate backlog + the "Scope Boundary Decisions" section that explains why certain features are external skills rather than primitives
5. `docs/forge-generate-prd.md` — reference PRD format and style template (16 REQs, 6 NFRs, 9 SCs — use as your target shape)
6. `server/tools/coordinate.ts` — current 16-line stub (what exists today)
7. `server/types/execution-plan.ts`, `server/types/master-plan.ts` — the data structures forge_coordinate reads

## Key context for the /prd interview

### What forge_coordinate is

- **The 4th and final forge primitive** — lightweight orchestrator that composes forge_plan + forge_generate + forge_evaluate into complete workflows
- **Advisory mode (v1, default) is $0** — zero LLM calls (enforced by NFR-C01)
- It reads state from `.forge/runs/*.json` (individual JSON) and `.forge/runs/data.jsonl` (JSONL from generator), topologically sorts stories, classifies them as done/ready/blocked/pending, checks budget/time, and returns a structured `PhaseTransitionBrief`
- The calling Claude Code session decides what to do with the brief — coordinate itself never executes stories (**Intelligent Clipboard pattern**)
- **Autonomous mode** (LLM-powered triage for ambiguous state) is deferred to v2

### What forge_coordinate is NOT

- NOT a story executor — the caller runs forge_generate + forge_evaluate on "ready" stories, then calls coordinate again for updated recommendations
- NOT an autonomous agent in v1 — all logic is mechanical signal aggregation, no LLM calls
- NOT a replacement for forge_plan/generate/evaluate — it **composes** them, not replaces
- NOT stateful — stateless per call, reads all state from files each time

### Critical technical facts (from the implementation plan)

- **22 stories across 4 phases: 8 + 4 + 5 + 5 = 22**
  - PH-01: Types, Topological Sort, State Readers, Core Dispatch Loop (8 stories including US-00a + US-00b pre-reqs)
  - PH-02: Safety & Budget Enforcement (4 stories)
  - PH-03: ReplanningNote, Reconciliation, Observability (5 stories)
  - PH-04: MCP Handler, Config Loader, Checkpoint Gates, Integration Tests, Dogfood (5 stories, includes US-01.5 config loader)

- **Critical pre-requisite (PH-01 US-00a):** forge_evaluate's `handleStoryEval` (evaluate.ts lines 121-137) currently writes NO RunRecord and has NO RunContext infrastructure. Adding it is a ~40 LOC change matching the `handleCoherenceEval` pattern (RunContext construction + cost tracking + audit logging + writeRunRecord call with storyId + evalVerdict + estimatedCostUsd). Without this, coordinate cannot read story eval results.

- **Cross-site pre-req (PH-01 US-00b):** Every OTHER `writeRunRecord` call site in `server/` must populate `estimatedCostUsd` from local `CostTracker.totalCostUsd`. Otherwise budget aggregation is blind to generate/plan/coherence/divergence costs. Pre-req check: `grep -rn "writeRunRecord" server/` to enumerate sites, plus `grep CostTracker server/tools/evaluate.ts` to verify the tracker is in-scope at each site (refactor by threading through if not).

- **Dual RunRecord systems with tagged discriminated union:**
  - Primary source: `server/lib/run-record.ts` writes individual JSON files, AUTHORITATIVE for story status after US-00a adds `storyId` + `evalVerdict` fields
  - Supplementary source: `server/lib/generator.ts` writes JSONL, provides velocity/iteration data ONLY, cannot determine story completion
  - `readRunRecords()` returns `ReadonlyArray<PrimaryRecord | GeneratorRecord>` — consumers explicitly filter by `source`

- **`phaseId` is required in v1** — auto-detection deferred to v2 because `MasterPlan.Phase` has no `planPath` field

- **`detectCycles` signature change** — currently private `Array<Record<string, unknown>>`, changing to `Story[]` directly and exporting from `server/validation/execution-plan.ts` (safe: no external callers)

- **Optional `.forge/coordinate.config.json`** with exactly **4 output-shaping fields** — `storyOrdering`, `phaseBoundaryBehavior`, `briefVerbosity`, `observability.*`. These are NOT resource caps. `budgetUsd`, `maxTimeMs`, and `escalationThresholds` were explicitly rejected as unsuitable for Max-plan supervised runs (documented in `docs/primitive-backlog.md` "Configuration File Design Decisions"). They remain accepted as MCP input args but not as config file fields.

- **`haltClearedByHuman`** is an MCP input arg that clears `phaseBoundaryBehavior: "halt-hard"` state. The halt-hard synthetic blocking ReplanningNote is brief-only (never persisted to disk). Clearing is idempotent and stateless (no hidden state file).

### 10 NFRs (use these as the NFR section of your PRD)

- **NFR-C01:** Advisory mode = $0 (no `callClaude`/`trackedCallClaude` in coordinator's dependency chain)
- **NFR-C02:** Deterministic dispatch (same plan → same topo sort; Kahn's ready-queue in stable lex order by `story.id`)
- **NFR-C03:** Crash-safe state (re-run after kill → no duplicate work)
- **NFR-C04:** Budget = advisory signal, not kill (brief returns `warningLevel: "exceeded"`; caller enforces)
- **NFR-C05:** Windows compatibility (no colons in filenames, `path.join` everywhere)
- **NFR-C06:** Graceful degradation (parse errors via `console.error` per P44, don't throw)
- **NFR-C07:** Schema 3.0.0 compatible (accepts any valid ExecutionPlan v3.0.0)
- **NFR-C08:** Brief completeness (all signals present, nothing omitted silently)
- **NFR-C09:** Null-cost visibility (`budget.incompleteData = true` when cost missing; P45 warning; never silent $0)
- **NFR-C10:** Config file zero-impact when absent/empty (binary golden-file byte comparison, excludes `configSource` which is provenance-only)

### Integration requirements

- Must use existing infrastructure: `RunContext`, `CostTracker`, `ProgressReporter`, `AuditLog` (shipped in v0.7.0)
- Must be **read-only with respect to other tools' state** — coordinate writes only its own RunRecord at the end via `writeRunRecord()`
- Must be **stateless per call** (reads all state from files each invocation)

## PRD scope and style

The PRD captures **WHAT** and **WHY**, not **HOW**:

- **Problem statement:** Why forge_coordinate exists. What gap it fills in the forge ecosystem after forge_plan + forge_generate + forge_evaluate shipped.
- **Vision / user outcomes:** What a forge user can now do that they couldn't before. Focus on the "one call returns a structured next-action brief" loop and the "no more manual plan-tracking" benefit.
- **REQ-NN functional requirements** with binary, shell-executable acceptance criteria. Map every REQ to at least one story in the implementation plan.
- **NFR-CNN non-functional requirements** — mirror the 10 NFRs above (NFR-C01 through NFR-C10) with each NFR's verification command/method
- **SC-NN success criteria** — how we know v1 is done (e.g., "all 22 stories pass their ACs", "divergence count vs 80-item baseline shows no regression", "advisory mode verified $0 via NFR-C01 grep check")
- **Out-of-scope section** — explicitly list:
  - Autonomous mode (LLM-powered triage) — deferred to v2
  - Phase auto-detection — deferred (MasterPlan.Phase has no planPath field)
  - Concurrency / affectedPaths-based parallelism — deferred (v1 is strictly sequential)
  - Cross-project memory retrieval — OUT of forge-harness scope (external skill, see scope boundary decisions)
  - Resource caps in config file (budgetUsd, maxTimeMs, escalationThresholds) — rejected as unsuitable for supervised Max-plan runs
- **Reference section** — point to `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` as the authoritative technical how

**Style template:** Use `docs/forge-generate-prd.md` as your PRD shape (it has 16 REQs, 6 NFRs, 9 SCs — aim for similar density and binary-AC rigor).

## Output

- Save the PRD to `docs/forge-coordinate-prd.md`
- Ship as a PR via `/ship` with title: `docs: add forge_coordinate PRD (22-story plan)`
- After merging, use `/mailbox send` to notify forge-plan that S1 is complete (include PR number, PRD file path, and any interview surprises)

## If anything is unclear

Read the authoritative implementation plan at `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` — it has the full verified codebase state, all post-critique design decisions, and the concrete `PhaseTransitionBrief` interface. If the plan doesn't answer your question, ask forge-plan directly via mailbox rather than guessing.

Run `/prd` and guide me through the interview.
```

---

## Notes (NOT part of the prompt — for forge-plan operator only)

- The prompt body above is self-contained and can be pasted directly into the mailbox without modification
- Reference files listed are all known to exist in the forge-harness repo as of 2026-04-09
- The stale sessions file at `.ai-workspace/plans/2026-04-08-forge-coordinate-sessions.md` can be left as a historical reference — this new prompt supersedes its Session 1 section
- Sessions 2-7 prompts will be written fresh after each preceding session ships, to avoid pre-writing against assumptions that haven't been validated yet
- Expected S1 duration: ~30-60 minutes of interactive interview + PRD drafting + PR

## Changes from the stale Session 1 prompt

| Stale prompt said | New prompt says |
|---|---|
| Parent plan at `~/.claude/plans/piped-sprouting-island.md` (ephemeral) | Parent plan at `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` (persistent) |
| 20 stories (7+4+5+4) | **22 stories (8+4+5+5)** |
| PH-01 US-00 is single story | **US-00a + US-00b split** (interface/handleStoryEval infrastructure vs cross-site estimatedCostUsd population) |
| PH-04 has 4 stories | **PH-04 has 5 stories** (US-01.5 config loader added) |
| `detectCycles accepts Array<Record<string, unknown>>, cast Story[] when calling` | **`detectCycles` signature changed to `Story[]` directly, exported with JSDoc, no cast** |
| 9 NFRs | **10 NFRs (adds NFR-C10 config file zero-impact)** |
| No mention of config file | **4-field output-shaping config schema (storyOrdering, phaseBoundaryBehavior, briefVerbosity, observability.*)** |
| No mention of haltClearedByHuman | **haltClearedByHuman input arg for halt-hard clearing** |
| Missing "rejected resource cap fields" context | **Explicit rejection of budgetUsd/maxTimeMs/escalationThresholds for Max-plan supervised runs** |

Last updated: 2026-04-09T01:30:00+08:00
