# Double-Critique Retrospective -- 2026-04-08

**Run:** R22 (forge_coordinate Implementation Plan)
**Effectiveness report:** `tests/double-critique/effectiveness-2026-04-08.md`
**Memory file:** `hive-mind-persist/memory.md`
**Prior retrospective:** `tests/double-critique/retrospective-2026-04-06.md` (R21)

---

## What is this report?

R22 exposed a new failure class -- semantically misleading verification -- where Corrector-1 cited real code from the wrong handler to justify a scope underestimate that became the pipeline's CRITICAL. Corrector-1 regressions spiked to 2 (highest since R13), and novelty-flag compliance dropped to 70%, with the most consequential unflagged claim becoming the CRITICAL finding. The two-critic architecture earned its keep for the 6th consecutive run by catching both Corrector-1 regressions before the final output.

---

## KEEP

- **Two-critic architecture with zero finding overlap** -- 6 consecutive runs (R17-R22) where Critic-1 and Critic-2 have zero finding overlap. R22: Critic-1 caught write-side field gap, topoSort ambiguity, budget mechanism mismatch. Critic-2 caught handleStoryEval infrastructure gap (CRITICAL), infeasible auto-detection, schema incompatibility, detectCycles type mismatch. Corrector-1 introduced 2 regressions including a CRITICAL scope underestimate, and only Critic-2 caught both. A single-critic pipeline would have shipped a plan scoping 25 lines of infrastructure as a one-liner. -- Action: no change. This is the pipeline's highest-value structural feature.

- **Corrector-2 zero-regression streak** -- 22/22 runs. R22: applied all 7 Critic-2 findings including full US-00 rewrite, tagged discriminated union, and Budget Design section. Zero regressions. -- Action: solved invariant; continue enforcing, stop analyzing.

- **Evidence-gating mechanical compliance** -- 13/13 runs at 100%. R22: 7 Drafter VERIFIED + 10 Corrector-1 VERIFIED, all with file:line citations. -- Action: solved invariant; continue enforcing. But see CHANGE section for semantic accuracy gap.

- **Net zero regressions in final output** -- 13/13 runs. R22: 3 mid-pipeline regressions (1 Drafter, 2 Corrector-1), all caught and fixed before final document. -- Action: no change.

- **Researcher front-loading** -- R22: 21 verified claims, 6 MAJOR findings, 10 failure modes. Identified the storyId gap that grounded all subsequent Drafter work. CRITICAL density for last 5 runs: 0, 0, 0, 1, 1 (mean 0.4 vs historical mean ~1.5). -- Action: keep current thoroughness level, but address code-path depth limitation (see CHANGE).

- **Stable finding volume and severity distribution** -- R22 at 17 findings (series median: 17). Severity split 6/41/53 is nearly identical to R21 (6/41/53). The pipeline has a predictable detection ceiling on code-adjacent implementation plans. -- Action: no change needed. Stability is a feature, not a limitation.

---

## CHANGE

- **Add semantic verification protocol for code-path claims** -- R22 produced the first semantically misleading verification: Corrector-1 cited real lines from handleCoherenceEval (lines 200-217) to verify a claim about handleStoryEval's behavior. Format compliance was 100%, but the conclusion was wrong because the wrong code path was examined. This is a new failure class that mechanical evidence-gating cannot catch. -- Evidence: R17 had an arithmetic self-review false positive (same limitation class -- mechanical compliance masking semantic error). R22 extends this to code-path mismatch. -- Action: for claims about code behavior, require "trace the call chain" verification (function -> caller -> call site) rather than "grep for the function name." Add to Corrector-1 instructions: "When verifying a code-path claim, confirm the handler/function name matches the claim, not just the file and line numbers."

- **Corrector-1 multi-pass review (7th retrospective recommending, 3rd at HIGH priority)** -- R22: 2 regressions (feasibility propagation + scope understatement), the worst since R13. SIDE-EFFECT-CHECK did not prevent either. 8 distinct regression classes now observed across 8 runs (R15-R22, excluding R20). -- Evidence: R22's regressions are judgment-class (propagating an infeasible feature without checking feasibility; understating scope despite editing the section). Neither would be caught by a single-pass side-effect check because both were intentional changes. -- Action: implement process change #11 (multi-pass review protocol). This has been queued for 4 retrospectives (R19-R22). Per the forcing function (#13), it is now mandatory-before-R23. After applying each fix: (a) re-read surrounding section, (b) re-read any referenced section, (c) explicitly ask "did my fix add any new assumption not in the original document?"

