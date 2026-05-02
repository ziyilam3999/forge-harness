# Double-Critique Retrospective -- 2026-04-11

**Run:** R23 (Kanban Dashboard for forge_coordinate)
**Effectiveness report:** `tests/double-critique/effectiveness-2026-04-11.md`
**Memory file:** `hive-mind-persist/memory.md`
**Prior retrospective:** `tests/double-critique/retrospective-2026-04-08.md` (R22)

---

## What is this report?

R23 produced the worst upstream performance since R13 -- 5 mid-pipeline regressions (3 Drafter + 2 Corrector-1) -- including the Drafter's first-ever fabricated codebase claim ("coordinator already writes coordinate-brief.json"). Despite this, the two-critic architecture caught all 5 regressions and the final document shipped clean with 0 net regressions, expanding from 11 to 16 ACs. Process change debt is now at 8 retrospectives for the consistency gate and 7 for the novelty-flag redesign, with zero implemented.

---

## KEEP

- **Two-critic architecture with zero finding overlap** -- 7 consecutive runs (R17-R23) where Critic-1 and Critic-2 have zero finding overlap. R23: Critic-1 caught logic errors and specification contradictions (AC-03 inversion, audit feed contradiction, midnight HH:MM:SS comparison). Critic-2 caught codebase-reality gaps (coordinate-brief.json fabrication, AuditEntry schema mismatch, ProgressReporter missing projectPath). The critics serve genuinely different functions: specification consistency (Critic-1) vs codebase ground-truth (Critic-2). -- Evidence: 7 consecutive runs, 0 overlap each. -- Action: no change. This is the pipeline's highest-value structural feature.

- **Corrector-2 zero-regression streak** -- 23/23 runs. R23: applied all 7 Critic-2 findings, added Hook 0 for coordinate-brief.json, redesigned activity feed for actual AuditEntry fields, added 5 new ACs (AC-14 through AC-16). Zero regressions. -- Evidence: 23 data points at 0 regressions. -- Action: solved invariant; stop analyzing.

- **Evidence-gating mechanical compliance** -- 14/14 runs at 100%. R23's most dangerous defect (fabricated coordinate-brief.json) was correctly left ungated -- no VERIFIED tag. The system works exactly as designed: ungated claims become suspect. -- Evidence: 14 consecutive 100% compliance, 0 fabricated VERIFIED claims ever. -- Action: solved invariant; stop analyzing.

