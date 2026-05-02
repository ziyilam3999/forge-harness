# Retrospective: R18 — Reverse Divergence Audit Plan

**Date:** 2026-04-04
**Document:** Reverse Divergence Audit + Bidirectional Report Merge Plan (piped-sprouting-island.md)
**Run:** R18 (2nd run today; structured analytical document with 63-item classification)

## Summary
R18 critiqued a structured divergence audit plan and produced 15 findings (0 CRITICAL, 6 MAJOR, 9 MINOR). The dominant theme was arithmetic/counting errors -- a systematic blind spot in the Drafter and Corrector-1 stages. This is the first run in the tracked series with 0 CRITICALs, attributable to the most thorough Researcher pass to date. Novelty-flag compliance recovered to 100% after R17's 0%.

## KEEP
- **Dual-critique complementarity** -- Critic-1 found qualitative issues, Critic-2 found quantitative issues, zero overlap -- Evidence: R18 had 0 duplicate findings between critics; 4 consecutive runs of complementary coverage -- Action: no change needed
- **Evidence-gating protocol** -- 100% compliance for 9th consecutive run, 0 fabrication -- Evidence: 9/9 runs at 100% -- Action: solved invariant, stop monitoring
- **Corrector-2 zero-regression streak** -- 18 consecutive runs -- Evidence: 18/18 -- Action: solved invariant, stop monitoring
- **Researcher front-loading** -- Most thorough pass in series (21 claims, 7 gaps, 5 failure modes) contributed to first-ever 0 CRITICALs -- Evidence: R18 0 CRITs with 21 Researcher claims; historical correlation: more Researcher claims = fewer CRITs -- Action: maintain current Researcher thoroughness
- **Net zero regressions in final output** -- 9th consecutive run where all regressions were caught downstream -- Evidence: 9/9 runs -- Action: no change needed

## CHANGE
- **Add Drafter bullet-counting step** -- 3 of 6 MAJORs were counting errors (R7 header vs bullets, R8 header vs bullets, tier tallies). The Drafter does not verify that bullet counts match header claims. -- Evidence: R18 3 MAJOR arithmetic findings; R17 also had tier tally errors -- Action: add explicit instruction: "After writing each category, count the bullet items and verify the count matches the header. After all categories, sum headers and verify against the stated total."
- **Fix Corrector-1 side-effect check** -- Current mechanism replays header numbers instead of recounting actual bullets, propagating the exact errors it should catch. -- Evidence: R18 Corrector-1 regression (tier count ~25/~28/~10 vs actual ~21/~34/~7); R16 propagated D4/D11 contradiction -- Action: change side-effect check instruction to "recount the actual bullet items in each modified section, do not trust header numbers."
- **Novelty-flag mechanism** -- Still oscillating (0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100%). R18's 100% does not indicate convergence -- compliance appears document-type-dependent. -- Evidence: 8 data points, no monotonic trend -- Action: continue the R17 recommendation to redesign as structural detection rather than instruction-based

