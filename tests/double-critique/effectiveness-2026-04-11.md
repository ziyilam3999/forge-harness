# Double-Critique Effectiveness Report -- 2026-04-11

**Run:** R23 (Kanban Dashboard for forge_coordinate)
**Prior run:** R22 (forge_coordinate Implementation Plan)
**Prior runs analyzed:** R10-R23 (hive-mind + forge-harness series)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Final/Corrector-2)

---

## This Run

R23 critiqued a Kanban Dashboard implementation plan for forge_coordinate -- a UI-heavy plan with ASCII mockups, design-system compliance checks, activity feed rendering, and 11 ACs expanding to 16. The pipeline's deepest finding (CRITICAL: coordinate-brief.json does not exist) required 5 stages to fully surface, exposing a fabricated codebase claim that survived the Drafter, Critic-1, and Corrector-1 before Critic-2 debunked it.

- **Document critiqued:** Kanban Dashboard for forge_coordinate (`C:\Users\ziyil\coding_projects\forge-harness\tmp\dc-8-extractor.md`)
- **Content type:** includes-TCs (design decisions, ASCII mockups, Card Variants table, AC commands, design-system compliance, activity feed rendering)
- **Total findings:** 17 (2 CRITICAL / 7 MAJOR / 8 MINOR)
  - Researcher: 10 findings + 8 codebase claims verified + 12 design-system rules checked + 6 pattern citations verified (fed into Drafter)
  - Critic-1: 10 findings (1 CRITICAL, 4 MAJOR, 5 MINOR)
  - Critic-2: 7 findings (1 CRITICAL, 3 MAJOR, 3 MINOR)
- **Application rate:** 100% (all 17 findings applied across both corrector rounds)
- **Drafter regressions:** 3
  1. AC-03 logically inverted indexOf assertion (column order puts col-retry before col-done)
  2. Audit feed "single most recent file" strategy contradicts mockup showing interleaved tool entries
  3. Fabricated claim: "The coordinator already writes coordinate-brief.json" -- no VERIFIED tag, no evidence
- **Corrector-1 regressions:** 2
  1. "Last line from each file" audit strategy -- new but still incorrect (JSONL files contain many entries per file)
  2. Left fabricated coordinate-brief.json claim in main body despite flagging it as UNVERIFIED in notes
- **Evidence-gating compliance:** 100% (VERIFIED tags with file:line citations used extensively by Drafter and Corrector-1; the fabricated coordinate-brief.json claim conspicuously lacked a VERIFIED tag, which is how the system should work -- ungated claims are suspect)
- **False verification claims:** 0 (no mechanically fabricated VERIFIED claims; the coordinate-brief.json claim was untagged, not falsely tagged)
- **Novelty-flag compliance:** 75% (3 NEW_CLAIM tags used correctly; 1 unflagged novel claim -- "coordinator already writes coordinate-brief.json" -- was the most dangerous defect in the document)

### Severity Distribution

| Severity | Count | % | R22 % | R21 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----:|:-----------------:|
| CRITICAL | 2 | 12% | 6% | 6% | ~10% |
| MAJOR | 7 | 41% | 41% | 41% | ~41% |
| MINOR | 8 | 47% | 53% | 53% | ~46% |

R23 returns to 2 CRITICALs, matching R17 and the historical mean (~10%). The 2 CRITICALs (coordinate-brief.json fabrication and HH:MM:SS midnight comparison) are both correctness-level flaws -- one a phantom data source, one a broken string comparison. MAJOR share at 41% matches the historical mean exactly for the 3rd consecutive run. MINOR share dropped slightly to 47%, closer to the historical mean (~46%).

