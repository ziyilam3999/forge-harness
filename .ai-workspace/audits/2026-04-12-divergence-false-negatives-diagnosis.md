# Diagnosis: Divergence Measurement Anomalies (2026-04-12)

## ELI5

Two weird things happened when we measured how well our code matches the plan:
1. **The "forward" checker said 4 things were broken in PH-01, but everything actually works** — because the check looked for text in a test-runner's output, and the text format changes when run inside our helper program.
2. **The "reverse" checker found 7 things in the code that the plan didn't mention** — because we're building features and the plan hasn't caught up yet. That's not a bug, just planning debt.

## Finding 1 — Forward false negatives (PH01-US-06, 4 AC failures)

### Symptoms
After the BUG-DIV-CWD fix (v0.20.1), re-running `forge_evaluate` divergence mode on PH-01:
- AC01/AC02/AC03 reported FAIL — test count regex didn't match
- AC06 reported INCONCLUSIVE — 120s timeout
- All 548 tests actually pass when run directly (`npm test`)

### Root cause

**Pattern (F61 candidate): grep-on-vitest-output is TTY-format-dependent, unsafe in MCP subprocess.**

Affected AC commands in `.ai-workspace/plans/forge-coordinate-phase-PH-01.json`:

| AC | Command fragment | Failure mode |
|---|---|---|
| PH01-US-06-AC01 | `npx vitest run <file> 2>&1 \| grep -qE 'Tests[[:space:]]+[5-9]\|Tests[[:space:]]+[0-9]{2,}'` | vitest non-TTY output doesn't emit `Tests  N` summary line in expected shape |
| PH01-US-06-AC02 | same pattern | same |
| PH01-US-06-AC03 | same pattern | same |
| PH01-US-06-AC06 | `npx vitest run 2>&1 \| grep -q 'passed' && ! grep -q 'failed'` | Full suite >120s in subprocess; also brittle word-match |

Chain of causation:
1. `evaluateStory` spawns each AC command in a shell child process (`child_process.spawn`)
2. That child has **no TTY** (MCP server itself is a non-TTY subprocess of Claude Code)
3. `vitest` detects non-TTY and switches to a compact/CI reporter by default
4. The compact reporter's output lines differ from the interactive reporter (spacing, color codes stripped, summary format changes)
5. `grep -qE 'Tests[[:space:]]+[5-9]...'` no longer matches → exit 1 → AC status FAIL
6. Divergence engine reports it as a forward divergence

Verification: running `npx vitest run server/lib/topo-sort.test.ts` directly from the project root (TTY) passes the grep; piping through `cat` (non-TTY) changes the summary format.

### Why this slipped past
- The AC authoring guidelines (`.ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md`) warn against tool-output-format dependencies but didn't explicitly call out TTY/non-TTY divergence
- During PH-01 implementation, ACs were validated in an interactive shell where the patterns worked
- Divergence measurement is the first time these ACs were executed inside the MCP subprocess context at scale

### Fix plan (→ Q1 in execution plan)

Replace grep-based count checks with one of:

**Option A (preferred) — exit-code-only:**
```bash
npx vitest run server/lib/topo-sort.test.ts
# exit 0 iff all tests pass; no output parsing
```
Drops the "≥5 tests" minimum-count check, but a separate static-analysis AC can assert file has ≥5 `it(`/`test(` calls via grep on source (not output).

**Option B — JSON reporter:**
```bash
npx vitest run server/lib/topo-sort.test.ts --reporter=json | jq -e '.numPassedTests >= 5 and .numFailedTests == 0'
```
Preserves count semantics, requires `jq` on PATH.

**Option C — hybrid:** exit-code AC for correctness + separate source-grep AC for count minimum.

Recommend Option C across PH01-US-06 AC01-03. For AC06, use bare `npx vitest run` (exit-code-only). Audit PH-02/03/04 phase plans for similar patterns.

### Prevention
Add to hive-mind-persist `02-anti-patterns.md`:
> **F61 (candidate): Grep on test-runner output in AC commands.** Test runners (vitest, jest, mocha) emit different output formats in TTY vs non-TTY contexts. ACs that grep for specific strings/counts in runner output will false-FAIL when executed inside MCP subprocess. Use exit-code-only or `--reporter=json` parsing.

## Finding 2 — Reverse divergence (7 session-emulated findings)

