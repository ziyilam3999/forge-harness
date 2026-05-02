# Double-Critique Effectiveness Report -- 2026-04-05 (Run 2)

**Run:** R20 (Forge-Harness Architectural Restructuring Plan)
**Prior run:** R19 (Design Doc Divergence -- Bidirectional Analysis, Final Merge + Evidence Verification)
**Prior runs analyzed:** R10-R20 (hive-mind + forge-harness series)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Corrector-2)

---

## This Run

This section captures the raw performance of the current pipeline run so it can be compared against historical baselines. Think of it as the vitals sheet from a single patient visit.

- **Document critiqued:** Forge-Harness Architectural Restructuring Plan (`C:\Users\ziyil\.claude\plans\piped-sprouting-island.md`)
- **Content type:** includes-TCs (design decisions D1-D3, 11 test cases in source expanding to 31 after Drafter, implementation phases 0-5 with dependency graph)
- **Total findings:** 16 (0 CRITICAL / 7 MAJOR / 9 MINOR)
  - Critic-1: 9 findings (0 CRITICAL, 3 MAJOR, 6 MINOR)
  - Critic-2: 7 findings (0 CRITICAL, 4 MAJOR, 3 MINOR)
  - Researcher: 11 claims verified, 4 MAJORs, 10 failure-mode gaps, 1 phase numbering mismatch (fed into Drafter)
- **Application rate:** 100% (16/16 findings applied by their respective correctors)
- **Drafter regressions:** 3
  1. Hardcoded 6-stage list in ProgressReporter -- fixed "5" to "6" but did not account for quick/standard tiers having fewer stages
  2. callClaude accepts optional RunContext -- coupled a pure API wrapper to observability (architectural defect)
  3. "oldest/lowest-priority" truncation with no priority field in the schema -- introduced unspecifiable behavior
- **Corrector-1 regressions:** 0
- **Evidence-gating compliance:** 100% (13 Drafter VERIFIED claims + 1 Corrector-2 VERIFIED claim, all with file:line citations; 0 bare "I verified" claims)
- **False verification claims:** 0
- **Novelty-flag compliance:** 76.9% (10 NEW_CLAIM tags / (10 tags + 3 unflagged novel claims caught by critics))
- **Notable:** All 3 unflagged novel claims were exactly the 3 Drafter regressions. The NEW_CLAIM format functions as a regression predictor -- 100% of unflagged novel claims were defective.

### Severity Distribution

*Each row shows how many findings fell into each severity bucket. Comparing across runs reveals whether the pipeline is catching bigger or smaller issues over time.*

| Severity | Count | % | R19 % | R18 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----:|:-----------------:|
| CRITICAL | 0 | 0% | 0% | 0% | ~11% |
| MAJOR | 7 | 44% | 50% | 40% | ~41% |
| MINOR | 9 | 56% | 50% | 60% | ~46% |

R20 is the 3rd consecutive run with 0 CRITICALs (R18, R19, R20). MAJOR share at 44% is near the historical mean (~41%). The Researcher's front-loading of 4 MAJORs and 10 failure-mode gaps resolved design-level issues before critics engaged, continuing the pattern that thorough Researcher passes suppress CRITICALs.

### Stages That Carried Weight vs. Added Nothing