- **Net zero regressions in final output** -- 14/14 runs. R23: 5 mid-pipeline regressions (the highest since R13's 8), all caught by downstream stages. The safety net held under stress. -- Evidence: 14 runs, 0 shipped regressions. -- Action: no change.

- **Researcher front-loading eliminates surface-level error classes** -- R23: verified 8 codebase claims, 12 design-system rules, 6 pattern citations. None re-challenged by critics. Allowed both critics to focus exclusively on architectural and logical issues (data flow, schema mismatch, constructor signatures) rather than factual accuracy. -- Evidence: 10 consecutive runs where Researcher pre-verification prevented redundant critic fact-checking. -- Action: keep current scope. See CHANGE for depth limitation.

- **Critic-2 as the essential safety net for Corrector-1 failures** -- R22 and R23: Corrector-1 produced 2 regressions in each run. In both runs, only Critic-2 caught them. 2 consecutive runs where the two-critic architecture was the only mechanism preventing Corrector-1 regressions from shipping. -- Evidence: R22 (2 regressions caught only by Critic-2), R23 (2 regressions caught only by Critic-2). -- Action: no change. Reinforces the non-negotiability of the two-critic architecture.

---

## CHANGE

- **Corrector-1 structural reform is overdue (9th retrospective)** -- R22-R23: 2 regressions in consecutive runs, the first time this has happened. R23 adds a 9th distinct regression class ("acknowledged gap unfixed" -- flagged coordinate-brief.json as UNVERIFIED in notes but did not fix the main body). The SIDE-EFFECT-CHECK protocol is not reducing regressions. Regression progression with SIDE-EFFECT-CHECK active: 0, 1, 2, 2 (R20-R23). -- Evidence: 10 of 13 tracked runs have at least 1 Corrector-1 regression. R22-R23 at 2 each is the worst consecutive pair. 9 distinct regression classes across 13 runs. -- Action: implement multi-pass review protocol (#11) before R24. This is the 5th consecutive retrospective recommending it (R19-R23). Per the forcing function, this is mandatory. Corrector-1 should: after each fix, (a) re-read the surrounding section, (b) re-read any referenced section, (c) verify no acknowledged but unfixed gaps remain in the main body.

- **Novelty-flag compliance remains unstable -- instruction approach has failed** -- R23 at 75%. Full progression: 0/90/100/NA/100/75/0/100/100/77/100/70/75. The 3-consecutive-at-100% threshold has never been met across 13 enabled runs. R23 provides the 5th positive data point for P-R20-1: the single unflagged claim (fabricated coordinate-brief.json) was the most dangerous defect in the document. -- Evidence: 13 runs, never 3 consecutive at 100%. 8/8 unflagged novel claims across 4 runs were defective. -- Action: implement the structural redesign (#5) -- diff-based detection rather than instruction-based flagging. This has been recommended for 7 consecutive retrospectives (R17-R23). The instruction approach has had 13 runs and has demonstrably failed to converge.

- **Drafter fabrication is a new regression class requiring a new intervention** -- R23: the Drafter stated "The coordinator already writes coordinate-brief.json" as fact -- a fabricated codebase claim with no evidence and no VERIFIED tag. This is distinct from prior Drafter regressions (logic errors, arithmetic mistakes, specification contradictions). Historical Drafter regressions: 0, 3, 6, 0, 0, 2, 2, 2, 0, 3, 0, 1, 3. R23's 3 matches R20 and is the 2nd-highest after R13's 6. Complex first-pass documents consistently produce 2-6 regressions. -- Evidence: R23 is the first run with a fabricated codebase claim. Mean Drafter regressions: 1.6; R23 at 3 is nearly 2x the mean. -- Action: add to Drafter instructions: "Every claim about what the codebase currently does must cite a specific file and line. If you cannot cite evidence, prefix with NEW_CLAIM and mark UNVERIFIED." This combines evidence-gating with novelty-flagging specifically for codebase existence claims.

- **Process change debt at 8-9 retrospectives -- the retrospective itself is failing** -- The consistency gate has been recommended since R16 (8 retrospectives). The novelty-flag redesign since R17 (7 retrospectives). The Corrector-1 multi-pass since R19 (5 retrospectives). The forcing function since R20 (4 retrospectives). None have been implemented. R23's results (3 Drafter regressions, 75% novelty compliance, a fabricated claim, 5 total regressions) are the strongest case yet. -- Evidence: 8-9 retrospectives recommending the same changes with zero implementation. R23 regression count is 2x historical mean. -- Action: this is the final retrospective that will recommend these changes without gating. If changes #2, #5, #11, and #13 are not implemented before R24, the retrospective should document this as a process anti-pattern and stop recommending.

---

## ADD

- **Drafter codebase-existence verification instruction** -- R23 introduced a new regression class: fabricating a codebase claim ("coordinator already writes coordinate-brief.json"). This is different from logic errors or novelty -- it is an existence claim about what files the codebase contains. Evidence-gating correctly left it ungated, but the Drafter should not be generating such claims without evidence. -- Evidence: R23 is the first instance. The claim survived Drafter, Critic-1, and Corrector-1 before Critic-2 debunked it at stage 5. -- Action: add to Drafter instructions: "Before stating that a file, function, or data structure already exists in the codebase, verify via the Researcher's output. If the Researcher did not confirm it, mark UNVERIFIED."

- **"Acknowledged gap unfixed" as a tracked Corrector-1 failure class** -- R23: Corrector-1 flagged the coordinate-brief.json claim as UNVERIFIED in its notes section but did not fix the main body where the false claim remained. This is the 9th distinct Corrector-1 regression class. -- Evidence: R23 is the first instance of this specific class. -- Action: add to the regression class taxonomy. Corrector-1 regression classes are now: (1) mechanical side effect, (2) logic propagation, (3) over-correction, (4) scope understatement, (5) specification contradiction, (6) format degradation, (7) feasibility propagation, (8) semantically misleading verification, (9) acknowledged gap unfixed.

---

## DROP

- **SIDE-EFFECT-CHECK as an independent Corrector-1 regression mitigation** -- R20-R23 with SIDE-EFFECT-CHECK active: 0, 1, 2, 2 regressions. The protocol is not reducing regression rate. All R22-R23 regressions were judgment-class errors that SIDE-EFFECT-CHECK is not designed to catch. -- Evidence: 4 data points showing no improvement (regression rate trending up, not down). -- Action: subsume into multi-pass review protocol (#11). Stop evaluating or recommending SIDE-EFFECT-CHECK independently.

- **Stop analyzing evidence-gating and Corrector-2 streaks in detail** -- Evidence-gating at 14/14 runs and Corrector-2 at 23/23 runs are solved invariants. Per the effectiveness report's recommendation: "Stop analyzing these." -- Action: report the streak numbers in KEEP but do not dedicate analysis paragraphs. Redirect all improvement effort to: (1) Drafter fabrication prevention, (2) Corrector-1 structural reform, (3) novelty-flag convergence.

---

## NEW PATTERNS

### Drafter fabrication as a distinct regression class (emergent)

- **What:** The Drafter can fabricate codebase existence claims -- stating that a file or data structure "already exists" when it does not -- without the evidence-gating system catching it, because the claim is novel (not a verification of an existing fact).
- **Why:** Evidence-gating verifies existing claims ("is this VERIFIED tag accurate?") but cannot prevent the generation of new false claims. The novelty-flag system should catch it (NEW_CLAIM tag would draw scrutiny) but at 75% compliance, the most dangerous claim slipped through unflagged.
- **Evidence:** R23: "The coordinator already writes coordinate-brief.json" -- no VERIFIED tag, no evidence, survived 3 stages. First instance in 14 tracked runs.
- **Status:** 1 data point. Cannot graduate to KB yet. If this class recurs in R24-R25, it will meet stability threshold. The pattern is potentially generalizable: any pipeline where an early stage generates existence claims about external systems is vulnerable.

### Two consecutive Corrector-1 runs at 2 regressions signals structural failure

- **What:** When Corrector-1 produces 2+ regressions in consecutive runs, the regression mitigation protocol is inadequate and must be escalated beyond prompt-level changes.
- **Why:** The prior baseline was 1 regression per run (R15-R19, R21). R22-R23 at 2 each is a breakout. SIDE-EFFECT-CHECK was active in all 4 runs (R20-R23) but regressions increased from 0 to 2.
- **Evidence:** R22: 2 regressions (highest since R13). R23: 2 regressions (matches R22). Consecutive 2s had never occurred before.
- **Status:** 2 data points. Needs R24 data to confirm whether multi-pass review reduces the rate. The trigger condition (consecutive 2+) is specific enough to be actionable.

---

## NEW ANTI-PATTERNS

### Retrospective recommendation debt (8+ cycles without implementation)

- **What:** When a retrospective recommends the same process change for 3+ consecutive runs without implementation, the recommendation becomes self-referential noise. The retrospective documents the problem, recommends the fix, and then documents the same problem next run.
- **Why:** Recommendations in retrospectives are Tier 4 enforcement (behavioral prose without consequences). The retrospective has no gate mechanism to force implementation between runs.
- **Evidence:** Consistency gate: 8 retrospectives (R16-R23). Novelty-flag redesign: 7 retrospectives (R17-R23). Corrector-1 multi-pass: 5 retrospectives (R19-R23). Forcing function: 4 retrospectives (R20-R23). The forcing function recommendation, which was itself designed to prevent recommendation accumulation, has accumulated for 4 retrospectives.
- **Status:** 4+ data points on 4 separate recommendations. Meets stability and evidence thresholds. Generalizable: applies to any review process (sprint retros, incident reviews) where recommendations lack enforcement mechanisms. **Ready for KB graduation if warranted.**

---

## Candidate Pattern Updates

| ID | Pattern | Data Points | Status |
|----|---------|:-----------:|--------|
| P-R16-3 | Researcher front-loading reduces CRITICAL density | 10 (R14-R23) | R23 adds 10th data point (2 CRITs -- returns to historical mean). The 2 CRITs were codebase-reality gaps (fabrication, string comparison) that the Researcher could not catch at file level. Still blocked on cross-project generalizability. |
| P-R16-2 | Drafter regression correlates with decision count | 10 (R12-R23) | R23 (3 regs, UI-heavy plan with mockups + data flow + ACs + design-system compliance) supports the correlation: complex first-pass documents produce 2-6 regs. |
| P-R20-1 | Unflagged novel claims predict regressions (100% defect rate) | 5 (R16, R20, R21-absence, R22, R23) | R23 adds 5th data point: 1 unflagged claim (coordinate-brief.json) was the CRITICAL. 8/8 unflagged claims defective across positive runs. **Met stability threshold at R22. Still ready for KB graduation.** |
| P-R21-1 | 100% novelty-flag compliance -> 0 Drafter regressions on complex docs | 2 positive (R19, R21) + 3 counter (R20, R22, R23) | R23 (75% flags, 3 regs) adds supporting inverse evidence. Still needs 1 more positive data point at 100%. |
| P-R21-2 | Corrector-1 regression classes are non-overlapping | 9 (R15-R23 excl R20) | R23 adds 9th class (acknowledged gap unfixed). Now 9 classes in 9 runs. Pipeline-specific (fails generalizability). |
| NAP-R21-1 | SIDE-EFFECT-CHECK insufficient for judgment-class regressions | 4 (R20-R23) | R23 confirms: 2 judgment-class regressions with protocol active. Regression trend 0, 1, 2, 2. **Met stability threshold at R22.** |
| P-R22-1 | Semantic verification mismatch (format-correct, meaning-wrong) | 2 (R17, R22) | R23 did not add a data point. Still needs 1 more. |
| NAP-R23-1 | Retrospective recommendation debt (8+ cycles without implementation) | 4 recommendations across 4-8 retros each | New candidate. Meets all criteria (stability, evidence, generalizability). |
| P-R23-1 | Drafter fabrication as distinct regression class | 1 (R23) | New candidate. Needs 2 more data points. |
| P-R23-2 | Consecutive 2+ Corrector-1 regressions signals structural failure | 2 (R22-R23) | New candidate. Needs R24 data. |

---

## KB Graduation Check

Criteria: 3+ runs, measured numbers, generalizable beyond double-critique.

| Candidate | Stability | Evidence | Generalizable | Verdict |
|-----------|:---------:|:--------:|:-------------:|---------|
| P-R20-1 (Unflagged novel claims predict regressions) | 5 runs (R16, R20, R21, R22, R23) | 8/8 unflagged claims defective (100%) | Yes -- any multi-stage pipeline where early stages introduce unchecked novel content | **GRADUATE** |
| NAP-R21-1 (SIDE-EFFECT-CHECK insufficient for judgment errors) | 4 runs (R20-R23) | 0, 1, 2, 2 regressions with protocol active | Yes -- any checklist-based review checking "did I break something?" but not "is my change appropriate?" | **GRADUATE** |
| NAP-R23-1 (Retrospective recommendation debt) | 4 recommendations, 4-8 retros each | 0/4 implemented despite repeated recommendation | Yes -- any review process (sprint retros, incident reviews, post-mortems) where recommendations lack enforcement | **GRADUATE** |
| P-R16-3 (Researcher front-loading reduces CRITICAL density) | 10 runs | Measured CRIT rates | Blocked -- all data from same 2 projects | NO -- needs cross-project data |
| P-R21-1 (Novelty-flag compliance -> 0 Drafter regs) | 2 positive + 3 counter | Measured pairs | Potentially | NO -- only 2 positive data points |
| P-R23-1 (Drafter fabrication class) | 1 | Single instance | Potentially | NO -- 1 data point |
| P-R23-2 (Consecutive 2+ Corrector-1 regs = structural failure) | 2 | R22-R23 | Potentially | NO -- 2 data points |

**Three candidates meet KB graduation criteria: P-R20-1, NAP-R21-1, and NAP-R23-1.** See KB Updates section below.

---

## KB Updates

### P61 -- Unflagged Novel Claims Predict Defects (100% Defect Rate)

- **WHAT:** When a writing agent introduces a claim not present in its source material and does not flag it as novel (e.g., NEW_CLAIM tag), that claim is defective. When all novel claims are flagged, defect rate drops to 0.
- **WHY IT WORKS:** The novelty flag forces conscious self-awareness at the point of generation. Unflagged novel claims bypass both the writer's self-review and downstream critics' targeted scrutiny. The flag itself acts as a Tier 2 enforcement mechanism (mechanical detection over judgment, P6).
- **EVIDENCE:** Double-critique pipeline R16-R23: 8/8 unflagged novel claims across 4 runs (R16, R20, R22, R23) were defective or produced the highest-severity finding. 3 counter-runs at 100% flag compliance (R19, R21, R18) had 0 novel-claim-driven regressions. R23's unflagged claim ("coordinator already writes coordinate-brief.json") was a fabricated codebase existence claim that survived 3 pipeline stages.
- **DESIGN IMPLICATION:** In any multi-stage pipeline where an early stage generates content, require novel claims to be explicitly tagged. The tag converts Tier 4 (prose awareness) to Tier 2 (mechanical marker). Downstream stages should apply heightened scrutiny to tagged claims and treat untagged-but-novel claims as suspect.

Graduated to `01-proven-patterns.md` as P61.

### F57 -- Checklist-Based Review Misses Judgment-Class Errors

- **WHAT:** Adding a "did I break anything?" checklist (SIDE-EFFECT-CHECK) to a correction stage catches mechanical side effects but not judgment errors (scope understatement, feasibility propagation, acknowledged-but-unfixed gaps).
- **WHY IT FAILS:** The checklist asks "did I break a reference?" and "did I introduce a contradiction?" -- both mechanical. Judgment errors ("is this scope estimate accurate?" "should I have fixed this gap I acknowledged?") require re-evaluation of the fix's appropriateness, not its mechanical correctness. As document complexity increases, judgment-class errors dominate.
- **EVIDENCE:** Double-critique pipeline R20-R23 with SIDE-EFFECT-CHECK active: 0, 1, 2, 2 Corrector-1 regressions. All R21-R23 regressions were judgment-class. The checklist's effectiveness trended down despite being active in all 4 runs.
- **AVOID BY:** Replace single-pass checklists with multi-pass review: after each fix, (a) re-read the surrounding section, (b) re-read any referenced section, (c) ask "does my fix fully address the critic's finding, or did I acknowledge it without fixing it?" The key difference: checklists verify absence of breakage; multi-pass review verifies presence of completeness.

Graduated to `02-anti-patterns.md` as F57.

### F58 -- Retrospective Recommendation Debt (Tier 4 Without Enforcement)

- **WHAT:** When a retrospective recommends the same process change for 3+ consecutive runs without implementation, the recommendation becomes self-referential noise. The retrospective documents the problem, recommends the fix, documents the same problem next run, and the cycle repeats.
- **WHY IT FAILS:** Retrospective recommendations are Tier 4 enforcement (behavioral prose without consequences, F2). The retrospective has no gate mechanism to force implementation between runs. Each recommendation dilutes the urgency of all others. The process change that was designed to break this cycle (forcing function, #13) itself accumulated for 4 retrospectives.
- **EVIDENCE:** Double-critique pipeline: consistency gate recommended in 8 consecutive retrospectives (R16-R23), 0 implemented. Novelty-flag redesign in 7 (R17-R23), 0 implemented. Corrector-1 multi-pass in 5 (R19-R23), 0 implemented. Forcing function in 4 (R20-R23), 0 implemented. Meanwhile, the problems these changes target worsened: Drafter regressions at 2x historical mean, novelty compliance oscillating, 5 total mid-pipeline regressions.
- **AVOID BY:** Recommendations must have enforcement mechanisms. Options: (1) gate the next run on implementation of HIGH-priority changes, (2) set a TTL on recommendations (auto-drop after 3 runs without implementation), (3) assign implementation to a specific session before the next run. A recommendation without a deadline or enforcement is an observation, not a recommendation.

Graduated to `02-anti-patterns.md` as F58.

---

## Process Changes Queued (Updated Priority)

| # | Change | Retros Overdue | Priority | Status |
|---|--------|:--------------:|----------|--------|
| 2 | Drafter consistency gate (5+ decisions -> consistency matrix) | 8 (R16-R23) | MEDIUM | Not started |
| 5 | Novelty-flag structural redesign (diff-based detection) | 7 (R17-R23) | HIGH | Not started |
| 11 | Corrector-1 multi-pass review protocol | 5 (R19-R23) | **MANDATORY** | Not started |
| 12 | Drafter novel-claim self-audit step | 4 (R20-R23) | **MANDATORY** | Not started |
| 13 | Process change forcing function | 4 (R20-R23) | **MANDATORY** | Not started |
| 14 | Corrector-1 regression class tagging | 3 (R21-R23) | MEDIUM | Not started |
| 15 | Drafter regression / novelty-flag co-occurrence tracking | 3 (R21-R23) | MEDIUM | Not started |
| 16 | Semantic verification protocol for code-path claims | 2 (R22-R23) | HIGH | Not started |
| 17 | Semantic verification accuracy as tracked metric | 2 (R22-R23) | MEDIUM | Not started |
| 18 | Researcher code-path depth instruction | 2 (R22-R23) | HIGH | Not started |
| 19 | Drafter codebase-existence verification instruction | NEW (R23) | HIGH | Not started |

---

## Next Run Priorities

1. **Implement MANDATORY process changes (#11, #12, #13) before R24 or declare them rejected.** These have been recommended for 4-5 consecutive retrospectives. Per the new anti-pattern F58, continuing to recommend without implementing is self-referential noise. Either implement before R24 or explicitly reject with documented rationale and remove from the queue.

2. **Add Drafter codebase-existence verification instruction (#19).** R23's fabricated claim is a new regression class. The fix is low-effort and high-value: require Drafter to cite Researcher output for any codebase existence claim, or mark UNVERIFIED. This directly targets the most dangerous defect in R23.

3. **Implement novelty-flag structural redesign (#5).** 7 consecutive retrospectives have recommended this. 13 runs of instruction-based approach have failed to achieve stable compliance. The evidence is overwhelming: instruction-level novelty flagging does not converge. A diff-based approach (compare Drafter output to Researcher output, flag additions automatically) would convert this from Tier 4 to Tier 2 enforcement.
