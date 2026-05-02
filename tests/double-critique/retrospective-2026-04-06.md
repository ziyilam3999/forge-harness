# Double-Critique Retrospective -- 2026-04-06

**Run:** R21 (Build Three-Tier Document System Into forge_plan)
**Effectiveness report:** `tests/double-critique/effectiveness-2026-04-06.md`
**Memory file:** `hive-mind-persist/memory.md`
**Prior retrospective:** `tests/double-critique/retrospective-2026-04-05-r2.md` (R20)

---

## What is this report?

This is a team retrospective covering 12 pipeline runs (R10-R21). R21 processed a fresh 9-decision architectural plan for a three-tier document system. The key headline: the Drafter posted 0 regressions on a complex first-pass document for the first time, while Corrector-1 reverted to 1 regression, confirming R20's 0 was anomalous.

---

## KEEP

- **Researcher front-loading** -- The Researcher reads the codebase, verifies claims, and surfaces gaps before anyone else touches the document. R21: 15+ verified claims, 1 CRITICAL, 4 MAJORs, 7 failure-mode gaps, 2 unjustified decisions. The Researcher's gap identification gave the Drafter a concrete fix list, likely contributing to the 0-regression result. -- Evidence: 4 of the last 5 runs had 0-1 CRITICALs (R18: 0, R19: 0, R20: 0, R21: 1 meta-level). Historical CRITICAL mean was ~1.5/run. R21's CRITICAL was a missing-outcome-AC, not a design-breaking flaw. -- Action: keep current Researcher thoroughness level.

- **Dual-critique complementarity** -- Two independent critics find completely different problems. -- Evidence: 5 consecutive runs (R17-R21) with zero finding overlap. R21: Critic-1 caught analytical/specification gaps (calibration protocol, context precedence, plan degradation, success criteria); Critic-2 caught implementation-detail errors (callClaude count, evaluate.ts architecture, tier misclassification). -- Action: no change. Graduated KB pattern working as designed.

- **Corrector-2 zero-regression streak** -- 21/21 runs at zero regressions. R21: applied 7 findings + 2 self-caught + 2 independent re-verifications. -- Action: solved invariant; continue enforcing, stop analyzing.

- **Evidence-gating protocol** -- 12/12 runs at 100% compliance, zero fabricated claims ever. -- Action: solved invariant; continue enforcing, stop analyzing.

- **Net zero regressions in final output** -- 12/12 runs. R21: 1 Corrector-1 regression caught by Critic-2 and fixed by Corrector-2. -- Action: no change.

- **Novelty-flag tagging discipline on structured plans** -- When the Drafter achieves 100% novelty-flag compliance, Drafter regressions drop to 0. -- Evidence: R18 (100% flags, 2 regs -- but regs were on a different document type), R19 (100% flags, 0 regs), R21 (100% flags, 0 regs). Counter-evidence: R20 (76.9% flags, 3 regs -- 100% of unflagged claims were regressions). The flag mechanism is both a self-awareness check and a regression predictor. -- Action: reinforce the NEW_CLAIM instruction; the correlation between compliance and regression rate is the strongest behavioral signal in the pipeline.

---

## CHANGE

