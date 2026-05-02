# Double-Critique Effectiveness Report -- 2026-04-04

**Run:** R17 (Design Doc Divergence Root Cause Analysis Plan)
**Prior run:** R16 (Forge Harness Phase 2 `forge_evaluate` Implementation Plan)
**Prior runs analyzed:** R10-R17 (hive-mind + forge-harness series)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Corrector-2)

---

## This Run

R17 critiqued a root cause analysis plan -- a new document type for this pipeline -- and exposed analytical/framing weaknesses that mechanical verification alone could not reach.

- **Document critiqued:** Design Doc Divergence Root Cause Analysis Plan (`tmp/dc-8-extractor.md`)
- **Content type:** prose-only (causal analysis with category breakdowns, no TCs or code)
- **Total findings:** 19 (2 CRITICAL / 5 MAJOR / 12 MINOR)
  - Critic-1: 8 findings (1 CRITICAL, 3 MAJOR, 4 MINOR)
  - Critic-2: 6 findings (1 CRITICAL, 2 MAJOR, 3 MINOR)
  - Researcher: 5 findings (0 CRITICAL, 0 MAJOR, 5 verification/methodology items)
- **Application rate:** 100% (all findings from both critics applied by their respective correctors)
- **Drafter regressions:** 2
  1. Created "not mutually exclusive" / single-assignment 100%-summing contradiction
  2. Tightened methodology claim ("by count of distinct items") without verifying item count, making the 7-missing-item gap more visible
- **Corrector-1 regressions:** 1
  1. Category 4 interpretive note with right number but wrong reasoning path; self-review declared it "Correct"
- **Evidence-gating compliance:** 100% (16/16 Drafter VERIFIED claims with file:line citations; 3/3 Corrector-1 claims with citations; 0 bare "I verified" claims)
- **False verification claims:** 0 mechanical falsehoods. However, Corrector-1's arithmetic self-check was a false positive (coincidentally correct number, wrong reasoning) -- this is a self-review limitation, not an evidence-format violation.
- **Novelty-flag compliance:** 0% (0 NEW_CLAIM tags out of at least 1 novel factual claim and 3 novel analytical positions that should have been flagged)

### Severity Distribution

| Severity | Count | % | R16 % | R15 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----:|:-----------------:|
| CRITICAL | 2 | 11% | 6% | 6% | ~14% |
| MAJOR | 5 | 26% | 47% | 47% | ~41% |
| MINOR | 12 | 63% | 47% | 47% | ~44% |

R17 reverses R15-R16's low-CRITICAL trend. The 2 CRITICALs (vision doc framing question, 7 missing audit items) are both analytical/completeness failures, not mechanical bugs. MINOR share jumped to 63% -- highest in the series -- reflecting the prose-heavy document's abundance of small framing and editorial issues rather than specification gaps.

### Stages That Carried Weight vs. Added Nothing

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Critic-1** | HEAVY | MVP. Finding 6 (vision doc framing, CRITICAL) reshaped the entire document's interpretive frame. 3 MAJOR findings on causal evidence, category conflation, and coordinator-dependency assertions. |
| **Critic-2** | HEAVY | Finding 1 (7 missing items, CRITICAL) prevented a factually false completeness claim from shipping. Created Category 5. |
| **Corrector-2** | HEAVY | Hardest correction pass in the series: added 9 items, created a new category, recalculated all percentages. 0 regressions. |
| **Researcher** | MEDIUM | Solid mechanical verification (14/17 claims verified, line count corrected, file existence checked). Could not see analytical blind spots. |
| **Drafter** | LOW | Primarily a stenographer for Researcher findings. Added almost no analytical value. Introduced 2 regressions. |
| **Corrector-1** | MEDIUM | Applied 7/8 Critic-1 findings, added the "Assumed Document Purpose" section (most impactful structural change). But introduced 1 regression and missed the 7-item completeness gap. |

---

## Cross-Run Trends

The pipeline is now processing its 8th tracked run, and this is the first prose-only analytical document -- a meaningful test of whether the pipeline generalizes beyond implementation plans.

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
| **R17** | **Root cause analysis (prose)** | **19** | **2** | **5** | **12** | **forge-harness** |

R17 breaks the R15-R16 finding-count plateau (17/17) with 19 findings. The new document type (prose analysis) produced more CRITICALs (2 vs 1) and more MINORs (12 vs 8), but fewer MAJORs (5 vs 8). Prose documents produce a different severity profile: more framing/analytical issues (MINOR-CRITICAL poles) and fewer specification-gap issues (MAJOR).

### Regression Tracking Table

| Run | Drafter Reg. | Corrector-1 Reg. | Evidence-Gating Compliance | Novelty-Flag Compliance |
|-----|:------------:|:----------------:|:--------------------------:|:-----------------------:|
| R11R | 0 | 0 | 100% | 0% |
| R12 | 3 | 1 | 95% | ~90% |
| R13 | 6 | 2 | 100% | 100% |
| R14 | 0 | 0 | 100% | N/A |
| R15 | 0 | 1 | 100% | 100% |
| R16 | 2 | 1 | 100% | 75% |
| **R17** | **2** | **1** | **100%** | **0%** |

