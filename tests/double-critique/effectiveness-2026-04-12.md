# Double-Critique Effectiveness Report -- 2026-04-12 (R25)

**Run:** R25 (forge-harness post-v0.20.1 Next-Execution Plan)
**Prior run:** R24 (BUG-DIV-CWD Fix + Session-LLM Architectural Split)
**Prior runs analyzed:** R10-R25 (hive-mind + forge-harness series)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Corrector-2/Final)
**Note:** This file supersedes the earlier R24 effectiveness report that occupied the same date slot. R24 metrics are preserved inline in the cross-run trend tables.

---

## This Run

*What this section measures:* The raw output of R25 -- document type, finding counts, regressions, and which stages did the heavy lifting. This is the scorecard before any trend comparison.

R25 critiqued a 295-343 line architectural execution plan for forge-harness post-v0.20.1 (`.ai-workspace/plans/2026-04-12-next-execution-plan.md`). Unlike most R-series runs, the plan is **prose-only** -- no embedded test cases, no executable code blocks -- which means TC-CHECK stages are n/a and the whole load falls on the two critics.

- **Document critiqued:** `.ai-workspace/plans/2026-04-12-next-execution-plan.md` (forge-harness next-execution plan, 295->343 lines after corrections)
- **Content type:** prose-only architectural execution plan
- **Total findings:** **31** (2 CRITICAL / 14 MAJOR / 15 MINOR)
- **Application rate:** **100%** (31/31 applied) -- a series first at this finding volume
- **Drafter regressions:** 6 (from Stage 8 extraction)
- **Corrector-1 regressions:** 1 (arguable passthrough of K=5 cap from Critic-1 F4)
- **Corrector-2 regressions:** 0
- **Evidence-gating compliance:** 100% (strong; no false VERIFIED claims per Stage 8; 3 VERIFIED + 4 UNVERIFIED from Drafter, preserved verbatim by Corrector-1)
- **Novelty-flag compliance:** ~60% (6 NEW_CLAIM tags present; 4+ unflagged novel claims caught by critics -- K=5 cap, linear-sum drift formula, A1c/C1 dual-gate, bootstrap assumptions)
- **Stages that carried weight:**
  - **Critic-2** (highest) -- caught both bootstrap self-blocks (C3 C1 landing-PR self-gate; C4 K=5 cap self-blocking PH-01's 6-suspect reality) AND the CRITICAL C1 (Q0/L2 conflating rewriting with re-measurement). Invisible to every upstream stage.
  - **Critic-1** -- 16 findings (1C/7M/8m) in a broad sweep including the A2b >=5 vs A3b =6 CRITICAL off-by-one.
  - **Researcher** -- 4 factual corrections + 8 failure-mode gaps + P25/P6 citation pointer. Reduced critics' workload by ~30-40% by eliminating fact-checking burden.
- **Stages that added little:**
  - **Corrector-2** -- only 2 self-caught micro-fixes beyond mechanical application of Critic-2's findings.
  - **Corrector-1** -- zero independent findings; pure mechanical find-and-replace.

### Severity Distribution

*One-liner:* R25's severity profile compared to the two prior runs and the 15-run historical mean.

| Severity | Count | % | R24 % | R23 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----:|:-----------------:|
| CRITICAL | 2 | 6.5% | 0% | 12% | ~9% |
| MAJOR | 14 | 45% | 46% | 41% | ~41% |
| MINOR | 15 | 48.5% | 54% | 47% | ~47% |

31 findings is the second-highest count in tracked history (only R14's 26 was comparable for sheer volume; R25 eclipses it by 5). The severity mix is stable -- R25's 6.5%/45%/48.5% closely matches the historical profile despite nearly double the finding volume. Both CRITICALs were load-bearing: F1 (A2b/A3b off-by-one, Critic-1) and C1 (Q0/L2 rewrite-vs-re-measure conflation, Critic-2).

### Stages That Carried Weight vs. Added Nothing

*One-liner:* Who contributed real judgment in R25 vs. who just pushed characters through.

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Critic-2** | HEAVY (MVP) | Caught 2 bootstrap self-blocks + 1 CRITICAL measurement conflation invisible to every upstream stage. Highest single-stage value in tracked history for this run. |
| **Critic-1** | HEAVY | 16 findings, 1 CRITICAL. Broad surface cleanup -- off-by-one, non-binary ACs, uncapped data, drift-formula scramble. |
| **Researcher** | HIGH | 4 factual corrections + 8 failure-mode gaps became the Drafter's scaffolding. Reduced critics' workload by 30-40%. |
| **Drafter** | MEDIUM | Absorbed all research well but fabricated 6 new regressions + 4 unflagged novel mechanisms. Noisy but net positive. |
| **Corrector-1** | LOW | Mechanical only. 0 independent findings. Faithfully installed the K=5 cap that Critic-2 then had to flag as self-blocking. |
| **Corrector-2** | LOW-MEDIUM | Mechanical + 2 self-caught micro-fixes (C1c activates K=10 cap; Q1 `skipped-suspect` ambiguity). First sign of independent judgment from either corrector. |

---

## Cross-Run Trends

*What this section measures:* How R25 compares to every prior tracked run. If the pipeline is getting better, finding counts should drop and regression rates should improve over time. They haven't.

### Finding Volume

*One-liner:* Finding count across all 15 tracked runs -- R25 is an outlier.

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
| R22 | forge_coordinate plan | 17 | 1 | 7 | 9 | forge-harness |
| R23 | Kanban Dashboard plan | 17 | 2 | 7 | 8 | forge-harness |
| R24 | BUG-DIV-CWD + session-LLM plan | 13 | 0 | 6 | 7 | forge-harness |
| **R25** | **Next-execution plan (prose)** | **31** | **2** | **14** | **15** | **forge-harness** |

R25's 31 findings is the **highest in the entire tracked series**, 82% above the ~17 median and 19% above R14's prior peak of 26. The jump tracks the plan's prose-only structure: no embedded test cases meant every AC and every gate had to be scrutinized as free-form prose rather than mechanically checked. High finding volume does not mean the plan was bad -- it means the critics found a lot that was real (100% application rate, see below).

### Regression Tracking Table

*One-liner:* Mid-pipeline defect introduction across all runs. R25 ties the historical worst for Drafter regressions (6, last hit in R13).

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
| R22 | 1 | 2 | 0 | 100% | 70% |
| R23 | 3 | 2 | 0 | 100% | 75% |
| R24 | 0 | 0 | 0 | 100% | 100% |
| **R25** | **6** | **1** | **0** | **100%** | **~60%** |

**Drafter regressions:** 6 ties R13 for the highest in the series. Historical mean (R11R-R25): ~2.0. Regressions in R25 included the non-binary Q0/L2 wording, circular L4+L7 dogfood criteria, the K=5 cap fabricated without self-checking, linear-sum drift formula, false-negative/false-positive terminology inversion, and an unverified "25 hours" rhetorical framing. Four of the six were **unflagged novel claims** -- same root cause as R22/R23.

**Corrector-1 regressions:** 1, down from R22-R23's 2 per run but still non-zero. The lone regression (K=5 passthrough without sanity-checking against A3b's 6-suspect number in the same document) is borderline -- arguable whether it counts as a new defect or a faithful application of a bad critic suggestion. 11 of 15 tracked runs now have at least one Corrector-1 regression.

**Corrector-2 regressions:** 0. Streak extends to **25/25 runs.**

**Evidence-gating compliance:** 100% for the **16th consecutive** tracked run. Drafter's 3 VERIFIED + 4 UNVERIFIED tags were preserved verbatim by Corrector-1. Zero false VERIFIED claims across all 16.

**Novelty-flag compliance:** ~60%, matching R20 (76.9%) as the weakest code-adjacent plan run but below it. Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9% -> 100% -> 70% -> 75% -> 100% -> **60%**. R24's 100% streak is broken on the very next run. The 3-consecutive-at-100% threshold remains unmet after 15 runs. Four unflagged novel claims -- K=5 cap (F4), linear-sum drift formula (F7), A1c/C1 dual-gate (C7), bootstrap assumptions (C3/C4) -- were all load-bearing defects the critics had to catch.

### Application Rate Trend

*One-liner:* What fraction of critic findings make it into the final document. High = findings were real; low = critics were noisy.

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
| R19 | 94% |
| R20 | 100% |
| R21 | 94% |
| R22 | 100% |
| R23 | 100% |
| R24 | 77% |
| **R25** | **100%** |

R25's 100% application rate on a 31-finding run is unprecedented. Nine prior runs hit 100% but on 13-19 findings; R25 hits 100% on 31. **This is the largest volume of load-bearing findings in tracked history.** Two independent critics both independently triggered on the "bootstrap self-block" pattern -- Critic-1 R1 F3 (Q0/L4 self-satisfaction) and Critic-2 C3/C4 (C1 landing PR and K=5 cap). Two cold reads hitting the same class of defect is strong evidence the critics found real issues rather than nitpicks.

### Recurring Finding Types

Looking across R22-R25, the same finding classes keep reappearing:
- **Non-binary AC language** (R22, R23, R25 F2) -- Drafter writes "clearly labeled" / "reasonable" / "reduces to 0 OR human-judgment remnants"
- **Uncapped quantities / fabricated caps** (R23, R25 F4) -- Drafter fabricates K=5 / linear-sum formulas without a source
- **Circular verification criteria** (R20, R25 F3) -- L4+L7 self-trivializing via baseline path
- **Unflagged novel claims as most dangerous defects** (R22, R23, R25) -- the unflagged mechanisms are disproportionately the ones critics have to fix

These are the same four failure modes retrospectives have been documenting for 8-9 consecutive runs.

---

## Stage Effectiveness Rankings

*What this section measures:* Each stage's contribution in R25 and whether its trajectory is improving, holding, or slipping across the recent series.

| Rank | Stage | Contribution | Trend | Notes |
|------|-------|:------------:|:-----:|-------|
| 1 | **Critic-2** | HIGH | STABLE | 11th consecutive run catching errors all prior stages missed. R25 MVP: 2 bootstrap self-blocks + the CRITICAL measurement conflation. Single highest-value stage in the run. |
| 2 | **Critic-1** | HIGH | STABLE | 11th consecutive run as top-2 stage. 16 R25 findings (1C/7M/8m). Broad sweep of surface-level defects. |
| 3 | **Researcher** | HIGH | STABLE | 4 factual corrections + 8 failure-mode gaps reduced critics' workload ~30-40%. Clean: 0 false positives. |
| 4 | **Corrector-2** | MEDIUM | STABLE | Zero regressions (25/25). 2 self-caught micro-fixes is the first sign of independent judgment from either corrector stage in recent runs. |
| 5 | **Drafter** | MEDIUM | DECLINING | 6 regressions + ~60% novelty-flag compliance. Worst Drafter run since R13. Reverts the 100%/0-reg pattern from R24. |
| 6 | **Corrector-1** | LOW | STABLE | Pure mechanical typist. 0 independent findings. The K=5 passthrough shows why a sanity-check pass would catch more than SIDE-EFFECT-CHECK does. |

---

## What's Working

*What this section measures:* Behaviors that have produced value across multiple runs -- the invariants you can stop worrying about.

### 1. Evidence-Gating Is a Solved Invariant (16/16 runs at 100%)
Zero fabricated VERIFIED claims across 16 tracked runs. R25: Drafter's 3 VERIFIED + 4 UNVERIFIED tags with file:line citations, preserved verbatim by Corrector-1. Stop monitoring this.

### 2. Corrector-2 Zero-Regression Streak (25/25 runs)
Extended by 1. The most robust invariant in the pipeline.

### 3. Critic Complementarity (9th consecutive run with no overlap)
R25: Critic-1 found surface-level defects (off-by-one, non-binary language, drift formula). Critic-2 found bootstrap reasoning gaps (self-blocks, measurement conflation). Zero overlap, genuinely different functions.

### 4. Net Regressions in Final Output: 0 (16/16 runs)
R25 introduced 7 mid-pipeline regressions (6 Drafter + 1 Corrector-1). All were caught. The pipeline has never shipped a regression.

### 5. Researcher Front-Loading Reduces Critic Workload
R25 evidence: Stage-8 extraction estimates critics would have burned 30-40% of their findings on factual fact-checking without the Researcher. Consistent with R22-R24 observations. High Researcher effort reliably suppresses CRITICALs and lets critics focus on structural reasoning.

### 6. Two Independent Cold Reads Catch Bootstrap Self-Blocks
Critic-1's F3 (Q0/L4 self-satisfaction) and Critic-2's C3/C4 (C1 landing PR + K=5 cap) are the same class of defect found independently. This is a **new** What's-Working item specific to R25, not yet established as a cross-run pattern -- needs R26+ confirmation before calling it a recurring strength.

---

## What's Not Working

*What this section measures:* Behaviors that consistently fail or introduce defects -- what actually needs fixing.

### 1. Drafter Regressions Spiked to 6 -- Series-High Tie
R25's 6 regressions ties R13 for the highest in 15 tracked runs. Historical mean ~2.0; R25 is 3x the mean. Four of the six were **unflagged novel claims** -- Drafter fabricated new mechanisms (K=5, linear-sum drift, dual-gate) without NEW_CLAIM tags. This is the same root cause as R22 (1 regression / 70% compliance), R23 (3 / 75%), and R20 (3 / 76.9%).

### 2. Novelty-Flag Compliance Collapsed From 100% to 60% In One Run
R24 hit 100%, R25 hit ~60%. The mechanism is non-stable: it works when the Drafter happens to be careful and fails catastrophically otherwise. Six of 15 runs are below 80%. The 3-consecutive-at-100% threshold has never been met. This is the **9th consecutive retrospective** recommending the novelty-flag redesign.

### 3. Same Finding Classes Keep Recurring
R22-R25 all produced the same four classes: non-binary AC language, uncapped/fabricated caps, circular self-trivializing criteria, and unflagged novel claims. The pipeline catches them each time; the Drafter generates them each time. Detection capability is stable; prevention is not.

### 4. Corrector Stages Are Still Mechanical Typists
Stage-8 extraction for R25: "Neither corrector stage contributed independent findings (Corrector-1 = 0; Final corrector = 2 self-caught micro-fixes)." Same observation as R17, R23, R24. The correctors are cost-justified only because edit volumes are too large to inline into critic outputs. A single merged critic-corrector agent could plausibly do the same work for half the cost.

### 5. 100% Application Rate at 31 Findings -- Possible Under-Critical Critics
*Caveat:* 100% application on 31 findings is either (a) evidence critics found only real issues, or (b) evidence critics are converging on the same "safe" finding classes and missing whole categories of defect. R25's extraction defends (a) citing the independent bootstrap self-block catches. Track R26-R28 to see if the 100% rate persists on plans without such a load-bearing pattern -- if it does on simpler plans, that may signal (b).

### 6. Process Change Debt: 10th Retrospective for Consistency Gate
Drafter consistency gate: 10 consecutive retrospectives. Novelty-flag redesign: 9 consecutive retrospectives. R25's 6 regressions + 60% compliance + recurring finding classes are the **strongest single-run case** for implementing both gates. Either implement them or formally accept the current regression rates.

---

## Derived Metrics

*One-liner:* Headline numbers for R25 next to the three most recent runs and the 16-run historical mean.

| Metric | R25 | R24 | R23 | R22 | Historical Mean (R10-R25) |
|--------|----:|----:|----:|----:|:-------------------------:|
| Total findings | 31 | 13 | 17 | 17 | 18.1 |
| CRITICALs | 2 | 0 | 2 | 1 | 1.4 |
| Application rate | 100% | 77% | 100% | 100% | 94.8% |
| Drafter regressions | 6 | 0 | 3 | 1 | 2.0 |
| Corrector-1 regressions | 1 | 0 | 2 | 2 | ~0.9 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 | 0 (25/25) |
| Evidence-gating compliance | 100% | 100% | 100% | 100% | ~99% |
| False verification claims | 0 | 0 | 0 | 1* | ~0.1 |
| Novelty-flag compliance | ~60% | 100% | 75% | 70% | ~61% |
| Net regressions in final output | 0 | 0 | 0 | 0 | 0 |

---

## So What?

- **R25 produced the highest finding count (31) and highest Drafter regression count (6, tied) in tracked history, but still shipped with 0 net regressions.** The safety net held, but it was stressed harder than any prior run. 100% application rate on 31 findings is unprecedented and driven by two independent critics both catching "bootstrap self-block" defects -- real structural issues, not nitpicks.

- **R24's 100% novelty-flag compliance was a one-run peak, not a trend.** R25 collapsed to ~60%, and 4 of the 6 Drafter regressions are unflagged novel claims (K=5 cap, linear-sum drift, dual-gate mechanism, bootstrap assumptions). The mechanism remains unstable -- six sub-80% runs out of 15 tracked. The 3-consecutive-at-100% threshold has never been met.

- **The same four failure modes have recurred across R22-R25: non-binary AC language, fabricated uncapped quantities, circular self-trivializing criteria, and unflagged novel claims.** The pipeline catches them each run; the Drafter generates them each run. Detection is stable; prevention hasn't improved in 4 runs.

- **Evidence-gating (16/16) and Corrector-2 (25/25) are solved. Stop monitoring.** All improvement effort should target (1) Drafter novel-claim fabrication, (2) Corrector-1 structural reform (it contributed 0 independent findings yet again), and (3) novelty-flag convergence.

- **Process-change debt is at 10 retrospectives for the consistency gate and 9 for the novelty-flag redesign.** R25 is the strongest case yet for implementing both. Either ship the gates or formally accept a ~2.0 Drafter-regression-per-run baseline as the cost of doing business.
