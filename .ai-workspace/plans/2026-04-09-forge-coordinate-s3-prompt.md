# S3 Prompt — forge_coordinate PH-01 Implementation (8 stories, dogfood forge_generate)

**Target agent:** lucky-iris (forge-harness)
**Session:** S3 of the 7-session forge_coordinate build plan
**Upstream artifacts (authoritative):**
- **PRD v1.1:** `docs/forge-coordinate-prd.md` (v0.16.2, 16 REQ / 10 NFR / 8 SC)
- **Impl plan v1.1 (architectural context):** `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` (resynced 2026-04-09T18:45 — 6-state machine, 4-case `brief.status`, `depFailedStories`, embedded `evalReport`, REQ-12 dedup, REQ-13 preservation)
- **Master Plan:** `.ai-workspace/plans/forge-coordinate-master-plan.json` (shipped S2, v0.16.4)
- **PH-01 Phase Plan:** `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` (shipped S2, 8 stories)
- **S2 coherence report:** `.ai-workspace/plans/forge-coordinate-coherence-report.md` (hand-audit PASS, 0C/0M/3m)
- **Hive-mind:** `C:\Users\ziyil\coding_projects\ai-brain\hive-mind-persist\{constitution.md, knowledge-base/01-proven-patterns.md, knowledge-base/02-anti-patterns.md}`
- **CLAUDE.md:** project working principles (Plan-First, Stateless Verification, Research-First Delegation §8)

---

## Mission

Implement PH-01 — the foundation phase of forge_coordinate. 8 stories, end-to-end from types through the core dispatch loop. **Dogfood `forge_generate` for every story.** This phase is the largest of the four; take your time, don't cram commits.

## Deliverables

1. **All 8 PH-01 stories implemented** — code + unit tests + passing CI
2. **Dogfood notes** — per-story reflection on `forge_generate` brief quality (captured in the PR description, not a separate file)
3. **Ship via `/ship`** on branch `feat/forge-coordinate-ph-01` off `master` (after v0.16.4 is the tip)
4. **Release tag** — expected v0.17.0 (minor bump, first implementation phase landing for forge_coordinate)

## Stories (from `forge-coordinate-phase-PH-01.json`, authoritative)

