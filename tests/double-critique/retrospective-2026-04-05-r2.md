# Double-Critique Retrospective -- 2026-04-05 (Run 2)

**Run:** R20 (Forge-Harness Architectural Restructuring Plan)
**Effectiveness report:** `tests/double-critique/effectiveness-2026-04-05-r2.md`
**Memory file:** `hive-mind-persist/memory.md`
**Prior retrospective:** `tests/double-critique/retrospective-2026-04-05.md` (R19)

---

## What is this report?

This is a team retrospective -- like a post-game huddle where we decide what to keep doing, what to change, and what to stop doing. It covers 11 pipeline runs (R10-R20) and distills them into actionable next steps. R20 was run on a fresh architectural restructuring plan (not pre-critiqued), which makes it the best test yet of whether recent pipeline improvements hold under pressure.

---

## KEEP

- **Researcher front-loading** -- The Researcher reads the codebase, verifies claims, and surfaces gaps before anyone else touches the document. This pre-work means critics deal with cleaner input and find specification-level issues instead of design-breaking ones. -- Evidence: 3 consecutive 0-CRITICAL runs (R18-R20), a new record. R20 Researcher surfaced 4 MAJORs and 10 failure-mode gaps, halving the estimated critic workload. Historical CRITICAL mean was ~1.6/run; now 0 for the last 3. -- Action: keep the current Researcher thoroughness level; it is the single biggest quality lever.

- **Dual-critique complementarity** -- Two independent critics read the document cold and find completely different problems. Critic-1 catches conceptual/security issues; Critic-2 catches mechanical/platform issues. -- Evidence: 4 consecutive runs (R17-R20) with zero finding overlap. R20: Critic-1 found allowDangerous trust model and blocklist underspecification; Critic-2 found Windows process tree kill and ProgressReporter tier handling. -- Action: no change. This is a graduated KB pattern working as designed.

- **Corrector-2 zero-regression streak** -- The final corrector has never introduced a new bug in 20 tracked runs. -- Evidence: 20/20 runs at zero regressions. R20: applied 7 findings + 2 self-caught improvements, zero regressions. -- Action: solved invariant; continue enforcing, stop analyzing.

- **Evidence-gating protocol** -- Every verification claim must include file paths and line numbers. No exceptions. -- Evidence: 11/11 runs at 100% compliance, zero fabricated claims ever. R20: 14 VERIFIED claims, all with citations. -- Action: solved invariant; continue enforcing, stop analyzing.

- **Net zero regressions in final output** -- Every regression introduced mid-pipeline has been caught and fixed before the final document, in every tracked run. -- Evidence: 11/11 runs at net zero regressions in the output. R20: 3 Drafter regressions all caught by Critic-2 and fixed by Corrector-2. -- Action: no change. The multi-stage architecture's core value proposition is holding.

---

## CHANGE

- **Drafter consistency gate (still not implemented after 5 retrospectives)** -- When a document has many interacting sections, the Drafter should produce a consistency matrix showing how each section relates to the others, so contradictions are caught before critics engage. -- Evidence: R20 had 3 Drafter regressions on a fresh architectural plan, the highest since R13 (6). R16-R18 each had 2. Every retrospective since R16 has recommended this gate. Complex first-pass documents consistently produce 2-6 Drafter regressions. -- Action: this is now OVERDUE. Implement the consistency gate before the next run. Specifically: for documents with 5+ interacting sections, require the Drafter to output a cross-reference matrix listing each section pair and any dependencies or constraints between them.

- **Novelty-flag enforcement** -- New claims the Drafter invents (not from the source document or Researcher) must be tagged with NEW_CLAIM so critics can scrutinize them. When untagged, they slip through and become regressions. -- Evidence: R20 novelty-flag compliance dropped to 76.9% (from 100% in R18-R19). All 3 unflagged novel claims were the exact 3 Drafter regressions. 100% of unflagged claims were defective. The compliance series (0/90/100/N-A/100/75/0/100/100/77) has never hit 3 consecutive runs at 100%. -- Action: the instruction-based approach has failed to converge. Implement the structural detection mechanism proposed in R17 (diff-based comparison of Drafter output vs Researcher input to auto-detect novel claims). This is the 4th retrospective recommending a redesign.

