# Measurement Reality — What the Numbers Actually Show
<!-- AI-FIRST DOCUMENT: Feed this to the AI agent during protocol planning. -->
<!-- PURPOSE: Calibrate expectations with measured data. Don't trust estimates — trust measurements. -->
<!-- WARNING: Many "obvious" metrics are misleading. This file explains which numbers to trust. -->

## How to Use This File

You are designing a new AI agent protocol. This file presents **measured data** from the old protocol's 30+ versions, real-session audits, and a 15-step migration. Use this data to calibrate design decisions. Do not propose optimizations without measurement.

---

## The Three Numbers That Matter Most

| Metric | Value | What It Means |
|--------|------:|---------------|
| **Simulated compliance** | 98% | What the AI scores when grading itself in test scenarios |
| **Real-session compliance** | 72% | What actually happens in real work sessions |
| **Self-scoring inflation** | 10-15pp | How much agents overestimate their own compliance |

**Interpretation:** Any compliance measurement done by the AI itself should be discounted by 10-15 percentage points. If the agent says "I achieved 85% compliance," the real number is likely 70-75%.

**The 26pp gap** (98% simulated vs 72% real) means: simulations are NOT a reliable metric for protocol quality. They test formatting ability, not behavioral compliance under real task pressure.

---

## Compliance by Enforcement Tier

| Tier | Mechanism | Measured Compliance | Sample Size |
|------|-----------|:-------------------:|-------------|
| 1 | Named rules + score caps | **100%** | OP-1 across all audited sessions |
| 2 | Tool-call sequencing | **90%+** | TP-1 across 12+ simulation scenarios |
| 3 | Wrong/Right examples | **70-90%** | OPEN/LEARN examples across versions |
| 4 | Behavioral prose | **0-17%** | Doc-map at 14%, gate prose at 0% in migration |

**Key insight:** The gap between Tier 1 (100%) and Tier 4 (14%) is **86 percentage points**. The enforcement mechanism is 5x more important than the rule content.

---

## Token Budget Reality

### Old Protocol Scale

| Category | Files | ~Tokens |
|----------|------:|--------:|
| Core protocol (main files) | 2 | ~5,000 |
| Rule files | 14 | ~38,100 |
| Examples | 2 | ~13,200 |
| Project docs | 7 | ~24,050 |
| Commands | 29 | ~15,000 |
| Skills | 8 dirs | ~20,000 |
| **Grand Total** | **62+** | **~115,000** |

Protocol rules alone: **~70,000 tokens** — for one developer.

### Loading Per Complexity Level

| QCS Level | Tokens Loaded | What Gets Loaded |
|-----------|-------------:|-------------------|
| 0-1 (trivial) | ~500 | PROTOCOL_LITE.md only |
| 2-3 (standard) | ~5,700+ | Core + GATES.md + WORKFLOW.md + rules |
| 4+ (complex) | ~12,000+ | Everything above + EXAMPLES + all rules |

**The QCS cliff:** Going from QCS 1 to QCS 2 jumps from ~500 to ~5,700 tokens — an 11x increase. This cliff was too steep. The new protocol should have gradual transitions.

### Token Budget Targets for New Protocol

| Level | Target | Rationale |
|-------|-------:|-----------|
| Trivial | ≤500 | PROTOCOL_LITE was already well-sized |
| Standard | ≤1,200 | Core rules + plan/test requirements |
| Complex | ≤2,000 | All rules + 1 example per gate |
| Critical | ≤3,000 | Everything + project-specific context |

---

## Protocol Creep Metrics

| Metric | Value | Assessment |
|--------|------:|------------|
| Protocol versions | 30+ | v7.4 → v12.0.0 |
| Sessions on protocol evolution | 33+ | More than the app it serves |
| Sessions on actual product | ~10-15 | The protocol became the project |
| Named rules growth | 0 → 12 | Then cut back to 5 (correct decision) |
| Self-check items | 40+ | Too many — 10 max recommended |
| Archived legacy rule files | 12 | Dead weight accumulated |
| Deprecated commands | 6 | Features nobody used |

**Protocol-to-product ratio:** 33:15 = 2.2:1 → The protocol consumed 2x more effort than the app.

**Target ratio:** Protocol sessions should be ≤1:3 of product sessions. Protocol work should be ≤25% of total effort.

---

## Migration Measurement Data

The 15-step, 6-repo migration (v12.0.0) provided the largest single dataset:

### What Achieved 100%

