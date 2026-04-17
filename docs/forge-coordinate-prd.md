# PRD: forge_coordinate — Dependency-Aware Dispatch & Phase Transition Brief Assembler

**Version:** 1.2
**Date:** 2026-04-10
**Author:** Anson Lam (with AI assist)
**Status:** Final (v1.2 — Round 4 micro-revision: vocabulary drift + canonicalization-location fix surfaced by S3 dogfood findings F-03 and F-04)

**Revision note (v1.2 / 2026-04-10, Round 4 micro-revision):** Corrected vocabulary drift surfaced by S3 dogfood findings F-03 and F-04. F-03: REQ-01's deterministic-serialization AC referenced "EvalReport.findings" and a sort key of `(failedAcId, description)`, but the actual type at `server/types/eval-report.ts` has been `criteria: CriterionResult[]` since v0.11.x with `CriterionResult.{id, status, evidence}` — there is no `findings`, no `failedAcId`, no `description`. lucky-iris correctly adapted to the type during PH01-US-00a implementation; this revision aligns the spec with the type so future implementers (and the PH-04 coherence-mode spec-vs-types check) read the same vocabulary. F-04: REQ-01 said "writeRunRecord is responsible for canonicalizing before serialization", but this is unobservable in tests because `writeRunRecord` is fully mocked at the module boundary in `server/tools/evaluate.test.ts` (`vi.mock("../lib/run-record.js")`). Canonicalization at the writer level cannot be verified without unmocking the writer (fragile) or moving AC08 to a real-disk fixture (slower, wrong test layer). REQ-01 now requires canonicalization at the handler level via an exported `canonicalizeEvalReport` helper, making both AC07 (presence) and AC08 (byte-identity) test-observable through `mockedWriteRunRecord.mock.calls[N][1].evalReport`. **Minimal semantic tightening** of the deterministic-serialization AC (v1.1 allowed any deterministic key; v1.2 locks the sort to `CriterionResult.id` then `CriterionResult.evidence` with explicit rationale for excluding `status`). The tightened spec matches what `lucky-iris` already shipped in `1e085fc` on `feat/forge-coordinate-ph-01`, so no real-world drift — the v1.2 text now accurately describes the spec change for future spec archaeology. PH-01 phase plan PH01-US-00a description is bumped in lockstep. REQ/NFR/SC counts unchanged at 16/10/8.

**Revision note (v1.1 / v0.16.2):** This revision reworks the story-level state machine (5→6 states), introduces automatic retry with max=3, embeds `EvalReport` in `RunRecord` for retry-context feed, and collapses `blocked` into a new terminal `needs-replan` state routed through the existing `ReplanningNote` infrastructure. The forge-plan revision directive asked for edits to 7 REQs (REQ-01, REQ-04, REQ-05, REQ-08, REQ-10, REQ-13) plus the REQ-15 halt-hard ACs. During Round 3 scoped `/double-critique`, three additional cross-cutting fixes landed: REQ-12 distinct-storyId dedup (prevents retry records self-graduating), REQ-14 intentional `maxRetries` omission documentation, and NFR-C06/C08/C10 addendums (disk growth, non-optional-null field shape, serialization determinism precondition). §5 and §7 were rewritten. The 9 unchanged REQs (REQ-02, REQ-03, REQ-06, REQ-07, REQ-09, REQ-11, REQ-16) are untouched. REQ/NFR/SC counts stable at 16/10/8. See the Round 3 Critique Log at the bottom for the full scoped delta critique (26 findings, 24 applied in full, 1 partial with rationale, 1 out-of-scope). Source brief: `mailbox/archive/2026-04-09T1720-forge-plan-to-lucky-iris-prd-revision-decisions-abc.md`.

---

## 1. Problem Statement

forge-harness ships three of four core primitives: `forge_plan` (planning), `forge_generate` (brief assembly + GAN loop control), and `forge_evaluate` (binary grading + coherence + divergence). Each is callable independently, but nothing composes them. The pipeline is missing its orchestrator.

**Current state:** To execute a multi-story plan, a Claude Code session must manually:
- Walk the plan's dependency graph by eye (no topological ordering helper)
- Poll `.forge/runs/*.json` to find which stories are done vs pending (no status reader)
- Track accumulated cost across tools by grepping individual RunRecords (no aggregator)
- Decide at each phase boundary whether to proceed, halt for review, or escalate (no gate mechanism)
- Re-derive all of the above on every session resume (no crash-safe state reconstruction)

In practice, sessions skip most of this bookkeeping and guess. Stories get dispatched out of dependency order. Budget overruns are only noticed after the fact. Crash recovery is manual. Phase transitions happen without any structured check that the work is coherent.

**Billing constraint (inherited from forge_generate):** The builder runs on Claude Code Max (unlimited subscription). Forge primitives must not make Claude API calls in their default mode — all LLM work happens in the calling session. forge_coordinate's default **advisory mode** must be $0: it reads state from files, aggregates signals, and returns a structured brief. The calling session decides what to execute.

**Intelligent Clipboard pattern.** forge_coordinate is a read-only brief assembler: it ingests plan/run/audit state, computes signals, and returns a structured `PhaseTransitionBrief` for the caller to act on. It never executes stories, never calls Claude, and never mutates other tools' state. Its only write is its own RunRecord at the end of a call. This pattern is shared with forge_generate and is load-bearing for the advisory-mode $0 guarantee.

**forge_coordinate is the 4th and final forge primitive.** After it ships, the four primitives compose into a complete pipeline: plan → coordinate → generate → evaluate → (loop back to coordinate).

---

## 2. Objective

Implement `forge_coordinate` as the fourth forge-harness MCP tool primitive that:

1. **Reads execution-plan state** from `.forge/runs/*.json` (primary RunRecords) and `.forge/runs/data.jsonl` (generator iteration records) without making LLM calls
2. **Topologically sorts stories** within a target phase using Kahn's algorithm with deterministic lexicographic tie-breaking
3. **Classifies each story** as `done` / `ready` / `ready-for-retry` / `failed` / `pending` / `dep-failed` based on primary RunRecord verdicts and a re-derived retry counter (max 3 retries per story). Terminal states (no further coordinator-driven forward progress): `done`, `failed`, `dep-failed`. Forward-progress states: `ready`, `ready-for-retry`, `pending`.
4. **Aggregates budget and time signals** from prior tool runs and returns warning levels (`none` / `approaching` / `exceeded`) without killing work mid-story
5. **Collects and routes replanning notes** (ac-drift, partial-completion, dependency-satisfied, gap-found, assumption-changed) mechanically based on category and severity
6. **Handles plan mutations** between calls via a reconciliation step (orphan records excluded, new stories marked pending)
7. **Reconstructs state on every call** so crash recovery is free — no coordinator-local state file to corrupt
8. **Returns a `PhaseTransitionBrief`** containing all signals plus a recommendation string; the caller decides and acts (**Intelligent Clipboard** pattern — read-only assembler, never executes)
9. **Loads an optional config file** (`.forge/coordinate.config.json`) with four output-shaping fields only: `storyOrdering`, `phaseBoundaryBehavior`, `briefVerbosity`, `observability.*`. Resource caps (`budgetUsd`, `maxTimeMs`) remain MCP input args only
10. **Integrates with existing three-tier infrastructure** (RunContext, CostTracker, ProgressReporter, AuditLog) so every call is traced

---

## 3. Requirements

All acceptance criteria are binary (pass/fail), executable via shell, and map to at least one story in `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md`.

**Shell-command portability note.** All shell commands in ACs use `grep` with `--include` / `--exclude` flags rather than `rg` (ripgrep). This is deliberate: the primary author's Windows 11 / Git Bash (MINGW64) dev environment does not ship `rg` in PATH, and installing it as a hard prereq adds unnecessary friction. GNU `grep` is present on Git Bash, Linux CI runners, and `windows-latest` CI (via Git for Windows). Commands using `\|` BRE alternation require GNU grep (which all three environments ship); where strict POSIX is needed, either `grep -E` with ERE or two separate `grep` invocations can be substituted. Where commands enumerate explicit file arguments, `-r` (recursive) is omitted because it is a no-op on non-directory arguments and some older greps emit a warning; `-r` is retained only for directory scans. NEW_CLAIM: portability guarantee — source: own analysis verified by executing each command against this repo's working tree.

### REQ-01: Story-level RunRecords with verdict, cost, and embedded EvalReport

**User story:** As forge_coordinate reading state, I can classify any story that has been evaluated AND feed a retry with the prior failure's findings because `handleStoryEval` and every other primary `writeRunRecord` call site populate `storyId`, `evalVerdict`, `evalReport`, and `estimatedCostUsd`.

**Note on duplicate `writeRunRecord`:** The codebase currently has TWO exports named `writeRunRecord`: the canonical one at `server/lib/run-record.ts:43` (writes primary per-tool RunRecords to `.forge/runs/*.json`) and a second one at `server/lib/generator.ts:484` (appends generator iteration records to `.forge/runs/data.jsonl`). These are distinct functions serving the two tagged-union sources in REQ-03. REQ-01 targets the canonical (primary) writer only; the generator JSONL writer is out of scope for cross-site cost population because generator records have no `evalVerdict` and are observability-only (REQ-04 AC-6).

**Rationale for embedding `evalReport` (v1.1 change):** The retry machinery in REQ-04 (new `ready-for-retry` state) requires each retry to be fed the prior EvalReport as iteration context — a blind retry burns budget reproducing the same failure. The implementation plan's original §State Source Design returned EvalReports only as MCP response text, which leaves no on-disk surface for the next coordinate call to read. Embedding the full report (or at minimum `criteria` — i.e., the `CriterionResult[]` carrying `id`, `status`, `evidence` per `server/types/eval-report.ts`) in the RunRecord makes the retry contract legible, keeps the coordinator stateless (no sidecar file), and preserves P50 (additive, optional field, no schema version bump).

**Acceptance criteria:**
- `grep -rn "await writeRunRecord(" server/ --include="*.ts" --exclude="*.test.ts"` enumerates every canonical *call site* (not definitions). Every enumerated call site (including any added by this phase) populates `storyId` (where applicable), `evalVerdict` (where applicable), and `estimatedCostUsd` from its local `CostTracker.totalCostUsd`. The qualitative check is: each call site visible to that grep must pass the populate-three-fields rule, regardless of how many exist.
- The generator JSONL writer at `server/lib/generator.ts:484` is explicitly out of scope for this AC — it continues to write the generator record shape unchanged. Definitions of `writeRunRecord` (the canonical `export function` at `server/lib/run-record.ts` and the generator-internal writer) are not call sites and are excluded by the `await` prefix above.
- `handleStoryEval` (server/tools/evaluate.ts) constructs a RunContext (which bundles CostTracker, ProgressReporter, and AuditLog internally) and calls the canonical `writeRunRecord` with `storyId`, `evalVerdict`, `estimatedCostUsd`, AND `evalReport` all populated (matches `handleCoherenceEval` pattern at `server/tools/evaluate.ts:170-251`).
- **`evalReport` population AC:** When `handleStoryEval` writes a primary RunRecord for a story evaluation, the `evalReport` field contains the full `EvalReport` object returned from `evaluateStory` (including `storyId`, `verdict`, `criteria`, and any optional `warnings` per the `EvalReport` type at `server/types/eval-report.ts`). This holds for all three verdicts (`PASS`, `FAIL`, `INCONCLUSIVE`) — the PASS case carries the report too, so `readRunRecords` consumers have a uniform shape. Verified by a unit test that writes a RunRecord through `handleStoryEval` and asserts `record.evalReport.criteria` is defined and matches the input.
- `RunRecord.storyId?: string`, `RunRecord.evalVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE"`, `RunRecord.evalReport?: EvalReport`, and `RunRecord.metrics.estimatedCostUsd?: number | null` are defined in `server/lib/run-record.ts` as optional fields (P50 — additive, no schema version bump). RunRecord schema version (if present on the existing type) is unchanged; `evalReport` is added as an optional field without incrementing. The `EvalReport` type is imported from `server/types/eval-report.ts` (existing, unchanged).
- **Deterministic serialization AC (NFR-C02 preservation).** When a primary RunRecord is written with an `evalReport` field, `EvalReport.criteria` MUST be serialized in a stable order — sorted lexicographically first by `CriterionResult.id`, then by `CriterionResult.evidence` as a tiebreaker. This 2-key sort is sufficient because `id` is intended-unique within a single report; the `evidence` tiebreaker exists only as a defensive fallback for the rare case where two criteria share an `id` (e.g., a malformed input). `status` is intentionally NOT in the sort key because it is a closed enum that adds no discriminative power and would make the sort sensitive to status-name renames. Stable serialization prevents run-to-run RunRecord divergence that would break NFR-C02 (deterministic dispatch) and NFR-C10 (golden-file byte-identity). Verified by a fixture that writes the same `EvalReport` via `handleStoryEval` twice (with shuffled `criteria` order on the input) and asserts byte-identical JSON output on disk. **Canonicalization location (v1.2 wording fix per F-04):** Every `writeRunRecord` call site that writes an `evalReport` is responsible for passing an already-canonicalized `EvalReport`. The exported `canonicalizeEvalReport(report: EvalReport): EvalReport` helper in `server/lib/run-record.ts` is the canonical implementation; call it at the handler level before constructing the RunRecord. Writer-level canonicalization is explicitly rejected because test mocks of `writeRunRecord` (e.g., `vi.mock("../lib/run-record.js")` in `server/tools/evaluate.test.ts`) would make canonicalization unobservable from the handler's test layer — the AC's byte-identity assertion is verified via `mockedWriteRunRecord.mock.calls[N][1].evalReport`, which only sees what the handler passed in.
- **Storage/performance note (v1.1).** Embedding the full `EvalReport` in every primary RunRecord grows `.forge/runs/*.json` linearly with failure history. Back-of-envelope: a typical `EvalReport` with ~50 criteria × ~200 bytes each ≈ 10 KB per record; a phase with 10 retry-exhausted stories × 3 records each ≈ 300 KB per phase. This is acceptable for v1.1's target scale (≤100-story plans) but is acknowledged as a growth surface in NFR-C06. For PASS records, `evalReport.criteria` will contain the per-AC pass results (typically all `status: "PASS"`); the field is still written for RunRecord shape uniformity; this is pure overhead and may be optimized in a future release if measurements warrant.

AC-CHECK: [REQ-01 AC-1] — syntax:ok, semantics:ok (qualitative: every `await writeRunRecord(` call site populates three fields), portability:ok. Note that the REQ-01 grep uses `-rn` because `server/` is a directory scan; this is consistent with the "-r only for directories" convention stated above.
AC-CHECK: [REQ-01 AC-4 — evalReport] — syntax:ok (unit-test assertion), semantics:ok (binary: field defined and structurally matches the input `EvalReport`), portability:ok (runs in vitest on all three envs).

