# Retrospective: R17 — Root Cause Analysis Plan

**Date:** 2026-04-04
**Document:** Root cause analysis plan (piped-sprouting-island.md)
**Run:** R17 (first prose-only document in pipeline history)

## Summary
This document was reviewed by a 6-stage dual-critique pipeline. This is a team retrospective — like a post-game huddle where we decide what to keep doing, what to change, and what to stop doing. It covers data from R17 alongside historical runs.

## KEEP
- **Dual-critique catches showstoppers** — Both CRITICALs (vision-doc framing, 7 missing items) were caught by isolated critics, not the Researcher or Drafter — Evidence: 2/2 CRITICALs from critics in R17; consistent across R15-R17 — Action: no change needed
- **Evidence-gating protocol** — 100% compliance for 8th consecutive run — Evidence: 8/8 runs at 100% — Action: stop monitoring (solved invariant)
- **Corrector-2 zero-regression streak** — 17 consecutive runs with zero regressions — Evidence: 17/17 — Action: stop monitoring (solved invariant)
- **Pipeline adapts to document type** — Critics shifted from spec-gap hunting to causal-reasoning critique on prose without any instruction changes — Evidence: R17 finding types qualitatively different from R15-R16 — Action: document as emergent capability

## CHANGE
- **Novelty-flag mechanism** — 0% compliance in R17, oscillating between 0-100% across runs with no convergence — Evidence: R11R:0%, R12:90%, R13:100%, R14:N/A, R15:100%, R16:75%, R17:0% — Action: redesign from instruction-based to structural approach (e.g., diff-based detection of new claims)
- **Drafter consistency gate** — 2 regressions from interacting categories (mutual-exclusivity contradiction, methodology claim without count verification) — Evidence: 2 regressions in R17 — Action: broaden self-check to cover category interactions in prose documents, not just numbered decisions
- **Researcher scope for prose** — Researcher was MEDIUM value on prose vs. MVP on code plans; missed all analytical weaknesses — Evidence: 0 analytical findings from Researcher in R17 vs. 6+ in prior code-plan runs — Action: add analytical reasoning checks for prose documents

## ADD
- **Analytical verification layer** — Evidence-gating catches mechanical falsehoods but not logical/causal reasoning errors. Prose documents need a reasoning-soundness check — Action: add to Researcher or create lightweight pre-critic analytical gate

## DROP
- **Evidence-gating monitoring** — 8/8 at 100%, solved invariant. Continue enforcing but stop tracking as a metric
- **Corrector-2 regression monitoring** — 17/17 at zero. Continue enforcing but stop tracking as a metric

## NEW PATTERNS
- **Pipeline generalizes to non-plan document types without instruction changes**
  - **What:** The pipeline adapted to critique a root cause analysis (prose) using different finding types than it uses for code plans, without any prompt modifications
  - **Why:** Isolated critics respond to what they actually see, not what they expect to see — their cold-read approach naturally adapts to document content
  - **Evidence:** R17 finding types (framing assumptions, causal reasoning, completeness) vs. R15-R16 (schema gaps, test case errors, API surface)
  - **Analogy:** Like a book editor who can review both fiction and non-fiction — the craft of critical reading transfers across genres

## NEW ANTI-PATTERNS
- **Novelty-flag compliance is fundamentally non-convergent**
  - **What:** Instruction-based novelty flagging oscillates between 0-100% with no trend toward stability
  - **Why:** The instruction competes with the Drafter's primary task (improving the document). Under cognitive load, optional annotations are the first thing dropped
  - **Evidence:** 7 data points: 0%, 90%, 100%, N/A, 100%, 75%, 0% — no trend
  - **Analogy:** Like asking someone to count their steps while running a race — the counting is always the first thing they forget when the race gets hard

## KB Graduation Assessment
No entries meet all three graduation criteria this run:
- Evidence-gating and Corrector-2 are already in KB (P55, P56)
- Novelty-flag oscillation has 6+ data points but is pipeline-specific (fails generalizability)
- Pipeline document-type adaptation has only 1 data point for prose (fails stability threshold of 3+)

**No entries graduated to KB this run.**

## Next Run Priorities
1. **Redesign novelty-flag mechanism** — Replace instruction-based approach with structural detection (e.g., diff original vs. draft to auto-flag new claims)
2. **Broaden Drafter consistency gate** — Add check for interacting categories and cross-reference consistency in prose documents
3. **Add Researcher analytical reasoning checks** — For prose documents, include checks for causal claims, framing assumptions, and logical soundness
