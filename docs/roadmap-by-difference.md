# Hive Mind Improvement Roadmap -- Organized by Anthropic Comparison Points

Reorganization of `docs/harness-improvement-roadmap.md` (1920 lines, Parts 1-5) into categories derived from the 8 key differences identified in `docs/harness-comparison-anthropic.md`. Every finding, code block, table, and recommendation from the original is preserved. New idea (Claude Hooks exit code 2) added. A 9th category captures ecosystem items that don't map to the original 8 differences.

## Reference Sources
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- `docs/harness-comparison-anthropic.md` -- the 8 comparison points
- `docs/hive-mind-roadmap-v2.md` -- strategic pillar definitions

---

# 1. Context Management: Full Context Reset

> **Anthropic's approach:** Context resets between sprints with structured handoff artifacts. Found that compaction alone wasn't enough -- Claude Sonnet 4.5 exhibited "context anxiety" even with summarized history.
>
> **Hive Mind's current advantage:** Each agent is already a fresh subprocess. No conversation history carries over. But memory.md grows unboundedly.

---

## 1.1 Memory Summarization Between Waves (Q1)

**Current state:** Hive Mind already does context resets inherently -- each agent is spawned as a fresh subprocess via `spawnClaude()` in `src/agents/spawner.ts:19-27`. No agent carries conversation history from a prior agent. Context is passed explicitly via input files (memory.md, step files, role reports).

**What's NOT reset:** The memory.md file grows unboundedly throughout the pipeline and is passed in full to every agent. After 20 stories, this can become very large.

**Recommendation:** YES, add memory summarization at two boundaries:
1. Between major stages (after SPEC checkpoint, after PLAN checkpoint) -- summarize memory.md into a condensed handoff
2. Between execution waves -- summarize wave learnings before passing to next wave

**How to implement (steps):**
1. Add `summarizeMemory(memoryPath, maxWords)` to `src/memory/memory-manager.ts`
2. At stage boundaries in `src/orchestrator.ts`, call summarize before passing memory to next stage
3. Between waves in wave executor (~line 1070), optionally summarize after each wave completes
4. Keep full memory.md on disk for audit, pass only summary to agents

**Should we?** YES for memory summarization between waves. NO for full context reset between stages -- Hive Mind agents already get clean context per spawn. The real problem is memory.md bloat, not conversation history.

---

## 1.2 Compress the Handoff Artifact (Appendix A, Technique 1)

The biggest token sink between iterations is passing full context forward. Instead of feeding the entire previous conversation, pass a structured summary artifact only.

**What goes in the artifact:**
- What was built (feature list, file list)
- What failed (evaluator findings, specific criteria scores)
- What the next agent must do (concrete next steps)
- What not to repeat (explicit anti-patterns from this run)

**What stays out:**
- Full conversation history
- Intermediate thinking
- Passing criteria details (only failures matter for next iteration)

Anthropic's harness used this explicitly: structured handoff files written by one agent, read by the next. This is what made context resets viable -- the handoff artifact replaced the full conversation.

**Hive Mind gap:** Agents get input files (not conversation history), which is good. But memory.md grows unboundedly and is passed in full. Step files + full source files also passed each iteration. Needs: memory summarization + diff-only source files on retry.

---

## 1.3 Sprint-Scoped Context (Appendix A, Technique 8)