### Stages That Carried Weight vs. Added Nothing

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Critic-2** | HEAVY | MVP. Caught the CRITICAL coordinate-brief.json fabrication, the Corrector-1 "last line" regression, AuditEntry schema mismatch, and ProgressReporter missing projectPath. Most impactful single stage. |
| **Critic-1** | HEAVY | 10 findings (1 CRITICAL, 4 MAJOR). Caught AC-03 logic error, audit feed contradiction, renderDashboard data flow gap, midnight comparison bug. Every finding valid and actionable. |
| **Researcher** | HIGH | Front-loaded verification of 8 codebase claims, 12 design-system rules, 6 pattern citations. Identified error handling, crash recovery, concurrent execution, and Windows rename gaps. But missed 6 significant data-flow findings that critics caught. |
| **Corrector-2/Final** | HEAVY | Applied all 7 Critic-2 findings cleanly. Added Hook 0 for coordinate-brief.json, redesigned activity feed for actual AuditEntry fields, added 5 new ACs (AC-14 through AC-16). Zero regressions (23/23). |
| **Drafter** | MEDIUM | Heavy structural work (395-line plan, evidence-gated verification, NEW_CLAIM tags). But introduced 3 regressions including a fabricated codebase claim. |
| **Corrector-1** | LOW-MEDIUM | Applied all 10 Critic-1 findings mechanically but introduced 2 regressions. Left a known false claim unfixed in main body despite flagging it in notes. Weakest link in this run. |

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
| R21 | Three-tier system plan | 17 | 1 | 7 | 9 | forge-harness |
| R22 | forge_coordinate plan | 17 | 1 | 7 | 9 | forge-harness |
| **R23** | **Kanban Dashboard plan** | **17** | **2** | **7** | **8** | **forge-harness** |

R23 finding count (17) matches the series median and the last 4 runs (R21-R22: 17 each). The 2 CRITICALs break the low-CRITICAL trend of R18-R22 (0, 0, 0, 1, 1) and return to the historical mean. The MAJOR/MINOR split (7/8) is within 1 of R21-R22's 7/9, confirming a stable baseline for code-adjacent implementation plans.

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
| R22 | 1 | 2 | 0 | 100% | 70% |
| **R23** | **3** | **2** | **0** | **100%** | **75%** |

**Drafter regressions:** 3, the highest since R20 (3) and tied with R12 (3). Only R13 (6) was worse. Historical mean across R11R-R23: ~1.6. R23's regressions include a fabricated codebase claim -- a new class for the Drafter. The pattern continues: complex first-pass documents with multiple interacting sections (UI mockup + data flow + ACs + design-system compliance) produce 2-6 Drafter regressions. Simple or pre-critiqued documents produce 0.

**Corrector-1 regressions:** 2, matching R22. This is the 2nd consecutive run at 2, and the 2nd-highest value in the series (tied with R13). 10 of 13 tracked runs have at least 1 Corrector-1 regression. R23 adds a new regression class: "acknowledged gap unfixed" (flagged coordinate-brief.json as UNVERIFIED in notes but left the false claim in the main body). Updated class count: 9 distinct regression classes across 13 runs.

**Corrector-2 regressions:** 0, extending the streak to **23/23 runs**.

**Evidence-gating compliance:** 100% for the **14th consecutive** tracked run. Zero fabricated VERIFIED claims. The coordinate-brief.json fabrication was an untagged claim, not a falsely tagged one -- the evidence-gating system correctly left it ungated. Mechanical compliance remains perfect.

**Novelty-flag compliance:** 75%, matching R16 and near R20 (76.9%) and R22 (70%). Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9% -> 100% -> 70% -> 75%. The 3-consecutive-at-100% threshold remains unmet. The single unflagged claim was the most dangerous defect in the document (fabricated coordinate-brief.json), consistent with R20 and R22 where unflagged claims were disproportionately defective.

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
| R19 | 94% |
| R20 | 100% |
| R21 | 94% |
| R22 | 100% |
| **R23** | **100%** |

R23 at 100%. Historical mean: ~95.9%.

---

## Stage Effectiveness Rankings