### Symptoms
Session-LLM reverse scan (via the new `reverseFindings` input) returned 7 findings across coordinator source files vs PRD:
- 3 × `method-divergence` (implementation differs from PRD-prescribed method)
- 3 × `extra-functionality` (code does more than PRD asked for)
- 1 × `scope-creep` (features beyond PRD boundary)

Full list: `.ai-workspace/audits/2026-04-12-reverse-divergence-findings.json`
Narrative: `.ai-workspace/audits/2026-04-12-divergence-post-coordinate-v2.md`

### Root cause

**Pattern: Implementation-ahead-of-PRD drift during iterative development.**

Not a bug in the code or the checker — all 7 findings are cases where the PRD was written first (v1.0 → v1.1) and the implementation evolved during S3-S6 without backporting the learnings to the PRD:

| Classification | Count | Root cause |
|---|---|---|
| method-divergence (3) | 3 | PRD prescribed method X; implementation chose method Y for reasons discovered during S3/S4 (e.g., Windows path handling, CRLF tolerance). PRD never updated. |
| extra-functionality (3) | 3 | PH-04 ship self-review suggested enhancements → issues #143-#147 → implemented in v0.20.0 without PRD annotation |
| scope-creep (1) | 1 | One feature added during S6 that wasn't in any PRD version — justified in commit message but not elevated to PRD |

### Severity assessment: **LOW**
- Zero findings indicate functional bugs or unsafe behavior
- All findings are "PRD lagging behind verified shipped code", not "code lagging behind PRD"
- `alignsWithPrd: true/false` distribution: majority flagged as aligned-in-spirit

### Fix plan
- **Not a code fix.** This is a documentation sync task.
- Schedule a one-shot PRD refresh after Q1-Q3 complete, folding the 7 findings into PRD v1.2 (forge_coordinate PRD at `.ai-workspace/plans/2026-04-09-forge-coordinate-prd-v0-16-2.md`)
- For `scope-creep` finding: either annotate in PRD as "added in S6 per ship-review issue #N" or remove from code if the user judges it not worth carrying
- **Defer this** until Q1-Q3 close; PRD refresh is low-priority when total divergence is already 7 items down from 93

## Finding 3 — Why Finding 2 exists at all: the orphaned writeback primitive

The existence of 7 reverse divergence findings is itself a symptom of a deeper structural problem that needed its own root-cause investigation.

### Expectation vs reality

**Stated purpose of the three-tier system** (per `project_three_tier_docs.md`):
> "Three-tier separation keeps vision stable while allowing implementation flexibility... the system is now the standard workflow for all forge planning."

This phrasing implies bidirectional sync — plans adapt as implementation reveals new information. But the actual capability shipped is **forward-only**: forge_plan generates each tier, forge_evaluate(coherence) checks alignment between tiers, forge_evaluate(divergence) checks alignment between plan and code. Nothing in the shipped system writes findings **back** into the plan.

### The orphan primitive