| Metric | Result | Why |
|--------|--------|-----|
| Acceptance criteria pass rate | 86/86 (100%) | Binary ACs + mechanical verification |
| Step execution order | 15/15 correct | Dependency ordering in step files |
| Data loss incidents | 0 | Backup-before-destroy pattern |
| Session recovery success | 4/4 | Three-view tracking files |

### What Achieved 0%

| Metric | Result | Why |
|--------|--------|-----|
| Protocol gate compliance | 0/50 responses | VS Code system prompt override |
| Compliance log entries | 0 | Downstream of gate failure |
| Learn-persist entries (during session) | 0 | Downstream of LEARN gate failure |
| DM-1 doc-map compliance | 0 | Not applicable to infrastructure work |
| Independent evaluation | 0 | Single execution context |

### Degradation Over Time

| Formality | Steps 1-5 | Steps 6-11 | Steps 12-15 |
|-----------|-----------|------------|-------------|
| Agent ID registry entries | Full (EXE + UAT + EVL) | EXE + UAT only | Condensed single row |
| EVL evaluator role | Present | Present but hollow | Dropped entirely |
| Tracking entry detail | Full narrative | Abbreviated | Condensed |

**Pattern:** Ceremony that provides no real value erodes over time. By Step 12-15, only genuinely useful tracking survived. This is natural selection of protocol features — observe what the agent keeps vs drops under pressure, then formalize the survivors.

---

## Self-Scoring Bias — Detailed Breakdown

| Measurement | Self-Reported | External Audit | Gap |
|-------------|:------------:|:--------------:|:---:|
| Gate compliance (simulation) | 98% | 72% (real session) | 26pp |
| Protocol design score | 8.2 | 5.8 (effective) | 2.4pts |
| TDD compliance | ~95% | ~85% (after TP-1) | ~10pp |
| Individual gate compliance (average) | ~85% | ~72% | ~13pp |

**Rule:** Discount any self-reported compliance by 10-15 percentage points. Use external audits (human review of conversation transcripts) as the true metric.

**Exception:** Binary mechanical checks (file exists? command output matches?) are NOT subject to self-scoring bias because the output is objective.

---

## What to Measure in the New Protocol

### Must-Measure (Track from Day 1)

1. **Rules followed / rules total** per real session (external audit, not self-report)
2. **Token cost** of protocol at each complexity level (empirical, not estimated)
3. **Protocol-to-product session ratio** (should be ≤1:3)
4. **Time-to-first-edit** — how long before the agent starts actual work (protocol overhead)

### Should-Measure (Track Monthly)

5. **Per-rule compliance rate** — identify rules below 50% for removal or elevation
6. **Session boundary recovery success** — did the agent recover correctly after interruption?
7. **User override rate** — how often does the user say "skip the ceremony, just do it"?

### Don't Bother Measuring

- Simulation compliance scores (26pp disconnected from reality)
- Self-reported gate quality (10-15pp inflated)
- Token savings from changes without empirical before/after measurement
- Formatting precision (penmanship ≠ writing quality)

---

## The Measurement Rule

> **Never claim a number without measuring it. Never optimize without a before/after baseline.**

The old protocol repeatedly made optimization claims that were later invalidated:
- "-56% token reduction" → file wasn't loaded at the relevant tier (actual savings: 0)
- "98% compliance" → simulations, not real sessions (real: 72%)
- "40% token overhead reduction" → estimate was 40% wrong (4,000 estimated vs 5,630 actual)

**Causal chain for token savings:** File exists → File in Reference Index → File loaded per QCS tier → Agent reads file → Tokens consumed. Break at ANY link = zero savings.

**Before claiming improvement:** Measure before. Implement change. Measure after. Compare. If the delta is within noise (<0.03pp over 2 iterations), it's not a real improvement.

---

## Hive Mind Manager+Subagent Execution Data (15 stories, 1 project)

The Hive Mind SPEC v1.1 implementation used a manager+subagent pattern (P20) across 15 user stories with 89 acceptance criteria. This is the first large-scale test of subagent-delegated implementation.

### Execution Metrics

| Metric | Value |
|--------|-------|
| Stories completed | 15/15 (100%) |
| Acceptance criteria verified | 89/89 (100%) |
| Tests passing | 167/167 (0 failures) |
| TypeScript errors | 0 |
| First-pass success rate | **93.75%** (15/16 cycles) |
| Retries needed | 1 (US-13 only) |
| Self-healing recovery | 100% (1/1 failures auto-fixed) |
| Step file total lines | 10,701 |
| Source files created | ~30 .ts files |
| Manager-log entries | 16 (+ 1 truncated) |

### Verification Depth Distribution

