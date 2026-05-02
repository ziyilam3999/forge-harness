# Double-Critique Effectiveness Report -- 2026-04-02

**Run:** R16 (Forge Harness Phase 2 `forge_evaluate` Implementation Plan)
**Prior run on this project:** R15 (Forge Harness Phase 1 `forge_plan` Implementation Plan)
**Document type:** Implementation plan (feature build on existing scaffold)
**Pipeline:** 6-stage (Researcher -> Drafter -> Critic-1 -> Corrector-1 -> Critic-2 -> Corrector-2)

---

## This Run

- **Document critiqued:** Phase 2 `forge_evaluate` MCP tool implementation plan (`C:/Users/ziyil/coding_projects/forge-harness/tmp/dc-8-extractor.md`)
- **Content type:** includes-TCs (design decisions D1-D12, error handling table, AC commands, testing notes)
- **Total findings:** 17 (1 CRITICAL / 8 MAJOR / 8 MINOR)
- **Application rate:** 94% (16 applied, 1 correctly rejected -- F6 timeout test timing)
- **Drafter regressions:** 2 (unconditional `{ shell: 'bash' }` on all platforms; evidence concat `stdout + '\n' + stderr` contradicting D11)
- **Corrector-1 regressions:** 1 (propagated evidence concat contradiction while actively editing D4)
- **Evidence-gating compliance:** 100% (14 VERIFIED claims total across Drafter + Corrector-2, all with file:line citations; 0 bare "I verified" claims)
- **False verification claims:** 0
- **Novelty-flag compliance:** 75% (3 NEW_CLAIM tags used; 1 unflagged novel claim caught by Critic-2 -- evidence concat order)

### Severity Distribution

| Severity | Count | % | R15 % | Historical Mean % |
|----------|:-----:|:-:|:-----:|:-----------------:|
| CRITICAL | 1 | 6% | 6% | 15% |
| MAJOR | 8 | 47% | 47% | 42% |
| MINOR | 8 | 47% | 47% | 43% |

R16's severity distribution is identical to R15 (6/47/47), continuing the shift away from CRITICALs. The Researcher's front-loading of the 2 most impactful issues (Windows shell compatibility, CWD specification) again resolved design-level problems before critics engaged.

### Stages That Carried Weight vs. Added Nothing

| Stage | Weight | Rationale |
|-------|--------|-----------|
| **Researcher** | HEAVY | MVP -- surfaced Windows shell + CWD gaps (2 highest-impact issues). Gave Drafter a concrete roadmap. |
| **Critic-1** | HEAVY | 9 findings (1 CRITICAL, 4 MAJOR, 4 MINOR). Caught Drafter's platform regression + discrimination logic gap. |
| **Critic-2** | HEAVY | 8 findings (1 CRITICAL, 3 MAJOR, 4 MINOR). Caught `readOnlyHint` bug and signal-killed gap that 4 prior stages missed. |
| **Drafter** | MEDIUM | High volume (integrated 10+ findings, added self-review/TC-CHECK), but introduced 2 regressions. |
| **Corrector-2** | MEDIUM | Clean application of 7/8 findings, 0 regressions, verified claims with actual commands. |
| **Corrector-1** | LOW-MEDIUM | Applied all 9 fixes but introduced 1 regression (propagated concat contradiction while editing D4). |

No stage added nothing. All 6 stages produced unique value. The closest to expendable was Corrector-1, but it is structurally required as input to Critic-2.

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
| **R16** | **Implementation plan (feature)** | **17** | **1** | **8** | **8** | **forge-harness** |

R16 is an exact repeat of R15's finding count and severity breakdown (17 findings, 1/8/8). This is the 2nd consecutive feature-build plan on forge-harness with identical metrics. The consistency suggests that for feature-build plans on this codebase, ~17 findings with ~1 CRITICAL is the baseline.

### Regression Tracking Table

