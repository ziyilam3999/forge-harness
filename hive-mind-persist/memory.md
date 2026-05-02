# Double-Critique Pipeline Memory (Sticky Notes)

> Short-lived observations, candidate patterns, and run-specific data awaiting KB graduation.
> Entries graduate to knowledge-base files when they meet: stability (3+ runs), evidence (measured numbers), generalizability (applies beyond double-critique).

---

## DISCOVERIES

1. **R15 confirms double-critique pipeline generalizes to feature-build plans on forge-harness.** R14 tested greenfield scaffold; R15 tested feature build on existing scaffold. R15: 17 findings (1 CRITICAL), 100% application rate, 1 Corrector-1 regression (platform compat), 0 Drafter regressions. Pipeline requires no project-specific or document-type tuning. Round 2 regression check fired on Corrector-1's `/dev/stdin` Windows incompatibility. (double-critique Run 15, forge-harness)

2. **Feature-build plans produce ~35% fewer findings than greenfield scaffold plans on the same project.** R14 (greenfield): 26 findings. R15 (feature build): 17 findings. Same project (forge-harness), same pipeline configuration. Architectural constraints from the existing scaffold reduce the decision surface area. 1 paired comparison -- monitor. (double-critique Run 15, extends R14 greenfield-density observation)

3. **Corrector-2 zero-regression streak extended to 16/16 runs.** R16: 7 applied, 1 correctly rejected, 0 regressions. (P56, double-critique Run 16)

4. **Evidence-gating at 100% with 0 fabrication -- 7th consecutive data point.** R16 adds to P55: R9(82%,3fab), R10(100%,0), R11R(100%,0), R12(95%,0fab), R13(100%,0), R14(100%,0), R15(100%,0), R16(100%,0). (P55, double-critique Run 16)

5. **Novelty-flag compliance dropped to 75% in R16, resetting stability counter.** Progression: 0% (R11R) -> 90% (R12) -> 100% (R13) -> N/A (R14) -> 100% (R15) -> 75% (R16). The unflagged claim was a specification-level detail (evidence concat order), not a design-level one. The instruction needs scope expansion to cover implementation-detail-level novel claims. (double-critique Run 16)

6. **Feature-build plan metrics stabilize by the 2nd run on a project.** R15 and R16 are identical: 17 findings, 1/8/8 severity, 94-100% application rate. After the greenfield run (R14: 26 findings), feature-build runs converge to a stable baseline. 2 data points -- need 1 more. (double-critique Runs 15-16, forge-harness)

7. **Drafter regression rate correlates with document complexity.** R16: 2 regressions on a 12-decision document (D1-D12). R14-R15: 0 regressions on simpler documents. R12-R13 (hive-mind, complex): 3 and 6 regressions. The Drafter's integration pass breaks down when decisions interact across 5+ specifications. 5 data points. (double-critique Runs 12-16)

8. **Researcher front-loading reduces CRITICAL density -- 3 forge-harness data points.** R14: 2 CRITs (13%), R15: 1 CRIT (6%), R16: 1 CRIT (6%). Historical mean: 15%. In all 3 runs, the Researcher resolved design-level issues before critics engaged. Meets stability (3 runs) but NOT generalizability (same project). Need cross-project data. (double-critique Runs 14-16, forge-harness)

9. **Corrector blind-spot on the section being edited -- 2 data points.** R16: Corrector-1 propagated D4/D11 contradiction while editing D4. R15: Corrector-1 introduced `/dev/stdin` while fixing AC-15's section. Correctors are most likely to regress in the exact section they're modifying because attention narrows to the critic's finding. (double-critique Runs 15-16)

10. **Drafter TC regression correlation -- 6th data point.** R16 (includes-TCs, 12 decisions): 2 regressions. Continues the pattern: runs with TCs/complex content have higher Drafter regression rates. Confound with document complexity remains unresolved. (NAP-3, double-critique Run 16)