1. **PH01-US-00a** — RunRecord interface extension + `handleStoryEval` RunContext infrastructure
2. **PH01-US-00b** — Cross-site `estimatedCostUsd` population (every other `writeRunRecord` call site)
3. **PH01-US-01** — `CoordinateResult`, `StoryStatusEntry`, `PhaseTransitionBrief`, `CoordinateMode` types (`server/types/coordinate-result.ts`)
4. **PH01-US-02** — `topoSort(stories: Story[]): Story[]` (Kahn's) + `detectCycles` signature change + export + JSDoc
5. **PH01-US-03** — `readRunRecords(projectPath)` + `readAuditEntries(projectPath, toolName?)` (`server/lib/run-reader.ts`)
6. **PH01-US-04** — `assessPhase(plan, projectPath, options)` (`server/lib/coordinator.ts`)
7. **PH01-US-05** — `assemblePhaseTransitionBrief(result, plan)` (in `coordinator.ts`)
8. **PH01-US-06** — Unit tests (topo sort 5+, run-reader 5+, dispatch loop 5+, brief 3+)

## Dogfood directive (the whole point of S3)

For **every** story, follow this loop:

1. Call `forge_generate({storyId: "PH01-US-XX", planPath: "...forge-coordinate-phase-PH-01.json", prdContent: <PRD v1.1>, masterPlanContent: <master plan JSON>, phasePlanContent: <PH-01 phase plan JSON>})`
2. Read the returned brief. **Implement ONLY from the brief** — do not re-read the phase plan or PRD mid-story. If the brief is insufficient, that's a dogfood finding (record it).
3. Write the code + tests per the brief.
4. Call `forge_evaluate({mode: "story", storyId: "PH01-US-XX", planPath: "..."})` to verify ACs.
5. If `verdict: "PASS"` → commit the story, move on.
6. If `verdict: "FAIL"` or `"INCONCLUSIVE"` → call `forge_generate` again with `iteration: N+1` and the eval report for fix guidance. Iterate until PASS or escalate.

**Dogfood notes to capture per story** (for the ship PR description):
- Was the brief self-sufficient, or did you have to re-read upstream docs?
- Which brief sections were most/least useful?
- Any briefs that felt "AI-generic" instead of specific to PH-01 context?
- Time spent per story (rough wall-clock, for S7 divergence baseline)

These notes feed the S7 divergence measurement and inform post-coordinate `forge_generate` improvements.

## Must-cover points (direct from S2 coherence report and plan critic rounds)

### PH01-US-00a (RunRecord extension + handleStoryEval infra)

- **Scope discipline:** ~40 LOC target. Interface extension (~15 LOC) + `handleStoryEval` RunContext setup (~25 LOC matching `handleCoherenceEval` pattern at `server/tools/evaluate.ts:217`). **Do NOT scope-creep into US-00b** — that's a separate story by design (R5 Round 2 split, 22-story total depends on it).
- **Fields added to `RunRecord` (optional, per P50 additive):** `storyId?: string`, `evalVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE"`, `evalReport?: EvalReport` (embedded, per REQ-01 v1.1), `estimatedCostUsd?: number | null` on `RunRecord.metrics`.
- **Deterministic serialization (REQ-01 v1.1):** Before writing any RunRecord containing an `evalReport`, sort `evalReport.findings` by `(failedAcId, description)` lexicographically. Binary AC: two runs with the same findings in different input order produce byte-identical JSON output.
- **`handleStoryEval` specifically:** Lines 121-137 currently have NO RunContext — just `evaluateStory` + return. Add the full pattern: `new RunContext({...})`, wrap the evaluation, `writeRunRecord` with `storyId` + `evalVerdict` + `evalReport` + `estimatedCostUsd` populated from the new tracker.

### PH01-US-00b (cross-site estimatedCostUsd population)

- **Pre-req grep (RUN THIS FIRST):** `grep -n CostTracker server/tools/evaluate.ts` — confirm `CostTracker` (or `RunContext.costTracker`) is in-scope at the `handleCoherenceEval` (line 217) and `handleDivergenceEval` (line 380) `writeRunRecord` call sites. **If not in-scope, US-00b must first refactor to thread it through** (adds ~10-20 LOC; this refactor is part of US-00b, not a separate pre-story).
- **Enumeration:** `grep -rn writeRunRecord server/` to find EVERY site. Known: `handleCoherenceEval`, `handleDivergenceEval`, any `forge_generate` paths, any `forge_plan` paths. Miss one and `checkBudget` under-counts costs → NFR-C09 violation.
- **Per-site pattern:** Each site pulls from its **local** `CostTracker.totalCostUsd`. Old records without the field remain valid (treated as unknown, not $0).
- **Tests:** Update existing evaluate/plan/generate test fixtures to assert the new field is present on written records.

### PH01-US-01 (types)

- **Concrete `PhaseTransitionBrief` interface** — match the impl plan v1.1 shape exactly. Required fields: `phaseId`, `status: "in-progress" | "complete" | "halted" | "needs-replan"` (4-case, NOT 6-case — 6-state is story-level), `stories: StoryStatusEntry[]`, `readyStories: string[]`, `depFailedStories: string[]` (NOT `blockedStories` — PRD v1.1 rename), `completedCount`, `totalCount`, `budget` (with `incompleteData` flag), `timeBudget` (with nullable `elapsedMs`), `replanningNotes`, `recommendation`, `configSource: Record<string, "file" | "args" | "default">`.
- **Regression check AC:** `! grep -rn "blockedStories" server/lib/coordinator.ts server/types/coordinate-result.ts` returns exit 0 (zero matches). The v1.0 term `blockedStories` must appear NOWHERE in the new code except as an explicit comment/test asserting its absence.

### PH01-US-02 (topoSort + detectCycles surgery)

- **`detectCycles` signature change:** `Array<Record<string, unknown>>` → `Story[]`. Function is currently **private** in `server/validation/execution-plan.ts` with no external consumers — safe surgical change. **Export** it after the signature change.
- **JSDoc contract (required):** Above the exported `detectCycles` function, write a JSDoc block with: (1) **Purpose** — "detect dependency cycles in an execution plan before topological sort", (2) **Param** — `stories: Story[]`, (3) **Return** — cycle-story-id string on cycle found, `null` on acyclic, (4) **Error mode** — never throws; returns sentinel.
- **Test migration (required):** `grep -rn detectCycles server/validation/` — update any existing test call sites using `Array<Record<string, unknown>>` fixtures to use typed `Story[]` inputs. Don't ship a broken test file.
- **Kahn's determinism pin (NFR-C02 + NFR-C10 depend on this):** The ready-queue is processed in **stable lex order by `story.id`**. When multiple stories become ready simultaneously, the one with the lex-smallest `id` is emitted first. Binary AC: a fixture plan with parallel chains produces the SAME topo output on every invocation (golden-file comparison).
- **Dual cycle detection:** `detectCycles()` is the pre-check (fails fast with descriptive message). Kahn's incomplete-queue check is a defensive assertion (should never fire if pre-check ran — guards against internal bugs).
- **Default ordering byte-for-byte:** `storyOrdering: "topological"` (the default when no config file) must match pre-config behavior byte-for-byte on every fixture — this is the NFR-C10 zero-impact-when-absent requirement.

### PH01-US-03 (run-reader)

- **Tagged discriminated union signature:** `readRunRecords(projectPath): ReadonlyArray<PrimaryRecord | GeneratorRecord>` where `PrimaryRecord = { source: "primary"; record: RunRecord }` and `GeneratorRecord = { source: "generator"; record: GeneratorRunRecord }`.
- **NO helper `readPrimaryRecords`** — consumers filter inline: `readRunRecords(projectPath).filter(r => r.source === "primary")`. This is explicit by design for clarity at call sites in `assessPhase`, `checkBudget`, `recoverState`, `graduateFindings`.
- **Two source globs:**
  - Primary: `.forge/runs/forge_*-*.json` (individual JSON files from `run-record.ts`)
  - Generator: `.forge/runs/data.jsonl` (JSONL from `generator.ts`, one record per line)
- **Graceful degradation (P44 — loud failure):** Missing directory → empty array. Corrupt JSON / schema-invalid → skip that record + `console.error` warning (never silent swallow). Truncated JSONL lines → per-line try/catch, skip + warn.
- **Sort:** Combined output sorted by `timestamp` ascending.
- **`readAuditEntries(projectPath, toolName?)`:** Parse `.forge/audit/*.jsonl`, return sorted `AuditEntry[]`. Optional `toolName` filter. Per-line try/catch. Empty array when directory absent.
- **Tests (5+):** corrupt JSON file, truncated JSONL line, schema-mismatch, empty directory, normal dual-source, verify `source` discriminator tagging on output.

### PH01-US-04 (assessPhase)

- **6-state precedence chain:** `done > dep-failed > failed > ready-for-retry > ready > pending`. Walk stories in topo order, classify each via this chain using ONLY primary records (`.filter(r => r.source === "primary")`).
- **`retryCount` re-derivation:** Count non-PASS primary records for each story. **FAIL and INCONCLUSIVE both count** per REQ-04 v1.1. Do NOT persist a counter — re-derive each call (statelessness + P50).
- **`priorEvalReport` population:** Most recent non-PASS primary record's embedded `evalReport` field. Used by the brief to tell the caller what failed last time.
- **Composition with `reconcileState` / `recoverState` (critical for US-04 scope):**
  - `reconcileState` (PH-03 US-05) runs FIRST inside `assessPhase`. It normalizes plan-vs-records: orphaned records excluded, new stories marked pending.
  - `recoverState` (PH-02 US-04) runs SECOND, on the already-reconciled view. Classifies surviving stories by `evalVerdict`.
  - **In US-04, do NOT duplicate orphan-filter, new-story-marking, or crash-recovery classification logic.** Those belong in PH-03 US-05 and PH-02 US-04 respectively. For PH-01, stub **both** `reconcileState` (pass-through: returns the plan unchanged) **and** `recoverState` (pass-through: returns the reconciled view unchanged) in `server/lib/coordinator.ts`. Add a `// TODO(PH-02 US-04)` comment on the `recoverState` stub and a `// TODO(PH-03 US-05)` comment on the `reconcileState` stub so the PH-02/PH-03 implementers can grep their targets. The precedence-chain classification logic (the 6-state walk) is the ONLY real logic in US-04; reconciliation and crash-recovery are pass-throughs.
- **No story execution — pure status assembly.** Zero `callClaude` in this function. Zero writes to project files. Read-only state classification.

### PH01-US-05 (assemblePhaseTransitionBrief)

- **Mechanical signal aggregation:** Take the `assessPhase` result + plan, output a `PhaseTransitionBrief`. No LLM, no conditional narrative generation — just field population.
- **`status` 4-case rule (PRD v1.1) — implement ALL four branches, but only two are reachable in PH-01:**
  - `"complete"` when `completedCount === totalCount` **(reachable in PH-01)**
  - `"needs-replan"` when any blocking `ReplanningNote` is emitted **(unreachable in PH-01 — `replanningNotes` is always empty because PH-03 US-01 hasn't shipped; implement the branch anyway so PH-03 lights it up without refactoring US-05)**
  - `"halted"` when `phaseBoundaryBehavior: "halt-*"` is active AND completion reached **(unreachable in PH-01 — `phaseBoundaryBehavior` is undefined because PH-04 US-01.5 config loader hasn't shipped; implement the branch anyway as dead code)**
  - `"in-progress"` otherwise **(reachable in PH-01)**
- **Precedence when multiple branches match:** `"halted"` > `"needs-replan"` > `"complete"` > `"in-progress"`. Document this precedence with a comment block above the branch logic so PH-03/PH-04 implementers cannot accidentally invert it.
- **Coverage testing:** PH-01 US-06 brief tests must cover both reachable cases (`in-progress`, `complete`) with real fixtures. The two unreachable branches get one unit test each asserting that they emit the correct status when handed a synthetic input (a brief with a hand-injected blocking ReplanningNote, and a brief with a hand-injected `phaseBoundaryBehavior: "halt-hard"` signal). This locks the branches in place so PH-03/PH-04 can't silently regress them.
- **`recommendation` string:** Human-readable next-action summary. For PH-01 scope, a simple template is fine: `"${readyCount} stories ready: ${readyIds.join(", ")}. Next: run forge_generate + forge_evaluate on ${firstReadyId}."`. Full templating lives in PH-04 `briefVerbosity` handling.
- **`configSource` default:** Empty map `{}` for PH-01 (no config loader yet). PH-04 US-01.5 fills it in.

### PH01-US-06 (unit tests)

- **topo sort (5+):** linear chain, diamond, independent parallel chains, cycle detection error path, single-story edge case
- **run-reader (5+):** corrupt JSON, truncated JSONL, schema-mismatch, empty directory, normal dual-source output with `source` discriminator assertions
- **dispatch loop / `assessPhase` (5+):** all pending, some done via PASS records, mixed PASS/FAIL/INCONCLUSIVE classification, 6-state precedence priority, retryCount re-derivation from FAIL+INCONCLUSIVE
- **brief (3+):** in-progress shape, complete shape, recommendation string format

### Cross-cutting must-covers

- **`REQ-12 dedup invariant` (highest-stakes invariant in the PRD):** This isn't a PH-01 story (it lands in PH03-US-04 `graduateFindings`), but the PH-01 types in `RunRecord` and `StoryStatusEntry` must support it. Keep `storyId` and `evalVerdict` as first-class fields on primary records so PH-03 can dedup by `(storyId, escalationReason)` without schema churn. **Do not weaken or collapse these fields** in PH-01 — PH-03 needs them exactly as specified.
- **Intelligent Clipboard boundary (NFR-C01):** `rg "callClaude|trackedCallClaude" server/lib/coordinator.ts server/lib/topo-sort.ts server/lib/run-reader.ts server/types/coordinate-result.ts --type ts --glob "!*.test.ts"` must return **empty**. This is a binary AC for PH-01 ship.
- **Windows compatibility (NFR-C05):** No colons in filenames, `path.join` everywhere, forward-slash paths in all string literals. CI runs on `windows-latest` matrix (added in v0.16.1 per PR #113) — don't introduce regressions.

---

## Constraints

1. **PRD v1.1 is authoritative.** No v1.0 terms: no `blockedStories`, no 4-state story machine (6-state is story-level; 4-case is brief.status only), no `status: "blocked"` as phase-level status, no `proceedWithPartialFailure` escape hatch.
2. **Impl plan v1.1 is the architectural reference.** When in doubt on scope, check `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` (resynced 2026-04-09T18:45).
3. **Three-tier doc system:** use existing `forge-generate-*.json` files as the schema template for anything you output as a plan artifact.
4. **Dogfood is the point.** If `forge_generate` returns a weak brief, implement from the weak brief anyway and note the gap — do not go read the phase plan directly to compensate. S7 divergence measurement depends on honest dogfood.
5. **Intelligent Clipboard boundary stays hard.** Zero `callClaude` in coordinator code. Advisory mode = $0. NFR-C01 is a shipped-gate AC.
6. **CI green before ship.** Windows matrix included. No skipped tests.

---

## What NOT to do

- Do NOT implement PH-02/PH-03/PH-04 logic in PH-01. Stub `reconcileState` / `recoverState` / `loadCoordinateConfig` as pass-throughs that PH-02+ will fill. Scope discipline is the plan.
- Do NOT skip `forge_generate` for any story just because it feels faster to write the code directly. The dogfood is the point. If you're tempted to skip, stop and note why — that's a finding.
- Do NOT rewrite `handleStoryEval` beyond the `RunContext` infrastructure addition. US-00a is ~40 LOC; if you're above 80 LOC you've scope-crept.
- Do NOT bundle PH-01 with any PH-02+ work. S3 ships PH-01 only. Branch: `feat/forge-coordinate-ph-01` → v0.17.0.
- Do NOT soften the `REQ-12 distinct-storyId dedup` foundation. PH-01 types must support the exact fixture language in `PH03-US-04-AC02`: "3 primary records with storyId 'US-05' all escalation 'plateau' → findings is empty (count: 1 < 3)".
- Do NOT use `any`/`unknown` to paper over the `detectCycles` signature change. That's the whole point of the surgery.

---

## Reply contract (when you ship S3)

1. **Branch + PR URL + merge commit + release tag** (expected `feat/forge-coordinate-ph-01` → v0.17.0)
2. **File list:** every file created/modified, with line-count deltas
3. **Test count:** total new tests added, pass rate, CI status (Windows + Linux matrix both green)
4. **Dogfood report (per-story, ~1-3 sentences each):**
   - Brief quality assessment (self-sufficient / re-read needed / insufficient)
   - Time per story (wall-clock rough estimate)
   - Most surprising brief content (either useful or useless)
5. **Interview surprises:** any gaps in PRD v1.1 / impl plan v1.1 / PH-01 phase plan discovered during implementation — I want to know before S4
6. **Confirmation:** NFR-C01 grep returns empty (zero `callClaude` in coordinator code)
7. **Confirmation — REQ-12 foundation:** `storyId` and `evalVerdict` landed as first-class fields on primary records (PH-03 US-04 `graduateFindings` dedup depends on this pair alone — `(storyId, escalationReason)`)
8. **Confirmation — REQ-01 foundation:** `evalReport` embedded as optional field on `RunRecord` AND the `findings` array is sorted by `(failedAcId, description)` before every write (byte-identical serialization AC lands in PH-01 US-00a)
9. **Confirmation — status branch coverage:** all 4 `PhaseTransitionBrief.status` branches implemented, precedence documented, unreachable-branch unit tests present (so PH-03/PH-04 can't silently regress them)
10. **Proposed S4 kickoff timing** (I'll send the PH-02 prompt when you're ready)

After S3 ships, I'll send the S4 prompt for PH-02 (4 stories: budget, time, INCONCLUSIVE, crash recovery).

Go.
