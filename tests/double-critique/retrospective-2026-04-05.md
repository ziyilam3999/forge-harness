# Double-Critique Retrospective -- 2026-04-05

**Run:** R19 (third run today, 10th tracked run overall)
**Effectiveness report:** `tests/double-critique/effectiveness-2026-04-05.md`
**Memory file:** `hive-mind-persist/memory.md`

---

## New Observations

### Observation 1: Pre-critiqued documents suppress both CRITICALs and Drafter regressions

R19 processed a document that had already been through R17 (Part 1) and R18 (Part 2). Results: 0 CRITICALs (2nd consecutive), 0 Drafter regressions (breaking a 3-run streak of 2/run). This is a confound for two candidate patterns:
- **P-R16-3 (Researcher front-loading reduces CRITICALs):** R19 had a thorough Researcher pass AND pre-critiqued input. Cannot attribute 0 CRITICALs to Researcher alone.
- **Drafter regression correlation with complexity:** R19's document was complex (93 items) but pre-simplified by prior runs. Drafter regression rate may correlate with input novelty rather than document complexity.

**Data point count:** 1 (R19). Needs more pre-critiqued-input runs to isolate the effect.

### Observation 2: Corrector-1 regressions locked at exactly 1 per run for 5 consecutive runs

R15: 1 (platform). R16: 1 (cross-reference). R17: 1 (self-review arithmetic). R18: 1 (arithmetic propagation). R19: 1 (analytical judgment). Five different regression classes. This is no longer a fixable deficiency -- it is a capacity ceiling of the single-pass correction mechanism. The proposed fixes (cross-section check, bullet-counting instruction, side-effect recount) each address one class but not the others.

**Data point count:** 5 (R15-R19). Meets stability threshold.

### Observation 3: Novelty-flag compliance at 2 consecutive runs of 100% (R18-R19)

Both on structured/classification documents. Progression: 0% -> 90% -> 100% -> N/A -> 100% -> 75% -> 0% -> 100% -> 100%. Pattern: 100% on structured documents (R13, R15, R18, R19 = 4/4), unreliable on prose (R17: 0%) and complex specs (R12: 90%, R16: 75%). If R20 hits 100%, the structured-document subset reaches stability.

### Observation 4: Critic complementarity now at 3 consecutive runs with 0 finding overlap

R17, R18, R19: zero overlap between Critic-1 and Critic-2. Critic-1 consistently finds analytical/framing/reasoning issues. Critic-2 consistently finds evidence/arithmetic/consistency issues. This is now at stability threshold (3 runs).

---

## Candidate Pattern Updates

| ID | Pattern | Data Points | Status |
|----|---------|:-----------:|--------|
| P-R16-3 | Researcher front-loading reduces CRITICAL density | 6 (R14-R19) | Confounded by pre-critiqued input in R19. Still blocked on cross-project generalizability. |
| P-R18-1 | Critic complementarity (qualitative R1 / quantitative R2) | **3 (R17-R19)** | **Meets stability threshold.** See graduation assessment. |
| NAP-R16-1 | Corrector blind-spot on section being edited | 3 (R15, R16, R19 budget-field) | Meets stability but subsumed by broader Corrector-1 capacity ceiling observation. |
| NAP-R18-1 | Corrector-1 side-effect checks are self-referential | 3 (R16, R18, R19) | Meets stability but subsumed. |
| NAP-R18-2 | Novelty-flag compliance is document-type-dependent | 9 (R11R-R19) | Meets stability and evidence. Fails generalizability (pipeline-specific). |
| P-R16-1 | Feature-build metrics stabilize by 2nd run | 2 (R15, R16) | No new data. Stale. |
| P-R16-2 | Drafter regression correlates with decision count | 6 (R12-R19) | R19 (0 regs, complex doc) weakens correlation. May correlate with input novelty instead. |
| NAP-3 | Drafter TC regression correlation | 6 (R10-R16) | No new data. Stale. |
| NEW | Pre-critiqued input suppresses CRITICALs and Drafter regressions | 1 (R19) | Needs 2 more runs. |
| NEW | Corrector-1 regression rate is a capacity ceiling (1/run) | 5 (R15-R19) | See graduation assessment. |

---

## KB Graduation Assessment

### P-R18-1: Critic Complementarity -- GRADUATE