If you retain a sprint structure (Hive Mind's story model), each sprint's generator should only see:
- The spec for its sprint/story
- The handoff artifact from the previous sprint
- The evaluator's findings for its sprint

Not the full spec, not all prior sprint histories. This keeps per-sprint context lean and avoids the context anxiety pattern.

**Hive Mind status:** Already done -- each story only receives its step file + relevant source files, not the full spec. No gap here.

---

## 1.4 Google's Always On Memory Agent (Part 3, Category F, Idea 18)

No vector DB, no embeddings. LLM reads, thinks, writes structured memory to SQLite. Consolidates every 30 minutes (merges duplicates, drops noise).

**Key insight for Hive Mind:** LLM decides what to remember, not an embedding pipeline. Simpler than traditional RAG.

**How to apply:**
1. Replace rule-based graduation (date count + story refs) with LLM-driven consolidation
2. Ask the model: "Which learnings are proven enough to graduate?"
3. Memory consolidation runs between pipeline stages (not on a timer)
4. Aligns with memory summarization -- LLM summarizes instead of a function

**Limitation:** Google's demo reads only 50 most recent memories. For Hive Mind with 100+ runs, need pagination or hybrid (LLM consolidation + SQL indexing).

---

# 2. Sprint Contract / GAN Negotiation

> **Anthropic's approach:** Generator and Evaluator negotiate a sprint contract before coding begins. Contract defines specific implementation details + testable behaviors. Prevents "moving goalposts."
>
> **Hive Mind's current approach:** Fixed pipeline, no negotiation. AC/EC generated by separate agents; implementer has no input. Step file is canonical.

---

## 2.1 GAN Pattern to Simplify Pipeline (Q3)

**Current state:** Hive Mind has multiple checking layers:
- BASELINE CHECK (pre-pipeline)
- COMPLIANCE CHECK (post-BUILD, per story)
- VERIFY loop (tester -> diagnostician -> fixer, up to 3 attempts)
- INTEGRATION VERIFY (cross-module)
- SCORECARD (post-pipeline)

**The GAN pattern idea:** Replace complex multi-layer checking with simple generator-evaluator loops. Generator produces work, evaluator grades it, loop until passing. This collapses COMPLIANCE + VERIFY into one loop.

**Where GAN pattern can replace existing layers:**

| Current Layer | Replace with GAN? | Justification |
|---|---|---|
| BASELINE CHECK | NO | Pre-flight, runs once, not iterative |
| COMPLIANCE CHECK | YES | Currently: reviewer -> fixer -> re-reviewer (2 attempts). GAN: generator (fixer) + evaluator (reviewer), loop until PASS or max attempts. Same logic, simpler code |
| VERIFY (AC/EC) | ALREADY IS a GAN | tester -> diagnostician -> fixer -> re-test IS a generator-evaluator loop. Already implemented this pattern |
| INTEGRATION VERIFY | NO | Runs once per module boundary, not iterative |
| SCORECARD | NO | Read-only grading, no iteration needed |

**Recommendation:** The main simplification opportunity is **merging COMPLIANCE into the VERIFY loop**. Instead of running compliance as a separate stage, make compliance criteria part of the AC/EC set. The VERIFY GAN loop already handles iteration.

**Trade-off:** Cost/time increases with more GAN iterations, but pipeline code becomes simpler. The existing VERIFY loop already caps at maxAttempts (typically 3), so cost is bounded.

**Implementation:**
1. In `src/stages/plan-stage.ts`, have EC-generator include compliance criteria (instruction coverage) as additional ECs
2. Remove `src/stages/execute-compliance.ts` as a separate stage
3. VERIFY loop now covers both functional correctness AND compliance in one GAN loop
4. Saves one agent spawn per story (compliance-reviewer + compliance-fixer eliminated)

---

## 2.2 GAN Loop Opportunities Across Pipeline (Q6)

**Where GAN loops can replace complicated layers in Hive Mind:**

| Area | Current Flow | GAN Replacement |
|---|---|---|
| SPEC critique | Drafter -> Critic1 -> Corrector -> Critic2 -> Corrector2 (5 agents) | Generator (drafter) + Evaluator (critic), loop until critic says PASS. Max 3 iterations. Saves 1-2 agents when spec is good on first try |
| COMPLIANCE | Compliance-reviewer -> Compliance-fixer -> Re-review (3 agents) | Merge into VERIFY GAN loop as additional ECs (0 extra agents) |
| REPORT validation | Reporter -> Double-critique (2 agents) | Generator (reporter) + Evaluator (critic), loop until report quality passes. Currently only 1 critique pass |
| VERIFY (AC/EC) | Already a GAN loop | No change needed |

**Net effect:** SPEC stage drops from 9 agents to ~7 (GAN loop exits early when quality is good). COMPLIANCE stage eliminated entirely (merged into VERIFY). REPORT gets iterative improvement instead of fixed double-critique.

---

## 2.3 GAN Pattern -- Eval Evolution and Auto-Research (Q11)

**Current state:** Hive Mind's evals are binary AC/EC shell commands. They don't evolve. The same criteria run on every story regardless of what the agent struggled with last time.

**Should evals evolve?** YES. Three levels of evolution:

### Level 1: Static evals (current)
- AC/EC generated once per story by AC-gen/EC-gen agents
- Never change during execution
- Same criteria on every retry iteration

### Level 2: Adaptive evals (recommended)
- After each GAN iteration, the evaluator analyzes what failed and WHY
- On retry, the evaluator adds focused criteria targeting the specific failure mode
- Example: if iteration 1 failed because of missing error handling, iteration 2 adds an error-handling-specific eval

**Implementation:**
```
Iteration 1: Run 10 ECs -> 8 pass, 2 fail (missing null check, wrong status code)
Iteration 2: Run 2 failed ECs + 2 NEW focused ECs (null safety check, HTTP status validation) + 3 regression sample from passing ECs
```

### Level 3: Self-improving evals (future -- auto-research)
- After each pipeline run, analyze which evals caught real bugs vs which were noise
- Graduate high-value eval patterns to a knowledge base (reuse Hive Mind's existing graduation system)
- Use an auto-research agent to generate new eval patterns from failure post-mortems

**ELI5:** Level 1 is a fixed exam with the same questions every time. Level 2 is a teacher who notices you're bad at fractions and adds more fraction questions. Level 3 is a school that rewrites its entire curriculum every semester based on student outcomes.

**Should the GAN loop be a skill?**

YES. This is the best architectural choice because:
1. The GAN loop pattern (generate -> evaluate -> fix -> re-evaluate) is reusable across SPEC, VERIFY, REPORT, and any future stage
2. As a skill, it can be improved by a skill-creator without changing core pipeline code
3. Different GAN configurations (max iterations, stopping criteria, eval type) can be parameterized

```yaml
# .hive-mind-skills/gan-loop/skill.yaml
name: gan-loop
description: "Generator-Evaluator loop with configurable stopping criteria"
parameters:
  generator_agent: string     # which agent generates
  evaluator_agent: string     # which agent evaluates
  max_iterations: number      # hard cap
  min_improvement: number     # score delta for diminishing returns
  fail_fast: boolean          # stop on first hard failure
  eval_criteria: string       # path to criteria file
inputs:
  - context files (varies by use case)
outputs:
  - final artifact
  - eval report with iteration history
```

**Auto-research for eval generation:**
- Before PLAN stage, spawn a research agent that analyzes the PRD + project type
- Research agent generates project-specific eval criteria (e.g., "for a REST API, always test: auth, rate limiting, error responses, pagination")
- These criteria supplement the standard AC/EC generation
- Over time, the knowledge base accumulates proven eval patterns per project type

---

## 2.4 Making GAN Pattern Loops Scalable (Q13)

**The scaling problem:** A single GAN loop (generator + evaluator, N iterations) is bounded. But what if:
- A 50-story pipeline has 50 independent GAN loops running in waves?
- Each loop spawns 3-5 agents per iteration x 3 iterations = 9-15 agents per story?
- 50 stories x 15 agents = 750 agent spawns?

**Three dimensions of GAN scalability:**

### Dimension 1: Horizontal -- Parallel GAN loops

Multiple stories run their GAN loops concurrently (Hive Mind already does this via waves). Scaling means:
- Increase `maxConcurrency` (currently default 3)
- Ensure non-overlapping file sets (already implemented in `filterNonOverlapping`)
- Add resource-aware scheduling: if API rate limits approach, reduce concurrency dynamically

```
Wave 1: [Story A GAN loop] [Story B GAN loop] [Story C GAN loop]  -- parallel
Wave 2: [Story D GAN loop] [Story E GAN loop]                      -- parallel
```

**Implementation:** Add adaptive concurrency in wave executor:
```typescript
function getAdaptiveConcurrency(config: HiveMindConfig, costTracker: CostTracker): number {
  const recentRateLimits = costTracker.getRecentUsageLimitHits(lastMinutes: 5);
  if (recentRateLimits > 2) return Math.max(1, config.maxConcurrency - 1);
  return config.maxConcurrency;
}
```

### Dimension 2: Vertical -- Nested GAN loops

A GAN loop inside a GAN loop. Example:
- Outer loop: SPEC critique (generate spec -> evaluate spec -> refine)
- Inner loop: Each SPEC section could have its own generate-evaluate cycle

**Should we?** NO for now. Nested loops explode cost quadratically. Keep GAN loops flat -- one level of iteration per stage. If the outer loop needs improvement, the INNER work should be better, not recursive.

### Dimension 3: Temporal -- Cross-run improvement

GAN loops get better over time by learning from prior runs:
- Track which eval criteria consistently fail on first attempt -> pre-generate hints for the generator
- Track which failure patterns the fixer resolves quickly -> prioritize those fix strategies
- Graduate successful fix patterns to knowledge base

**ELI5:** Horizontal = more chefs cooking different dishes at the same time. Vertical = a chef asking another chef to critique their critique (don't do this). Temporal = the kitchen gets better every night because they write down what worked.

**Scalability limits and practical caps:**

| Parameter | Default | Max Recommended | Why |
|---|---|---|---|
| maxConcurrency | 3 | 8-10 | API rate limits, git merge conflicts |
| maxAttempts (GAN iterations) | 3 | 5 | Diminishing returns after 3-4 |
| maxBuildAttempts | 2 | 3 | If BUILD fails 3x, the story spec is wrong |
| Stories per wave | unbounded | 10 | Merge complexity, progress visibility |

---

## 2.5 GAN Pattern Refinement (Part 3, Category G: Ideas 12, 13)

Key reinforcements from Anthropic's details:

- **Separation is critical:** Generator and evaluator MUST be separate agents
- **Few-shot skepticism:** Train evaluator to be skeptical via few-shot examples of harsh-but-fair critiques. Currently Hive Mind's critic has no few-shot examples.
- **5-15 cycles is the range.** Hive Mind caps at 3. Consider increasing to 5 for thorough mode.
- **Context anxiety avoidance:** Each GAN iteration should get clean context with handoff artifact

**New action item:** Add few-shot skepticism examples to critic/evaluator agent prompts in `src/agents/prompts.ts`. Small change, high impact.

---

## 2.6 NEW: Claude Hooks Exit Code 2 for GAN Loop Feedback

**Concept:** Claude Code hooks support exit code 2 as a special return: instead of hard-stopping the agent (exit code 1) or allowing silently (exit code 0), exit code 2 feeds the hook's stderr output back to the agent as context. The agent receives the feedback and can adjust its behavior.

**Why this matters for GAN negotiation:**

This is a native, zero-orchestration mechanism for implementing evaluator feedback loops. Instead of building custom GAN loop logic in the orchestrator, a Claude hook can serve as the evaluator:

```
Agent generates code
  -> Hook runs evaluation (lint, type-check, test, custom criteria)
  -> If issues found: exit code 2 + stderr describes the problems
  -> Agent receives feedback, fixes, regenerates
  -> Hook re-evaluates
  -> Loop continues until hook returns exit code 0 (pass)
```

**How it differs from current GAN loops:**
- Current: orchestrator spawns separate evaluator agent, parses output, decides retry, spawns fixer agent
- Hooks approach: single agent + hook, feedback is inline, no orchestrator logic needed
- Hooks are cheaper (run shell commands, not full agent spawns) and faster (no agent startup overhead)

**Where to apply in Hive Mind:**

| Use Case | Hook Implementation | Replaces |
|---|---|---|
| **Type checking during BUILD** | Hook runs `npx tsc --noEmit`, exit 2 on errors with error text | Separate compliance type-check |
| **Lint checking during BUILD** | Hook runs `npm run lint`, exit 2 on findings | Post-build lint pass |
| **AC/EC quick-check** | Hook runs shell-based ECs, exit 2 on failures | First pass of VERIFY loop |
| **SPEC format validation** | Hook validates SPEC structure, exit 2 with missing sections | SPEC critic first pass |

**Implementation:**
1. Define hooks in `.claude/settings.json` or per-agent hook configs
2. Hooks run lightweight checks (shell commands, not LLM calls)
3. Exit code 2 returns feedback; agent self-corrects within same session
4. If agent exhausts retries (implicit from max tool calls), orchestrator escalates to full GAN loop with separate evaluator

**Key insight:** Hooks handle the "easy" iterations (type errors, lint, format) cheaply. The full GAN loop with separate evaluator agent handles the "hard" iterations (logic errors, design quality, subjective criteria). This creates a two-tier evaluation system that saves significant cost.

**Example hook configuration:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": { "toolName": "Write" },
        "command": "bash -c 'cd $PROJECT_ROOT && npx tsc --noEmit 2>&1 || exit 2'",
        "description": "Type-check after every file write, feed errors back to agent"
      }
    ]
  }
}
```

**Priority:** HIGH -- minimal implementation effort, immediate cost reduction on GAN loops, uses native Claude Code infrastructure.

---

## 2.7 Proven Ways to Save Token Cost in GAN Loops (Appendix A)

### The Cost Problem

Every iteration of a GAN loop costs tokens on both sides:

```
generator prompt + context + output
   + evaluator prompt + full app context + criteria + output
      = one iteration cost

