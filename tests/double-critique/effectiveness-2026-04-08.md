# Double-Critique Effectiveness Report -- 2026-04-08

**Run:** R22 (forge_coordinate Implementation Plan)
**Prior run:** R21 (Build Three-Tier Document System Into forge_plan)
**Prior runs analyzed:** R10-R22 (hive-mind + forge-harness series)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Corrector-2)

---

## This Run

R22 critiqued a forge_coordinate implementation plan -- a large code-adjacent plan with 20 stories across 4 phases, concrete TypeScript interfaces, phase transition logic, and codebase-dependent design decisions. The pipeline's deepest finding (CRITICAL: handleStoryEval has no writeRunRecord call) required 5 stages to surface, exposing the gap between verifying that an interface exists and verifying that a code path executes.

- **Document critiqued:** forge_coordinate implementation plan (`C:\Users\ziyil\coding_projects\forge-harness\tmp\dc-8-extractor.md`)
- **Content type:** includes-TCs (TypeScript interfaces, phase-story breakdowns, design decisions, state-source specifications, failure-mode handling)
- **Total findings:** 17 (1 CRITICAL / 7 MAJOR / 9 MINOR)
  - Researcher: 6 MAJOR, 5 MINOR, 10 failure modes (fed into Drafter)
  - Critic-1: 10 findings (0 CRITICAL, 4 MAJOR, 6 MINOR)
  - Critic-2: 7 findings (1 CRITICAL, 3 MAJOR, 3 MINOR)
- **Application rate:** 100% (all 17 findings applied across both corrector rounds)
- **Drafter regressions:** 1 (introduced infeasible phase auto-detection feature; story count header mismatch is cosmetic)
- **Corrector-1 regressions:** 2 (propagated infeasible auto-detection + understated US-00 scope as "mechanical" one-liner when it requires ~25 lines of RunContext infrastructure)
- **Evidence-gating compliance:** 100% (7 VERIFIED + 1 UNVERIFIED by Drafter, all with file:line citations; 10 VERIFIED + 1 UNVERIFIED + 1 misleading by Corrector-1; 0 bare "I verified" claims)
- **False verification claims:** 1 (Corrector-1 verified evaluate.ts lines 200-217 which are in handleCoherenceEval, not handleStoryEval -- correct lines, wrong handler, wrong conclusion about US-00 scope)
- **Novelty-flag compliance:** 70% (7 NEW_CLAIM tags / (7 tags + 3 unflagged novel claims caught by critics))
- **Notable:** The 1 false verification is a new class -- semantically misleading evidence where the cited code is real but drawn from the wrong code path. This is the first mechanical evidence-gating failure since R12 (which was 95% compliance with 0 fabrication).

### Severity Distribution

| Severity | Count | % | R21 % | R20 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----:|:-----------------:|
| CRITICAL | 1 | 6% | 6% | 0% | ~10% |
| MAJOR | 7 | 41% | 41% | 44% | ~41% |
| MINOR | 9 | 53% | 53% | 56% | ~46% |

R22's severity profile (6/41/53) is nearly identical to R21 (6/41/53). The 1 CRITICAL (handleStoryEval infrastructure gap) is a genuine code-path-level flaw, not a meta-level gap like R21's missing outcome AC. MAJOR share at 41% matches the historical mean exactly. The pipeline is producing a stable severity distribution on code-adjacent implementation plans.

### Stages That Carried Weight vs. Added Nothing

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Critic-2** | HEAVY | MVP. Caught the only CRITICAL (handleStoryEval has no writeRunRecord call) that 4 prior stages missed. Also caught infeasible auto-detection and schema incompatibility. Highest value-per-token in the pipeline. |
| **Drafter** | HEAVY | Did the bulk of structural work: concrete interfaces, phase reordering, new functions, story additions. The document would be unshippable without the Drafter's contributions. But introduced 1 regression. |
| **Corrector-2** | HEAVY | Applied all 7 Critic-2 findings with zero regressions. Rewrote US-00 to specify full RunContext infrastructure. Added tagged discriminated union and Budget Design section. |
| **Researcher** | HIGH | 21 factual claims verified with file/line evidence. Caught the storyId gap and 6 failure modes. But missed write-side and dual-system issues. Verification depth insufficient for code-path analysis. |
| **Critic-1** | HIGH | 10 findings, 4 MAJOR. Caught write-side field gap and story count error. But stopped one level too shallow -- checked that fields exist, not that the code path runs. 3 of 4 MAJORs were refined/overturned by Critic-2. |
| **Corrector-1** | MEDIUM | Applied 9/10 Critic-1 findings and discovered the dual RunRecord system (genuine new discovery). But introduced 2 regressions (infeasible auto-detection + understated US-00 scope). |