| Rank | Stage | Contribution | Trend (vs R22) | Notes |
|------|-------|:------------:|:--------------:|-------|
| 1 | **Critic-2** | HIGH | STABLE | 9th consecutive run catching errors all prior stages missed. Found the CRITICAL coordinate-brief.json fabrication + 3 MAJORs. Pipeline's essential safety net. |
| 2 | **Critic-1** | HIGH | STABLE | 9th consecutive run as top-2 stage. 10 findings (1 CRITICAL, 4 MAJOR). Caught AC-03 logic error, midnight comparison bug. Analytical backbone. |
| 3 | **Corrector-2** | HIGH | STABLE | Zero regressions (23/23). Applied all 7 findings, added 5 new ACs, redesigned activity feed. Sustained HIGH for 7th consecutive run. |
| 4 | **Researcher** | HIGH | STABLE | Front-loaded 8 claim verifications, 12 design-system checks, 6 pattern citations. Eliminated an entire class of surface-level errors. But missed 6 data-flow gaps. |
| 5 | **Drafter** | MEDIUM | STABLE | Heavy structural work (395 lines) but 3 regressions including a fabricated claim. 75% novelty-flag compliance. Volatile performer -- matches R22's MEDIUM. |
| 6 | **Corrector-1** | LOW-MEDIUM | STABLE | Applied all 10 fixes mechanically but introduced 2 regressions. "Acknowledged gap unfixed" is a new failure class. 2nd consecutive run at 2 regressions. |

---

## What's Working

### 1. Evidence-Gating Is a Solved Invariant (14/14 runs at 100%)
Zero fabricated VERIFIED claims across 14 tracked runs. R23's most dangerous defect (coordinate-brief.json fabrication) was correctly left *ungated* -- no VERIFIED tag -- which is exactly how the system should work: ungated claims become suspect. **14 data points at 100% compliance, 0 fabrication each.**

### 2. Corrector-2 Zero-Regression Streak (23/23 runs)
R23: applied all 7 Critic-2 findings, added Hook 0, redesigned activity feed with actual AuditEntry fields, added 5 new ACs, introduced 0 regressions. This remains the pipeline's most robust invariant.

### 3. Critic Finding Complementarity (7th consecutive run with 0 overlap)
R17-R23: zero finding overlap between Critic-1 and Critic-2. In R23: Critic-1 found logic errors and specification contradictions (AC-03, audit feed, midnight comparison). Critic-2 found codebase-reality gaps (coordinate-brief.json existence, AuditEntry schema, ProgressReporter constructor). The critics serve genuinely different functions: specification consistency (Critic-1) vs codebase ground-truth (Critic-2).

### 4. Net Regressions in Final Output: 0 (14/14 runs)
R23 introduced 5 regressions mid-pipeline (3 Drafter, 2 Corrector-1). All were caught and fixed by downstream stages. The pipeline has never shipped a regression in 14 tracked runs. The safety net holds even when upstream stages perform poorly.