x 5-15 iterations = expensive fast
```

Anthropic's runs: $124-200, 4-6 hours. Most of that is generator time. The evaluator is relatively cheap per pass. The waste is in the generator re-reading the same context on every iteration.

### Technique 1: Fail Fast on the Evaluator (High Impact)

Don't run the evaluator to completion if a hard-fail criterion is hit early.

**Standard flow:** evaluator grades all 4-6 criteria, writes full report, then generator retries.

**Optimized flow:** evaluator grades in priority order (functionality first, design last). If functionality fails hard, stop grading, return minimal feedback, trigger generator retry immediately.

This cuts evaluator token spend per failed iteration by 40-70% depending on where in the criteria list failures cluster.

**Hive Mind gap:** tester-exec and evaluator run ALL ACs/ECs to completion every time. Should short-circuit on first hard fail. Implement by adding priority ordering to ACs and a `--fail-fast` mode to the tester prompt.

### Technique 2: Differential Evaluation (High Impact)

On iteration 2+, the evaluator should only re-grade what changed -- not the full app.

**Standard:** evaluator re-tests everything every pass.
**Optimized:** generator declares what changed in a diff manifest. Evaluator re-tests only those features plus a regression sample.

This requires the generator to output a structured change manifest:

```json
{
  "changed": ["sprite editor", "level export"],
  "unchanged": ["project dashboard", "play mode"],
  "new": ["animation system"]
}
```

**Hive Mind gap:** VERIFY re-runs ALL ACs/ECs every iteration. If 8/10 ACs passed on iteration 1, iteration 2 still re-tests all 10. This is the biggest low-hanging fruit -- track per-AC pass/fail state and only re-test failures + a regression sample.

### Technique 3: Tiered Model Selection (Medium-High Impact)

Not every agent in the loop needs the most expensive model.

| Agent | Task | Recommended Model |
|---|---|---|
| Planner | Spec expansion, one-time | Sonnet -- structured, not creative |
| Generator | Coding, iterative | Opus -- needs full capability |
| Evaluator | Criteria scoring, structured | Sonnet or Haiku -- grading is pattern-matching, not reasoning |

**Hive Mind status:** Already done well -- implementer=opus, tester/evaluator=haiku, diagnostician/fixer=sonnet. No gap here.

### Technique 4: Criteria Gating (Medium Impact)

Anthropic noted that as models improve, some criteria become unnecessary overhead. Claude 4.6 passed functionality checks that 4.5 needed evaluator help with.

**Practical approach:**
- Run 10 generations without the evaluator
- Measure which criteria the generator passes consistently on its own
- Remove those criteria from the evaluator loop
- Keep only the criteria where the generator's solo score is below your threshold

**Hive Mind gap:** All AC/EC criteria evaluated every run regardless of model capability. Worth measuring.

### Technique 5: Cap Iterations with a Quality Floor Check (Medium Impact)

Don't run 15 iterations by default. Set a dynamic stopping rule:

```
after each iteration:
  if score >= threshold: stop
  if score_delta < minimum_improvement: stop (diminishing returns)
  if iterations >= hard_cap: stop
```

**Hive Mind gap:** maxAttempts cap exists, but no score_delta check or diminishing-returns detection.

### Technique 6: Prompt Caching (Medium Impact, Easiest to Implement)

Anthropic's API supports prompt caching for static prompt content. In a GAN loop, the evaluator's system prompt is identical every iteration.

**Estimated savings:** 80-90% token cost reduction on the cached portion.

Implement with: `cache_control: {"type": "ephemeral"}` on the static portions of your system prompt.

**Hive Mind gap:** Each `spawnClaude()` builds prompt fresh via CLI invocation. Need to restructure to use Claude API directly with cache_control, or structure CLI prompts so stable content benefits from automatic caching.

### Cost Reduction Summary

| Technique | Complexity | Est. Savings | Proven? | Hive Mind Gap? |
|---|---|---|---|---|
| Compress handoff artifact | Medium | 30-50% on context | Yes -- Anthropic harness | YES -- memory.md bloat |
| Fail fast on evaluator | Low | 40-70% on failed evals | Yes -- first principles | YES -- no short-circuit |
| Differential evaluation | Medium | 30-50% on later iterations | Yes -- software QA pattern | YES -- re-tests everything |
| Tiered model selection | Low | 20-40% on evaluator | Yes -- Anthropic cost breakdown | No -- already done |
| Criteria gating | Medium | 10-30% per run | Yes -- Anthropic iteration | YES -- worth measuring |
| Dynamic stopping rule | Low | 10-30% on wasted iterations | Yes -- Anthropic plateau observation | YES -- no delta check |
| Prompt caching | Low | 80-90% on static prompts | Yes -- Anthropic API feature | YES -- not implemented |
| Sprint-scoped context | Medium | 10-20% on generator | Yes -- Hive Mind pattern | No -- already done |
| **Claude hooks exit code 2** | **Low** | **50-80% on easy iterations** | **Yes -- native Claude Code** | **YES -- not implemented** |

### ELI5

Imagine paying a chef and food critic to iterate on a dish. The waste happens when: the critic re-reads the entire menu each visit instead of just the changed dish; the chef re-explains the whole restaurant concept every time; they keep iterating after the dish is already good enough; and you hired a michelin-starred critic just to check if salt was added. Fix all four and you cut the bill by more than half without changing the quality of the final dish.

### Priority for Hive Mind Implementation

| # | Technique | Where to Apply | Effort | Impact |
|---|---|---|---|---|
| 1 | Differential evaluation | VERIFY loop -- only re-test failed ACs/ECs | Medium | HIGHEST -- halves evaluator cost |
| 2 | Fail fast on evaluator | VERIFY loop -- short-circuit on hard fail | Small | HIGH -- 40-70% on failed evals |
| 3 | Prompt caching | spawner.ts -- cache_control on static content | Medium | HIGH -- 80-90% on static prompts |
| 4 | Compress handoff | Memory summarization between waves | Medium | HIGH -- 30-50% on context |
| 5 | Claude hooks exit code 2 | Hook-based type/lint checks during BUILD | Small | HIGH -- eliminates easy iterations |
| 6 | Dynamic stopping | VERIFY loop -- add score_delta check | Small | MEDIUM -- saves wasted iterations |
| 7 | Criteria gating | Measure which ECs opus passes solo | Medium | MEDIUM -- data-driven removal |

---

# 3. Self-Evaluation Bias

> **Anthropic's problem:** Agents confidently praise their own mediocre output. Self-evaluation bias is amplified in subjective tasks.
>
> **Hive Mind's advantage:** Binary AC/EC evaluation has ZERO bias by design. Shell command exits 0 or non-zero. No room for subjective self-praise.

---

## 3.1 Agent Bias Solutions from Anthropic (Q6 -- Bias Section)

**How Anthropic solves evaluation bias:**
1. **Separate evaluator agent** that never saw the generation process (eliminates self-praise)
2. **Concrete rubric** that turns subjective quality into gradable terms (eliminates vagueness)
3. **Penalize generic output** explicitly in the rubric ("is this template layouts and library defaults?")
4. **Weight creative dimensions** higher than competence dimensions (pushes beyond "good enough")

Their four rubric dimensions:
1. **Design Quality** -- "Does the design feel like a coherent whole rather than a collection of parts?"
2. **Originality** -- "Is there evidence of custom decisions, or is this template layouts and AI-generated patterns?"
3. **Craft** -- Typography hierarchy, spacing consistency, color harmony, contrast ratios
4. **Functionality** -- Can users find primary actions and complete tasks?

**Where Hive Mind could improve:**
- **REPORT stage**: reporter agent consolidates data but could be biased toward positive framing
- **Learner agent**: captures "what worked/failed" but may over-emphasize successes
- Consider: independent "devil's advocate" agent that specifically looks for gaps in the report

---

## 3.2 Few-Shot Skepticism for Evaluators (Part 3, Category G)

- **Few-shot skepticism:** Train evaluator to be skeptical via few-shot examples of harsh-but-fair critiques. Currently Hive Mind's critic has no few-shot examples.
- **Separation is critical:** Generator and evaluator MUST be separate agents
- **5-15 cycles is the range.** Hive Mind caps at 3. Consider increasing to 5 for thorough mode.

**New action item:** Add few-shot skepticism examples to critic/evaluator agent prompts in `src/agents/prompts.ts`. Small change, high impact.

---

## 3.3 Multi-Dimensional Scorecard with Anthropic-Style Rubric (Q8)

**Current state:** Hive Mind's scorecard (`src/stages/scorecard.ts`) accumulates per-stage metrics and assigns a single letter grade (A/B/C/D/F) based on pass rate at the REPORT stage.

**Anthropic's rubric approach:** Turn subjective quality into concrete gradable terms. Each dimension has a clear definition that tells the evaluator exactly what to look for.

**Proposed multi-dimensional scorecard:**

| Dimension | What It Measures | How to Grade | Source Data |
|---|---|---|---|
| **Correctness** | Do ACs and ECs pass? | % pass rate | VERIFY results |
| **Code Quality** | Is the code well-structured? | Critical/major/minor finding counts | Code-reviewer report |
| **Regression Safety** | Did we break existing functionality? | Baseline test delta | Baseline vs. post-execute test results |
| **Compliance** | Does implementation match spec instructions? | % instructions with implementations | Compliance-reviewer report |
| **Architecture** | Do module boundaries hold? | Contract violations count | Integration-verifier report |
| **Efficiency** | How many retries were needed? | Retry ratio (attempts / stories) | Manager log |
| **Learning Velocity** | Did agents capture useful insights? | Learnings per story, graduation count | Memory/graduation data |

**Rubric format (Anthropic-style concrete terms):**

```
CORRECTNESS (weight: 30%)
  A: 95%+ ACs/ECs pass on first attempt
  B: 85%+ pass, all eventually pass after retry
  C: 70%+ pass after retry
  D: 50%+ pass
  F: <50% pass

