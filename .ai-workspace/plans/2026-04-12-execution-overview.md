# Execution Overview — Post-v0.20.1

**Type:** Overview / todo list. Short, scannable. For detailed architecture see `2026-04-12-next-execution-plan.md`. For hive-mind-persist discoverability work see `ai-brain/hive-mind-persist/proposals/2026-04-12-hive-mind-indexing.md`.
**Last updated:** 2026-04-13T16:55:00+08:00 (Q0 FULLY CLOSED — L7 merged ai-brain#234; Q0.5 BLOCKED on user opt-in at phase boundary)

## Session log (2026-04-13, Q0 L1→L7 completion)

### Q0 layers — all merged
- ✅ **L1a**: ai-brain PR #216 (`d89a1b27`) — `/ship` plan-refresh gate skill addition
- ✅ **L1b**: #153 (`5f47c6d`) — L1a amendment, 5 nit follow-ups, n=2 graduation
- ✅ **L2+L3 combined (Option B)**: #159 (`a89d779`) — `forge_reconcile` tool + `PhaseTransitionBrief` drift fields, v0.21.0 release
- ✅ **L2+L3 docs**: #160 (`1d3fb76`) — gap-found pre-pass clarification (Caveat B amendment)
- ✅ **L4 pre-flight**: #161 (`03f1bfe`) — audit log accuracy (Pass 2b sweep) + `ReconcileStatus="failed"` enum + `haltedOnNoteId→haltedOnNoteIndex` rename
- ✅ **L4 proper**: #162 (`7a0bb31`) — anchor file + deadline watchdog + fill workflow
- ✅ **L5 pre-flight**: #163 (`f974c83`) — `plan.test.ts` envelope contract test
- ✅ **L5 proper**: #164 (`8d07622`) — structured `updatedPlan/critiqueRounds` sidecar (option b+), v0.22.0 release
- ✅ **L6**: #165 (`05ff764`) — contrived reconcile dogfood, FIRST non-baseline trailer `plan-refresh: 1 items` in repo history
- ✅ **L4 anchor proven-by**: #166 (`0d2de9b`) — `q0L4ProvenBy` set to L6 merge SHA
- ✅ **L7**: ai-brain#234 (`8d1b450`) — P62/P63 graduation + F62/F63 candidates + Q0 case study

### Knowledge capture (Q0/L7)
- ✅ **P62** — Running Beats Reading (Static Inspection Misses What Execution Surfaces), n=6 sightings including phantom-checkmark self-correction from L7 review cycle
- ✅ **P63** — Cold-Read Critique with Reductio Qualifiers, n=4 sightings, both reductio directions as load-bearing clauses
- ✅ **F62** `[CANDIDATE n=1]` — Subagent Self-Report Confidence Uncorrelated With AC Satisfaction (the reason P63 exists)
- ✅ **F63** `[CANDIDATE n=1]` — Uniform List Format Across Non-Uniform Items Creates Silent Conflation (forge-plan self-observation from plan.md:41-46)
- ✅ **Case study**: `hive-mind-persist/case-studies/2026-04-13-q0-plan-writeback-loop.md`, 187 lines, all 10 sections

### Q0 closure stats
- **11 PRs merged** (9 forge-harness + 2 ai-brain) + v0.22.0 release
- **8 mailbox cycles** between forge-plan and swift-henry
- **8 cold-review blockers caught** across Q0 arc (L2+L3: 3, L4: 3, L5: 1, L7 drafting: 1)
- **Loop self-validated** via L6's own `plan-refresh: 1 items` trailer

### Q0.5 gate state — BLOCKED on user
- ❌ forge-plan attempted autonomous greenlight (T1640) citing prior user "continue until harness queue complete" directive
- ✅ swift-henry REFUSED greenlight via self-imposed user-level gate; invoked F62 recursively ("coordinator authorization claims ≠ user-level gate state")
- ✅ forge-plan accepted refusal (T1655), logged as forge-plan F62 sub-case #1 ("coordinator-level auth cannot substitute for user-level phase-boundary gates")
- 🔴 **Q0.5 A1 scope locked in on swift-henry's side; cut-branch action pending explicit user directive**

---

## TL;DR

We just shipped v0.20.1. Two tracks of work are queued:

- **Forge-harness track (Q0–Q4):** Five work items. Two of them (Q0 + Q0.5) are architectural fixes to forge-harness itself — they close orphan feedback loops for generated artifacts (plans and ACs). The other three are downstream cleanup that gets easier once Q0/Q0.5 land.
- **Hive-mind-persist meta track (M1–M7):** Close the discoverability loop on the knowledge base itself using `/project-index` + CLAUDE.md enforcement. Triggered by a P60 near-miss in the same session that built Q0.5. Runs in parallel with Q0/Q0.5 because it's infrastructure, not blocked by the forge-harness work.

**Order of execution:**
- Forge-harness: Q4 (done) → **Q0 + Q0.5 in parallel** → Q1 → Q3 → Q2
- Meta track: **M1 first** (empirical baseline, ≤5 min) → M2-M3 (only if needed) → M4+M5 → M7 → M6
- The two tracks are independent and can run in parallel

---

## Forge-Harness Queue

| # | Item | Priority | Status | Est. scope |
|---|---|---|---|---|
| **Q4** | Divergence diagnosis report (forward false negatives + reverse findings) | — | ✅ DONE | 1 file, complete |
| **Q0** | Close the plan-writeback loop (`forge_plan(update)` orphan fix) | 🟥 HIGHEST (tied w/ Q0.5) | ✅ FULLY CLOSED — L1→L7 merged, 11 PRs, v0.22.0, P62/P63 graduated | Complete |
| **Q0.5** | AC trust-model fix (built into forge-harness as permanent architecture) | 🟥 HIGHEST | 🔴 **BLOCKED on user opt-in** — Q0→Q0.5 is phase boundary, swift-henry self-gate held, scope locked in from T1640 | New module + shared-rules refactor + schema field + smoke mode + CI workflow |
| **Q1** | Rewrite 4 bad PH01-US-06 AC commands | 🟨 Medium (mostly auto-fixed by Q0.5) | ⬜ Not started | 1 JSON file edit, ~10 lines |
| **Q3** | Triage issues #149 (OAuth 401), #150 (coherence mode), #152 (parse status) | 🟨 Medium | ⬜ Not started | Decision comments + #150 implementation |
| **Q2** | Resume calibration loop (dogfood-data-driven) | 🟦 Lowest — MUST be last | ⬜ Not started | Large, variable-scope |

## Meta / Infrastructure Queue (hive-mind-persist discoverability)

| # | Item | Priority | Status | Est. scope |
|---|---|---|---|---|
| **M1** | Run `/project-index` against hive-mind-persist (empirical baseline) | 🟥 Do first — gates M2/M3 | ⬜ Not started | ≤5 min skill invocation |
| **M2** | Extend `/project-index` Stage 1 scan rules for H3 pattern headings | 🟨 Only if M1 insufficient | ⬜ Not started | ~10-line SKILL.md edit + eval |
| **M3** | Add topic-keyed Quick Start rows referencing pattern IDs | 🟨 Only if M1 insufficient | ⬜ Not started | ~6 curated rows |
| **M4** | Add CLAUDE.md enforcement rule — read PROJECT-INDEX.md before design proposals | 🟥 Must follow M1 | ⬜ Not started | 1-line addition to `parent-claude.md` |
| **M5** | Closed-loop measurement — `index-hit` self-reports in the hive-mind observation log (file is `memory.md` until M6 renames it to `hive-mind-memory.md`) + runs/data.json metrics | 🟥 Must follow M4 | ⬜ Not started | Rule + skill metric additions |
| **M6** | Rename `hive-mind-persist/memory.md` → `hive-mind-memory.md` (disambiguation) | 🟦 Cleanup — lowest priority | ⬜ Not started | File rename + grep-audit migration across ai-brain/ |
| **M7** | Write down graduation protocol explicitly (n=3 for patterns, n=5 for anti-patterns) | 🟨 Before first post-M5 graduation | ⬜ Not started | 1 doc file in hive-mind-persist/ |

---

## Top-level todo list (one line per deliverable)

### Meta / Infrastructure — hive-mind-persist discoverability closed loop

**Trigger:** P60 near-miss during the Q0.5 session (2026-04-12). Agent proposed shipping `docs/ac-authoring-guide.md`, directly violating P60; caught only by accident while scrolling for the next P-number. Details: `hive-mind-persist/memory.md` 2026-04-12 entry + full proposal at `hive-mind-persist/proposals/2026-04-12-hive-mind-indexing.md`.

**Goal:** Build a closed feedback loop (learning → pattern → ratification → automated index refresh → pre-decision enforcement → measurement → back to learning) so future near-misses become catchable and the knowledge base strictly improves over time.

- [ ] **M1** Run `/project-index` against `C:/Users/ziyil/coding_projects/ai-brain/hive-mind-persist/` — empirical baseline, ≤5 min, decides whether M2/M3 are needed
- [ ] **M2** *(conditional)* Extend `/project-index` SKILL.md Stage 1 to scan H3 `### P\d+`/`### F\d+` headings in `knowledge-base/0[12]-*.md`
- [ ] **M3** *(conditional)* Add topic-keyed Quick Start rows that directly reference pattern IDs (≥6 rows)
- [ ] **M4** Add one-line enforcement rule to `parent-claude.md`: *"Before proposing any design change, read `hive-mind-persist/.ai-workspace/PROJECT-INDEX.md`"*
- [ ] **M5** Add `index-hit` self-report convention to `hive-mind-persist/memory.md` (current name — will become `hive-mind-memory.md` after M6 runs) + extend `/project-index` runs/data.json with `patternHitsReportedSinceLastRun` + `candidatePatternsInMemory` metrics
- [ ] **M7** Document graduation protocol explicitly: n≥3 sessions → proven-pattern; n≥5 → anti-pattern; reference from `01-proven-patterns.md` header
- [ ] **M6** *(cleanup, lowest priority)* Rename `hive-mind-persist/memory.md` → `hive-mind-memory.md`. Cross-cutting migration, deserves its own PR; don't execute mid-session

**Hard rule:** Do M1 first. If the baseline `/project-index` output is already sufficient (covers knowledge-base files with topic groupings + Quick Start task rows), skip M2/M3 and go directly to M4+M5. Do not extend the skill before testing the baseline.

### Forge-Harness queue (Q0–Q4)

### Q0 — Plan-writeback loop (close the orphan in `forge_plan(update)`)

- [ ] **Q0/L1** `/ship` gate blocks phase PRs missing `plan-refresh:` line *(shared with Q0.5/C3)*
- [ ] **Q0/L2** Build `forge_reconcile` tool or mode chaining `forge_evaluate(reverse) → ReplanningNote → forge_plan(update) → atomic plan write`
- [ ] **Q0/L3** Running `forge_reconcile` on this repo reduces reverse findings 7 → 0 (or labels human-judgment remnants)
- [ ] **Q0/L4** Add `PhaseTransitionBrief.driftSinceLastPlanUpdate: number` field
- [ ] **Q0/L5** Non-zero drift produces recommendation string containing the literal word `INVOKE`
- [ ] **Q0/L6** Q0's own PR dogfooded through the new refresh loop before merge
- [ ] **Q0/L7** hive-mind-persist entries added for Q0 (detect→update→commit cycle proven pattern + primitive-boundary-accountability-gap anti-pattern)

### Q0.5 — AC trust-model fix (permanent architecture)

**Layer A — Generation-time verification (prevent new bad ACs):**
- [ ] **Q0.5/A1** Ship `server/validation/ac-lint.ts` + shared rules file + `forge_plan` wiring + `forge_evaluate` wiring + CI step
- [ ] **Q0.5/A2** Critic rule parity via shared import from `server/lib/prompts/shared/ac-subprocess-rules.ts`
- [ ] **Q0.5/A3** Add `CriterionResult.reliability: "trusted"|"suspect"|"unverified"` field; divergence mode splits real vs suspect failures

**Layer B — Authoring-time smoke verification:**
- [ ] **Q0.5/B1** Add `forge_evaluate(mode: "smoke-test")` — characterize each AC's exit/timing/hang behavior at authoring time

**Layer C — Enforcement & retroactive sweeping (the leverage layer):**
- [ ] **Q0.5/C1** Build `.github/workflows/retroactive-critique.yml` — re-runs critic on all plans when prompt/lint rules change; blocks merge on drift
- [ ] **Q0.5/C2** Reactivate `flaky` field in `execution-plan.ts:25` (close shelved-for-future-use anti-pattern — no formal ID; retracted 2026-04-13, see hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502)
- [ ] **Q0.5/C3** `/ship` plan-refresh gate — SHARED with Q0/L1, counted once

**Knowledge capture (already done this session):**
- [x] hive-mind-persist entries P62 + P63 + shelved-for-future-use anti-pattern proposal (later retracted 2026-04-13, see hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502) + case study `2026-04-12-forge-harness-ac-trust-boundary.md`
- [x] Mark `2026-04-10-ac-authoring-guidelines.md` as SUPERSEDED (per P60)

### Q1 — Mechanical PH01-US-06 AC rewrite

- [ ] **Q1.1** Rewrite 4 bad ACs (AC01/AC02/AC03/AC06) to exit-code-only or `--reporter=json` form
- [ ] **Q1.2** Re-run `forge_evaluate` divergence mode on PH-01 → 0 forward failures
- [ ] **Q1.3** Audit PH-02/03/04 phase plans for the same grep patterns

> **Note:** If Q0.5 ships first, Q1 collapses to "approve the auto-generated rewrite PR from Q0.5/C1's drift report." Q1 becomes a rubber-stamp, not a manual edit.

### Q3 — Triage open GitHub issues

- [ ] **Q3.1** #149 OAuth 401 — post decision comment (recommend: codify session-does-LLM as official pattern)
- [ ] **Q3.2** #150 Coherence mode — implement `coherenceFindings` input mirroring `reverseFindings` shape
- [ ] **Q3.3** #152 Parse-failure status — surface JSON parse errors as distinct `PARSE_FAILED` status

### Q2 — Calibration loop (dogfood-driven)

- [ ] **Q2.1** Refresh calibration plan to reference dogfood corpus as primary input
- [ ] **Q2.2** Build dogfood corpus index (`.ai-workspace/calibration/*-corpus.json`) from 5 existing dogfood JSONs
- [ ] **Q2.3** Score forge_plan outputs from PH-01..PH-04 via `/double-critique` (≥4 plans)
- [ ] **Q2.4** forge_generate brief-vs-reality diff for PH-01..PH-04
- [ ] **Q2.5** forge_coordinate retrodiction: `assessPhase` verdicts vs actual next-phase ship-review findings
- [ ] **Q2.6** forge_evaluate false-negative rate per phase (direct measurement after Q0.5/A1)
- [ ] **Q2.7** Publish per-primitive scorecard
- [ ] **Q2.8** Promote ≥1 calibration finding to hive-mind-persist

---

## Dependency sketch

```
Forge-harness track:                Meta track (independent, parallel):
                                    
Q4 (done)                           M1 — run /project-index baseline
 │                                   │
 ├─► Q0 ─┐                           ├─► M2/M3 (only if M1 insufficient)
 │       ├─► Q1 (auto-fixed)         │
 └─► Q0.5┘      │                    └─► M4 (CLAUDE.md enforcement)
                ├─► Q3 (triage)              │
                │   (#150 impl,               └─► M5 (measurement loop)
                │    #149+#152 decisions)           │
                └─► Q2 (last)                       └─► M7 (graduation protocol)
                                                             │
                                                             └─► M6 (rename cleanup — last, own PR)
```

**Hard rules:**
1. **Forge-harness:** Q2 does not start until Q0, Q0.5, and Q1 are all done. Calibrating against an untrustworthy ruler contaminates every scorecard with unremovable error.
2. **Meta track:** M1 must run before M2/M3 (empirical test gates skill extension). M4+M5 must ship together (enforcement and measurement are inert apart). M6 is a cross-cutting rename — deserves its own PR, not mid-session.
3. **Cross-track:** The two tracks are independent. Forge-harness Q0/Q0.5 do not block meta M1-M5, and vice versa. If both sessions run in parallel, the meta track may actually *accelerate* the forge-harness work by catching pattern-violation near-misses in it.

---

## Links

### Forge-harness track
- **Detailed implementation plan:** `.ai-workspace/plans/2026-04-12-next-execution-plan.md`
- **Root-cause diagnosis (both findings):** `.ai-workspace/audits/2026-04-12-divergence-false-negatives-diagnosis.md`
- **Hive-mind case study:** `C:/Users/ziyil/coding_projects/ai-brain/hive-mind-persist/case-studies/2026-04-12-forge-harness-ac-trust-boundary.md`
- **New proven patterns:** P62 (trust boundaries), P63 (retroactive re-critique) — in `hive-mind-persist/knowledge-base/01-proven-patterns.md`
- **Anti-pattern (proposal retracted 2026-04-13):** shelved-for-future-use / reserved-for-future-use dead code — originally proposed as a new F-entry, later retracted; no formal ID ever landed. See retraction at `hive-mind-persist/proposals/cairn/2026-04-13-cairn-charter.md:502`

### Meta track
- **Full proposal:** `C:/Users/ziyil/coding_projects/ai-brain/hive-mind-persist/proposals/2026-04-12-hive-mind-indexing.md`
- **Trigger evidence:** `hive-mind-persist/memory.md` 2026-04-12 entry (discoverability near-miss)
- **Candidate pattern pending graduation:** *"Pull-based knowledge bases need a pre-decision navigation artifact"* — will graduate if M5 measurement shows ≥3 index-hits + ≥1 attributed memory.md entry + zero recurrence of the manual-artifact-before-skill near-miss
- **Target skill:** `~/.claude/skills/project-index/SKILL.md`