- **Corrector-1 multi-pass review** -- After applying a fix, the corrector should re-read the surrounding section and any referenced sections, not just verify the fix in isolation. -- Evidence: R20 posted 0 Corrector-1 regressions (first time in 5 runs), possibly due to the SIDE-EFFECT-CHECK protocol. But this is a single data point against a 5-run streak of 1-per-run. -- Action: continue the SIDE-EFFECT-CHECK protocol in R21. If R21 also posts 0 regressions, the protocol is confirmed. If R21 reverts to 1, escalate to the multi-pass review protocol (process change #11).

---

## ADD

- **Drafter novel-claim audit step** -- The Researcher verifies existing claims and finds gaps, but nobody audits the Drafter's own new contributions. This is the structural gap that lets Drafter regressions through. -- Evidence: R20's 3 regressions were all novel claims the Drafter invented. The Researcher's mandate does not cover post-Drafter content. -- Action: add an explicit self-audit step in the Drafter prompt: "After completing all edits, list every claim or specification you added that was NOT in the Researcher's output or the source document. Tag each one with NEW_CLAIM." This addresses both the novelty-flag gap and the Drafter regression gap with one mechanism.

---

## DROP

- **Nothing to drop.** All 6 stages produced unique value in R20 (no stage rated below MEDIUM). The two solved invariants (evidence-gating, Corrector-2 regressions) should stop being actively analyzed but should continue being enforced and reported.

---

## NEW PATTERNS

### Unflagged novel claims are a perfect regression predictor

- **What:** Every novel claim the Drafter adds without tagging it as NEW_CLAIM turns out to be defective. If the Drafter does not realize it invented something, that something is wrong.
- **Why:** When the Drafter consciously knows it is adding something new, it applies more scrutiny and flags it for downstream review. When it unconsciously drifts -- adding an assumption, changing a behavior, inventing a specification -- it does not scrutinize because it does not recognize the addition as novel. Unconscious additions bypass both the Drafter's self-review and the critics' targeted scrutiny of tagged claims.
- **Evidence:** R20: 3 unflagged novel claims, 3 regressions, 100% overlap. R16: 1 unflagged novel claim, 1 of the 2 regressions. Across R16 and R20 combined: 4/4 unflagged novel claims were defective (100%).
- **Analogy:** Like a chef who adds an ingredient "by feel" without writing it on the recipe card. If they know they are improvising, they taste-test carefully. If they do not realize they changed the recipe, they never taste-test, and the dish comes out wrong.

### Complex first-pass documents produce 2-6 Drafter regressions; pre-critiqued or simple documents produce 0

- **What:** The Drafter's regression rate is driven by the novelty and complexity of the input document, not by the Drafter's capability or instructions.
- **Why:** Fresh architectural documents have many interacting sections where a change to one section can silently contradict another. The Drafter integrates Researcher fixes across all sections simultaneously, creating a combinatorial space for inconsistencies. Pre-critiqued documents have already resolved most cross-section tensions.
- **Evidence:** Complex first-pass: R12 (3), R13 (6), R16 (2), R17 (2), R18 (2), R20 (3). Mean: 3.0. Pre-critiqued or simple: R14 (0), R15 (0), R19 (0). Mean: 0. The split is clean with zero overlap between the two groups.
- **Analogy:** Like editing a novel vs editing a short story. In the short story, a change on page 2 has limited ripple effects. In the novel, changing a character's motivation in chapter 3 can contradict chapters 7, 12, and 19 without the editor noticing.

### SIDE-EFFECT-CHECK protocol may have broken Corrector-1 regression streak

- **What:** R20 is the first run in 5 where Corrector-1 produced 0 regressions, coinciding with the SIDE-EFFECT-CHECK protocol.
- **Why:** The protocol forces the corrector to explicitly check for unintended consequences after each fix, rather than relying on a single end-of-pass self-review.
- **Evidence:** R15-R19: 5 consecutive runs at exactly 1 regression each. R20: 0 regressions with SIDE-EFFECT-CHECK active. Single data point -- cannot distinguish signal from noise yet.
- **Analogy:** Like a surgeon counting sponges after each step instead of only at the end of the operation. Catching a missing sponge early prevents a much bigger problem.

---

## NEW ANTI-PATTERNS

### Unfixed process changes accumulate into pipeline debt

- **What:** When a retrospective recommends a process change and it is not implemented before the next run, the same problem recurs, the same recommendation gets written again, and the retrospective becomes a record of repeated advice rather than a driver of improvement.
- **Why:** Each run generates new observations that compete for attention with prior recommendations. Without a forcing function, high-priority changes get pushed to the next retrospective indefinitely.
- **Evidence:** The Drafter consistency gate has been recommended in R16, R17, R18, R19, and R20 retrospectives -- 5 consecutive runs. It remains unimplemented. R20 produced 3 Drafter regressions on a complex document, exactly the scenario the gate was designed to prevent. The novelty-flag redesign has been recommended in R17, R18, R19, and R20 -- 4 consecutive runs.
- **Analogy:** Like a doctor who writes "exercise more" on a patient's chart every visit for a year but never prescribes a specific program. The advice is correct, but without a mechanism to force action, it is just paper.

### Novelty-flag instruction-based approach does not converge

- **What:** Telling the Drafter to tag novel claims with NEW_CLAIM via prompt instructions has been tried for 9 runs and compliance still oscillates between 0% and 100% with no stable trajectory.
- **Why:** The instruction competes with the Drafter's primary task (integrating fixes) for attention budget. On complex documents with many fixes, the tagging instruction gets deprioritized. On simple documents, there is enough attention to spare.
- **Evidence:** Compliance series across 10 runs: 0%, 90%, 100%, N/A, 100%, 75%, 0%, 100%, 100%, 76.9%. Never reached 3 consecutive runs at 100%. Drops correlate with document complexity (R16: 75%, R17: 0%, R20: 76.9% -- all complex documents).
- **Analogy:** Like asking a juggler to also count their throws out loud. When they are juggling 3 balls, they can count. When they are juggling 7, the counting is the first thing that drops.

---

## Candidate Pattern Updates

| ID | Pattern | Data Points | Status |
|----|---------|:-----------:|--------|
| P-R16-3 | Researcher front-loading reduces CRITICAL density | 7 (R14-R20) | R20 adds 7th data point (fresh doc, 0 CRITs). Still blocked on cross-project generalizability. |
| P-R16-2 | Drafter regression correlates with decision count | 7 (R12-R20) | R20 (3 regs, complex doc) strengthens. Refined: correlates with input novelty+complexity, not just decision count. |
| P-R19-1 | Pre-critiqued input suppresses CRITICALs + Drafter regressions | 1 (R19) | R20 was fresh input, so no new data point for this pattern. Still at 1. |
| NAP-R16-1 | Corrector blind-spot on section being edited | 3 (R15, R16, R19) | No new data (R20 had 0 Corrector-1 regressions). |
| NAP-R18-2 | Novelty-flag compliance is document-type-dependent | 10 (R11R-R20) | R20 adds 10th point. 76.9% on complex architectural plan confirms pattern. Pipeline-specific. |
| P-R16-1 | Feature-build metrics stabilize by 2nd run | 2 (R15, R16) | STALE -- no new data in 4 runs. Consider dropping. |
| NAP-3 | Drafter TC regression correlation | 6 (R10-R16) | STALE -- no new data in 4 runs. Subsumed by P-R16-2 refinement. Consider dropping. |
| NEW | Unflagged novel claims predict regressions | 2 (R16, R20) | Needs 1 more data point. |
| NEW | SIDE-EFFECT-CHECK may break Corrector-1 regression streak | 1 (R20) | Needs 2 more data points. |

---

## KB Graduation Assessment

### P-R16-3: Researcher Front-Loading Reduces CRITICAL Density -- NOT GRADUATED

- **Stability:** 7 data points (R14-R20) -- PASS
- **Evidence:** Measured correlation: Researcher claim counts vs CRITICAL counts. R14:15/2, R15:12/1, R16:14/1, R17:14/2, R18:21/0, R19:24/0, R20:11+10gaps/0. -- PASS
- **Generalizability:** All 7 data points are from forge-harness. -- FAIL. Still needs cross-project data.
- **Verdict: NOT GRADUATED.** Still blocked on cross-project generalizability. This is the 5th retrospective where this candidate has been assessed. Recommend running the pipeline on a hive-mind document in R21 specifically to resolve this.

### Unflagged Novel Claims Predict Regressions -- NOT GRADUATED

- **Stability:** 2 data points (R16, R20) -- FAIL (needs 3)
- **Verdict: NOT GRADUATED.** Promising (4/4 unflagged claims defective, 100%), but too few runs.

### Corrector-1 Capacity Ceiling -- NOT GRADUATED (pipeline-specific)

- **Stability:** 5 data points (R15-R19), but R20 broke the pattern (0 regressions). May no longer hold.
- **Generalizability:** Pipeline-specific -- FAIL.
- **Verdict: NOT GRADUATED.** Pattern may have been broken by SIDE-EFFECT-CHECK. Monitor R21.

**No entries graduated to KB this run.** Closest candidate remains P-R16-3 (Researcher front-loading), blocked only by cross-project generalizability for the 5th consecutive retrospective.

---

## Process Change Review

| # | Change | Priority | Status | R20 Evidence |
|---|--------|----------|--------|--------------|
| 1 | Expand novelty-flag instruction scope | HIGH | INSUFFICIENT | R20 dropped to 76.9%. Instruction expansion alone does not solve the problem on complex documents. |
| 2 | Add Drafter consistency gate | HIGH | **NOT IMPLEMENTED (5th consecutive retro)** | R20 had 3 regressions on complex doc. Gate would have caught cross-section contradictions. OVERDUE. |
| 3 | Add Corrector-1 cross-section check | MEDIUM | PARTIALLY ADDRESSED | SIDE-EFFECT-CHECK in R20 produced 0 regressions. May be sufficient. Track R21. |
| 4 | Researcher annotation audit pass | LOW | NOT IMPLEMENTED | No annotation bugs in R20. Deprioritize. |
| 5 | Redesign novelty-flag mechanism | HIGH | **NOT IMPLEMENTED (4th consecutive retro)** | R20 drop to 76.9% confirms instruction-based approach does not converge. OVERDUE. |
| 6 | Broaden Drafter consistency gate for prose | HIGH | NOT IMPLEMENTED | R20 was architectural plan, not prose. Still needed for prose runs. |
| 7 | Researcher analytical reasoning checks | MEDIUM | NOT IMPLEMENTED | Not relevant to R20 (code-adjacent document). |
| 8 | Drafter bullet-counting instruction | HIGH | INCONCLUSIVE | R20 had no arithmetic errors. May be working, but R20 was not a classification document. |
| 9 | Fix Corrector-1 side-effect check | HIGH | POSSIBLY WORKING | R20 had 0 Corrector-1 regressions with SIDE-EFFECT-CHECK. 1 data point. |
| 10 | Run pipeline on different project | MEDIUM | **NOT DONE (3rd consecutive retro)** | P-R16-3 still blocked. Deprioritize or force-schedule. |
| 11 | Corrector-1 multi-pass review protocol | HIGH | NOT TESTED | R20's 0 regressions may make this unnecessary. Defer to R21 data. |

---

## Next Run Priorities

1. **Implement the Drafter consistency gate before R21.** This has been recommended for 5 consecutive retrospectives and never implemented. R20's 3 Drafter regressions on a complex document are exactly the failure mode this gate addresses. Specific action: add a prompt section to the Drafter stage requiring a cross-reference matrix for documents with 5+ interacting sections. This is the single highest-impact unimplemented change.

2. **Implement structural novelty-flag detection.** The instruction-based NEW_CLAIM approach has oscillated for 10 runs without converging. Specific action: add a diff-based comparison step between Researcher output and Drafter output. Any specification, constraint, or behavioral claim in the Drafter output that has no corresponding entry in the Researcher output gets auto-tagged as NEW_CLAIM. This removes reliance on the Drafter's self-awareness.

3. **Run R21 on a hive-mind document.** P-R16-3 (Researcher front-loading reduces CRITICALs) has 7 data points but all from forge-harness. A single hive-mind run would either graduate or invalidate this pattern. This has been recommended for 3 retrospectives. Specific action: select a hive-mind implementation plan for R21.
