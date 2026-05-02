# Double-Critique Effectiveness Report -- 2026-04-05

**Run:** R19 (Design Doc Divergence -- Bidirectional Analysis, Final Merge + Evidence Verification)
**Prior run:** R18 (Reverse Divergence Audit + Bidirectional Report Merge Plan)
**Prior runs analyzed:** R10-R19 (hive-mind + forge-harness series)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Corrector-2)

---

## This Run

R19 critiqued the final merged bidirectional divergence analysis -- a large structured document with 93 items (28 forward + 65 reverse), tier classifications, cross-analysis, and 8 recommendations. The document had already been through two prior pipeline runs (R17 for Part 1, R18 for Part 2), making this a verification and integration pass rather than a first-principles critique.

- **Document critiqued:** Design Doc Divergence -- Bidirectional Analysis (`tmp/dc-2-drafter.md`, merged from prior R17/R18 outputs)
- **Content type:** Structured analytical report with per-item classification (93 items, tier system, cross-analysis, recommendations)
- **Total findings:** 16 (0 CRITICAL / 8 MAJOR / 8 MINOR)
  - Critic-1: 9 findings (0 CRITICAL, 5 MAJOR, 4 MINOR)
  - Critic-2: 7 findings (0 CRITICAL, 3 MAJOR, 4 MINOR)
  - Researcher: 24 claims verified, 2 line corrections, tier count correction, 2 failure mode gaps (fed into Drafter)
- **Application rate:** 94% (15 applied, 1 skipped -- Critic-2 Finding 7, a meta-process observation with no document section to modify)
- **Drafter regressions:** 0
- **Corrector-1 regressions:** 1 (budget-field classification as "logically coordinator-dependent" when it should be "deferred by design choice")
- **Evidence-gating compliance:** 100% (24 Researcher claims + 12 Corrector-2 verifications, all with file:line citations; 0 bare "I verified" claims)
- **False verification claims:** 0
- **Novelty-flag compliance:** 100% (2 NEW_CLAIM tags by Drafter for R10 items, both with source attribution; 0 unflagged novel claims detected by critics)

### Severity Distribution

| Severity | Count | % | R18 % | R17 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----:|:-----------------:|
| CRITICAL | 0 | 0% | 0% | 11% | ~12% |
| MAJOR | 8 | 50% | 40% | 26% | ~40% |
| MINOR | 8 | 50% | 60% | 63% | ~45% |