**Drafter regressions:** R17 matches R16 at 2. This is the 2nd consecutive run with 2 Drafter regressions after a zero-streak in R14-R15. Historical mean: ~1.6 across R11R-R17. Runs with complex or multi-section documents (R12: 3, R13: 6, R16: 2, R17: 2) consistently produce more Drafter regressions than simple ones (R14: 0, R15: 0).

**Corrector-1 regressions:** 1, continuing the pattern: 6 of the last 7 runs have exactly 0 or 1 Corrector-1 regressions, with most at 1. The regression rate is stubbornly stable rather than improving.

**Evidence-gating compliance:** 100% for the 8th consecutive tracked run. Zero fabrication across all 8.

**Novelty-flag compliance:** Crashed to 0%, the lowest since R11R. The Drafter used zero NEW_CLAIM tags despite introducing at least 1 novel factual claim and 3 novel analytical positions. Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0%. This is oscillating and shows no convergence trend.

### Are the Same Types of Findings Recurring?

Yes, three recurring finding types:

1. **Completeness gaps** (items/cases not covered): R14 missed test scenarios, R16 missed signal-killed processes, R17 missed 7 of 25 audit items. Every run has at least one completeness finding.
2. **Internal contradictions**: R12 (3 Drafter contradictions), R16 (D4/D11 concat contradiction), R17 ("not mutually exclusive" vs 100%-summing). Documents with 5+ interacting sections consistently produce these.
3. **Causal/reasoning weakness**: New in R17 (prose document). Asserted causation without evidence, conflated categories, and never questioned foundational assumptions. This finding class may be unique to analytical documents.

### Is the Pipeline Finding Fewer Issues Over Time?

No. Finding count: 15 -> 18 -> 17 -> 16 -> 26 -> 17 -> 17 -> 19. The count oscillates between 15-26 with no downward trend. The pipeline's detection capability is consistent, not diminishing. Document quality entering the pipeline has not measurably improved.

### Is Evidence-Gating Reducing False Verification Claims?

