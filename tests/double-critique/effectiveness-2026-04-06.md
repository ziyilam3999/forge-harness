# Double-Critique Effectiveness Report -- 2026-04-06

**Run:** R21 (Build Three-Tier Document System Into forge_plan)
**Prior run:** R20 (Forge-Harness Architectural Restructuring Plan)
**Prior runs analyzed:** R10-R21 (hive-mind + forge-harness series)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Corrector-2)

---

## This Run

This section captures the raw performance of the current pipeline run so it can be compared against historical baselines.

- **Document critiqued:** Build Three-Tier Document System Into forge_plan (`piped-sprouting-island.md`)
- **Content type:** includes-TCs (9 design decisions D1-D9, 6-step implementation sequence, full test cases & ACs per step, schema definitions, files-to-modify table)
- **Total findings:** 17 (1 CRITICAL / 7 MAJOR / 9 MINOR)
  - Critic-1: 10 findings (1 CRITICAL, 4 MAJOR, 5 MINOR)
  - Critic-2: 7 findings (0 CRITICAL, 3 MAJOR, 4 MINOR)
  - Researcher: 15+ claims verified, 1 CRITICAL (Tier 4 enforcement gap), 4 MAJORs, 7 MINORs, 7 failure-mode gaps, 2 unjustified decisions (fed into Drafter)
- **Application rate:** 94% (16/17 findings applied; 1 correctly rejected -- protocol creep guardrail kept as process reminder)
- **Drafter regressions:** 0
- **Corrector-1 regressions:** 1 (over-corrected repeating reminder to singular, creating silent hang)
- **Evidence-gating compliance:** 100% (all VERIFIED claims with file:line citations across all stages; 0 bare claims; 0 fabrication)
- **False verification claims:** 0
- **Novelty-flag compliance:** 100% (4 NEW_CLAIM tags by Drafter, all with source attribution; 0 unflagged novel claims detected by critics)
- **Notable:** R21 is the first run processing a document with a full Critique Log appended (the plan already contained the complete corrector log from both rounds). The pipeline handled the meta-document cleanly.

### Severity Distribution

| Severity | Count | % | R20 % | R19 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----:|:-----------------:|
| CRITICAL | 1 | 6% | 0% | 0% | ~10% |
| MAJOR | 7 | 41% | 44% | 50% | ~41% |
| MINOR | 9 | 53% | 56% | 50% | ~46% |

R21 breaks the 3-run 0-CRITICAL streak (R18-R20). The CRITICAL (no AC verifying divergence reduction) was a missing-success-criterion issue, not a design-breaking flaw -- the plan's machinery was well-specified, but it lacked an AC tying back to the motivating problem. MAJOR share at 41% matches the historical mean. MINOR share at 53% is slightly above historical mean (~46%).

### Stages That Carried Weight vs. Added Nothing

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Researcher** | HEAVY | MVP. 15+ verified claims, 1 CRITICAL, 4 MAJORs, 7 failure-mode gaps, 2 unjustified decisions. Set the factual foundation and identified the Tier 4 enforcement gap. |
| **Critic-1** | HEAVY | Caught the CRITICAL (no divergence-reduction AC) and 4 MAJORs (calibration, context precedence, plan degradation, blocking timeout). Analytical focus. |
| **Critic-2** | HEAVY | Caught 3 MAJORs all prior stages missed (callClaude count, evaluate.ts complexity, tier misclassification). Implementation-detail focus. Zero overlap with Critic-1. |
| **Corrector-2** | HEAVY | Applied all 7 findings, 2 self-caught improvements, 2 independent re-verifications. Zero regressions (21/21). Upgraded implementation coupling check from Tier 4 to Tier 1. |
| **Drafter** | HIGH | Addressed all Researcher findings cleanly, 4 NEW_CLAIM tags (100% compliance), 2 self-caught corrections. Zero regressions. Best Drafter performance since R19. |
| **Corrector-1** | MEDIUM | Applied 9/10 findings competently, used SIDE-EFFECT-CHECK. But introduced 1 regression (over-corrected reminder frequency). |

No stage added nothing. All 6 produced unique value.

---

## Cross-Run Trends

### Finding Volume