| Depth | Stories | Percentage |
|-------|:-------:|:----------:|
| Full 3-stage (impl+uat+eval) | 6 | 40% |
| 2-stage (impl+uat) | 4 | 27% |
| 1-stage (impl only) | 5 | 33% |

### UAT Execution Method

| Method | Rate | Notes |
|--------|:----:|-------|
| Command execution (shell) | **0%** | UAT commands were designed for execution but never run |
| Code inspection (manual review) | **100%** | Subagents defaulted to reading source code |

**Key finding:** Without explicit "run via Bash" in the UAT prompt, subagents default to code inspection. This is a Tier 2 enforcement gap — the behavior must be constrained explicitly.

### Session Continuity

| Metric | Value |
|--------|-------|
| Session breaks | 1 |
| Stories with stale tracking after break | 3 |
| Manual recovery entries needed | 7 |
| Recovery method | File-on-disk scan + mindmap reconciliation |

### Key Insight

**Step file quality drives first-pass success.** 93.75% of stories passed on first attempt when step files included verbatim SPEC excerpts + algorithms + ACs. The one failure (US-13) was caused by the implementer treating the export list as a suggestion, not a contract — substituting different exports while dropping 4 required ones. This led directly to constraints C-CONTRACT-1 and anti-patterns F27.

---

## E2E Pipeline Data (5 runs)

| Metric | Run-01 | Run-02 | Run-03 | Run-04 | Run-05 |
|--------|--------|--------|--------|--------|--------|
| Stories | 1 | 4 | 3 | 4 | 4 |
| Code correctness | 1/1 (100%) | 4/4 (100%) | 3/3 (100%) | 4/4 (100%) | 4/4 (100%) |
| Stories passed verify | 0 | 2 | 3 | 2 | **4** |
| Stories false-failed | 1 | 2 | 0 | 2 | 0 |
| Root cause of failures | Parser Bug 1 | Parser Bug 1 (variants) | Bug 13 (commit only) | Bug 14 (parser synonym) | Bug 15 (label-free verdict, self-healed) |
| Git commits | 0 | 0 | 0 (Bug 13) | 2 (+1 agent-initiated) | **4** (100%) |
| Manager log entries | 1 | 19 | 19+ (with EVAL_ATTEMPT) | 20+ | 20+ |
| Memory entries | 0 | 15 | 17 | 18 | 20+ |
| Tests (AC) | N/A | N/A | 41/41 (100%) | 47/47 (100%) | 66/66 (100%) |
| Exit criteria (EC) | N/A | N/A | 21/21 (100%) | 16/16 (100%) | 21/21 (100%) |
| Refactoring required | N/A | N/A | 0/3 stories | 1/4 (readability only) | 0/4 |
| First-pass success | 0% | 50% | **100%** | 50% (parser) | 75% (3/4) |
| Parser confidence | default | mixed | **all matched** | 2 matched, 2 default | 3 matched, 1 self-healed |
| Commit pass rate | 0% | 0% | 0% | **50%** (2/4) | **100%** (4/4) |

**Key insight:** Code correctness is 100% across all 5 runs (16/16 stories). Run-05 is the first fully clean run: 4/4 passed + 4/4 committed. Bug 14 fix validated. Bug 15 found (label-free verdict line) but self-healed via retry — severity is minor.

### Run-03 Detailed Results

| Story | Lines | Tests | ECs | Attempts | Refactoring | Parser Confidence |
|-------|------:|------:|----:|:--------:|:-----------:|:-----------------:|
| US-01 (types) | 9 | 5/5 | 5/5 | 1 | None | matched |
| US-02 (state machine) | 19 | 17/17 | 7/7 | 1 | None | matched |
| US-03 (collection) | 29 | 19/19 | 9/9 | 1 | None | matched |
| **Total** | **57** | **41/41** | **21/21** | **all 1** | **0/3** | **all matched** |

### Run-04 Detailed Results

| Story | ACs | ECs | Attempts | Refactoring | Parser Confidence | Committed |
|-------|----:|----:|:--------:|:-----------:|:-----------------:|:---------:|
| US-01 (types) | 4/4 | 4/4 | 3 | None | default (Bug 14) | no |
| US-02 (analyze) | 12/12 | 4/4 | 1 | None | matched | yes (`2c7ea74`) |
| US-03 (truncate) | 11/11 | 4/4 | 1 | None | matched (short-circuit) | yes (`569a635`) |
| US-04 (convert) | 20/20 | 4/4 | 3 | 3 (readability) | default (Bug 14) | no |
| **Total** | **47/47** | **16/16** | — | **1/4** | **2 matched** | **2/4** |