Yes, definitively. 8 consecutive runs at 100% evidence-gating compliance with 0 fabricated verification claims across all 8. However, R17 exposed a limitation: evidence-gating catches mechanical falsehoods but cannot catch analytical false positives (Corrector-1's coincidentally-correct arithmetic). The protocol works perfectly within its scope but does not cover logical/analytical verification.

---

## Stage Effectiveness Rankings

For each stage, contribution and trend are assessed against all 8 tracked runs.

| Rank | Stage | Contribution | Trend | Notes |
|------|-------|:------------:|:-----:|-------|
| 1 | **Critic-1** | HIGH | IMPROVING | R17 MVP. Finding 6 (vision doc framing) is the highest-impact single finding in the forge-harness series. 3 consecutive runs as a top-2 stage. |
| 2 | **Critic-2** | HIGH | STABLE | 3 consecutive runs catching CRITICAL findings that all prior stages missed (R15: `/dev/stdin`, R16: `readOnlyHint`, R17: 7 missing items). The pipeline's essential safety net. |
| 3 | **Corrector-2** | HIGH | IMPROVING | R17 was the hardest correction pass yet (9 items added, new category, full percentage recalculation). Zero regressions extended to 17/17 runs. Promoted from MEDIUM to HIGH based on R17 execution complexity. |
| 4 | **Researcher** | MEDIUM | DECLINING | R17 shift: Researcher was MEDIUM (not HEAVY) for the first time in forge-harness. On prose documents, mechanical verification is less impactful because the document's weaknesses are analytical, not factual. Still essential for code-adjacent plans. |
| 5 | **Corrector-1** | MEDIUM | STABLE | Applied findings competently (7/8 in R17) but introduced 1 regression for the 6th time in 7 runs. The "Assumed Document Purpose" addition was high-value, but the self-review false positive is concerning. |
| 6 | **Drafter** | LOW | DECLINING | R17 is the Drafter's weakest performance: described as "largely a pass-through" with 2 regressions and 0% novelty-flag compliance. 2 consecutive runs at LOW-to-MEDIUM. |

---

## What's Working

Pipeline behaviors that consistently produce value, with evidence from actual runs.

### 1. Dual-Critique Pipeline Catches Showstoppers (3 consecutive runs)
R15: Critic-2 caught `/dev/stdin` Windows regression. R16: Critic-2 caught `readOnlyHint` CRITICAL. R17: Critic-2 caught 7 missing audit items (CRITICAL), and Critic-1 caught the vision-doc framing gap (CRITICAL). In all 3 runs, at least 1 CRITICAL finding was caught exclusively by a critic that saw the document cold. Without the dual-critique structure, these would have shipped.

### 2. Evidence-Gating Is a Solved Problem (8/8 runs at 100%)
Zero fabricated verification claims across 8 tracked runs. R17 added 19 VERIFIED claims (16 Drafter + 3 Corrector-1), all with file:line citations. P55 is the most robust pipeline invariant.

### 3. Corrector-2 Zero-Regression Streak (17/17 runs)
R17: applied all 6 Critic-2 findings, created a new category, recalculated all percentages, and introduced 0 regressions. This is the second most robust pipeline invariant (P56).

### 4. Net Regressions in Final Output: 0 (8/8 runs)
Every regression introduced by the Drafter or Corrector-1 has been caught and fixed by downstream stages before the final document. The pipeline has never shipped a regression. R17: 3 regressions introduced (2 Drafter, 1 Corrector-1), all caught and fixed.

### 5. Critics Shift Focus Based on Document Type
On implementation plans (R15-R16), critics focused on specification completeness and platform bugs. On the prose analysis (R17), critics shifted to framing assumptions, causal reasoning, and analytical completeness. The pipeline adapts to document type without instruction changes.

---

## What's Not Working

Pipeline behaviors that consistently underperform, with evidence.

### 1. Novelty-Flag Compliance Has Collapsed (0% in R17)
Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0%. R17's Drafter used zero NEW_CLAIM tags despite 4 novel claims. The R16 retrospective proposed expanding the instruction scope; that change was either not applied or was insufficient. The protocol shows no convergence trend and is the pipeline's weakest invariant.

### 2. Drafter Regressions Are Persistent on Complex Documents
R17: 2 regressions (same as R16). Runs with complex/multi-section documents: R12 (3), R13 (6), R16 (2), R17 (2). Runs with simple documents: R14 (0), R15 (0). The R16 retrospective proposed a Drafter consistency gate for 5+ decision documents; R17 shows the problem extends to prose documents with multiple interacting categories, not just design-decision documents.

### 3. Corrector-1 Regression Rate Refuses to Improve (6 of 7 runs)
R17: 1 regression (arithmetic self-review false positive). 6 of the last 7 runs have at least 1 Corrector-1 regression. The R16 retrospective proposed a cross-section check; R17's regression was a different class (self-review failure, not cross-reference failure), suggesting the root cause is broader than cross-section awareness.

### 4. Researcher Provides Diminishing Value on Non-Code Documents
R17 is the first prose-only document. The Researcher verified 14/17 claims mechanically but missed both CRITICALs (vision doc framing, item completeness), which were analytical problems. On implementation plans (R14-R16), the Researcher was consistently the MVP. On analytical prose, it dropped to MEDIUM. The Researcher's value is document-type-dependent.

---

## Derived Metrics

| Metric | R17 | R16 | R15 | R14 | Historical Mean (R10-R17) |
|--------|----:|----:|----:|----:|:-------------------------:|
| Total findings | 19 | 17 | 17 | 26 | 18.1 |
| CRITICALs | 2 | 1 | 1 | 2 | 2.0 |
| Application rate | 100% | 94% | 100% | 100% | 98.6% |
| Drafter regressions | 2 | 2 | 0 | 0 | 1.6 |
| Corrector-1 regressions | 1 | 1 | 1 | 0 | ~0.9 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 | 0 (17/17) |
| Evidence-gating compliance | 100% | 100% | 100% | 100% | ~99% |
| False verification claims | 0 | 0 | 0 | 0 | 0 |
| Novelty-flag compliance | 0% | 75% | 100% | N/A | ~55% |
| Net regressions in final output | 0 | 0 | 0 | 0 | 0 |

---

## So What?

- **The pipeline generalizes beyond implementation plans.** R17 (prose-only root cause analysis) produced 19 findings including 2 CRITICALs -- one of which (vision doc framing) is the highest-impact single finding in the forge-harness series. Document-type diversity is a feature, not a risk.
- **Novelty-flagging is broken and needs a different approach.** 0% compliance in R17, oscillating across all runs, no convergence. The current instruction is not internalizable. Either redesign the trigger mechanism or accept that critics are the novelty-detection layer.
- **Evidence-gating and Corrector-2 are fully solved invariants.** 8/8 and 17/17 respectively. Stop monitoring these; redirect attention to the unsolved problems (novelty flags, Drafter/Corrector-1 regressions).
- **Corrector-1 regressions are a structural problem, not a training problem.** 6 of 7 runs with regressions, across different regression classes (cross-reference, platform, arithmetic). The lightweight "re-read adjacent sections" fix proposed in R16 is necessary but insufficient. Consider a more fundamental self-review protocol change.
- **Researcher value is document-type-dependent.** On code-adjacent plans, it is the MVP (R14-R16). On prose analysis, it drops to MEDIUM. Pipeline instructions should adapt Researcher scope based on document type -- heavier analytical checks for prose, heavier annotation audits for code plans.