### 5. Two-Critic Architecture Catches Corrector-1 Failures
R23: Corrector-1 left the coordinate-brief.json false claim in the main body (regression #2). Only Critic-2 caught it. R22: Corrector-1 introduced 2 regressions, only Critic-2 caught them. 2 consecutive runs where the two-critic architecture was the only mechanism preventing Corrector-1 regressions from shipping.

### 6. Researcher Eliminates Surface-Level Error Classes
R23: Researcher verified 8 codebase claims, 12 design-system rules, 6 pattern citations. None were re-challenged by either critic. This front-loading allowed critics to focus on architectural and logical issues (data flow, schema mismatch, constructor signatures) rather than factual accuracy.

---

## What's Not Working

### 1. Drafter Regressions Spiked to 3 -- Including a Fabricated Codebase Claim
R23's 3 regressions match R20 (3) and are exceeded only by R13 (6) and R12 (3). The fabricated coordinate-brief.json claim is a new regression class: the Drafter stated "The coordinator already writes this file" as fact, with no evidence and no VERIFIED tag. Historical Drafter regressions by run: 0, 3, 6, 0, 0, 2, 2, 2, 0, 3, 0, 1, 3. Mean: ~1.6. The Drafter is the pipeline's most volatile stage.

### 2. Corrector-1 Regressions at 2 for 2nd Consecutive Run
R22: 2 regressions. R23: 2 regressions. This is the first time Corrector-1 has produced 2 regressions in consecutive runs. 10 of 13 tracked runs have at least 1 Corrector-1 regression. R23 introduces the 9th distinct regression class ("acknowledged gap unfixed" -- the Corrector flagged the problem in its notes section but did not fix the main body). The SIDE-EFFECT-CHECK protocol is not preventing regressions regardless of error class.

### 3. Novelty-Flag Compliance Remains Unstable at 75%
R23: 75%. Progression across all runs: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100% -> 76.9% -> 100% -> 70% -> 75%. The 3-consecutive-at-100% threshold has never been met. The most consequential unflagged claim in R23 was the fabricated coordinate-brief.json assertion -- the pipeline's most dangerous defect was the one the Drafter failed to tag.

### 4. Total Regressions (Drafter + Corrector-1) Hit 5 -- Highest Since R13
R23: 3 Drafter + 2 Corrector-1 = 5 total mid-pipeline regressions. Only R13 (6+2=8) was worse. Historical total regression mean: ~2.4. R23 is 2x the mean. Both stages underperformed simultaneously, creating more work for the critic/corrector rounds. The pipeline caught all 5, but the cost of catching them was substantial.

### 5. Process Change Debt: 8th Retrospective for Consistency Gate
The Drafter consistency gate has been recommended since R16 (8 consecutive retrospectives). The novelty-flag redesign has been recommended since R17 (7 consecutive retrospectives). Neither has been implemented. R23's results reinforce both: 75% novelty compliance and 3 Drafter regressions on a complex first-pass document. The retrospective is documenting the same problems repeatedly without driving change.

---

## Derived Metrics

| Metric | R23 | R22 | R21 | R20 | Historical Mean (R10-R23) |
|--------|----:|----:|----:|----:|:-------------------------:|
| Total findings | 17 | 17 | 17 | 16 | 17.4 |
| CRITICALs | 2 | 1 | 1 | 0 | 1.4 |
| Application rate | 100% | 100% | 94% | 100% | 95.9% |
| Drafter regressions | 3 | 1 | 0 | 3 | 1.6 |
| Corrector-1 regressions | 2 | 2 | 1 | 0 | ~1.0 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 | 0 (23/23) |
| Evidence-gating compliance | 100% | 100% | 100% | 100% | ~99% |
| False verification claims | 0 | 1* | 0 | 0 | ~0.1 |
| Novelty-flag compliance | 75% | 70% | 100% | 76.9% | ~60% |
| Net regressions in final output | 0 | 0 | 0 | 0 | 0 |

---

## So What?

- **R23 produced 5 mid-pipeline regressions (3 Drafter + 2 Corrector-1) -- the worst upstream performance since R13 -- and the final document still shipped with 0 regressions.** The two-critic architecture caught all 5, expanding the document from 11 ACs to 16 with internally consistent, codebase-grounded specifications. The safety net works, but it was stressed harder than usual.

- **The Drafter fabricated a codebase claim ("coordinator already writes coordinate-brief.json") for the first time in the series.** This is a new regression class: not a logic error, not an arithmetic mistake, but an invented fact with no evidence. The evidence-gating system correctly left it ungated (no VERIFIED tag), and the novelty-flag system failed to catch it (no NEW_CLAIM tag). Both safety mechanisms partially worked but neither prevented the fabrication from entering the document.

- **Corrector-1 regressions at 2 for 2 consecutive runs (R22-R23) suggest a worsening trend.** The prior baseline was 1 per run (R15-R19, R21). R23 adds a 9th distinct regression class. The SIDE-EFFECT-CHECK protocol is not effective. Structural intervention (multi-pass review or reduced scope) is overdue.

- **Evidence-gating (14/14) and Corrector-2 (23/23) remain solved invariants.** Stop analyzing these. All improvement effort should target: (1) Drafter fabrication prevention, (2) Corrector-1 structural reform, and (3) novelty-flag convergence.

- **Process change debt is now at 8 retrospectives for the consistency gate and 7 for the novelty-flag redesign.** R23's results -- 3 Drafter regressions, 75% novelty compliance, a fabricated claim -- are the strongest case yet for implementing both. The pipeline's detection capability masks its upstream quality problems; the question is whether the cost of catching 5 regressions per run is acceptable when prevention mechanisms have been proposed and deferred 7-8 times.