### Run-05 Detailed Results

| Story | ACs | ECs | Tests | Attempts | Refactoring | Parser Confidence | Committed |
|-------|----:|----:|------:|:--------:|:-----------:|:-----------------:|:---------:|
| US-01 (types) | 9/9 | 5/5 | 9/9 | 1 | None | matched | yes (`57edddf`) |
| US-02 (truncate) | 19/19 | 5/5 | 19/19 | 1 | None | matched | yes (`409da2c`) |
| US-03 (analyze) | 19/19 | 5/5 | 19/19 | 1 | None | matched | yes (`4217379`) |
| US-04 (convert) | 25/25 | 6/6 | 25/25 | 3 | None | default → matched (attempt 3) | yes (`b4a0adb`) |
| **Total** | **66/66** | **21/21** | **69/69** | — | **0/4** | **3 matched + 1 self-healed** | **4/4** |

### MVP Phase Test Growth

| Phase | Tests | Test Files | Source Files | Delta (Tests) |
|-------|------:|:----------:|:------------:|--------------:|
| Baseline (pre-MVP) | 95 | 25 | 38 | — |
| Phase 1 (Foundation) | 129 | 28 | 43 | +34 |
| Phase 2 (Reliability) | 169 | 31 | — | +40 |
| Phase 3 (Visibility & DX) | 207 | 36 | — | +38 |

Phase 2 Tier 3 live test cost: ~$0.10 for full SPEC+PLAN+EXECUTE+REPORT pipeline run. Each agent spawn costs $0.01-0.06.

**Milestone:** First fully clean E2E run — all stories pass and all committed. Bug 14 fix validated (US-01/02/03 passed attempt 1). Bug 15 found: US-04 attempts 1-2 used label-free verdict (`✅ **ALL TESTS PASSED** (21/21)`) which parser couldn't match. Attempt 3 self-healed when agent wrote `**Status**: ✅ ALL PASS`.

### Bug Fix Tracking Across Runs

| Metric | Run-01 → Run-02 | Run-02 → Run-03 | Run-03 → Run-04 | Run-04 → Run-05 |
|--------|-----------------|-----------------|-----------------|-----------------|
| Bugs fixed | 3 (Bug 2, 5, 6) | 5 (Bug 1 remaining, 9, 10, 11, 12) | 1 (Bug 13) | 1 (Bug 14) |
| New bugs found | 4 (Bug 9, 10, 11, 12) | 1 (Bug 13 — commit stage) | 1 (Bug 14 — parser synonym) | 1 (Bug 15 — label-free verdict) |
| Agent-behavior issues | 5 (grep-only eval, phantom tests, missing compiled output, fix-1 trust, N/A skip) | 1 (ESLint not installed) | 2 (fabricated output, redundant re-testing) | 0 |
| Verify pass rate | 0% → 50% | 50% → 100% | 100% → 50% (Bug 14) | 50% → **100%** |
| Commit pass rate | 0% | 0% | 0% → 50% | 50% → **100%** |

---

## Double-Critique Pipeline Data

### E2E-Bugfix Run (2026-03-08)

Input: Real bug-fix plan (5 bugs, ~200 lines). Target: `plans/e2e-bug-fix-plan.md`.

#### Finding Statistics

| Metric | Round 1 | Round 2 | Total |
|--------|---------|---------|-------|
| CRITICAL | 1 | 1 | 2 |
| MAJOR | 3 | 1 | 4 |
| MINOR | 5 | 4 | 9 |
| **Total findings** | 9 | 6 | 15 |
| Applied | 8 | 6 | 14 |
| Skipped | 1 | 0 | 1 |
| **Application rate** | 89% | 100% | 93% |

#### Pre-Critique Stage Effectiveness

- **Researcher:** 10 findings — cross-referenced knowledge base, surfaced relevant anti-patterns and proven patterns.
- **Justifier:** 4 unjustified items flagged — forced evidence or removal before critics saw the document.
- **Combined effect:** Critics focused on deeper structural and implementation issues rather than surface gaps.

#### Critique Round Differentiation

- **Round 1:** Structural issues — missing verification commands, unjustified confidence levels, incomplete fix specifications.
- **Round 2:** Caller-impact issues — return type changes breaking callers (regression from Round 1 CRITICAL fix), test coverage gaps for new behavior.

#### Prompt Enforcement Measurement

- Format compliance (structured severity tags, numbered findings): <50% reliability without reinforcement.
- Reinforces P6: mechanical detection beats behavioral prose. Prompts must constrain output format explicitly.