- **Stability:** 3 consecutive runs (R17, R18, R19) with zero finding overlap between critics.
- **Measured evidence:** Critic-1 focus: analytical framing, reasoning rigor, causal claims, structural weaknesses. Critic-2 focus: evidence consistency, arithmetic, classification accuracy, concrete actionability. Zero overlap in all 3 runs.
- **Generalizability:** Observed across prose (R17), structured classification (R18), and merged analytical report (R19) -- three different document types. Not pipeline-specific; the complementarity arises from the cold-read structure (Critic-2 sees corrected document, not original).

**Graduated entry:** "Dual-critique rounds are complementary, not redundant. Critic-1 finds analytical/framing issues; Critic-2 finds evidence/arithmetic/consistency issues. Zero finding overlap in 3+ consecutive runs across multiple document types."

### Corrector-1 Capacity Ceiling -- DO NOT GRADUATE

- **Stability:** 5 consecutive runs at exactly 1 regression.
- **Measured evidence:** 5 different regression classes (platform, cross-reference, self-review, arithmetic propagation, analytical judgment).
- **Generalizability:** FAILS. This is specific to the single-pass correction architecture. A different pipeline structure (e.g., two correction passes) would have different characteristics. The observation is valid but pipeline-architecture-specific, not generalizable.

**Action:** Record in memory as a stable pipeline-specific finding. Do not graduate to KB.

### NAP-R18-2: Novelty-Flag Document-Type Dependency -- DO NOT GRADUATE

- **Stability:** 9 data points, consistent pattern.
- **Measured evidence:** 100% on structured documents (4/4), unreliable on prose (0-75%).
- **Generalizability:** FAILS. Pipeline-specific mechanism.

**Action:** Already recorded in memory. No change.

---

## Process Change Review

| # | Change | Priority | Status | R19 Evidence |
|---|--------|----------|--------|--------------|
| 1 | Expand novelty-flag instruction scope | HIGH | Appears effective | R18-R19 at 100%. Needs R20 to confirm. |
| 2 | Add Drafter consistency gate | HIGH | NOT IMPLEMENTED | R19 had 0 regressions but on pre-critiqued input; gate still needed for fresh documents. |
| 3 | Add Corrector-1 cross-section check | MEDIUM | NOT IMPLEMENTED | R19 regression was analytical judgment, not cross-reference. Fix would not have helped. |
| 4 | Researcher annotation audit pass | LOW | NOT IMPLEMENTED | No annotation bugs in R19. Low priority confirmed. |
| 5 | Redesign novelty-flag mechanism | HIGH | DEFERRED | R18-R19 at 100% suggests instruction expansion may be sufficient for structured docs. Revisit if R20 drops. |
| 6 | Broaden Drafter consistency gate for prose | HIGH | NOT IMPLEMENTED | No prose document in R19. Still needed. |
| 7 | Researcher analytical reasoning checks | MEDIUM | NOT IMPLEMENTED | R19 confirms Researcher cannot detect analytical weaknesses. Still relevant. |
| 8 | Drafter bullet-counting instruction | HIGH | MAY BE WORKING | R19 had 0 Drafter arithmetic errors. But pre-critiqued input confounds attribution. |
| 9 | Fix Corrector-1 side-effect check | HIGH | NOT IMPLEMENTED | R19 regression was a different class (analytical). Fix is necessary but insufficient -- need broader self-review protocol. |
| 10 | Run pipeline on different project | MEDIUM | NOT DONE | Still needed for P-R16-3 cross-project data. |

**New process change proposed:**
11. **Corrector-1 multi-pass review protocol** -- Instead of a single self-review, require Corrector-1 to: (a) apply each fix, (b) re-read the immediately surrounding section for consistency, (c) check any section referenced by the modified section. This addresses the capacity ceiling by adding structure to the review, not just instructions. Priority: HIGH.

---

## Next Run Priorities

1. **Track whether Drafter regression suppression persists on fresh (non-pre-critiqued) input.** R19's 0 regressions may be an artifact of pre-critiqued input, not a genuine improvement. Next run on a fresh document will disambiguate.

2. **Track novelty-flag compliance for 3rd consecutive run at 100%.** If R20 hits 100%, the structured-document subset reaches stability threshold and can be considered a solved problem for that document type.

3. **Implement Corrector-1 multi-pass review protocol (process change #11).** The current single-pass mechanism has produced exactly 1 regression for 5 consecutive runs across 5 different error classes. Instruction-level fixes are insufficient; structural change is needed.

4. **Run pipeline on a different project** to collect cross-project data for P-R16-3 (Researcher front-loading). This pattern has 6 forge-harness data points but zero cross-project data.

5. **Track critic complementarity as a graduated KB entry.** Verify that the pattern holds across project boundaries, not just document types within forge-harness.