| Run | Document Type | Findings | CRITs | MAJORs | MINORs | Project |
|-----|--------------|:--------:|:-----:|:------:|:------:|---------|
| R10 | Implementation plan | 15 | 2 | -- | -- | hive-mind |
| R11R | Design-stage PRD | 18 | 3 | -- | -- | hive-mind |
| R12 | Design-stage PRD v2 | 17 | 2 | -- | -- | hive-mind |
| R13 | Implementation plan | 16 | 2 | -- | -- | hive-mind |
| R14 | Scaffold plan (greenfield) | 26 | 2 | 7 | 10 | forge-harness |
| R15 | Implementation plan (feature) | 17 | 1 | 8 | 8 | forge-harness |
| R16 | Implementation plan (feature) | 17 | 1 | 8 | 8 | forge-harness |
| R17 | Root cause analysis (prose) | 19 | 2 | 5 | 12 | forge-harness |
| R18 | Divergence audit (structured) | 15 | 0 | 6 | 9 | forge-harness |
| R19 | Bidirectional analysis (merged) | 16 | 0 | 8 | 8 | forge-harness |
| R20 | Architectural restructuring plan | 16 | 0 | 7 | 9 | forge-harness |
| **R21** | **Three-tier system plan** | **17** | **1** | **7** | **9** | **forge-harness** |

R21 finding count (17) matches the series median (17). The 1 CRITICAL breaks the R18-R20 0-CRITICAL streak but remains below the historical mean (~1.5). This is a fresh architectural plan with 9 design decisions -- comparable complexity to R20 (which also had 0 CRITs on a fresh plan). The CRITICAL was a meta-level gap (missing outcome AC) rather than a design flaw, suggesting the Researcher's front-loading continues to suppress design-breaking flaws even on complex first-pass documents.

### Regression Tracking Table

| Run | Drafter Reg. | Corrector-1 Reg. | Corrector-2 Reg. | Evidence-Gating | Novelty-Flag |
|-----|:------------:|:----------------:|:----------------:|:---------------:|:------------:|
| R11R | 0 | 0 | 0 | 100% | 0% |
| R12 | 3 | 1 | 0 | 95% | ~90% |
| R13 | 6 | 2 | 0 | 100% | 100% |
| R14 | 0 | 0 | 0 | 100% | N/A |
| R15 | 0 | 1 | 0 | 100% | 100% |
| R16 | 2 | 1 | 0 | 100% | 75% |
| R17 | 2 | 1 | 0 | 100% | 0% |
| R18 | 2 | 1 | 0 | 100% | 100% |
| R19 | 0 | 1 | 0 | 100% | 100% |
| R20 | 3 | 0 | 0 | 100% | 76.9% |
| **R21** | **0** | **1** | **0** | **100%** | **100%** |

**Drafter regressions:** 0, matching R19. This is the 3rd run with 0 Drafter regressions in the last 4 (R19: 0, R20: 3, R21: 0). R21 processed a fresh 9-decision architectural plan -- the same complexity class that produced 3 regressions in R20. Historical mean: ~1.5 across R11R-R21. The improvement may be attributable to: (a) the Researcher surfacing concrete failure-mode gaps that reduced the Drafter's need to invent, and/or (b) 100% novelty-flag compliance ensuring all novel claims were tagged and scrutinized. Both factors were present in R21 but not in R20 (which had 76.9% novelty-flag compliance and 3 regressions -- all unflagged).

**Corrector-1 regressions:** 1, returning to the historical baseline after R20's anomalous 0. The regression (over-correcting reminder frequency) is a judgment-class error, a new class. Updated class list: platform (R15), cross-reference (R16), self-review arithmetic (R17), arithmetic propagation (R18), analytical judgment (R19), over-correction judgment (R21). R20's 0 appears to be the anomaly rather than R21's 1. The SIDE-EFFECT-CHECK protocol did not prevent this regression.

**Corrector-2 regressions:** 0, extending the streak to **21/21 runs**.

**Evidence-gating compliance:** 100% for the **12th consecutive** tracked run. Zero fabrication across all 12.

**Novelty-flag compliance:** 100%, matching R18-R19. The series now reads: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9% -> 100%. R20 (76.9%) interrupts what would otherwise be a 4-run streak at 100% (R18-R19-R21). On structured plan documents specifically, compliance has been 100% in 4 of the last 5 runs (R18, R19, R21, plus R15). The single exception (R20: 76.9%) was also a structured plan but with higher complexity (10+ interacting sections).

### Are the Same Types of Findings Recurring?

Yes, the four established recurring types continue:

1. **Completeness gaps** (items/cases not covered): R21 had no AC tying the system to the motivating problem (CRITICAL), missing AC for context precedence critic check, missing test coverage for evaluate.ts expansion. Present in every run.
2. **Internal contradictions / tier mismatches**: R21 had the implementation coupling check classified as Tier 2 when it was actually Tier 4 (LLM prompt). This is a classification consistency issue, same class as R16 (D4/D11) and R20 (budget advisory vs enforcement).
3. **Platform-specific gaps**: No new platform gaps in R21. The plan's Windows-safe naming was correctly specified from the start.
4. **Underspecified failure modes**: R21 had 7 failure-mode gaps (PRD skill unavailable, master plan wrong, self-healing loop, human-review blocking, contradictory context, missing tokens, concurrent timestamps). Continues the pattern from every prior run.