CODE QUALITY (weight: 20%)
  A: 0 critical, 0 major findings
  B: 0 critical, <=2 major findings
  C: 0 critical, <=5 major findings
  D: 1 critical OR >5 major findings
  F: >1 critical findings

REGRESSION SAFETY (weight: 20%)
  A: All baseline tests still pass, no new warnings
  B: All baseline tests pass, minor new warnings
  C: 1-2 baseline tests regressed but non-critical
  D: 3+ baseline tests regressed
  F: Build broken or >10% baseline regression

COMPLIANCE (weight: 15%)
  A: 100% spec instructions implemented
  B: 90%+ implemented, remainder marked UNCERTAIN
  C: 80%+ implemented
  D: 60%+ implemented
  F: <60% implemented

EFFICIENCY (weight: 10%)
  A: Average <1.2 attempts per story
  B: Average <1.5 attempts
  C: Average <2.0 attempts
  D: Average <2.5 attempts
  F: Average 2.5+ attempts

LEARNING (weight: 5%)
  A: 2+ graduations, >1 learning per story
  B: 1+ graduation, >0.5 learnings per story
  C: >0.3 learnings per story
  D: Some learnings captured
  F: No learnings captured
```

**Implementation:**
1. Update `src/stages/scorecard.ts` to pass dimension data to scorecard agent
2. Update scorecard agent prompt in `src/agents/prompts.ts` with the rubric above
3. Scorecard agent outputs per-dimension grades + weighted overall grade
4. Include in both report-card.md and live dashboard

---

# 4. Spec Granularity

> **Anthropic's approach:** Planner deliberately avoids specifying granular technical details. Errors in the spec cascade into downstream implementation. Planner constrains on deliverables and lets agents figure out the path.
>
> **Hive Mind's current approach:** Already partially aligned. SPEC stays relatively high-level. AC/EC generation delegated to downstream agents. Detail emerges during PLAN stage.

---

## 4.1 STRATEGIC-ONLY Spec Rule (Q4)

**Current state:** Hive Mind's SPEC is moderately technical:
- SPEC-v1.0.md includes architecture decisions, inter-module contracts, data structures
- But AC/EC generation is deferred to PLAN stage (not in SPEC)
- This is already partially aligned with Anthropic's "avoid technical detail in spec"

**The dilemma:** If we deliberately avoid ALL technical detail in SPEC, how do we control whether the project uses Python or TypeScript?

**Resolution -- two levels of technical detail:**
1. **Strategic decisions** (KEEP in SPEC): language choice, framework choice, database choice, deployment model, API style (REST/GraphQL). These are WHAT decisions that constrain all downstream work.
2. **Implementation details** (REMOVE from SPEC): specific function signatures, file structure, class hierarchies, algorithm choices. These are HOW decisions the implementer should figure out.

**Should we drop SPEC entirely?** NO. The SPEC serves three critical purposes:
1. Defines the contract that AC/EC test cases are built against
2. Makes strategic technology choices explicit (Python vs TypeScript)
3. Gives the human a checkpoint to review before expensive EXECUTE phase

**Anthropic's planner also keeps strategic decisions** -- they specify "React, Vite, FastAPI, SQLite" stack in the planner output. They just avoid specifying function-level detail.

**Recommendation:** Keep SPEC but add a rule to spec-drafter prompt: "STRATEGIC-ONLY: Specify technology stack, API boundaries, data model, and deployment. Do NOT specify function signatures, class hierarchies, or file-level implementation details."

---

## 4.2 Dynamic Agent Architecture for Spec Flexibility (Q10)

**Current state:** Hive Mind has 33 hardcoded agent types with fixed jobs, fixed rules, and fixed model assignments. The pipeline shape is predetermined.

**The problem with fixed tiers:** A 10-story PRD might need thorough SPEC but quick VERIFY. Tiers are better than one-size-fits-all, but still limited.

**Recommendation: Hybrid -- `.agent/` for agent definitions + orchestrator intelligence for composition**

**ELI5:** Think of agents like workers with resumes (`.agent/` files). The orchestrator is the project manager who reads the resumes and decides who to hire for each job.

```yaml
# .hive-mind-agents/implementer/agent.yaml
name: implementer
description: "Implements a single user story from a step file"
model: opus
tools: [Read, Write, Edit, Bash, Glob, Grep]
inputs:
  - step-file.md
  - source-files (from sourceFiles in story)
outputs:
  - impl-report.md
  - modified source files
rules:
  - STEP-FILE-ONLY: Only implement what the step file specifies
  - NO-STUBS: Every function must have a real implementation
  - TYPE-SAFE: All TypeScript must compile without errors
```

**Migration path:**
1. Extract current hardcoded agent definitions from `prompts.ts` into `.agent/` YAML files
2. Load agent definitions at startup instead of importing from code
3. Add a staffing agent that produces the agent execution graph
4. Orchestrator executes the graph instead of hardcoded stage functions

---

# 5. Evaluation Criteria / Rubric Design

> **Anthropic's approach:** Turned subjective judgments into concrete, gradable terms across four dimensions. Evaluator equipped with Playwright for e2e testing.
>
> **Hive Mind's current approach:** Binary AC/EC evaluation (PASS/FAIL). Compliance checking (DONE/MISSING/UNCERTAIN). Scorecard with single letter grade. No subjective quality assessment.

---

## 5.1 Playwright-Based Verification (Q2)

**Current state:** Hive Mind's verify stage (execute-verify.ts) uses shell command exit codes for binary PASS/FAIL.

**How to add Playwright (steps):**
1. Add `playwright` as optional dependency in package.json
2. Create `src/tooling/playwright-setup.ts` -- detect if project has UI, install Playwright if needed
3. In `src/stages/execute-verify.ts`, add a `runPlaywrightTests()` path alongside shell-based testing
4. EC-generator needs a new instruction block for UI projects: generate Playwright test scripts
5. Add `--playwright` flag or auto-detect from project type

**Should we?** MEDIUM priority. Only valuable for frontend/full-stack projects. Make it opt-in via flag or auto-detection.

---

## 5.2 Browser & UI Testing (Part 3, Category C: Ideas 6, 7, 14, 15, 17)

| # | Tool | Role in Pipeline |
|---|---|---|
| 6 | **Firecrawl CLI** | Web scraping -- research agent crawls docs, competitor analysis |
| 7 | **Playwright CLI** | Headless browser testing -- automated E2E tests for web UIs |
| 14 | **Evaluator with Playwright** | Anthropic's approach: Playwright as evaluation backbone for GAN loop |
| 15 | **Chrome extension** | Claude Code + Chrome: build-test-fix loop |
| 17 | **Self-testing** | Claude Code runs app, clicks through pages, catches hidden errors |

**The vision: Hive Mind with browser eyes**

```
EXECUTE stage (for web projects):
  BUILD: implementer writes code
  DEPLOY: auto-deploy to localhost (or Vercel preview)
  BROWSER-TEST: Playwright agent tests all ACs visually
  DIAGNOSE: if issues, screenshot + DOM state captured
  FIX: fixer gets screenshot + error context
  RE-TEST: Playwright re-runs
  (GAN loop until passing)
```

---

## 5.3 Front-End Design Pipeline (Part 3, Category D: Ideas 10, 16)

**Design-aware pipeline:**

```
PRD + Figma Link
  --> SPEC (reads Figma design tokens, layout, components via MCP)
  --> PLAN (stories reference specific Figma frames)
  --> EXECUTE
      BUILD: implementer codes against Figma specs
      VISUAL-CHECK: Chrome extension compares live UI to Figma reference
      DESIGN-EVAL: evaluator grades Design Quality, Originality, Craft
  --> Code to Canvas: push final UI back to Figma for designer review
  --> REPORT (includes Figma comparison screenshots)