11. **Pipeline generalizes to prose documents (root cause analysis) without instruction changes.** Critics adapted from spec-gap hunting to causal-reasoning critique. (R17)

12. **Novelty-flag compliance crashed to 0% on prose document.** 7-run series shows no convergence: 0->90->100->N/A->100->75->0%. Instruction-based approach appears fundamentally non-convergent. (R17)

13. **Evidence-gating at 100% for 8th consecutive run. Corrector-2 at zero regressions for 17th consecutive run.** Both are solved invariants -- stop monitoring, continue enforcing. (R17)

14. **Arithmetic/counting errors are a systematic blind spot for Drafter and Corrector-1.** R18: 3 of 6 MAJORs were counting errors (header vs bullet mismatches, tier tally mismatches). Drafter does not count bullets against headers. Corrector-1's side-effect checks replay header numbers instead of recounting actual items, creating a self-referential closed loop that propagates errors. (R18)

15. **Evidence-gating at 100% for 9th consecutive run. Corrector-2 at zero regressions for 18th consecutive run.** (R18, extends #13)

16. **Critic rounds are complementary, not redundant.** R18: Critic-1 found qualitative issues (tier labels, policy, correctness hazards), Critic-2 found quantitative issues (counting, arithmetic). Zero finding overlap. 2nd explicit data point (R17, R18). (R18)

17. **Pre-critiqued input documents suppress CRITICALs and Drafter regressions.** R19 processed a document already through R17 + R18. Result: 0 CRITICALs (2nd consecutive), 0 Drafter regressions (breaking 3-run streak of 2/run). The Drafter's decision surface is reduced when input has already been critiqued. 1 data point -- confounds P-R16-3 and Drafter complexity correlation. (R19)

18. **Corrector-1 regression rate is a capacity ceiling at exactly 1 per run.** R15-R19: 5 consecutive runs with exactly 1 Corrector-1 regression, each a different class (platform, cross-reference, self-review arithmetic, arithmetic propagation, analytical judgment). No single process fix addresses all classes. The single-pass correction mechanism is fundamentally capacity-limited. (R19)

19. **Critic complementarity reaches stability threshold (3 consecutive runs, 0 overlap).** R17, R18, R19: zero finding overlap. Critic-1 consistently finds analytical/framing issues; Critic-2 consistently finds evidence/arithmetic/consistency issues. Observed across prose (R17), structured classification (R18), and merged analytical report (R19). **GRADUATED to KB.** (R19)

20. **Evidence-gating at 100% for 10th consecutive run. Corrector-2 at zero regressions for 19th consecutive run.** (R19, extends #15)

21. **Evidence-gating at 100% for 11th consecutive run. Corrector-2 at zero regressions for 20th consecutive run.** (R20, extends #20)

22. **Unflagged novel claims are a perfect regression predictor.** R20: 3 unflagged novel claims, all 3 were Drafter regressions (100% match). R16: 1 unflagged novel claim was also a regression. Combined: 4/4 unflagged novel claims were defective across 2 runs. The NEW_CLAIM flag functions as a self-awareness check -- when the Drafter does not realize it is inventing, the invention is wrong. (R20)

23. **Drafter regression rate is input-driven: complex first-pass documents produce 2-6 regressions, pre-critiqued or simple documents produce 0.** R20 (fresh architectural plan): 3 regressions. R19 (pre-critiqued): 0. Historical: complex first-pass mean 3.0, simple/pre-critiqued mean 0.0. No overlap between groups. Extends Discovery #7 with clean bimodal split. (R20)

24. **SIDE-EFFECT-CHECK protocol coincides with first Corrector-1 zero-regression result in 5 runs.** R20: 0 Corrector-1 regressions, breaking the R15-R19 streak of exactly 1/run. Only 3rd time in 10 tracked runs (R11R, R14, R20). Single data point -- cannot distinguish signal from noise. (R20)

25. **Process change debt accumulates: Drafter consistency gate recommended in 5 consecutive retrospectives (R16-R20), never implemented.** The same regression pattern (2-3 regressions on complex documents) recurs each time. Novelty-flag redesign recommended in 4 consecutive retrospectives (R17-R20), also unimplemented. Retrospectives become a record of repeated advice rather than a driver of improvement. (R20)

26. **Evidence-gating at 100% for 12th consecutive run. Corrector-2 at zero regressions for 21st consecutive run.** (R21, extends #21)

27. **100% novelty-flag compliance correlates with 0 Drafter regressions on complex first-pass documents.** R21: 9-decision architectural plan, 100% novelty-flag compliance, 0 Drafter regressions. R20: same complexity class, 76.9% compliance, 3 regressions (all unflagged). R19: 100% compliance, 0 regressions (pre-critiqued). Combined with Discovery #22: the NEW_CLAIM tag forces conscious self-awareness of novel claims, which triggers more careful scrutiny. 2 positive data points on complex docs (R19, R21), 1 counter-evidence (R20). Need 1 more data point. (R21)

28. **SIDE-EFFECT-CHECK protocol does NOT reliably prevent Corrector-1 regressions.** R20: 0 regressions (SIDE-EFFECT-CHECK active). R21: 1 regression (SIDE-EFFECT-CHECK also active). The regression was a judgment-class error (over-correction of reminder frequency), which passes SIDE-EFFECT-CHECK because the corrector intentionally made the change. SIDE-EFFECT-CHECK catches mechanical errors (broken references, wrong numbers) but not judgment errors (over-corrections, misclassifications). Invalidates Discovery #24. (R21)

29. **Corrector-1 regression classes are non-overlapping: 6 different error classes across 7 runs.** R15: platform, R16: cross-reference, R17: self-review arithmetic, R18: arithmetic propagation, R19: analytical judgment, R21: over-correction judgment. R20: 0 (anomaly). Each class occurs once and never recurs. The Corrector-1 self-review mechanism catches each class after the first failure but does not generalize to new classes. Pipeline-specific (fails generalizability for KB graduation). (R21)

30. **Drafter regression correlation with decision count may be moderated by novelty-flag compliance.** R21 (9 decisions, 100% flags, 0 regressions) breaks the pattern from R12-R20 where complex first-pass docs always produced 2-6 regressions. The previously clean bimodal split (Discovery #23) may need refinement: complex + low novelty-flag compliance -> 2-6 regressions; complex + 100% novelty-flag compliance -> 0 regressions. 1 data point for the refined claim. (R21, refines #23)

31. **Evidence-gating at 100% for 13th consecutive run. Corrector-2 at zero regressions for 22nd consecutive run.** (R22, 2026-04-08, extends #26)

32. **Semantic verification mismatch is a new evidence-gating failure class.** R22 Corrector-1 cited real lines from handleCoherenceEval (evaluate.ts:200-217) to verify a claim about handleStoryEval behavior. Format compliance was 100% (VERIFIED tag, file path, line numbers all present), but the conclusion was wrong -- the wrong code path was examined. First instance since R12 where evidence-gating produced a false conclusion. R17's arithmetic self-review false positive was the same class (mechanical compliance masking semantic error). 2 data points. (R22, 2026-04-08)

33. **Corrector-1 regressions spiked to 2, highest since R13, adding 2 new error classes.** R22 regressions: (1) feasibility propagation (passed through infeasible auto-detection feature without checking feasibility), (2) scope understatement (characterized US-00 as "mechanical" one-liner requiring ~25 lines of RunContext infrastructure). SIDE-EFFECT-CHECK was active for both. 8 distinct error classes now observed across 8 runs (R15-R22 excl R20). (R22, 2026-04-08, extends #29)

34. **Unflagged novel claims predict regressions -- 4th positive data point, graduation-ready.** R22: 3 unflagged novel claims (phase auto-detection, readAuditEntries move, US-00 scope characterization). The most consequential (US-00 scope) became the pipeline's CRITICAL. Combined across R16, R20, R22: 7/7 unflagged novel claims were defective. R18, R19, R21 at 100% compliance had 0 novel-claim-driven regressions. Pattern P-R20-1 now meets all 3 KB graduation criteria (4 runs, measured 100% defect rate, generalizable beyond double-critique). (R22, 2026-04-08, extends #22 and #27)

35. **SIDE-EFFECT-CHECK trending worse, not better.** R20: 0 regressions (active). R21: 1 regression (active). R22: 2 regressions (active). Both R22 regressions were judgment-class errors the protocol cannot catch. NAP-R21-1 now meets stability threshold (3 data points). SIDE-EFFECT-CHECK should be subsumed into the multi-pass review protocol, not tracked independently. (R22, 2026-04-08, extends #28)

36. **Process change debt at 7-8 retrospectives for top items.** Drafter consistency gate: 7 retros (R16-R22). Novelty-flag redesign: 6 retros (R17-R22). Corrector-1 multi-pass review: 4 retros (R19-R22). The forcing function (#13) itself has been recommended for 3 retros (R20-R22). Three process changes (#11, #12, #13) are now classified MANDATORY for R23 under the 3+ retros at HIGH rule. (R22, 2026-04-08, extends #25)

---

## CANDIDATE PATTERNS (awaiting graduation)

| ID | Pattern | Data Points | Blocker |
|----|---------|:-----------:|---------|
| P-R16-1 | Feature-build metrics stabilize by 2nd run | 2 (R15, R16) | Need 1 more run or 2nd project |
| P-R16-2 | Drafter regression correlates with decision count | 5 (R12-R16) | "Complexity" not operationalized |
| P-R16-3 | Researcher front-loading reduces CRITICAL density | 3 forge-harness + 1 hive-mind | Need cross-project generalizability |
| NAP-R16-1 | Corrector blind-spot on section being edited | 2 (R15, R16) | Need 1 more data point |
| NAP-R16-2 | Novelty-flag compliance oscillates (not monotonic) | 5 enabled runs | May resolve with instruction expansion |
| NAP-3 | Drafter TC regression correlation | 6 (R10-R16) | Confound with complexity unresolved |
| P-R18-1 | Critic complementarity (qualitative R1 / quantitative R2) | 2 (R17, R18) | Need 1 more data point |
| NAP-R18-1 | Corrector-1 side-effect checks are self-referential | 3 (R16, R18, R19) | Subsumed by capacity-ceiling finding (#18) |
| NAP-R18-2 | Novelty-flag compliance is document-type-dependent | 9 (R11R-R19) | Pipeline-specific (fails generalizability) |
| P-R19-1 | Pre-critiqued input suppresses CRITICALs + Drafter regressions | 1 (R19) | Need 2 more runs |
| P-R19-2 | Corrector-1 regression rate is capacity ceiling (1/run) | 5 (R15-R19), broken by R20 | May no longer hold; SIDE-EFFECT-CHECK may have changed dynamics |
| P-R20-1 | Unflagged novel claims predict regressions (100% defect rate) | 3 (R16, R20, R21-absence) | Need 1 more positive data point (R21 is absence-evidence) |
| P-R20-2 | SIDE-EFFECT-CHECK breaks Corrector-1 regression streak | INVALIDATED by R21 | R21: 1 regression with SIDE-EFFECT-CHECK active. Downgrade to NAP. |
| P-R21-1 | 100% novelty-flag compliance -> 0 Drafter regressions on complex docs | 2 (R19, R21) + 1 counter (R20) | Need 1 more data point |
| P-R21-2 | Corrector-1 regression classes are non-overlapping | 6 (R15-R21 excl R20) | Pipeline-specific (fails generalizability) |
| NAP-R21-1 | SIDE-EFFECT-CHECK insufficient for judgment-class regressions | 3 (R20, R21, R22) | **Meets stability threshold** |
| P-R22-1 | Semantic verification mismatch (format-correct, meaning-wrong) | 2 (R17, R22) | Need 1 more data point |

### R17 Pattern Updates

- 2026-04-04: R17 confirms dual-critique pattern catches CRITICALs that earlier stages miss (2/2 CRITICALs from critics). Now observed in R15, R16, R17. (P5 update)

### R18 Pattern Updates

- 2026-04-04: R18 is the first run with 0 CRITICALs in the tracked series. Researcher verified 21 claims (most thorough pass). Correlation: more Researcher claims = fewer CRITs (R14:15/2, R15:12/1, R16:14/1, R17:14/2, R18:21/0). P-R16-3 now has 5 data points; blocked only on cross-project generalizability.
- 2026-04-04: Critic-1 and Critic-2 had zero finding overlap in R18. Critic-1: qualitative (tier labels, policy, correctness hazards). Critic-2: quantitative (counting, arithmetic, consistency). 2nd explicit data point for complementarity pattern.
- 2026-04-04: Novelty-flag compliance recovered to 100% (4/4 NEW_CLAIM tags). Full progression: 0%->90%->100%->N/A->100%->75%->0%->100%. Still oscillating; appears document-type-dependent (100% on structured plans, 0% on prose).

### R20 Pattern Updates

- 2026-04-05: R20 is the 3rd consecutive run with 0 CRITICALs (new record). Fresh architectural plan, not pre-critiqued. Researcher surfaced 4 MAJORs and 10 failure-mode gaps with 11 verified claims. P-R16-3 now has 7 data points; still blocked on cross-project generalizability.
- 2026-04-05: Critic complementarity extends to 4th consecutive run with 0 overlap (R17-R20). Critic-1: security/trust model gaps. Critic-2: platform-specific correctness, missing test coverage. Graduated pattern continues to hold.
- 2026-04-05: Drafter regressions spiked to 3 (highest since R13). All 3 were unflagged novel claims. Confirms P-R16-2 (complexity correlation) on fresh input. New candidate: unflagged novel claims predict regressions (P-R20-1, 2 data points).
- 2026-04-05: Corrector-1 regressions dropped to 0, breaking 5-run streak of 1/run. SIDE-EFFECT-CHECK protocol active. P-R19-2 (capacity ceiling) may no longer hold. New candidate P-R20-2.
- 2026-04-05: Novelty-flag compliance dropped to 76.9% (from 100% in R18-R19). Resets stability counter again. Full progression: 0%->90%->100%->N/A->100%->75%->0%->100%->100%->76.9%. Instruction-based approach confirmed non-convergent (NAP-R18-2, 10 data points).
- 2026-04-05: Evidence-gating 100% (11th consecutive). Corrector-2 zero regressions (20/20).

### R21 Pattern Updates

- 2026-04-06: R21 breaks the 3-run 0-CRITICAL streak with 1 CRITICAL (missing-outcome-AC, not design-breaking). Fresh 9-decision architectural plan. Researcher front-loading continues to suppress design-breaking flaws. P-R16-3 now has 8 data points; still blocked on cross-project generalizability. Correlation extended: R14:15/2, R15:12/1, R16:14/1, R17:14/2, R18:21/0, R19:24/0, R20:11/0, R21:15+/1(meta).
- 2026-04-06: Critic complementarity extends to 5th consecutive run with 0 overlap (R17-R21). Critic-1: analytical/specification gaps. Critic-2: implementation-detail correctness (callClaude count, evaluate.ts architecture, tier misclassification).
- 2026-04-06: Drafter regressions at 0 on a fresh complex document (9 decisions). First time this has happened on a complex first-pass document. Coincides with 100% novelty-flag compliance. New candidate P-R21-1. Weakens P-R16-2 (decision count correlation) -- may need novelty-flag compliance as a moderating variable.
- 2026-04-06: Corrector-1 regressions at 1 (over-correction judgment), confirming R20's 0 was anomalous. SIDE-EFFECT-CHECK protocol was active but did not prevent the judgment-class regression. P-R20-2 invalidated. New anti-pattern candidate NAP-R21-1.
- 2026-04-06: Novelty-flag compliance at 100% (4/4 NEW_CLAIM tags). Full progression: 0%->90%->100%->N/A->100%->75%->0%->100%->100%->76.9%->100%. R20 interrupts; strict 3-consecutive threshold still not met. But 4 of last 5 structured-plan runs are at 100%.
- 2026-04-06: Evidence-gating 100% (12th consecutive). Corrector-2 zero regressions (21/21).

### R22 Pattern Updates

- 2026-04-08: R22 produces the first semantically misleading verification in the pipeline. Corrector-1 cited real lines from the wrong handler (handleCoherenceEval instead of handleStoryEval) to verify a code-path claim. Mechanical compliance 100%, semantic accuracy <100%. New candidate P-R22-1 (2 data points with R17's arithmetic false positive).
- 2026-04-08: Corrector-1 regressions at 2 (highest since R13). New classes: feasibility propagation, scope understatement. 8 distinct classes across 8 runs. SIDE-EFFECT-CHECK active for both -- NAP-R21-1 confirmed (3 data points).
- 2026-04-08: Novelty-flag compliance at 70% (lowest since R17). Full progression: 0->90->100->NA->100->75->0->100->100->77->100->70. R21's demotion of structural redesign (#5) to LOW invalidated. 3 unflagged claims; most consequential became the CRITICAL. P-R20-1 now at 4 data points (7/7 unflagged claims defective). **Meets KB graduation criteria.**
- 2026-04-08: Critic complementarity extends to 6th consecutive run with 0 overlap (R17-R22). Critic-2 caught the CRITICAL + both Corrector-1 regressions. Graduated KB pattern continues to hold strongly.
- 2026-04-08: Drafter regressions at 1 (infeasible auto-detection feature). Coincides with 70% novelty-flag compliance. Adds supporting evidence for P-R21-1 inverse: <100% flags correlates with >0 regressions (R20: 77%/3, R22: 70%/1). 
- 2026-04-08: Evidence-gating 100% (13th consecutive). Corrector-2 zero regressions (22/22).
- 2026-04-08: Three process changes (#11, #12, #13) classified MANDATORY for R23 under the 3+ retros at HIGH rule. Process change forcing function is now self-referentially overdue.

### R19 Pattern Updates

- 2026-04-05: R19 is the 2nd consecutive run with 0 CRITICALs. Pre-critiqued input (R17+R18) confounds P-R16-3: cannot attribute 0 CRITs to Researcher alone. Researcher had 24 verified claims. Correlation extended: R14:15/2, R15:12/1, R16:14/1, R17:14/2, R18:21/0, R19:24/0. P-R16-3 now has 6 data points; still blocked on cross-project generalizability + confounded by pre-critiqued input.
- 2026-04-05: Critic complementarity at 3rd consecutive run with 0 overlap (R17-R19). **GRADUATED to KB.** Critic-1: analytical framing, reasoning rigor, structural weaknesses. Critic-2: evidence consistency, arithmetic, classification accuracy. Observed across 3 document types (prose, structured classification, merged analytical report).
- 2026-04-05: Corrector-1 regressions locked at exactly 1/run for 5 consecutive runs (R15-R19), each a different error class. Recorded as capacity ceiling (Discovery #18). No single fix addresses all classes.
- 2026-04-05: Drafter regressions dropped to 0 (from 3-run streak of 2/run). Coincides with pre-critiqued input. May be input-dependent, not process-dependent. New candidate pattern P-R19-1.
- 2026-04-05: Novelty-flag compliance at 100% for 2nd consecutive run (R18-R19). Needs 1 more for stability threshold. Progression: 0%->90%->100%->N/A->100%->75%->0%->100%->100%.
- 2026-04-05: Evidence-gating 100% (10th consecutive). Corrector-2 zero regressions (19/19).

---

## GRADUATION LOG

### R15 Retrospective
No KB graduations. All candidates held pending more data.

### R16 Retrospective
No KB graduations. Closest candidate: Researcher front-loading (P-R16-3) has 3 data points and measured numbers but lacks cross-project generalizability. All candidates remain in memory.

### R17 Retrospective
No KB graduations. Evidence-gating and Corrector-2 are already in KB (P55, P56). Novelty-flag oscillation has 6+ data points but is pipeline-specific (fails generalizability). Pipeline document-type adaptation has only 1 data point for prose (fails stability threshold of 3+).

### R18 Retrospective
No KB graduations. Closest candidate: Researcher front-loading (P-R16-3) now has 5 data points and measured numbers but still lacks cross-project generalizability (all data from forge-harness). Critic complementarity (P-R18-1) has 2 data points (needs 1 more). Novelty-flag document-type dependency (NAP-R18-2) has 8 data points but is pipeline-specific.

### R19 Retrospective
**1 KB graduation: Critic complementarity (P-R18-1).** 3 consecutive runs (R17-R19) with zero critic finding overlap, across 3 document types. Meets stability (3 runs), evidence (measured overlap = 0 in all 3), and generalizability (observed across prose, structured, and merged documents -- not pipeline-architecture-specific). Corrector-1 capacity ceiling (P-R19-2) has 5 data points but is pipeline-specific (fails generalizability). Pre-critiqued input suppression (P-R19-1) has 1 data point (needs 2 more).

### R20 Retrospective
No KB graduations. Closest candidate: Researcher front-loading (P-R16-3) now has 7 data points but still lacks cross-project generalizability (all data from forge-harness). Unflagged novel claims as regression predictor (P-R20-1) has only 2 data points (needs 1 more). No other candidates meet all three criteria (stability, evidence, generalizability).

### R21 Retrospective
No KB graduations. Closest candidate: P-R20-1 (unflagged novel claims predict regressions) at 3 data points (R16, R20, R21-by-absence) with measured evidence (5/5 unflagged claims defective) but R21 is absence-evidence. P-R20-2 (SIDE-EFFECT-CHECK) invalidated by R21 (1 regression with protocol active). New candidates P-R21-1 (novelty-flag -> 0 Drafter regs, 2 data points) and P-R21-2 (Corrector-1 class non-overlap, 6 data points but pipeline-specific).

### R22 Retrospective
**2 candidates meet KB graduation criteria but KB directory does not exist.** P-R20-1 (unflagged novel claims predict regressions): 4 positive data points (R16, R20, R21-absence, R22), 7/7 defect rate, generalizable. NAP-R21-1 (SIDE-EFFECT-CHECK insufficient for judgment-class regressions): 3 data points (R20-R22), measured regression trend 0->1->2, generalizable. Both marked READY; will be written to KB once `hive-mind-persist/knowledge-base/` is created. P-R22-1 (semantic verification mismatch) has only 2 data points -- not yet eligible.

---

## PROCESS CHANGES QUEUED

1. **Expand novelty-flag instruction scope** -- cover implementation-detail-level specifications, not just design-level. (Queued from R16 retrospective, Priority: HIGH)
2. **Add Drafter consistency gate** -- for documents with 5+ design decisions, produce a consistency matrix. (Queued from R16 retrospective, Priority: HIGH)
3. **Add Corrector-1 cross-section check** -- re-read referenced sections after each fix. (Queued from R16 retrospective, Priority: MEDIUM)
4. **Consider Researcher annotation audit pass** -- checklist for annotations/decorators on examined files. (Queued from R16 retrospective, Priority: LOW, risk of scope creep)
5. **Redesign novelty-flag mechanism** -- replace instruction-based approach with structural detection (e.g., diff-based new-claim detection). (Queued from R17 retrospective, Priority: HIGH)
6. **Broaden Drafter consistency gate for prose** -- cover category interactions in prose documents, not just numbered decisions. (Queued from R17 retrospective, Priority: HIGH)
7. **Add Researcher analytical reasoning checks** -- for prose documents, check causal claims, framing assumptions, and logical soundness. (Queued from R17 retrospective, Priority: MEDIUM)
8. **Add Drafter bullet-counting instruction** -- explicit mechanical step: count bullets in each category, verify against header, sum headers, verify total. Addresses dominant R18 finding class (arithmetic). (Queued from R18 retrospective, Priority: HIGH)
9. **Fix Corrector-1 side-effect check** -- change from "verify header numbers against each other" to "recount actual bullets in modified sections." Addresses self-referential anti-pattern. (Queued from R18 retrospective, Priority: HIGH)
10. **Run pipeline on different project for cross-project data** -- P-R16-3 (Researcher front-loading) blocked on generalizability. A hive-mind run would graduate or invalidate. (Queued from R18 retrospective, Priority: MEDIUM)
11. **Add Corrector-1 multi-pass review protocol** -- Instead of single self-review, require: (a) apply fix, (b) re-read surrounding section for consistency, (c) check any section referenced by modified section. Addresses capacity ceiling (5 consecutive runs at 1 regression, 5 different error classes). (Queued from R19 retrospective, Priority: HIGH)
12. **Add Drafter novel-claim self-audit step** -- After completing all edits, Drafter must list every claim/specification it added that was NOT in Researcher output or source document, and tag each as NEW_CLAIM. Addresses both novelty-flag gap and Drafter regression gap with one mechanism. (Queued from R20 retrospective, Priority: HIGH)
13. **Implement process change forcing function** -- Assign each queued process change an "overdue after N retrospectives" threshold. Changes overdue by 3+ retros get elevated to mandatory-before-next-run status. Addresses process change debt anti-pattern (Discovery #25). (Queued from R20 retrospective, Priority: MEDIUM -> HIGH per R21)
14. **Add Corrector-1 regression class tagging in extractor** -- Each Corrector-1 regression should be tagged with its error class to enable targeted evaluation of process changes. (Queued from R21 retrospective, Priority: MEDIUM)
15. **Track Drafter regression / novelty-flag compliance co-occurrence** -- Add as first-class metric in effectiveness reports to validate P-R21-1 candidate pattern. (Queued from R21 retrospective, Priority: MEDIUM)

### R21 Priority Adjustments
- #2 (Drafter consistency gate): Demoted HIGH -> MEDIUM. R21 suggests novelty-flag compliance may be the more effective lever (0 regs at 100% flags on complex doc).
- #5 (Novelty-flag structural redesign): Demoted HIGH -> LOW. R21 instruction-level approach succeeded on complex doc. Defer unless R22 drops below 100%.
- #11 (Corrector-1 multi-pass review): Remains HIGH. SIDE-EFFECT-CHECK proven insufficient (R21).
- #13 (Process change forcing function): Elevated MEDIUM -> HIGH. 6 retros of consistency gate recommendations demonstrate the need.

### R22 Priority Adjustments
- #5 (Novelty-flag structural redesign): Re-elevated LOW -> HIGH. R22 dropped to 70% compliance, immediately invalidating R21's demotion. Instruction-based approach confirmed non-convergent after 12 runs.
- #11 (Corrector-1 multi-pass review): Elevated HIGH -> **MANDATORY**. 4 retros at HIGH (R19-R22). Gate for R23.
- #12 (Drafter novel-claim self-audit step): Elevated HIGH -> **MANDATORY**. 3 retros at HIGH (R20-R22). Gate for R23.
- #13 (Process change forcing function): Elevated HIGH -> **MANDATORY**. Self-referentially overdue (3 retros at HIGH, R20-R22). Gate for R23.
- NEW #16: Semantic verification protocol for code-path claims. Priority: HIGH. Addresses R22's new failure class.
- NEW #17: Semantic verification accuracy as tracked metric. Priority: MEDIUM.
- NEW #18: Researcher code-path depth instruction. Priority: HIGH. 4 data points (R16, R20, R21, R22).