| Run | Drafter Reg. | Corrector-1 Reg. | Corrector-2 Reg. | Total Reg. |
|-----|:------------:|:----------------:|:----------------:|:----------:|
| R11R | 0 | 0 | 0 | 0 |
| R12 | 3 | 1 | 0 | 4 |
| R13 | 6 | 2 | 0 | 8 |
| R14 | 0 | 0 | 0 | 0 |
| R15 | 0 | 1 | 0 | 1 |
| **R16** | **2** | **1** | **0** | **3** |

R16 breaks the Drafter's zero-regression streak (R14-R15 were both 0). The 2 Drafter regressions are both specification-level errors: one platform-awareness gap (unconditional bash), one internal contradiction (D4 vs D11). This is the first run since R13 (6 regressions) with Drafter regressions >0.

Corrector-1 regression at 1 continues the pattern: 5 of last 6 runs have 0-1 Corrector-1 regressions. Corrector-2 extends its zero-regression streak to **16/16 runs**.

### Application Rate Trend

| Run | Rate |
|-----|:----:|
| R10 | 100% |
| R11R | 100% |
| R12 | 95% |
| R13 | 100% |
| R14 | 100% |
| R15 | 100% |
| **R16** | **94%** |

R16 breaks the 100% streak at 94% (1 finding correctly rejected). This is functionally equivalent to 100% -- the rejected finding (F6, timeout test timing on cold hardware) was assessed as non-blocking by Corrector-2. The effective application rate (excluding correct rejections) remains 100%.

### Evidence-Gating Compliance

| Run | Compliance | Fabrication | Mechanical Reg. |
|-----|:----------:|:-----------:|:---------------:|
| R10 | 100% | 0 | 0 |
| R11R | 100% | 0 | 0 |
| R12 | 95% | 0 | 4 |
| R13 | 100% | 0 | 8 |
| R14 | 100% | 0 | 0 |
| R15 | 100% | 0 | 1 |
| **R16** | **100%** | **0** | **1** |

