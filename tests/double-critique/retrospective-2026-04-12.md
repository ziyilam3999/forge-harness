# Double-Critique Retrospective — 2026-04-12 (R25)

**Run:** R25 (forge-harness Next-Execution Plan, 295→343 lines, prose-only)
**Prior:** R24 (BUG-DIV-CWD + session-LLM split)
**Effectiveness report:** `tests/double-critique/effectiveness-2026-04-12.md`
**Note:** This file supersedes the earlier R24 retrospective that occupied the same date slot.

---

## Summary

R25 stress-tested the pipeline harder than any prior run — 31 findings (series high, +19% over R14's 26), 6 Drafter regressions (ties R13 series high), and a 100% application rate on the largest load-bearing finding set ever tracked. The safety net held (0 net regressions for the 16th straight run) but every Drafter failure mode we have been documenting for 8+ retrospectives showed up simultaneously: non-binary ACs, fabricated caps, circular criteria, and unflagged novel claims. Two independent critics both caught the same "bootstrap self-block" class of defect — a new candidate anti-pattern worth tracking but not yet graduation-ready.

---

## KEEP

- **Critic-2 as the structural safety net** — Critic-2 caught 2 bootstrap self-blocks plus the CRITICAL measurement conflation that every upstream stage missed — Evidence: 11th consecutive run as highest-single-stage-value contributor; R25 C1/C3/C4 invisible to 4 prior stages — Action: preserve unchanged; resist any pressure to collapse critics into one stage.
- **Critic complementarity (zero overlap)** — Critic-1 and Critic-2 find different classes of defect (surface vs structural) for the 9th straight run — Evidence: R25 Critic-1 = off-by-one / non-binary AC / drift formula; Critic-2 = bootstrap self-block / measurement conflation; zero overlap — Action: keep running both critics cold; do not merge prompts.
- **Researcher front-loading** — The Researcher eliminates 30-40% of critics' factual fact-checking burden, freeing them for structural work — Evidence: R25 Stage-8 extraction (4 factual corrections + 8 failure-mode gaps absorbed by Drafter); consistent R22-R24 — Action: keep Researcher as mandatory Stage 1 on runs with codebase content.
- **Evidence-gating (16/16 at 100%)** — Format-enforced VERIFIED/UNVERIFIED tags eliminate writing-stage false-verification — Evidence: 16 consecutive runs at 100% compliance, 0 fabricated VERIFIED claims — Action: STOP monitoring. Solved invariant.
- **Corrector-2 zero-regression streak (25/25)** — Final corrector has never shipped a regression — Evidence: R25 extends to 25/25; also added 2 self-caught micro-fixes (first sign of independent judgment from either corrector) — Action: STOP monitoring regression metric; watch whether independent-judgment behavior persists.
- **Net regressions in final output = 0 (16/16)** — Pipeline has never shipped a regression, even under R25 stress — Evidence: R25 introduced 7 mid-pipeline regressions, all caught — Action: keep as the top-level success metric; this is the one number that matters.

## CHANGE

- **Drafter novelty-flag enforcement** — Instruction-based novelty flagging collapsed from 100% (R24) to ~60% (R25) in one run, and 4 of 6 Drafter regressions were unflagged novel claims — Evidence: 9 retrospectives in a row have recommended redesign; 6/15 runs below 80%; 3-consecutive-at-100% threshold never met — Action: stop asking prompts to behave. Convert novelty detection to a Tier 2 mechanical check — diff Drafter output against Researcher findings and mechanically flag any quantitative claim (number, threshold, formula) that has no source-doc match as UNFLAGGED_NOVEL.
- **Corrector-1 structural reform** — Corrector-1 contributed 0 independent findings and faithfully installed the K=5 cap that Critic-2 then had to flag as self-blocking — Evidence: 11/15 runs have Corrector-1 regressions; R25 shows Corrector-1 mechanically applying bad critic suggestions without sanity-checking against the document itself — Action: require Corrector-1 to re-run a sanity pass against any number/cap/threshold it installs, matching each against sibling ACs in the same document before emitting.
- **Retire retrospective Tier 4 recommendations without enforcement hooks** — Consistency gate at 10 retros, novelty-flag redesign at 9, Corrector-1 multi-pass at 6, forcing function at 5. Zero implemented — Evidence: F58 (retrospective recommendation debt) graduated in R23; R25 made things worse — Action: ship one of these gates in the next pipeline revision, or formally drop them and accept current regression rates. No more recommendations without an implementation owner and a deadline.

## ADD

- **Pre-critique bootstrap self-check stage (lightweight, experimental)** — A single pass between Drafter and Critic-1 asking "does this plan contain any enforcement mechanism (cap, gate, CI check, AC) that would block the PR landing this plan?" — Evidence: R25 had two independent bootstrap self-blocks (C1 landing-PR gate; K=5 cap vs PH-01's 6 suspect ACs); both caught, but only because they happened to trip a cold read — Action: prototype in R26. If it catches ≥1 bootstrap self-block in R26-R28, keep it; otherwise drop.

## DROP

None this run. Reader was already dropped. Every remaining stage earned its keep in R25. Do not cut anything while load-bearing stages are passing stress tests.

---

## NEW PATTERNS (candidates — not graduation-ready)

### Candidate F60 — "Bootstrap Self-Block" Anti-Pattern

- **What:** A plan installs a new enforcement mechanism (cap, gate, CI check, landing-PR gate) sized against steady-state operation, blind to the fact that the plan's own landing PR or first implementation would be the first thing the mechanism evaluates — and blocks.
- **Why:** Plan authors reason about the mechanism's desired behavior *after adoption*, not about the transition state where the mechanism's own introduction is the first event it sees. The new rule attacks its own vector of arrival.
- **Evidence:** R25 alone produced 2 independent instances caught by 2 different critics:
  - Critic-1 F3 (Q0/L4 self-satisfaction — baseline path would trivially satisfy the new gate)
  - Critic-2 C3 (C1 landing-PR self-gate — the PR introducing C1 would be the first PR C1 blocks)
  - Critic-2 C4 (K=5 cap vs PH-01's 6 suspect ACs — the cap is smaller than the existing real-world count the plan is trying to fix)
  - n=1 session, n=2 distinct instances, n=3 counting C3+C4 as separate. **Per conservatism rule, NOT graduated this run.**
- **Analogy:** Writing a spam filter rule so strict it flags the email announcing the spam filter. Works fine for future mail; can't survive its own deployment.
- **Graduation gate:** 2 more independent sessions with the same failure signature (steady-state sizing blind to first-installation).

### Observation — "100% Application at 31 Findings"

- **What:** R25's 31/31 applied is unprecedented — 9 prior 100% runs were on 13-19 findings.
- **Ambiguity:** Either (a) critics found only real load-bearing issues, or (b) critics converged on a "safe" finding class and missed whole defect categories.
- **Signal for (a):** Two independent critics hit the same bootstrap-self-block class of defect. Strong evidence for real issues.
- **Disambiguation:** Track R26-R28. If simpler plans also hit 100%, interpretation (b) becomes more likely.
- **Status:** Memory-level observation only. Not a pattern.

### Observation — Drafter Novelty-Flag Regression (R24 → R25)

- **What:** Novelty-flag compliance collapsed from 100% (R24) to ~60% (R25) in a single run.
- **Signal:** Mechanism is non-stable. R24 was a one-run peak, not a trend.
- **Status:** Memory-level one-run regression note.

## NEW ANTI-PATTERNS

None graduation-ready this run. F60 candidate captured above (memory only, explicit graduation gate).

---

## Next Run Priorities

1. **Implement OR formally drop the novelty-flag redesign.** 9 retrospectives of "recommend and defer" is the strongest signal yet that Tier 4 prompt instructions cannot fix this. Ship a mechanical Drafter-vs-Researcher diff check that flags any numeric/threshold claim without source-doc provenance — or accept a ~2-regression-per-run baseline as permanent and stop raising it in retrospectives.
2. **Add a pre-critique bootstrap self-check stage (experimental).** Single-shot prompt against Drafter output: "does any enforcement mechanism in this plan block its own landing PR?" Prototype in R26; kill by R28 if it catches nothing.
3. **Require Corrector-1 to sanity-check numeric caps against sibling ACs.** The K=5 passthrough is the clearest-ever example of Corrector-1 acting as a mechanical typist when a 10-second re-read of the same document would have caught the issue. Add one targeted prompt constraint: "For any numeric cap you install, grep sibling ACs in this document for counts and flag contradictions."

---

## KB Update Decision

**No KB graduations this run.** Per conservatism rule:
- **F60 (bootstrap self-block)** is n=1 session / n=2-3 instances. Needs ≥2 more independent sessions with the same signature. Captured in memory.md with explicit graduation gate.
- **100% application at 31 findings** is a single-run anomaly. Needs R26-R28 disambiguation.
- **Drafter novelty-flag collapse R24→R25** is a one-run regression. Memory-only.

All three entries appended to `hive-mind-persist/memory.md`.