R19 is the 2nd consecutive run with 0 CRITICALs. MAJOR share returned to 50% (above historical mean), while MINOR share dropped to 50% (from R18's 60%). The 50/50 MAJOR/MINOR split reflects the document's dual nature: analytical framing issues (MAJOR -- Assumed Document Purpose, coordinator-dependency reasoning, causal claims) and consistency/formatting issues (MINOR -- label collisions, line ranges, format mismatches).

### Stages That Carried Weight vs. Added Nothing

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Critic-1** | HEAVY | 9 findings. Caught the 5 highest-impact analytical issues: tier count arithmetic, Assumed Document Purpose structural weakness, Category 2 circular reasoning, unsupported causal claim, buried Part 1 verification status. |
| **Critic-2** | HEAVY | 7 findings. Caught evidence-standard inconsistency (12 items without VERIFIED tags), budget-field regression, and pivotal unresolved framing question. All missed by prior 4 stages. |
| **Corrector-2/Final** | HEAVY | Verified 12 R5/R9 items against source. Corrected budget-field classification. Added concrete next step for framing question. Zero regressions (19/19). |
| **Researcher** | HIGH | 24 codebase verifications, 2 line corrections, tier count correction, 2 new failure modes. Set the factual foundation for 0 CRITICALs. |
| **Corrector-1** | MEDIUM | Applied 8/9 findings competently (1 partial). But introduced 1 regression (budget-field classification). |
| **Drafter** | MEDIUM | Clean Researcher integration with 0 regressions. Best Drafter performance since R14-R15. No analytical additions. |

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
| **R19** | **Bidirectional analysis (merged)** | **16** | **0** | **8** | **8** | **forge-harness** |

R19 finding count (16) is near the series low (R10/R18: 15). This is the 2nd consecutive run with 0 CRITICALs -- a new record. The finding profile (0/8/8) most closely resembles the feature-build plans (R15-R16: 1/8/8) despite being a different document type, suggesting that documents which have been through prior pipeline runs enter with fewer design-breaking flaws.

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
| **R19** | **0** | **1** | **0** | **100%** | **100%** |

**Drafter regressions:** R19 breaks the 3-run streak of 2 regressions per run (R16-R18). Back to 0, matching R14-R15. Historical mean: ~1.5 across R11R-R19. The document had already been through 2 prior pipeline runs (R17, R18), reducing the Drafter's decision surface. Hypothesis: pre-critiqued documents produce fewer Drafter regressions because the integration task is simpler.

**Corrector-1 regressions:** 1, for the 5th consecutive run. 8 of the last 9 runs have had 0-1 Corrector-1 regressions. R19's regression (budget-field classification) is an analytical judgment error, a different class from R18's arithmetic propagation, R17's self-review arithmetic, R16's cross-reference failure, and R15's platform incompatibility. Five different regression classes across 5 runs -- the problem is structural, not a single fixable failure mode.

**Corrector-2 regressions:** 0, extending the streak to **19/19 runs**.

**Evidence-gating compliance:** 100% for the **10th consecutive** tracked run. Zero fabrication across all 10.

**Novelty-flag compliance:** 100% for the 2nd consecutive run (R18: 100%, R19: 100%). Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100%. Still has not reached 3 consecutive runs at 100% due to the R17 crash to 0%.

### Application Rate Trend

| Run | Rate |
|-----|:----:|
| R10 | 100% |
| R11R | 100% |
| R12 | 95% |
| R13 | 100% |
| R14 | 100% |
| R15 | 100% |
| R16 | 94% |
| R17 | 100% |
| R18 | 80% |
| **R19** | **94%** |

R19: 15 of 16 findings applied (94%). The 1 skipped finding (Critic-2 F7, meta-process observation) had no document section to modify. Effective application rate (excluding correct skips): 100%.

---

## Stage Effectiveness Rankings

| Rank | Stage | Contribution | Trend (vs R18) | Notes |
|------|-------|:------------:|:--------------:|-------|
| 1 | **Critic-1** | HIGH | STABLE | 5th consecutive run as top-2 stage. 9 findings including 5 MAJOR analytical issues. Pipeline's analytical backbone. |
| 2 | **Critic-2** | HIGH | STABLE | 5th consecutive run catching errors all prior stages missed. Evidence-standard inconsistency (12 items) was the run's most impactful individual finding. |
| 3 | **Corrector-2** | HIGH | STABLE | Zero regressions (19/19). Verified 12 items against source. Promoted to HIGH in R17, sustained for 3rd run. |
| 4 | **Researcher** | HIGH | STABLE | 24 verified claims with source evidence. Back-to-back HIGH after R17 dip to MEDIUM. Consistent MVP on code-adjacent documents. |
| 5 | **Drafter** | MEDIUM | UP (from LOW-MEDIUM) | 0 regressions -- best since R14-R15. Clean integration. Promoted from LOW-MEDIUM based on zero-regression performance. |
| 6 | **Corrector-1** | MEDIUM | STABLE | Applied 8/9 findings but introduced 1 regression (5th consecutive run with 1 regression). Analytical judgment, not mechanical error. |

---

## What's Working

### 1. Zero CRITICALs for 2nd Consecutive Run
R18: 0 CRITs. R19: 0 CRITs. The prior record was 1 CRIT (R15-R16). The combination of pre-critiqued input documents and thorough Researcher verification is suppressing CRITICAL-class issues. Forge-harness CRITICAL rates: R14: 8%, R15: 6%, R16: 6%, R17: 11%, R18: 0%, R19: 0%.

### 2. Evidence-Gating Is a Solved Invariant (10/10 runs at 100%)
10th consecutive run at 100% compliance with 0 fabricated verification claims. R19 added 36 total verified claims (24 Researcher + 12 Corrector-2), all with file:line citations. P55 is the most robust pipeline invariant.

### 3. Corrector-2 Zero-Regression Streak (19/19 runs)
R19: applied 6 findings including 12 source verifications and a borderline reclassification, introduced 0 regressions. P56 is the second most robust pipeline invariant.

### 4. Critic Finding Complementarity (3rd consecutive run with 0 overlap)
Critic-1: 9 findings (analytical framing, reasoning rigor, navigation). Critic-2: 7 findings (evidence consistency, classification accuracy, concrete actionability). Zero overlap in R17, R18, R19. The two rounds serve genuinely different functions.

### 5. Net Regressions in Final Output: 0 (10/10 runs)
R19: 1 regression introduced by Corrector-1, caught and fixed by Critic-2/Corrector-2. The pipeline has never shipped a regression in 10 tracked runs.

### 6. Novelty-Flag Compliance Recovering (2 consecutive runs at 100%)
R18: 100%. R19: 100%. After crashing to 0% in R17, the mechanism appears to work reliably on structured documents (R13, R15, R18, R19 all at 100%). Needs 1 more consecutive run to reach the 3-run stability threshold.

---

## What's Not Working

### 1. Corrector-1 Regression Rate Is Structurally Locked at 1 Per Run
5th consecutive run with exactly 1 Corrector-1 regression (R15-R19). 8 of the last 9 runs have had at least 1. Each run produces a different regression class: platform (R15), cross-reference (R16), self-review arithmetic (R17), arithmetic propagation (R18), analytical judgment (R19). No single process fix addresses all classes. The self-review mechanism itself is fundamentally insufficient.

### 2. Novelty-Flag Stability Not Yet Achieved
Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100%. Two consecutive runs at 100%, but the 3-run stability threshold has not been met due to the R17 crash. The mechanism appears document-type-dependent: 100% on structured/classification documents, unreliable on prose.

### 3. Drafter Regression Improvement May Be Input-Dependent, Not Process-Dependent
R19's 0 regressions coincides with the document having been through 2 prior pipeline runs. R14-R15 (also 0 regressions) were on well-structured plans. R16-R18 (2 regressions each) were on fresh, complex documents. The Drafter may not have genuinely improved -- it may just have received easier input. The consistency gate proposed in R16-R18 retrospectives remains unimplemented.

### 4. Researcher Cannot Detect Analytical Weaknesses
R19: The Researcher verified 24 factual claims perfectly but missed all 5 analytical issues caught by Critic-1 (Assumed Document Purpose, circular reasoning, unsupported causal claim, buried verification status, hidden tradeoff). This is consistent with R17 (missed both CRITICALs, which were analytical). The Researcher's mandate is mechanical verification, not analytical review.

---

## Derived Metrics

| Metric | R19 | R18 | R17 | R16 | Historical Mean (R10-R19) |
|--------|----:|----:|----:|----:|:-------------------------:|
| Total findings | 16 | 15 | 19 | 17 | 17.8 |
| CRITICALs | 0 | 0 | 2 | 1 | 1.6 |
| Application rate | 94% | 80% | 100% | 94% | 95.7% |
| Drafter regressions | 0 | 2 | 2 | 2 | 1.5 |
| Corrector-1 regressions | 1 | 1 | 1 | 1 | ~0.9 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 | 0 (19/19) |
| Evidence-gating compliance | 100% | 100% | 100% | 100% | ~99% |
| False verification claims | 0 | 0 | 0 | 0 | 0 |
| Novelty-flag compliance | 100% | 100% | 0% | 75% | ~60% |
| Net regressions in final output | 0 | 0 | 0 | 0 | 0 |

---

## So What?

- **Pre-critiqued documents produce cleaner pipeline runs.** R19 processed a document that had already been through R17 and R18. Result: 0 CRITICALs, 0 Drafter regressions, lowest finding count in the forge-harness series (16). The pipeline may benefit from iterative passes more than from process improvements to individual stages.
- **Corrector-1 is the pipeline's structural weak link, not the Drafter.** The Drafter's regression rate is volatile (0-6 per run) and input-dependent. Corrector-1's is locked at exactly 1 per run for 5 consecutive runs, producing a different error class each time. This suggests the self-review mechanism is fundamentally capacity-limited, not missing a specific skill.
- **Evidence-gating (10/10) and Corrector-2 (19/19) are solved invariants.** No monitoring needed. Enforcement should continue but analysis attention should redirect to the unsolved problems.
- **Critic complementarity is the pipeline's core value proposition.** 3 consecutive runs with zero finding overlap between critics. The two rounds find genuinely different things (analytical vs consistency/evidence), and neither subsumes the other. This is the strongest argument for the 6-stage pipeline structure.
- **Novelty-flag compliance needs 1 more run at 100% to reach stability threshold.** If R20 hits 100%, the mechanism can be considered stable for structured documents. The prose-document failure mode (R17: 0%) remains an open question.