```

**Anti-AI-slop strategy:**
1. **Brand control:** Figma MCP reads design tokens, injects as constraints
2. **Theme system:** 10 curated themes as base
3. **Visual regression:** Compare screenshots against Figma reference
4. **Originality scoring:** Anthropic's rubric penalizes "template layouts and AI-generated patterns"

---

## 5.4 Claude's Built-in Browser Testing (Part 4, Idea 3)

Use Claude's built-in browser testing via the Chrome extension + `--chrome` flag.

**How Hive Mind uses it:**
```
EXECUTE stage (web projects):
  BUILD: implementer writes code
  VISUAL-VERIFY: spawn agent with --chrome flag
    Agent: "Open localhost:3000, test the login flow, verify responsive design"
    Agent sees the page, catches issues, fixes code, re-tests
    GAN loop until passing
```

**Recommendation:** Use Chrome skill for subjective evaluation (design quality, UX). Use Playwright scripts for binary regression tests (API endpoints, data flow). They complement each other.

---

## 5.5 Preview MCP (Part 5, Idea 1)

Claude Code Desktop has a built-in Preview MCP that lets agents start dev servers and preview running apps directly.

**How it works:**
- `preview_start` launches a dev server defined in `.claude/launch.json`
- Connects to a headless browser for screenshots, DOM inspection, click simulation, network monitoring

**What it gives Hive Mind:**

```
EXECUTE stage (web projects):
  BUILD: implementer writes code
  PREVIEW: spawn agent with preview MCP
    - Starts dev server
    - Takes screenshots at key pages
    - Reads console for errors
    - Checks responsive layouts
  EVALUATE: grades screenshots against design criteria
  FIX: fixer gets screenshot + DOM state + console errors
  (GAN loop with visual feedback)
```

**Key difference from Chrome extension:**
- Preview MCP: headless, no browser dependency -- better for CI/headless pipelines
- Chrome extension: interactive development

**Priority:** HIGH -- enables visual verification without browser dependency. Critical for dark factory mode.

---

# 6. Model-Awareness / Pipeline Simplification

> **Anthropic's evolution:** With Opus 4.6, removed the sprint construct entirely. Model could natively handle decomposition. Key insight: "the space of interesting harness combinations doesn't shrink as models improve -- it moves."
>
> **Hive Mind's current approach:** Fixed pipeline regardless of model capability. Hardcoded model assignments.

---

## 6.1 Simple Tasks -- When to Skip the Harness (Q5)

**Recommendation -- complexity-based routing:**
1. Add a `--quick` flag (or auto-detect from PRD word count)
2. Quick mode: skip NORMALIZE, skip BASELINE, skip SCORECARD, single-story PLAN, simplified EXECUTE
3. Threshold: PRD < 200 words OR plan produces < 3 stories -> auto-suggest quick mode
4. This is NOT "skip the harness" -- it's "use a lighter harness"

---

## 6.2 Tiered Harness Depth (Appendix B)

### The Problem

Hive Mind currently has one pipeline shape. Whether the PRD says "add a logout button" or "build a full-stack SaaS platform", the same 15+ agent spawns run.

### The Solution: Three Tiers

### Tier 1: Quick Mode (1-3 stories, <200 word PRD)

**ELI5:** A quick errand. One person does the work, one person checks it.

```
PRD --> PLAN (1 story) --> BUILD --> VERIFY --> done
```

**What's skipped:** NORMALIZE, BASELINE, SPEC, COMPLIANCE, SCORECARD, REPORT, waves
**What's kept:** PLAN + BUILD + VERIFY GAN loop
**Agent count:** 4-6 | **Cost:** ~$2-5 | **Time:** 5-15 minutes

### Tier 2: Standard Mode (3-15 stories, 200-1000 word PRD)

**ELI5:** A home renovation. Multiple workers, a foreman, and an inspector.

```
PRD --> SPEC --> PLAN --> EXECUTE (waves) --> REPORT
```

**What's skipped:** NORMALIZE (auto-detect), SCORECARD (optional)
**Agent count:** 20-40 | **Cost:** ~$10-40 | **Time:** 30 min - 2 hours

### Tier 3: Long-Running Mode (15+ stories, 1000+ word PRD)

**ELI5:** Building a skyscraper. Full project management, quality assurance, inspections.

```
PRD --> NORMALIZE --> BASELINE --> SPEC (evidence-gating) --> PLAN (validator)
    --> EXECUTE (waves, compliance, integration) --> REPORT (double-critique) --> SCORECARD
```

**Agent count:** 50-100+ | **Cost:** ~$40-200 | **Time:** 2-8 hours

### How to Implement

**Step 1: Auto-detect complexity**

```typescript
function detectTier(prd: string, plan: ExecutionPlan): Tier {
  const wordCount = estimateWordCount(prd);
  const storyCount = plan.stories.length;
  const moduleCount = plan.modules?.length ?? 1;

  if (storyCount <= 3 && wordCount < 200) return 'quick';
  if (storyCount > 15 || moduleCount > 1 || wordCount > 1000) return 'thorough';
  return 'standard';
}
```

**Step 2: Configure pipeline stages per tier**

```typescript
const TIER_CONFIG = {
  quick: {
    normalize: false, baseline: false, spec: false,
    compliance: false, integration: false, scorecard: false,
    report: 'minimal', maxWaves: 1, maxVerifyAttempts: 2,
  },
  standard: {
    normalize: 'auto', baseline: true, spec: true,
    compliance: false, integration: false, scorecard: false,
    report: 'standard', maxWaves: Infinity, maxVerifyAttempts: 3,
  },
  thorough: {
    normalize: true, baseline: true, spec: true,
    compliance: true, integration: true, scorecard: true,
    report: 'full', maxWaves: Infinity, maxVerifyAttempts: 5,
  },
};
```

**Step 3: Allow user override**

```bash
hive-mind start --prd ./task.md              # Auto-detect
hive-mind start --prd ./task.md --quick      # Force quick
hive-mind start --prd ./task.md --thorough   # Force thorough
hive-mind start --prd ./task.md --skip-normalize --no-scorecard  # Mix and match
```

### Scaling Strategy for Each Pipeline Component

| Component | Quick | Standard | Thorough |
|---|---|---|---|
| NORMALIZE | Skip | Auto-detect | Always |
| BASELINE | Skip | Run | Run |
| SPEC | Skip | Full (strategic-only) | Full + evidence-gating |
| PLAN | 1-pass planner | Planner + AC/EC gen | Planner + validator + AC/EC gen |
| EXECUTE waves | Sequential | Parallel waves | Parallel waves + compliance |
| VERIFY | 2 attempts max | 3 attempts (GAN) | 5 attempts (GAN + differential eval) |
| INTEGRATION | Skip | Skip | Per-module boundary |
| REPORT | Minimal summary | Standard report | Double-critique + retrospective |
| SCORECARD | Skip | Optional | Multi-dimensional rubric |
| LEARNING | Basic (memory.md) | Standard (graduation) | Full (RAG + SQL + graduation stats) |

### Design Principle

Each pipeline stage should be independently toggleable, not hardcoded into tiers. Tiers are just sensible defaults. The underlying system is a set of composable stages that can be mixed and matched:
1. Every stage has a `shouldRun(tier, config, context)` gate
2. Stages are stateless -- read input artifacts, write output artifacts
3. Adding a new stage doesn't require modifying existing stages
4. Removing a stage doesn't break the pipeline

---

## 6.3 Tiered Model Selection (Appendix A, Technique 4)

| Agent | Task | Recommended Model |
|---|---|---|
| Planner | Spec expansion, one-time | Sonnet -- structured, not creative |
| Generator | Coding, iterative | Opus -- needs full capability |
| Evaluator | Criteria scoring, structured | Sonnet or Haiku -- grading is pattern-matching |

**Hive Mind status:** Already done well -- implementer=opus, tester/evaluator=haiku, diagnostician/fixer=sonnet. No gap here.

---

# 7. Parallel Execution

> **Anthropic's approach:** Sequential sprint execution -- one feature per sprint. No parallel agents.
>
> **Hive Mind's advantage:** Wave-based parallel execution. Non-overlapping stories execute concurrently with bounded concurrency. Smart file-overlap detection defers conflicting stories to next wave. Mutex serializes COMMIT.

---

## 7.1 Horizontal Scaling -- Parallel GAN Loops (Q13, Dimension 1)

Multiple stories run their GAN loops concurrently. Scaling means:
- Increase `maxConcurrency` (currently default 3)
- Ensure non-overlapping file sets (already implemented)
- Add resource-aware scheduling: if API rate limits approach, reduce concurrency dynamically

**Implementation:** Add adaptive concurrency in wave executor:
```typescript
function getAdaptiveConcurrency(config: HiveMindConfig, costTracker: CostTracker): number {
  const recentRateLimits = costTracker.getRecentUsageLimitHits(lastMinutes: 5);
  if (recentRateLimits > 2) return Math.max(1, config.maxConcurrency - 1);
  return config.maxConcurrency;
}
```

**Scalability limits and practical caps:**

| Parameter | Default | Max Recommended | Why |
|---|---|---|---|
| maxConcurrency | 3 | 8-10 | API rate limits, git merge conflicts |
| maxAttempts (GAN iterations) | 3 | 5 | Diminishing returns after 3-4 |
| maxBuildAttempts | 2 | 3 | If BUILD fails 3x, the story spec is wrong |
| Stories per wave | unbounded | 10 | Merge complexity, progress visibility |

---

## 7.2 Safeguards Against Runaway Loops (Q14)

**Current safeguards:**

| Safeguard | Location | Mechanism |
|---|---|---|
| Agent timeout | `config.agentTimeout` (default 10min) | Kill subprocess after timeout |
| Shell timeout | `config.shellTimeout` (default 2min) | Kill shell command after timeout |
| Max retry attempts | `config.maxRetries` (default 1) | Stop retrying failed agent spawns |
| Max verify attempts | `config.maxAttempts` (default 3) | Stop GAN loop after N iterations |
| Max build attempts | `config.maxBuildAttempts` (default 2) | Stop BUILD retry after N attempts |
| Budget ceiling | `--budget <dollars>` | Throw HiveMindError when exceeded |
| Usage limit detection | `src/utils/usage-limit.ts` | Detect API rate limits, pause pipeline |
| Output file polling | `src/utils/shell.ts:145-153` | Kill agent early when output detected |

**What's MISSING:**

### 1. Global pipeline timeout
```typescript
pipelineTimeout: z.number().default(14_400_000), // 4 hours default
```

### 2. Cost velocity alert
```typescript
function checkCostVelocity(tracker: CostTracker, plan: ExecutionPlan): void {
  const elapsed = Date.now() - tracker.startTime;
  const spent = tracker.getPipelineTotal();
  const progress = plan.stories.filter(s => s.status === 'done').length / plan.stories.length;
  const projectedTotal = spent / Math.max(progress, 0.01);
  if (projectedTotal > budget * 2) {
    warn(`Projected cost $${projectedTotal.toFixed(2)} exceeds 2x budget. Consider aborting.`);
  }
}
```

### 3. Infinite loop detection (GAN-specific)
```typescript
function detectStaleLoop(attempts: AttemptResult[]): boolean {
  if (attempts.length < 2) return false;
  const last = attempts[attempts.length - 1];
  const prev = attempts[attempts.length - 2];
  return last.failedCriteria.join(',') === prev.failedCriteria.join(',');
}
```

### 4. Tool chain validation
```typescript
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /DROP\s+TABLE/i,
  /git\s+push\s+--force/,
  /curl.*\|.*sh/,
];
```

### 5. Output size limits
```typescript
maxOutputSizeBytes: z.number().default(1_000_000), // 1MB per agent output
maxTotalOutputBytes: z.number().default(50_000_000), // 50MB total pipeline output
```

**ELI5:** Current safeguards are like having a smoke detector but no sprinkler system. We need: a timer that shuts everything down after 4 hours, a meter that warns when the bill is running too high, a watchdog that notices when we're going in circles, and a lock on the gun cabinet.

---

# 8. Cross-Session Learning

> **Anthropic's approach:** No cross-session learning. Each pipeline run starts fresh. No graduation or knowledge base system.
>
> **Hive Mind's advantage:** Two-tier learning system (session memory + knowledge base graduation). Patterns proven in prior runs inform future runs. Graduation log provides audit trail. This is Hive Mind's major differentiator.

---

## 8.1 RAG Memory with SQL Database MCP (Q7)

**Current state:** Flat-file memory (memory.md) with text-based graduation. No semantic search, no filtering.

**Problems:**
1. Memory.md grows unboundedly
2. No semantic search -- agents get ALL learnings
3. Simple graduation (date count + story ref count)
4. No way to query specifically

**RAG + SQL MCP recommendation:**

```sql
CREATE TABLE learnings (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  story_ids TEXT,
  first_seen DATE,
  last_seen DATE,
  times_cited INTEGER DEFAULT 1,
  graduated BOOLEAN DEFAULT FALSE,
  graduated_to TEXT,
  tags TEXT
);