New recurring type emerging: **LLM call site counting errors**. R21: callClaude had 4 sites, not 3. R20: ProgressReporter stage count was wrong. Across 2 runs, LLM-related counts have been incorrect.

### Is the Pipeline Finding Fewer Issues Over Time?

No. Finding count: 15 -> 18 -> 17 -> 16 -> 26 -> 17 -> 17 -> 19 -> 15 -> 16 -> 16 -> 17. Mean: 17.4. R21 at 17 is at the mean. The pipeline's detection capability remains consistent. The CRITICAL returned after 3 runs at 0, but at a lower severity class (meta-level gap vs design-breaking flaw) -- the underlying document quality has improved even as finding counts stay steady.

### Is Evidence-Gating Reducing False Verification Claims?

Yes. 12 consecutive runs at 100% evidence-gating compliance with 0 fabricated verification claims. R21 added VERIFIED claims across all stages with file:line citations. The protocol is fully internalized.

---

## Stage Effectiveness Rankings

| Rank | Stage | Contribution | Trend (vs R20) | Notes |
|------|-------|:------------:|:--------------:|-------|
| 1 | **Critic-2** | HIGH | STABLE | 7th consecutive run catching errors all prior stages missed. 3 MAJORs (callClaude count, evaluate.ts complexity, tier misclassification). Pipeline's essential safety net. |
| 2 | **Critic-1** | HIGH | STABLE | 7th consecutive run as top-2 stage. Caught the CRITICAL + 4 MAJORs on analytical/specification gaps. Zero overlap with Critic-2 (5th consecutive run). |
| 3 | **Researcher** | HIGH | STABLE | Back-to-back HEAVY. 15+ verified claims, 1 CRITICAL, 7 failure-mode gaps. Continues to suppress design-breaking flaws through front-loading. |
| 4 | **Corrector-2** | HIGH | STABLE | Zero regressions (21/21). Applied all 7 findings + 2 self-caught + 2 independent re-verifications. Sustained HIGH for 5th consecutive run. |
| 5 | **Drafter** | HIGH | UP (from MEDIUM) | 0 regressions on a complex first-pass document. 100% novelty-flag compliance. Addressed all Researcher gaps cleanly. Best Drafter performance on a complex document in the series. |
| 6 | **Corrector-1** | MEDIUM | DOWN (from MEDIUM) | Applied 9/10 findings but introduced 1 regression (over-correction). SIDE-EFFECT-CHECK did not prevent it. Returns to the historical 1-per-run baseline. |

---

## What's Working

### 1. Evidence-Gating Is a Solved Invariant (12/12 runs at 100%)
Zero fabricated verification claims across 12 tracked runs. R21: VERIFIED claims across all stages with file paths and line numbers. No further monitoring needed.

### 2. Corrector-2 Zero-Regression Streak (21/21 runs)
R21: applied all 7 findings plus 2 self-caught improvements plus 2 independent re-verifications, introduced 0 regressions. The most robust pipeline invariant.

### 3. Critic Finding Complementarity (5th consecutive run with 0 overlap)
R17-R21: zero finding overlap between Critic-1 and Critic-2 in every run. R21: Critic-1 focused on analytical/specification gaps (coherence calibration, context precedence, plan degradation, success criteria). Critic-2 focused on implementation-detail correctness (callClaude count, evaluate.ts architecture, tier classification). The two rounds serve genuinely different functions.

### 4. Net Regressions in Final Output: 0 (12/12 runs)
Every regression (1 Corrector-1 over-correction in R21) was caught and fixed by downstream stages before the final document. The pipeline has never shipped a regression in 12 tracked runs.

### 5. Drafter Zero Regressions on Complex First-Pass Document
R21 is the first time the Drafter produced 0 regressions on a complex first-pass document (9 design decisions). Historical pattern: complex first-pass documents produce 2-6 regressions (R12: 3, R13: 6, R16-R18: 2 each, R20: 3). R21 breaks this pattern with 0 regressions coinciding with 100% novelty-flag compliance and thorough Researcher front-loading. This is a strong signal that the combination of tagged novel claims + concrete Researcher gap lists reduces Drafter regressions.

### 6. Researcher Front-Loading Continues to Suppress Design-Breaking Flaws
While the 0-CRITICAL streak broke (R21 had 1 CRITICAL), the CRITICAL was a meta-level gap (missing outcome AC), not a design-breaking flaw. The Researcher's 7 failure-mode gaps and 2 unjustified decisions were resolved before critics engaged, meaning critics could focus on deeper specification and implementation issues.

