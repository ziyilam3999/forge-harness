# Double-Critique Retrospective -- 2026-04-02

**Run:** R16 (Forge Harness Phase 2 `forge_evaluate` Implementation Plan)
**Prior run:** R15 (Forge Harness Phase 1 `forge_plan` Implementation Plan)
**Prior runs analyzed:** R10-R16 (hive-mind + forge-harness series)

---

## Pipeline Health Assessment

### Overall Verdict: HEALTHY (minor regression signals)

R16 is the 3rd consecutive forge-harness run and the 2nd consecutive feature-build plan on the same codebase. The pipeline continues to operate within normal parameters, but two metrics regressed from R15 baselines:

- **17 findings, 1 CRITICAL**: Identical to R15. Finding count and severity distribution (6/47/47) are now a repeating baseline for feature-build plans on this project.
- **94% application rate**: 1 finding correctly rejected (F6 timeout test timing). Functionally equivalent to 100%.
- **3 total regressions (2 Drafter, 1 Corrector-1)**: Up from 1 in R15. Drafter broke its zero-regression streak.
- **100% evidence-gating compliance**: 7th consecutive run at 100% with 0 fabrication.
- **75% novelty-flag compliance**: Down from 100% in R15. Resets stability counter.
- **Corrector-2 zero regressions**: Extended to 16/16 runs.
- **Net regressions in final output: 0**: All regressions caught and fixed before final version.

---

## KEEP -- What's Working Well

### 1. Evidence-Gating is a Solved Problem (P55)
7 consecutive runs at 100% compliance, 0 fabrication. All 14 VERIFIED entries in R16 include file:line citations. This is the pipeline's most robust invariant. No further monitoring needed -- the protocol is baked in.

### 2. Corrector-2 Zero-Regression Streak (P56)
16/16 runs with 0 regressions. R16: applied 7 findings, correctly rejected 1 (F6 timeout), produced side-effect checks. Corrector-2 remains the reliable closer. The streak length (16) makes this the second-strongest pipeline invariant.

### 3. Researcher Front-Loading
3 consecutive forge-harness runs where the Researcher resolved the highest-impact design issues (R14: project structure; R15: JSON mode + default tier; R16: Windows shell + CWD). CRITICAL rate for forge-harness: 6-13%, vs historical mean 15%. The Researcher consistently shifts critic workload from "find design-breaking flaws" to "find specification-completeness gaps."

### 4. Round 2 Catches Correctness Bugs Round 1 Misses
R15: Critic-2 caught `/dev/stdin` Windows regression. R16: Critic-2 caught `readOnlyHint` bug (CRITICAL) and signal-killed process gap (MAJOR), both missed by 4 prior stages. Two consecutive runs with correctness bugs caught exclusively by Round 2. This is the strongest argument for the dual-critique pipeline's existence.

### 5. Finding Volume Consistency on Feature-Build Plans
R15 and R16 are identical: 17 findings, 1/8/8 severity distribution. Critic-1: 9 findings in both runs. Critic-2: 7 (R15) and 8 (R16) findings. The pipeline's detection capability is stable and predictable for same-project feature builds.

---

## CHANGE -- What Should Be Modified

### 1. Drafter Needs Cross-Reference Check on Multi-Decision Documents (Priority: HIGH)
R16's 2 Drafter regressions are both internal-consistency failures: (a) unconditional `{ shell: 'bash' }` contradicting the plan's own Windows compatibility requirement, (b) evidence concat `stdout + '\n' + stderr` contradicting D11. Both regressions involve one design decision contradicting another in a 12-decision document.

**Proposal:** Add a Drafter self-check step: after integration, enumerate all design decisions (D1-DN) and verify each pair is internally consistent. This is only needed when documents contain 5+ design decisions.

### 2. Corrector-1 Needs Cross-Section Awareness (Priority: MEDIUM)
5 of last 6 runs have at least 1 Corrector-1 regression (83% recurrence). R16's regression: propagated D4/D11 contradiction while actively editing D4. R15's: introduced `/dev/stdin` while fixing AC-15. The root cause is identical: the corrector fixes exactly what the critic flagged without cross-referencing related sections.

**Proposal:** Add an instruction to Corrector-1: "After applying each fix, re-read any section that references or is referenced by the modified section. Flag if your fix creates a contradiction." This is a lightweight cross-reference check, not a full re-review.

### 3. Novelty-Flag Instruction Needs Scope Expansion (Priority: MEDIUM)
R16 dropped to 75% because the unflagged novel claim was an implementation detail (evidence concat order), not a design decision. The current instruction triggers on design-level novel claims but misses specification-level ones embedded in implementation detail.

**Proposal:** Expand the novelty-flag instruction: "Any specification that wasn't in the original document or researcher output, regardless of granularity, requires a NEW_CLAIM tag. This includes implementation-detail-level specifications such as data ordering, concatenation order, and default values."