## ADD
- **Arithmetic verification gate for classification documents** -- Documents with per-item classification (like R18's tier system) are especially vulnerable to counting errors because the Drafter must maintain consistency between headers, bullet lists, and summary tallies. -- Action: for documents with enumerated items, add a mandatory count-verification pass between Drafter and Critic-1

## DROP
- **Evidence-gating monitoring** -- 9/9 at 100%, solved invariant. Continue enforcing but stop reporting as a tracked metric in effectiveness reports.
- **Corrector-2 regression monitoring** -- 18/18 at zero. Continue enforcing but stop reporting as a tracked metric.

## NEW PATTERNS
- **Critic rounds are complementary, not redundant**
  - **What:** Critic-1 consistently finds qualitative issues (classification, policy, correctness hazards) while Critic-2 consistently finds quantitative issues (arithmetic, counting, consistency). Zero finding overlap in R18.
  - **Why:** Critic-1 sees the Drafter's output and focuses on what the Drafter got conceptually wrong. Critic-2 sees the Corrector-1 output and focuses on what the correction introduced or failed to fix -- which is more often mechanical/arithmetic.
  - **Evidence:** R18: Critic-1 (3 MAJOR: tier labels, overlapping divergence mechanics, cross-reference hazard) vs. Critic-2 (3 MAJOR: R8 count, R7 count, tier tallies). R17: similar qualitative/quantitative split.
  - **Stability:** 2 data points with explicit zero-overlap measurement (R17, R18). Need 1 more for graduation.

- **Researcher thoroughness inversely correlates with CRITICAL count**
  - **What:** More Researcher claims verified = fewer CRITICALs found by critics
  - **Why:** The Researcher resolves factual/design issues before critics engage, shifting critics toward specification-level and mechanical issues (MAJOR/MINOR) rather than design-breaking flaws (CRITICAL)
  - **Evidence:** R14: 15 claims, 2 CRITs. R15: ~12 claims, 1 CRIT. R16: ~14 claims, 1 CRIT. R17: 14 claims, 2 CRITs. R18: 21 claims, 0 CRITs.
  - **Stability:** 5 data points (R14-R18). Meets stability threshold (3+). Meets evidence threshold (measured numbers). Generalizability: observed on both code plans and analytical documents on the same project. Lacks cross-project data.

## NEW ANTI-PATTERNS
- **Corrector-1 side-effect checks are self-referential**
  - **What:** The side-effect check mechanism replays numbers from section headers rather than recounting actual content, propagating errors it should catch
  - **Why:** The instruction says "check for side effects" but does not specify mechanical verification (recount bullets, re-sum totals). The corrector interprets this as "verify that the numbers I changed are internally consistent with each other" rather than "verify the numbers against the actual document content."
  - **Evidence:** R18: side-effect check at Corrector-1 line 76 says "9+10+6+2+9+4+6+13+4 = 63 -- still correct" but 13 was wrong (actual: 12 bullets). R16: Corrector-1 propagated D4/D11 contradiction during edit.
  - **Root cause:** The self-referential check creates a closed loop -- errors in headers propagate through the check unchanged.

## KB Graduation Assessment

**Candidate: Researcher front-loading reduces CRITICAL density (P-R16-3)**
- Stability: 5 data points (R14-R18) -- PASS (threshold: 3+)
- Evidence: Measured numbers (claim counts vs. CRITICAL counts) with clear negative correlation -- PASS
- Generalizability: Observed on code plans (R14-R16) and analytical documents (R17-R18), but all on the same project (forge-harness) -- PARTIAL. Lacks cross-project validation.
- **Verdict: NOT GRADUATED.** Generalizability criterion not fully met. Needs 1+ data point from a different project.

**Candidate: Critic complementarity (qualitative Round 1 / quantitative Round 2)**
- Stability: 2 explicit data points (R17, R18) -- FAIL (threshold: 3+)
- **Verdict: NOT GRADUATED.** Needs 1 more run.

**Candidate: Novelty-flag compliance is document-type-dependent**
- Stability: 8 data points -- PASS
- Evidence: Measured numbers -- PASS
- Generalizability: Pipeline-specific behavior -- FAIL
- **Verdict: NOT GRADUATED.** Pipeline-specific, not generalizable.

**No entries graduated to KB this run.** Closest candidate remains P-R16-3 (Researcher front-loading), now blocked only by cross-project generalizability.

## Next Run Priorities
1. **Add Drafter bullet-counting instruction** -- Explicit mechanical step: count bullets in each category, verify against header, sum headers, verify against total. This addresses the dominant finding class in R18 (arithmetic).
2. **Fix Corrector-1 side-effect check** -- Change from "verify header numbers against each other" to "recount actual bullets in modified sections." This addresses the self-referential anti-pattern.
3. **Run the pipeline on a different project** -- P-R16-3 (Researcher front-loading) is blocked on cross-project generalizability. A run on hive-mind or another project would either graduate or invalidate this candidate.