7th run at 100% evidence-gating with 0 fabrication (8th including R12 at 95% with 0 fabrication). P55 is fully stable. The 1 mechanical regression (Corrector-1's concat propagation) is independent of evidence-gating, consistent with P55's narrowed claim.

### Novelty-Flag Compliance

| Run | Compliance |
|-----|:----------:|
| R11R | 0% |
| R12 | ~90% |
| R13 | 100% |
| R14 | N/A |
| R15 | 100% |
| **R16** | **75%** |

R16 drops from 100% to 75%. The unflagged novel claim (evidence concat order `stdout + '\n' + stderr`) was a new specification introduced by the Drafter without a NEW_CLAIM tag. This resets the stability counter -- the protocol has NOT reached 3 consecutive runs at 100%. Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75%.

---

## Stage Effectiveness Rankings

| Rank | Stage | Contribution | Trend (vs R15) | Notes |
|------|-------|:------------:|:--------------:|-------|
| 1 | **Researcher** | HIGH | STABLE | MVP again. 2 highest-impact issues (Windows shell, CWD). Consistent with R14-R15 pattern. |
| 2 | **Critic-2** | HIGH | UP | 8 findings including 1 CRITICAL (`readOnlyHint`) and 3 MAJOR that no prior stage caught. Strongest Critic-2 performance in forge-harness runs. |
| 3 | **Critic-1** | HIGH | STABLE | 9 findings (1 CRITICAL, 4 MAJOR). Caught Drafter regression. Consistent with R15. |
| 4 | **Drafter** | MEDIUM | DOWN | 10+ integrations but 2 regressions (up from 0 in R15). Evidence-gating 100% but novelty-flag missed 1. |
| 5 | **Corrector-2** | MEDIUM | STABLE | Clean application, 0 regressions (16/16 streak), verified claims. Solid closer. |
| 6 | **Corrector-1** | MEDIUM-LOW | STABLE | Applied all 9 fixes but introduced 1 regression (same rate as R15). Self-review failure on the section it was editing. |

---

## What's Working

### 1. Evidence-Gating (100% compliance, 7th consecutive run at 100%)
Zero fabricated verification claims across 7 runs. All 14 VERIFIED entries in R16 include file paths and line references. P55 is the most robust pipeline invariant. **7 data points at 100%, 0 fabrication each.**

### 2. Researcher Front-Loading Reduces CRITICAL Density
R14: 2 CRITICALs, R15: 1 CRITICAL, R16: 1 CRITICAL. In all 3 forge-harness runs, the Researcher resolved design-level issues before critics engaged, shifting critics toward specification gaps (MAJOR) rather than design-breaking flaws. CRITICAL rate for forge-harness: 6-13%, vs historical mean 15%.

### 3. Corrector-2 Zero Regressions (16/16 runs)
Extended to 16 consecutive runs with 0 regressions. R16: applied 7 findings, rejected 1 correctly, produced comprehensive side-effect checks. P56 is the second most robust pipeline invariant.

### 4. Round 2 Catches What Round 1 Misses
Critic-2 found the `readOnlyHint` bug (CRITICAL -- a genuine correctness issue that would have shipped) and the signal-killed process gap (MAJOR), both missed by all 4 prior stages. In R15, Critic-2 caught the `/dev/stdin` Windows regression. Two consecutive runs where Round 2 caught correctness bugs that Round 1 missed.

### 5. Critic Finding Volume Is Consistent
Critic-1: 9 findings in both R15 and R16. Critic-2: 8 findings in R16 (vs 7 in R15). The pipeline's detection capability is stable across runs on the same project.

---

## What's Not Working

### 1. Drafter Regressions Returned (2 in R16, up from 0 in R14-R15)
The R14-R15 zero-regression streak was broken. R16's 2 regressions are both specification-level: unconditional bash (platform awareness gap) and evidence concat contradiction (internal consistency failure). The historical mean is 1.1 regressions per run; R16 is above this at 2. The Drafter's regression rate appears correlated with document complexity -- R16's plan had 12 design decisions (D1-D12) vs R15's simpler structure.

### 2. Novelty-Flag Compliance Dropped to 75%
Down from 100% in R15. The unflagged claim (concat order) was a design decision embedded in implementation detail, making it easy to miss. The novelty-flag protocol has NOT stabilized at 3 consecutive runs of 100%. Progression shows oscillation: 100% -> 75%, suggesting the instruction is not yet fully internalized for implementation-detail-level novel claims.

### 3. Corrector-1 Continues to Regress (1 regression, 5th of last 6 runs)
R16's Corrector-1 propagated the D4/D11 contradiction while actively editing D4 -- a self-review failure on exactly the section it was modifying. This is a different class than R15's platform regression (`/dev/stdin`), but the root cause is the same: the corrector fixes what the critic told it to fix without cross-referencing other sections of the document. Regression rate: ~83% of runs (5/6) have at least 1 Corrector-1 regression.

### 4. Researcher Missed `readOnlyHint` Despite Examining the File
The Researcher verified the import at `server/index.ts:4` but did not check tool registration annotations at line 33. This is the same gap noted in R15's retrospective -- the Researcher catches design-level and failure-mode issues but misses annotation/configuration bugs even when examining the relevant file. Structural limitation: the Researcher's codebase pass is claim-verification focused, not annotation-audit focused.

---

## Derived Metrics

| Metric | R16 | R15 | R14 | Historical Mean |
|--------|----:|----:|----:|:--------------:|
| Total findings | 17 | 17 | 26 | 19.0 |
| CRITICALs | 1 | 1 | 2 | 2.9 |
| Application rate | 94% | 100% | 100% | 96.6% |
| Drafter regressions | 2 | 0 | 0 | 1.1 |
| Corrector-1 regressions | 1 | 1 | 0 | ~0.8 |
| Corrector-2 regressions | 0 | 0 | 0 | 0 (16/16) |
| Evidence-gating compliance | 100% | 100% | 100% | ~98% |
| False verification claims | 0 | 0 | 0 | 0 |
| Novelty-flag compliance | 75% | 100% | N/A | ~73% |
| Net regressions in final output | 0 | 0 | 0 | 0 |