---

## ADD -- New Pipeline Stages or Modifications to Try

### 1. Drafter Internal-Consistency Gate (for complex documents only)
When the document contains 5+ design decisions, the Drafter should produce a consistency matrix as an appendix: a list of decision pairs that interact, with a one-line note confirming consistency. This turns implicit cross-referencing into an explicit artifact that critics can audit.

**Trigger:** Document has 5+ design decisions or decision-like sections.
**Expected effect:** Reduce Drafter regressions on complex documents. R16 had 12 design decisions and 2 regressions; R15 had a simpler structure and 0. The correlation suggests complexity, not competence, is the variable.

### 2. Researcher Annotation Audit Pass
The Researcher missed `readOnlyHint` despite examining the file (R16) and missed a similar annotation-level issue in R15. The Researcher's pass is claim-verification focused, not annotation-audit focused.

**Proposal:** Add a scoped checklist to the Researcher: "For each tool/function examined, verify: (a) all annotations/decorators match the documented behavior, (b) default parameter values match specifications." This is narrower than a full code audit and targets the specific class of bugs the Researcher has missed twice.

**Risk:** Scope creep -- the Researcher is already the most impactful stage. Adding work could dilute its design-level focus.

---

## DROP -- Consistently Not Pulling Its Weight

**Nothing to drop.** All 6 stages produced unique value in R16. The closest candidate remains Corrector-1 (LOW-MEDIUM weight, 83% regression rate), but it is structurally required as Critic-2's input -- you cannot run Critic-2 without a corrected document from Round 1. The regression rate is a quality problem, not a structural one, and the proposed CHANGE (cross-section awareness) is the appropriate fix.

---

## NEW PATTERNS -- Candidates Discovered This Run

### Candidate P-R16-1: Feature-build plan metrics stabilize by the 2nd run on a project

**Data:** R15 and R16 are identical on the same project: 17 findings, 1/8/8, 100% application (94% with correct rejection). R14 (greenfield) was different: 26 findings, 2 CRITs.

**Hypothesis:** After the first feature-build run on a project, subsequent feature-build runs converge to a stable baseline. The project's architectural constraints (schema, tool registration, test patterns) create a fixed decision surface that produces a fixed finding count.

**Status:** HELD -- 2 data points (R15, R16). Need 1 more feature-build run on forge-harness OR a 2nd project with 2+ feature-build runs.

### Candidate P-R16-2: Drafter regression rate correlates with document complexity (decision count)

**Data:**
- R14: 0 Drafter regressions, simple scaffold plan (few design decisions)
- R15: 0 Drafter regressions, simpler feature plan
- R16: 2 Drafter regressions, 12 design decisions (D1-D12)
- R13: 6 Drafter regressions (hive-mind, complex plan)
- R12: 3 Drafter regressions (hive-mind, complex plan)

**Hypothesis:** Drafter regressions increase with the number of interacting design decisions. The Drafter's integration pass is reliable for simple documents but breaks down when decisions interact across 5+ specifications.

**Status:** HELD -- 5 data points suggest correlation, but "complexity" needs operationalization (decision count? page count? cross-reference density?). The consistency gate (ADD section) is the proposed structural fix.

### Candidate P-R16-3: Researcher front-loading reduces CRITICAL density (promotion from R15)

**Data:** 3 forge-harness runs: R14 (2 CRITs, 13%), R15 (1 CRIT, 6%), R16 (1 CRIT, 6%). Historical mean: 15%. In all 3 runs, the Researcher resolved design-level issues before critics engaged. R8 (hive-mind) also supports this.

**Status:** HELD at 3 data points. Meets stability criterion (3 runs) but generalizability is uncertain -- all 3 are on the same project. Need 1 run on a different project to confirm it's not project-specific.

---

## NEW ANTI-PATTERNS -- Candidates Discovered This Run

### Candidate NAP-R16-1: Corrector blind-spot on the section being edited

**Data:** R16's Corrector-1 propagated the D4/D11 contradiction while actively editing D4. R15's Corrector-1 introduced `/dev/stdin` while fixing the section containing AC-15. In both cases, the regression was in or adjacent to the section the corrector was actively modifying.

**Hypothesis:** Correctors are most likely to introduce regressions in the exact section they're editing, because their attention is narrowed to the critic's finding rather than the section's full context.

**Status:** HELD -- 2 data points (R15, R16). If this recurs in R17, it would meet stability for KB graduation as a formal anti-pattern.

### Candidate NAP-R16-2: Novelty-flag compliance oscillates rather than monotonically improving