No stage added nothing. All 6 produced unique value. The two-critic design earned its keep: Corrector-1's fixes introduced 2 new problems, and only Critic-2 caught them.

---

## Cross-Run Trends

The pipeline has now completed 13 tracked runs. R22 returns to a code-heavy implementation plan after R21's three-tier system plan, providing a direct comparison to R15-R16 (also code-heavy feature plans).

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
| R21 | Three-tier system plan | 17 | 1 | 7 | 9 | forge-harness |
| **R22** | **forge_coordinate plan** | **17** | **1** | **7** | **9** | **forge-harness** |

R22 finding count (17) matches R21, R15, R16, and the series median. The 1 CRITICAL breaks the R18-R20 zero-CRITICAL streak for the second time (R21 also had 1). MAJOR/MINOR split (7/9) is identical to R21, suggesting a stable baseline for code-adjacent implementation plans with design decisions.

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
| R21 | 0 | 1 | 0 | 100% | 100% |
| **R22** | **1** | **2** | **0** | **100%** | **70%** |

**Drafter regressions:** 1, down from R20's 3 and below the historical mean (~1.5). R22 had one substantive regression (infeasible auto-detection feature). R21's 0 regressions on a complex document suggested novelty-flag compliance was the mechanism; R22 at 70% novelty-flag and 1 regression provides weak supporting evidence (lower compliance correlates with more regressions, but N=1). Across R11R-R22: mean 1.5, median 2. The Drafter remains volatile: 0, 3, 0, 1 across the last 4 runs.

**Corrector-1 regressions:** 2, the highest since R13 (which also had 2). This breaks the 1-per-run baseline that held for R15-R19 and R21. R22's regressions are: (1) propagating an infeasible feature without checking feasibility, and (2) understating US-00 scope despite actively editing the section. These are judgment-class errors, consistent with the pattern that each run produces a different regression class. Updated class list: platform (R15), cross-reference (R16), self-review arithmetic (R17), arithmetic propagation (R18), analytical judgment (R19), over-correction (R21), feasibility propagation + scope understatement (R22).

**Corrector-2 regressions:** 0, extending the streak to **22/22 runs**.

**Evidence-gating compliance:** 100% by the format definition (all claims used VERIFIED/UNVERIFIED tags with citations). However, R22 produced the first **semantically misleading verification** -- Corrector-1 cited real lines from the wrong handler. The format caught surface-level errors but not semantic mismatch. This is the same class of limitation exposed in R17 (arithmetic self-review false positive), now manifesting in code-path verification. Mechanical compliance: 100% for the 13th consecutive run. Semantic accuracy: <100% for the first time since R12.

**Novelty-flag compliance:** 70%, the lowest since R17's 0%. Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9% -> 100% -> 70%. The 3 unflagged novel claims included the phase auto-detection logic, the readAuditEntries move, and the US-00 scope characterization. The most consequential unflagged claim (US-00 as "mechanical") became the pipeline's CRITICAL finding. The strict 3-consecutive-at-100% threshold remains unmet.

### Are the Same Types of Findings Recurring?

Yes, all four established recurring types appeared in R22:

1. **Completeness gaps**: No write-side code for new RunRecord fields, no handler calling writeRunRecord for story evaluation. Present in every run.
2. **Internal contradictions / scope mismatches**: US-00 described as "mechanical" one-liner requiring ~25 lines of infrastructure. Documents with complex codebase interactions consistently produce these.
3. **Code-path depth insufficiency**: The Researcher verified "evaluate.ts calls writeRunRecord" without checking WHICH handler. Same class as R16's `readOnlyHint` annotation miss and R21's callClaude count error -- verifying at the file level rather than the function level.
4. **Infeasible feature proposals**: Auto-detection requiring MasterPlan.Phase.planPath which does not exist. Same class as R20's "oldest/lowest-priority" truncation with no priority field.

New finding: **Dual-system discovery latency**. The generator.ts JSONL vs run-record.ts JSON dual RunRecord system was not discovered until Corrector-1 (Stage 4). This mirrors R17's 7 missing items (discovered at Critic-2) and R20's callClaude count (discovered at Critic-2). Architectural-scope discoveries consistently arrive in the second half of the pipeline.

### Is the Pipeline Finding Fewer Issues Over Time?

No. Finding count: 15 -> 18 -> 17 -> 16 -> 26 -> 17 -> 17 -> 19 -> 15 -> 16 -> 16 -> 17 -> 17. Mean: 17.4. R22 at 17 is at the mean. The pipeline's detection capability remains consistent. CRITICAL density is low (2 of the last 5 runs had 1 CRITICAL, 3 had 0), which is an improvement over the historical mean of ~1.5, but finding volume is flat.