CREATE TABLE graduation_log (
  id INTEGER PRIMARY KEY,
  learning_id INTEGER REFERENCES learnings(id),
  graduated_at TIMESTAMP,
  target_file TEXT,
  series TEXT
);

CREATE TABLE pipeline_runs (
  id INTEGER PRIMARY KEY,
  prd_path TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  total_stories INTEGER,
  passed_stories INTEGER,
  failed_stories INTEGER,
  total_cost REAL,
  scorecard_grade TEXT
);
```

**How it integrates:**
1. Add SQLite MCP server as dependency
2. `src/memory/memory-manager.ts` writes to DB instead of memory.md
3. Before each agent spawn, query relevant learnings
4. Graduation becomes a DB query

**Surfacing graduation stats in REPORT/SCORECARD:**

```markdown
## Learning System
- Learnings captured: 12 (8 patterns, 3 mistakes, 1 discovery)
- Graduated to knowledge base: 2
  - P27: "Always run TypeScript compiler before tests" -> 01-proven-patterns.md
  - F33: "Don't import from barrel files in test mocks" -> 02-anti-patterns.md
- Knowledge base size: 45 entries (28 patterns, 12 anti-patterns, 5 process patterns)
- Most-cited pattern: P25 "Validate Zod schemas at module boundaries" (cited 14 times)
```

---

## 8.2 Context Governance (Q16)

**Principle: Least-privilege retrieval.** Each agent should only see context relevant to its task.

| Agent Type | Allowed Context | Blocked Context |
|---|---|---|
| researcher | PRD, codebase, KB patterns, external docs | Cost data, prior failures, agent logs |
| spec-drafter | Research report, KB patterns, prior specs | Implementation details, test results |
| implementer | Step file, source files, relevant KB patterns | Full spec, other stories, cost data |
| tester-exec | Step file (ACs/ECs only), source files | Spec, plan, other stories, memory |
| fixer | Step file, diagnosis report, source files, relevant KB mistakes | Full spec, cost, other stories |
| scorecard | All reports, logs, metrics | Raw source code, step files |

**Implementation with SQL RAG:**

```sql
CREATE TABLE context_policies (
  agent_type TEXT NOT NULL,
  allowed_sources TEXT NOT NULL,
  max_results INTEGER DEFAULT 10,
  max_tokens INTEGER DEFAULT 4000,
  recency_weight REAL DEFAULT 0.5
);

INSERT INTO context_policies VALUES
  ('implementer', '["kb_patterns", "kb_mistakes"]', 5, 2000, 0.3),
  ('tester-exec', '[]', 0, 0, 0),
  ('researcher', '["kb_patterns", "kb_discoveries", "prior_specs"]', 15, 8000, 0.7),
  ('fixer', '["kb_mistakes", "failure_postmortems"]', 10, 4000, 0.8);
```

---

## 8.3 Claude-Mem (Part 4, Idea 6)

Claude Code plugin that auto-captures everything Claude does, compresses into structured summaries via Agent SDK, stores in SQLite.

| Feature | Hive Mind Current | Claude-Mem |
|---|---|---|
| Capture | Explicit learner agent per story | Automatic from all tool usage |
| Storage | memory.md (flat file) | SQLite (structured, searchable) |
| Retrieval | Load entire file | Query by relevance |
| Consolidation | Rule-based graduation | AI-compressed summaries |
| Cross-session | Knowledge base files | Injected context per session |

**Recommendation:** Don't replace Hive Mind's learning system -- augment it. Use Claude-Mem for automatic capture, Hive Mind's graduation for curation.

**Priority:** HIGH.

---

## 8.4 Agent Teams as Skills (Part 3, Category E: Idea 5)

Define reusable "agent teams" -- groups of agents that work together:

```yaml
# .hive-mind-skills/spec-team/skill.yaml
name: spec-team
description: "Generate and critique a technical specification"
team:
  - agent: researcher
    role: gather evidence from codebase and PRD
  - agent: spec-drafter
    role: generate SPEC from research
  - agent: critic
    role: evaluate SPEC quality
pattern: gan-loop
max_iterations: 3
outputs:
  - SPEC-v1.0.md
  - critique-log.md