**Data:** Progression: 0% (R11R) -> 90% (R12) -> 100% (R13) -> N/A (R14) -> 100% (R15) -> 75% (R16). Unlike evidence-gating (which monotonically improved to 100% and stayed), novelty-flag compliance oscillates. The R15 retrospective predicted R16 would confirm stability at 100%; instead it regressed.

**Status:** HELD -- observation only. May indicate the novelty-flag instruction is inherently harder to maintain at 100% because the trigger condition (what counts as "novel") is fuzzier than evidence-gating's trigger condition (what counts as "verified").

---

## KB Cross-Reference Analysis

### Patterns Confirmed by R16

| Pattern | How R16 Confirms |
|---------|-----------------|
| **P5 (Dual-Critique Pipeline)** | Critic-2 caught `readOnlyHint` CRITICAL and signal-killed MAJOR that 4 prior stages missed. Without Round 2, 2 bugs ship. |
| **P17 (Binary ACs)** | All ACs in final plan have executable verification commands. |
| **P41 (Windows-Safe Paths)** | Drafter's unconditional `{ shell: 'bash' }` is a P41 violation, caught by Critic-1. |
| **P55 (Evidence-Gating)** | 100% compliance, 0 fabrication. 7th data point. |
| **P56 (Corrector-2 Zero Regressions)** | Extended to 16/16 runs. |

### Anti-Patterns Triggered by R16

| Anti-Pattern | How R16 Triggered It |
|-------------|---------------------|
| **P41 (Windows-Safe)** | Drafter used unconditional bash shell option. Caught by Critic-1. |

### NAP-3 (Drafter TC Regression Correlation) Check

R16 document type: includes-TCs. R16 Drafter regressions: 2. This is the 6th data point:
- R10-R11R: Minimal TCs, 0 regressions
- R12: Substantial TCs, 3 regressions
- R13: Substantial TCs, 6 regressions
- R14: No TCs, 0 regressions
- R15: No TCs, 0 regressions
- R16: Includes TCs, 2 regressions

The correlation continues to hold: runs with TCs/complex content have higher Drafter regression rates. However, R16 also has 12 design decisions, so the confound (complexity vs. TC presence) remains unresolved. **Decision:** Keep in memory.md, not KB.

---

## KB Graduation Assessment

### P55 (Evidence-Gating)
R16: 100% compliance, 0 fabrication, 1 mechanical regression (independent). 7th consecutive data point at 100%. **No update needed** -- pattern is fully stable and already in KB.

### P56 (Corrector-2 Zero Regressions)
R16: extends to 16/16. **No update needed** -- incremental count change only.

### Researcher Front-Loading (Candidate P-R16-3)
3 forge-harness data points + 1 hive-mind supporting data point. Meets stability (3 runs) and has evidence (measured CRITICAL rates). Does NOT yet meet generalizability -- all 3 primary data points are on the same project. **Decision: HOLD.** One more run on a different project would satisfy generalizability.

### Novelty-Flag Stability
R16 dropped to 75%, resetting the stability counter to 0 consecutive runs at 100%. **Not eligible for KB graduation.** The protocol needs further refinement (see CHANGE section) before stability can be reassessed.

### Feature-Build Baseline Convergence (Candidate P-R16-1)
2 data points on same project. **Not eligible** -- needs more data.

### Drafter Complexity Correlation (Candidate P-R16-2)
5 data points suggest correlation but "complexity" is not operationalized. **Not eligible** -- needs a measurable complexity metric.

### Overall KB Decision: NO KB UPDATES WARRANTED

No finding meets all three criteria (stability, evidence, generalizability). The Researcher front-loading candidate is closest (3 runs, measured numbers) but lacks cross-project generalizability. All candidates remain in memory.md.

---

## Process Improvement Recommendations

### 1. Expand novelty-flag instruction scope (Priority: HIGH)
R16's 75% compliance was caused by a specification-level novel claim not being flagged. Expand the instruction to cover implementation-detail-level specifications, not just design-level ones. Test in R17.

### 2. Add Drafter consistency gate for complex documents (Priority: HIGH)
R16's 2 Drafter regressions were both internal-consistency failures in a 12-decision document. Add a self-check step when documents have 5+ design decisions. Test in R17 if the next plan is complex enough.

### 3. Add Corrector-1 cross-section check (Priority: MEDIUM)
5/6 runs have Corrector-1 regressions, all in or adjacent to the section being edited. Add a lightweight instruction to re-read referenced sections after each fix. Test in R17.

### 4. Consider Researcher annotation audit (Priority: LOW)
2 consecutive runs where the Researcher missed annotation-level bugs despite examining the file. This is a structural limitation, not a compliance failure. Low priority because the bugs were caught by Critic-2, so the pipeline's net output was correct.

### 5. No structural pipeline changes needed (Priority: N/A)
All 6 stages produced unique value. No additions, removals, or reorderings warranted.