- **Novelty-flag enforcement -- instruction approach confirmed non-convergent** -- R22 drops to 70% compliance, the lowest since R17's 0%. The 3-consecutive-at-100% threshold has never been met across 12 enabled runs. R21's demotion of the structural redesign (#5) to LOW was premature. -- Evidence: Full progression: 0/90/100/NA/100/75/0/100/100/77/100/70. The most consequential unflagged claim (US-00 scope characterization) became the pipeline's CRITICAL finding. R22 provides the 4th positive data point for P-R20-1: unflagged novel claim was defective. -- Action: re-elevate novelty-flag redesign (#5) from LOW to HIGH. The instruction-based approach has had 12 runs and never achieved 3 consecutive at 100%. Implement the Drafter novel-claim self-audit step (#12) immediately as a bridge: after all edits, Drafter must list every claim not in Researcher output or source document and tag each NEW_CLAIM.

- **Process change forcing function (now 8th retrospective documenting same problems)** -- The Drafter consistency gate has been recommended in 7 retrospectives (R16-R22). The novelty-flag redesign in 6 (R17-R22). The Corrector-1 multi-pass review in 4 (R19-R22). None implemented. -- Evidence: Discovery #25 (R20) called this out. Process change #13 (forcing function) has itself been recommended for 3 retrospectives (R20-R22) without implementation. -- Action: the forcing function must be implemented before R23. Concrete mechanism: any process change recommended in 3+ consecutive retrospectives at HIGH priority becomes a gate -- R23 cannot start until it is implemented or explicitly rejected with documented rationale.

---

## ADD

- **Researcher code-path depth instruction** -- The Researcher currently verifies that functions/interfaces exist but does not trace which code paths invoke them. R22: verified "evaluate.ts calls writeRunRecord" without checking which handler. Same gap in R16 (readOnlyHint annotation), R20 (ProgressReporter stage count), R21 (callClaude count). -- Evidence: 4 runs where Researcher verification stopped at file level rather than function level. The missing depth consistently becomes a late-stage CRITICAL or MAJOR. -- Action: add to Researcher instructions: "For claims about code behavior, verify at the function/handler level, not just the file level. Check which specific function makes the call, not just that the file contains the call."

- **Semantic verification accuracy as a tracked metric** -- R22 is the first run to distinguish mechanical compliance (100%) from semantic accuracy (<100%). This distinction should be a first-class metric. -- Action: add "False verification claims (semantic)" to the Derived Metrics table alongside the existing evidence-gating compliance metric. Track separately from format compliance.

---

## DROP

- **Novelty-flag redesign demotion (process change #5 at LOW)** -- R21's retrospective demoted the structural redesign to LOW based on a single 100% data point. R22 immediately dropped to 70%, invalidating the demotion. The oscillation pattern is the evidence: instruction-level approaches cannot achieve stable compliance. -- Action: re-elevate to HIGH. The LOW rating lasted exactly 1 run.

- **SIDE-EFFECT-CHECK as a standalone fix for Corrector-1 regressions** -- R20: 0 regressions (active). R21: 1 regression (active). R22: 2 regressions (active). The protocol's effectiveness is trending down, not up. It should remain as a component of the multi-pass review protocol but not be tracked or discussed as an independent mitigation. -- Action: subsume into multi-pass review (#11). Stop evaluating SIDE-EFFECT-CHECK in isolation.

---

## NEW PATTERNS

### Unflagged novel claims predict regressions (graduation candidate)

- **What:** When the Drafter introduces a claim not in the source document or Researcher output and does not tag it NEW_CLAIM, that claim is defective. When all novel claims are tagged, regression rate drops to 0.
- **Why:** The NEW_CLAIM tag forces conscious self-awareness. Untagged claims bypass both the Drafter's self-review and critics' targeted scrutiny.
- **Evidence:** R16: 1 unflagged claim, was defective. R20: 3 unflagged claims, all defective. R22: 3 unflagged claims, most consequential became the CRITICAL. Combined: 7/7 unflagged novel claims across 3 runs were defective or led to the highest-severity finding. Counter-evidence: R18, R19, R21 at 100% compliance had 0 novel-claim-driven regressions.
- **Status:** 4 positive data points (R16, R20, R22 + R21-by-absence). Measured evidence: 7/7 defect rate on unflagged claims. **Meets stability threshold (3+ positive).** Generalizability: applies to any multi-stage pipeline where an early stage introduces unchecked novel content. **Ready for KB graduation if KB exists.**

### Semantic verification mismatch -- a new evidence-gating failure class

- **What:** A verification claim can be mechanically correct (real file, real line numbers, VERIFIED tag) but semantically wrong (examined the wrong code path to draw a conclusion about a different code path).
- **Why:** Evidence-gating checks format (tag present, citation present) but not meaning (does the cited evidence actually support the conclusion?). When the verifier grepping for a function finds it in a different handler than the one being discussed, the format passes but the reasoning fails.
- **Evidence:** R22: Corrector-1 verified evaluate.ts lines 200-217 (handleCoherenceEval) to claim handleStoryEval had adequate infrastructure. R17: arithmetic self-review false positive (same class -- mechanical compliance masking semantic error). 2 data points.
- **Status:** 2 data points. Needs 1 more for stability. The pattern is potentially generalizable to any evidence-based review process.

---

## NEW ANTI-PATTERNS

### Corrector-1 regression rate increases when SIDE-EFFECT-CHECK is the only mitigation

- **What:** SIDE-EFFECT-CHECK was introduced as a standalone Corrector-1 regression fix. The regression rate across its 3 active runs is 0, 1, 2 -- trending up.
- **Why:** SIDE-EFFECT-CHECK catches mechanical side effects ("did I break a reference?") but not judgment errors ("is my fix scope-appropriate?"). As the pipeline tackles more complex documents, judgment-class errors dominate, and SIDE-EFFECT-CHECK becomes less relevant.
- **Evidence:** R20: 0 regressions (SIDE-EFFECT-CHECK active). R21: 1 regression (over-correction judgment). R22: 2 regressions (feasibility propagation + scope understatement). Both R21 and R22 regressions were judgment-class, which SIDE-EFFECT-CHECK is not designed to catch.
- **Status:** 3 data points. Meets stability threshold. However, the small N makes the upward trend potentially coincidental -- R22 was also a more complex document than R21.

---

## Candidate Pattern Updates

| ID | Pattern | Data Points | Status |
|----|---------|:-----------:|--------|
| P-R16-3 | Researcher front-loading reduces CRITICAL density | 9 (R14-R22) | R22 adds 9th data point (1 CRIT, code-path-level). Still blocked on cross-project generalizability. |
| P-R16-2 | Drafter regression correlates with decision count | 9 (R12-R22) | R22 (1 reg, 20 stories) weakly supports. Confounded by novelty-flag compliance (70%). Refined: decision count + low novelty-flag -> regressions. |
| P-R20-1 | Unflagged novel claims predict regressions (100% defect rate) | 4 (R16, R20, R21-absence, R22) | R22 adds 4th data point: 3 unflagged claims, most consequential became CRITICAL. 7/7 unflagged claims defective across positive runs. **Meets stability threshold.** |
| P-R21-1 | 100% novelty-flag compliance -> 0 Drafter regressions on complex docs | 2 positive (R19, R21) + 2 counter (R20, R22) | R22 (70% flags, 1 reg) adds supporting evidence for the inverse. Needs 1 more positive data point at 100%. |
| P-R21-2 | Corrector-1 regression classes are non-overlapping | 8 (R15-R22 excl R20) | R22 adds 2 new classes (feasibility propagation, scope understatement). Now 8 classes in 8 runs. Pipeline-specific (fails generalizability). |
| NAP-R21-1 | SIDE-EFFECT-CHECK insufficient for judgment-class regressions | 3 (R20, R21, R22) | R22 confirms: 2 judgment-class regressions with protocol active. **Meets stability threshold.** |
| P-R22-1 | Semantic verification mismatch (format-correct, meaning-wrong) | 2 (R17, R22) | New candidate. Needs 1 more data point. |

---

## KB Graduation Check

Criteria: 3+ runs, measured numbers, generalizable.

| Candidate | Stability | Evidence | Generalizable | Verdict |
|-----------|:---------:|:--------:|:-------------:|---------|
| P-R20-1 (Unflagged novel claims predict regressions) | 4 runs (R16, R20, R21, R22) | 7/7 unflagged claims defective (100%) | Yes -- applies to any multi-stage review pipeline where early stages introduce unchecked content | **READY** but no KB directory exists |
| P-R16-3 (Researcher front-loading reduces CRITICAL density) | 9 runs | CRIT rates with/without: measured | Blocked -- all data from same 2 projects | NO -- needs cross-project data |
| NAP-R21-1 (SIDE-EFFECT-CHECK insufficient for judgment errors) | 3 runs | 0, 1, 2 regressions with protocol active | Yes -- applies to any checklist-based review that asks "did I break something?" but not "did I remove intended behavior?" | **READY** but no KB directory exists |
| P-R21-1 (Novelty-flag compliance -> 0 Drafter regs) | 2 positive + 2 counter | Measured compliance/regression pairs | Potentially | NO -- only 2 positive data points |
| P-R21-2 (Corrector-1 class non-overlap) | 8 | 8 distinct classes | Pipeline-specific | NO -- fails generalizability |
| P-R22-1 (Semantic verification mismatch) | 2 | 1 false verification per run | Potentially | NO -- only 2 data points |

**Two candidates meet KB graduation criteria: P-R20-1 and NAP-R21-1.** However, the knowledge-base directory (`hive-mind-persist/knowledge-base/`) does not exist. These candidates are marked READY and should be written into the KB once it is created. Their graduation is recorded in memory.md.

---

## Process Changes Queued (Updated Priority)

| # | Change | Retros Overdue | Priority | Status |
|---|--------|:--------------:|----------|--------|
| 2 | Drafter consistency gate (5+ decisions -> consistency matrix) | 7 (R16-R22) | MEDIUM | Not started |
| 5 | Novelty-flag structural redesign (diff-based detection) | 6 (R17-R22) | HIGH (re-elevated from LOW; R22's 70% invalidates R21 demotion) | Not started |
| 11 | Corrector-1 multi-pass review protocol | 4 (R19-R22) | **MANDATORY** (meets 3+ retros at HIGH; gate for R23) | Not started |
| 12 | Drafter novel-claim self-audit step | 3 (R20-R22) | **MANDATORY** (meets 3+ retros at HIGH; gate for R23) | Not started |
| 13 | Process change forcing function (overdue-after-N escalation) | 3 (R20-R22) | **MANDATORY** (self-referentially overdue; gate for R23) | Not started |
| 14 | Corrector-1 regression class tagging in extractor | 2 (R21-R22) | MEDIUM | Not started |
| 15 | Drafter regression / novelty-flag co-occurrence tracking | 2 (R21-R22) | MEDIUM | Not started |
| 16 | Semantic verification protocol for code-path claims | NEW (R22) | HIGH | Not started |
| 17 | Semantic verification accuracy as tracked metric | NEW (R22) | MEDIUM | Not started |
| 18 | Researcher code-path depth instruction | NEW (R22) | HIGH | Not started |

---

## Next Run Priorities

1. **Implement the three MANDATORY process changes (#11, #12, #13) before R23 starts.** These have been recommended for 3-4 consecutive retrospectives each. The forcing function (#13) should be applied retroactively to ensure it cannot itself accumulate debt. Concretely: update pipeline instructions for Corrector-1 multi-pass review and Drafter novel-claim self-audit before the next run.

2. **Add the semantic verification protocol (#16) and Researcher code-path depth instruction (#18).** R22's most interesting finding -- semantically misleading verification -- is a new failure class that will recur on any code-heavy document. The fix is specific and low-effort: require handler-level verification, not file-level, for code-path claims.

3. **Run the pipeline on a non-forge-harness project.** P-R16-3 (Researcher front-loading reduces CRITICAL density) has 9 data points but is blocked on cross-project generalizability for the 8th consecutive retrospective. A single hive-mind or external project run would graduate or invalidate this candidate.