```

---

## 8.5 Cloudflare Dynamic Workers (Part 3, Category F, Idea 11)

V8 isolates: ~5ms startup, few MB memory. 100x faster than Docker.

**Why it matters for Hive Mind:**
- Agent sandboxing without Docker overhead
- Isolated execution per story
- "Code Mode": TypeScript API instead of tool calls, saving 80% tokens
- Global edge deployment

**Trade-off:** Requires Cloudflare account + network. Best for hosted/SaaS Hive Mind.

---

## 8.6 Pre-Built Community Skills (Part 4, Idea 4)

| Skill | What It Does | Hive Mind Application |
|---|---|---|
| **frontend-design** | Professional frontend design patterns | Implementer uses for UI stories |
| **ui-ux-pro-max** | Advanced UI/UX best practices | Anti-AI-slop: evaluator grades UX quality |
| **seo** | SEO optimization | Post-EXECUTE: SEO audit as scorecard dimension |
| **code-review** | Structured code review | Replace/supplement code-reviewer agent |
| **remotion** | Programmatic video generation (React) | Generate demo videos from completed builds |
| **owasp-security** | OWASP Top 10 security scanning | Security audit as pipeline stage or scorecard dimension |

---

## 8.7 Skill-Creator -- Self-Improving Harness (Part 5, Idea 3)

The official Anthropic skill-creator (`github.com/anthropics/skills`, 87k+ stars) automates custom skill creation with built-in evaluation.

**How it works:**
1. Describe what the skill should do
2. Skill-creator drafts `SKILL.md` with YAML frontmatter + instructions
3. Creates test cases, runs evaluation (60/40 train/test split)
4. Iterates up to 5 times, picks best by test score

**Self-improving harness loop:**

```
Post-pipeline self-improvement:
  1. Analyze scorecard + failure logs for repeating patterns
  2. Identify patterns that could become skills
  3. Use skill-creator to generate + evaluate a skill
  4. If trigger rate > 80%, add to `.claude/skills/` for future runs
```

**Three types of auto-generated skills:**

| Type | Example | Generated From |
|---|---|---|
| **Project skills** | "This project uses pnpm, not npm" | BASELINE stage observations |
| **Pattern skills** | "For React projects, always check hydration errors" | Graduated KB patterns |
| **Fix skills** | "When TypeScript strict mode fails, check for implicit any" | Repeated fixer success patterns |

**This closes the self-improvement loop:**
```
Run 1: Pipeline fails on 3 stories due to TypeScript strict mode
  -> Learner captures pattern -> Graduation promotes -> SELF-IMPROVE creates skill
Run 2: Skill auto-triggers -> 0 failures from this pattern
```

**Priority:** HIGH -- path to a self-improving dark factory.

---

# 9. Beyond the 8 Differences: Ecosystem, Security, and Autonomy

> Items that don't map to the original 8 Anthropic comparison points but are critical to Hive Mind's roadmap.

---

## 9.1 MCP Support (Q9)

**Current state:** Hive Mind has ZERO MCP integration.

**Why this matters:** MCP is the industry standard for agent-tool integration. 10,000+ public MCP servers. By not supporting MCP, Hive Mind:
- Cannot use any existing MCP server
- Cannot expose its own capabilities as MCP tools
- Cannot benefit from tool discovery, state persistence, or resource primitives

**ELI5:** Every app store uses one plug format, but your device uses a custom cable.

### Phase 1: Consume MCP servers
```json
{
  "mcpServers": {
    "sqlite": { "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-sqlite", "hive-mind.db"] },
    "github": { "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-github"] }
  }
}
```

### Phase 2: Expose Hive Mind as MCP server
- Tools: `start_pipeline`, `check_status`, `approve`, `reject`, `get_report`

**Priority:** CRITICAL. MCP is table stakes in 2026.

---

## 9.2 MCP Tool Integrations (Part 3, Category A)

| # | Tool | MCP Server | What It Gives Hive Mind | Priority |
|---|---|---|---|---|
| 1 | **Obsidian** | `@bitbonsai/mcpvault` | Knowledge management | MEDIUM |
| 2 | **GitHub/GitLab** | `@anthropic-ai/mcp-server-github` | Issue/PR management | HIGH |
| 8 | **Supabase** | `supabase-mcp-server` | Managed Postgres | MEDIUM |
| 9 | **Vercel** | `vercel-mcp` | Auto-deploy from pipeline | MEDIUM |
| 19 | **SQL Database** | `@anthropic-ai/mcp-server-sqlite` | Persistent memory | HIGH |

---

## 9.3 Code Intelligence (Part 3, Category B: Ideas 3, 4)

| # | Tool | What It Does | Hive Mind Impact |
|---|---|---|---|
| 3 | **LSP Plugins** | Type errors in 50ms, jump-to-definition | GAME-CHANGER for implementer/fixer |
| 4 | **Claude Plugins** | Custom tools, linters, formatters | Per-project agent customization |

**How to enable:**
```json
{
  "enabledPlugins": {
    "typescript-lsp@claude-plugins-official": true,
    "pyright-lsp@claude-plugins-official": true
  }
}
```

---

## 9.4 Slash Commands & Live Docs (Part 4, Idea 5)

| Command | What It Does | Hive Mind Application |
|---|---|---|
| **Context7** | Pulls live docs for any library via MCP | Research agent gets current API docs |
| **/create** | Builds new skills | Meta-skill creation during PLAN |
| **/swarm** | Launches parallel agent team | Aligns with dynamic agents |
| **/research** | Deep discovery | Enhance SPEC research |

**Context7 MCP:**
```json
{ "mcpServers": { "context7": { "command": "npx", "args": ["-y", "@context7/mcp-server"] } } }
```

---

## 9.5 Web Search for Agents (Part 4, Idea 7)

```typescript
const RESEARCH_TOOLS = [...READ_ONLY_TOOLS, "Write", "WebSearch", "WebFetch"];
```

**Priority:** HIGH -- easy to enable, high value.

---

## 9.6 MCP Deferred Tool Loading (Part 4, Idea 8)

```json
{
  "mcpServers": {
    "github": { "command": "...", "defer_loading": true },
    "sqlite": { "command": "...", "defer_loading": true }
  }
}
```

**Priority:** HIGH -- essential for MCP at scale.

---

## 9.7 Tool Sandboxing and Agent Trust Model (Q15)

**Proposed trust model -- three tiers:**

| Tier | Agents | Tools | Sandbox |
|---|---|---|---|
| 1: Read-Only | researcher, critic, reviewer | Read, Glob, Grep | None needed |
| 2: Write-Scoped | spec-drafter, planner, reporter | + Write (to allowlist) | Path allowlist |
| 3: Dev | implementer, fixer | Full toolset | Container or chroot |

**Sandbox options for Tier 3:**

| Option | Isolation | Complexity | Latency |
|---|---|---|---|
| Command blocklist | Low | Low | None |
| Path-scoped Bash | Medium | Medium | None |
| Docker container | High | High | 2-5s |
| Firecracker microVM | Highest | Very High | <1s |

**Recommended: Command blocklist + path-scoped Bash (short term), Docker container (long term)**

---

## 9.8 Full Observability (Q17)

**4-pillar framework: PLAN, RETRIEVE, ACT, REFLECT**

```typescript
interface PlanDecision {
  timestamp: string; stage: string;
  decision: string; reason: string;
  inputs: Record<string, any>;
}

interface RetrievalEvent {
  timestamp: string; agentType: string; storyId?: string;
  sources: string[]; totalTokens: number; retrievalLatency: number;
}

interface AgentExecution {
  timestamp: string; agentType: string; storyId?: string;
  model: string; inputFiles: string[]; inputTokens: number;
  outputFile: string; outputTokens: number; toolCalls: ToolCall[];
  duration: number; cost: number; exitCode: number; truncated: boolean;
}

interface ReflectionEvent {
  timestamp: string; storyId?: string;
  learnings: Learning[]; graduations: Graduation[];
  evalResults: EvalResult[]; retryReason?: string; scorecardDelta?: number;
}
```

**Agent Loop Trace example:**

```
PLAN: Orchestrator decides to run SPEC stage with evidence-gating (tier: standard)
  RETRIEVE: Loaded 5 KB patterns (2000 tokens) for researcher agent
  ACT: Researcher spawned (opus, 45s, $0.12, Read x3, Grep x2)
    -> research-report.md (1200 words)
  RETRIEVE: Loaded research-report.md + PRD for spec-drafter
  ACT: Spec-drafter spawned (opus, 60s, $0.18, Write x1)
    -> SPEC-draft.md (2400 words)
  ACT: Critic spawned (sonnet, 20s, $0.04, Read x1)
    -> critique-1.md (PASS, confidence: matched)
  REFLECT: SPEC passed on first critique -- GAN loop exited early (saved 2 agent spawns)
```

**Dashboard enhancement:** Trace tab with timeline view, context view, cost waterfall, decision tree.

---

## 9.9 Dark Factory vs Orchestration Layer (Q12)

**Recommended: Hive Mind as Dark Factory + Separate Orchestration Layer Above**

```
USER REQUIREMENTS
       |
       v
  ORCHESTRATION LAYER (new -- above Hive Mind)
       |
       +--> Hive Mind (dark factory: PRD -> working code)
       +--> Bug Fixer (bug report -> fix + regression test)
       +--> Enhancer (feature request -> incremental change)
       +--> Auditor (codebase -> security/quality report)
       +--> Migrator (old code -> new framework)