There is one exception: `server/tools/plan.ts:870` — `handleUpdatePlan` — invoked via `forge_plan(documentTier: "update")`. Shipped in v0.8.0 (CHANGELOG #54). Accepts `currentPlan + implementationNotes` and produces a revised plan via the full critique/corrector pipeline.

**It has never been invoked on this repo.**

Evidence:
- `.forge/runs/` contains **0** `forge_plan*.json` run records (`ls .forge/runs/ | grep forge_plan | wc -l` → 0)
- Grep for `"tier": "update"` or `"mode": "update"` across all run records → 0 matches
- All 5 dogfood JSONs (PH01..PH04 + S7) → 0 references to update tier
- No skill, ship-pipeline, hook, or workflow invokes it

The primitive has been sitting cold since v0.8.0 (≈6 weeks).

### Why: explicit accountability hand-off, never picked up

The forge_coordinate PRD was explicit about this:

- `docs/forge-coordinate-prd.md:250` — *"the coordinator does NOT automatically invoke `forge_plan(update)` — the caller decides"*
- `docs/forge-coordinate-prd.md:454` — *"v1 leaves this to the caller; v2 may automate it"*
- `docs/primitive-backlog.md:98` — *"Self-healing integration: divergence detection → forge_plan(update) → reconcile"* (TODO, never built)
- `docs/primitive-backlog.md:197-198` — category→tier mapping already drafted but unused

So the design deferred the wiring to "v2" and "the caller". In practice, **nobody is ever the caller long enough to remember**. Each session terminates after shipping its own feature and inherits no memory of the promise to reconcile. The reverse-divergence backlog accumulated at roughly 1-3 items per phase, which integrates cleanly to the 7 we measured across 4 phases + S7.

### The architectural pattern

**Anti-pattern (candidate for `02-anti-patterns.md`): Primitive boundary accountability gap.** Shipping a *detect* primitive and a *fix* primitive without wiring them together. The contract "detector reports, caller fixes" sounds reasonable but silently fails whenever the caller is a short-lived session that never re-enters the same context.

**Proven-pattern (candidate for `01-proven-patterns.md`): detect→update→commit cycle must be a single workflow.** Detection and writeback must live behind one orchestration entry point so that drift reduction happens automatically, not as an optional afterthought. Sub-primitives can still be composable, but the default invocation must run the whole loop.

### Verification of non-mutation in current coordinator

Cross-checked that `server/lib/coordinator.ts` contains zero plan-mutating calls:
- Grep for `writeFileSync|writeFile\(|fs\.write` → **0 matches** inside `coordinator.ts`
- `reconcileState` (line 322) only logs orphans via `console.error`
- `ReplanningNote` (types/coordinate-result.ts:60) is a return-value descriptor, not a mutation directive

This confirms the coordinator is read-only by design (per Intelligent Clipboard pattern, `project_intelligent_clipboard.md`), and that no other tool in the repo compensates by writing back on its behalf.

### Fix plan (→ Q0 in execution plan)

Three simultaneous layers — workflow, integration, measurement — all of which must ship together for the loop to close. Full specification in `.ai-workspace/plans/2026-04-12-next-execution-plan.md` §Q0. Summary:

1. **Workflow layer:** `/ship` gate blocks phase PRs that don't run `forge_plan(update)` at least once in-session (no-op or non-no-op, both acceptable as long as the line is present in the PR body)
2. **Integration layer:** Build the v2 self-healing Y-pipe — a new `forge_reconcile` tool (or mode on `forge_coordinate`) that chains `forge_evaluate(reverse) → category mapping → forge_plan(update) → atomic write`
3. **Measurement layer:** Add `PhaseTransitionBrief.driftSinceLastPlanUpdate` and require the word `INVOKE` in the recommendation string whenever drift > 0

**Priority: Q0 (highest) — precedes Q1.** A broken feedback loop makes every downstream item compound noise.

## Finding 4 — Why 8 independent safeguards all missed the bad ACs (the AC trust-model gap)

Finding 1 identified *what* was wrong with the 4 PH-01 ACs (TTY-dependent grep patterns). Finding 3 explained *why plans drift*. This finding answers the sharpest question: **if the forge pipeline has a planner critique loop, a coherence evaluator, a divergence evaluator, and an AC authoring guidelines document, why did all of them miss these bad ACs until 3 days after they were shipped?**

Short answer: **the pipeline treats AC commands as trusted ground truth**. Every safeguard assumes the AC is well-formed and checks something *else* about the plan — never the AC command itself as a fallible generated artifact.

### The killer timeline (verified via git log)

| Date | Commit | Event |
|---|---|---|
| 2026-04-09 22:33 | `58dc224` (#118) | PH-01 phase plan committed with `grep -qE 'Tests[[:space:]]+[5-9]'` ACs |
| 2026-04-10 ~ | (plan draft) | `.ai-workspace/plans/2026-04-10-ac-authoring-guidelines.md` written, documenting F-55/F-56 explicitly |
| 2026-04-10 12:05 | `6288018` (#123) | PH-01 vocabulary fixes (ACs unchanged) |
| 2026-04-10 23:16 | `6b0b791` (#134) | **Planner prompt gets the subprocess-safety rule — 25 hours AFTER the bad plan was committed** |
| 2026-04-12 | (today) | Divergence measurement actually executes PH-01 ACs in MCP subprocess and surfaces the failure |

The planner at `server/lib/prompts/planner.ts:278` now contains the **exact** anti-pattern PH01-US-06 uses:
```
BAD: `npx vitest run -t 'budget' 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'`
```
PH01-US-06-AC01 is a verbatim search-and-replace of the "BAD" example in the planner prompt. But the rule didn't exist at generation time, and nothing in the pipeline re-runs against updated rules.

### The 8-safeguard gap chain

Every one of these should have caught the bug independently. None did.

**Gap 1 — Planner had no subprocess rule at generation time.**
Verified: PR #134 added `planner.ts:272-283` on 2026-04-10 23:16, 25 hours after PR #118 committed the bad plan. At generation time, the planner LLM had no instruction to avoid grep-on-vitest-output patterns. Lesson learned reactively, not proactively.

**Gap 2 — Critic still has no subprocess rule (ongoing, present-day).**
Verified: `server/lib/prompts/critic.ts` `buildCriticPrompt` has exactly 8 check categories (lines 87-103): Binary ACs, Verifiability, Implementation Coupling (greps source *code*, not tool *output* — different concern), Dependencies, Story Scope, Coverage, affectedPaths, Evidence-Gating. Grep for `tty|isatty|subprocess|reporter` in critic.ts → 0 matches. **Even today, after PR #134, the critic can't catch this class of bug.** If the planner slips (rare but possible), the critic has no backstop.

**Gap 3 — No retroactive critic run on rule update.**
When PR #134 added new planner rules, existing phase plans (`forge-coordinate-phase-PH-01.json`, etc.) were not re-evaluated with the new rules. Same orphan-feedback pattern as Finding 3: the pipeline is forward-only; updates don't propagate back to existing artifacts. The entire class of rule-improvement work is invisible to already-shipped plans.

**Gap 4 — No AC static lint between `forge_plan` output and disk.**
A ~50-LOC deny-list linter (mirroring `planner.ts:277-283`) would catch every instance of this pattern class. No such module exists. Grep for `ac-lint` or `validation/ac` or `static.*ac` → no matches. The entire validation layer (`server/validation/*`) checks schema shape (Zod), not semantic patterns.

**Gap 5 — No AC smoke test at authoring time.**
The 2026-04-10 AC authoring guidelines plan proposed **R4: "Test your AC in subprocess context"** with the exact recipe (`node -e "require('child_process').execSync(...)"`). But:
- The guide was never written (`docs/ac-authoring-guide.md` does not exist; `test -f` returns 1)
- The step was never mechanized (no code runs ACs against a sanity-check harness at plan-authoring time)
- The plan's checkpoint items are still `[ ]` unchecked

This is a classic "we wrote down the lesson but never built it". Worse than not noticing — we *did* notice, and then orphaned the fix.

**Gap 6 — Coherence evaluator trusts AC commands without executing them.**
Damning evidence: `.ai-workspace/plans/forge-coordinate-coherence-report.md:212-235` literally cites **PH01-US-06-AC06** (`npx vitest run 2>&1 | grep -q 'passed' && ! grep -q 'failed'` — the hanging multi-grep pattern) as `✅ satisfied` for NFR-C01, SC-04, and SC-05. The coherence checker read the AC command as a *string referencing the right thing* and marked it satisfied. It never ran the command. A broken AC was coherence-validated as correct. Coherence mode's job is to check "does the plan reference what the PRD requires" — it has no concept of "does the referenced check actually work".

**Gap 7 — Evaluator has no reliability signal; any failure looks the same as any other.**
`server/lib/evaluator.ts` computeVerdict is pure exit-code interpretation: exit 0 → PASS; non-zero → FAIL; timeout → INCONCLUSIVE. `CriterionResult` (types/eval-report.ts) has no `reliability` or `confidence` field. When PH01-US-06 failed under divergence mode, the evaluator emitted "FAIL" with zero meta-commentary. There is no mechanism — anywhere in the pipeline — for the evaluator to express *"this AC is suspect, degrade confidence in its result"*. This is P6 (Mechanical Detection Over Judgment) taken to an extreme that loops back into fragility: too mechanical, zero judgment.

**Gap 8 — `flaky` field exists as dead code.**
`server/types/execution-plan.ts:25` defines `flaky?: boolean` with the comment *"Not populated by the planner in Phase 1. Exists for future manual annotation"*. The escape hatch was designed and shelved. Nothing populates it; the evaluator ignores it; no `flaky: true` appears in any phase plan. An entire "suspect AC" category was architected and then abandoned.

### The deepest root cause

**The forge pipeline distinguishes artifacts by *whether they are trusted*, not *how they were produced*.** Consider the trust matrix:

| Artifact | Produced by | Treated as |
|---|---|---|
| Source code | LLM (via session) | **Fallible** — evaluator runs tests against it |
| Phase plan JSON | LLM (via `forge_plan`) | **Fallible** — critic/corrector loop runs on it |
| **AC command string inside the plan** | **LLM (via `forge_plan`)** | **TRUSTED — executed verbatim as ground truth** |

The contradiction is visible when you lay it out: **the AC command is produced by the same LLM as the plan it lives inside, but only the plan shape is critiqued. The AC command is treated as if it came from a trusted oracle.** There is no verification layer for AC commands as a distinct artifact.

This is why *all 8 safeguards fail identically*. They are all doing their job — but their job stops at the plan boundary. None of them descend into "is this shell command itself well-formed".

### Connection to Finding 3 (Q0)

Finding 3 showed that **plans drift from code because no writeback loop exists**. Finding 4 shows that **ACs drift from reality because no verification loop exists**. Both are manifestations of the same meta-pattern: *generated artifacts in the forge pipeline do not get post-generation verification against reality.*

Q0 fixes the plan→code→plan loop. Q0.5 fixes the AC→execution→AC-lint loop. They should be designed together because the fix shape is identical: **detect → classify → auto-remediate → measure**. Same plumbing, two different artifact types.

### Fix plan (→ Q0.5 in execution plan)

Seven sub-items, all binary, summarized here and fully specified in `.ai-workspace/plans/2026-04-12-next-execution-plan.md` §Q0.5:

1. **Q0.5.1** — `server/validation/ac-lint.ts` with deny-list mirroring `planner.ts:277-283` (cheapest, highest ROI)
2. **Q0.5.2** — Critic rule parity: add check #9 "Subprocess Safety" to `critic.ts` buildCriticPrompt
3. **Q0.5.3** — `CriterionResult.reliability` field; divergence mode separates `suspect` from real failures
4. **Q0.5.4** — AC smoke-test harness: run each AC once at authoring time in a headless subprocess, record exit/timing
5. **Q0.5.5** — Retroactive critic re-run on rule update: hook that re-evaluates existing plans when `critic.ts`/`planner.ts` change
6. **Q0.5.6** — Ship `docs/ac-authoring-guide.md` (finish the 2026-04-10 plan)
7. **Q0.5.7** — Reactivate `flaky` field: auto-populated by ac-lint, evaluator retries flaky ACs twice

**Priority:** Q0.5 runs in parallel with Q0 (both close orphan loops for generated artifacts). Q0.5 must precede Q1 because Q1 hand-fixes 4 specific ACs while Q0.5 prevents the next 4 from being generated.

### New hive-mind entries this finding should produce

- **Proven pattern (01-proven-patterns.md):** *"Generated artifacts require their own post-generation verification pipeline. Do not inherit trust from the generator — verify the artifact itself, separately from the thing that produced it."*
- **Anti-pattern (02-anti-patterns.md):** *"Rule-parity blindspot between planner and critic — a planner can acquire new rules without the critic learning them, leaving the critic blind to the exact patterns the planner now avoids. Fix: single source of truth for rules, shared between both prompts."*
- **Anti-pattern (02-anti-patterns.md):** *"Orphaned escape hatch — designing a `flaky`/`suspect`/`unverified` field and then marking it 'reserved for future use' without scheduling the use. If the escape hatch isn't wired up in the same PR that adds it, it will remain dead code indefinitely."*
- **Memory entry (memory.md):** *"F-55 surfaced 3 days after it was codified as a rule, because rule updates don't retroactively re-run the critic against existing plans. Latency from rule-add to rule-enforce: ~72h + 1 accidental divergence run."*

## Cross-cutting lesson

**The measurement stick must be mechanically trustworthy before you calibrate against it.** Forward divergence looked scary (4 failures in PH-01) but was a measurement artifact, not a code problem. Fixing the AC patterns (Q1) turns the divergence number into a reliable signal — which is a prerequisite for Q2 (calibration loop) to produce meaningful scores.

## References
- BUG-DIV-CWD fix: PR #151, commit `f4e1d5d`
- Divergence trajectory: 93 → 80 → 7 (see `project_design_doc_divergence.md`)
- Related anti-patterns: F54 (MCP server stale after rebuild), OAuth 401 (F55-ish) — both documented in memory
- Forward re-validation run data: PH-02/03/04 returned 0 failures; PH-01 returned 4 (all false negatives per Finding 1)