---

## What's Not Working

### 1. Corrector-1 Regression Rate Reverted to 1 Per Run
R20's 0 regressions appears to have been anomalous. R21 returns to 1 regression (over-correction judgment), matching R15-R19's pattern. The SIDE-EFFECT-CHECK protocol did not prevent this regression class. Historical pattern across R15-R21 (excluding R20): exactly 1 regression per run, each a different error class. The Corrector-1 self-review mechanism remains structurally capacity-limited.

### 2. Novelty-Flag Compliance Still Fails the Strict 3-Consecutive Threshold
R21 achieved 100%, matching R18-R19. But R20 (76.9%) interrupts the streak. The strict 3-consecutive-at-100% threshold has still not been met. On structured plan documents only: R15 (100%), R18 (100%), R19 (100%), R21 (100%) -- but these are not consecutive because R16 (75%), R17 (0%), and R20 (76.9%) intervene. The instruction-based approach works reliably on some documents but not all.

### 3. Process Change Debt Continues to Accumulate
The Drafter consistency gate has been recommended in 6 consecutive retrospectives (R16-R21). The novelty-flag redesign has been recommended in 5 (R17-R21). Neither has been implemented. R21's 0 Drafter regressions may reduce urgency for the consistency gate, but this is a single data point. The forcing function proposed in R20 (overdue-after-N-retros escalation) has also not been implemented.

### 4. SIDE-EFFECT-CHECK Protocol Is Not a Reliable Fix for Corrector-1
R20 posted 0 Corrector-1 regressions with SIDE-EFFECT-CHECK active. R21 posted 1 regression with SIDE-EFFECT-CHECK also active. One data point each way -- the protocol is not consistently effective. The Corrector-1 regression problem requires a structural fix (multi-pass review), not an instruction-level intervention.

---

## Derived Metrics

| Metric | R21 | R20 | R19 | R18 | Historical Mean (R10-R21) |
|--------|----:|----:|----:|----:|:-------------------------:|
| Total findings | 17 | 16 | 16 | 15 | 17.4 |
| CRITICALs | 1 | 0 | 0 | 0 | 1.4 |
| Application rate | 94% | 100% | 94% | 80% | 95.5% |
| Drafter regressions | 0 | 3 | 0 | 2 | 1.5 |
| Corrector-1 regressions | 1 | 0 | 1 | 1 | ~0.8 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 | 0 (21/21) |
| Evidence-gating compliance | 100% | 100% | 100% | 100% | ~99% |
| False verification claims | 0 | 0 | 0 | 0 | 0 |
| Novelty-flag compliance | 100% | 76.9% | 100% | 100% | ~60% |
| Net regressions in final output | 0 | 0 | 0 | 0 | 0 |

---

## So What?

Five things a team lead should know about the pipeline's health after R21:

- **The Drafter posted 0 regressions on a complex first-pass document for the first time ever.** This breaks the established pattern (complex first-pass = 2-6 regressions). The combination of 100% novelty-flag compliance and thorough Researcher front-loading appears to be the mechanism. If this holds in R22, it suggests the long-sought Drafter consistency gate may be unnecessary when novelty-flag compliance is 100%. One data point -- track R22 before drawing conclusions.

- **Corrector-1 reverted to 1 regression per run, confirming R20's 0 was anomalous.** The SIDE-EFFECT-CHECK protocol did not prevent the R21 regression (over-correction judgment). The Corrector-1 self-review mechanism is structurally capacity-limited: 6 different regression classes across 7 runs (R15-R21), each requiring a different kind of cross-section awareness. An instruction-level fix cannot address all classes.

- **Evidence-gating (12/12) and Corrector-2 (21/21) are solved invariants.** These are the pipeline's load-bearing walls. Stop analyzing them; redirect all improvement effort to the two open problems: Corrector-1 capacity ceiling and novelty-flag convergence.

- **Process change debt is now at 6 retrospectives for the consistency gate and 5 for the novelty-flag redesign.** R21's 0 Drafter regressions may paradoxically reduce urgency for the consistency gate, but this is based on a single data point. The forcing function (overdue-after-N-retros escalation) proposed in R20 remains unimplemented. The retrospective is becoming a record of repeated advice.

- **Critic complementarity extends to 5 consecutive runs with zero overlap (R17-R21).** This is the pipeline's core architectural justification. Critic-1 catches analytical/specification gaps; Critic-2 catches implementation-detail correctness. Neither subsumes the other. The two-round structure is not redundancy -- it is coverage.
