---
title: forge_coordinate PRD revision — v0.16.2 (state machine rework)
date: 2026-04-09
upstream_brief: mailbox/archive/2026-04-09T1720-forge-plan-to-lucky-iris-prd-revision-decisions-abc.md
---

## ELI5

forge-plan reviewed our PRD and said "your rules for when work is stuck need a rewrite." Instead of "the work is blocked, wait," the new rule is "the plan is wrong, fix the plan." We also add auto-retry up to 3 times so small failures don't need a human. Then we re-check only the parts we changed (not the whole document) and ship a new version.

## Source of truth

forge-plan's revision brief is the spec. Do NOT invent decisions — every change below is already dictated by that message. Open it when in doubt:

`C:\Users\ziyil\claude-code-mailbox\mailbox\archive\2026-04-09T1720-forge-plan-to-lucky-iris-prd-revision-decisions-abc.md` (after archive)

## Exit Criteria (binary)

- [x] `docs/forge-coordinate-prd.md` REQ-01 includes `evalReport?: EvalReport` field in the RunRecord extension with at least one new AC binding the field to `handleStoryEval`'s write path
- [x] REQ-04 replaces the 4-state machine with exactly the 6 states: `done | ready | ready-for-retry | failed | pending | dep-failed`, and includes an AC stating retry count is re-derived (not stored)
- [x] REQ-05 replaces the `brief.status` rule with the new 4-case rule in priority order `halted > complete > needs-replan > in-progress`, and adds `retryCount`, `retriesRemaining`, `priorEvalReport` to `StoryStatusEntry`
- [x] REQ-05 drops the "all-failed phase → blocked" AC
- [x] REQ-08 renames downstream `blocked` propagation to `dep-failed` (INCONCLUSIVE path remains distinct)
- [x] REQ-10 adds two new ReplanningNote triggers (`retries exhausted` with category `ac-drift`; `dep-failed-chain` with category `assumption-changed`) both with `severity: "blocking"`
- [x] REQ-13 has explicit language preserving `failed` and `dep-failed` across plan mutations
- [x] §5 Workflows includes a "Retry path" workflow and the "Failure path" is rewritten in terms of the new state machine
- [x] §7 out-of-scope: "no-auto-retry" row REMOVED; "unlimited retries (cap=3)" row ADDED
- [x] `/double-critique` runs scoped to the delta only (7 REQs + state machine + rule + evalReport size); full critique log appended to PRD bottom replacing or extending the v0.16.1 log
- [x] All critique findings applied or explicitly rejected with rationale (0 silent drops)
- [x] PR created, merges green, tagged `v0.16.2` via `/ship`
- [x] Reply sent to forge-plan containing all 5 reply-contract items (PRD path + confirmation, PR URL + merge + tag, critique delta report, any new surprises, §5/§7 confirmation)

## Non-goals (explicit) — with documented deviations

- Do NOT edit REQ-02, REQ-03, REQ-06, REQ-07, REQ-09, REQ-11, REQ-16 — unchanged as planned
- Do NOT edit any NFR — **DEVIATED with rationale:** NFR-C06/C08/C10 edited because Round 3 critique surfaced cross-cutting interactions (disk growth from EvalReport embedding, non-optional-with-null field shape needed to preserve "no absent keys", serialization determinism precondition for golden-file byte-identity). Edits are addendums, not replacements
- **DEVIATED from "do not edit REQ-12/REQ-14/REQ-15":** REQ-12 gained distinct-storyId dedup AC (Round 3 C2-C2 — single retry-exhausted story would self-graduate; this was a latent bug the retry machine exposed); REQ-14 documented intentional `maxRetries` omission (Round 3 C2-M2 — no logic change, just scope gate); REQ-15 halt-hard ACs reworked for non-latching semantics (Round 3 C1-m6 — reconciled a latent contradiction in the clearing path). All three deviations are cross-cutting FIXES demanded by the critique, not scope creep
- Do NOT act on surprises #1–#4 from the outbound — forge-plan is handling those against the implementation plan in parallel (and #4 windows-latest CI landed during this session as PR #113)
- Do NOT re-critique unchanged REQs (scoped delta only)