---

### REQ-02: Dependency-ordered story dispatch

**User story:** As the coordinator assembling a brief, I walk stories in dependency order so that "ready" stories are exactly those whose dependencies have all passed, never stories whose prerequisites are still pending.

**Acceptance criteria:**
- `topoSort(stories: Story[]): Story[]` in `server/lib/topo-sort.ts` implements Kahn's algorithm and returns stories such that for any story `s`, all stories in `s.dependencies` appear earlier in the output
- Ties in Kahn's ready-queue are broken by `story.id` lexicographic order (enables NFR-C02 determinism)
- `topoSort` delegates cycle detection to `detectCycles(stories: Story[]): string | null` exported from `server/validation/execution-plan.ts`; if a cycle exists, `topoSort` throws with the cycle description
- `topoSort([])` returns `[]` without throwing (empty-input guard)
- Given a plan with stories `US-01 → US-02 → US-03` (chained dependencies), `topoSort` returns them in that order
- Given a plan with stories `US-03, US-01, US-02` where `US-02` depends on `US-01` and `US-03` depends on `US-02`, `topoSort` returns `[US-01, US-02, US-03]` regardless of input order

---

### REQ-03: Dual-source state reconstruction

**User story:** As forge_coordinate, I read both primary RunRecords (`.forge/runs/*.json`, authoritative for status) and generator JSONL records (`.forge/runs/data.jsonl`, observability only) and return them as a tagged discriminated union so consumers can filter by source without losing information from either side.

**Acceptance criteria:**
- `readRunRecords(projectPath): ReadonlyArray<PrimaryRecord | GeneratorRecord>` in `server/lib/run-reader.ts` reads both sources and returns a tagged union where `PrimaryRecord = {source: "primary", record: RunRecord}` and `GeneratorRecord = {source: "generator", record: GeneratorJsonlRecord}`
- Results are sorted by timestamp ascending
- Corrupt JSON, truncated JSONL, schema mismatches, missing directories, and permission-denied (EACCES / EPERM on Unix; ACL errors on Windows) degrade gracefully: the bad entry or unreadable file is skipped, `console.error` is called (per P44), and valid entries are still returned
- Unit tests cover at minimum: corrupt JSON, truncated JSONL, schema mismatch, empty directory, permission-denied, normal happy path, and dual-source tagged output

Note: `readAuditEntries` (audit-log reader for observability) is specified under REQ-11, which is its only consumer. It is deliberately NOT part of REQ-03's state-reconstruction surface because audit entries are observability-only and have no role in status classification or state recovery.

---

### REQ-04: Story status classification (6-state machine with auto-retry, cap=3)

**User story:** As the coordinator, I classify every story in the target phase as `done`, `ready`, `ready-for-retry`, `failed`, `pending`, or `dep-failed` using only primary RunRecords with `evalVerdict` set. A story whose prior evaluation failed is automatically retried (up to 3 times) and fed its prior `EvalReport` as iteration context; only after the retry budget is exhausted does the story become terminal-`failed` and trigger a `needs-replan` phase status.

**Retry counter (re-derived, not stored):** For every story ID in the plan, the coordinator counts the number of primary RunRecords where `storyId` matches AND `evalVerdict ∈ {"FAIL", "INCONCLUSIVE"}`. This count is the story's `retryCount`. The counter is fully re-derived on every call — zero coordinator-local state — preserving NFR-C03 (stateless crash safety) and NFR-C02 (determinism). `retriesRemaining = max(0, 3 - retryCount)`.

**Classification precedence (authoritative order — evaluate per story, top to bottom, first match wins):**