---

## Stage Effectiveness Rankings

| Rank | Stage | Contribution | Trend (vs R21) | Notes |
|------|-------|:------------:|:--------------:|-------|
| 1 | **Critic-2** | HIGH | STABLE | 8th consecutive run catching errors all prior stages missed. Found the CRITICAL + 3 MAJORs. Pipeline's essential safety net. |
| 2 | **Critic-1** | HIGH | STABLE | 8th consecutive run as top-2 stage. 10 findings (4 MAJOR). Caught write-side field gap but stopped one level too shallow for code-path verification. |
| 3 | **Corrector-2** | HIGH | STABLE | Zero regressions (22/22). Applied all 7 findings cleanly. Rewrote US-00 with full infrastructure spec. Sustained HIGH for 6th consecutive run. |
| 4 | **Researcher** | HIGH | STABLE | 21 verified claims, 6 MAJOR findings, 10 failure modes. Solid grounding but code-path depth insufficient -- verified interfaces, not call sites. |
| 5 | **Drafter** | MEDIUM | DOWN (from HIGH) | Heavy structural work but introduced 1 regression (infeasible auto-detection). 70% novelty-flag compliance. R21's 0-regression HIGH performance not sustained. |
| 6 | **Corrector-1** | MEDIUM-LOW | DOWN (from MEDIUM) | Applied 9/10 findings and discovered dual RunRecord system (genuine value), but introduced 2 regressions -- the highest since R13. Misleading verification claim is a new failure class. |

---

## What's Working

Each item describes a pipeline behavior that consistently produces value, backed by data from multiple runs.

### 1. Evidence-Gating Mechanical Compliance Is a Solved Invariant (13/13 runs at 100%)
Zero bare "I verified" claims across 13 tracked runs. R22: 7 Drafter VERIFIED + 10 Corrector-1 VERIFIED, all with file:line citations. The format itself is fully internalized.

### 2. Corrector-2 Zero-Regression Streak (22/22 runs)
R22: applied all 7 Critic-2 findings including a full US-00 rewrite, tagged discriminated union, and Budget Design section. Zero regressions. The most robust pipeline invariant.

### 3. Critic Finding Complementarity (6th consecutive run with 0 overlap)
R17-R22: zero finding overlap between Critic-1 and Critic-2. In R22, Critic-1 found the write-side field gap, topoSort ambiguity, and budget mechanism mismatch. Critic-2 found the handleStoryEval infrastructure gap, infeasible auto-detection, schema incompatibility, and detectCycles type mismatch. Neither subsumes the other.

### 4. Net Regressions in Final Output: 0 (13/13 runs)
R22 introduced 3 regressions mid-pipeline (1 Drafter, 2 Corrector-1). All were caught and fixed by downstream stages before the final document. The pipeline has never shipped a regression in 13 tracked runs.

### 5. Two-Critic Architecture Justifies Its Cost
R22 is the clearest demonstration: Corrector-1 introduced 2 regressions (including a CRITICAL scope underestimate), and only Critic-2 caught them. A single-critic pipeline would have shipped a plan with US-00 scoped as a one-liner when it requires ~25 lines of RunContext infrastructure.

### 6. Researcher Front-Loading Continues to Suppress Design-Breaking Flaws
R22's Researcher verified 21 claims and identified the storyId gap -- the foundational structural finding. Without this, the Drafter would have built on false assumptions about the RunRecord schema. CRITICAL rates for the last 5 runs: 0, 0, 0, 1, 1 (mean 0.4 vs historical mean ~1.5).

---

## What's Not Working

Each item describes a pipeline behavior that consistently underperforms, with evidence.

### 1. Novelty-Flag Compliance Oscillates With No Convergence
Progression across R11R-R22: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9% -> 100% -> 70%. R22 drops to 70% -- the lowest since R17's 0%. The 3-consecutive-at-100% threshold has never been met. One of R22's unflagged claims (US-00 scope characterization) became the CRITICAL finding. The mechanism is a proven regression predictor when enforced (R20: 100% of unflagged claims were defective; R22: the most consequential unflagged claim became the CRITICAL), but compliance remains unreliable.

### 2. Corrector-1 Regressions Spiked to 2 (Highest Since R13)
R22 breaks the 1-per-run baseline (R15-R19, R21) with 2 regressions. 9 of 12 tracked runs have at least 1 Corrector-1 regression. R22 adds 2 new regression classes (feasibility propagation, scope understatement) to the growing list (now 8 distinct classes). No single process fix addresses all classes. The SIDE-EFFECT-CHECK protocol did not prevent either regression.