```

**What makes it a "dark factory":**
- `--autonomous` flag removes human checkpoints
- Holdout validation: hidden test scenarios
- Quality gate: pipeline only "ships" if scorecard >= B
- Cost ceiling: `--budget` enforces hard stop

---

## 9.10 Google Workspace CLI (Part 4, Idea 1)

```json
{ "mcpServers": { "workspace": { "command": "gws", "args": ["mcp"] } } }
```

**Priority:** MEDIUM -- enterprise/team value.

---

## 9.11 NotebookLLM-py (Part 4, Idea 2)

Unofficial Python API for Google NotebookLM. **Caveat:** Uses undocumented APIs -- fragile.

**Priority:** LOW.

---

## 9.12 Claude Channels (Part 5, Idea 2)

MCP-based message push system for mobile checkpoint approval:

```
Current: Pipeline pauses -> user polls `hive-mind status` -> `hive-mind approve`
With Channels: Pipeline pauses -> push notification -> approve from phone -> resume
```

**Priority:** MEDIUM -- channels is still research preview.

---

# Master Implementation Priority

| # | Improvement | Category | Effort | Impact | Priority |
|---|---|---|---|---|---|
| 1 | MCP Phase 1 + deferred loading | 9 (Ecosystem) | Medium | Unlocks tool ecosystem | **CRITICAL** |
| 2 | Pipeline timeout + cost velocity alert | 7 (Parallel) | Small | Prevents runaway costs | **HIGH** |
| 3 | Merge compliance into VERIFY GAN loop | 2 (GAN) | Small | Simplifies pipeline | HIGH |
| 4 | Trace logging (4-pillar observability) | 9 (Ecosystem) | Medium | Debug + quality visibility | HIGH |
| 5 | GAN loop as reusable skill + adaptive evals | 2 (GAN) | Medium | Saves cost, improves quality | HIGH |
| 6 | Multi-dimensional scorecard with rubric | 3 (Bias) | Medium | Better quality grading | HIGH |
| 7 | Memory summarization between waves | 1 (Context) | Small | Prevents context bloat | HIGH |
| 8 | Command blocklist + path-scoped writes | 9 (Ecosystem) | Small | Basic security | HIGH |
| 9 | Claude hooks exit code 2 for GAN feedback | 2 (GAN) | Small | Native cheap eval loop | HIGH |
| 10 | WebSearch/WebFetch for agents | 9 (Ecosystem) | Small | Research + diagnosis boost | HIGH |
| 11 | Context7 MCP | 9 (Ecosystem) | Small | Live library docs | HIGH |
| 12 | LSP enablement | 9 (Ecosystem) | Medium | Code intelligence | HIGH |
| 13 | Preview MCP for web testing | 5 (Eval) | Medium | Visual verification | HIGH |
| 14 | GAN few-shot skepticism | 3 (Bias) | Small | Better eval quality | HIGH |
| 15 | Extract agent definitions to .agent/ YAML | 4 (Spec) / 6 (Pipeline) | Medium | Extensibility | MEDIUM |
| 16 | Dark factory mode | 9 (Ecosystem) | Large | Full autonomy | MEDIUM |
| 17 | RAG context governance policies | 8 (Learning) | Medium | Better retrieval | MEDIUM |
| 18 | Surface graduation stats in REPORT | 8 (Learning) | Small | Shows learning value | MEDIUM |
| 19 | Tiered modes (Quick/Standard/Thorough) | 6 (Pipeline) | Medium | UX improvement | MEDIUM |
| 20 | STRATEGIC-ONLY spec rule | 4 (Spec) | Small | Avoids over-specification | MEDIUM |
| 21 | Claude-Mem integration | 8 (Learning) | Medium | Automatic memory capture | MEDIUM |
| 22 | Channels for checkpoint notifications | 9 (Ecosystem) | Medium | Mobile approval UX | MEDIUM |
| 23 | Community skills per project type | 8 (Learning) | Medium | Project-type customization | MEDIUM |
| 24 | Skill-Creator SELF-IMPROVE stage | 8 (Learning) | Large | Self-improving harness | MEDIUM |
| 25 | Full RAG + SQL memory | 8 (Learning) | Large | Semantic retrieval | LOW (v2) |
| 26 | MCP Phase 2: expose as MCP server | 9 (Ecosystem) | Large | Composability | LOW (v2) |
| 27 | Docker container sandbox | 9 (Ecosystem) | Large | Full isolation | LOW (v2) |
| 28 | Adaptive concurrency | 7 (Parallel) | Medium | Better throughput | LOW |
| 29 | Playwright verification | 5 (Eval) | Large | Only for UI projects | LOW |
| 30 | Figma MCP design pipeline | 5 (Eval) | Large | Anti-AI-slop | LOW |

---

# Verdict: Difference-Based vs Pillar-Based Organization

## Comparison

| Criterion | Pillar-Based (`roadmap-by-pillar.md`) | Difference-Based (this doc) |
|---|---|---|
| **Organization principle** | Strategic intent ("what are we building toward?") | Comparative analysis ("what does Anthropic do differently?") |
| **Dependency clarity** | Excellent -- Pillar 1 (MCP) is clearly the foundation | Weak -- dependencies are scattered across categories |
| **Actionability** | High -- each pillar maps to a release milestone | Medium -- categories overlap, hard to sequence |
| **Research context** | Diluted -- the "why" from Anthropic's articles gets spread thin | Preserved -- each section starts with what Anthropic does and why |
| **Onboarding** | Good for implementation ("what do I build?") | Better for understanding ("why do we need this?") |
| **Cross-cutting items** | Some items (GAN cost techniques) appear in one pillar but affect others | 9th category becomes a catch-all for items that don't fit the 8 differences |
| **Completeness** | All items fit naturally into pillars | MCP ecosystem, security, dark factory require a 9th catch-all category |
| **Scope coverage** | Covers the full vision including non-Anthropic ideas | Anchored to Anthropic comparison -- ecosystem ideas feel tacked on |

## Verdict

**The pillar-based organization (`roadmap-by-pillar.md`) is the better roadmap to follow for implementation.**

**Justification:**

1. **Build order is clear.** Pillar 1 (MCP) -> Pillar 3 (GAN) -> Pillar 2 (Visual) -> Pillar 4 (Learning) -> Pillar 5 (Adaptive) -> Pillar 6 (Dark Factory). Each pillar can be a release milestone. The difference-based doc has no natural build order because items in category 9 (ecosystem) are prerequisites for items in categories 1-8.

2. **No catch-all category needed.** Every item fits naturally into a pillar. The difference-based doc requires a 9th "everything else" category that holds the most critical item (MCP) -- which means the organizing framework doesn't actually capture the most important thing.

3. **Forward-looking, not backward-looking.** The pillar-based doc answers "what should Hive Mind become?" while the difference-based doc answers "how do we close the gap with Anthropic's harness?" The former is more strategic since Hive Mind already has advantages Anthropic doesn't (parallelism, learning).

4. **Better for team alignment.** A team can own a pillar. No one can own "difference #2" as a work stream.

**However, keep the difference-based doc for:**
- Onboarding new contributors (explains the "why" behind each improvement)
- Research reference (preserves the Anthropic comparison context)
- Validating that the pillar-based roadmap doesn't miss anything Anthropic taught us

**Recommendation: Use `roadmap-by-pillar.md` as the active implementation roadmap. Use `roadmap-by-difference.md` as supplementary research context.**

---

## Sources
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Obsidian MCP](https://mcp-obsidian.org/)
- [Cloudflare Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/)
- [Google Always On Memory Agent](https://venturebeat.com/orchestration/google-pm-open-sources-always-on-memory-agent-ditching-vector-databases-for/)
- [Claude Code LSP](https://karanbansal.in/blog/claude-code-lsp/)
- [Claude Code Chrome Integration](https://code.claude.com/docs/en/chrome)
- [Figma Code to Canvas](https://www.figma.com/blog/introducing-claude-code-to-figma/)
- [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
- [Google Workspace CLI](https://github.com/googleworkspace/cli)
- [notebooklm-py](https://github.com/teng-lin/notebooklm-py)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Claude-Mem](https://github.com/thedotmack/claude-mem)
- [Claude Code Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [MCP-CLI Deferred Loading](https://paddo.dev/blog/claude-code-hidden-mcp-flag/)
- [Context7 MCP](https://github.com/am-will/swarms)
- [Claude Code Preview, Review, and Merge](https://claude.com/blog/preview-review-and-merge-with-claude-code)
- [Claude Code Desktop Preview MCP](https://medium.com/@dan.avila7/claude-code-desktop-has-a-built-in-preview-mcp-heres-how-it-works-774809ff676f)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Skill-Creator Guide](https://apidog.com/blog/claude-code-skill-creator-guide/)