1. **`done`** iff the most recent primary RunRecord for this `storyId` has `evalVerdict === "PASS"`. This rule is checked FIRST and dominates all others — a story with three prior FAIL records and a fourth PASS record is `done`, not `failed`, because the most recent verdict is the current ground truth. The `retryCount` on a `done` story may be non-zero (historical retries) and is reported for observability.
2. **`dep-failed`** iff any of its transitive dependencies is terminal-`failed`. Checked BEFORE `failed` so a story whose upstream already failed is not classified by its own retry count (it cannot make progress until the upstream is replanned regardless of its own record history).
3. **`failed`** iff `retryCount >= 3` AND the most recent record is not PASS AND no transitive dependency is `failed`. Dependencies need NOT be `done` — a retry-exhausted story with in-flight upstream work is still terminal-`failed` because its OWN retry budget is spent. Failed stories are terminal — the brief's `recommendation` directs the caller to invoke `forge_plan(update)` (or manually edit the phase plan) because `brief.status` becomes `needs-replan` per REQ-05 resolution rule 3.
4. **`ready-for-retry`** iff the most recent primary RunRecord is `FAIL` or `INCONCLUSIVE` AND `retryCount < 3` AND all its `dependencies` are `done`. The `StoryStatusEntry.priorEvalReport` field is populated from that most recent non-PASS record's `evalReport` field (REQ-01) so the caller can feed it into the next `forge_generate` call.
5. **`ready`** iff the story has **zero** prior primary RunRecords for its `storyId` AND all its `dependencies` are `done` (never attempted, dependencies satisfied).
6. **`pending`** iff none of the above match (i.e., at least one dependency is not yet `done`, no transitive dependency is `failed`, and the story's own retry budget is not exhausted). This includes stories waiting on in-flight upstream `ready`/`ready-for-retry`/`pending` work.

**Acceptance criteria:**
- `assessPhase(plan, projectPath, options)` in `server/lib/coordinator.ts` returns a `CoordinateResult` where every story in the target phase has a `StoryStatusEntry` with status ∈ `{"done", "ready", "ready-for-retry", "failed", "pending", "dep-failed"}`, classified by the precedence order above.
- **Done-after-retry precedence AC.** Given a story with three prior `FAIL` primary RunRecords FOLLOWED by one `PASS` record (e.g., the caller patched the implementation and re-evaluated), the story is classified `done`, NOT `failed`. Its `retryCount` is 3 and its `retriesRemaining` is 0, both reported for observability; `status` is `done`. Verified by a fixture with four sequential records ordered `FAIL, FAIL, FAIL, PASS`.
- **Retry counter re-derivation AC.** Given a story `US-07` with two prior primary RunRecords both `evalVerdict === "FAIL"`, `assessPhase` computes `retryCount === 2` and `retriesRemaining === 1` on every call, without reading or writing any coordinator-local state file. Verified by a fixture that calls `assessPhase` three times in a row (no intervening writes) and asserts all three returns contain `retryCount === 2`.
- **Retry counter scoping to current plan execution.** The retry counter optionally clips by `currentPlanStartTimeMs` (the same input used by REQ-12's graduation window): when provided, only primary records with `timestamp >= currentPlanStartTimeMs` count toward `retryCount`. When not provided, the fallback counts ALL primary records matching the `storyId`. Callers who re-use story IDs across plan generations MUST pass `currentPlanStartTimeMs` to avoid cross-plan contamination of retry budgets; the fallback's known limitation is documented here and in §7. This optional clipping is identical in mechanism to REQ-12's window, so a single fixture verifies both.
- **Retry counter includes INCONCLUSIVE.** Given a story with one `FAIL` and one `INCONCLUSIVE` record, `retryCount === 2`. Given a story with three `INCONCLUSIVE` records, `retryCount === 3` and status is `failed` (retry cap is about blind-retry budget, not fault attribution). Known limitation: a flaky eval tool that repeatedly returns INCONCLUSIVE will exhaust the budget even when the implementation is correct; the supervised Max-plan caller should fix the eval tool upstream (see §7).
- **Transitive dep-failed propagation AC.** Given a chain `US-01 (failed) → US-02 → US-03`, `US-02` is `dep-failed` and `US-03` is `dep-failed`. Both stories have `retryCount: 0` (no retry is attempted on dep-failed stories — the dependency has to be replanned first).
- **dep-failed-dominates-failed AC.** Given `US-01 (failed)` and `US-02 (deps: [US-01], three prior FAIL records of its own)`, `US-02` is classified `dep-failed` (per rule 2 above), NOT `failed`. Rule 2 dominates rule 3 to prevent double-attribution: the upstream replan will invalidate `US-02`'s retry budget anyway via the REQ-13 rename path.
- When the target phase contains zero stories, `assessPhase` returns a `CoordinateResult` with empty status arrays and `brief.status === "complete"` (no error)
- When the projectPath has no primary RunRecords at all (fresh plan, first call), every story is classified as `pending` or `ready` (root stories with no dependencies), and `brief.status === "in-progress"` (no error)
- Generator JSONL records are never used for status classification (they have no `evalVerdict`)

---

### REQ-05: PhaseTransitionBrief output

**User story:** As the caller of forge_coordinate, I receive a single structured `PhaseTransitionBrief` containing every signal the coordinator computed (including per-story retry state and prior EvalReports for retries), so I can triage without making follow-up calls.

**`brief.status` resolution rule (single source of truth, v1.1).** This rule is the authoritative disambiguation for every `brief.status` reference elsewhere in this PRD. REQ-08 and REQ-15 halt-hard ACs are specific instances of this rule. The four values are mutually exclusive and evaluated top-to-bottom (priority order):

1. `status === "halted"` iff `phaseBoundaryBehavior === "halt-hard"` AND the phase is structurally complete (`completedCount === totalCount` AND there are no `failed` and no `dep-failed` stories) AND `haltClearedByHuman !== true`. Rule 1 must dominate rule 3 even if new failures arose on a halted phase; see REQ-15 for the halt-hard state machine.
2. `status === "complete"` iff every story in the phase is `done` (equivalently, `completedCount === totalCount` AND there are no `failed` and no `dep-failed` stories), AND rule 1 does not apply.
3. `status === "needs-replan"` iff any story is `failed` OR `dep-failed` (forward progress is not possible without plan changes). When rule 3 fires, the brief MUST carry at least one `ReplanningNote` with `severity: "blocking"` describing the affected stories and the recommended replan scope (see REQ-10 new triggers). This replaces the v1.0 `"blocked"` status; the rationale is that every real-world "blocked" cause in a supervised Max-plan run collapses to "the plan needs to change" — routing through the existing `ReplanningNote` infrastructure unifies the escalation path and eliminates false "wait" semantics.
4. `status === "in-progress"` otherwise — i.e., at least one story is `ready`, `ready-for-retry`, or `pending` AND no story is `failed` or `dep-failed`. This is the forward-progress-possible state.

Note: the v1.0 `blocked` value on `brief.status` is **removed** in v1.1. The word "blocked" no longer appears as a `brief.status` enum value anywhere in this PRD. Story-level blocking (dependency waiting) uses `pending` or `dep-failed` via REQ-04's 6-state machine.

**`StoryStatusEntry` shape (v1.1):**

```typescript
interface StoryStatusEntry {
  storyId: string;
  status: "done" | "ready" | "ready-for-retry" | "failed" | "pending" | "dep-failed";
  retryCount: number;                     // re-derived per REQ-04: count of non-PASS primary records for this storyId
  retriesRemaining: number;               // max(0, 3 - retryCount)
  priorEvalReport: EvalReport | null;     // non-optional (NFR-C08 "no absent keys"). Populated for ready-for-retry and failed; null for done/ready/pending/dep-failed. On failed, it exists so the caller's replan decision (re-scope / re-phrase / delete) can reference the specific findings that exhausted the retry budget. On ready-for-retry, it feeds forge_generate as iteration context.
  evidence: string | null;                // non-optional; human-readable status reason (e.g., "dep US-01 failed after 3 retries"); null when no additional evidence is relevant
}
```

Note: `priorEvalReport` and `evidence` are deliberately **non-optional with explicit null sentinels** rather than TypeScript optional (`?`) fields. This preserves NFR-C08 ("never as absent keys") under the new fields, matches the `budget.remainingUsd: null` pattern used elsewhere in this PRD, and lets consumers rely on `Object.keys()` and JSON structural equality without surprise.

**Acceptance criteria:**
- `assemblePhaseTransitionBrief(result, plan)` returns an object with all of: `phaseId`, `status` (`"in-progress" | "complete" | "needs-replan" | "halted"`), `stories: StoryStatusEntry[]` (shape above), `readyStories: string[]` (includes both `ready` and `ready-for-retry`), `failedStories: string[]`, `depFailedStories: string[]`, `completedCount: number`, `totalCount: number`, `budget`, `timeBudget`, `replanningNotes: ReplanningNote[]` (type defined in REQ-10), `recommendation: string`, and `configSource: Record<string, "file" | "args" | "default">`. The v1.0 `blockedStories: string[]` field is **renamed** to `depFailedStories` (wire-level rename; the same array purpose).
- `budget` contains `usedUsd`, `budgetUsd`, `remainingUsd`, `incompleteData: boolean`, `warningLevel: "none" | "approaching" | "exceeded"`
- `timeBudget` contains `elapsedMs`, `maxTimeMs`, `warningLevel: "none" | "approaching" | "exceeded" | "unknown"`
- **`ready-for-retry` inclusion AC.** Given a story whose most recent primary RunRecord has `evalVerdict === "FAIL"` and `retryCount === 1`, the brief returns a `StoryStatusEntry` with `status: "ready-for-retry"`, `retryCount: 1`, `retriesRemaining: 2`, and `priorEvalReport` populated from that record (not null). The story appears in `readyStories` alongside un-attempted `ready` stories.
- **`readyStories` semantics AC.** `readyStories: string[]` is a convenience projection containing EVERY story whose classification is `ready` OR `ready-for-retry`. It does NOT distinguish fresh attempts from retries; callers MUST look up each story's full `StoryStatusEntry` in the `stories` array to check `status` and read `priorEvalReport` before dispatching. Violating this contract (blindly calling `forge_generate` on the first `readyStories` entry without reading its `status`) re-introduces the pre-v1.1 blind-retry anti-pattern that REQ-01's `evalReport` embedding was designed to prevent. This is documented in §5 Happy Path step 3 and Retry Path step 1; a future v2 may split `readyStories` and `retryStories` if the convenience projection proves error-prone in practice.
- **`LAST RETRY` warning AC.** When any `StoryStatusEntry` in the phase has `status === "ready-for-retry"` AND `retriesRemaining === 1`, the brief's `recommendation` string MUST contain the exact substring `"LAST RETRY: "` immediately followed by the affected story ID(s) (comma-separated if multiple). This gives the caller an unambiguous signal that the next FAIL/INCONCLUSIVE record on that story will promote it to terminal-`failed` and escalate the phase to `needs-replan`. Binary-testable: `expect(brief.recommendation).toMatch(/LAST RETRY: US-\d\d/)`.
- **Happy-path AC.** Given a plan of 5 stories where 2 are `done` and 3 are `ready`, the brief returns `completedCount: 2`, `totalCount: 5`, `readyStories.length: 3`, `failedStories.length: 0`, `depFailedStories.length: 0`, `status: "in-progress"`, and a non-empty `recommendation` string.
- **All-failed AC (rule 3).** Given a plan of 5 stories where every story is `failed` (retry-exhausted), the brief returns `status: "needs-replan"`, `replanningNotes` contains at least one entry with `severity: "blocking"`, and `recommendation` identifies at least one `failed` story by ID.
- **Mixed failed + ready AC (rule 3, NOT rule 4).** Given a plan of 5 stories where 1 is `failed` and 4 are `ready`, the brief returns `status: "needs-replan"` (NOT `"in-progress"`) because rule 3's "any story is failed" trigger dominates. This is a **behavior change from v1.0**, where a failed-with-ready-branches phase remained `in-progress`. Rationale: under the `needs-replan` model, a single terminal failure is a plan-correction signal regardless of whether other branches can still make progress — the caller decides whether to replan now or continue partial execution, and the `replanningNotes` field tells them the scope.
- **dep-failed chain AC.** Given a chain `US-01 (failed) → US-02 → US-03` (with `US-02` and `US-03` as dep-failed) plus one unrelated `US-04 (ready)`, the brief returns `status: "needs-replan"` (rule 3 — `US-01` is failed). `depFailedStories` contains `["US-02", "US-03"]`. `replanningNotes` contains at least one `severity: "blocking"` entry describing the chain (per REQ-10 new `dep-failed-chain` trigger).
- **Halt-hard dominance AC (rule 1 > rule 3).** Given a plan where every story is `done` AND `phaseBoundaryBehavior === "halt-hard"` AND `haltClearedByHuman !== true`, the brief returns `status: "halted"` (per resolution rule 1). If a previously-halted phase subsequently has a failed story injected (e.g., via re-eval), the phase remains `"halted"` until cleared — because rule 1 specifies "structurally complete AND no failed AND no dep-failed", the halted state drops to rule 3 `needs-replan` automatically on the next call. The state machine is monotonic: halt-hard latches on structural completeness, and either clears (→complete/in-progress) or downgrades (→needs-replan) based on current reconciled state.
- **`priorEvalReport` provenance AC.** For every `StoryStatusEntry` with status `"ready-for-retry"` or `"failed"`, `priorEvalReport` is structurally equal to the `evalReport` field of the most recent primary RunRecord whose `storyId` matches. Verified by a fixture that writes two primary records for the same story (old + new, both FAIL) with distinguishable `criteria` arrays, then asserts `priorEvalReport.criteria` matches the newer record.

---

### REQ-06: Budget advisory signaling

**User story:** As the coordinator, I aggregate `estimatedCostUsd` across primary RunRecords and emit a warning level when the accumulated cost approaches or exceeds `budgetUsd`, but I never kill the caller's work — I only signal.

**Acceptance criteria:**
- `checkBudget(priorRecords, budgetUsd)` in `server/lib/coordinator.ts` sums `estimatedCostUsd` across records where `source === "primary"` only (explicit `.filter(r => r.source === "primary")`). Parameter types: `priorRecords: ReadonlyArray<PrimaryRecord | GeneratorRecord>` (the tagged union from REQ-03), `budgetUsd: number | undefined` (the resource cap passed via MCP input args per REQ-14). `checkBudget` is a pure function — it takes no `RunContext`, does not log, audit, or mutate caller state; the P45 warning described below is surfaced to the caller by returning `incompleteData: true`, and the actual `console.error` call lives on the caller's logging path.
- At ≥80% of `budgetUsd`, `warningLevel` is `"approaching"`; at ≥100%, `warningLevel` is `"exceeded"`
- When `budgetUsd` is missing or undefined, `warningLevel` is `"none"` and `remainingUsd` is `null` (no-op; mirrors REQ-07 time-budget behavior)
- When `warningLevel === "exceeded"`, the brief's `recommendation` string includes guidance to complete the current story then stop; the coordinator does NOT throw or abort
- When any primary record has a null or missing `estimatedCostUsd`, that record is excluded from the sum and `budget.incompleteData` is set to `true`; the caller's logging path emits the P45 warning (never a silent $0)
- `checkBudget` returns a `{ usedUsd, budgetUsd, remainingUsd, incompleteData, warningLevel }` shape suitable for direct inclusion in the brief

---

### REQ-07: Time budget advisory signaling

**User story:** As the coordinator, I compare wall-clock elapsed time against `maxTimeMs` and emit an advisory warning when the limit is approaching or exceeded, without killing work mid-story.

**Acceptance criteria:**
- `checkTimeBudget(startTimeMs, maxTimeMs)` in `server/lib/coordinator.ts` returns `{ elapsedMs, maxTimeMs, warningLevel }` where `warningLevel ∈ {"none", "approaching", "exceeded", "unknown"}`
- At ≥80% of `maxTimeMs`, `warningLevel` is `"approaching"`; at ≥100%, `warningLevel` is `"exceeded"`
- When `startTimeMs` is missing or undefined, `elapsedMs` is `null` and `warningLevel` is `"unknown"` (not `"none"`)
- When `maxTimeMs` is missing or undefined, `warningLevel` is `"none"` (no-op)
- The function is a pure computation — it does not throw, kill, or mutate external state

---

### REQ-08: INCONCLUSIVE routing and transitive dep-failed propagation

**User story:** As the coordinator, when a story's eval verdict is `INCONCLUSIVE`, I route that story through the same retry machinery as `FAIL` (with its prior `EvalReport` fed into the retry) so the caller can re-attempt the evaluation with full context. When a story becomes terminal-`failed` (retry-exhausted), every story that transitively depends on it becomes `dep-failed`, and the phase escalates to `needs-replan` per REQ-05 rule 3.

**v1.1 change:** The v1.0 REQ-08 used `blocked` as both the originator status (for INCONCLUSIVE) and the transitive downstream status. The v1.1 6-state machine has no `blocked` story state. INCONCLUSIVE is now handled by the retry counter (REQ-04: "Retry counter includes INCONCLUSIVE") — an INCONCLUSIVE originator is `ready-for-retry` until its retry budget is exhausted, at which point it becomes `failed` and its transitive downstream becomes `dep-failed`. This unifies INCONCLUSIVE and FAIL into one path (the retry counter sums both verdicts). **Scope note on PH-02 US-03 semantics:** the original US-03 guaranteed story-level isolation — "one blocked branch doesn't halt the whole phase" at the classification level. v1.1 preserves story-level isolation (unrelated `ready`/`ready-for-retry`/`pending` stories remain classifiable and dispatchable), but does NOT preserve phase-brief-level forward-progress: once any story's INCONCLUSIVE retries exhaust into `failed`, REQ-05 rule 3 escalates `brief.status` to `"needs-replan"`, which in v1.1's supervised-Max-plan model is the explicit desired behavior (collapse all terminal failure paths into plan-correction signals). Callers who need to continue partial execution on unrelated branches while the failed story is being replanned must use the REQ-13 rename/remove path to unblock the phase brief.

**Acceptance criteria:**
- A story with `evalVerdict === "INCONCLUSIVE"` in its most recent primary RunRecord AND `retryCount < 3` is classified as `ready-for-retry` (per REQ-04), not as a blocking terminal state. Its `priorEvalReport` is populated so the caller can feed the ambiguous report back into `forge_generate` or re-run `forge_evaluate` with additional context.
- A story whose retry budget is exhausted (`retryCount >= 3`, regardless of whether the attempts were FAIL, INCONCLUSIVE, or mixed) becomes `failed` per REQ-04. Verified by a fixture with one FAIL + one INCONCLUSIVE + one FAIL → `retryCount === 3`, status `failed`.
- Every story whose `dependencies` (transitive closure) include a `failed` story is classified as `dep-failed`. Non-failed, non-dep-failed branches continue to be classified normally (`done`, `ready`, `ready-for-retry`, or `pending`). A story is NOT `dep-failed` merely because a dependency is `ready-for-retry` — it waits (`pending`) until the retry resolves PASS or exhausts.
- When every story in the phase is `failed` or `dep-failed` (no forward progress possible), `brief.status` is `"needs-replan"` per REQ-05 resolution rule 3, and `recommendation` identifies at least one root `failed` story by ID. This AC is a specific instance of REQ-05's resolution rule, not a separate rule.
- **Rationale for unifying INCONCLUSIVE and FAIL into the retry counter:** both verdicts mean "the work did not demonstrably pass," both benefit from feeding the prior `EvalReport` into the retry, and both exhaust into the same `needs-replan` escalation. Separating them would add a 7th story state (`indeterminate` or similar) without changing caller behavior. The retry counter is the unifying mechanism.

---

### REQ-09: Crash-safe state recovery

**User story:** As a user who killed a coordinator run mid-execution, I can re-invoke forge_coordinate and get the exact same classification as before, because all state is reconstructed from `.forge/runs/` files on every call — there is no coordinator-local state to corrupt (in the default configuration).

**Acceptance criteria:**
- `recoverState(plan, projectPath)` is a pure function that reads `readRunRecords`, filters `source === "primary"`, filters by `storyId` match against current-plan stories, and returns the reconstructed status map (including the retry-counter-derived `ready-for-retry`, `failed`, and `dep-failed` statuses from REQ-04 v1.1)
- `recoverState` is invoked on every call to `assessPhase` — there is no persistent coordinator state file on disk
- Running `assessPhase` twice in a row on the same inputs (no intervening writes) returns identical `CoordinateResult` objects (structural equality)
- `recoverState` operates on the already-reconciled view (REQ-13 `reconcileState` runs first) so it never sees records for stories that were removed from the plan
- When `observability.writeRunRecord === false` is set via config (REQ-15), crash-safety is explicitly opted out of and a warning is surfaced in the brief (see NFR-C03)

---

### REQ-10: Replanning note collection and mechanical routing

**User story:** As the coordinator inspecting prior escalations and eval results, I collect `ReplanningNote` entries with a category and severity and route them mechanically (no LLM), so the caller knows exactly which notes demand a master-plan update vs a phase-plan update vs a halt.

**Acceptance criteria:**
- `ReplanningNote` type in `server/types/coordinate-result.ts` has fields: `category` (`"ac-drift" | "partial-completion" | "dependency-satisfied" | "gap-found" | "assumption-changed"`), `severity` (`"blocking" | "should-address" | "informational"`), `affectedPhases?: string[]`, `affectedStories?: string[]`, `description: string`
- The 5 categories are closed and exhaustive for v1: they cover the full `EscalationReason` vocabulary in `server/types/generate-result.ts` (`plateau | no-op | max-iterations | inconclusive | baseline-failed`), the two eval verdicts that produce notes (`FAIL`, `INCONCLUSIVE`), and the reconciliation trigger that emits `dependency-satisfied`. Infra-level failures (permission-denied, disk-full, rate-limited) are not in scope because they surface via P44 `console.error` paths, not as replanning notes.
- `collectReplanningNotes(result)` maps escalation reasons to categories mechanically: `plateau → partial-completion`, `no-op → gap-found`, `max-iterations → partial-completion`, `inconclusive → gap-found`, `baseline-failed → assumption-changed`
- Eval verdicts map: `FAIL → ac-drift`, `INCONCLUSIVE → gap-found`. **Rationale for the unified INCONCLUSIVE → gap-found choice:** INCONCLUSIVE literally means "the tool could not determine a verdict", which is a knowledge gap, not acceptance-criteria drift. Applying the same category regardless of source (escalation reason vs eval verdict) ensures a single unambiguous routing for the same underlying signal.
- **`dependency-satisfied` emission rule:** When `reconcileState` (REQ-13) observes that a dependency change or a newly-written PASS RunRecord unblocks a previously-waiting story, `collectReplanningNotes` emits a `dependency-satisfied` note with `severity: "informational"` and `affectedStories` set to the unblocked story IDs. This is the only source for this category.
- **`retries-exhausted` trigger (v1.1).** When `assessPhase` classifies any story as terminal-`failed` (per REQ-04: `retryCount >= 3`), `collectReplanningNotes` emits a `ReplanningNote` with `category: "ac-drift"`, `severity: "blocking"`, `affectedStories: [failedStoryId]`, and a `description` string naming the story and stating "retry budget exhausted after N attempts — requires plan correction (re-scope, re-phrase ACs, or remove)." Rationale for `ac-drift`: a story that a freshly-generated implementation cannot satisfy after 3 attempts is, in the overwhelming majority of cases, an AC specification problem (too vague, too ambitious, or self-contradictory). This note directly feeds `brief.status === "needs-replan"` via REQ-05 rule 3.
- **`dep-failed-chain` trigger (v1.1).** When `assessPhase` classifies any story as `dep-failed` (per REQ-04's transitive propagation), `collectReplanningNotes` emits **one `ReplanningNote` per distinct root `failed` story** (not one per dep-failed story, and not one union-of-chains note). Each note has `category: "assumption-changed"`, `severity: "blocking"`, `affectedStories: [<all stories in this root's transitive closure>]`, and a `description` string naming the root failed story and the downstream chain. When the phase graph has multiple independent roots (e.g., `US-01 failed` with downstream `[US-02, US-03]` AND `US-05 failed` with downstream `[US-06]`), the brief contains TWO `dep-failed-chain` notes — one for each root — so the caller can scope each replan decision independently. Binary-testable: `expect(brief.replanningNotes.filter(n => n.description.includes("dep-failed-chain")).length).toBe(rootFailedCount)`.
- **Edge case — `failed` AND `dep-failed` in the same phase:** when both triggers fire (the root `failed` story and its downstream `dep-failed` chain are present), both notes are emitted (one `retries-exhausted`, one `dep-failed-chain`). They address distinct replan concerns (the root needs AC correction, the chain needs assumption review).
- If a future escalation reason is added to `EscalationReason` and the mapping table is not updated, `collectReplanningNotes` routes it to `gap-found` with `severity: "informational"` and logs a P45 warning with the exact prefix `"WARNING: unknown EscalationReason routed to gap-found: "` followed by the unknown reason string. Test assertion: `expect(stderr).toMatch(/WARNING: unknown EscalationReason routed to gap-found: /)`.
- Routing is documented in the brief's `recommendation` string for any note with `severity: "blocking"`; the coordinator does NOT automatically invoke `forge_plan(update)` — the caller decides

---

### REQ-11: Velocity, accumulated cost, and audit observability

**User story:** As a caller or reviewer inspecting pipeline progress, I get per-story status, accumulated cost from primary records, velocity (completed stories per hour from primary record timestamps), and optional audit-trail access, so I can judge whether the pipeline is healthy.

**Acceptance criteria:**
- `aggregateStatus(projectPath, options?)` in `server/lib/coordinator.ts` returns an object containing per-story status, `accumulatedCostUsd` (sum of `estimatedCostUsd` across primary records), and `velocityStoriesPerHour`. `options` accepts `{ includeAudit?: boolean }` (default `false`); when `true`, the returned object additionally contains `auditEntries: AuditEntry[]` read via `readAuditEntries`.
- **Velocity formula (v1):** `velocityStoriesPerHour = completedStoryCount / elapsedHours`, where `completedStoryCount` is the count of distinct `storyId`s with at least one primary RunRecord where `evalVerdict === "PASS"` within the plan-execution window (REQ-12), and `elapsedHours = (now - earliestPrimaryRecordTimestampInWindow) / 3_600_000`. Primary records (not generator records) are the source because they carry both `storyId` and `timestamp`.
- When zero stories are complete or zero time has elapsed, `velocityStoriesPerHour` is `0` (never `NaN` or `Infinity`)
- Null or missing `estimatedCostUsd` values are excluded from the cost sum and flagged via `incompleteData: true` (consistent with REQ-06)
- `readAuditEntries(projectPath, toolName?)` is defined in `server/lib/run-reader.ts` and reads `.forge/audit/*.jsonl` for observability. It has the same graceful-degradation contract as `readRunRecords` (corrupt JSONL, missing files, permission-denied all log via `console.error` per P44 and skip the bad entry). REQ-11 is the sole v1 consumer; the helper is additionally exposed as a public export for external observability callers (tests, future primitives). Unit tests cover corrupt JSONL, missing directory, permission-denied, and happy path.

---

### REQ-12: Graduation of repeated failure patterns

**User story:** As the coordinator watching a pipeline over many stories, I detect repeated failure patterns (three or more of the same escalation reason within the current plan execution) and return structured findings so the caller can graduate them to the knowledge base.

**Acceptance criteria:**
- `graduateFindings(result, options)` in `server/lib/coordinator.ts` counts escalation reasons across primary RunRecords for the current plan's story IDs and returns a wrapper object `{ findings: Finding[], windowInflationRisk: boolean }` where `findings` contains one entry per escalation reason whose **distinct-storyId count** is ≥3
- **Distinct-storyId dedup (v1.1, interaction with REQ-04 retries).** The count dedupes by `(storyId, escalationReason)` before applying the ≥3 threshold: a single story that contributes three identical escalation reasons via retries (e.g., three `plateau` records for `US-05` under the new retry-machine) counts as **1**, not 3. The threshold is meant to identify patterns across ≥3 DISTINCT stories; without dedup, a single retry-exhausted story would self-graduate. Verified by a fixture: three primary records with `storyId: "US-05"` and escalation reason `plateau` → `findings` is empty (count: 1 < 3). Three primary records with distinct story IDs (`US-01`, `US-02`, `US-03`) and escalation reason `plateau` → `findings` contains one entry with count: 3.
- The count is re-derived from `readRunRecords().filter(r => r.source === "primary")` on every call (stateless — no persistent counter file), then deduped by `(storyId, escalationReason)` as above
- **Plan-execution window definition (v1):** The window is clipped by an optional `currentPlanStartTimeMs` input to `assessPhase`/`graduateFindings`. When provided, only primary records with `timestamp ≥ currentPlanStartTimeMs` are counted and the returned `windowInflationRisk` is `false`. When not provided, the window falls back to "all primary records for stories currently in the plan" and `windowInflationRisk` is `true`. The fallback's known limitation — that stale records from prior runs with the same story IDs can inflate counts across runs — is documented as a v1 limitation; callers who care about strict windowing must pass `currentPlanStartTimeMs`.
- Generator records are excluded from graduation counting (they have no `evalVerdict`)
- `graduateFindings` returns the wrapper object; it does NOT write findings to any knowledge base — the caller decides
- When no escalation reason has a count ≥3, the return value is `{ findings: [], windowInflationRisk: <bool> }` (never `null` or `undefined`)

---

### REQ-13: Plan mutation reconciliation

**User story:** As a user who modified the plan between coordinator calls (added stories, removed stories, renamed IDs, changed dependencies), I get a correctly classified brief on the next call because the coordinator reconciles prior records against the current plan before classification.

**Acceptance criteria:**
- `reconcileState(plan, projectPath)` in `server/lib/coordinator.ts` runs as the first step inside `assessPhase`, before `recoverState`
- **Orphaned record** is defined as: a primary RunRecord whose `storyId` field does not match any story ID in the current plan. Orphaned records are excluded from classification and logged via `console.error` with a warning message.
- **New-story rule:** A story is classified as "new" by `reconcileState` iff it is present in the current plan AND has **zero** prior primary RunRecords matching its `storyId`. New stories are initially marked `pending` and then flow through the normal REQ-04 classification. There is no "new story might be failed" carve-out — if a story has any prior primary RunRecord, it is NOT "new"; it is classified normally by REQ-04 using the retry-counter rule (so a story with 1 FAIL record is classified `ready-for-retry`, and a story with ≥3 non-PASS records is classified `failed` by REQ-04, not by REQ-13).
- A story renamed from `US-01` to `US-01-renamed` appears in the brief as an orphaned-record warning (for the old ID) and a new pending story (for the new ID)
- A dependency change that makes a previously-waiting (`pending`) story newly satisfiable reflects in the next brief as `ready` (or `ready-for-retry` if the story has prior non-PASS records and retry budget) and triggers the `dependency-satisfied` replanning note (REQ-10). Note: a `dep-failed` story is NOT spontaneously "unblocked" by `reconcileState` — a `dep-failed` designation requires the upstream `failed` story to be resolved (either by a replan that removes/replaces it, or by a new PASS record that brings its retry-derived classification back to `done`).
- **Failed/dep-failed preservation across plan mutations (v1.1).** When the plan is edited between calls, `reconcileState` MUST preserve `failed` and `dep-failed` classifications rather than auto-resetting them:
    - A `failed` story whose `storyId` is unchanged continues to be `failed` because `retryCount` is re-derived from the existing primary RunRecords (which still exist on disk). This is automatic — no special-case logic needed.
    - A `failed` story that a replan RENAMES becomes an orphaned-record warning (for the old ID) and a `pending` story (for the new ID, with retry counter starting at 0). This is the intended path for "the plan author decided the original story was unsatisfiable and rewrote it" — the new story gets a fresh retry budget.
    - A `failed` story that a replan DELETES produces an orphaned-record warning only; the new plan has no entry for that story and the prior failures become historical record.
    - A `dep-failed` story remains `dep-failed` as long as its upstream `failed` story is still in the plan and still `failed`. If the upstream is replanned away (renamed or deleted), the downstream story's `dep-failed` classification automatically lifts on the next call (re-derived from the new graph).
- **Dangling-dependency AC.** If any story's `dependencies` array references a story ID that does NOT exist in the current plan (e.g., an upstream story was renamed to `US-01b` but the downstream's `dependencies: ["US-01"]` list was not updated), `reconcileState` classifies the downstream story as `pending` with `evidence: "dep <id> missing from plan"` and logs a `console.error` P45 warning. The story is NOT `dep-failed` (there is no failed upstream in the plan), NOT `ready` (the dep is not satisfied), and NOT `failed` (no own retry exhaustion). It remains `pending` until the plan author either re-adds the upstream or removes the stale dependency reference.
- Unit tests cover at minimum: orphaned records, new stories (zero prior records), full plan replacement, rename, dependency-change, `failed` → re-evaluated → `done` transition (handled by REQ-04's "most recent" rule, not by a new-story path), `failed` → plan-renamed → new-story-pending transition, `dep-failed` → upstream-replanned-away → downstream-pending transition, dangling-dependency → downstream-pending with evidence.

---

### REQ-14: MCP handler and expanded input schema

**User story:** As a Claude Code session, I can call `forge_coordinate` via the MCP protocol with a structured input schema that covers every option the coordinator supports.

**Acceptance criteria:**
- `coordinateInputSchema` in `server/tools/coordinate.ts` includes: `planPath: string` (required), `phaseId: string` (required in v1), `masterPlanPath?: string`, `coordinateMode?: "advisory" | "autonomous"` (default `"advisory"`), `budgetUsd?: number`, `maxTimeMs?: number`, `startTimeMs?: number`, `currentPlanStartTimeMs?: number`, `projectPath?: string`, `prdContent?: string`, `replanningNotes?: ReplanningNote[]`, `haltClearedByHuman?: boolean`
- The Zod schema rejects malformed inputs (wrong types, unknown enum values, negative `budgetUsd` or `maxTimeMs`) with a structured MCP error response (`isError: true` in the content array) rather than throwing an uncaught exception
- Calling `forge_coordinate` with a non-existent or unreadable `planPath` returns a structured error response (`isError: true`) with a message identifying the path — not an uncaught exception
- `handleCoordinate` wires the input to `assessPhase` and returns a serialized `PhaseTransitionBrief` in the MCP `content` array
- The tool is registered in `server/index.ts` with a description reflecting its role as the 4th forge primitive
- Calling `forge_coordinate({planPath, phaseId})` on a valid v3.0.0 ExecutionPlan returns a brief with no errors
- **Intentional omission: `maxRetries` (v1.1).** The input schema deliberately does NOT expose a `maxRetries` field. The retry cap of 3 is hardcoded in REQ-04 per the v1.1 design decision (see §7 "Unlimited retries" out-of-scope row for the rationale and promotion criteria). A future v2 may promote this to an input arg or a config field, but v1.1's "four config fields only" invariant (REQ-15) must remain intact. Any PR attempting to add `maxRetries?` to `coordinateInputSchema` without a corresponding §7 out-of-scope-row removal and a REQ-04 wording update is out of spec.

---

### REQ-15: Optional output-shaping config file

**User story:** As a project owner, I can commit an optional `.forge/coordinate.config.json` to shape how the coordinator presents its output (story ordering strategy, phase-boundary behavior, brief verbosity, observability level), without affecting resource caps (those remain MCP input args only).

**Acceptance criteria:**
- `loadCoordinateConfig(projectPath)` in `server/lib/coordinator.ts` reads `.forge/coordinate.config.json` with a single `fs.readFile` call; missing file → empty config (not an error)
- Schema has exactly four fields, all optional: `storyOrdering` (`"topological" | "depth-first" | "small-first"`, default `"topological"`), `phaseBoundaryBehavior` (`"auto-advance" | "halt-and-notify" | "halt-hard"`, default `"auto-advance"`), `briefVerbosity` (`"concise" | "detailed"`, default `"concise"`), `observability` (`{ logLevel?, writeAuditLog?, writeRunRecord? }`)
- **Zod strictness:** The Zod schema uses `.strict()` at the top level (rejects unknown top-level fields). Unknown fields cause the loader to log a `console.error` P45 warning listing each unknown field by name, then fall back to defaults for the whole config as if the file were missing. Resource-cap fields specifically (`budgetUsd`, `maxTimeMs`, `escalationThresholds`) are named explicitly in the warning message so users understand why they were rejected.
- MCP input args override config file fields per-field; the brief's `configSource` map records provenance (`"file" | "args" | "default"`) for each field
- Corrupt JSON, schema-invalid values (e.g., `storyOrdering: "random"`), a path that exists but is a directory (EISDIR), and mid-write races all degrade gracefully: log via `console.error` per P44, fall back to args-or-default for the affected field(s), never throw
- When `observability.writeRunRecord === false`, the loader emits a P45 warning AND the brief's `recommendation` is prefixed with `"WARNING: crash recovery disabled."`. This is an explicit user opt-out — NFR-C03's crash-safety invariant does not hold in this configuration, and the warning surface in the brief is the acknowledgment path (see NFR-C03 wording).
- **`halt-hard` state machine — trigger (v1.1, non-latching).** The halt-hard trigger is **re-evaluated on every call** against the current reconciled state, not latched. `brief.status === "halted"` iff (a) `phaseBoundaryBehavior === "halt-hard"`, AND (b) the phase is **structurally complete** on THIS call — i.e., `completedCount === totalCount` AND there are no `failed` stories AND no `dep-failed` stories — AND (c) `haltClearedByHuman !== true`. If any of (a)–(c) are false, halt-hard does not apply and REQ-05 rules 2–4 determine the status as usual. When halt-hard DOES apply, a synthetic blocking `ReplanningNote` is attached to the brief (brief-only, never persisted to disk), and the next call with the same state remains halted (idempotent via re-evaluation, not via a stored latch).
- **`halt-hard` non-latching AC.** Given a phase that was `halted` on call N (all stories `done`, halt-hard config set, `haltClearedByHuman !== true`), if between call N and call N+1 the caller injects a failing re-eval for story `US-05`, then call N+1 returns `brief.status === "needs-replan"` (NOT `halted`) because structural-completeness is no longer true. This is the authoritative resolution of the earlier "rule 1 dominance" wording — rule 1 dominates only **while its structural precondition holds**; it does not latch. The earlier REQ-05 "halt-hard dominance AC" is restated under this non-latching semantics.
- **`halt-hard` state machine — clearing.** Passing `haltClearedByHuman: true` suppresses rule 1 on that specific call (and all subsequent calls — the flag is caller-provided input, so it persists across calls as long as the caller keeps passing it). REQ-05 rules 2–4 then determine the status against the current reconciled state; this does NOT override actual `failed` or `dep-failed` state. Consequences:
    - If the phase is still structurally complete when cleared → status becomes `"complete"` and the synthetic blocking note is absent.
    - If new `failed` or `dep-failed` stories appeared since the halt fired → status becomes `"needs-replan"` (per rule 3), and the `retries-exhausted` / `dep-failed-chain` `ReplanningNote`(s) from REQ-10 are attached.
    - If new `ready`/`ready-for-retry`/`pending` stories appeared → status becomes `"in-progress"` (per rule 4).
- **AC (halt-hard clearing safety, v1.1).** Given a phase that was previously halted, if a caller passes `haltClearedByHuman: true` but the phase now has at least one `failed` story, `brief.status` is `"needs-replan"` (NOT `"complete"`). This verifies the clearing rule does not override actual terminal failure state.
- Resource caps (`budgetUsd`, `maxTimeMs`, `escalationThresholds`) are NOT accepted as config file fields — only as MCP input args; a config file containing them is rejected by `.strict()` and logged as above

---

### REQ-16: Checkpoint gates as brief-only outputs

**User story:** As an advisory-mode caller, I treat the returned `PhaseTransitionBrief` itself as the checkpoint — there is no separate checkpoint file, no separate pause-and-wait call, and no coordinator-local gate state.

**Acceptance criteria:**
- In advisory mode (`coordinateMode === "advisory"`), the brief's `status` field (`"in-progress" | "complete" | "needs-replan" | "halted"`) and `recommendation` string are the complete checkpoint signal — no separate `checkpointRequired` field is emitted
- In autonomous mode (deferred to v2), the brief may emit `checkpointRequired: true`; v1 never emits this
- Resuming from a checkpoint is a plain re-invocation of `forge_coordinate` with the same inputs — no resume token, no stored gate state
- Running `forge_coordinate` twice in a row with identical inputs produces briefs whose non-timestamp fields are structurally equal (NFR-C02 determinism)

---

## 4. Non-Functional Requirements

The NFR-C series mirrors the 10 cross-primitive NFRs from the implementation plan. The `-C` prefix is load-bearing for cross-primitive grep across the audit trail.

- **NFR-C01: Advisory mode = $0.** `test -z "$(grep -n 'callClaude\|trackedCallClaude' server/lib/coordinator.ts server/lib/topo-sort.ts server/lib/run-reader.ts server/lib/run-record.ts server/validation/execution-plan.ts server/types/coordinate-result.ts server/tools/coordinate.ts 2>/dev/null)" && echo EMPTY-OK` prints `EMPTY-OK`. The grep scans the coordinator-authored files AND the shared infrastructure files the coordinator imports transitively (`run-record.ts`, `execution-plan.ts`). The `2>/dev/null` swallows "file not found" errors for files still to be created, and the `test -z` check passes if and only if no matches exist in any file that DOES exist. No Claude API calls from any file in the coordinator's dependency chain. The command uses `grep -n` (not `-rn`) because all arguments are explicit file paths, not directories — `-r` would be a no-op and may emit a warning on older greps. AC-CHECK: [NFR-C01] — syntax:ok, semantics:ok (empty grep output → test -z succeeds → prints EMPTY-OK; any match → non-empty stdout → test -z fails → nothing printed), portability:ok (requires GNU grep for `\|` BRE alternation — present on Git Bash, Linux CI, and Git-for-Windows on `windows-latest`). Alternative POSIX-ERE form: replace `grep -n 'callClaude\|trackedCallClaude' <files>` with `grep -nE 'callClaude|trackedCallClaude' <files>`.
- **NFR-C02: Deterministic dispatch.** Same plan → same topo sort → same brief (excluding timestamp fields). Kahn's ready-queue processes stories in stable lexicographic order by `story.id`. Verified by calling `assessPhase` twice on identical inputs and asserting structural equality of the result.
- **NFR-C03: Crash-safe state (default config).** When `observability.writeRunRecord !== false` (the default), killing the coordinator process mid-call and re-running produces no duplicate work and no lost state, because the coordinator has no persistent state file — any partial-state scenario is structurally indistinguishable from a mid-run kill. **Opt-out path:** When `observability.writeRunRecord === false` is set via config (REQ-15), crash-safety is explicitly disabled; this is the acknowledged exception, surfaced to the caller via a `"WARNING: crash recovery disabled."` prefix in the brief's `recommendation`. Verified by fixture-based test: the test writes a partial set of RunRecords (simulating a mid-run kill, not an actual process kill — the coordinator is pure so the two are structurally equivalent), invokes `assessPhase`, and compares the result against a run where all records were written atomically. The opt-out path is verified by a separate fixture that sets `writeRunRecord: false` and asserts the warning prefix is present in the brief.
- **NFR-C04: Budget = advisory signal, not kill.** When `budget.warningLevel === "exceeded"`, the brief is returned with a guidance recommendation; the coordinator does NOT throw, abort, or prevent the caller from continuing. Verified by a fixture where prior records sum to 200% of `budgetUsd` and the call returns successfully.
- **NFR-C05: Windows compatibility.** No colons in any filename written by the coordinator. All path construction uses `path.join`. All file reads tolerate CRLF line endings. Verified by running the full coordinator test suite on `windows-latest` CI.
- **NFR-C06: Graceful degradation.** Parse errors, missing files, malformed JSON/JSONL, and permission-denied errors are logged via `console.error` (P44) and the degraded path continues. Observability failures (audit write, run record write) never block the core brief assembly path. Verified by fixture-based tests for corrupt JSON, truncated JSONL, schema mismatch, missing directory, and permission-denied. **v1.1 growth acknowledgement:** RunRecords embed the full `EvalReport` per REQ-01, so `.forge/runs/` grows by ~10 KB per FAIL/INCONCLUSIVE record. v1.1 does NOT cap record size or truncate findings arrays; callers running plans beyond v1.1's target scale (>100 stories × >3 retries/story) should monitor disk usage. A truncation/rotation policy is deferred to v2.
- **NFR-C07: Schema 3.0.0 compatible.** Accepts any valid ExecutionPlan v3.0.0. Does not mutate the plan. Verified by calling `assessPhase` with all three-tier and two-tier fixtures from the existing test suite.
- **NFR-C08: Brief completeness.** Every field listed in REQ-05 is present in the returned brief — none are silently omitted. Missing data surfaces as explicit sentinels (`null`, `incompleteData: true`, `warningLevel: "unknown"`), never as absent keys. **v1.1 reaffirmation:** the new `StoryStatusEntry.priorEvalReport` and `StoryStatusEntry.evidence` fields are **non-optional with explicit null** (not TypeScript `?` optional) specifically to preserve this invariant — `priorEvalReport` is `null` on `done`/`ready`/`pending`/`dep-failed` stories and an `EvalReport` object on `ready-for-retry`/`failed` stories; `evidence` is `null` when no additional context is relevant. Verified by TypeScript structural typing plus a runtime check in the test suite that asserts `Object.keys(entry).sort()` returns an identical set across all six story statuses.
- **NFR-C09: Null-cost visibility.** When any prior primary RunRecord has a null or missing `estimatedCostUsd`, `budget.incompleteData = true` and a P45 warning is logged. The accumulated cost is never silently reported as $0. Verified by a fixture with mixed null/non-null cost records.
- **NFR-C10: Config file zero-impact when absent/empty.** Running the full test suite once with no `.forge/coordinate.config.json` and once with an empty `{}` config file produces byte-identical results across all brief fields EXCEPT `configSource` (which is provenance-only and expected to change). Verified by binary golden-file comparison on 3+ fixtures. **v1.1 precondition:** the golden-file comparison depends on deterministic serialization of RunRecords (REQ-01 "Deterministic serialization AC") — any non-stable ordering inside `EvalReport.criteria` would break byte-identity even when the semantic content is unchanged. The fixture set includes one retry-exhausted story to exercise this path.

---

## 5. User Workflow

### Happy Path: Multi-Story Phase Execution

1. **Caller** invokes `forge_coordinate({planPath, phaseId: "PH-01"})` → receives `PhaseTransitionBrief`
2. **Caller** reads `brief.readyStories` → picks the first ready story (note: `readyStories` includes both fresh `ready` and `ready-for-retry` stories)
3. **Caller** invokes `forge_generate` on the ready story — if the story's `StoryStatusEntry.status === "ready-for-retry"`, the caller passes `priorEvalReport` as iteration context so the retry is informed, not blind
4. **Caller** implements the story (LLM work in the Claude Code session, not in forge_generate)
5. **Caller** invokes `forge_evaluate` on the story → receives `EvalReport` with a verdict; `handleStoryEval` writes a primary `RunRecord` with `storyId`, `evalVerdict`, `estimatedCostUsd`, AND the full `evalReport` (per REQ-01 v1.1)
6. **Caller** invokes `forge_coordinate` again → the new brief reflects the updated status; if more stories are ready, goto step 3
7. When `brief.status === "complete"` → the phase is done; the caller moves to the next phase or halts

### Retry Path (v1.1 new workflow)

1. **Caller** sees a `StoryStatusEntry` with `status === "ready-for-retry"`, `retryCount >= 1`, and `retriesRemaining >= 1`. The story was attempted at least once and did not PASS.
2. **Caller** reads `entry.priorEvalReport` — this is the full `EvalReport` from the most recent non-PASS attempt (populated from the RunRecord's new `evalReport` field per REQ-01 v1.1). It contains `storyId`, `verdict`, the `criteria` array (each with `id`, `status`, `evidence`), and any optional `warnings`.
3. **Caller** invokes `forge_generate` on the story, passing `priorEvalReport` as iteration context so the retry is informed of the specific findings to address. The caller can also manually edit the implementation before re-evaluating if the prior failure was an implementation gap rather than a spec gap.
4. **Caller** invokes `forge_evaluate` → a new primary `RunRecord` is written with the new verdict. If the new verdict is **PASS**, the story's most-recent record now has `evalVerdict === "PASS"` and the story becomes `done` on the next coordinate call (REQ-04 rule 1 dominates, regardless of prior retry count — the done-after-retry precedence AC). If the new verdict is **FAIL or INCONCLUSIVE**, the re-derived `retryCount` increases by one on the next call (because the new non-PASS record is now included in the count). Callers should monitor `retriesRemaining` and the `LAST RETRY: <storyId>` warning in `brief.recommendation` to know when the next FAIL would exhaust the budget.
5. When `retryCount >= 3`, the story becomes terminal-`failed` and the next coordinate call returns `brief.status === "needs-replan"` with a `ReplanningNote` having `category: "ac-drift"`, `severity: "blocking"`. At that point the caller switches to the Failure Path.

### Failure Path (v1.1 rewritten)

1. **Caller** sees `brief.status === "needs-replan"`. This means at least one story in the phase is `failed` (retry-exhausted) OR `dep-failed` (transitively downstream of a failed story). No further auto-retry is possible — the plan needs to change before forward progress can resume.
2. **Caller** reads `brief.replanningNotes` to see the specific triggers:
    - A `category: "ac-drift", severity: "blocking"` note means a story exhausted its 3-retry budget — the AC set is likely too vague, too ambitious, or self-contradictory. Correction: re-scope the story, re-phrase the ACs, or remove it.
    - A `category: "assumption-changed", severity: "blocking"` note means a dependency failed and its downstream chain needs to be re-derived under the new assumption (that the upstream story cannot be completed as originally specified).
3. **Caller** decides the remediation:
    - Invoke `forge_plan(documentTier: "update")` to generate a replan informed by the blocking notes.
    - Manually edit the phase plan (e.g., rewrite the failed story's ACs, split it into sub-stories, or delete it entirely).
    - Abort the phase and escalate to a human operator — in the rare "technically impossible" edge case, the `ReplanningNote.description` will say "human intervention required — cannot be resolved by replanning."
4. **Caller** re-invokes `forge_coordinate` with the updated plan. The coordinator reconciles the plan mutation (REQ-13): failed stories with unchanged IDs remain `failed`; renamed/deleted failed stories produce orphaned-record warnings and flow through as new `pending` stories; dep-failed stories whose upstream was replanned away automatically lift back to `pending` on the next call. The caller resumes the Happy Path from step 2.

### Escalation Path

1. **Caller** sees `brief.status === "needs-replan"` or `brief.replanningNotes` contains a `severity: "blocking"` entry of any category
2. **Caller** reads the `recommendation` string and the blocking note(s)
3. **Caller** decides: invoke `forge_plan(documentTier: "update")` to reconcile, clear the halt via `haltClearedByHuman: true` (only applies to `halted` state, not `needs-replan`), or abort the run

### Crash Recovery

1. User kills the coordinator (or the entire Claude Code session) mid-run
2. User re-invokes `forge_coordinate({planPath, phaseId})` with the same inputs
3. The coordinator re-reads `.forge/runs/*.json` and returns an identical brief — no state was lost, no duplicate work is proposed

---

## 6. Success Criteria

All criteria are binary pass/fail.

- **SC-01:** All 23 stories (including the 3 scaffolding stories `PH01-US-06`, `PH04-US-03`, `PH04-US-04` which do not map to a single REQ, plus the 1 follow-up-fix story `PH04-US-05` added per F-03 secondary disposition which extends `forge_evaluate` coherence mode rather than mapping to a forge_coordinate REQ) in `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` — split 8 in PH-01, 4 in PH-02, 5 in PH-03, 6 in PH-04 — pass their story-level acceptance criteria on both `ubuntu-latest` and `windows-latest` CI. (Windows behavior is a verification environment, not a separate SC — colon-in-filename, CRLF-tolerant parsing, and `path.join` correctness are covered here via NFR-C05.)
- **SC-02:** `forge_coordinate` is registered as an MCP tool in `server/index.ts` and callable via Claude Code with a structured input schema (REQ-14).
- **SC-03:** Advisory mode verified $0 via the NFR-C01 shell check — running `test -z "$(grep -n 'callClaude\|trackedCallClaude' server/lib/coordinator.ts server/lib/topo-sort.ts server/lib/run-reader.ts server/lib/run-record.ts server/validation/execution-plan.ts server/types/coordinate-result.ts server/tools/coordinate.ts 2>/dev/null)" && echo EMPTY-OK` prints `EMPTY-OK`. AC-CHECK: [SC-03] — syntax:ok, semantics:ok, portability:ok (same command as NFR-C01; requires GNU grep).
- **SC-04:** Full test suite (`npm test`) passes with all new coordinator unit tests (topo sort, run reader, assessPhase, brief assembly, config loader, reconciliation, retry counter re-derivation, retry counter `currentPlanStartTimeMs` clipping, graduateFindings distinct-storyId dedup) and integration tests (multi-story dispatch, budget enforcement, time enforcement, crash recovery, INCONCLUSIVE routed to ready-for-retry, plan mutation reconciliation, config zero-impact, halt-hard state machine, `ready-for-retry` with `priorEvalReport` feed, retry-exhausted → `needs-replan`, `dep-failed` transitive propagation, `dep-failed` dominates `failed` (rule 2 > rule 3), 3-FAIL-then-PASS → `done` (done-after-retry precedence), all-failed-phase → `needs-replan` status, mixed failed+ready → `needs-replan` status, `LAST RETRY` recommendation substring on `retriesRemaining === 1`, two independent dep-failed chains → two `dep-failed-chain` notes, failed-story-replanned → new pending, dep-failed-upstream-replanned → downstream-pending, dangling-dependency → downstream-pending with evidence, halt-hard non-latching (injected failure → `needs-replan`), halt-hard clearing-safety with injected failure → `needs-replan`, deterministic EvalReport serialization byte-identity) included.
- **SC-05:** TypeScript compilation (`tsc --noEmit`) succeeds with zero errors.
- **SC-06:** Dogfood run against a multi-story execution plan produces a valid brief with correct topological ordering, correct status classification, and no crashes; the dogfood report is checked in under `.ai-workspace/plans/`.
- **SC-07:** Divergence count (from `forge_evaluate` in `mode: "divergence"`) against the 80-item post-generate baseline shows no regression — forge_coordinate does not introduce new unplanned capabilities or unaddressed design-doc items beyond the 80 existing.
- **SC-08:** Binary golden-file comparison (NFR-C10) shows byte-identical brief output across all fields except `configSource` when running the full coordinator test suite once without any config file and once with an empty `{}` config file.

---

## 7. Out of Scope

| Excluded | Rationale |
|----------|-----------|
| **Autonomous mode (LLM-powered triage)** | Deferred to v2. Advisory mode ($0) is the v1 default and the only mode shipped. Promotion criteria: ≥30 advisory runs with no divergence regression plus a measured LLM triage cost model. |
| **Phase auto-detection** | Deferred. `MasterPlan.Phase` has no `planPath` field, so coordinate cannot locate a phase plan from a master plan reference. `phaseId` is required in v1; callers pass it explicitly. |
| **Concurrency / `affectedPaths`-based parallelism** | Deferred. v1 is strictly sequential — the brief lists one ready story at a time (or the deterministic topo-sorted set of all ready stories; the caller picks one). Concurrency is reserved for a future v2 revision after advisory mode has been validated at scale. |
| **Unlimited retries** | Capped at **max 3 retries per story** (REQ-04 v1.1). The retry counter is re-derived from RunRecords per call — no stored state. Max-plan supervised runs have unlimited subscription budget, so the cap is not about cost; it is about preventing runaway reruns that mask a genuine spec problem. After 3 attempts, the story becomes terminal-`failed` and the phase escalates to `needs-replan` via a `ReplanningNote` with `category: "ac-drift"`. Promotion criteria: a documented use case where supervised runs genuinely need > 3 retries per story (e.g., a high-variance external tool in the eval path). |
| **Flaky-eval compensation** | The retry counter in REQ-04 counts `INCONCLUSIVE` verdicts toward the retry budget. A genuinely-flaky eval tool (e.g., timeouts, rate limits) can therefore exhaust the budget on a correctly-implemented story. This is NOT compensated in v1.1; the expected remediation is to fix the eval tool upstream (infrastructure problem, not a coordinator problem). Rationale for not adding an `inconclusiveCountsTowardRetry` escape hatch: it would create a config knob whose correct setting depends on eval-tool reliability, which the coordinator has no way to measure. Promotion criteria: measured flake rate ≥5% across a cohort of runs with a documented remediation path. |
| **Retry-budget reset via story rename (acknowledged escape hatch)** | REQ-13's preservation rules classify a renamed `failed` story's new ID as a fresh `pending` with retryCount 0. This is **intentional** — it is the plan author's explicit signal that "the original story was unsatisfiable and has been rewritten," and the new story deserves a fresh budget. It is also a retry-budget escape hatch that a motivated caller can abuse. v1.1 accepts this trade-off because (a) the alternative is extra bookkeeping that tracks "this new ID is a continuation of a failed old ID," and (b) supervised Max-plan runs have a human in the loop who can detect abuse. A future v2 may add a `reconcileState` warning that surfaces rename-followed-by-new-story for human review. |
| **Cross-project memory retrieval** | Out of forge-harness scope entirely. Memory retrieval with LLM-powered relevance ranking belongs as an external `/recall` skill (see `docs/primitive-backlog.md` "Scope Boundary Decisions"). Project-local history — `.forge/runs/`, `.forge/audit/`, and `graduateFindings` (REQ-12) — stays inside forge because it is mechanical and per-project. |
| **Resource caps as config file fields** | `budgetUsd`, `maxTimeMs`, and `escalationThresholds` are rejected as config file fields because they are unsuitable for Max-plan supervised runs (the builder has unlimited budget and actively supervises; hard caps would just generate noise). They remain accepted as MCP input args on `coordinateInputSchema`. Promotion criteria: a documented use case where supervised runs genuinely need resource caps. |
| **Story execution** | forge_coordinate never runs stories. It assembles a brief; the caller invokes forge_generate and forge_evaluate. This is the **Intelligent Clipboard** pattern — the coordinator is a read-only brief assembler with one write (its own RunRecord at the end). |
| **Plan mutation writes** | forge_coordinate is read-only with respect to other tools' state. It reads `.forge/runs/*.json`, `.forge/runs/data.jsonl`, `.forge/audit/*.jsonl`, and the plan file; it writes only its own RunRecord via `writeRunRecord()` at the end of a call. It never mutates the plan, other tools' run records, or audit logs from other tools. |
| **`phaseGates` config field** | Replaced by `phaseBoundaryBehavior` (values: `auto-advance`, `halt-and-notify`, `halt-hard`) in REQ-15. The three-value enum captures all semantically meaningful phase-boundary behaviors without needing a free-form gate list. |
| **`excludePaths` config field** | Rejected — no concrete use case grounding. Can be added later if a specific need emerges. |

---

## 8. Future Scope / Roadmap

- **Autonomous mode (v2):** LLM-powered triage for genuinely ambiguous state (e.g., multiple divergences + coherence gaps — should next phase proceed?). Opt-in via `coordinateMode: "autonomous"`. Gated behind the promotion criteria above.
- **Phase auto-detection:** Requires adding `planPath` to `MasterPlan.Phase`. Would enable `forge_coordinate({masterPlanPath})` without an explicit `phaseId`.
- **Concurrent story dispatch:** Requires `affectedPaths`-based overlap detection (bidirectional `startsWith()` comparison) and a safe sequential fallback on conflict. Reserved for post-v1.
- **Cost model refinement for autonomous mode:** Measure actual LLM triage cost across a cohort of runs, build a model, then expose a `budgetUsd` gate for autonomous mode.
- **Self-healing loop integration:** When `replanningNotes` contain high-severity routing decisions, the caller could auto-invoke `forge_plan(documentTier: "update")`. v1 leaves this to the caller; v2 may automate it.
- **Memory graduation integration:** `graduateFindings` (REQ-12) returns structured findings. A future external `/recall` skill will consume them and write to `hive-mind-persist/knowledge-base/`.

---

## 9. Open Questions

All questions resolved via the S1 clarifying-questions mailbox exchange (see mailbox archive `2026-04-09T1455-forge-plan-to-lucky-iris-s1-prd-answers.md`):

- **PRD interview mode (RESOLVED):** Semi-autonomous. The plan went through 6 critique rounds and the premises are verified; a full diagnostic interview would be theater.
- **REQ count target (RESOLVED):** ~16 REQs, bundling related stories under single REQs where the semantic unit is one user-facing capability. This PRD has exactly 16.
- **NFR naming prefix (RESOLVED):** Keep `NFR-C01..C10` — the `-C` prefix is load-bearing for cross-primitive grep across the audit trail.
- **Windows success criterion (RESOLVED):** Fold into SC-01 (base criterion explicitly lists `ubuntu-latest` AND `windows-latest`). Windows is a verification environment, not a separate SC. SC count = 8, not 9.
- **Primary audience (RESOLVED):** Both — the calling agent (contract) and the human developer (outcome).
- **Config file coverage in PRD (RESOLVED):** Paragraph for autonomous mode deferral and resource cap rejection (REQ-15 and §7); one-liners for the other REQ→AC mappings. REQ-15 carries the full detail because the halt-hard state machine is the subtle part.
- **Reference document scope (RESOLVED):** Full-read of `docs/primitive-backlog.md` "Scope Boundary Decisions" (committed in this branch). The "Configuration File Design Decisions" section referenced in the S1 answer was not found in `primitive-backlog.md` — the equivalent authoritative content lives in `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` lines 162-192 (config schema + cut fields + rationales), which this PRD uses as the source for REQ-15 and §7.
- **Shell portability (RESOLVED):** All AC shell commands use `grep` with `--include`/`--exclude` rather than `rg`, because the author's Windows 11 / Git Bash env does not ship ripgrep and installing it as a hard prereq adds unnecessary friction. GNU grep is present on Git Bash, Linux CI, and Git-for-Windows on `windows-latest`. `-r` is used only for directory scans (e.g., REQ-01 scanning `server/`); commands with explicit file lists use plain `-n`. Commands using `\|` alternation are GNU-grep-portable rather than strict-POSIX; a POSIX-ERE form (`grep -E 'a|b'`) is provided where relevant.

---

## 10. Evidence Base

### Demand Evidence (Q1)
forge_plan, forge_generate, and forge_evaluate are shipped primitives. The pipeline can plan, implement, and evaluate stories, but nothing composes them into a dependency-aware multi-story workflow. Sessions currently walk the plan by eye, track status by grepping RunRecords, and lose state on crash. The implementation plan documents six specific bookkeeping tasks that every multi-story session must currently do manually.

### Status Quo (Q2)
Manual orchestration per session: read plan → guess dispatch order → invoke generate+evaluate → update mental model of status → repeat. No cost aggregation across tools. No time budget tracking. No structured phase transition gate. No crash recovery. Plan mutations between sessions require manual re-derivation of which records still apply.

### User Research (Q3)
Primary audience = calling Claude Code agent (contract: structured brief input/output). Secondary audience = human developer (outcome: correct status, actionable recommendations). Both audiences benefit from the same artifact — the `PhaseTransitionBrief`.

### Agreed Premises
1. forge_coordinate is the fourth and final forge primitive — the pipeline composes into a complete loop once it ships
2. Advisory mode ($0) is the only v1 mode — autonomous is deferred until the advisory signal model is validated
3. Intelligent Clipboard pattern is load-bearing — coordinate never executes stories, it assembles briefs
4. Resource caps (`budgetUsd`, `maxTimeMs`, `escalationThresholds`) are MCP input args only, never config file fields
5. RunRecord extension (REQ-01) is a silent pre-requisite — without `storyId`, `evalVerdict`, and `estimatedCostUsd` populated across all call sites, the coordinator's entire state model is blind

---

## 11. REQ → Story Traceability

Every REQ maps to at least one implementation story in `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md`. The 23-story total includes 3 scaffolding stories (`PH01-US-06`, `PH04-US-03`, `PH04-US-04`) that are the verification *mechanism* for the REQs above rather than user-facing capabilities, and therefore do not map to a single REQ; plus 1 follow-up-fix story `PH04-US-05` (added 2026-04-10 per F-03 secondary disposition) which extends `forge_evaluate` coherence mode with a mechanical spec-vs-types vocabulary-drift check rather than mapping to a forge_coordinate REQ — its purpose is to prevent future occurrences of the F-03 drift class that surfaced during S3 PH01-US-00a implementation. Story IDs use the `PHxx-US-yy` notation with an explicit documented exception: `PH04-US-01b` uses a single lowercase-letter suffix to signal "inserted between US-01 and US-02". The permitted regex is therefore `PH\d\d-US-\d\d[a-z]?`. This exception is confined to the single story below and is grep-friendly.

| REQ | Stories | Phase(s) |
|-----|---------|----------|
| REQ-01 Story-level RunRecords with verdict and cost | PH01-US-00a, PH01-US-00b | PH-01 |
| REQ-02 Dependency-ordered story dispatch | PH01-US-02 | PH-01 |
| REQ-03 Dual-source state reconstruction | PH01-US-03 | PH-01 |
| REQ-04 Story status classification | PH01-US-04 | PH-01 |
| REQ-05 PhaseTransitionBrief output | PH01-US-01, PH01-US-05 | PH-01 |
| REQ-06 Budget advisory signaling | PH02-US-01 | PH-02 |
| REQ-07 Time budget advisory signaling | PH02-US-02 | PH-02 |
| REQ-08 INCONCLUSIVE routing and dep-failed propagation | PH02-US-03 | PH-02 |
| REQ-09 Crash-safe state recovery | PH02-US-04 | PH-02 |
| REQ-10 Replanning note collection and routing | PH03-US-01, PH03-US-02 | PH-03 |
| REQ-11 Velocity, accumulated cost, and audit observability | PH03-US-03 | PH-03 |
| REQ-12 Graduation of repeated failure patterns | PH03-US-04 | PH-03 |
| REQ-13 Plan mutation reconciliation | PH03-US-05 | PH-03 |
| REQ-14 MCP handler and expanded input schema | PH04-US-01 | PH-04 |
| REQ-15 Optional output-shaping config file | PH04-US-01b | PH-04 |
| REQ-16 Checkpoint gates as brief-only outputs | PH04-US-02 | PH-04 |
| (test and dogfood scaffolding — no REQ) | PH01-US-06, PH04-US-03, PH04-US-04 | PH-01, PH-04 |

Coverage rule: every REQ maps to at least one implementation story. Scaffolding stories (3 of 22) are the verification mechanism and do not map to a specific REQ.

---

## 12. References

- **Authoritative implementation plan:** `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` — the full 23-story spec, phase decomposition, risk table, and `PhaseTransitionBrief` interface. **v1.1 sync note:** the implementation plan file was authored against this PRD's v1.0 state machine and still references the 4-state machine and `blockedStories`. It MUST be re-synced to v1.1 (6-state machine, `needs-replan`, `depFailedStories`, embedded `evalReport`) before PH-01 begins; this sync is flagged as forge-plan's S2 responsibility per the mailbox exchange that triggered this revision. Until the re-sync lands, any implementer picking up the impl plan will build the v1.0 contract.
- **Parent design doc:** `docs/forge-harness-plan.md` §4 (`/coordinate — The Coordinator`), lines 314-352
- **Scope boundary rationale:** `docs/primitive-backlog.md` "Scope Boundary Decisions" (committed in this branch)
- **Style template:** `docs/forge-generate-prd.md` — reference PRD for the prior primitive, used as shape/rigor template
- **Current stub:** `server/tools/coordinate.ts` (16 lines)
- **Data structures consumed:** `server/types/execution-plan.ts`, `server/types/master-plan.ts`, `server/types/generate-result.ts` (`EscalationReason`), `server/types/eval-report.ts` (`verdict`)
- **Existing infrastructure to reuse:** `RunContext`, `CostTracker`, `ProgressReporter`, `AuditLog` (shipped in v0.7.0); canonical `writeRunRecord` in `server/lib/run-record.ts` (NOT the generator JSONL writer at `server/lib/generator.ts:484`); `detectCycles` in `server/validation/execution-plan.ts`
- **S1 clarifying questions exchange:** `claude-code-mailbox/mailbox/archive/2026-04-09T0145-lucky-iris-to-forge-plan-s1-prd-clarifying-questions.md` and the answer archived at `2026-04-09T1455-forge-plan-to-lucky-iris-s1-prd-answers.md`

---

## Historical v1.0 audit sections

> **Note:** The "Corrector-2 Side-Effect Audit", "Final internal consistency sweep", and "AC-CHECK shell commands" sections below are **historical artifacts from v1.0's double-critique (Rounds 1 and 2)**. They describe the v1.0 state machine (4 story statuses, `blocked` as a `brief.status` value, the old `blockedStories` field) and are preserved for audit traceability but are **superseded by the v1.1 state machine and the Round 3 Critique Log at the end of this document**. When a v1.0 audit statement contradicts a v1.1 section, v1.1 wins.

## Corrector-2 Side-Effect Audit (historical — v1.0)

```
SIDE-EFFECT-CHECK: C1 — unify brief.status resolution across REQ-05/REQ-08/REQ-15
  format: ok
  naming: ok — no new enum values; existing 4-value brief.status enum (in-progress | complete | blocked | halted) preserved.
  shape:  REQ-05 now contains the authoritative "brief.status resolution rule" block with 4 ordered cases (halted → complete → blocked → in-progress). REQ-05 AC-5 (old "failed-with-no-blockers → in-progress" wording) is replaced by three explicit ACs: (a) all-failed phase → blocked, (b) failed + ready/pending → in-progress, (c) all-done under halt-hard → halted. REQ-08 AC-4 rewritten to state it is a specific instance of REQ-05 rule 3. REQ-15 halt-hard state machine rewritten in two new ACs that point at REQ-05 rule 1 as the authority. §5 Failure Path updated to note brief.status may be in-progress OR blocked depending on forward-progress possibility.
  refs:   REQ-05, REQ-08, REQ-15, §5 Failure Path, SC-04 (added "all-failed-phase → blocked status" and "halt-hard clearing-safety" integration tests).

SIDE-EFFECT-CHECK: M1 — graduateFindings wrapper object
  format: ok
  naming: ok — new wrapper type `{ findings: Finding[], windowInflationRisk: boolean }`.
  shape:  REQ-12 AC-1 rewritten to specify the wrapper return type. AC-3 rewritten to place `windowInflationRisk` as a field on the wrapper (not a property attached to an array). New AC added covering the empty-findings case (returns `{ findings: [], windowInflationRisk: <bool> }`, never null/undefined). No other REQ references graduateFindings' return shape — REQ-05's brief field list does not include graduation output.
  refs:   REQ-12 only.

SIDE-EFFECT-CHECK: M2 — REQ-13 "superseded" removed, new-story rule clarified
  format: ok
  naming: ok
  shape:  REQ-13 AC-3 completely rewritten. "Superseded" terminology removed. New-story rule is now explicit and binary: a story is "new" iff it is present in the plan AND has zero prior primary RunRecords. New stories start as `pending` and flow through REQ-04's "most recent" rule. The prior "or failed if a prior FAIL record exists and has not been superseded" carve-out is deleted — that case is handled by REQ-04, not by REQ-13. Orphaned-record definition added inline to the previous AC. Test list updated to reference REQ-04 as the handler for the failed-to-done transition.
  refs:   REQ-13 only; no other REQ used "superseded".

SIDE-EFFECT-CHECK: M3 — REQ-15 halt-hard trigger and clearing semantics
  format: ok
  naming: ok
  shape:  REQ-15 AC-6 split into three ACs: (a) trigger — fires on structural completeness (`completedCount === totalCount` AND no failed AND no blocked) combined with `halt-hard` config; (b) clearing — `haltClearedByHuman: true` ONLY re-runs REQ-05 rules 2-4 against current state, does NOT override actual failed/blocked state, with three explicit consequences enumerated; (c) safety AC — cleared-but-now-failed → status is `blocked`, not `complete`. The state machine threads cleanly through REQ-05 resolution rule 1 (halted) down to rules 2-4 (complete/blocked/in-progress). No field/type changes.
  refs:   REQ-15 (major expansion), REQ-05 (referenced as authority), SC-04 (test added).

SIDE-EFFECT-CHECK: M4 — move readAuditEntries from REQ-03 to REQ-11
  format: ok
  naming: ok — function name, file path, and signature unchanged.
  shape:  REQ-03's readAuditEntries AC deleted; a note added explaining audit entries are observability-only and REQ-11 owns the helper. REQ-11 title expanded to "Velocity, accumulated cost, and audit observability". REQ-11 gains: (a) new AC for `readAuditEntries` behavior (same graceful-degradation contract), (b) new `includeAudit?: boolean` option on `aggregateStatus` (default `false`), (c) `auditEntries: AuditEntry[]` added to `aggregateStatus` return when the option is set. §11 traceability table row for REQ-11 updated to reflect the new title.
  refs:   REQ-03, REQ-11, §11 row for REQ-11.

SIDE-EFFECT-CHECK: MINOR m1 — drop -r from explicit-file grep commands
  format: ok
  naming: ok
  shape:  NFR-C01 and SC-03 commands changed from `grep -rn` to `grep -n` because their arguments are an explicit file list. §3 portability paragraph updated to document the "-r only for directory scans" convention. §9 shell-portability resolution updated identically. POSIX-ERE alternative updated from `grep -rnE` to `grep -nE`. REQ-01 keeps `-rn` because it scans `server/` (a directory) — this was spot-verified and an AC-CHECK note was added.
  refs:   NFR-C01, SC-03, §3 intro, §9, REQ-01 AC-CHECK note.

SIDE-EFFECT-CHECK: MINOR m2 — rename PH04-US-01.5 → PH04-US-01b
  format: ok
  naming: ok — the single-letter suffix is documented as an explicit exception; the grep regex `PH\d\d-US-\d\d[a-z]?` accommodates it.
  shape:  §11 intro paragraph rewritten to document the exception inline. §11 table row for REQ-15 updated from `PH04-US-01.5` to `PH04-US-01b`. No other section of the PRD references this story ID.
  refs:   §11 intro, §11 table row for REQ-15.

SIDE-EFFECT-CHECK: MINOR m3 — pin REQ-10 P45 warning text
  format: ok
  naming: ok
  shape:  REQ-10 AC-6 now pins the exact prefix `"WARNING: unknown EscalationReason routed to gap-found: "` and includes a test assertion `expect(stderr).toMatch(/WARNING: unknown EscalationReason routed to gap-found: /)`. Converts the AC from soft to binary-testable.
  refs:   REQ-10 only.

SIDE-EFFECT-CHECK: MINOR m4 — document REQ-06 checkBudget signature
  format: ok
  naming: ok — signature changed from `checkBudget(ctx, budgetUsd, priorRecords)` to `checkBudget(priorRecords, budgetUsd)`. Parameter `ctx` was removed because it was undocumented and the function is pure.
  shape:  REQ-06 AC-1 now spells out parameter types (`priorRecords: ReadonlyArray<PrimaryRecord | GeneratorRecord>`, `budgetUsd: number | undefined`) and explicitly states checkBudget is a pure function with no RunContext — the P45 warning is surfaced via `incompleteData: true` for the caller to log. AC-5 updated to say "the caller's logging path emits the P45 warning" instead of implying checkBudget itself logs.
  refs:   REQ-06 AC-1, AC-5.
```

### Final internal consistency sweep

- **Status enum walk (brief.status = 4 values; StoryStatusEntry.status = 5 values).** Walked REQ-04, REQ-05, REQ-08, REQ-09, REQ-13, REQ-15, REQ-16, §5 (all four workflows). REQ-05 is the authoritative source; REQ-08 AC-4 and REQ-15 halt-hard ACs explicitly defer to REQ-05 rules. No contradictions.
- **§11 traceability table walk.** 16 REQs present, 22 stories accounted for (8 + 4 + 5 + 5 = 22), 3 scaffolding stories flagged in the footer, `PH04-US-01b` naming applied consistently, REQ-11 title matches §3 REQ-11 heading.
- **§5 workflow walk.** Happy Path exits on `brief.status === "complete"` (REQ-05 rule 2). Failure Path now correctly notes `brief.status` may be `in-progress` or `blocked` (REQ-05 rules 3 and 4). Escalation Path references `status === "blocked"` (rule 3) and `haltClearedByHuman: true` (REQ-15). Crash Recovery references REQ-09 state reconstruction. All workflows internally consistent.
- **NFR-C01 vs SC-03 command parity.** Both commands reference the same 7-file list and both use `grep -n` (not `-rn`). The file lists are byte-identical across the two ACs. Verified by reading the two strings against each other.
- **graduateFindings isolation.** No REQ-05 brief field depends on `graduateFindings` output; the wrapper change is self-contained. REQ-12 is the only consumer.
- **readAuditEntries isolation.** Removed from REQ-03, added to REQ-11, referenced in §11 table REQ-11 row. No other section references the function. Move is clean.

### AC-CHECK shell commands (NFR-C01 and SC-03 expanded file list)

- Both `grep -n 'callClaude\|trackedCallClaude' <7 files> 2>/dev/null` — syntax:ok, semantics:ok, portability:ok. All 7 files in the list are either coordinator-authored (`server/lib/coordinator.ts`, `server/lib/topo-sort.ts`, `server/lib/run-reader.ts`, `server/tools/coordinate.ts`, `server/types/coordinate-result.ts`) or transitive dependencies (`server/lib/run-record.ts`, `server/validation/execution-plan.ts`). The `2>/dev/null` guard safely degrades if any file is not yet created. The `test -z "..." && echo EMPTY-OK` wrapper guarantees binary pass/fail.

### Fixes skipped with rationale

None — all 9 Critic-2 findings (1 CRITICAL, 4 MAJOR, 4 MINOR) were applied in full.

### Verified vs unverified claims

VERIFIED: `server/lib/run-record.ts` path exists in the working tree (previously confirmed by Corrector-1; no new verification required for this pass).
UNVERIFIED: exact line numbers (`server/lib/run-record.ts:43`, `server/lib/generator.ts:484`, `server/tools/evaluate.ts:170-251`) — preserved from prior stages without re-verification. These are preserved because no Critic-2 finding disputes them, and REQ-01's AC is qualitative (not line-number-dependent).
UNVERIFIED: the precise current count of `await writeRunRecord(` call sites — REQ-01 uses a qualitative "every visible call site" rule precisely to avoid pinning a count that could churn.

### REQ/NFR/SC counts (stability check)

- REQs: 16 (unchanged)
- NFRs: 10 (unchanged)
- SCs: 8 (unchanged)

---

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 2
- **MAJOR:** 6
- **MINOR:** 5

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | REQ-04 missing `failed` status — FAIL-verdict stories would silently re-dispatch as `ready`/`pending` | Yes | Added `failed` to status enum, rippled through REQ-05/08/09/13, §2, §5 (new Failure Path), §7 (no-auto-retry), SC-04 |
| 2 | CRITICAL | REQ-15 `writeRunRecord: false` contradicts NFR-C03 "crash-safe" invariant framing | Yes | Softened NFR-C03 wording to reflect explicit opt-out path; REQ-15 AC rewritten to drop contradictory parenthetical |
| 3 | MAJOR | REQ-10 INCONCLUSIVE maps to `ac-drift` as escalation reason but `gap-found` as eval verdict | Yes | Unified: INCONCLUSIVE → `gap-found` in both contexts (tool failure = knowledge gap) |
| 4 | MAJOR | REQ-10 `dependency-satisfied` category declared closed-exhaustive but never emitted | Yes | Added emission rule: reconcileState unblocking a previously-blocked story emits `dependency-satisfied` with `severity: "informational"` |
| 5 | MAJOR | NFR-C01 $0-mode grep only scans 5 coordinator-authored files; shared deps unchecked | Yes | Expanded file list to include `server/lib/run-record.ts` and `server/validation/execution-plan.ts`; SC-03 mirrored |
| 6 | MAJOR | REQ-11 `velocityStoriesPerHour` has no formula; generator records lack storyId | Yes | Defined concretely as `completedStoryCount / elapsedHours` from primary records (which have both storyId and timestamp) |
| 7 | MAJOR | REQ-12 "plan-execution window" anchors to earliest matching record and inflates across runs | Yes | Added optional `currentPlanStartTimeMs` input; documented fallback + inflation risk flag; threaded through REQ-14 schema |
| 8 | MAJOR | REQ-01 hardcoded "6 hits" baseline is brittle under refactors | Yes | Replaced count with qualitative "every `await writeRunRecord(` call site populates three fields" rule |
| 9 | MINOR | §11 traceability table ID notation inconsistent (`PH01-US01` vs `PH-01 US-01`) | Yes | Normalized to `PHxx-US-yy` throughout |
| 10 | MINOR | SC-01 "22 stories" doesn't name the scaffolding stories inside the count | Yes | Explicitly listed PH01-US-06 + PH04-US-03 + PH04-US-04; §11 footer rephrased |
| 11 | MINOR | NFR-C03 verification "fixture-based test" ambiguous (actual kill vs simulated?) | Yes | Clarified as simulated crash fixture (coordinator is pure, structurally equivalent) |
| 12 | MINOR | GNU `\|` alternation called "POSIX-portable" but requires GNU grep | Yes | Softened to "GNU-grep-portable where `\|` is used"; POSIX-ERE alternative noted in NFR-C01 |
| 13 | MINOR | REQ-15 Zod schema unclear on strict-vs-passthrough for unknown fields | Yes | Explicit `.strict()` mode AC added with named-field warning path; resource-cap rejection derives from `.strict()` |

### Round 2 (Critic-2)
- **CRITICAL:** 1
- **MAJOR:** 4
- **MINOR:** 4

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| 1 | CRITICAL | REQ-05 and REQ-08 disagree on `brief.status` when every story is `failed` (in-progress vs blocked) | Yes | Added REQ-05 authoritative 4-case resolution rule (halted → complete → blocked → in-progress); REQ-08/REQ-15 rewritten as instances; all-failed → blocked now explicit AC |
| 2 | MAJOR | REQ-12 `graduateFindings` return shape self-contradictory (AC-1 array vs AC-3 object attr) | Yes | Changed return to wrapper `{ findings: Finding[], windowInflationRisk: boolean }`; all ACs updated consistently |
| 3 | MAJOR | REQ-13 uses undefined term "superseded" and mishandles new-story trichotomy | Yes | Removed "superseded"; new-story rule now "present in plan AND zero prior primary RunRecords"; failed→done routed through REQ-04 most-recent rule |
| 4 | MAJOR | REQ-15 halt-hard trigger and clearing semantics underspecified | Yes | Split into three ACs: structural-completeness trigger, clearing-runs-rules-2-4-only, cleared-but-failed → blocked-not-complete safety |
| 5 | MAJOR | REQ-03 `readAuditEntries` specified but no downstream consumer — dangling export | Yes | Moved from REQ-03 to REQ-11; `aggregateStatus` gains `includeAudit?: boolean` option; §11 table updated |
| 6 | MINOR | `grep -rn` with explicit file args has redundant `-r` | Yes | NFR-C01/SC-03 switched to `grep -n` for file lists; REQ-01 directory scan keeps `-rn`; portability note in §3 documents the convention |
| 7 | MINOR | `PH04-US-01.5` breaks declared `PHxx-US-yy` convention | Yes | Renamed to `PH04-US-01b`; §11 intro documents the `[a-z]?` suffix exception |
| 8 | MINOR | REQ-10 P45 warning text not pinned — not binary-testable | Yes | Exact warning prefix quoted with test assertion; AC now binary-greppable |
| 9 | MINOR | REQ-06 `ctx` parameter undocumented | Yes | Signature documented as `(priorRecords, budgetUsd)`; `ctx` removed as undocumented/unused; function declared pure with logging delegated to caller |

### Summary
- Total findings: **22** across both rounds (3 CRITICAL, 10 MAJOR, 9 MINOR)
- Applied: **22 (100%)**
- Rejected: 0
- Key changes across both rounds:
  1. **Status enum completion.** Added `failed` as a fifth story status (Round 1 C1) and then wrote an authoritative 4-case brief-status resolution rule in REQ-05 (Round 2 C1) that makes the all-failed case terminal (`blocked`) rather than misleadingly `in-progress`. These two fixes are load-bearing: together they close the "FAIL verdict silently re-dispatches" contract hole.
  2. **Shell portability to Windows/Git Bash.** Replaced all `rg` commands with `grep -rn`/`-n` variants, fixed the `-r` convention (directories only, not explicit files), documented the `\|` GNU dependency, and added an end-to-end portability note in §3. The PRD's ACs are now executable in the author's dev env and on both `ubuntu-latest` and `windows-latest` CI.
  3. **Mechanical classifier coherence.** REQ-10 INCONCLUSIVE mapping unified, `dependency-satisfied` category wired to a real emitter, unknown-reason default route added — so the replanning-note routing table is now both total and unique (every input has exactly one category).
  4. **Observability scope tightening.** `readAuditEntries` moved from REQ-03 (state reconstruction) to REQ-11 (observability) where it actually has a consumer; `velocityStoriesPerHour` given a concrete primary-records formula instead of an undefined generator-records reference.
  5. **Contract sharpening on undefined shapes.** REQ-12 wrapper object, REQ-13 "superseded"→"zero prior records", REQ-15 halt-hard three-AC split, REQ-01 qualitative-not-count baseline — all turn vague invariants into shell-testable predicates.
  6. **Safety rail for `writeRunRecord: false`.** Instead of dropping the opt-out (which the plan needed), NFR-C03 explicitly acknowledges it as a sanctioned degradation with a user-visible warning chain (config → loader → brief recommendation prefix), so the NFR remains verifiable as an invariant "except under explicit opt-out."

### Round 3 (v0.16.2 scoped delta critique)

Scoped critique per forge-plan's 2026-04-09T17:20 revision directive. Two independent critics reviewed ONLY the delta (REQ-01, REQ-04, REQ-05, REQ-08, REQ-10, REQ-13, SC-04, §5, §7, REQ-15 halt-hard ACs). The 10 NFRs and 9 unchanged REQs were not in scope except where Critic-2 flagged cross-cutting interactions.

- **CRITICAL:** 2
- **MAJOR:** 11
- **MINOR:** 13

**Critic-1 findings (state machine coherence, workflow probes):**

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| C1-C1 | CRITICAL | REQ-04 `done` vs `failed` precedence ambiguous: 3-FAIL-then-1-PASS could be mis-classified as `failed` because both rules match | Yes | Added explicit "Classification precedence (top-to-bottom, first match wins)" block to REQ-04 with rule 1 `done` dominating. Added "done-after-retry precedence AC" with explicit fixture (FAIL, FAIL, FAIL, PASS → `done`). |
| C1-C2 | CRITICAL | §5 Retry Path step 4 says "retryCount increments" — misleading because a PASS record does NOT increment the counter, it promotes to `done` | Yes | Rewrote step 4 with explicit PASS vs FAIL/INCONCLUSIVE branches; cross-linked to REQ-04 rule 1 dominance. |
| C1-M1 | MAJOR | `readyStories` merges `ready` and `ready-for-retry` with no distinguisher; naïve callers will blind-retry | Yes | Added REQ-05 "`readyStories` semantics AC" mandating callers cross-reference `stories[]` by ID before dispatching; documented in §5 Happy Path step 3 and Retry Path step 1. Deferred array split to v2 pending error-rate measurement. |
| C1-M2 | MAJOR | Retry counter has no plan-execution window; cross-plan story-ID reuse contaminates retry budgets | Yes | Added REQ-04 "Retry counter scoping to current plan execution" AC — optional `currentPlanStartTimeMs` clipping (same mechanism as REQ-12). Fallback's cross-plan limitation documented in REQ-04 and §7. |
| C1-M3 | MAJOR | Renaming a `failed` story is a retry-budget bypass; §7 silent on the escape hatch | Yes | Added new §7 out-of-scope row "Retry-budget reset via story rename (acknowledged escape hatch)" explicitly documenting the trade-off. |
| C1-M4 | MAJOR | EvalReport embedding has no size/determinism guards; NFR-C02 and read-perf hazards | Yes | Added REQ-01 "Deterministic serialization AC" (sorted findings before write) and storage/performance note. Updated NFR-C06 with growth acknowledgement and NFR-C10 with the determinism precondition. |
| C1-M5 | MAJOR | REQ-10 `dep-failed-chain` "one note per chain" ambiguous with multiple independent roots | Yes | Rewrote the trigger AC: "one `ReplanningNote` per distinct root `failed` story" with a binary-testable assertion `expect(...filter(...).length).toBe(rootFailedCount)`. Added a two-root test case to SC-04. |
| C1-M6 | MAJOR | Mixed failed+ready → `needs-replan` regresses v1.0 forward-progress principle without a caller override | Partial | Owned the behavior change explicitly in REQ-05 rule 3 rationale and REQ-08 scope note. Rejected adding a `proceedWithPartialFailure` input arg because forge-plan's revision brief explicitly specified "any story is failed OR dep-failed → needs-replan"; the escape hatch is REQ-13's rename/remove path, which is documented in §5 Failure Path step 4. **Rationale for rejecting Critic-1's suggested input arg:** it would re-introduce the v1.0 phase-level "blocked" ambiguity through the back door and defeat the "collapse to plan-correction signal" design intent. Documented as an explicit design trade-off. |
| C2-C1 | CRITICAL | REQ-04 `failed` definition incorrectly gated on "dependencies are done", creating a terminal-state race with `dep-failed` | Yes | Removed "AND all its `dependencies` are `done`" from the `failed` rule. Added explicit "dep-failed dominates failed (rule 2 > rule 3)" AC with fixture. The retry counter is now a pure per-story check, independent of dep state. |
| C2-C2 | CRITICAL | REQ-12 graduation double-counts: one retry-exhausted story contributes 3 identical escalation reasons and self-graduates | Yes | Added REQ-12 "Distinct-storyId dedup" AC: `graduateFindings` dedupes by `(storyId, escalationReason)` before applying the ≥3 threshold. Binary-testable fixture included. This is the highest-impact cross-cutting fix in Round 3 — it touches an unchanged REQ whose counting semantics were silently broken by the REQ-04 retry machine. |
| C2-M1 | MAJOR | No "last retry" warning; caller learns about exhaustion only post-hoc | Yes | Added REQ-05 "`LAST RETRY` warning AC": when any entry has `retriesRemaining === 1`, `brief.recommendation` must contain `"LAST RETRY: <storyId>"`. Binary-testable regex. |
| C2-M2 | MAJOR | REQ-14 schema doesn't document intentional omission of `maxRetries` | Yes | Added REQ-14 "Intentional omission" AC with cross-link to §7 and the "four config fields only" invariant in REQ-15. |
| C2-M3 | MAJOR | NFR-C08 "no absent keys" broken by optional `priorEvalReport` | Yes | Changed `StoryStatusEntry.priorEvalReport` and `.evidence` from TypeScript optional (`?`) to **non-optional with explicit null**. Updated NFR-C08 with the reaffirmation and a runtime `Object.keys(entry).sort()` invariant check. |
| C2-M4 | MAJOR | NFR-C06 / NFR-C10 silent on disk growth and serialization determinism | Yes | NFR-C06 got a v1.1 growth acknowledgement (back-of-envelope: ~300KB per retry-heavy phase); NFR-C10 got a serialization-determinism precondition cross-linked to REQ-01's new AC. |
| C2-M5 | MAJOR | `priorEvalReport` populated for `failed` stories without documented use case | Yes | Added explicit one-sentence justification in REQ-05 inline comment and NFR-C08 reaffirmation: the field exists on `failed` so the caller's replan decision (re-scope / re-phrase / delete) can reference the specific exhausting findings. |
| C1-m1 | MINOR | PASS records waste storage via empty `evalReport` | Yes | Acknowledged in REQ-01 storage/performance note: "pure overhead and may be optimized in a future release if measurements warrant." |
| C1-m2 | MINOR | REQ-08 rationale overclaims "honors spirit" of PH-02 US-03 | Yes | Softened REQ-08 rationale paragraph: story-level isolation preserved, phase-brief-level forward-progress NOT preserved — documented as explicit design trade-off. |
| C1-m3 | MINOR | Flaky eval tool concern not documented | Yes | Added REQ-04 "Known limitation" paragraph and new §7 out-of-scope row "Flaky-eval compensation" with promotion criteria. |
| C1-m4 | MINOR | Field rename `blockedStories` → `depFailedStories` is a silent breaking change | Yes | Verified via Critic-2's `tests/` grep: zero existing fixtures reference `blockedStories`. Documented as a REQ-05 wire-level rename (breaking for a .2 release — acceptable because no consumers exist). |
| C1-m5 | MINOR | REQ-13 doesn't cover upstream-rename dangling-dep case | Yes | Added REQ-13 "Dangling-dependency AC": stale dep references classify the downstream as `pending` with `evidence: "dep <id> missing from plan"` and a P45 warning. Test case added to SC-04. |
| C1-m6 | MINOR | REQ-15 halt-hard latch contradicts rule 1 dominance wording | Yes | Reconciled: rule 1 is **non-latching** — re-evaluated on every call against current reconciled state. Added "halt-hard non-latching AC" with fixture (halted phase + injected failure → `needs-replan` on next call). |
| C1-m7 | MINOR | SC-04 missing 3-FAIL-then-PASS test | Yes | Added to SC-04 integration test list ("3-FAIL-then-PASS → `done` (done-after-retry precedence)"). |
| C2-m1 | MINOR | §2 bullet 3 should annotate terminal vs forward-progress states | Yes | Added inline annotation: "Terminal: done, failed, dep-failed. Forward-progress: ready, ready-for-retry, pending." |
| C2-m2 | MINOR | REQ-09 verified-clean (already updated) | N/A | Verified; no action required. |
| C2-m3 | MINOR | §11 REQ-08 table label stale ("INCONCLUSIVE transitive blocking") | Yes | Renamed to "REQ-08 INCONCLUSIVE routing and dep-failed propagation" to match the updated REQ heading. |
| C2-m4 | MINOR | REQ-01 PASS-case `evalReport` propagation not pinned | Yes | Clarified in REQ-01 storage note: "PASS-case `evalReport` is written for shape uniformity but is never propagated to `StoryStatusEntry.priorEvalReport`." |
| C2-m5 | MINOR | Implementation plan is stale (still uses v1.0 state machine); downstream wire risk | Partial | **Not a PRD bug** — out of scope for this revision per forge-plan's explicit statement that the impl plan is being handled on their side in S2. Flagged as a §12 References sync note rather than an SC gate, to avoid bumping the SC count from 8 to 9 (forge-plan: "No count change expected"). The impl plan re-sync is forge-plan's S2 responsibility. |
| C2-m6 | MINOR | `tests/` wire-breakage check | N/A | Verified-clean by Critic-2 — zero matches for `blockedStories` in the test suite. No action required. |
| C2-m7 | MINOR | REQ-01 schema version unpinned | Yes | Added clarifying line: "RunRecord schema version (if present) is unchanged; `evalReport` is added as an optional field without incrementing." |

### Round 3 Summary

- Total findings: **26** (2 CRITICAL, 11 MAJOR, 13 MINOR)
- Applied in full: **24 (92%)**
- Applied in part with documented rationale: **1** (C1-M6 — rejected the `proceedWithPartialFailure` input arg while accepting the mixed-state behavior change)
- Rejected / verified-clean: **1 partial (C2-m5 — out of scope for PRD, forge-plan S2 responsibility) + 2 verified-clean (C2-m2, C2-m6)**
- **Key architectural shifts from Round 3:**
  1. **Classification precedence (Round 3 C1-C1 + C2-C1).** The 6-state machine now has an explicit top-to-bottom priority order: `done` > `dep-failed` > `failed` > `ready-for-retry` > `ready` > `pending`. Rules are no longer written as independent iffs (which are only correct when the rules are trivially disjoint); they are written as a precedence chain where the first match wins. This closes TWO real bugs simultaneously: a 3-FAIL-then-PASS story is `done`, and a failed story with in-flight upstream is still `failed` (not accidentally `pending` via the old "dependencies are done" guard).
  2. **Cross-cutting REQ-12 fix (Round 3 C2-C2).** Adding the retry counter to REQ-04 silently broke the graduation counter in REQ-12 — same primary-RunRecord source, same counting verb, different intent. Deduping by `(storyId, escalationReason)` restores REQ-12's "≥3 distinct stories" semantics. This is the most important finding of Round 3 because it proves the scoped-critique discipline works: a narrow look at REQ-04 alone would have missed it; a full-PRD critique would have buried it among lower-priority noise.
  3. **Non-latching halt-hard (Round 3 C1-m6).** The earlier wording conflated "rule 1 dominates" (per-call priority) with "rule 1 latches" (persistent state). v1.1 is explicit: halt-hard is re-evaluated on every call, not latched. This makes the clearing semantics consistent with the non-latching trigger, and eliminates a class of "but what if state changes between halt and clear?" edge cases that Critic-1 flagged as contradictory.
  4. **Field-shape discipline (Round 3 C2-M3).** Converting `priorEvalReport` and `evidence` from optional to non-optional-with-null preserves NFR-C08 under the new fields and matches the existing `budget.remainingUsd: null` pattern. This is a small change with an outsized effect on structural-equality tests (NFR-C02) and wire compatibility.
  5. **Deferred via explicit escape hatch (Round 3 C1-M6).** Rather than adding a `proceedWithPartialFailure` input arg (which would have re-introduced v1.0 `blocked`-like semantics through the back door), v1.1 routes the "continue-on-partial-failure" use case through REQ-13's rename/remove path. This preserves forge-plan's stated design intent and keeps the brief.status enum at exactly 4 values.
