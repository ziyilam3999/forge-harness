# S2 Prompt — forge_coordinate Master Plan + Phase Plans + Coherence Eval

**Target agent:** lucky-iris (forge-harness)
**Session:** S2 of the 7-session forge_coordinate build plan
**Upstream artifacts (authoritative):**
- **PRD v1.1:** `docs/forge-coordinate-prd.md` (merged PR #114, tag v0.16.2, 16 REQ / 10 NFR / 8 SC)
- **Impl plan v1.1 (architectural context):** `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` (resynced 2026-04-09T18:45 — 6-state machine, 4-case brief.status rule, `depFailedStories`, embedded `evalReport`, REQ-12 dedup, REQ-13 preservation)

---

## Deliverables

Produce **6 files** and run **1 coherence eval**, then ship via `/ship`.

### File 1 — Master Plan

**Path:** `forge-coordinate-master-plan.json`
**Format:** Three-tier Master Plan JSON (same shape as `forge-generate-master-plan.json` — use that as a template, do NOT invent a new schema)
**Content:**
- `title`: "forge_coordinate Implementation"
- `prdPath`: `docs/forge-coordinate-prd.md`
- **4 phases** matching the impl plan's phase decomposition:
  - **PH-01** — Types, Topological Sort, State Readers, Core Dispatch Loop (8 stories: US-00a, US-00b, US-01, US-02, US-03, US-04, US-05, US-06)
  - **PH-02** — Safety & Budget Enforcement (4 stories: US-01, US-02, US-03, US-04)
  - **PH-03** — ReplanningNote, Reconciliation, Observability (5 stories: US-01, US-02, US-03, US-04, US-05)
  - **PH-04** — MCP Handler, Config Loader, Checkpoint Gates, Integration Tests, Dogfood (5 stories: US-01, US-01.5, US-02, US-03, US-04)
- Each phase: `id`, `title`, `description`, `dependencies` (PH-01 → none; PH-02 → [PH-01]; PH-03 → [PH-01, PH-02]; PH-04 → [PH-02, PH-03]), `inputs`, `outputs`, `estimatedStories` (8/4/5/5)
- **Total: 22 stories** (NOT 20 — the impl plan's US-00 was split into US-00a + US-00b during Round 5, and PH-04 US-01.5 was added during Part 4 triage)

### Files 2-5 — Phase Plans (one per phase)

**Paths:** `forge-coordinate-phase-PH-01.json`, `forge-coordinate-phase-PH-02.json`, `forge-coordinate-phase-PH-03.json`, `forge-coordinate-phase-PH-04.json`
**Format:** Three-tier Phase Plan JSON (same shape as `forge-generate-phase-PH-*.json`)
**Content per phase:**
- `phaseId`, `masterPlanPath`, `prdPath`
- `stories[]` — one entry per story with `id`, `title`, `description`, `dependencies` (intra-phase), `affectedPaths[]`, `acceptanceCriteria[]` (binary — each AC must be objectively pass/fail)
- Story content must match the impl plan's per-story descriptions verbatim for scope and reference REQ IDs from PRD v1.1
- **PH-01 US-00a** must cover: 4 optional fields on RunRecord (`storyId`, `evalVerdict`, `evalReport`, `estimatedCostUsd`), `handleStoryEval` RunContext infrastructure, deterministic serialization AC (sort `evalReport.findings` by `(failedAcId, description)` before write per REQ-01 v1.1)
- **PH-01 US-02** must cover: `detectCycles` signature change to `Story[]` + export with JSDoc, Kahn's algorithm with stable lex-sorted ready-queue by `story.id`, topological as default ordering matching pre-config behavior byte-for-byte
- **PH-01 US-04** (`assessPhase`) must cover: the 6-state precedence chain `done > dep-failed > failed > ready-for-retry > ready > pending`, `retryCount` re-derived from non-PASS primary records (counts both FAIL and INCONCLUSIVE per REQ-04 v1.1), `priorEvalReport` populated from most recent non-PASS record
- **PH-02 US-03** (INCONCLUSIVE) must cover: INCONCLUSIVE flows through retry counter (not terminal), transitive dep-failed propagation only when root terminally `failed`, flaky-eval compensation explicitly rejected
- **PH-03 US-01** (ReplanningNote) must cover: `retries-exhausted` (category ac-drift, blocking, emitted per terminal-failed story) and `dep-failed-chain` (category assumption-changed, blocking, one note per distinct root failed story — binary AC: `replanningNotes.filter(n => n.description.includes("dep-failed-chain")).length === distinctRootFailedCount`)
- **PH-03 US-04** (`graduateFindings`) must cover: REQ-12 v1.1 dedup by `(storyId, escalationReason)` before ≥3 threshold
- **PH-03 US-05** (`reconcileState`) must cover: REQ-13 v1.1 `failed`/`dep-failed` preservation via record persistence + re-derivation, dangling-dep rule (stale dep IDs → `pending` + `evidence: "dep <id> missing from plan"` + P45 warning), 6+ tests including `failed → rename → pending` and `dep-failed → upstream-replanned-away → pending`
- **PH-04 US-01** must cover: `coordinateInputSchema` expansion with `phaseId` (req v1), `startTimeMs`, `haltClearedByHuman`, and the non-latching halt-hard AC (halted phase + injected failure → `needs-replan` on next call, no stale latch)
- **PH-04 US-01.5** must cover: 4-field config loader (`storyOrdering`, `phaseBoundaryBehavior`, `briefVerbosity`, `observability.*`), per-field provenance via `configSource`, 7+ unit tests, `writeRunRecord: false` voids NFR-C03 warning chain
- **PH-04 US-03** must include: the `configSource` end-to-end integration test and the halt-hard 3-step clearing state machine test

### File 6 — Coherence Report

**IMPORTANT — no real API calls.** Per the standing rule "API calls only when no mock", S2 must NOT burn live Anthropic credits on the coherence pass. Pick ONE of:

**Option A — MCP tool in mock mode (preferred if wired):**
```
forge_evaluate({
  mode: "coherence",
  prdPath: "docs/forge-coordinate-prd.md",
  masterPlanPath: "forge-coordinate-master-plan.json",
  phasePlanPaths: [
    "forge-coordinate-phase-PH-01.json",
    "forge-coordinate-phase-PH-02.json",
    "forge-coordinate-phase-PH-03.json",
    "forge-coordinate-phase-PH-04.json"
  ]
})
```
Only acceptable if `forge_evaluate` is configured to use a fixture/mock LLM (e.g., `ANTHROPIC_API_KEY` unset or mock provider). If the tool would actually call Anthropic, **do not run it** — fall back to Option B.

**Option B — hand-authored coherence report:**
- File path: `forge-coordinate-coherence-report.md` (markdown, not JSON — this is a human audit, not a tool output)
- Walk through every **REQ-01..REQ-16**, **NFR-C01..NFR-C10**, and **SC-01..SC-08** from PRD v1.1
- For each: cite which Phase Plan story (`PH-XX US-YY`) and which acceptance criterion covers it, or mark it `GAP` with an explanation
- Emit a findings table with columns: `id | severity | phase | story | description | disposition`
- Apply the same CRITICAL/MAJOR/MINOR severity rubric lucky-iris uses for /double-critique
- This is the dogfood: a human doing what forge_evaluate coherence mode would do, by hand, as a calibration exercise

**Target (both options):** zero CRITICAL / zero MAJOR findings. MINOR findings acceptable with per-finding rationale in the ship PR. If coherence fails on CRITICAL/MAJOR, iterate on the Master Plan + Phase Plans until it passes — do NOT weaken the PRD to satisfy coherence.

---

## Constraints

1. **PRD v1.1 is authoritative.** Do NOT reintroduce v1.0 terms: no `blockedStories`, no 4-state machine, no `status: "blocked"` as phase-level status, no "automatic retry" out-of-scope row, no `proceedWithPartialFailure` escape hatch (explicitly rejected 2026-04-09T17:20 — re-introduction would re-open a latched decision).
2. **NFR-C01 through NFR-C10 must be reachable** from the Phase Plans' acceptance criteria. Every NFR needs at least one story whose ACs collectively verify it. NFR-C02 and NFR-C10 need byte-identical golden-file fixtures.
3. **Dogfood discipline:** S3-S6 will use `forge_generate` to build each phase. Phase Plan ACs must be granular enough for forge_generate to assemble useful briefs (anti-pattern: "make it work" as an AC).
4. **Impl plan is the reference, PRD is the contract.** Story scopes come from the impl plan; acceptance criteria come from the PRD's REQ/NFR/SC IDs. Where they disagree (they shouldn't, post-resync), PRD wins.
5. **Three-tier format is non-negotiable.** Use the existing `forge-generate-*.json` files as the schema template. Same field names, same nesting, same `$schema` URI.

---

## What NOT to do

- Do NOT write a new PRD. PRD v1.1 is shipped at v0.16.2 — if you find a gap, file it as a ReplanningNote-style issue and ask forge-plan before editing.
- Do NOT invent a new three-tier JSON schema.
- Do NOT skip the coherence eval step. The coherence report IS the S2 exit gate.
- Do NOT bundle S2 with any PH-01 implementation work. S2 ships plans + coherence report only. PH-01 code lands in S3.

---

## Reply contract (when you ship S2)

1. All 6 file paths + confirmation they parse as valid JSON against the three-tier schema
2. Coherence report summary: finding counts by severity + disposition per finding
3. PR URL + merge commit + release tag (expected v0.16.3)
4. Any interview surprises (new gaps in PRD v1.1 discovered during plan authoring — I want to know before S3)
5. Confirmation that impl plan v1.1 (`.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md`) was the reference, not the v1.0 version
6. Proposed S3 kickoff timing (I'm ready whenever you are)

After S2 ships, I'll send the S3 prompt for PH-01 (8 stories, dogfood forge_generate).

Go.
