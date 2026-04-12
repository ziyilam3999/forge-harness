# Detailed Implementation Plan — Post-v0.20.1

> **Type:** Detailed architectural fix specification. For the short todo-list view, see `2026-04-12-execution-overview.md`. This file is the authoritative source for implementation-level decisions (module names, file paths, schema fields, CI workflow triggers, root-cause analysis, etc.).

## ELI5

We just shipped the divergence fix. Two architectural problems remain in forge-harness itself: (1) plans never get updated after implementation so they drift, and (2) the test commands inside plans are trusted as ground truth even though an LLM wrote them. This plan specifies the permanent fixes built INTO forge-harness (not one-time patches) for both problems. Q0 closes the plan-writeback loop. Q0.5 adds an AC verification layer. Q1–Q3 are downstream cleanup that Q0/Q0.5 make easier.

## Context

- v0.20.1 shipped (PR #151): BUG-DIV-CWD fix + reverseFindings schema
- Divergence trajectory: 93 → 80 → **7 total** (forward 0 real, reverse 7 session-emulated)
- forge_coordinate roadmap: **COMPLETE** (all 4 phases, 548 tests)
- S8 Kanban Dashboard is the only untouched roadmap item
- Calibration loop was explicitly queued behind forge_coordinate
- Issues open: #149 (OAuth 401), #150 (coherence mode), #152 (parse-failure status)

## Queued Items

### Q0 — Close the plan-writeback loop (forge_plan update mode orphan fix)

**Priority: HIGHEST, tied with Q0.5 (they run in parallel).** Both precede Q1 because a broken feedback loop is worse than a broken ruler, and because Q0.5 makes Q1's manual AC rewrite mostly unnecessary (ac-lint + retroactive critic will auto-surface the suspect ACs — see Q0.5/A3b for the exact count).

**The problem:** `forge_plan(documentTier: "update")` exists since v0.8.0 (`server/tools/plan.ts:870`), but **has no persisted evidence of invocation in this repo's run history** (no `forge_plan-*.json` files in `.forge/runs/`, no `"tier": "update"` hits in `.forge/runs/` or `.ai-workspace/dogfood/`). Invocation without persistence is theoretically possible, but functionally equivalent: if no record survived, no downstream consumer ever saw the output. The PRD explicitly delegated this to "the caller" (`docs/forge-coordinate-prd.md:250,454`) and deferred automation to v2. v2 was never built. Result: 7 reverse divergence findings accumulated across PH-01..PH-04 + S7 because nobody owned the reconciliation step.

**Root cause:** Accountability gap at the primitive boundary. Detection exists (`forge_evaluate(divergence)` + `reverseFindings`, `coordinator.ReplanningNote`, `reconcileState`). Writeback exists (`forge_plan(update)`). **No glue connects them.**

**Fix in three layers (do all three):**

1. **Workflow layer — mandatory ship-gate step**
   - Update `/ship` skill (or create `/forge-reconcile` sub-skill) so no phase PR merges unless `forge_plan(documentTier: "update")` has run within the same session
   - Binary: every phase PR body contains exactly one of the following three forms: `"plan-refresh: no-op"`, `"plan-refresh: <N> items"`, or `"plan-refresh: baseline"` (the third is the empty-history case defined in layer 2)
   - **Marker-read source-of-truth (R2/C1-3 fix):** the `/ship` gate reads the one-time-only marker via `git show origin/master:.forge/.plan-refresh-initialized` (server-side, not working tree). This makes the gate immune to shallow clones, `git clean -fdx .forge/`, and any uncommitted state on the contributor's branch. Binary: the gate's presence-check step literally invokes `git show origin/master:.forge/.plan-refresh-initialized` and treats a non-zero exit as "baseline allowed"; any other source of the marker is disallowed.
   - **Failure-mode spec:** if `forge_plan(update)` itself errors (Anthropic API 5xx, OAuth 401 per #149, parse failure per #152), the gate emits `"plan-refresh: error: <reason>"` and **blocks merge by default**. Operator override requires a literal `plan-refresh-override: <reason>` line committed in the PR body; the `/ship` skill refuses to merge otherwise.

> **Amendment 2026-04-12 — swift-henry:** Q0/L2 scope extended from 2 routing rules to 5, per `docs/primitive-backlog.md:196-201` completeness check (the [UNVERIFIED] tag below upgrades to [VERIFIED 2026-04-12]). See forge-plan mailbox `2026-04-12T1355-forge-plan-to-swift-henry-a1-approved-with-tweak.md` for approval. Added handling for `gap-found` (deferred-to-audit, surfaced-in-brief, NO `forge_plan` auto-read), `severity: "blocking"` (atomic halt before any plan mutation), and `affectedPhases` (phase-tier scope narrowing, ignored on master-plan routes). New `PhaseTransitionBrief.deferredReplanningNotes: number` field (additive optional, P50). Explicit negative AC: `forge_plan` is NOT modified in Q0/L2 (prevents scope creep into primitive contract). This amendment is a docs-only change and ships as commit 1 of the L1 PR per forge-plan's piggyback recommendation. Candidate anti-pattern captured for Q0/L7 hive-mind write-up: "Completeness critique requires upstream enumeration" (F61 candidate, n=1).

2. **Integration layer — build the v2 self-healing Y-pipe**
   - **Pre-step (verification):** Before implementation begins, read `docs/primitive-backlog.md` and confirm the exact category strings used in the mapping below. If they differ, update the precedence list before coding. This is a hard prerequisite because the categories are [UNVERIFIED] and the conflict-precedence logic depends on exact names. **[VERIFIED 2026-04-12 swift-henry]** — pre-step completed against `docs/primitive-backlog.md:188` (enum) and `:196-201` (routing rules). All 4 category strings (`ac-drift`, `assumption-changed`, `partial-completion`, `dependency-satisfied`) match byte-for-byte; 2 cited rules match exactly; precedence is internally consistent. No delta to the precedence list. Completeness gap found and amended — see banner above.
   - New orchestration: `forge_evaluate(reverse)` + `coordinator.ReplanningNote` → category mapping → `forge_plan(update)` → atomic plan write
   - **Category mapping per `docs/primitive-backlog.md:196-201` [VERIFIED 2026-04-12 swift-henry] — 5 routing rules, exhaustive over the `ReplanningNote.category` × `severity` × `affectedPhases` surface:**
     - `ac-drift` + `assumption-changed` → master plan update via `forge_plan(update)`
     - `partial-completion` + `dependency-satisfied` → phase plan update via `forge_plan(update)`
     - `gap-found` → **deferred to audit + surfaced in brief, NO `forge_plan(update)` invocation** (see A1.1 below)
     - `severity: "blocking"` → **atomic halt before any plan mutation** (see A1.2 below)
     - `affectedPhases` → **phase-tier scope narrowing; ignored on master-plan routes** (see A1.3 below)
   - Could be a new MCP tool (`forge_reconcile`) or a new mode on `forge_coordinate` — decide during sub-planning
   - **Conflict resolution:** when a single story is touched by findings from more than one category, precedence is: `assumption-changed` > `ac-drift` > `partial-completion` > `dependency-satisfied`. Conflicts that can't be auto-merged emit a `conflict: true` record and the tool exits non-zero.
   - **A1.1 — `gap-found` handling (Amendment 2026-04-12):** `forge_reconcile` receives a note with `category: "gap-found"`. Required behavior:
     - **Write** the note to `.forge/audit/reconcile-notes.jsonl` with a `deferred: true` marker (append-only JSONL; one object per line).
     - **Surface** the note in `reconcile-output.json.deferredNotes: ReplanningNote[]` (full array of deferred notes for the current run).
     - **Count** deferred notes in the new brief field `PhaseTransitionBrief.deferredReplanningNotes: number` (see Q0/L3).
     - **Do NOT invoke `forge_plan(update)`** for deferred notes — gap-found is defined by `primitive-backlog.md:199` as "logged to audit, deferred to next planning session", and "next planning session" stays defined as "whatever the caller does next". No auto-read behavior is added to `forge_plan`. This preserves the Intelligent Clipboard pattern (caller reads brief, caller decides).
     - **Explicit negative AC:** `forge_plan` is NOT modified in Q0/L2. Any diff touching `server/tools/plan.ts` in the L2 PR is a scope violation.
   - **A1.2 — `severity: "blocking"` handling (Amendment 2026-04-12):** if ANY ReplanningNote in the current reconcile batch has `severity: "blocking"`, `forge_reconcile` MUST:
     - **Halt atomically BEFORE any plan mutation.** Either all non-blocking notes in the batch are processed and plans rewritten, OR (if any note has `severity: "blocking"`) zero notes are processed and all plan files remain byte-identical. Partial rewrites are disallowed. This is the P5 atomicity pattern — intermediate-state plan files are hard to reconcile on re-run.
     - **Emit** `reconcile-output.json.status: "halted"` with `haltedOnNoteId: <noteId>` pointing at the first blocking note encountered (deterministic order: by note index in the input).
     - **Exit non-zero** so CI and the ship gate can detect the halt.
     - **Ship-gate error contract:** the `/ship` plan-refresh gate treats a halted reconcile as the literal string `plan-refresh: error: halted-blocking-note:<noteId>` in the PR body. Human-in-the-loop action is required to resolve the blocking note before retry.
   - **A1.3 — `affectedPhases` handling (Amendment 2026-04-12):** when a note has `affectedPhases: string[]` set:
     - **Phase-tier routes:** narrow the rewrite scope. If `affectedPhases: ["PH-02", "PH-04"]`, only those phase plans are rewritten; non-listed phase plans (PH-01, PH-03, etc.) are byte-identical post-reconcile. Unit test asserts this.
     - **Master-tier routes:** `affectedPhases` is IGNORED. If the note's category routes to a master-plan update (`ac-drift` or `assumption-changed`), the master plan is rewritten as usual regardless of `affectedPhases`. Master plan updates are inherently global — narrowing them by phase would be a semantic contradiction. Unit test asserts the master-ignore branch.
   - **Empty-history case:** on first invocation against a repo with no prior `forge_plan-*.json` records, drift is reported as `drift: "baseline"` and the gate passes with `"plan-refresh: baseline"`. **One-time-only invariant:** once any `forge_plan-*.json` has ever been written to `.forge/runs/`, the gate MUST compute numeric drift and MUST NOT emit `baseline`. Enforced via a persistent marker file `.forge/.plan-refresh-initialized`; presence disables the baseline branch unconditionally. The gate reads the marker via `git show origin/master:.forge/.plan-refresh-initialized` (see layer 1) — never from the working tree.
   - **`.gitignore` exemption (F11 fix):** `.forge/` is gitignored in this repo (runs are ephemeral). The marker must persist across clones/CI runners, so the Q0 ship PR MUST also edit `.gitignore` to add a `!.forge/.plan-refresh-initialized` negation rule AND commit the marker file. Tracked as Q0/L2's explicit file-touch list.
   - **`reverseFindings[].id` stability (R2/C1-2 fix):** `reverseFindings[].id` MUST be stable across runs — derived from a deterministic hash of `{finding location, rule}` (not ordinal, not content-hash of the full payload). If ids drift under cosmetic plan edits, the `reconcile-remnants.json` id-only diff becomes meaningless and the two-step binary below is unreliable. Implementers must add this as a schema invariant on the `reverseFindings` emitter in `server/tools/evaluate.ts` with a unit test asserting id equality across two runs over lexically-equivalent inputs.
   - **Migration note (R2/C2 finding 2 fix — BACKWARD-INCOMPATIBLE):** the stability invariant is a schema change. v0.20.1 shipped `reverseFindings[].id` under an unverified prior scheme (ordinal or content-hash; UNVERIFIED — the current generation logic in `server/tools/evaluate.ts` was not read this pass). Any `.forge/runs/*.json` or `.ai-workspace/dogfood/*.json` artifact written before Q0 ships may contain ids that do not match what the new scheme would produce. **Migration policy — the "7 → 0" reconcile binary applies ONLY to fresh-run data generated AFTER Q0/L2 ships.** The 7 reverse findings currently in memory (from the v0.20.1 session-emulated run) MUST be regenerated by running `forge_evaluate(divergence)` fresh under the new id scheme before the Q0/L2 binary can be evaluated. Q0/L2's `reconcile-remnants.json` id-only diff is likewise only meaningful against the post-Q0 id scheme. Implementers must NOT attempt retroactive id rewriting of v0.20.1 artifacts; instead, the Q0 landing PR's CI emits a one-time `legacy-reverseFindings-ids-discarded` warning listing any pre-Q0 files found, and the reconcile binary re-runs divergence measurement from scratch. The "7 → 0" success metric is explicitly measured against the post-Q0 id scheme only. NEW_CLAIM: fresh-run-only migration policy (no retroactive id rewrite) — source: R2/C2 finding 2 fix.
   - **Drift overflow cap:** `driftSinceLastPlanUpdate` is capped at 50 in the brief payload with an `"overflow": true` marker; full list written to `.ai-workspace/drift/{timestamp}.json`.
   - **Binary (two-step, F1 fix):** (a) running `forge_reconcile` against the current forge-harness 7-reverse-finding state produces a `reconcile-output.json` recording N rewrite operations, AND (b) a **subsequent** `forge_evaluate(divergence)` run against the rewritten plans yields `reverseFindings.length === 0` OR every remaining entry has a matching record in `.ai-workspace/reconcile-remnants.json`. **Schema (N4 fix):** `reconcile-remnants.json` is a JSON array of objects with shape `{findingId: string, rationale: string}`; `findingId` MUST match a `reverseFindings[].id` from the `forge_evaluate(divergence)` output (relying on the stability invariant above); `rationale` is a non-empty human-readable string (no length limit). CI's diff comparison is **id-only** (rationale is for humans, not machine-checked). CI fails on any remnant `findingId` not listed in the file. The "7 → 0" claim applies only after step (b). Rewriting the plan is not proof of reduction; re-measurement is.

3. **Measurement layer — surface drift loudly in the brief**
   - Add `driftSinceLastPlanUpdate: { reverse: number; orphaned: number; dangling: number }` to `PhaseTransitionBrief`. Field definitions:
     - `reverse` — count of `reverseFindings` entries emitted by `forge_evaluate(divergence)` (source: `server/types/eval-report.ts` reverseFindings array length)
     - `orphaned` — count of records in `coordinator.reconcileState` whose parent story no longer exists in the master plan (formally: a `reconcileState` record whose `parentStoryId` is absent from `masterPlan.stories[*].id`)
     - `dangling` — count of phase plan dependencies whose target story is missing or already-completed (formally: a `phasePlan.deps[].targetStoryId` that either does not match any story in the master plan OR matches a story whose `status=completed`).
   - **Also add `deferredReplanningNotes: number` to `PhaseTransitionBrief` (Amendment 2026-04-12 — swift-henry, per A1.1 above).** Definition: count of `ReplanningNote` entries with `category: "gap-found"` written to `.forge/audit/reconcile-notes.jsonl` during the most recent `forge_reconcile` run. Additive optional field per **P50** (additive brief fields never break callers). Distinct from the three `driftSinceLastPlanUpdate` subfields because deferred notes are **not** reconcile targets — they are explicitly deferred to a future planning session, so they should NOT trigger the `INVOKE` recommendation (only the three drift subfields do). **R2/C2 minor 4 fix:** the earlier `updatedAt < phasePlan.createdAt` staleness clause was dropped — the choice of `createdAt` as a staleness anchor was arbitrary, `lastUpdated` would be equally arbitrary, and a dangling dep is dangling regardless of timestamps. Any completed-status dep is a reconcile signal.
   - These formal definitions are load-bearing and are stated here in-plan (R2/C1 minor 9 fix: no forward reference to doc comments). The `server/lib/coordinator.ts` doc comment must mirror them verbatim as part of Q0/L2 implementation.
   - **Non-triviality enforcement (F2 + N3 fix):** Q0/L3 tests MUST include at least one fixture where `reverse > 0`, at least one where `orphaned > 0`, and at least one where `dangling > 0` (three separate fixtures or one combined fixture that satisfies all three), asserting the brief's subfields reflect non-zero counts for every subfield independently. Trivially shipping `{reverse: N, orphaned: 0, dangling: 0}` in every case does NOT satisfy Q0/L3. Fixture is constructed by hand-crafting a `reconcileState` with a record whose parent story is removed from the master plan (orphaned) and a phase dep whose target is absent (dangling). Without this, the schema ships but the feature is inert.
   - These three fields are **separately** reported; the gate triggers the `INVOKE` recommendation when any of the three is non-zero.
   - When any count > 0, `recommendation` string must contain the literal word `INVOKE` and must match the regex `INVOKE.*forge_plan\s*\(.*update` (whitespace-tolerant per F10 fix — matches `forge_plan(update)`, `forge_plan( update )`, `forge_plan( documentTier: "update" )`). Literal-word enforcement cites **P6** and **P25** in `hive-mind-persist/01-proven-patterns.md`.
   - Binary: test case asserts `driftSinceLastPlanUpdate` structured field exists with three numeric subfields, and that any non-zero subfield produces a recommendation matching the regex above

**Exit criteria for Q0 (all binary):**
- [ ] **Q0/L1** `/ship` gate blocks any phase PR missing a plan-refresh line; accepts exactly three forms (`no-op`, `<N> items`, `baseline`); errors surface as `plan-refresh: error: <reason>` and block merge unless overridden; **marker presence is read via `git show origin/master:.forge/.plan-refresh-initialized`, never the working tree** *(shared with Q0.5/C3 — counted once)*
- [ ] **Q0/L2** New `forge_reconcile` tool (or mode) exists, is tested, and **(a)** produces `reconcile-output.json` with N rewrite operations against **freshly-regenerated** reverse findings from a post-Q0 `forge_evaluate(divergence)` run AND **(b)** a follow-up `forge_evaluate(divergence)` run yields `reverseFindings.length === 0` OR every remaining entry is enumerated in `.ai-workspace/reconcile-remnants.json` with `{findingId, rationale}`; CI diffs and fails on any remnant not listed. **"7 → 0" is measured against the post-Q0 id scheme only** — pre-Q0 artifacts are NOT retroactively rewritten; the Q0 landing PR CI emits a one-time `legacy-reverseFindings-ids-discarded` warning listing any pre-Q0 files detected. `reverseFindings[].id` stability invariant (deterministic hash of `{finding location, rule}`) is shipped with a unit test asserting cross-run equality. Pre-step (`docs/primitive-backlog.md` category verification) completed before code is written **[VERIFIED 2026-04-12 swift-henry — 4/4 category strings and 2/2 cited routing rules match; see Amendment 2026-04-12 banner above L2 section for the 3 added routing rules]**. Terms `orphaned records` and `dangling deps` have formal definitions stated in this plan AND mirrored in `server/lib/coordinator.ts` doc comments. Conflict-precedence and empty-history cases have unit tests, including the one-time-only invariant test for the `.forge/.plan-refresh-initialized` marker (read via `git show origin/master`). **File-touch list:** Q0 ship PR edits `.gitignore` to add `!.forge/.plan-refresh-initialized` AND commits the marker file; binary check `git check-ignore .forge/.plan-refresh-initialized` returns non-zero (file is tracked).
  - **Q0/L2 amended binary ACs (Amendment 2026-04-12 — A1.1/A1.2/A1.3):**
    - [ ] `gap-found` note is written to `.forge/audit/reconcile-notes.jsonl` with `deferred: true` (JSONL append; unit test asserts one line per note)
    - [ ] `gap-found` note is surfaced in `reconcile-output.json.deferredNotes[]` (full ReplanningNote array; unit test asserts identity with input)
    - [ ] `gap-found` note count is surfaced as `PhaseTransitionBrief.deferredReplanningNotes: number` (additive optional field per P50; Q0/L3 tests cover the field)
    - [ ] **Explicit negative AC:** `forge_plan` is NOT modified in Q0/L2. `git diff master..HEAD -- server/tools/plan.ts` returns empty in the L2 PR (prevents scope creep into primitive contract)
    - [ ] `severity: "blocking"` note halts reconcile with non-zero exit AND zero plan mutation (atomic, P5 pattern). Unit test: submit a batch of 3 notes where note #2 has `severity: "blocking"`; assert none of the 3 triggered a plan rewrite AND `reconcile-output.json.status === "halted"` AND `reconcile-output.json.haltedOnNoteId === <note#2.id>`
    - [ ] Ship gate error string for halted reconcile matches the literal: `plan-refresh: error: halted-blocking-note:<noteId>` (Q0/L1 gate reads this form)
    - [ ] `affectedPhases: ["PH-02", "PH-04"]` with a phase-tier category narrows the rewrite to those two phases. Unit test: assert PH-01 and PH-03 phase plans are byte-identical (sha256 match) post-reconcile; assert PH-02 and PH-04 phase plans differ
    - [ ] `affectedPhases` is IGNORED on master-tier routes. Unit test: submit a note with `category: "ac-drift"` (master route) and `affectedPhases: ["PH-02"]`; assert master plan is rewritten AND PH-02 phase plan is byte-identical post-reconcile (proving the phase narrowing does not apply to master routes)
- [ ] **Q0/L3** `PhaseTransitionBrief.driftSinceLastPlanUpdate` structured field (`{reverse, orphaned, dangling}`) shipped; any non-zero subfield produces a recommendation matching regex `INVOKE.*forge_plan\s*\(.*update`; drift cap of 50 with overflow spill file tested; **non-triviality fixture test:** unit-test fixtures independently construct `reverse > 0`, `orphaned > 0`, and `dangling > 0` (per-subfield non-zero proof), asserting the brief reflects the non-zero counts for each subfield
- [ ] **Q0/L4** **Deferred dogfood proof with hard deadline (F5 + R2/C1-6 fix):** the first post-Q0 PR that satisfies the trigger below must have a non-`baseline` plan-refresh line AND non-empty `driftSinceLastPlanUpdate`. **Trigger (broadened to keep the deadline reachable in a roadmap-complete repo):** the criterion activates on whichever of the following fires first: (i) **14 calendar days** after Q0 merge, or (ii) the first **ANY-TYPE** PR touching a phase plan file (`.ai-workspace/plans/forge-coordinate-phase-*.json` OR `.ai-workspace/plans/*.json` that declares `"kind": "phase"`) — not restricted to the legacy "phase PR" concept, because the forge_coordinate roadmap is COMPLETE and a phase-scoped PR may never land. **Owner:** whoever merges the qualifying PR is accountable for ticking this checkbox as part of that PR's description. If no qualifying PR lands within 14 days, the 14-day branch of the trigger fires and a tracking issue is auto-opened via `.github/workflows/q0-l4-deadline.yml` (watchdog workflow scheduled via cron; scope: open a GitHub issue tagged `q0-l4-unproven`). **Q0 PR deliverables for L4:** `.github/workflows/q0-l4-deadline.yml` AND `.github/workflows/q0-l4-anchor-fill.yml` both ship in the Q0 landing PR; neither is assumed pre-existing (forge-harness currently ships only `ci.yml`, VERIFIED via `ls .github/workflows/`). Until L4 is ticked, Q0 is flagged as "shipped but unproven" in the checkpoint.
  - **Day-0 anchor (N1 + R2/C1-1 fix — F60 bootstrap self-block class, no-direct-push compliant):** the watchdog needs a day-0 reference and the repo forbids direct pushes to master, so the anchor is created as part of the **Q0 PR's own commits** — not amended on master after merge.
    - **Step A — inside the Q0 PR:** the Q0 PR adds `.ai-workspace/q0-l4-anchor.json` with schema `{"q0MergedAt": "PENDING", "q0MergeSha": "PENDING"}`. Both fields are literal strings `"PENDING"` at PR-time because the merge SHA and timestamp are not yet known.
    - **Step B — post-merge fill-in (R2/C2 finding 1 fix):** a post-merge GitHub Actions workflow (`.github/workflows/q0-l4-anchor-fill.yml`) runs on `push` to master whenever `.ai-workspace/q0-l4-anchor.json` is present with `"q0MergedAt": "PENDING"`. The workflow computes the real timestamp and merge SHA, then opens a follow-up PR replacing both PENDING fields with real values. **No direct push to master from the workflow.** **VERIFIED: there is NO existing PR-merge automation in forge-harness** — `.github/workflows/` on master contains only `ci.yml` (confirmed via `ls .github/workflows/` returning `ci.yml` only; no `auto-merge.yml`, no mergify config, no Kodiak). The earlier wording "existing PR-merge automation" was a hand-wave and is corrected here. **Q0 deliverable — the workflow file `.github/workflows/q0-l4-anchor-fill.yml` ships as part of the Q0 landing PR and MUST include a follow-up-PR merge path** using `gh pr merge --auto --squash` against a required status check. If branch protection disallows `--auto`, the fallback is: the follow-up PR is tagged `q0-l4-anchor-fill`, and the `/ship` skill treats any open `q0-l4-anchor-fill`-tagged PR as a mandatory unblock before any other merge to master. Either path is acceptable; the workflow file in the Q0 PR MUST implement one of them explicitly — leaving merge "to existing automation" is disallowed. The watchdog's `skipped-anchor-incomplete` state (Step C case 2) makes an unmerged fill-in PR visible within one cron cycle regardless. NEW_CLAIM: `.github/workflows/q0-l4-anchor-fill.yml` is a Q0-PR deliverable (not pre-existing) — source: R2/C2 finding 1 fix.
    - **Step C — watchdog behavior:** on every cron firing, the watchdog workflow reads `.ai-workspace/q0-l4-anchor.json` from `origin/master` via `git show`. Three cases:
      1. File absent → `"status": "skipped-no-anchor"` in run summary, exit 0.
      2. File present with `q0MergedAt === "PENDING"` → `"status": "skipped-anchor-incomplete"`, exit 0, **AND auto-open a tracking issue immediately** tagged `q0-l4-anchor-incomplete` so the fill-in failure is visible. The issue is opened at most once per unique SHA of the anchor file content (idempotent via the file-content hash in the issue title) to avoid duplicate noise on repeated cron firings.
      3. File present with real ISO8601 `q0MergedAt` → compute `(now - q0MergedAt) >= 14 days`, open `q0-l4-unproven` issue if overdue, else exit 0.
    - This closes the chicken-and-egg problem flagged in R2/C1-1: the anchor file ships in the Q0 PR's own commits (rule-compliant), the fill-in is handled by the merge automation (rule-compliant), and the watchdog treats every incomplete or missing state as a visible error, not a silent skip. NEW_CLAIM: `.ai-workspace/q0-l4-anchor.json` schema `{q0MergedAt, q0MergeSha}` with `"PENDING"` sentinel values — source: R2/C1-1 fix. NEW_CLAIM: `skipped-no-anchor` / `skipped-anchor-incomplete` status strings — source: R2/C1-1 fix. NEW_CLAIM: `.github/workflows/q0-l4-anchor-fill.yml` post-merge fill-in workflow — source: R2/C1-1 fix.
- [ ] **Q0/L5** New proven-pattern entry at `hive-mind-persist/01-proven-patterns.md` describing the detect→update→commit cycle. **Binary check:** `grep -E "P[0-9]+.*detect.*update.*commit" hive-mind-persist/01-proven-patterns.md` returns ≥1 hit, AND the entry body contains at least one file path AND one commit SHA or PR number from this work.
- [ ] **Q0/L6** New anti-pattern entry at `hive-mind-persist/02-anti-patterns.md`: "Primitive boundary accountability gap". **Binary check:** `grep -Ei "accountability gap" hive-mind-persist/02-anti-patterns.md` returns ≥1 hit, AND the entry EVIDENCE section cites `server/tools/plan.ts:870` AND the 7-reverse-findings count. (R2/C1 minor 12 fix: regex no longer assumes `F[0-9]+` id prefix; case-insensitive substring match plus an explicit evidence-content check. The hive-mind-persist id scheme is not guaranteed to be `F<n>`.)

**Why this is Q0 not Q2 or later:** Q1 (ruler fix), Q2 (calibration), and Q3 (issues) all assume a world where plan-reality drift is being actively reduced. If drift keeps compounding, Q1's clean ruler just measures increasing noise, Q2's calibration signal includes stale-plan error, and Q3's decisions are made against a stale PRD. Fix the loop first, then the tools inside the loop.

---

### Q0.5 — AC trust-model fix: **built into forge-harness as permanent architecture, not a one-time patch**

**Priority: second-highest** (between Q0 and Q1). Runs in parallel with Q0 because it shares the same underlying pattern applied to a different artifact type (ACs instead of plans).

**Hard constraint from the user:** *"I want the fix to be built into the forge harness, not a one time fix."* Every sub-item below is a permanent module, permanent schema change, permanent prompt edit, or permanent CI hook. **No sub-item is a script that runs once against PH-01.** PH-01's suspect ACs will be fixed as a *downstream consequence* of A1 + C1 (ac-lint + retroactive critic), not as a one-off manual rewrite.

**New cross-cutting guidance codified in hive-mind-persist this session:**
- **P62** — Trust Boundaries in Generative Pipelines (this case is the evidence)
- **P63** — Retroactive Re-Critique on Rule Update (the highest-leverage fix)
- **F59** — "Reserved for Future Use" escape hatches become dead code
- Full case study: `C:/Users/ziyil/coding_projects/ai-brain/hive-mind-persist/case-studies/2026-04-12-forge-harness-ac-trust-boundary.md`

**Three-layer architecture:**
- **Layer A — Generation-time verification** (prevents new bad ACs from reaching disk)
- **Layer B — Authoring-time smoke verification** (catches what lint misses)
- **Layer C — Enforcement & retroactive sweeping** (the leverage layer)

**The problem:** The forge pipeline treats AC commands as **trusted ground truth**. The critic reviews the plan's semantic shape (story scope, dependencies, coverage), and the evaluator executes whatever the plan says. Nothing treats the AC command itself as a *fallible generated artifact that needs its own verification*. Result: PH-01 shipped with multiple grep-on-vitest-output ACs that were known-bad patterns, and no safeguard in the entire pipeline caught them.

**Timeline proof (F9 fix — weakened to verifiable claim):**
- PR #118 committed `forge-coordinate-phase-PH-01.json` with the bad ACs (`grep -qE 'Tests[[:space:]]+[5-9]...'`)
- PR #134 is the first commit to place the subprocess-safety rules in `server/lib/prompts/planner.ts` lines 272-283 **in their current form** (F-55/F-56). This is the weaker, verifiable claim: it asserts only that PR #134 is where the rule currently lives, not that no commit anywhere before it contained any version of the rule. The stronger temporal claim (rule did not exist in any earlier commit) is NOT made in this plan.
- 2026-04-12 (today) — divergence measurement finally executes PH-01 ACs in MCP subprocess context and surfaces the failure

PH-01's bad ACs were committed in PR #118 prior to PR #134's rule placement. The rule was added as a general fix, not specifically because of PH-01; the temporal ordering is the load-bearing fact, not any implied causal-negligence narrative.

The planner rule at `server/lib/prompts/planner.ts:278` now contains the **exact** anti-pattern PH01-US-06 uses:
```
BAD: `npx vitest run -t 'budget' 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'`
```
PH01-US-06-AC01 is a search-and-replace of that BAD example (the real AC also tolerates double-digit counts via `|Tests[[:space:]]+[0-9]{2,}`, but the F55 classification stands). The rule didn't exist in its current location when the plan was generated, and nothing re-runs the critic on old plans when rules update.

**Full gap chain (7 independent safeguards + 1 meta-gap, R2/C1 minor 14 fix):**

1. **Planner had no subprocess rule at generation time in its current location** — placed later in PR #134
2. **Critic still has no subprocess rule** — `server/lib/prompts/critic.ts` 8 check categories do NOT include TTY/subprocess safety
3. **(Meta-gap, not an independent safeguard) No retroactive re-critique** — when PR #134 added new rules, existing phase plans were not re-run through the critic with the new ruleset. This is the **fix vector** (same orphan pattern as Q0) rather than a standalone safeguard that failed. Listed for completeness but not counted among the 7 independent safeguards.
4. **No AC static lint** — nothing between `forge_plan` output and disk statically matches ACs against a deny-list
5. **No AC smoke test** — `2026-04-10-ac-authoring-guidelines.md` R4 proposed "test your AC in subprocess context" but was never mechanized
6. **Evaluator has no reliability signal** — `CriterionResult.status` is `PASS | FAIL | SKIPPED | INCONCLUSIVE` (four values, per `server/types/eval-report.ts:10`); none express "the AC command itself looks suspect"
7. **Coherence mode trusts AC commands blindly** — `.ai-workspace/plans/forge-coordinate-coherence-report.md:212-235` [UNVERIFIED] cites the broken PH01-US-06-AC06 as `satisfied` **without ever executing it**
8. **`flaky` field exists but is dead code** — `server/types/execution-plan.ts:25` says *"Not populated by the planner in Phase 1. Exists for future manual annotation"*. The escape hatch was built and shelved

Count: 7 independent safeguards (1,2,4,5,6,7,8) + 1 meta-gap (3, which is the Q0-style orphan pattern being fixed by C1).

Full analysis: `.ai-workspace/audits/2026-04-12-divergence-false-negatives-diagnosis.md` §Finding 4.

**Root cause (the deepest one):** P6 (Mechanical Detection Over Judgment) was applied so aggressively to the evaluator that it became fragile in the opposite direction — *too* mechanical, zero meta-judgment. The evaluator faithfully executes whatever the plan says and reports the exit code. It has no concept of "the AC command itself might be the broken thing". Combined with the fact that the plan is a generated artifact, this creates a trust chain with no verification link.

**Fix in three architectural layers (A/B/C). All sub-items are permanent.**

---

#### Layer A — Generation-time verification (prevents new bad ACs from reaching disk)

**A1. `server/validation/ac-lint.ts` — new permanent module (~80 LOC)**
- Deny-list mirrors `server/lib/prompts/planner.ts:277-283`. Patterns caught:
  - `grep .* Tests[[:space:]]*[0-9]` (count-based vitest summary grep, F-55)
  - `| grep .* && .* grep ` (multi-grep pipe without stdin capture, F-56)
  - Unbounded `grep -q 'passed'` / `grep -q 'failed'` on runner output
  - `grep -rn?` on source trees (mirrors critic.ts rule #3 / F36)
  - Raw `rg` invocations (portability)
- **Single source of truth:** the deny-list lives in `server/lib/prompts/shared/ac-subprocess-rules.ts` and is imported by `ac-lint.ts`, `planner.ts`, and `critic.ts`. This architecturally prevents the rule-parity gap from ever recurring.
- **False-positive override:** any AC can carry a `lintExempt: { ruleId: string; rationale: string }` field. ac-lint honors the exemption in `--strict` mode but emits a `warning` line into the plan-refresh log and forwards the exemption to A3's `reliability` field as `unverified` (not `trusted`). **Per-AC line-level** — distinct from C1's `rule-exemptions.json` (per-plan-file sweep-level).
- **`lintExempt` vs pattern-match precedence (R2/C1 minor 11 fix):** if an AC is both `lintExempt` for a rule AND matches that rule's deny-list pattern, the exemption wins: reliability is set to `unverified` (not `suspect`), the AC is NOT short-circuited by A1b (it executes normally), and it is NOT short-circuited by B1 smoke-test (it runs smoke-test as any non-flagged AC would). This resolves the earlier A1b/A3 contradiction where one path routed to `suspect` and the other to `unverified`.
- **Exemption governance (F12 fix):** plans with more than **3** `lintExempt` entries require a `lint-exempt-governance-override: <reason>` line in the PR body, OR the A1c CI step (advisory mode) flags the PR summary with a warning AND C1's binding gate blocks merge. Scorecard: ac-lint emits `lintExemptCount` in its report; both A1c and C1 read this and enforce the cap (C1 is the binding enforcer). NEW_CLAIM: governance cap = 3 — own analysis, prevents unbounded silencing of the lint signal.
- Wired into three permanent consumers:
  - **A1a** — `forge_plan` calls ac-lint before writing any generated plan to its output. Suspect ACs → validation error in `--strict` mode, warning otherwise.
  - **A1b** — `forge_evaluate` calls ac-lint before executing any AC. Suspect ACs (pattern-matched AND not `lintExempt` for the matched rule) short-circuit directly to `reliability=suspect` and are NOT executed by the flaky-retry path in C2. `lintExempt` ACs execute normally with `reliability=unverified`. C2's retry semantics apply only to ACs that pass ac-lint clean but fail at runtime.
  - **A1b smoke-test interaction (F6 fix):** lint-flagged ACs (non-exempt) also short-circuit B1 smoke-test. They receive a smokeReport entry of the form `{acId, verdict: "skipped-suspect", reason: <lintRuleId>}` **without execution** (no 30s timeout cost, no hung-process risk). B1's "plans without an attached smoke report cannot pass Layer C's CI gate" requirement is satisfied by this placeholder entry; see B1 verdict schema where `skipped-suspect` is the fifth verdict value.
  - **A1c** — New CI step runs ac-lint against every `.ai-workspace/plans/*.json` on every PR. **Scope (F7 fix):** A1c is **advisory-only** — it reports violations in the PR check summary but DOES NOT block merge on them. The authoritative merge gate for plan-file lint violations is C1's retroactive-critique workflow (which uses `rule-exemptions.json` as its unified exemption mechanism). A1c surfaces findings early so PR authors see them on every commit; C1 is the binding gate. This eliminates the contradictory-gate issue where A1c and C1 could disagree about whether a violation is exempted. The per-AC `lintExempt` field still applies at generation time (A1a, A1b); this scope change only affects A1c's CI role.
  - **Gate ordering (N5 fix — stated once, authoritative):** A1c and C1 evaluate in a fixed order per PR: **lint (A1c, advisory) runs first, then critic (C1, binding)**. A1c surfaces violations in the check summary; C1 is the merge-blocker. A1c's `ac-lint-baseline.json` is generated by C1's bootstrap run, so A1c cannot produce a meaningful baseline-diff summary until C1 has landed (or is landing in the same PR). Implementers must land A1 + C1 together, OR land C1 first. Landing A1c alone (without C1) is explicitly disallowed. **Mechanical enforcement (R2/C2 minor 3 fix):** the A1c workflow file (`.github/workflows/ac-lint.yml` or equivalent) includes a preflight step that fails if BOTH (a) `.github/workflows/retroactive-critique.yml` is absent on `origin/master` AND (b) the current PR's diff does not add `.github/workflows/retroactive-critique.yml`. The preflight is a one-liner: `test -f .github/workflows/retroactive-critique.yml || git diff --name-only origin/master...HEAD | grep -qx '.github/workflows/retroactive-critique.yml'`. This mechanically enforces the ordering constraint so a future implementer cannot violate it by skipping the prose.
  - **A1c grandfathering:** the initial PR that lands A1c also lands `.ai-workspace/plans/ac-lint-baseline.json` via C1's bootstrap mode (see F3 fix in C1). A1c's advisory output diffs against the baseline so only newly-introduced violations appear as "new" in the summary. **Owned cleanup:** C1c below replaces human ownership with a CI mechanism — when C1's workflow detects a clean sweep with zero baseline violations remaining, it automatically opens a PR deleting `ac-lint-baseline.json`. **Note on K=10 activation:** C1c auto-deletion is one of two triggers that activates A3's K=10 cap; the other is a 14-day calendar deadline post-A3 (see A3 bootstrap carve-out). This is the R2/C1-4 fix ensuring the cap cannot be permanently inactive.

**A2. Critic rule parity (single source of truth for subprocess-safety rules)**
- Extract the AC subprocess-safety rules (Wrong/Right pairs, F-55/F-56 explanation) from `planner.ts:272-283` into `server/lib/prompts/shared/ac-subprocess-rules.ts` as an exported string constant.
- `planner.ts` imports and embeds it in the generation prompt.
- `critic.ts` imports and embeds it as new check category #9: *"Subprocess Safety: Do any AC commands rely on TTY behavior, multi-grep pipes, count-based test-runner summary regex, or unbounded grep on source trees? Flag any instance as CRITICAL."*
- **Regression test (F14 + A2b R2/C1-7 fix — VERIFIED count):** running critic against PH-01 returns **exactly 5** findings on `PH01-US-06-AC01/AC02/AC03/AC05/AC06` for F55/F56 subprocess-safety violations, **separately reported** from the **exactly 1** F36 finding on AC04 (source-tree grep). Total: 5 subprocess + 1 source-tree = 6 distinct findings, reported as two counts `{subprocessSafety: 5, sourceTreeGrep: 1}`. The `=== 5` assertion is **grep-verified against the current PH-01 snapshot** (evidence in Appendix A). The test fixture is tied to this frozen snapshot — if `forge-coordinate-phase-PH-01.json` is edited in a future PR that changes the AC count, the implementer must update the test fixture in the same PR. The `=== 5` rather than `>= 5` assertion is deliberate: future-proofing via `≥` would mask accidental AC drift in the snapshot.

**A3. `CriterionResult.reliability` field — permanent schema change**
- Add `reliability: "trusted" | "suspect" | "unverified"` to `server/types/eval-report.ts` (currently only `id`, `status`, `evidence` per `server/types/eval-report.ts:8-12`).
- Populated by ac-lint output at the evaluator boundary: matched deny-list patterns AND NOT `lintExempt` for the matched rule → `suspect`; clean → `trusted`; no lint data available OR `lintExempt` set for the matched rule → `unverified`.
- Divergence mode splits failures into `forwardDivergences` (only `reliability=trusted` failures) and `suspectFailures` (for `suspect` ones).
- **Consumer contract for `suspectFailures`:**
  1. `suspectFailures` DO NOT count toward forward divergence totals.
  2. `suspectFailures` DO NOT block `/ship` **unless** `suspectFailures.length > 10` (post-activation), in which case `/ship` blocks unconditionally with no override. **Bootstrap carve-out (F4 + R2/C1-4 fix — CRITICAL):** the hard cap is **not enforced** until the K=10 activation condition fires. **Dual activation triggers (R2/C1-4 fix — prevents the cap from being permanently inactive if C1c never fires):** K=10 activates on whichever of the following comes first:
     - **(i) C1c-driven:** Q0.5/C1's first clean retroactive sweep completes and the C1c-opened PR deleting `ac-lint-baseline.json` is merged. This is the "clean baseline" activation path.
     - **(ii) Calendar-deadline:** **14 calendar days after A3 ships**, regardless of whether C1c has cleaned all baselines. **Clock anchor (R2/C2 minor 5 fix, inlined from Appendix C):** the 14-day clock starts from the first commit on `origin/master` that contains the `reliability` field in `server/types/eval-report.ts`, detected via `git log --follow --diff-filter=A -S 'reliability' -- server/types/eval-report.ts | head -1`. That commit's author-date is the day-0 reference. This makes the clock-start mechanically greppable rather than vaguely anchored on "ship". If baselines remain grandfathered (e.g., a permanent `rule-exemptions.json` entry prevents C1c from ever firing), the cap activates on day 14 with an **exemption list carried forward**: any ACs currently appearing as `suspectFailures` in the exempted-baseline set are grandfathered one-time into an `a3-carry-forward.json` file and do NOT count against the cap; all subsequently-introduced `suspectFailures` count normally. This closes the "unbounded drift" gap: the cap always activates, the only variable is whether it activates cleanly (via i) or with carry-forward (via ii).
     During the bootstrap window (before either trigger fires), suspectFailures are logged and reported but the `/ship` cap is inactive. This prevents PH-01's 6 suspect findings from self-blocking the Q0.5 landing PR. K=10 is the enforced ceiling post-activation (raised from 5 to give headroom for 1-2 stories-worth of suspect findings without allowing silent unbounded drift).
  3. `suspectFailures` trigger a mandatory hive-mind-persist review comment on the PR listing each suspect AC with its matched rule ID.
  4. `suspectFailures` feed into Q0's `driftSinceLastPlanUpdate.reverse` subfield (as surrogate reverse findings for the next reconcile cycle) so the next `forge_plan(update)` rewrites them.
- Without (2), the drift counter can grow unbounded while every individual PR looks green. NEW_CLAIM: K=10 post-bootstrap cap + dual-trigger bootstrap carve-out (C1c OR 14-day-calendar with carry-forward) — own analysis + R2/C1-4 fix. NEW_CLAIM: `a3-carry-forward.json` file for calendar-trigger grandfathering — source: R2/C1-4 fix.
- Not optional, not deferred — shipped and consumed in the same PR per F59 rule.

---

#### Layer B — Authoring-time smoke verification (catches ACs that slip past lint)

**B1. `forge_evaluate` smoke-test mode — new permanent mode**
- `forge_evaluate(mode: "smoke-test", planPath)` runs each AC *once* in a headless subprocess at authoring time. Does not evaluate pass/fail — just characterizes the AC:
  - Exit code (did it terminate?)
  - Elapsed ms
  - Evidence length (empty stdout on non-zero exit = fragile)
  - Hung? (hit soft timeout)
- **Per-AC timeout policy:** default soft timeout **30 seconds** per AC (sized for typical TS compile + medium test suite on Windows). AC can override via `smokeTimeoutMs: number` field in the plan JSON (capped at 180s).
- **Verdict schema (F6 fix — added `skipped-suspect`):** `{verdict: "ok" | "slow" | "empty-evidence" | "hung" | "skipped-suspect", timeoutRisk: boolean, reason?: string}`. Values: `ok` = terminated cleanly under 80% of timeout; `slow` = terminated but used >80% of timeout; `empty-evidence` = non-zero exit with empty stdout; `hung` = hit timeout; `skipped-suspect` = not executed because ac-lint flagged the AC (non-exempt; the `reason` field carries the lint rule id). `timeoutRisk: true` is a **boolean modifier** set when `verdict === "slow"` AND the AC lacks an explicit `smokeTimeoutMs`. `skipped-suspect` entries never set `timeoutRisk`.
- Windows cold-start allowance: the harness subtracts a one-time 800ms warmup from the first AC's elapsed measurement.
- Output: `smokeReport: [{ acId, exited, elapsedMs, evidenceBytes, verdict, timeoutRisk, reason? }]`. **Every AC in the plan MUST have a corresponding entry** (lint-flagged ACs get `skipped-suspect` placeholders; see A1b smoke-test interaction).
- Plans without a complete smoke report (one entry per AC) cannot pass Layer C's CI gate.
- **Bootstrap exemption (N7 fix, R2/C1-5 hardening — F60 class, mirrors C3):** the commit that *adds* `forge_evaluate` smoke-test mode self-blocks its own landing PR because no plan has a smoke report yet. Mechanized identically to C1's self-exemption. **Structural-signal detection (R2/C1-5 fix — replaces fragile regex):** B1's CI gate runs in report-only (`smoke-gate: bootstrap-exempt`) mode when BOTH of the following are true, detected via `git log` / AST-level signals rather than substring match on diff text:
  - (a) The function `handleSmokeTest` (exact identifier) is **absent from `server/tools/evaluate.ts` on `origin/master`** but **present in the PR's HEAD** revision. Detection mechanism: `git show origin/master:server/tools/evaluate.ts | grep -c '^export function handleSmokeTest\b' == 0` AND `git show HEAD:server/tools/evaluate.ts | grep -c '^export function handleSmokeTest\b' >= 1`. This is an anchored identifier check, not a free-text substring, so comments or test-fixture strings containing `mode` and `smoke-test` cannot spuriously trigger it.
  - (b) Zero files matching `.ai-workspace/plans/*.smoke.json` present on `origin/master`.
  On the NEXT commit — once `handleSmokeTest` exists on master and at least one smoke report exists — the gate activates in binding mode. **Binary test:** the Q0.5 B1 landing PR's CI check emits `smoke-gate: bootstrap-exempt` and does not block merge; a synthetic follow-up PR that touches any plan file without a smoke report blocks merge with `smoke-gate: missing-report`. NEW_CLAIM: `handleSmokeTest` function-name identifier convention for the bootstrap trigger — source: R2/C1-5 fix (structural signal instead of regex). NEW_CLAIM: `smoke-gate: bootstrap-exempt` / `smoke-gate: missing-report` status strings — source: mirror of C3 self-exemption pattern applied to B1 per N7. NEW_CLAIM: `.ai-workspace/plans/*.smoke.json` file-naming convention — source: own analysis for smoke report sidecar location.
- Binary: smoke-testing PH-01 flags AC06 as `hung` OR `{verdict: "slow", timeoutRisk: true}` OR `skipped-suspect` (if AC06 is ac-lint-flagged).

---

#### Layer C — Enforcement & retroactive sweeping (the leverage layer)

**C1. Retroactive critic re-run hook — highest-leverage item (P63)**
- New permanent CI workflow `.github/workflows/retroactive-critique.yml`.
- Triggers on any change to `server/lib/prompts/critic.ts`, `server/lib/prompts/planner.ts`, `server/lib/prompts/shared/ac-subprocess-rules.ts`, or `server/validation/ac-lint.ts`.
- **Bootstrap exemption (F3 fix — CRITICAL):** the **landing PR that first introduces these files** is exempted from the workflow's blocking mode. Mechanized as follows: the workflow file includes a guard that checks the PR's diff — if both `server/validation/ac-lint.ts` AND `.ai-workspace/plans/ac-lint-baseline.json` are being **added** (not modified) in the same PR, the workflow runs in **report-only mode** (non-blocking) and its output is written to `ac-lint-baseline.json` itself (the landing PR commits the generated baseline). Subsequent PRs (which modify these files instead of adding them) use the blocking mode. Without this exemption the landing PR cannot merge itself. **Binary test:** the landing PR's CI run produces `ac-lint-baseline.json` as a committed file and does NOT block merge.
- **Multi-PR split tolerance (N2 fix):** the `A+A` (both-added) signature assumes a single landing PR. If the implementer splits ac-lint.ts and ac-lint-baseline.json across separate PRs, the strict `A+A` check fails both. Broaden the exemption condition to: **(either `ac-lint.ts` is being added AND `ac-lint-baseline.json` does not yet exist on master) OR (both files are being added in the same PR)**. This preserves the original single-PR path and also accepts a staged landing where the module lands first (with report-only exemption because baseline doesn't exist yet) and the baseline is generated and committed in a follow-up PR. Once `ac-lint-baseline.json` exists on master, the exemption deactivates. NEW_CLAIM: broadened exemption condition (either-arm) — source: N2 researcher finding.
- Spawns the critic with the new ruleset against every `.ai-workspace/plans/*.json` in the repo.
- Produces `rule-update-drift-report.json` as a PR artifact, diffing pre-existing CRITICAL findings against new ones.
- **Blocks merging the rule update until the newly-surfaced violations are fixed OR explicitly grandfathered in a `.ai-workspace/plans/rule-exemptions.json` file with rationale.** This `rule-exemptions.json` is the **per-plan-file sweep-level** mechanism and is the **authoritative merge gate for plan-file lint violations** (per A1c scope clarification). A1c is advisory-only; C1 is binding. A1's per-AC `lintExempt` is a distinct generation-time mechanism.
- **`rule-exemptions.json` schema (R2/C1 minor 10 fix):** JSON array of objects with shape `{planFile: string, acId: string, ruleId: string, rationale: string}`. All four fields required, `rationale` must be non-empty. CI match granularity is the `(planFile, acId, ruleId)` tuple; CI's diff comparison against the drift report is **tuple-keyed** (rationale is human-readable only, not machine-checked). A single plan file may have multiple entries (one per AC/rule pair). Entries covering ACs that no longer exist in the plan MUST be pruned by the author (CI emits a `stale-exemption` warning but does not block merge — this is a cleanup signal, not a gate).
- **Partial-failure policy:** if the critic LLM call errors mid-sweep, the workflow retries up to 2 times with exponential backoff, then emits a partial report with an `incomplete: true` flag. An incomplete report **blocks merge by default**; operator override requires a `retroactive-critique-override: <reason>` line in the PR body. Distinct from Q0's `plan-refresh-override`.
- **Churn suppression:** consecutive edits to the same prompt file within a single PR re-use the most recent drift report if the prompt-file hash is unchanged.
- **Cost note (R2/C1 minor 15 fix):** C2 does NOT retry ac-lint-flagged suspect ACs (A1b short-circuits them). The earlier "F55-pattern ACs will fail the C2 retry twice" sentence was a stale holdover from pre-scope-narrowing and has been deleted.
- This is the single change that converts every future lesson into an automatic historical sweep. P63 in proven-patterns is the canonical reference.

**C1c. Automated baseline cleanup (F13 fix):** the C1 workflow, upon detecting a clean sweep with baseline violations === 0, **automatically opens a PR** that deletes `.ai-workspace/plans/ac-lint-baseline.json`. The "owner" is the workflow, not a person. Binary: after the first clean sweep, a PR exists (opened by the workflow bot) whose diff is exactly the baseline file deletion; merging that PR satisfies `test ! -f .ai-workspace/plans/ac-lint-baseline.json`. Merging this PR is **one of two** triggers that activates A3's K=10 cap (see A3 bootstrap carve-out for the 14-day-calendar fallback trigger).

**C2. Reactivate `flaky` field — close F59 on itself**
- Delete the "reserved for future use" comment at `server/types/execution-plan.ts:25`.
- ac-lint auto-populates `flaky: true` on any AC matching a suspect pattern, at plan-generation time.
- **Scope clarification:** C2's retry semantics apply ONLY to ACs that pass ac-lint clean but fail at runtime. ac-lint-flagged suspect ACs short-circuit to `reliability=suspect` via A1b and are NOT executed under the retry path.
- Evaluator reads the field for runtime-flaky ACs: they run twice with a short gap; only reports FAIL if both runs fail. Single-run failure downgrades to `suspect`.
- Binary: running ac-lint on PH-01 writes `flaky: true` on the suspect ACs; unit test asserts that lint-flagged ACs skip the retry loop, and a separate unit test asserts retry semantics on a synthetic runtime-flaky AC that passes lint.

**C3. `/ship` plan-refresh gate — SHARED WITH Q0/L1 (counted once)**
- Same work as Q0/L1. Tracked as a single checkpoint item under Q0/L1 only. Do not implement twice.

---

**Explicitly cut from the fix (per hive-mind-persist patterns):**

- **No `docs/ac-authoring-guide.md`.** Primary argument: prompt-embedded rules (A2) are mechanically enforced at generation time, while author-side docs require author discipline. The rules belong in the prompt, which they already are and now also in `critic.ts` via A2. The earlier plan (`.ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md`) was based on author-side thinking and is superseded by A2. Mark that plan as SUPERSEDED. (Secondary citation: **P60** — [UNVERIFIED, directional support only].)
- **No one-off script to fix PH01-US-06.** The suspect ACs will be auto-fixed as a downstream consequence: A1c surfaces them in CI (advisory), C1 includes them in the drift report (binding gate), and they get rewritten via the normal plan-refresh loop.
- **No new top-level primitive.** All items fit inside existing `forge_plan` and `forge_evaluate`. **Note: P58 is marked `[PROPOSED]` in `01-proven-patterns.md:457`**, so this citation is directional.

---

**Binary exit criteria for Q0.5 (all permanent, all architectural):**

- [ ] **A1** — `server/validation/ac-lint.ts` ships with ≥8 Wrong and ≥4 Right unit tests; `lintExempt` override path tested; `lintExemptCount` scorecard emitted; governance cap (>3 exemptions requires `lint-exempt-governance-override` PR-body line; enforced by C1 binding gate) tested; `lintExempt` wins over pattern-match precedence tested (exempt AC with matching pattern → reliability=`unverified`, not `suspect`)
- [ ] **A1a** — `forge_plan` invokes ac-lint before writing; bad plans fail in `--strict`, warn otherwise
- [ ] **A1b** — `forge_evaluate` invokes ac-lint before execute; output includes reliability per AC; lint-flagged (non-exempt) ACs do NOT enter C2's retry path (tested); lint-flagged (non-exempt) ACs produce `skipped-suspect` smokeReport entries without execution (tested); `lintExempt` ACs execute normally regardless of pattern match (tested)
- [ ] **A1c** — CI workflow runs ac-lint on every `.ai-workspace/plans/*.json` in every PR in **advisory-only** mode (reports violations, does NOT block merge — C1 is the binding gate for plan-file lint violations); `ac-lint-baseline.json` generated at landing time by C1's bootstrap run
- [ ] **A2** — `server/lib/prompts/shared/ac-subprocess-rules.ts` exists; both `planner.ts` and `critic.ts` import from it
- [ ] **A2b** — Critic regression test: running critic against PH-01 returns **exactly 5** subprocess-safety findings on `PH01-US-06-AC01/AC02/AC03/AC05/AC06` (F55/F56), reported separately from **exactly 1** source-tree-grep finding on `PH01-US-06-AC04` (F36). Two distinct counts, no bundling. Count is VERIFIED against the current PH-01 snapshot — see Appendix A.
- [ ] **A3** — `CriterionResult.reliability` field shipped in schema + tests; consumer contract documented in `server/types/eval-report.ts` doc comment; post-activation hard cap `suspectFailures.length > 10 → /ship blocks unconditionally` implemented and tested; **dual-trigger bootstrap carve-out** (cap inactive until C1c auto-merges baseline cleanup PR OR 14 calendar days post-A3 ship, whichever first; calendar-trigger populates `a3-carry-forward.json` with grandfathered entries) implemented and tested
- [ ] **A3b** — Divergence mode splits `forwardDivergences` / `suspectFailures`; re-run on PH-01 produces **0 `forwardDivergences` entries (reliability=trusted) AND 6 `suspectFailures` total** (5 subprocess-safety + 1 source-tree-grep, reported as two counts: `{subprocessSafety: 5, sourceTreeGrep: 1}`)
- [ ] **B1** — `forge_evaluate(mode: "smoke-test")` ships with per-AC timeout policy (default 30s, `smokeTimeoutMs` override, Windows cold-start warmup); verdict schema uses `{verdict, timeoutRisk: boolean, reason?}` with 5 verdict values including `skipped-suspect`; every AC in a plan has a smokeReport entry; bootstrap detection uses the `handleSmokeTest` function-name signal (`git log`-anchored, not diff substring); smoke-test on PH-01 flags AC06 as `hung` OR `{verdict: "slow", timeoutRisk: true}` OR `skipped-suspect`
- [ ] **C1** — `.github/workflows/retroactive-critique.yml` exists; simulated rule update produces drift report PR artifact; partial-failure retry + churn suppression tested; `rule-exemptions.json` schema `{planFile, acId, ruleId, rationale}` with tuple-keyed CI diff tested; **bootstrap exemption tested: landing PR (with ac-lint.ts + ac-lint-baseline.json both added) runs in report-only mode and generates `ac-lint-baseline.json` without blocking itself**
- [ ] **C1b** — Post-bootstrap: retroactive workflow blocks merge on unresolved drift (CI red unless `rule-exemptions.json` grandfathers the violation OR `retroactive-critique-override` line is present)
- [ ] **C1c** — **Automated baseline cleanup:** after C1's first clean sweep, the workflow auto-opens a PR deleting `ac-lint-baseline.json`. **Binary checks:** (a) PR is opened by the workflow bot (no human owner); (b) after that PR merges, `test ! -f .ai-workspace/plans/ac-lint-baseline.json` returns 0; (c) merging this PR activates A3's K=10 cap (note: the 14-day calendar trigger is an independent fallback activation path).
- [ ] **C2** — `flaky` field dead-code comment deleted; auto-populated by ac-lint; evaluator retry logic tested; lint-flagged ACs bypass retry (tested separately from runtime-flaky ACs)
- [ ] **C3** — *shared with Q0/L1 — do not double-count; see Q0 exit criteria*
- [ ] **Hive-mind entries verification** — binary re-checks: `grep -l 'P62' hive-mind-persist/01-proven-patterns.md` returns a match; `grep -l 'P63' hive-mind-persist/01-proven-patterns.md` returns a match; `grep -l 'F59' hive-mind-persist/02-anti-patterns.md` returns a match; `test -f hive-mind-persist/case-studies/2026-04-12-forge-harness-ac-trust-boundary.md` returns 0.
- [ ] **Q4 hive-mind cross-citation** — moved here from Q4's own checklist (R2/C1 minor 13 fix — Q4 was pre-ticked `[x]` for its diagnosis but had a second checkbox that belonged structurally to Q0.5/A2's scope). Binary: `grep -l '2026-04-12-divergence-false-negatives-diagnosis' hive-mind-persist/02-anti-patterns.md` returns a match. This must close before Q0.5/A2 ships so the F55/F56 citation chain is complete.
- [ ] **SUPERSEDED note verification** — binary re-check: `grep -q 'SUPERSEDED' .ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md` returns 0.

---

### Q1 — PH01-US-06 AC rewrite (mechanical-only reruns)
**Goal:** Replace grep-on-vitest-output ACs with exit-code-only or `--reporter=json` checks so forward re-validation is fully mechanical in MCP subprocess context.

**Affected ACs** (`.ai-workspace/plans/forge-coordinate-phase-PH-01.json` lines **377-421**):

**Subprocess-safety class (F55/F56) — 5 ACs, handled by ac-lint subprocess rules:**
- AC01/AC02/AC03: `grep -qE 'Tests[[:space:]]+[5-9]|Tests[[:space:]]+[0-9]{2,}'` → `npx vitest run <file> --reporter=json | jq '.numPassedTests >= N'` OR exit-code-only + file-level count (F55)
- AC05: `grep -q 'passed'` → exit-code-only (F56-class)
- AC06: `npx vitest run 2>&1 | grep -q 'passed' && ! grep -q 'failed'` → exit-code-only `npx vitest run` (returns 0 iff all pass) (F56)

**Source-tree-grep class (F36) — 1 AC, handled by a different fix:**
- AC04: `grep -n 'callClaude\|trackedCallClaude' <source files>` → glob-bound `rg --files-with-matches` or AST-based check. This is NOT a subprocess-safety issue; it's an implementation-coupling grep on source trees.

Total suspect ACs in PH01-US-06 = **6**, broken down as **5 subprocess-safety + 1 source-tree-grep**.

**Why it matters:** Grep patterns depend on TTY output format; MCP subprocess strips TTY, output changes, grep fails, AC reports false FAIL. (Terminology: these are **false-positive AC results** — the AC reported FAIL but the underlying code was fine.)

**Meta-verification (closes the circularity gap):** the rewritten ACs are themselves generated artifacts and must pass the Q0.5 pipeline that was just built. Specifically: (1) each rewrite runs through ac-lint in `--strict` mode, (2) each rewrite runs through B1 smoke-test mode and produces a non-`hung`/non-`empty-evidence` verdict, (3) the Q1 PR body embeds the smoke report as evidence.

**Binary exit criteria:**
- [ ] All 5 subprocess-safety ACs (AC01/02/03/05/06) rewritten to exit-code or JSON-reporter form
- [ ] The 1 source-tree-grep AC (AC04) rewritten to AST-based or glob-bound `--files-with-matches` form
- [ ] Each rewritten AC passes ac-lint `--strict` (Q0.5/A1a)
- [ ] Each rewritten AC has a smoke-test verdict of `ok` or `{verdict: "slow", timeoutRisk: false}` (not `hung`/`empty-evidence`/`timeoutRisk: true`/`skipped-suspect`) per Q0.5/B1
- [ ] **(F8 fix — schema-explicit):** Re-running `forge_evaluate` divergence mode on PH-01 phase plan **under the post-Q0.5 reliability-split schema** returns `forwardDivergences.length === 0` (reliability=trusted failures) AND `suspectFailures.length === 0` (lint-flagged failures). Both clauses are load-bearing: the first confirms no real trusted failures; the second is the one that proves the rewrites removed the ac-lint-flagged ACs (without it, Q1 could trivially pass because PH-01 already has 0 forward divergences).
- [ ] Same rewrites audited across PH-02/03/04 plan files (grep for `grep -q` / `grep -n` patterns in ACs). This cross-phase audit is Q1's unique scope — it is NOT covered by Q0.5's PH-01-focused auto-fix path.

### Q2 — Resume calibration loop (forge_plan test harness, dogfood-driven)
**Goal:** Calibrate forge-harness primitives against **real dogfood run data** — not synthetic inputs.

**Why dogfood data, not synthetic:** Synthetic inputs test what we *think* the primitives do. Dogfood data tests what they *actually* did on this project. Per `feedback_dogfood_mandatory.md` and `feedback_persist_dogfood_files.md`, we already have this data.

**Available dogfood corpus** (`.ai-workspace/dogfood/`):
- `2026-04-10-ph01-redo.json` — PH-01 implementation run
- `2026-04-10-ph02.json` — PH-02 implementation run
- `2026-04-11-ph03.json` — PH-03 implementation run
- `2026-04-11-ph04.json` — PH-04 implementation run
- `2026-04-12-s7-divergence.json` — S7 divergence measurement run

Plus the full `.forge/runs/*.json` trace history.

**Calibration targets:**
1. **forge_plan output quality** — were the generated stories' ACs mechanically verifiable?
2. **forge_generate brief quality** — did briefs contain hallucinated file paths, missing context, or stale assumptions?
3. **forge_coordinate phase transitions** — did `assessPhase` verdicts match what actually happened in the next phase?
4. **forge_evaluate AC false-positive rate on forward divergence** — defined as: (ACs that reported FAIL in divergence mode but PASSED after being rewritten to non-fragile form per Q1) / (total ACs evaluated in divergence mode in that phase). For PH-01: numerator = 6 (the suspect ACs from Q0.5/A3b), denominator = total ACs evaluated in divergence mode for PH-01 (from the PH-01 divergence run log; do NOT conflate with the 7 reverse findings).

**Entry point:** `.ai-workspace/plans/2026-04-02-forge-plan-calibration.md` (read first, may be stale)

**Binary exit criteria:**
- [ ] Calibration plan refreshed to reference dogfood corpus as primary input (not synthetic)
- [ ] All 5 dogfood JSONs ingested into a single `.ai-workspace/calibration/2026-04-{date}-corpus.json` index
- [ ] forge_plan outputs from PH-01..PH-04 scored via `/double-critique` (≥4 plans scored)
- [ ] forge_generate briefs cross-referenced against actual edits in git history for PH-01..PH-04
- [ ] forge_coordinate retrodiction: for each phase transition in the dogfood trace, compare `assessPhase` verdict to what the next phase's ship self-review found
- [ ] forge_evaluate **AC false-positive rate** computed per phase with explicit denominator = "total ACs evaluated in divergence mode in that phase"
- [ ] Findings recorded in `.ai-workspace/calibration/{date}-forge-harness-scores.md` with per-primitive scorecards
- [ ] At least 1 calibration finding promoted to hive-mind-persist

### Q3 — Triage issues #149, #150, #152
- **#149 OAuth 401**: Decide workaround strategy. Recommend (a) codify session-does-LLM split as the official pattern. If upstream Anthropic fix lands, revisit; decision doc must state "re-evaluate on upstream fix" as an explicit trigger.
- **#150 Coherence mode**: Apply same pattern — accept pre-computed `coherenceFindings` from session. Scope: Zod schema + handler branch + tests (mirror reverseFindings PR).
- **#152 Parse-failure status**: Surface reverseFindings JSON parse errors as a distinct `status: "PARSE_FAILED"`.

**Binary exit criteria:**
- [ ] Each issue has a decision comment (accept/fix/defer) within 1 session
- [ ] #150 implemented if we accept the session-does-LLM pattern (mirrors PR #151 shape)

### Q4 — Diagnosis report: divergence false positives + reverse findings
**Deliverable:** `.ai-workspace/audits/2026-04-12-divergence-false-negatives-diagnosis.md`

**Binary exit criteria:**
- [x] Diagnosis report written with: (1) forward false-positive root cause, (2) reverse findings root cause mapping, (3) fix plan linked to Q1

*(R2/C1 minor 13 fix: the former second Q4 checkbox — hive-mind anti-pattern cross-citation — was structurally a Q0.5/A2 dependency, not a Q4 deliverable. It has been moved to Q0.5's exit criteria as "Q4 hive-mind cross-citation". Q4 now closes cleanly with a single `[x]` for its own scope.)*

## Sequence Evaluation

Recommended order: **Q4 → (Q0 parallel Q0.5, with Q0.5/A2 blocked on Q4 hive-mind cross-citation) → Q1 → Q3(#150) → Q3(#149, #152) → Q2**

**Q0 and Q0.5 run in parallel** — both close orphan feedback loops for generated artifacts. Q0 = plans; Q0.5 = ACs. Same pattern, different artifact type. Without both, Q1's manual AC rewrite is a one-off that tomorrow's plan will re-break, and Q2's calibration signal is contaminated.

**Rationale:**
1. **Q4 first** (diagnosis) — report already drafted; Q4 → Q0.5/A2 soft dependency must close before Q0.5/A2 ships (R2/C1 minor 8 fix: Q4 is strictly before Q0.5/A2, not parallel with it).
2. **Q0 and Q0.5 next, in parallel** — both close orphan feedback loops for generated artifacts. They share the `/ship` gate work (Q0/L1). Both MUST precede Q1 and Q2. Q0.5/A2 is the only sub-item with a hard dependency on Q4; the rest of Q0.5 can start immediately.
3. **Q1's PH-01 scope is absorbed by Q0.5's auto-fix path.** Q0.5/A1 (ac-lint) + Q0.5/C1 (retroactive critic) automatically flag the 6 suspect PH01-US-06 ACs. Q1's remaining unique work is the PH-02/03/04 cross-phase audit sweep plus the meta-verification of each rewrite through ac-lint-strict and B1 smoke-test.
4. **Q3 #150 coherence mode** — same session-does-LLM pattern as reverseFindings; maximum code reuse while PR #151's shape is still fresh.
5. **Q2 calibration last** — highest-variance work; correct place AFTER primitives are mechanically trustworthy.

**Anti-sequences to avoid:**
- Starting Q1 before Q0.5 ships — wastes manual effort Q0.5 would automate.
- Starting Q2 calibration before Q0 AND Q0.5 both ship — calibrates against a drifting plan and an unreliable ruler simultaneously.
- Treating Q0 and Q0.5 as sequential — they share plumbing.
- Starting Q0.5/A2 before Q4's hive-mind cross-citation closes — the single-source-of-truth rule module would cite F55/F56 without the anti-pattern entries referencing Q4.

## Checkpoint

> **Canonical checkpoint lives in `2026-04-12-execution-overview.md`** — this file tracks only implementation-level sub-details.

Done in this session (2026-04-12):
- [x] Q4 diagnosis report drafted
- [x] hive-mind entries added: P62, P63, F59
- [x] Case study written
- [x] `2026-04-10-ac-authoring-guidelines.md` marked SUPERSEDED
- [x] Detailed plan split into overview + detail
- [x] Coherent-plan pass: 9 findings (1C/5M/3m), all fixed
- [x] Double-critique pass 1 (Critic1+Corrector1): F1-F16 all fixed
- [x] Double-critique pass 2 (Critic2+Corrector2): all 15 findings (1C/7M/7m) addressed
- [x] Double-critique pass 3 (R2 Critic-1 + Corrector1): 7 MAJOR + 8 MINOR findings addressed (Q0/L4 anchor chicken-and-egg, reverseFindings id stability, working-tree marker race, K=10 dual-trigger, B1 regex brittleness, L4 trigger broadening for roadmap-complete repo, A2b VERIFIED =5 count, plus 8 minors)
- [x] Double-critique pass 4 (R2 Critic-2 + Corrector2): 2 MAJOR + 4 MINOR findings addressed (Q0/L4 Step B fill-in workflow hand-wave → explicit Q0 deliverable with `gh pr merge --auto` path; reverseFindings id migration gap → fresh-run-only policy; A1c preflight gate for C1 ordering; dangling definition de-anchored; A3 clock-start inlined; Appendix A grep → `-nE` POSIX)

Next concrete action: **L1a awaits forge-plan independent review** (mailbox `2026-04-12T1500`). On PASS verdict: push branch, open PR, run `/ship` in ai-brain, then immediately start L1b (forge-harness plan-amendment PR). On BLOCK: address findings and re-request review. After L1a and L1b both merge, proceed to L2 pre-flight (flag the F60 candidate for the marker-commit race per forge-plan 2026-04-12T1445 acknowledgment).

**Amendment 2026-04-12 — swift-henry (pre-L1 scope fix):**
- [x] Q4 pre-step — primitive-backlog.md category verification: 4/4 category strings and 2/2 cited routing rules VERIFIED; `[UNVERIFIED]` tag upgraded.
- [x] Q0/L2 scope extended from 2 routing rules to 5 per forge-plan approval `2026-04-12T1355`. Added A1.1 (`gap-found` defer-to-audit + brief surface, NO forge_plan change), A1.2 (`severity: "blocking"` atomic halt, P5), A1.3 (`affectedPhases` phase-narrowing, master-ignore).
- [x] `PhaseTransitionBrief.deferredReplanningNotes: number` added to Q0/L3 as additive optional field per P50.
- [x] Explicit negative AC added to Q0/L2: `forge_plan` is NOT modified (prevents scope creep into primitive contract).
- [x] Candidate anti-pattern captured for Q0/L7 hive-mind write-up: "Completeness critique requires upstream enumeration" (F61 candidate, n=2 this session, same-session-different-domains; memory.md entry template drafted by forge-plan `2026-04-12T1445`, pending Q0/L7 landing).

**L1 progress — 2-PR split across 2 repos (forge-plan D1+E1 approval `2026-04-12T1445`):**
- [x] L1 design decision: PR topology = 2 PRs (L1a ai-brain skill edit + L1b forge-harness plan amendment), not a monster-PR. Shared with Q0.5/C3 — counted once against L1a.
- [x] Repo ownership surprise caught: `/ship` skill lives at `ai-brain/skills/ship/SKILL.md` (symlinked to `~/.claude/skills/ship/`), NOT in forge-harness. Second F61 sighting (repo-ownership completeness gap).
- [x] L1a drafted: 74-line diff to `skills/ship/SKILL.md` adding Stage 0.5 (PLAN-REFRESH GATE, forge-harness only, applicability via `test -d .forge`), Stage 3 body embedder, Stage 6 pre-merge re-verifier.
- [x] L1a patch file preserved at `.ai-workspace/q0-l1-ship-skill-edit.patch` (103-line patch text).
- [x] ai-brain working-tree restore — reverted SKILL.md edit on `feat/critique-loop-mechanism` to committed state via `git checkout --` so the other session's WIP is safe. Verified via belt-and-suspenders `git status --short` post-restore.
- [x] Isolated worktree created: `git worktree add ../ai-brain-l1-worktree -b q0/l1-ship-plan-refresh-gate origin/master` — branch based on ai-brain `origin/master` tip `1255a7a chore: release 0.7.2`.
- [x] Belt-and-suspenders post-worktree verification: primary ai-brain checkout still has 5 other-session WIP files dirty, SKILL.md still at committed state — worktree add did not disturb primary.
- [x] Patch applied cleanly in worktree (`git apply`) with zero conflicts; SKILL.md 306 → 377 lines.
- [x] L1a committed: `3b55b6f feat(ship): add plan-refresh gate for forge-harness repos (Q0/L1)` — 1 file, 74 ins, 3 del.
- [x] L1a review request sent to forge-plan (mailbox `2026-04-12T1500`) with full 74-line inline diff + 10-item AC mapping + 4 interpretive design decisions flagged for critical eye.
- [x] L1a PASS verdict from forge-plan (mailbox `2026-04-12T1510` — PASS, 0 bugs, 2 nits)
- [x] L1a: `git push -u origin q0/l1-ship-plan-refresh-gate` + `gh pr create` — PR #216 https://github.com/ziyilam3999/ai-brain/pull/216
- [x] L1a: `/ship` run in ai-brain worktree — stateless reviewer PASS, 0 bugs, 5 enhancements filed (issues #217-#221); `/ship` gate self-exempts via `test -d .forge` (ai-brain has no `.forge/` dir)
- [x] L1a: PR merged at `d89a1b27` (2026-04-12T14:57:36Z, squash, branch deleted) → symlink propagates new SKILL.md to `~/.claude/skills/ship/` (verified `grep -c "PLAN-REFRESH GATE" ~/.claude/skills/ship/SKILL.md` = 1)
- [x] L1b: forge-harness branch `q0/l1-plan-amendment`, commit this amendment + checkpoint update, `/ship`. Expected gate output: `plan-refresh: baseline` (marker absent from forge-harness origin/master until L2). **First real customer of the gate.**

**L1a follow-ups (forge-plan approved 2026-04-12T1530 — tag-upgrade class, traceable to mailbox T1510 + stateless reviewer):**
- [ ] **Nit-1 / E1 (graduated n=2):** tighten `[0-9]+ items` → `[1-9][0-9]* items` in SKILL.md plan-refresh-line regex. Sighted independently by forge-plan review AND L1a stateless reviewer — **n=2 graduation from "someday nit" to "must-fix in L2 or tiny follow-up PR before L2"**. Issue #217.
- [ ] **Nit-2 / E5:** Stage 3 Exists branch should short-circuit error-form without override (replace stale lines, not append). Issue #221.
- [ ] **E2 (authoring bug, disposition = c per forge-plan T1530):** Stage 3 `gh pr edit --body "...\n..."` embeds literal `\n` in double-quoted bash string — bash does NOT interpret as newline. Fix with `printf` or heredoc. **Must-fix in L2's first commit** (before any `forge_reconcile` logic lands). Not live damage yet: only fires on Stage 3 Exists branch (re-ship on open PR); L1a/L1b both took "Does not exist" path. Issue #218.
- [ ] **E3:** `[{PLAN_REFRESH_OVERRIDE_LINE if set}]` meta-syntax ambiguity — clarify in SKILL.md. Issue #219.
- [ ] **E4:** grammar "Emit baseline is forbidden" → "Emitting...". Issue #220.
- [ ] **Graduation note:** Nit-1/E1 sighted independently twice (forge-plan review + L1a stateless reviewer). n=2 — supports upgrading E1 from "someday nit" to "must-fix in L2 or tiny follow-up PR before L2". Schedule accordingly.
- [ ] L1b PASS verdict from forge-plan
- [ ] L1b merged

**L1b execution note — symlink blocker dissolved organically:**
- The blocker flagged in mailbox `2026-04-12T1520` (`~/.claude/skills/ship/SKILL.md` following ai-brain primary checkout on `feat/critique-loop-mechanism`) resolved itself: the critique-loop session's PR #215 merged to ai-brain master, the primary checkout returned to master, `git pull` brought in L1a's `d89a1b27`, and `grep -c "PLAN-REFRESH GATE" ~/.claude/skills/ship/SKILL.md` now returns 1. **Option Y's worktree+symlink swap is no longer needed**; L1b ships directly on the primary symlink. forge-plan will be notified in the L1b merge confirmation mailbox.

**F60 watch status:**
- L1: zero sightings. Applicability check (`test -d .forge`) cleanly skips non-forge repos → ai-brain L1a PR self-exempts.
- L2 (pre-flight flagged): the race where two forge-harness PRs both claim `plan-refresh: baseline` → whichever merges second fails Stage 6 baseline-sanity-recheck. forge-plan acknowledged `2026-04-12T1445`. Handle in L2 pre-flight mail.

Last updated: 2026-04-12T15:35:00+08:00 (swift-henry checkpoint — L1a MERGED `d89a1b27` PR #216, L1b in-flight as first real gate customer)

---

## Critique Log

### Round 1 (Critic-1)
- **CRITICAL:** 1
- **MAJOR:** 7
- **MINOR:** 8
- **Total:** 16

(Full F1–F16 table retained in R1 source; all 16 applied.)

### Round 2 (Critic-2)
- **CRITICAL:** 1
- **MAJOR:** 7
- **MINOR:** 7
- **Total:** 15

(Full C1–C15 table retained in R1 source; all 15 applied.)

### Round 3 (R2 Researcher — Regression Audit)
- **MAJOR:** 2 (N1, N7)
- **MINOR:** 4 (N2, N3, N4, N5) + 1 meta (N6)
- **Total:** 7

(Full N1–N7 table retained in R1 source; all 7 applied.)

### Round 4 (R2 Critic-1 Cold Review of dc-2-drafter.md)
- **MAJOR:** 7
- **MINOR:** 8
- **Total:** 15

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| R2C1-1 | MAJOR | Q0/L4 anchor chicken-and-egg (amend-on-master violates no-direct-push rule) | Yes | Anchor file committed with `"PENDING"` sentinel in Q0 PR; post-merge workflow opens follow-up PR to fill real values; watchdog treats PENDING as `skipped-anchor-incomplete` AND auto-opens tracking issue |
| R2C1-2 | MAJOR | `reverseFindings[].id` stability never specified | Yes | Added schema invariant — deterministic hash of `{finding location, rule}` — with cross-run unit test |
| R2C1-3 | MAJOR | `.forge/.plan-refresh-initialized` marker read from working tree is shallow-clone-fragile | Yes | Gate now reads via `git show origin/master:.forge/.plan-refresh-initialized` (server-side) |
| R2C1-4 | MAJOR | K=10 cap activation gated solely on C1c which may never fire | Yes | Added dual-trigger: C1c-driven OR 14 calendar days post-A3 with `a3-carry-forward.json` grandfathering |
| R2C1-5 | MAJOR | B1 bootstrap uses fragile regex on diff text | Yes | Replaced with anchored `handleSmokeTest` identifier check via `git show origin/master:server/tools/evaluate.ts` |
| R2C1-6 | MAJOR | Q0/L4 "first phase PR" unreachable given COMPLETE roadmap | Yes | Trigger broadened to `14 days OR first ANY-TYPE PR touching a phase plan file, whichever first` |
| R2C1-7 | MAJOR | A2b `=== 5` unverified | Yes | Ran grep on PH-01 snapshot (see Appendix A); count confirmed exactly 5 subprocess (AC01/02/03/05/06) + 1 source-tree (AC04) |
| R2C1 minor 8 | MINOR | Sequence line "Q4 → Q0 (parallel: Q0.5)" contradicts Q4→Q0.5/A2 soft dep | Yes | Rewrote sequence line to "Q4 → (Q0 parallel Q0.5, with Q0.5/A2 blocked on Q4 hive-mind cross-citation)" |
| R2C1 minor 9 | MINOR | `orphaned`/`dangling` definitions forward-referenced to code doc comments | Yes | Stated formal definitions in-plan (Q0 layer 3); doc comments must mirror verbatim |
| R2C1 minor 10 | MINOR | `rule-exemptions.json` format never specified | Yes | Specified `{planFile, acId, ruleId, rationale}` array with tuple-keyed CI diff |
| R2C1 minor 11 | MINOR | `lintExempt` + pattern-match precedence contradiction between A1b and A3 | Yes | Explicit precedence: exempt wins → `unverified`, AC executes normally; A1b/B1/A3 all updated |
| R2C1 minor 12 | MINOR | Q0/L6 grep assumes `F[0-9]+` id prefix and case-sensitive "accountability gap" | Yes | Switched to `grep -Ei "accountability gap"` + explicit evidence-content check |
| R2C1 minor 13 | MINOR | Q4 `[x]` + second `[ ]` cross-citation checkbox creates a never-closable section | Yes | Moved cross-citation to Q0.5 exit criteria; Q4 now a single `[x]` |
| R2C1 minor 14 | MINOR | "8 independent safeguards" list item #3 is meta, not independent | Yes | Reframed as "7 independent safeguards + 1 meta-gap" with item 3 explicitly labeled |
| R2C1 minor 15 | MINOR | C1 cost note contradicts C2 scope (F55-ACs "fail retry twice" vs "not retried") | Yes | Deleted the stale first sentence; kept the correct scope clarification |

**Application rate this round: 15/15 = 100%.** Same R3/N6 caveat applies — 100% is consistent with either real signal or under-critical critics; treat as calibration-loop flag, not proof of quality.

### Round 2 (R2 Critic-2 Cold Review of dc-4-corrector1.md)
- **MAJOR:** 2
- **MINOR:** 4
- **Total:** 6

| # | Severity | Finding | Applied? | Reason |
|---|----------|---------|----------|--------|
| R2C2-1 | MAJOR | Q0/L4 Step B "existing PR-merge automation" is a hand-wave; forge-harness has no such automation | Yes | VERIFIED no auto-merge workflow exists (`.github/workflows/` = only `ci.yml`). Explicitly declared NO existing automation; `.github/workflows/q0-l4-anchor-fill.yml` is now a Q0-PR deliverable with a `gh pr merge --auto --squash` path (or `q0-l4-anchor-fill`-tagged `/ship` unblock fallback). Leaving merge "to existing automation" is explicitly disallowed. |
| R2C2-2 | MAJOR | `reverseFindings[].id` stability invariant is backward-incompatible; no migration policy for v0.20.1 artifacts | Yes | Added fresh-run-only migration policy to Q0/L2: pre-Q0 artifacts are NOT retroactively rewritten; CI emits `legacy-reverseFindings-ids-discarded` warning; the "7 → 0" binary re-runs divergence measurement from scratch under the new id scheme. Q0/L2 exit criterion updated to cite post-Q0-only measurement. |
| R2C2-3 | MINOR | A1c "land with C1" is prose-only, no CI enforcement | Yes | Added preflight step in A1c workflow: fails if `retroactive-critique.yml` is neither on master nor being added in the PR diff. One-line `test -f ... || git diff --name-only ... | grep -qx ...`. |
| R2C2-4 | MINOR | `dangling` definition anchors staleness on arbitrary `phasePlan.createdAt` | Yes | Dropped the staleness clause entirely per the critic's option (c): `dangling` = target missing OR target has `status=completed`. Timestamp comparisons removed. |
| R2C2-5 | MINOR | A3 "14 days after A3 ships" clock anchor buried in Appendix C, not inline | Yes | Inlined the anchor into the A3 bootstrap carve-out: first commit on `origin/master` adding the `reliability` field to `server/types/eval-report.ts`, detected via `git log --follow --diff-filter=A -S 'reliability'`. |
| R2C2-6 | MINOR | Appendix A grep uses BSD `\|` syntax, non-POSIX | Yes | Rewrote as `grep -nE "grep -qE|grep -q 'passed'|grep -q 'failed'|grep -n "` (POSIX extended regex). |

**Application rate this round: 6/6 = 100%.** All findings actionable and mechanically addressable. Plan has converged.

---

## Appendix A — A2b PH-01 count verification (R2/C1-7 fix evidence)

Grep command run against `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` (PH01-US-06 section, lines 377-421):

```
$ grep -nE "grep -qE|grep -q 'passed'|grep -q 'failed'|grep -n " .ai-workspace/plans/forge-coordinate-phase-PH-01.json | grep -E "PH01-US-06|^38[5-9]|^39[0-9]|^40[0-9]|^41[0-9]"
385:          "command": "npx vitest run server/lib/topo-sort.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]|Tests[[:space:]]+[0-9]{2,}'"
390:          "command": "npx vitest run server/lib/run-reader.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]|Tests[[:space:]]+[0-9]{2,}'"
395:          "command": "npx vitest run server/lib/coordinator.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[8-9]|Tests[[:space:]]+[0-9]{2,}'"
400:          "command": "test -z \"$(grep -n 'callClaude\\|trackedCallClaude' server/lib/coordinator.ts ...)\" && echo EMPTY-OK | grep -q EMPTY-OK"
405:          "command": "npx vitest run server/lib/coordinator.test.ts -t 'NFR-C02|deterministic.*dispatch|determinism' 2>&1 | grep -q 'passed'"
410:          "command": "npx vitest run 2>&1 | grep -q 'passed' && ! grep -q 'failed'"
```

Classification of the 6 matching ACs (plus non-matching AC07 `npx tsc --noEmit` which is clean):

| AC id   | Line | Pattern | Class |
|---------|------|---------|-------|
| AC01    | 385  | `grep -qE 'Tests[[:space:]]+[5-9]|Tests[[:space:]]+[0-9]{2,}'` | **F55 subprocess** |
| AC02    | 390  | `grep -qE 'Tests[[:space:]]+[5-9]|Tests[[:space:]]+[0-9]{2,}'` | **F55 subprocess** |
| AC03    | 395  | `grep -qE 'Tests[[:space:]]+[8-9]|Tests[[:space:]]+[0-9]{2,}'` | **F55 subprocess** |
| AC04    | 400  | `grep -n 'callClaude\|trackedCallClaude' <source files>`       | **F36 source-tree grep** |
| AC05    | 405  | `grep -q 'passed'`                                             | **F56 subprocess** |
| AC06    | 410  | `grep -q 'passed' && ! grep -q 'failed'` (multi-grep)          | **F56 subprocess** |
| AC07    | 415  | `npx tsc --noEmit` (clean)                                     | n/a |

Count: **5 subprocess-safety (AC01, AC02, AC03, AC05, AC06) + 1 source-tree-grep (AC04) = 6 distinct suspect findings**.

This matches the plan's `{subprocessSafety: 5, sourceTreeGrep: 1}` assertion exactly. The A2b `=== 5` fixture count is VERIFIED.

VERIFIED: PH01-US-06-AC01..AC07 ACs found at `.ai-workspace/plans/forge-coordinate-phase-PH-01.json:383-416` — actual AC commands quoted above.

---

## Appendix B — Per-fix SIDE-EFFECT-CHECK

**R2C1-1 — Q0/L4 anchor chicken-and-egg → PENDING sentinel + post-merge fill-in workflow + auto-open tracking issue**
- format: ok
- naming: ok — new workflow file `.github/workflows/q0-l4-anchor-fill.yml` introduced; does not collide with existing `q0-l4-deadline.yml` (both scoped to L4 but different triggers)
- shape: anchor schema changed from `{q0MergedAt: ISO8601, q0MergeSha: string}` to `{q0MergedAt: ISO8601 | "PENDING", q0MergeSha: string | "PENDING"}`. Watchdog consumer updated to handle both sentinel and real values with three status cases (`skipped-no-anchor`, `skipped-anchor-incomplete`, real). No other consumer reads this file yet.
- refs: updated all three references in Q0/L4 block to describe the new Step A/B/C flow; the R1 "amended on master" wording removed everywhere it appeared.

**R2C1-2 — reverseFindings[].id stability**
- format: ok
- naming: ok
- shape: new invariant on `reverseFindings[].id` (deterministic hash of `{finding location, rule}`). Consumers: Q0/L2's `reconcile-remnants.json` id-only diff (updated to cite the invariant), forge_evaluate(divergence) emitter (implementer must add unit test).
- refs: Q0/L2 binary now explicitly references the stability invariant.

**R2C1-3 — working-tree marker → origin/master read**
- format: ok
- naming: ok
- shape: no schema change; the marker file is the same, only the read path changes.
- refs: Q0/L1 layer 1, Q0/L2 empty-history clause, and Q0/L1 exit criterion bullet all updated to cite `git show origin/master:.forge/.plan-refresh-initialized`. Three reference sites kept in sync.

**R2C1-4 — K=10 dual-trigger activation**
- format: ok
- naming: new file `a3-carry-forward.json` introduced.
- shape: A3 bootstrap carve-out now has two triggers (C1c OR 14-day-calendar); `a3-carry-forward.json` is a new artifact populated only on calendar-trigger path.
- refs: A3 block updated; C1c note updated to say "one of two" triggers; A3 exit criterion updated; C1c exit criterion updated.

**R2C1-5 — B1 regex → `handleSmokeTest` structural signal**
- format: ok
- naming: new identifier convention — the bootstrap-trigger function must be named exactly `handleSmokeTest` in `server/tools/evaluate.ts`. Implementer of B1 must use this exact name.
- shape: ok
- refs: B1 block + B1 exit criterion both updated to cite the function-name detection.

**R2C1-6 — Q0/L4 trigger broadened**
- format: ok
- naming: ok
- shape: ok
- refs: Q0/L4 trigger clause updated; sequence evaluation section does not reference the specific trigger so no cascade.

**R2C1-7 — A2b `=== 5` verification**
- format: ok
- naming: ok
- shape: ok
- refs: A2b text and A2b exit criterion both cite Appendix A; appendix added at end of document.

**Minor 8 — sequence line rewrite**
- refs: single site (Sequence Evaluation header). No cascade.

**Minor 9 — orphaned/dangling definitions in-plan**
- refs: Q0 layer 3 body now contains the formal definitions. The Q0/L2 exit criterion text updated from "written in doc comments" to "stated in this plan AND mirrored in doc comments".

**Minor 10 — `rule-exemptions.json` schema**
- shape: new shape `{planFile, acId, ruleId, rationale}` array; tuple-keyed CI diff. New consumers: C1 exit criterion, `stale-exemption` cleanup warning.
- refs: C1 block + C1 exit criterion updated.

**Minor 11 — `lintExempt` precedence**
- shape: A1b routing logic now has an explicit precedence branch.
- refs: A1 body (precedence clause added), A1b body (updated to describe both branches), A3 populating rules (updated to mention both paths), A1 exit criterion (added precedence test), A1b exit criterion (added exempt-passthrough test). Five sites kept in sync.

**Minor 12 — Q0/L6 grep**
- refs: Q0/L6 exit criterion text updated. No other reference to this grep.

**Minor 13 — Q4 cross-citation migration**
- refs: Q4 block collapsed to single `[x]`; Q0.5 exit criteria gained "Q4 hive-mind cross-citation" item; Sequence rationale updated to cite the Q4→Q0.5/A2 dependency explicitly.

**Minor 14 — safeguard count 8 → 7+1**
- refs: the "Full gap chain" introductory sentence changed from "8 independent safeguards, all blind" to "7 independent safeguards + 1 meta-gap"; list body unchanged except item 3 prefixed with `(Meta-gap, not an independent safeguard)`; count footer added.

**Minor 15 — C1 cost note**
- refs: C1 Cost note paragraph: first sentence deleted, second sentence retained as the sole content.

---

## Appendix C — Self-Review Checklist (R2 Corrector1 pass)

**1. Conflicts**
- The new PENDING sentinel in `q0-l4-anchor.json` does not conflict with the existing N1 `skipped-no-anchor` status — both coexist (absent file → `skipped-no-anchor`; present-but-PENDING → `skipped-anchor-incomplete`). Three-case watchdog logic is internally consistent.
- `lintExempt` precedence (exempt → `unverified`, executes normally) reconciles the prior A1b/A3 contradiction; no section still routes an exempt AC to `suspect`.
- Dual-trigger K=10 activation: the 14-day calendar trigger is marked "independent fallback" in C1c and is `one-of-two` in A3. The two descriptions are consistent. The `a3-carry-forward.json` is only populated on the calendar-trigger branch, so the C1c-driven clean-sweep path never touches it.
- `handleSmokeTest` identifier: binds the implementer to a specific function name. This is a new constraint but does not conflict with anything else (no other part of the plan references a different smoke-test entry-point name).
- Sequence rewrite "Q0.5/A2 blocked on Q4" is consistent with both the Q4→A2 soft dependency in the exit criteria block and the anti-sequence bullet.
- No conflicts found.

**2. Edge cases**
- R2C1-1 Step B fill-in workflow failure: if the workflow fails to open the follow-up PR (e.g., GitHub API outage), the anchor stays PENDING indefinitely. Watchdog auto-opens a tracking issue on every cron firing, idempotent via content-hash → only one issue created → visible error. Acceptable.
- R2C1-4 calendar trigger edge: what if A3 ships but is then reverted before day 14? The 14-day clock starts from the A3-ship commit on master; a revert removes the schema, so the cap-activation workflow has nothing to enforce. The revert PR would need to re-land A3 later, restarting the clock. Low risk (reverts of shipped schema changes are rare) and not patched.
- R2C1-5 `handleSmokeTest` identifier collision: if a future refactor renames the function, the bootstrap-exemption detection silently breaks. Mitigating factor: post-bootstrap the detection is dead code (exemption never fires again), so a later rename cannot accidentally re-trigger bootstrap mode. Clean.
- R2/C1 minor 11 exempt-passthrough: an AC that is `lintExempt` for rule X but matches rule Y (not exempted for Y) — precedence should route via rule Y to `suspect`. The text says "exempt wins over pattern match" without qualifying "for that rule." SELF-CAUGHT. The intended behavior is per-rule: exemption is for a specific `ruleId`, and only that rule's pattern match is downgraded; matches against other rules still route to `suspect`. Added qualifier in the A1b routing description: "pattern-matched AND NOT `lintExempt` for the matched rule" and in A3 populating rules: "matched deny-list patterns AND NOT `lintExempt` for the matched rule".

**3. Interactions between my own changes**
- R2C1-3 (origin/master marker read) and R2C1-1 (PENDING anchor file read via `git show`) both rely on the same server-side read pattern. Consistent mechanism, no interaction.
- R2C1-4 calendar trigger and minor 13 (Q4 cross-citation moved to Q0.5) both affect Q0.5's exit-criteria list length but touch disjoint bullets.
- Minor 9 (in-plan definitions of orphaned/dangling) and Q0/L3 non-triviality fixture text: the fixture text references the definitions; by stating them in-plan rather than deferring, the fixture description now has a definition to point at within the same document. Improved coherence.

**4. New additions — full execution trace**
- PENDING sentinel + fill-in workflow: success = PR lands → merge → workflow opens fill-in PR → fill-in PR merges → anchor real → next cron firing uses real value. Failure paths covered above.
- `a3-carry-forward.json`: success path = day 14 arrives, baselines still dirty → calendar trigger fires → workflow reads current `suspectFailures` set → writes grandfathered ids to `a3-carry-forward.json` → K=10 cap activated with exemption list → subsequent `suspectFailures` count normally. Failure = workflow bug mis-populates file → worst case is false-grandfather or missed-grandfather, surfaceable via a unit test on the grandfathering routine.
- `handleSmokeTest` identifier: success = landing PR has the function, master doesn't → bootstrap-exempt fires → gate passes → next PR sees function on master → bootstrap deactivates → binding mode from then on. Failure = implementer uses a different function name → bootstrap detection never fires → landing PR blocks itself → implementer hits the error and renames the function. Loud failure, not silent.

**5. Evidence-gated verification**
- VERIFIED: PH-01 AC count for A2b confirmed via grep on `.ai-workspace/plans/forge-coordinate-phase-PH-01.json` — 5 subprocess-safety patterns (lines 385, 390, 395, 405, 410) + 1 source-tree-grep pattern (line 400). Full evidence pasted in Appendix A.
- VERIFIED: PH01-US-06 AC IDs AC01..AC07 found at `.ai-workspace/plans/forge-coordinate-phase-PH-01.json:383-416` — actual JSON block read via Read tool, AC commands match the classifications in Appendix A exactly.
- VERIFIED: R2 Critic-1 review document found at `tmp/dc-3-critic1.md:15-149` — 15 findings (7 MAJOR + 8 MINOR) read in full; finding numbers map 1:1 to R2C1-1..R2C1-7 (MAJOR) and R2C1 minor 8..15.
- VERIFIED: R1 drafter plan read in full at `tmp/dc-2-drafter.md:1-470` — original text for each edited section pulled from the numbered source; no content invented.
- UNVERIFIED: `.github/workflows/q0-l4-anchor-fill.yml` does not exist in the repo — it is a forward-looking artifact introduced by this plan, not a current-state claim.
- UNVERIFIED: `handleSmokeTest` function in `server/tools/evaluate.ts` — not yet implemented (Q0.5/B1 creates it).
- UNVERIFIED: `a3-carry-forward.json` — forward-looking artifact.
- UNVERIFIED: `reverseFindings[].id` current generation scheme in `server/tools/evaluate.ts` — did not read the file to confirm the current id-generation logic. The plan asserts a *required* invariant (deterministic hash of `{finding location, rule}`), not a claim about current behavior.

**SELF-CAUGHT:** minor 11 precedence qualifier (per-rule vs blanket exemption) — fixed in A1b and A3 populating rules during this pass.

**Novelty tag audit:** NEW_CLAIM tags this pass: (1) `"PENDING"` sentinel in `.ai-workspace/q0-l4-anchor.json`; (2) `skipped-anchor-incomplete` status string; (3) `.github/workflows/q0-l4-anchor-fill.yml` workflow file; (4) dual-trigger K=10 activation (C1c OR 14-day-calendar); (5) `a3-carry-forward.json` file; (6) `handleSmokeTest` function-name identifier convention. Pre-R4 NEW_CLAIMs remain tagged at their original sites.