- **Corrector-1 multi-pass review (escalate to implementation)** -- The SIDE-EFFECT-CHECK protocol was tested in R20 (0 regressions) and R21 (1 regression). With one pass and one fail, the protocol is not reliably effective. The Corrector-1 regression rate is structurally locked: 6 different error classes across 7 runs (R15-R21, excluding R20). No instruction-level intervention addresses all classes. -- Evidence: R21 regression (over-correction judgment) occurred despite SIDE-EFFECT-CHECK being active. Historical: platform, cross-reference, self-review arithmetic, arithmetic propagation, analytical judgment, over-correction judgment. Each class requires different cross-section awareness. -- Action: implement the multi-pass review protocol (process change #11 from memory.md). After applying each fix: (a) re-read the surrounding section for consistency, (b) re-read any section referenced by the modified section, (c) check that the fix does not create a new failure mode. This is a structural change, not another instruction.

- **Process change forcing function (6th retrospective recommending consistency gate)** -- The Drafter consistency gate has been recommended in R16, R17, R18, R19, R20, and now R21 -- 6 consecutive retrospectives. R21's 0 Drafter regressions may reduce the urgency, but this is a single data point against 5 runs with 2-3 regressions each on complex documents. -- Evidence: Discovery #25 (process change debt accumulates). The forcing function proposed in R20 (overdue-after-N-retros escalation) also remains unimplemented. -- Action: demote consistency gate priority from HIGH to MEDIUM given R21's evidence that novelty-flag compliance may be the more effective lever. But implement the forcing function itself (process change #13): changes overdue by 3+ retros get elevated to mandatory-before-next-run status. Apply this retroactively: the novelty-flag redesign (5 retros overdue) becomes mandatory before R22.

- **Novelty-flag enforcement approach** -- The instruction-based approach has failed to converge to stable 100% after 11 tracked runs. However, R21's 100% on a complex document weakens the case for full redesign. -- Evidence: R21 achieved 100% on a 9-decision plan (same complexity class where R20 dropped to 76.9%). The series (0/90/100/N-A/100/75/0/100/100/77/100) still oscillates but R21 is the first 100% on a fresh complex document since R15. -- Action: defer full structural redesign. Instead, add the Drafter novel-claim audit step (process change #12): after completing all edits, Drafter must list every claim it added that was NOT in Researcher output or source document, and tag each as NEW_CLAIM. This is a prompt-level enhancement that addresses the gap without requiring diff-based tooling. If R22 also hits 100%, consider the problem adequately addressed by instruction improvement rather than structural redesign.

---

## ADD

- **Corrector-1 regression classification tracking** -- Each Corrector-1 regression should be tagged with its error class in the extraction report and logged in memory.md with the full class list. This makes it possible to detect if a process change addresses a specific class without regressing others. -- Evidence: R15-R21 produced 6 different error classes (platform, cross-reference, self-review arithmetic, arithmetic propagation, analytical judgment, over-correction judgment). The multi-pass review protocol is designed to address cross-reference and over-correction classes but may not address arithmetic or platform classes. Tracking by class enables targeted evaluation. -- Action: add class tagging to the Stage 8 extractor template for Corrector-1 regressions.

- **Drafter regression correlation with novelty-flag compliance** -- Track the co-occurrence of novelty-flag compliance and Drafter regression count as a first-class metric. -- Evidence: R20 (76.9% flags, 3 regs -- all unflagged), R21 (100% flags, 0 regs), R19 (100% flags, 0 regs). The correlation is the strongest behavioral predictor in the pipeline. If this holds for 1 more run, it should graduate as a candidate pattern. -- Action: add to Derived Metrics table in effectiveness reports.

---

## DROP

- **Nothing to drop.** All 6 stages produced unique value in R21 (no stage rated below MEDIUM). The two solved invariants (evidence-gating, Corrector-2 regressions) continue to be reported as single lines rather than analyzed.

---

## NEW PATTERNS

### 100% novelty-flag compliance correlates with 0 Drafter regressions on complex documents

- **What:** When the Drafter tags all novel claims with NEW_CLAIM, it produces 0 regressions even on complex first-pass documents. When compliance drops below 100%, unflagged claims become regressions.
- **Why:** The NEW_CLAIM tag forces the Drafter to consciously recognize when it is inventing rather than integrating. This self-awareness triggers more careful scrutiny of novel claims. Unflagged claims bypass both the Drafter's self-review and critics' targeted scrutiny.
- **Evidence:** R19 (100% flags, 0 regs, pre-critiqued), R21 (100% flags, 0 regs, fresh complex). R20 (76.9% flags, 3 regs, fresh complex -- all 3 unflagged). R16 (75% flags, 2 regs -- 1 unflagged). Combined: 5/5 unflagged novel claims across R16/R20 were defective. 0 regressions in runs with 100% compliance (R18, R19, R21 -- though R18 had 2 regs from a different mechanism).
- **Status:** 3 data points for the specific claim (R19, R20, R21). Needs 1 more run to meet stability threshold. The confound with R18 (100% flags but 2 regs) weakens the universal claim; the correlation may hold specifically for novel-claim-driven regressions rather than all regressions.
- **Analogy:** Like a pilot using a preflight checklist. When every item is checked, the flight proceeds safely. When the pilot skips items "because I know this plane," the skipped items are exactly the ones that cause the problem.

### Corrector-1 regression classes are non-overlapping across runs

- **What:** Each Corrector-1 regression across 7 runs belongs to a different error class (platform, cross-reference, self-review arithmetic, arithmetic propagation, analytical judgment, over-correction judgment). No class has recurred.
- **Why:** The Corrector-1 self-review mechanism catches each class of error once (after the first failure triggers awareness), but does not generalize to new classes. Each new run presents a novel context that produces a novel regression class.
- **Evidence:** 6 different classes across 7 runs (R15-R21, R20 = 0). Zero class repetition.
- **Status:** 6 data points. Meets stability threshold but may not meet generalizability (pipeline-specific).
- **Implication:** Instruction-level fixes that target a specific class (e.g., "recount bullets") prevent that class from recurring but do not reduce the overall regression rate because a new class emerges. Only a structural fix (multi-pass review with explicit cross-section checks) can address the root cause.

---

## NEW ANTI-PATTERNS

### SIDE-EFFECT-CHECK is insufficient for judgment-class regressions

- **What:** The SIDE-EFFECT-CHECK protocol (explicit check for unintended consequences after each fix) prevents mechanical regressions (arithmetic, cross-reference) but not judgment regressions (over-correction, analytical misclassification).
- **Why:** SIDE-EFFECT-CHECK asks "did I break anything that was working?" This catches mechanical errors (a number changed, a reference became dangling). But judgment errors (converting a repeating reminder to a single reminder because "spam is bad") are intentional changes that pass the SIDE-EFFECT-CHECK because the corrector believes the change is an improvement, not a side effect.
- **Evidence:** R20: 0 regressions with SIDE-EFFECT-CHECK (would have caught mechanical errors but none occurred). R21: 1 regression with SIDE-EFFECT-CHECK (judgment-class error that the corrector intentionally made, not accidentally).
- **Implication:** The multi-pass review protocol must include not just "did I break something?" but also "did my fix remove any specified behavior?" -- a broader question that catches over-corrections.

---

## Candidate Pattern Updates

| ID | Pattern | Data Points | Status |
|----|---------|:-----------:|--------|
| P-R16-3 | Researcher front-loading reduces CRITICAL density | 8 (R14-R21) | R21 adds 8th data point (1 meta-CRIT, not design-breaking). Still blocked on cross-project generalizability. |
| P-R16-2 | Drafter regression correlates with decision count | 8 (R12-R21) | R21 (0 regs, 9 decisions) weakens the correlation. May need to be refined: correlates with decision count WHEN novelty-flag compliance < 100%. |
| P-R20-1 | Unflagged novel claims predict regressions (100% defect rate) | 3 (R16, R20, R21-by-absence) | R21 adds counter-evidence: 0 unflagged = 0 regressions, consistent with P-R20-1. Still need 1 more positive data point (unflagged claim that IS defective). |
| P-R20-2 | SIDE-EFFECT-CHECK breaks Corrector-1 regression streak | 1 positive (R20), 1 negative (R21) | R21 disproves the pattern. SIDE-EFFECT-CHECK does not reliably prevent regressions. Downgrade to NAP (not a pattern). |
| P-R21-1 | 100% novelty-flag compliance -> 0 Drafter regressions on complex docs | 2 (R19, R21) + 1 counter (R20) | New candidate. Need 1 more data point. R18 (100% flags, 2 regs) is a confound -- those regs may not have been novel-claim-driven. |
| P-R21-2 | Corrector-1 regression classes are non-overlapping | 6 (R15-R21 excl R20) | 6 data points. Meets stability. Pipeline-specific (fails generalizability). |
| NAP-R21-1 | SIDE-EFFECT-CHECK insufficient for judgment-class regressions | 2 (R20: pass, R21: fail) | New anti-pattern candidate. Need 1 more data point. |

---

## KB Graduation Check

Criteria: 3+ runs, measured numbers, generalizable.

| Candidate | Stability | Evidence | Generalizable | Verdict |
|-----------|:---------:|:--------:|:-------------:|---------|
| P-R16-3 (Researcher front-loading) | 8 runs | CRITs: 2,1,1,2,0,0,0,1 vs claims: 15,12,14,14,21,24,11,15+ | Blocked -- all data from forge-harness + hive-mind, but only forge-harness has the thorough Researcher | NO -- needs cross-project data |
| P-R20-1 (Unflagged novel claims predict regressions) | 3 (R16, R20, R21-absence) | 5/5 unflagged claims defective | Potentially generalizable -- applies to any multi-stage review pipeline | CLOSE but R21 is absence-evidence, not positive. Need 1 more positive data point. |
| P-R21-1 (Novelty-flag -> 0 Drafter regs) | 2 positive | 0 regs at 100% flags (R19, R21); 3 regs at 77% (R20) | Potentially generalizable | NO -- only 2 positive data points |
| P-R21-2 (Corrector-1 class non-overlap) | 6 | 6 distinct classes | Pipeline-specific | NO -- fails generalizability |

**No KB graduations this run.** Closest candidate: P-R20-1 (unflagged novel claims predict regressions) at 3 data points with measured evidence but needs 1 more positive data point (an actual unflagged claim that is defective, not just the absence of unflagged claims coinciding with 0 regressions).

---

## Process Changes Queued (Updated Priority)

| # | Change | Retros Overdue | Priority | Status |
|---|--------|:--------------:|----------|--------|
| 2 | Drafter consistency gate (5+ decisions -> consistency matrix) | 6 (R16-R21) | MEDIUM (demoted from HIGH; R21 suggests novelty-flag compliance may be the better lever) | Not started |
| 5 | Novelty-flag structural redesign (diff-based detection) | 5 (R17-R21) | LOW (demoted; R21 instruction-level approach succeeded on complex doc) | Not started |
| 11 | Corrector-1 multi-pass review protocol | 3 (R19-R21) | HIGH (SIDE-EFFECT-CHECK proven insufficient) | Not started |
| 12 | Drafter novel-claim self-audit step | 2 (R20-R21) | HIGH (addresses both novelty-flag and regression gaps) | Not started |
| 13 | Process change forcing function (overdue-after-N escalation) | 2 (R20-R21) | HIGH (6 retros of consistency gate recommendations prove the need) | Not started |
| 14 | Corrector-1 regression class tagging in extractor | NEW (R21) | MEDIUM | Not started |
| 15 | Drafter regression / novelty-flag co-occurrence tracking | NEW (R21) | MEDIUM | Not started |