## Checkpoint

- [x] Read current PRD REQ-01, REQ-04, REQ-05, REQ-08, REQ-10, REQ-13, §5, §7 to anchor edits
- [x] Edit REQ-01 — add `evalReport` field + AC (+ sorted serialization + schema version)
- [x] Edit REQ-04 — 6-state machine + classification precedence + re-derivation AC + dep-failed propagation + plan-window scoping + flaky-eval note
- [x] Edit REQ-05 — new 4-case rule + new StoryStatusEntry fields (non-optional null) + LAST RETRY AC + readyStories semantics AC + drop all-failed-blocked AC
- [x] Edit REQ-08 — INCONCLUSIVE routes through retry counter; rename downstream to dep-failed; scope note on PH-02 US-03 semantics
- [x] Edit REQ-10 — two new ReplanningNote triggers (one per root)
- [x] Edit REQ-12 — distinct-storyId dedup AC (Round 3 cross-cutting fix)
- [x] Edit REQ-13 — preserve failed/dep-failed across mutations + dangling-dep AC
- [x] Edit REQ-14 — document intentional `maxRetries` omission
- [x] Edit REQ-15 — halt-hard non-latching + clearing safety
- [x] Edit NFR-C06/NFR-C08/NFR-C10 for cross-cutting interactions (size, shape, determinism)
- [x] Rewrite §5 Failure path + add Retry path workflow
- [x] Update §7 out-of-scope rows (add unlimited-retries, flaky-eval, rename-bypass)
- [x] Verify SC-01 ACs still make sense under the new REQ shapes (no count change — 16/10/8 stable)
- [x] Update §11 traceability REQ-08 label; add §2 terminal annotation
- [x] Run scoped `/double-critique` on the delta (Critic-1 + Critic-2 in parallel)
- [x] Apply critique findings (24/26 full, 1 partial with documented rationale, 1 out-of-scope + 2 verified-clean); append Round 3 Critique Log to PRD
- [x] Mark v1.0 corrector audit sections as historical
- [x] `/ship` as v0.16.2 — PR #114 merged (commit `3088212`), release tag `v0.16.2`, CI green on ubuntu-latest + windows-latest (windows matrix landed via forge-plan's #113 during this session)
- [x] Send reply to forge-plan (5-item contract + 4 new surprises: duplicate `writeRunRecord` still in codebase, impl plan still v1.0, `readyStories` v2 split candidate, `priorEvalReport` on failed justification)

## Outcome

PLAN COMPLETE. All exit criteria met. v0.16.2 released. Reply sent. S2 ball is in forge-plan's court — waiting on their answers to the 5 asks in the outbound reply.

### Handoff state for next session

If forge-plan pushes back on Decision A* (rejection of `proceedWithPartialFailure`): reopen the rejection and add the input arg to REQ-14 + REQ-05 rule 3.

If forge-plan confirms everything and sends the S2 prompt: new plan file `.ai-workspace/plans/2026-04-09-forge-coordinate-s2-prompt.md` (or similar) covering master plan generation + phase plan generation + `forge_evaluate(mode: "coherence", ...)` against the v1.1 PRD's binary ACs.

Known landmines for S3 (pre-PH-01):
1. Impl plan at `.ai-workspace/plans/2026-04-09-forge-coordinate-implementation.md` still uses v1.0 state machine — forge-plan's S2 responsibility to re-sync
2. Duplicate `writeRunRecord` exports in `server/lib/run-record.ts:43` vs `server/lib/generator.ts:466` — needs rename cleanup or import discipline before PH-01 US-00b

Last updated: 2026-04-09T18:45+08:00