### 3. Evidence-Gating Has a Semantic Accuracy Gap
R22 produced the first semantically misleading verification: Corrector-1 cited real lines from handleCoherenceEval (lines 200-217) to verify a claim about handleStoryEval's behavior. The format was followed perfectly -- VERIFIED tag, file path, line numbers -- but the conclusion was wrong because the wrong code path was examined. Mechanical compliance: 100%. Semantic accuracy: <100%. This is the same limitation class as R17's arithmetic self-review false positive, but now manifesting as code-path mismatch.

### 4. Researcher Verification Depth Is Insufficient for Code-Path Analysis
R22's Researcher verified "evaluate.ts calls writeRunRecord" without checking which handler makes the call. This is the same depth-limitation noted in R16 (missed `readOnlyHint` annotation), R20 (missed ProgressReporter stage count), and R21 (missed callClaude count). The Researcher checks that interfaces/functions exist but does not trace which code paths invoke them. On code-heavy plans, this leaves the most consequential gaps for late-stage discovery.

### 5. Process Change Debt Continues (7th Retrospective for Consistency Gate)
The Drafter consistency gate has been recommended in 7 consecutive retrospectives (R16-R22). The novelty-flag redesign has been recommended in 6 (R17-R22). Neither has been implemented. R22's results reinforce both recommendations: 70% novelty compliance and 1 Drafter regression on a complex first-pass document.

---

## Derived Metrics

| Metric | R22 | R21 | R20 | R19 | Historical Mean (R10-R22) |
|--------|----:|----:|----:|----:|:-------------------------:|
| Total findings | 17 | 17 | 16 | 16 | 17.4 |
| CRITICALs | 1 | 1 | 0 | 0 | 1.4 |
| Application rate | 100% | 94% | 100% | 94% | 95.8% |
| Drafter regressions | 1 | 0 | 3 | 0 | 1.5 |
| Corrector-1 regressions | 2 | 1 | 0 | 1 | ~0.9 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 | 0 (22/22) |
| Evidence-gating compliance | 100% | 100% | 100% | 100% | ~99% |
| False verification claims | 1* | 0 | 0 | 0 | ~0.1 |
| Novelty-flag compliance | 70% | 100% | 76.9% | 100% | ~60% |
| Net regressions in final output | 0 | 0 | 0 | 0 | 0 |

*\*Semantically misleading, not mechanically fabricated. Format compliance was 100%.*

---

## So What?

Five things a team lead should know about the pipeline's health after R22:

- **Evidence-gating has a semantic accuracy gap that format compliance cannot catch.** R22's Corrector-1 cited real lines from the wrong handler to verify a claim about US-00 scope. The VERIFIED tag, file path, and line numbers were all present and correct -- but the conclusion was wrong. This is the pipeline's most interesting new finding: evidence-gating works for mechanical verification but does not prevent semantic mismatch when the verifier examines the wrong code path. Feasibility claims about code changes need a different verification protocol (e.g., "trace the call chain" rather than "grep for the function name").

- **Corrector-1 regressions spiked to 2, the worst since R13.** The SIDE-EFFECT-CHECK protocol -- which appeared effective in R20 (0 regressions) -- did not prevent either R22 regression. Across 12 tracked runs, 8 distinct regression classes have appeared, and no instruction-level intervention has reduced the rate. The Corrector-1 problem is structural: the stage lacks the context window or multi-pass capacity to cross-reference its own changes against the full document.

- **Novelty-flag compliance dropped to 70%, and the most consequential unflagged claim became the CRITICAL.** The phase auto-detection, the readAuditEntries move, and the US-00 scope characterization were all unflagged. The last of these became the pipeline's highest-severity finding. Across 12 runs, compliance has hit 100% five times and dropped below 80% five times. The mechanism works when enforced but is not reliably self-enforced.

- **The two-critic architecture earned its keep again.** Corrector-1 introduced 2 regressions (including a CRITICAL scope underestimate for US-00). Only Critic-2, seeing the document cold, caught both. A single-critic pipeline would have shipped a plan where a 25-line infrastructure change was scoped as a one-liner. This is the 6th consecutive run (R17-R22) with zero finding overlap between critics.

- **Process change debt is now at 7 retrospectives.** The Drafter consistency gate has been recommended since R16. The novelty-flag redesign has been recommended since R17. Neither has been implemented. The retrospective process is documenting the same problems repeatedly without driving change. Either implement the gates or explicitly accept the current regression rates as the cost of the 6-stage architecture.