*Grades each pipeline stage on whether it found unique issues, fixed things cleanly, or just passed work through.*

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Researcher** | HEAVY | MVP. 4 MAJORs, 10 failure-mode gaps, 11 verified claims with line-number evidence. Gave the Drafter a concrete fix list. |
| **Critic-2** | HEAVY | Highest-value critic. 4 MAJORs including 2 surviving Drafter regressions (stage count, callClaude coupling), Windows process tree kill, and missing regression TC. All missed by 4 prior stages. |
| **Critic-1** | HEAVY | 3 MAJORs and 6 MINORs. Caught allowDangerous trust model, command blocklist underspecification, and Phase 4 dependency gap. Zero overlap with Critic-2. |
| **Corrector-2** | HEAVY | Applied all 7 findings, added 2 SELF-CAUGHT improvements (isOAuthAuth, Decision #5 rationale). Zero regressions (extends to 20/20). |
| **Drafter** | MEDIUM | Heavy lifter: addressed all 10 Researcher gaps, added test cases for missing phases, maintained evidence-gated verification. But introduced 3 regressions -- all unflagged novel claims. |
| **Corrector-1** | MEDIUM | Clean execution: applied all 9 Critic-1 findings with 0 regressions. SIDE-EFFECT-CHECK protocol prevented regressions. But did not catch any of Critic-2's 7 findings. |

No stage added nothing. All 6 produced unique value.

---

## Cross-Run Trends

This section tracks the pipeline's performance over time. A single run can be noisy; trends across 11 runs reveal whether the pipeline is genuinely improving, plateauing, or regressing.

### Finding Volume

*Each row is one pipeline run. Columns show how many issues were found and at what severity. Read left-to-right: higher finding counts mean the document had more problems entering the pipeline; higher CRITICAL counts mean the problems were more severe.*

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
| **R20** | **Architectural restructuring plan** | **16** | **0** | **7** | **9** | **forge-harness** |

R20 finding count (16) matches R19 and is near the series floor (R10/R18: 15). This is the **3rd consecutive run with 0 CRITICALs** -- a new streak record. The MAJOR/MINOR split (7/9) is consistent with the pipeline's baseline for includes-TCs documents.

### Regression Tracking Table

*Tracks defects introduced by the pipeline itself. Drafter regressions are new bugs the Drafter creates while fixing old ones. Corrector-1 regressions are new bugs the first corrector creates while applying critic feedback. Evidence-gating measures whether verification claims have actual evidence behind them. Novelty-flag measures whether new claims are tagged so critics can scrutinize them.*

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
| **R20** | **3** | **0** | **0** | **100%** | **76.9%** |

**Drafter regressions:** R20 jumps to 3 -- the highest since R12 (3) and R13 (6). This breaks R19's zero-regression result and returns the Drafter to its volatile pattern. Historical mean across R11R-R20: ~1.6. R20's 3 regressions were all on a fresh architectural plan with 10+ interacting sections, consistent with the pattern that complex, first-pass documents produce more Drafter regressions (R12: 3, R13: 6, R16-R18: 2 each) while pre-critiqued or simple documents produce fewer (R14-R15: 0, R19: 0).

**Corrector-1 regressions:** 0, breaking the 5-run streak of exactly 1 regression per run (R15-R19). This is only the 3rd time in 10 tracked runs that Corrector-1 has produced 0 regressions (R11R, R14, R20). The SIDE-EFFECT-CHECK protocol and self-review checklist in this run appear to have been effective.

**Corrector-2 regressions:** 0, extending the streak to **20/20 runs**.

**Evidence-gating compliance:** 100% for the **11th consecutive** tracked run. Zero fabrication across all 11.

**Novelty-flag compliance:** Dropped to 76.9% after 2 consecutive runs at 100% (R18-R19). Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9%. The 3-run stability threshold at 100% has still not been reached. The drop correlates with a complex first-pass document (the same conditions that produced 75% in R16).

### Are the Same Types of Findings Recurring?

Yes, four recurring finding types are now established across 3+ runs:

1. **Completeness gaps** (items/cases not covered): R14 missed test scenarios, R16 missed signal-killed processes, R17 missed 7 audit items, R18 missed R8 items, R20 missed test cases for Phases 2-5 and regression TC for plan.test.ts. Present in every run.
2. **Internal contradictions**: R12 (3 Drafter contradictions), R16 (D4/D11), R17 ("not mutually exclusive" vs 100%-summing), R20 (budget advisory vs enforcement). Documents with 5+ interacting sections consistently produce these.
3. **Platform-specific gaps**: R15 (/dev/stdin Windows regression), R16 (unconditional bash), R20 (Windows process tree kill, NTFS colon-in-filename). Every code-adjacent document surfaces at least one Windows/cross-platform issue.
4. **Underspecified safety/trust models**: R16 (blocklist matching), R20 (allowDangerous trust model, command blocklist approach). Security mechanisms are consistently underspecified in first-pass documents.

### Is the Pipeline Finding Fewer Issues Over Time?

No. Finding count: 15 -> 18 -> 17 -> 16 -> 26 -> 17 -> 17 -> 19 -> 15 -> 16 -> 16. The count oscillates between 15-26 with no downward trend. Mean: 17.5. R20 at 16 is slightly below mean. The pipeline's detection capability is consistent, not diminishing. However, CRITICAL density has dropped: 3 consecutive runs at 0 CRITICALs (R18-R20), vs historical mean of ~1.6 CRITICALs per run for all prior runs.

### Is Evidence-Gating Reducing False Verification Claims?

Yes. 11 consecutive runs at 100% evidence-gating compliance with 0 fabricated verification claims. R20 added 14 VERIFIED claims (13 Drafter + 1 Corrector-2), all with file paths and line numbers. The protocol is fully internalized and producing zero false positives in its mechanical scope.

---

## Stage Effectiveness Rankings

This section ranks each stage by its contribution to the pipeline's output quality. Think of it as a performance review for each team member -- who is carrying their weight, who is coasting, and who is trending up or down.

| Rank | Stage | Contribution | Trend (vs R19) | Notes |
|------|-------|:------------:|:--------------:|-------|
| 1 | **Critic-2** | HIGH | STABLE | 6th consecutive run catching errors all prior stages missed. Found 4 MAJORs including 2 surviving Drafter regressions. The pipeline's essential safety net. |
| 2 | **Critic-1** | HIGH | STABLE | 6th consecutive run as top-2 stage. 3 MAJORs on security/trust model gaps that no other stage considered. Analytical backbone of the pipeline. |
| 3 | **Researcher** | HIGH | STABLE | Back to HEAVY after R17 dip. 4 MAJORs, 10 failure-mode gaps. Consistent MVP on code-adjacent documents. Contributed to 3rd consecutive 0-CRITICAL run. |
| 4 | **Corrector-2** | HIGH | STABLE | Zero regressions (20/20). Applied all 7 findings + 2 self-caught improvements. Sustained HIGH for 4th consecutive run. |
| 5 | **Drafter** | MEDIUM | DOWN (from MEDIUM) | Addressed all Researcher gaps but introduced 3 regressions (highest since R13). 76.9% novelty-flag compliance -- the unflagged claims were exactly the regressions. Volatile performer. |
| 6 | **Corrector-1** | MEDIUM | UP (from MEDIUM) | 0 regressions for the first time in 5 runs. Applied all 9 findings cleanly. SIDE-EFFECT-CHECK worked. But did not catch any latent issues independently. |

---

## What's Working

Each item describes a pipeline behavior that consistently produces value, backed by data from multiple runs. These are the habits worth keeping.

### 1. Zero CRITICALs for 3rd Consecutive Run (New Record)
R18: 0 CRITs. R19: 0 CRITs. R20: 0 CRITs. The prior best was 2 consecutive (R15-R16 at 1 CRIT each). Forge-harness CRITICAL rates: R14: 8%, R15: 6%, R16: 6%, R17: 11%, R18: 0%, R19: 0%, R20: 0%. The combination of thorough Researcher front-loading and (for R19) pre-critiqued inputs is suppressing design-breaking flaws.

### 2. Evidence-Gating Is a Solved Invariant (11/11 runs at 100%)
Zero fabricated verification claims across 11 tracked runs. R20: 14 VERIFIED claims, all with file:line citations. No further monitoring needed -- enforcement should continue but analysis attention should go to unsolved problems.

### 3. Corrector-2 Zero-Regression Streak (20/20 runs)
R20: applied all 7 findings plus 2 self-caught improvements, introduced 0 regressions. This is the most robust pipeline invariant alongside evidence-gating. Both are solved problems.

### 4. Critic Finding Complementarity (4th consecutive run with 0 overlap)
R17, R18, R19, R20: zero finding overlap between Critic-1 and Critic-2. In R20, Critic-1 focused on security/trust model gaps (allowDangerous, blocklist approach) while Critic-2 focused on platform-specific correctness (process tree kill, ProgressReporter tier handling) and missing test coverage. The two rounds serve genuinely different functions and neither subsumes the other.

### 5. Net Regressions in Final Output: 0 (11/11 runs)
Every regression introduced by Drafter (3 in R20) or Corrector-1 (0 in R20, but 1 in each of R15-R19) has been caught and fixed by downstream stages before the final document. The pipeline has never shipped a regression in 11 tracked runs.

### 6. Researcher Front-Loading Halved Critic Workload in R20
The Researcher surfaced 10 failure-mode gaps that the Drafter addressed proactively. The extraction estimates that without Researcher-driven fixes, critics would have faced ~19 additional issues on top of their 16. This is the clearest single-run demonstration of the Researcher's load-reduction effect.

---

## What's Not Working

Each item describes a pipeline behavior that consistently underperforms, with evidence. These are the problems worth fixing.

### 1. Drafter Regressions Remain Volatile and Correlated With Document Complexity
R20: 3 regressions (highest since R12-R13). Pattern across all runs: fresh, complex documents with many interacting sections produce 2-6 Drafter regressions (R12: 3, R13: 6, R16-R18: 2, R20: 3). Simple or pre-critiqued documents produce 0 (R14-R15, R19). Historical mean: ~1.6. The proposed consistency gate (from R16-R18 retrospectives) has still not been implemented. The Drafter's regression rate is input-driven, not process-driven.

### 2. Novelty-Flag Compliance Still Oscillating (No Convergence to Stable 100%)
Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9%. R20 drops from 2 consecutive runs at 100%, resetting the stability counter again. The 3-run stability threshold has never been met. Critically, all 3 unflagged novel claims in R20 were the exact 3 regressions -- the flag mechanism is a proven regression predictor, but compliance is unreliable on complex first-pass documents.

### 3. Corrector-1 Improvement in R20 May Be Anomalous, Not Structural
R20 is only the 3rd time in 10 runs with 0 Corrector-1 regressions (R11R, R14, R20). The prior 5 consecutive runs each had exactly 1 regression across 5 different error classes. R20's SIDE-EFFECT-CHECK protocol appeared effective, but a single data point does not break a pattern. Need R21+ data to determine whether this is a genuine improvement or just variance.

### 4. Researcher Cannot Prevent Drafter Regressions
The Researcher surfaced 10 failure-mode gaps and verified 11 claims, but the Drafter still introduced 3 regressions. All 3 were novel claims the Drafter invented (not source-document issues). The Researcher's mandate is verification of existing claims and gap identification -- it does not audit the Drafter's new contributions. This is a structural gap, not a Researcher failure.

---

## Derived Metrics

*Summary table for quick cross-run comparison. Each row is a metric tracked across runs. Historical mean spans R10-R20.*

| Metric | R20 | R19 | R18 | R17 | Historical Mean (R10-R20) |
|--------|----:|----:|----:|----:|:-------------------------:|
| Total findings | 16 | 16 | 15 | 19 | 17.5 |
| CRITICALs | 0 | 0 | 0 | 2 | 1.5 |
| Application rate | 100% | 94% | 80% | 100% | 96.0% |
| Drafter regressions | 3 | 0 | 2 | 2 | 1.6 |
| Corrector-1 regressions | 0 | 1 | 1 | 1 | ~0.8 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 | 0 (20/20) |
| Evidence-gating compliance | 100% | 100% | 100% | 100% | ~99% |
| False verification claims | 0 | 0 | 0 | 0 | 0 |
| Novelty-flag compliance | 76.9% | 100% | 100% | 0% | ~58% |
| Net regressions in final output | 0 | 0 | 0 | 0 | 0 |

---

## So What?

Five things a team lead should know about the pipeline's health after R20:

- **3 consecutive runs with 0 CRITICALs is a new record.** Researcher front-loading is working: thorough codebase verification before critics engage suppresses design-breaking flaws. CRITICAL density dropped from a historical mean of ~1.6 to 0 for the last 3 runs. This is the pipeline's biggest quality improvement.
- **Drafter regressions spiked to 3 (highest since R13) -- and every one was an unflagged novel claim.** The NEW_CLAIM tag mechanism is a proven regression predictor (100% of unflagged claims in R20 were defective), but compliance at 76.9% means 23% of novel claims slip through untagged. Fixing novelty-flag compliance would directly reduce Drafter regressions.
- **Evidence-gating (11/11) and Corrector-2 (20/20) are solved invariants.** Stop analyzing these. Redirect pipeline improvement effort to the two unsolved problems: Drafter regression volatility and novelty-flag compliance oscillation.
- **The consistency gate proposed in 4 consecutive retrospectives (R16-R19) has still not been implemented.** The Drafter continues to regress on complex documents at the same rate. Until the gate is built, expect 2-3 Drafter regressions per complex first-pass document.
- **Corrector-1 posted 0 regressions for the first time in 5 runs.** Promising, but a single data point against a 5-run streak of 1-per-run does not confirm a fix. Track R21 to determine if the SIDE-EFFECT-CHECK protocol is genuinely effective or if this is noise.
