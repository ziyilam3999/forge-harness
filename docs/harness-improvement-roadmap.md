# Plan: Hive Mind Improvement Roadmap -- Lessons from Anthropic's Harness

## Context
Anthropic published two engineering articles on harness design for long-running agents. We deep-dived into how their patterns compare to Hive Mind's architecture. This plan documents 8 areas of analysis with concrete improvement suggestions.

## File to create
- `/home/user/hive-mind/docs/harness-improvement-roadmap.md` -- the full analysis and recommendations

## Reference sources
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- `/home/user/hive-mind/docs/harness-comparison-anthropic.md` -- our comparison doc (already created)

---

## The 8 Questions -- Summary of Findings

### Q1: Full Context Reset in Hive Mind

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

### Q2: Playwright-Based Verification

**Current state:** Hive Mind's verify stage (execute-verify.ts) uses shell command exit codes for binary PASS/FAIL. The tester-exec agent writes and runs shell commands to test ACs/ECs.

**How to add Playwright (steps):**
1. Add `playwright` as optional dependency in package.json
2. Create `src/tooling/playwright-setup.ts` -- detect if project has UI, install Playwright if needed
3. In `src/stages/execute-verify.ts`, add a `runPlaywrightTests()` path alongside shell-based testing
4. EC-generator (`src/agents/prompts.ts`) needs a new instruction block for UI projects: generate Playwright test scripts instead of shell commands
5. Add `--playwright` flag or auto-detect from project type (React/Vue/Svelte detected in `src/tooling/detect.ts`)

**Should we?** MEDIUM priority. Only valuable for frontend/full-stack projects. Make it opt-in via flag or auto-detection.

### Q3: GAN Pattern to Simplify Pipeline

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

### Q4: Spec Granularity -- Technical Detail Level

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

### Q5: Simple Tasks -- When to Skip the Harness

**Concept clarification:** A harness is NOT just for long-running tasks. It's the orchestration layer around agents. Even a simple "generate -> evaluate" loop is a harness. The Anthropic articles focus on long-running harnesses, but the concept applies at any scale.

**However, the user's intuition is correct:** For a 1-story task like "add a button to the navbar", running the full NORMALIZE -> BASELINE -> SPEC -> PLAN -> EXECUTE -> REPORT pipeline is overkill. That's 15+ agent spawns for what Claude Code could do in one shot.

**Recommendation -- complexity-based routing:**
1. Add a `--quick` flag (or auto-detect from PRD word count)
2. Quick mode: skip NORMALIZE, skip BASELINE, skip SCORECARD, single-story PLAN, simplified EXECUTE (no compliance, no waves)
3. Threshold: PRD < 200 words OR plan produces < 3 stories -> auto-suggest quick mode
4. This is NOT "skip the harness" -- it's "use a lighter harness"

### Q6: Agent Bias in Subjective Evaluation + GAN Loop Opportunities

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

**Hive Mind's advantage:** Binary AC/EC evaluation has ZERO bias by design. Shell command exits 0 or non-zero. No room for subjective self-praise.

**Where GAN loops can replace complicated layers in Hive Mind:**

| Area | Current Flow | GAN Replacement |
|---|---|---|
| SPEC critique | Drafter -> Critic1 -> Corrector -> Critic2 -> Corrector2 (5 agents) | Generator (drafter) + Evaluator (critic), loop until critic says PASS. Max 3 iterations. Saves 1-2 agents when spec is good on first try |
| COMPLIANCE | Compliance-reviewer -> Compliance-fixer -> Re-review (3 agents) | Merge into VERIFY GAN loop as additional ECs (0 extra agents) |
| REPORT validation | Reporter -> Double-critique (2 agents) | Generator (reporter) + Evaluator (critic), loop until report quality passes. Currently only 1 critique pass |
| VERIFY (AC/EC) | Already a GAN loop | No change needed |

**Net effect:** SPEC stage drops from 9 agents to ~7 (GAN loop exits early when quality is good). COMPLIANCE stage eliminated entirely (merged into VERIFY). REPORT gets iterative improvement instead of fixed double-critique.

### Q7: RAG Memory with SQL Database MCP

**Current state:** Hive Mind uses flat-file memory (memory.md) with text-based graduation to knowledge-base markdown files. Retrieval is "load entire file" -- no semantic search, no filtering.

**Problems with current approach:**
1. Memory.md grows unboundedly -- all learnings dumped into one file
2. No semantic search -- agents get ALL learnings, even irrelevant ones
3. Graduation is simple (date count + story ref count) -- no relevance ranking
4. No way to query "what did we learn about React testing?" specifically

**RAG + SQL MCP recommendation:**

**Schema design:**
```sql
CREATE TABLE learnings (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,        -- 'pattern' | 'mistake' | 'discovery'
  content TEXT NOT NULL,          -- the learning text
  embedding BLOB,                 -- vector embedding for semantic search
  story_ids TEXT,                 -- JSON array of story IDs that evidenced this
  first_seen DATE,
  last_seen DATE,
  times_cited INTEGER DEFAULT 1,
  graduated BOOLEAN DEFAULT FALSE,
  graduated_to TEXT,              -- knowledge-base file path
  tags TEXT                       -- JSON array of tags (e.g., ["testing", "react", "api"])
);

CREATE TABLE graduation_log (
  id INTEGER PRIMARY KEY,
  learning_id INTEGER REFERENCES learnings(id),
  graduated_at TIMESTAMP,
  target_file TEXT,
  series TEXT                     -- P25, F31, etc.
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
2. `src/memory/memory-manager.ts` writes to DB instead of (or alongside) memory.md
3. Before each agent spawn, query relevant learnings: `SELECT * FROM learnings WHERE tags MATCH ? ORDER BY times_cited DESC LIMIT 10`
4. Graduation becomes a DB query: `SELECT * FROM learnings WHERE times_cited >= 3 AND last_seen - first_seen >= 3 days AND NOT graduated`

**Surfacing graduation stats in REPORT/SCORECARD:**

Add to scorecard prompt inputs:
- Total learnings captured this run
- Learnings graduated this run (with details)
- Top 5 most-cited patterns across all runs
- Learning velocity (new learnings per story)

Add a "Learning System" section to the final report:
```markdown
## Learning System
- Learnings captured: 12 (8 patterns, 3 mistakes, 1 discovery)
- Graduated to knowledge base: 2
  - P27: "Always run TypeScript compiler before tests" -> 01-proven-patterns.md
  - F33: "Don't import from barrel files in test mocks" -> 02-anti-patterns.md
- Knowledge base size: 45 entries (28 patterns, 12 anti-patterns, 5 process patterns)
- Most-cited pattern: P25 "Validate Zod schemas at module boundaries" (cited 14 times)
```

### Q8: Multi-Dimensional Scorecard with Anthropic-Style Rubric

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

## Appendix: Proven Ways to Save Token Cost in GAN Loops

### The Cost Problem

Every iteration of a GAN loop costs tokens on both sides:

```
generator prompt + context + output
   + evaluator prompt + full app context + criteria + output
      = one iteration cost

x 5-15 iterations = expensive fast
```

Anthropic's runs: $124-200, 4-6 hours. Most of that is generator time. The evaluator is relatively cheap per pass. The waste is in the generator re-reading the same context on every iteration.

### 1. Compress the Handoff Artifact (Highest Impact)

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

### 2. Fail Fast on the Evaluator (High Impact)

Don't run the evaluator to completion if a hard-fail criterion is hit early.

**Standard flow:** evaluator grades all 4-6 criteria, writes full report, then generator retries.

**Optimized flow:** evaluator grades in priority order (functionality first, design last). If functionality fails hard, stop grading, return minimal feedback, trigger generator retry immediately.

This cuts evaluator token spend per failed iteration by 40-70% depending on where in the criteria list failures cluster. Most early iterations fail on functionality, not design -- so you pay for design grading only when the basics are already passing.

**Hive Mind gap:** tester-exec and evaluator run ALL ACs/ECs to completion every time. Should short-circuit on first hard fail. Implement by adding priority ordering to ACs and a `--fail-fast` mode to the tester prompt.

### 3. Differential Evaluation (High Impact)

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

Evaluator then skips unchanged areas unless a regression check flags them. Halves evaluator cost on later iterations where most of the app is already passing.

**Hive Mind gap:** VERIFY re-runs ALL ACs/ECs every iteration. If 8/10 ACs passed on iteration 1, iteration 2 still re-tests all 10. This is the biggest low-hanging fruit -- track per-AC pass/fail state and only re-test failures + a regression sample.

### 4. Tiered Model Selection (Medium-High Impact)

Not every agent in the loop needs the most expensive model.

| Agent | Task | Recommended Model |
|---|---|---|
| Planner | Spec expansion, one-time | Sonnet -- structured, not creative |
| Generator | Coding, iterative | Opus -- needs full capability |
| Evaluator | Criteria scoring, structured | Sonnet or Haiku -- grading is pattern-matching, not reasoning |

Anthropic's own cost breakdown showed the evaluator (QA) at $3-4 per pass vs $36-71 for the generator. The evaluator is already relatively cheap. But if running 10+ iterations, even the evaluator adds up -- downgrading to sonnet saves real money without significant quality loss on structured criteria grading.

**Test this:** run 3 evaluator passes with opus, 3 with sonnet, compare score consistency. If scores agree >90%, switch permanently.

**Hive Mind status:** Already done well -- implementer=opus, tester/evaluator=haiku, diagnostician/fixer=sonnet. No gap here.

### 5. Criteria Gating -- Only Evaluate What the Model Struggles With (Medium Impact)

Anthropic noted that as models improve, some criteria become unnecessary overhead. Claude 4.6 passed functionality checks that 4.5 needed evaluator help with.

**Practical approach:**
- Run 10 generations without the evaluator
- Measure which criteria the generator passes consistently on its own
- Remove those criteria from the evaluator loop
- Keep only the criteria where the generator's solo score is below your threshold

This is the "only increase complexity when needed" principle applied in reverse -- strip out criteria that are no longer load-bearing.

**Hive Mind gap:** All AC/EC criteria evaluated every run regardless of model capability. Worth measuring -- some ECs may be consistently passing with opus implementer and could be skipped.

### 6. Cap Iterations with a Quality Floor Check (Medium Impact)

Don't run 15 iterations by default. Set a dynamic stopping rule:

```
after each iteration:
  if score >= threshold: stop
  if score_delta < minimum_improvement: stop (diminishing returns)
  if iterations >= hard_cap: stop
```

Anthropic observed that scores plateau before the iteration cap. Running to the cap after plateau is pure waste. A minimum improvement delta of 5-10 points per iteration is a reasonable stopping signal.

**Hive Mind gap:** maxAttempts cap exists, but no score_delta check or diminishing-returns detection. Could save 1-2 iterations when fixer is spinning on the same failure.

### 7. Prompt Caching (Medium Impact, Easiest to Implement)

Anthropic's API supports prompt caching for static prompt content. In a GAN loop, the evaluator's system prompt (criteria, grading rubric, few-shot examples) is identical every iteration.

Cache that. It's the highest cache-hit-rate content in the whole loop.

**Estimated savings:** 80-90% token cost reduction on the cached portion of evaluator prompts. The cache hit rate is high because the criteria don't change between iterations -- only the app content does.

Implement with: `cache_control: {"type": "ephemeral"}` on the static portions of your system prompt.

**Hive Mind gap:** Each `spawnClaude()` builds prompt fresh via CLI invocation. Need to restructure to use Claude API directly with cache_control, or structure CLI prompts so stable content benefits from automatic caching.

### 8. Scope the Generator Context Window per Sprint (Lower Impact, Situational)

If you retain a sprint structure (Hive Mind's story model), each sprint's generator should only see:
- The spec for its sprint/story
- The handoff artifact from the previous sprint
- The evaluator's findings for its sprint

Not the full spec, not all prior sprint histories. This keeps per-sprint context lean and avoids the context anxiety pattern.

**Hive Mind status:** Already done -- each story only receives its step file + relevant source files, not the full spec. No gap here.

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

### ELI5

Imagine paying a chef and food critic to iterate on a dish. The waste happens when: the critic re-reads the entire menu each visit instead of just the changed dish; the chef re-explains the whole restaurant concept every time; they keep iterating after the dish is already good enough; and you hired a michelin-starred critic just to check if salt was added. Fix all four and you cut the bill by more than half without changing the quality of the final dish.

### Priority for Hive Mind Implementation

| # | Technique | Where to Apply | Effort | Impact |
|---|---|---|---|---|
| 1 | Differential evaluation | VERIFY loop -- only re-test failed ACs/ECs | Medium | HIGHEST -- halves evaluator cost |
| 2 | Fail fast on evaluator | VERIFY loop -- short-circuit on hard fail | Small | HIGH -- 40-70% on failed evals |
| 3 | Prompt caching | spawner.ts -- cache_control on static content | Medium | HIGH -- 80-90% on static prompts |
| 4 | Compress handoff | Memory summarization between waves | Medium | HIGH -- 30-50% on context |
| 5 | Dynamic stopping | VERIFY loop -- add score_delta check | Small | MEDIUM -- saves wasted iterations |
| 6 | Criteria gating | Measure which ECs opus passes solo | Medium | MEDIUM -- data-driven removal |

---

## Implementation Priority

| # | Improvement | Effort | Impact | Priority |
|---|---|---|---|---|
| 3 | Merge compliance into VERIFY GAN loop | Small | Simplifies pipeline | HIGH |
| 6 | GAN loop for SPEC critique (early exit) | Medium | Saves cost on good specs | HIGH |
| 8 | Multi-dimensional scorecard with rubric | Medium | Better quality visibility | HIGH |
| 1 | Memory summarization between waves | Small | Prevents context bloat | HIGH |
| 7 | Surface graduation stats in REPORT | Small | Shows learning system value | MEDIUM |
| 4 | STRATEGIC-ONLY spec rule | Small | Avoids over-specification | MEDIUM |
| 5 | Quick mode for simple tasks | Medium | UX improvement | MEDIUM |
| 7 | RAG + SQL memory (full) | Large | Better retrieval | LOW (v2) |
| 2 | Playwright verification | Large | Only for UI projects | LOW |
| 6 | GAN loop for REPORT validation | Small | Better reports | LOW |

---

## Appendix B: Making Hive Mind Scalable -- Simple Tasks to Long-Running Tasks

### The Problem

Hive Mind currently has one pipeline shape: full NORMALIZE -> BASELINE -> SPEC -> PLAN -> EXECUTE -> REPORT. Whether the PRD says "add a logout button" or "build a full-stack SaaS platform", the same 15+ agent spawns run. This is like requiring a building permit to hang a picture frame.

### The Solution: Tiered Harness Depth

Think of harness complexity as a dial, not a switch. Three tiers:

### Tier 1: Quick Mode (1-3 stories, <200 word PRD)

**ELI5:** A quick errand. One person does the work, one person checks it.

```
PRD --> PLAN (1 story) --> BUILD --> VERIFY --> done
```

**What's skipped:** NORMALIZE, BASELINE, SPEC, COMPLIANCE, SCORECARD, REPORT, waves
**What's kept:** PLAN (even a simple task needs a step file with ACs), BUILD + VERIFY GAN loop
**Agent count:** 4-6 (planner, AC-gen, implementer, tester, maybe fixer)
**Cost:** ~$2-5
**Time:** 5-15 minutes

**When to use:**
- PRD < 200 words
- Plan produces 1-3 stories
- Bug fixes, small features, refactors
- `hive-mind start --prd ./task.md --quick`

### Tier 2: Standard Mode (3-15 stories, 200-1000 word PRD)

**ELI5:** A home renovation. Multiple workers, a foreman, and an inspector.

```
PRD --> SPEC --> PLAN --> EXECUTE (waves) --> REPORT
```

**What's skipped:** NORMALIZE (auto-detect if needed), SCORECARD (optional)
**What's kept:** Full pipeline minus optional stages
**Agent count:** 20-40 depending on story count
**Cost:** ~$10-40
**Time:** 30 min - 2 hours

**When to use:**
- Most PRDs
- Default mode
- `hive-mind start --prd ./project.md`

### Tier 3: Long-Running Mode (15+ stories, 1000+ word PRD)

**ELI5:** Building a skyscraper. Full project management, quality assurance, inspections.

```
PRD --> NORMALIZE --> BASELINE --> SPEC (with evidence-gating) --> PLAN (with validator)
    --> EXECUTE (parallel waves, compliance, integration verify)
    --> REPORT (double-critique) --> SCORECARD (multi-dimensional)
```

**What's added:** Everything. All verification layers, multi-dimensional scorecard, integration testing
**Agent count:** 50-100+
**Cost:** ~$40-200
**Time:** 2-8 hours

**When to use:**
- Large PRDs, multi-module projects
- Production-grade output required
- `hive-mind start --prd ./platform.md --thorough`

### How to Implement Tiered Scaling

**Step 1: Auto-detect complexity (no user input needed)**

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
    normalize: false,
    baseline: false,
    spec: false,          // skip spec, go straight to plan
    compliance: false,
    integration: false,
    scorecard: false,
    report: 'minimal',    // just a summary, no double-critique
    maxWaves: 1,          // no parallelism needed for 1-3 stories
    maxVerifyAttempts: 2,
  },
  standard: {
    normalize: 'auto',    // only if PRD looks non-compliant
    baseline: true,
    spec: true,
    compliance: false,    // merged into VERIFY GAN loop (Q3)
    integration: false,   // only for multi-module
    scorecard: false,     // optional
    report: 'standard',
    maxWaves: Infinity,
    maxVerifyAttempts: 3,
  },
  thorough: {
    normalize: true,
    baseline: true,
    spec: true,           // with evidence-gating
    compliance: true,     // or merged into VERIFY
    integration: true,    // cross-module contracts
    scorecard: true,      // multi-dimensional rubric
    report: 'full',       // double-critique + retrospective
    maxWaves: Infinity,
    maxVerifyAttempts: 5,
  },
};
```

**Step 3: Allow user override**

```bash
# Auto-detect (default)
hive-mind start --prd ./task.md

# Force quick mode
hive-mind start --prd ./task.md --quick

# Force thorough mode
hive-mind start --prd ./task.md --thorough

# Mix and match
hive-mind start --prd ./task.md --skip-normalize --no-scorecard
```

### Scaling Strategy for Each Pipeline Component

| Component | Quick | Standard | Thorough |
|---|---|---|---|
| NORMALIZE | Skip | Auto-detect | Always |
| BASELINE | Skip | Run | Run |
| SPEC | Skip (plan from PRD directly) | Full (strategic-only) | Full + evidence-gating |
| PLAN | 1-pass planner | Planner + AC/EC gen | Planner + validator + AC/EC gen |
| EXECUTE waves | Sequential (1 story at a time) | Parallel waves | Parallel waves + compliance |
| VERIFY | 2 attempts max | 3 attempts (GAN loop) | 5 attempts (GAN loop + differential eval) |
| INTEGRATION | Skip | Skip | Per-module boundary |
| REPORT | Minimal summary | Standard report | Double-critique + retrospective |
| SCORECARD | Skip | Optional | Multi-dimensional rubric |
| LEARNING | Basic (memory.md) | Standard (memory + graduation) | Full (RAG + SQL + graduation stats) |

### What Makes This Scalable (Not Just "3 Modes")

The key insight from Anthropic's evolution: **as models improve, the interesting harness complexity moves**. Opus 4.6 made sprints unnecessary. Future models may make SPEC unnecessary for simple tasks.

**Design principle:** Each pipeline stage should be independently toggleable, not hardcoded into tiers. Tiers are just sensible defaults. The underlying system is a set of composable stages that can be mixed and matched.

This means:
1. Every stage has a `shouldRun(tier, config, context)` gate
2. Stages are stateless -- they read input artifacts, write output artifacts
3. Adding a new stage doesn't require modifying existing stages
4. Removing a stage doesn't break the pipeline (downstream reads from the last available artifact)

### Backwards Compatibility

Current behavior (`hive-mind start --prd ./task.md`) maps to `standard` tier. No breaking change. New flags (`--quick`, `--thorough`) are additive. Existing flags (`--skip-normalize`, `--skip-baseline`, `--no-dashboard`) continue to work as stage-level overrides.

---

---

## Part 2: Architecture Evolution -- 9 Strategic Questions

### Q9: MCP Support

**Current state:** Hive Mind has ZERO MCP integration. Agents are spawned via Claude CLI subprocess (`src/utils/shell.ts:82-207`). Tools are passed as `--allowedTools` comma-separated strings. There is no tool discovery, no persistent tool servers, no standardized tool protocol.

**Why this matters:** MCP (Model Context Protocol) is now the industry standard for agent-tool integration, adopted by Claude, ChatGPT, Cursor, Gemini, VS Code, and Copilot. 10,000+ public MCP servers exist. By not supporting MCP, Hive Mind:
- Cannot use any existing MCP server (databases, APIs, Slack, Jira, GitHub)
- Cannot expose its own capabilities as MCP tools for other agents
- Cannot benefit from MCP's tool discovery, state persistence, or resource primitives

**ELI5:** Imagine every app store in the world uses one plug format, but your device uses a custom cable. You can't use any of the 10,000 apps, and nobody can connect to you.

**Recommendation -- two phases:**

**Phase 1: Consume MCP servers (agent tools)**
- Allow `.hivemindrc.json` to declare MCP servers (like Claude Code's settings)
- When spawning agents, start declared MCP servers and pass them via `--mcp-config`
- Immediate value: agents can use SQLite MCP (for RAG memory Q7), GitHub MCP, filesystem MCP, etc.
- Implementation: modify `src/utils/shell.ts:spawnClaude()` to accept `--mcp-config` flag

```json
// .hivemindrc.json
{
  "mcpServers": {
    "sqlite": { "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-sqlite", "hive-mind.db"] },
    "github": { "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-github"] }
  }
}
```

**Phase 2: Expose Hive Mind as MCP server**
- Expose pipeline operations as MCP tools: `start_pipeline`, `check_status`, `approve`, `reject`, `get_report`
- Enables other agents/orchestrators to drive Hive Mind programmatically
- This is how Hive Mind becomes composable in a larger agent ecosystem (relevant to Q12 -- orchestration layer)

**Priority:** HIGH. MCP is table stakes in 2026. Phase 1 is small effort, high value.

---

### Q10: Scalability -- Dynamic Agent Architecture

**Current state:** Hive Mind has 33 hardcoded agent types (`src/types/agents.ts:3-42`), each with fixed jobs (`src/agents/prompts.ts:28-68`), fixed rules, and fixed model assignments. The pipeline shape is predetermined.

**The problem with 3 fixed tiers (Quick/Standard/Thorough):** Still rigid. A 10-story PRD might need thorough SPEC but quick VERIFY. A frontend-heavy project needs Playwright but a CLI tool doesn't. Tiers are better than one-size-fits-all, but still limited.

**Two approaches to dynamic agents:**

#### Option A: Agents as `.agent/` definitions

Each agent is a folder with its own definition:

```
.hive-mind-agents/
  implementer/
    agent.yaml          # job description, model, tools, rules
    system-prompt.md    # full system prompt
    eval-criteria.md    # how to evaluate this agent's output
  tester/
    agent.yaml
    system-prompt.md
    eval-criteria.md
```

**Pros:** Self-contained, versionable, forkable. Users can customize agents per project. New agent types can be added without code changes.

**Cons:** Agents are passive definitions -- they don't "do" anything on their own. The orchestrator still decides when to invoke them.

#### Option B: Agents as `.skill/` definitions

Each capability is a skill that can be composed:

```
.hive-mind-skills/
  spec-generation/
    skill.yaml          # inputs, outputs, triggers
    steps.md            # multi-agent workflow within this skill
    eval.md             # success criteria
  code-review/
    skill.yaml
    steps.md
    eval.md
```

**Pros:** Skills are composable workflows, not just single agents. A skill can internally use multiple agents. Skills can be created/improved by a skill-creator meta-agent.

**Cons:** More complex. Skills need an execution engine.

#### Recommendation: Hybrid -- `.agent/` for agent definitions + orchestrator intelligence for composition

**ELI5:** Think of agents like workers with resumes (`.agent/` files). The orchestrator is the project manager who reads the resumes and decides who to hire for each job. For a simple task, it hires 2 people. For a complex task, it hires 20. It doesn't follow a fixed org chart -- it staffs based on the work.

**How it works:**
1. Agent definitions live in `.hive-mind-agents/` (or bundled defaults)
2. Each definition declares: capabilities, model tier, tools needed, input/output contracts
3. The orchestrator has a **staffing agent** that reads the PRD/plan and decides which agents to invoke and in what order
4. The staffing agent can also decide to SKIP agents (no compliance needed for a 2-story task) or ADD agents (spawn a security-reviewer for auth-related stories)

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

**Scaling mechanism:** The orchestrator doesn't hardcode "run these 9 agents for SPEC". Instead, it asks the staffing agent: "Given this PRD complexity and project type, which agents should run for SPEC?" The staffing agent returns a dynamic agent graph.

**This solves the fixed-tier problem:** Instead of Quick/Standard/Thorough presets, the pipeline shapes itself to the task. A 500-word frontend PRD gets: SPEC (with UI-focus), PLAN, EXECUTE (with Playwright verify), REPORT. A 2000-word backend PRD gets: NORMALIZE, BASELINE, SPEC (with security review), PLAN (with validator), EXECUTE (with compliance), REPORT, SCORECARD.

**Migration path:**
1. Extract current hardcoded agent definitions from `prompts.ts` into `.agent/` YAML files
2. Load agent definitions at startup instead of importing from code
3. Add a staffing agent that produces the agent execution graph
4. Orchestrator executes the graph instead of hardcoded stage functions

---

### Q11: GAN Pattern -- Eval Evolution and Auto-Research

**Current state:** Hive Mind's evals are binary AC/EC shell commands. They don't evolve. The same criteria run on every story regardless of what the agent struggled with last time.

**Should evals evolve?** YES. Three levels of evolution:

#### Level 1: Static evals (current)
- AC/EC generated once per story by AC-gen/EC-gen agents
- Never change during execution
- Same criteria on every retry iteration

#### Level 2: Adaptive evals (recommended)
- After each GAN iteration, the evaluator analyzes what failed and WHY
- On retry, the evaluator adds focused criteria targeting the specific failure mode
- Example: if iteration 1 failed because of missing error handling, iteration 2 adds an error-handling-specific eval

**Implementation:**
```
Iteration 1: Run 10 ECs -> 8 pass, 2 fail (missing null check, wrong status code)
Iteration 2: Run 2 failed ECs + 2 NEW focused ECs (null safety check, HTTP status validation) + 3 regression sample from passing ECs
```

#### Level 3: Self-improving evals (future -- auto-research)
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

### Q12: Dark Factory vs Orchestration Layer

**What is a dark factory?** A fully autonomous code production system. Specs go in, working software comes out. No human in the loop during execution. The term comes from manufacturing -- factories that run with the lights off because no humans are present.

**StrongDM's example:** 3 engineers, 16,000 lines of Rust, no human-written code, no human code review. Uses holdout scenarios (hidden from the agent) instead of traditional tests.

**The key question:** Should Hive Mind BE the dark factory, or should it ORCHESTRATE dark factories?

#### Option A: Hive Mind as Dark Factory
- Focus: PRD in -> working code out
- Remove human checkpoints (or make them optional)
- Add holdout validation (hidden test scenarios the agent can't game)
- Single-purpose: code generation from requirements

#### Option B: Hive Mind as Orchestration Layer
- Focus: route tasks to specialized harnesses
- Coding harness for new features
- Defect fixer harness for bugs
- Refactoring harness for tech debt
- Security audit harness for vulnerability scanning
- Each harness is independently developed and improved

#### Option C (Recommended): Hive Mind as Dark Factory + Separate Orchestration Layer Above

**ELI5:** A car factory doesn't also manage the dealership, the repair shop, and the parts warehouse. It does one thing well: build cars. A separate company (the automaker) decides which factory builds what, when.

```
USER REQUIREMENTS
       |
       v
  ORCHESTRATION LAYER (new -- above Hive Mind)
  Routes tasks to the right harness:
       |
       +--> Hive Mind (dark factory: PRD -> working code)
       +--> Bug Fixer (harness: bug report -> fix + regression test)
       +--> Enhancer (harness: feature request -> incremental change)
       +--> Auditor (harness: codebase -> security/quality report)
       +--> Migrator (harness: old code -> new framework/language)
```

**Why Option C:**
1. **Hive Mind is already good at PRD -> code.** Don't dilute its focus.
2. **Bug fixing is fundamentally different from feature building.** Different agent types, different eval criteria, different pipeline shape. Forcing both into one pipeline creates complexity.
3. **The orchestration layer is thin.** It's just a router that reads the user's intent and dispatches to the right harness. It doesn't need Hive Mind's full pipeline.
4. **Each harness can evolve independently.** Hive Mind gets better at building. Bug Fixer gets better at diagnosing. They don't block each other.

**Hive Mind's current `bug` command** is already a separate harness (DIAGNOSE -> FIX -> VERIFY). This validates the multi-harness approach.

**What makes it a "dark factory":**
- Optional `--autonomous` flag removes human checkpoints
- Holdout validation: hidden test scenarios generated from SPEC but not visible to implementer
- Quality gate: pipeline only "ships" (commits to main) if scorecard grade >= B
- Cost ceiling: `--budget` enforces hard stop

---

### Q13: Making GAN Pattern Loops Scalable

**The scaling problem:** A single GAN loop (generator + evaluator, N iterations) is bounded. But what if:
- A 50-story pipeline has 50 independent GAN loops running in waves?
- Each loop spawns 3-5 agents per iteration x 3 iterations = 9-15 agents per story?
- 50 stories x 15 agents = 750 agent spawns?

**Three dimensions of GAN scalability:**

#### Dimension 1: Horizontal -- Parallel GAN loops

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

#### Dimension 2: Vertical -- Nested GAN loops

A GAN loop inside a GAN loop. Example:
- Outer loop: SPEC critique (generate spec -> evaluate spec -> refine)
- Inner loop: Each SPEC section could have its own generate-evaluate cycle

**Should we?** NO for now. Nested loops explode cost quadratically. Keep GAN loops flat -- one level of iteration per stage. If the outer loop needs improvement, the INNER work should be better, not recursive.

#### Dimension 3: Temporal -- Cross-run improvement

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

### Q14: Limits and Safeguards Against Runaway Loops

**Current safeguards in Hive Mind:**

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

**What's MISSING -- additional safeguards needed:**

#### 1. Global pipeline timeout
Currently no overall timeout. A 50-story pipeline could run for days.

```typescript
// Add to config schema
pipelineTimeout: z.number().default(14_400_000), // 4 hours default
```

#### 2. Cost velocity alert
Detect when cost is accumulating faster than expected.

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

#### 3. Infinite loop detection (GAN-specific)
Detect when a GAN loop is not making progress:

```typescript
function detectStaleLoop(attempts: AttemptResult[]): boolean {
  if (attempts.length < 2) return false;
  const last = attempts[attempts.length - 1];
  const prev = attempts[attempts.length - 2];
  // Same failures on consecutive attempts = stale
  return last.failedCriteria.join(',') === prev.failedCriteria.join(',');
}
```

#### 4. Tool chain validation
Prevent agents from calling tools in invalid sequences (e.g., Write before Read, Bash rm -rf):

```typescript
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /DROP\s+TABLE/i,
  /git\s+push\s+--force/,
  /curl.*\|.*sh/,
];
```

#### 5. Output size limits
Prevent agents from generating unbounded output:

```typescript
// Add to config
maxOutputSizeBytes: z.number().default(1_000_000), // 1MB per agent output
maxTotalOutputBytes: z.number().default(50_000_000), // 50MB total pipeline output
```

**ELI5:** Current safeguards are like having a smoke detector but no sprinkler system. We need: a timer that shuts everything down after 4 hours (pipeline timeout), a meter that warns when the bill is running too high (cost velocity), a watchdog that notices when we're going in circles (stale loop detection), and a lock on the gun cabinet (dangerous command blocking).

---

### Q15: Tool Sandboxing and Agent Trust Model

**Current state:** Hive Mind uses `--dangerously-skip-permissions` when spawning Claude (`src/utils/shell.ts`). This means agents have FULL access to their allowed tools with no runtime permission checks. Agents are implicitly trusted.

**Should agents be treated as untrusted?** YES, by default.

**ELI5:** You wouldn't give a contractor the keys to your house and say "do whatever you want." You'd give them access to the room they're working on, check their work, and lock the medicine cabinet.

**Proposed trust model -- three tiers:**

#### Tier 1: Read-Only Agents (LOW trust needed)
- Agents: researcher, critic, reviewer, evaluator, scorecard, log-summarizer
- Tools: Read, Glob, Grep only
- Sandbox: None needed -- can't modify anything
- Current status: Already implemented via `READ_ONLY_TOOLS`

#### Tier 2: Write-Scoped Agents (MEDIUM trust)
- Agents: spec-drafter, planner, reporter, compliance-reviewer
- Tools: Read, Glob, Grep, Write (to specific output paths only)
- Sandbox: **Path allowlist** -- can only write to `.hive-mind-working/` directory
- Current gap: Write tool has no path restriction

**Implementation:**
```typescript
// Add to tool-permissions.ts
const SCOPED_WRITE_TOOLS = [...READ_ONLY_TOOLS, "Write"];
const WRITE_ALLOWLIST = [".hive-mind-working/", ".hive-mind-lab/"];
```

#### Tier 3: Dev Agents (HIGH trust -- sandbox required)
- Agents: implementer, fixer, refactorer, compliance-fixer
- Tools: Read, Write, Edit, Bash, Glob, Grep
- Sandbox: **Container or chroot** -- full dev access but isolated from host system
- Current gap: Bash has no command filtering, no filesystem isolation

**Sandbox options for Tier 3:**

| Option | Isolation Level | Complexity | Latency |
|---|---|---|---|
| Command blocklist | Low -- blocks known dangerous commands | Low | None |
| Path-scoped Bash | Medium -- restricts working directory | Medium | None |
| Docker container | High -- full filesystem/network isolation | High | 2-5s startup |
| Firecracker microVM | Highest -- hardware-level isolation | Very High | <1s startup |

**Recommended: Command blocklist + path-scoped Bash (short term), Docker container (long term)**

**MCP integration for sandboxing (ties to Q9):**
If agents use MCP tool servers, the MCP server itself becomes the sandbox. The agent doesn't call `Bash` directly -- it calls an MCP tool that runs in a container. This is cleaner than trying to sandbox Claude CLI's built-in Bash tool.

---

### Q16: RAG Knowledge Sources and Context Governance

**What knowledge sources must be indexed for RAG:**

| Source | Content | Update Frequency | Priority |
|---|---|---|---|
| **Memory.md** | Session learnings (patterns, mistakes, discoveries) | Every story | HIGH |
| **Knowledge base** | Graduated patterns from prior runs | Per pipeline run | HIGH |
| **SPEC artifacts** | Technical specifications from prior builds | Per pipeline run | MEDIUM |
| **Manager log** | Agent execution history, timing, costs | Real-time | MEDIUM |
| **Code review reports** | Quality findings from prior runs | Per pipeline run | MEDIUM |
| **Failure post-mortems** | Root cause analysis of failed stories | Per failure | HIGH |
| **Project codebase** | Existing source code (for codebase-aware agents) | Pre-pipeline | HIGH |
| **External docs** | Framework documentation, API references | On-demand | LOW |

**Context governance -- what agents CAN and CANNOT retrieve:**

**Principle: Least-privilege retrieval.** Each agent should only see context relevant to its task. A tester doesn't need SPEC history. An implementer doesn't need cost data.

| Agent Type | Allowed Context | Blocked Context |
|---|---|---|
| researcher | PRD, codebase, KB patterns, external docs | Cost data, prior failures, agent logs |
| spec-drafter | Research report, KB patterns, prior specs | Implementation details, test results |
| implementer | Step file, source files, relevant KB patterns | Full spec, other stories, cost data |
| tester-exec | Step file (ACs/ECs only), source files | Spec, plan, other stories, memory |
| fixer | Step file, diagnosis report, source files, relevant KB mistakes | Full spec, cost, other stories |
| scorecard | All reports, logs, metrics | Raw source code, step files |

**Implementation with SQL RAG (from Q7):**

```sql
-- Agent context governance via tags + agent-type filtering
CREATE TABLE context_policies (
  agent_type TEXT NOT NULL,
  allowed_sources TEXT NOT NULL,  -- JSON array: ["memory", "kb", "spec"]
  max_results INTEGER DEFAULT 10,
  max_tokens INTEGER DEFAULT 4000,
  recency_weight REAL DEFAULT 0.5  -- prefer recent learnings
);

-- Example policies
INSERT INTO context_policies VALUES
  ('implementer', '["kb_patterns", "kb_mistakes"]', 5, 2000, 0.3),
  ('tester-exec', '[]', 0, 0, 0),  -- no RAG context for testers (pure binary eval)
  ('researcher', '["kb_patterns", "kb_discoveries", "prior_specs"]', 15, 8000, 0.7),
  ('fixer', '["kb_mistakes", "failure_postmortems"]', 10, 4000, 0.8);
```

**Retrieval pipeline:**
1. Before agent spawn, query: `SELECT content FROM learnings WHERE category IN (policy.allowed_sources) ORDER BY relevance_score DESC LIMIT policy.max_results`
2. Truncate to `max_tokens`
3. Inject as `## RELEVANT CONTEXT` section in agent prompt
4. Agent never directly queries the database -- all retrieval is pre-filtered by the orchestrator

**Why governance matters:**
- **Cost:** Unrestricted retrieval bloats prompts with irrelevant context (token waste)
- **Focus:** Agents perform better with focused, relevant context vs. information overload
- **Security:** Prevents agents from accessing sensitive data (cost/budget info, other project data)
- **Bias prevention:** Testers should NOT see implementation details -- keeps evaluation independent

---

### Q17: Full Observability -- Plan, Retrieve, Act, Reflect

**Current observability in Hive Mind:**

| What's Tracked | Where | Gaps |
|---|---|---|
| Agent spawns | manager-log.jsonl | No input/output capture |
| Cost per agent | cost-log.jsonl | No token breakdown (input vs output) |
| Stage timing | manager-log timestamps | No per-agent latency histogram |
| Story status | execution-plan.json | No sub-step status (BUILD vs VERIFY) |
| Live progress | Dashboard (port 9100) | No historical dashboard |
| Wave execution | WAVE_START log entries | No wave completion metrics |
| Failures | FAILED log entries | No failure categorization |

**Proposed observability framework -- 4 pillars:**

#### Pillar 1: PLAN observability
Track what the orchestrator decided and why.

```typescript
interface PlanDecision {
  timestamp: string;
  stage: string;
  decision: string;        // "skip_normalize" | "run_baseline" | "use_quick_tier"
  reason: string;           // "PRD < 200 words, auto-detected quick tier"
  inputs: Record<string, any>;  // what data informed the decision
}
```

Log every orchestrator decision: which stages to run, which agents to spawn, which tier was selected, why a story was deferred to next wave.

#### Pillar 2: RETRIEVE observability
Track what context each agent received and from where.

```typescript
interface RetrievalEvent {
  timestamp: string;
  agentType: string;
  storyId?: string;
  sources: string[];        // ["memory.md", "kb/01-proven-patterns.md"]
  totalTokens: number;      // estimated tokens in context
  retrievalLatency: number; // ms to build context
}
```

This answers: "Why did the agent do X?" -- because it saw Y in its context. Critical for debugging bad agent behavior.

#### Pillar 3: ACT observability
Track what each agent did -- inputs, outputs, tool calls, duration, cost.

```typescript
interface AgentExecution {
  timestamp: string;
  agentType: string;
  storyId?: string;
  model: string;
  inputFiles: string[];
  inputTokens: number;
  outputFile: string;
  outputTokens: number;
  toolCalls: ToolCall[];     // what tools were invoked during execution
  duration: number;
  cost: number;
  exitCode: number;
  truncated: boolean;        // did output hit truncation limit?
}
```

**Tool call tracking** is the biggest gap. Currently Hive Mind doesn't know what tools an agent called during execution. With MCP, tool calls would be logged by the MCP server. Without MCP, we'd need to parse Claude's output for tool invocations.

#### Pillar 4: REFLECT observability
Track what the system learned from each execution.

```typescript
interface ReflectionEvent {
  timestamp: string;
  storyId?: string;
  learnings: Learning[];     // what was captured
  graduations: Graduation[]; // what was promoted to KB
  evalResults: EvalResult[]; // AC/EC pass/fail with details
  retryReason?: string;      // why a retry was triggered
  scorecardDelta?: number;   // how much the grade changed
}
```

**Putting it all together -- the Agent Loop Trace:**

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

**Implementation approach:**
1. Define a unified `TraceEvent` type that covers all 4 pillars
2. Write all trace events to a single `trace-log.jsonl` file
3. Dashboard reads trace log for real-time visualization
4. Post-pipeline, trace log feeds into the scorecard for grading Efficiency dimension

**Dashboard enhancement -- trace view:**
Add a "Trace" tab to the live dashboard showing the agent loop in real-time:
- Timeline view: horizontal bars showing agent duration
- Context view: what each agent received
- Cost waterfall: cumulative cost over time
- Decision tree: why each stage/agent was invoked

---

## Updated Implementation Priority (All Questions)

| # | Improvement | Effort | Impact | Priority |
|---|---|---|---|---|
| Q9 | MCP Phase 1: consume MCP servers | Medium | Unlocks tool ecosystem | **CRITICAL** |
| Q14 | Pipeline timeout + cost velocity alert | Small | Prevents runaway costs | **HIGH** |
| Q3 | Merge compliance into VERIFY GAN loop | Small | Simplifies pipeline | HIGH |
| Q17 | Trace logging (4-pillar observability) | Medium | Debug + quality visibility | HIGH |
| Q6/11 | GAN loop as reusable skill with adaptive evals | Medium | Saves cost, improves quality | HIGH |
| Q8 | Multi-dimensional scorecard with rubric | Medium | Better quality grading | HIGH |
| Q1 | Memory summarization between waves | Small | Prevents context bloat | HIGH |
| Q15 | Command blocklist + path-scoped writes | Small | Basic security | HIGH |
| Q10 | Extract agent definitions to .agent/ YAML | Medium | Extensibility | MEDIUM |
| Q12 | Dark factory mode (--autonomous + holdout) | Large | Full autonomy | MEDIUM |
| Q16 | RAG context governance policies | Medium | Better retrieval | MEDIUM |
| Q7 | Surface graduation stats in REPORT | Small | Shows learning value | MEDIUM |
| Q10 | Staffing agent for dynamic pipeline | Large | True scalability | MEDIUM (v2) |
| Q7 | Full RAG + SQL memory | Large | Semantic retrieval | LOW (v2) |
| Q9 | MCP Phase 2: expose Hive Mind as MCP server | Large | Composability | LOW (v2) |
| Q15 | Docker container sandbox for dev agents | Large | Full isolation | LOW (v2) |
| Q13 | Adaptive concurrency based on rate limits | Medium | Better throughput | LOW |
| Q2 | Playwright verification | Large | Only for UI projects | LOW |

---

## Verification
1. Review the analysis doc for accuracy against source code
2. Validate recommendations against actual file references
3. No code changes in this plan -- this is a research/analysis document

---

## Part 3: Ecosystem & Tooling -- 19 Ideas Analysis

### Category A: MCP Tool Integrations (Ideas 1, 2, 8, 9, 19)

All become trivial config entries once MCP Phase 1 (Q9) is built.

| # | Tool | MCP Server | What It Gives Hive Mind | Priority |
|---|---|---|---|---|
| 1 | **Obsidian** | `@bitbonsai/mcpvault` | Knowledge management -- agents read/write Obsidian vault for structured notes, research, project context. 16 tools for search, read, write, tag. | MEDIUM |
| 2 | **GitHub/GitLab** | `@anthropic-ai/mcp-server-github` | Agents manage issues, PRs, CI/CD status directly. Create issues from failed stories, auto-comment on PRs with scorecard results, check CI before committing. | HIGH |
| 8 | **Supabase** | `supabase-mcp-server` | Managed Postgres for agent memory, project data, auth. Replaces SQLite for production-scale RAG. Adds auth for multi-user Hive Mind. | MEDIUM |
| 9 | **Vercel** | `vercel-mcp` | Deploy web projects directly from pipeline. After EXECUTE, auto-deploy preview. REPORT includes live URL. | MEDIUM |
| 19 | **SQL Database** | `@anthropic-ai/mcp-server-sqlite` | Persistent memory in SQL (aligns with Q7). Move memory.md and knowledge-base to structured DB. | HIGH |

**Implementation:** All are just `.hivemindrc.json` entries once MCP Phase 1 is built:

```json
{
  "mcpServers": {
    "obsidian": { "command": "npx", "args": ["-y", "@bitbonsai/mcpvault", "--vault", "~/notes"] },
    "github": { "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-github"] },
    "sqlite": { "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-sqlite", ".hive-mind-persist/memory.db"] },
    "supabase": { "command": "npx", "args": ["-y", "supabase-mcp-server"] },
    "vercel": { "command": "npx", "args": ["-y", "vercel-mcp"] }
  }
}
```

---

### Category B: Code Intelligence (Ideas 3, 4)

| # | Tool | What It Does | Hive Mind Impact |
|---|---|---|---|
| 3 | **LSP Plugins** | Gives agents "eyes" in code -- type errors, jump-to-definition, find-references in 50ms vs 45s grep | GAME-CHANGER for implementer and fixer agents |
| 4 | **Claude Plugins** | Extensibility system for Claude Code -- custom tools, linters, formatters | Foundation for per-project agent customization |

**LSP for Hive Mind agents -- HIGH priority:**

Currently agents use Read/Grep/Glob for code navigation. With LSP:
- Implementer sees type errors IMMEDIATELY after writing code (no need to wait for VERIFY)
- Fixer can jump-to-definition to understand codebase before patching
- Diagnostician gets real compiler errors, not guessed ones from output parsing
- Could make compliance-reviewer unnecessary -- type errors caught at BUILD time

**How to enable:** Pass LSP config when spawning agents:
```bash
claude --model opus --allowedTools "Read,Write,Edit,Bash,Lsp" --env "ENABLE_LSP_TOOL=1"
```

Add to `.hivemindrc.json`:
```json
{
  "enabledPlugins": {
    "typescript-lsp@claude-plugins-official": true,
    "pyright-lsp@claude-plugins-official": true
  }
}
```

---

### Category C: Browser & UI Testing (Ideas 6, 7, 14, 15, 17)

Coherent cluster: give Hive Mind "eyes" for the UI.

| # | Tool | Role in Pipeline |
|---|---|---|
| 6 | **Firecrawl CLI** | Web scraping -- research agent crawls docs, competitor analysis, API references |
| 7 | **Playwright CLI** | Headless browser testing -- automated E2E tests for web UIs |
| 14 | **Evaluator with Playwright** | Anthropic's approach: Playwright as evaluation backbone for GAN loop |
| 15 | **Chrome extension** | Claude Code + Chrome: build-test-fix loop. Claude opens browser, tests UI, iterates autonomously |
| 17 | **Self-testing** | Claude Code runs app, clicks through pages, catches hidden errors, fixes code |

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

**Two approaches -- use BOTH:**
1. **Playwright MCP (headless, CI-friendly)** -- binary pass/fail ACs (functional correctness)
2. **Chrome extension (interactive, visual)** -- subjective design quality evaluation (ties to Q8 scorecard: Design Quality, Originality, Craft)

---

### Category D: Front-End Design Pipeline (Ideas 10, 16)

**Idea 10: No more AI slop**
- Figma to Code + paste link, get real code
- Theme Factory + 10 ready themes
- Brand Guidelines auto brand control
- Canvas Design + export real visuals

**Idea 16: Claude Code to Figma (Code to Canvas)**
- Figma MCP: bidirectional -- Design -> Code AND Code -> Design
- Push final UI back to Figma as editable layers (not screenshots)

**Design-aware pipeline:**

```
PRD + Figma Link
  --> SPEC (reads Figma design tokens, layout, components via MCP)
  --> PLAN (stories reference specific Figma frames)
  --> EXECUTE
      BUILD: implementer codes against Figma specs
      VISUAL-CHECK: Chrome extension compares live UI to Figma reference
      DESIGN-EVAL: evaluator grades Design Quality, Originality, Craft (Q8 rubric)
  --> Code to Canvas: push final UI back to Figma for designer review
  --> REPORT (includes Figma comparison screenshots)
```

**Anti-AI-slop strategy:**
1. **Brand control:** Figma MCP reads design tokens (colors, fonts, spacing), injects as constraints
2. **Theme system:** 10 curated themes as base. Agent selects and customizes rather than generating from scratch
3. **Visual regression:** Compare screenshots against Figma reference. Reject if deviation exceeds threshold
4. **Originality scoring:** Anthropic's rubric penalizes "template layouts and AI-generated patterns"

---

### Category E: Agent Teams as Skills (Idea 5)

Aligns with Q10 (dynamic agent architecture) and Q11 (GAN loop as skill).

Define reusable "agent teams" -- groups of agents that work together on a task:

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

**Benefits:**
- Composable: `spec-team` + `plan-team` + `execute-team` = full pipeline
- Swappable: use `spec-team-quick` for Quick mode
- Skill-creator can improve teams without touching orchestrator code
- Each team owns its own evaluation criteria

---

### Category F: Infrastructure & Memory (Ideas 11, 18)

**Idea 11: Cloudflare Dynamic Workers**

V8 isolates: ~5ms startup, few MB memory. 100x faster than Docker. $0.002/worker/day.

**Why it matters for Hive Mind:**
- Agent sandboxing (Q15) without Docker overhead
- Isolated execution per story
- "Code Mode": TypeScript API instead of tool calls, saving 80% tokens
- Global edge deployment

**Trade-off:** Requires Cloudflare account + network. Not for air-gapped deployments. Best for hosted/SaaS Hive Mind.

**Idea 18: Google's Always On Memory Agent**

No vector DB, no embeddings. LLM reads, thinks, writes structured memory to SQLite. Consolidates every 30 minutes (merges duplicates, drops noise).

**Key insight for Hive Mind:** LLM decides what to remember, not an embedding pipeline. Simpler than traditional RAG.

**How to apply:**
1. Replace rule-based graduation (date count + story refs) with LLM-driven consolidation
2. Ask the model: "Which learnings are proven enough to graduate?"
3. Memory consolidation runs between pipeline stages (not on a timer)
4. Aligns with Q1 (memory summarization) -- LLM summarizes instead of a function

**Limitation:** Google's demo reads only 50 most recent memories. For Hive Mind with 100+ runs, need pagination or hybrid (LLM consolidation + SQL indexing).

---

### Category G: GAN Pattern Refinement (Ideas 12, 13)

Already covered in Q3, Q6, Q11, Q13. Key reinforcements from Anthropic's details:

- **Separation is critical:** Generator and evaluator MUST be separate agents
- **Few-shot skepticism:** Train evaluator to be skeptical via few-shot examples of harsh-but-fair critiques. Currently Hive Mind's critic has no few-shot examples.
- **5-15 cycles is the range.** Hive Mind caps at 3. Consider increasing to 5 for thorough mode.
- **Context anxiety avoidance:** Each GAN iteration should get clean context with handoff artifact

**New action item:** Add few-shot skepticism examples to critic/evaluator agent prompts in `src/agents/prompts.ts`. Small change, high impact.

---

## Part 3: Priority Summary

| Priority | Ideas | Theme |
|---|---|---|
| **CRITICAL** | MCP Phase 1 (enables 1, 2, 8, 9, 19) | Foundation -- unlocks everything else |
| **HIGH** | 3 (LSP), 5 (Agent Teams), 7+14+15 (Browser Testing) | Agent intelligence + visual evaluation |
| **HIGH** | 12+13 (GAN few-shot skepticism) | Small change, big impact on eval quality |
| **MEDIUM** | 10+16 (Figma/Design pipeline) | Anti-AI-slop for frontend projects |
| **MEDIUM** | 18 (LLM-driven memory consolidation) | Simpler than rule-based graduation |
| **MEDIUM** | 11 (Cloudflare Dynamic Workers) | Agent sandboxing alternative to Docker |
| **LOW** | 6 (Firecrawl) | Nice-to-have for research agent |

## What to Build First (Execution Order)

1. **MCP Phase 1** -- add `mcpServers` config to `.hivemindrc.json` + pass `--mcp-config` to `spawnClaude()`. ONE change enables ideas 1, 2, 8, 9, 19.
2. **LSP enablement** -- add `enabledPlugins` config and `ENABLE_LSP_TOOL` env var to agent spawning. Immediate quality boost.
3. **GAN few-shot skepticism** -- add 3-5 skeptical critique examples to critic/evaluator prompts. 30 minutes of work.
4. **Browser testing** -- add Playwright MCP + Chrome extension for web projects. Enables visual GAN loop.
5. **Agent teams as skills** -- extract orchestration into composable `.skill/` definitions.
6. **Figma MCP** -- design-aware pipeline. Anti-AI-slop.

## Sources
- [Obsidian MCP](https://mcp-obsidian.org/)
- [Cloudflare Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/)
- [Google Always On Memory Agent](https://venturebeat.com/orchestration/google-pm-open-sources-always-on-memory-agent-ditching-vector-databases-for/)
- [Claude Code LSP](https://karanbansal.in/blog/claude-code-lsp/)
- [Claude Code Chrome Integration](https://code.claude.com/docs/en/chrome)
- [Figma Code to Canvas](https://www.figma.com/blog/introducing-claude-code-to-figma/)
- [Figma MCP Server](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)

---

## Part 4: 8 New Ecosystem Ideas

### Idea 1: Google Workspace CLI (`gws`)

Google released `gws` -- one CLI for all of Workspace (Gmail, Drive, Calendar, Docs, Sheets, Chat, Admin). 67 pre-built agent skills, native MCP server support, 10k+ GitHub stars in first week.

**What it gives Hive Mind:**
- **Notification system:** After pipeline completion, email scorecard to stakeholders via `gws gmail send`
- **Document management:** Upload SPEC, REPORT artifacts to Google Drive for team review
- **Calendar integration:** Schedule pipeline runs, block time for human review checkpoints
- **Sheets as data store:** Write cost/timing metrics to Google Sheets for cross-run tracking

**How to integrate:** `gws` has native MCP mode (`gws mcp`). Just add to `.hivemindrc.json`:
```json
{ "mcpServers": { "workspace": { "command": "gws", "args": ["mcp"] } } }
```

**Key advantage:** Avoids 37k-98k token "context tax" of raw Google API tool definitions. Skills are lightweight.

**Priority:** MEDIUM -- high value for enterprise/team use, low value for solo dev.

---

### Idea 2: NotebookLLM-py

Unofficial Python API for Google NotebookLM. Programmatic access to create notebooks, import sources (URLs, PDFs, YouTube), generate audio overviews, export quizzes/flashcards.

**What it gives Hive Mind:**
- **Research agent enhancement:** Import PRD sources into NotebookLM for AI-synthesized insights
- **Knowledge synthesis:** Generate audio overviews and structured insights from imported sources
- **Export artifacts:** Generate study guides, mind maps, or presentations from pipeline reports

**Caveat:** Uses undocumented Google APIs -- can break anytime. Not for production pipelines.

**Priority:** LOW -- nice for research/knowledge synthesis but fragile.

---

### Idea 3: Use Claude's Built-in Browser Testing Instead of Raw Playwright

Rather than Hive Mind agents using Playwright directly (complex setup, script writing), use Claude's built-in browser testing via the Chrome extension + `--chrome` flag.

**Why this is better:**
- Claude already knows how to navigate, click, test, screenshot
- No Playwright script writing needed -- agent describes what to test in natural language
- Build-test-fix loop is native: Claude opens browser, sees issues, fixes code, re-checks
- Handles mobile/theme testing automatically

**How Hive Mind uses it:**
```
EXECUTE stage (web projects):
  BUILD: implementer writes code
  VISUAL-VERIFY: spawn agent with --chrome flag
    Agent: "Open localhost:3000, test the login flow, verify responsive design"
    Agent sees the page, catches issues, fixes code, re-tests
    GAN loop until passing
```

**vs. Playwright scripts:**
- Playwright: agent writes test scripts -> run scripts -> parse results -> fix -> re-run
- Chrome skill: agent looks at the page -> evaluates -> fixes -> looks again

**Recommendation:** Use Chrome skill for subjective evaluation (design quality, UX). Use Playwright scripts for binary regression tests (API endpoints, data flow). They complement each other.

**Priority:** HIGH -- dramatically simplifies web project verification.

---

### Idea 4: Pre-Built Community Skills

Leverage community-created Claude Code skills for specialized capabilities:

| Skill | What It Does | Hive Mind Application |
|---|---|---|
| **frontend-design** | Professional frontend design patterns | Implementer uses for UI stories |
| **ui-ux-pro-max** | Advanced UI/UX best practices | Anti-AI-slop: evaluator grades UX quality |
| **seo** | SEO optimization | Post-EXECUTE: SEO audit as scorecard dimension |
| **code-review** | Structured code review | Replace/supplement code-reviewer agent |
| **remotion** | Programmatic video generation (React) | Generate demo videos from completed builds |
| **owasp-security** | OWASP Top 10 security scanning | Security audit as pipeline stage or scorecard dimension |

**Key insight:** Instead of building custom agents for security/SEO/design quality, leverage community skills. Hive Mind's orchestrator loads appropriate skills per project type:
- Web project: load `frontend-design`, `ui-ux-pro-max`, `seo`
- API project: load `owasp-security`, `code-review`
- Video project: load `remotion`

**Priority:** MEDIUM -- curate a recommended skill set per project type.

---

### Idea 5: Slash Commands (/create, Context7, /swarm, /research, /system-design)

| Command | What It Does | Hive Mind Application |
|---|---|---|
| **/create** | Builds new skills from a description | Meta-skill: create project-specific skills during PLAN stage |
| **Context7** | Pulls live docs for any library via MCP | Research agent gets current API docs instead of stale training data |
| **/swarm** | Launches parallel agent team | Native to Claude Code agent teams -- aligns with Q10 dynamic agents |
| **/research** | Deep discovery with cross-referenced findings | Enhance SPEC research agent with deep research capability |
| **/system-design** | Full architecture with tools and pricing | Could replace or supplement SPEC stage for architecture decisions |

**Context7 is the most impactful for Hive Mind:**
- Currently, research and spec-drafter agents use their training data for library APIs
- Context7 MCP fetches LATEST docs at runtime -- no stale patterns, no deprecated APIs
- Add to `.hivemindrc.json`:
```json
{ "mcpServers": { "context7": { "command": "npx", "args": ["-y", "@context7/mcp-server"] } } }
```

**/create for skill generation:**
- After a pipeline run, analyze what custom behaviors emerged
- Use `/create` to generate a reusable skill from that pattern
- Self-improving harness: Hive Mind gets better per project by generating skills

**Priority:** HIGH for Context7. MEDIUM for /create. /swarm covered by Q10.

---

### Idea 6: Claude-Mem

Claude Code plugin that auto-captures everything Claude does, compresses into structured summaries via Agent SDK, stores in SQLite, and injects relevant context into future sessions.

**What it gives Hive Mind:**
- **Automatic session memory:** Every agent's actions captured without explicit learn stage
- **Cross-session continuity:** Next pipeline run gets relevant context from prior runs automatically
- **SQLite storage:** Aligns with Q7 (RAG + SQL) and Idea 19 (persist memory to SQL)
- **Searchable via MCP:** Natural language queries over project history

**How it compares to Hive Mind's current learning system:**

| Feature | Hive Mind Current | Claude-Mem |
|---|---|---|
| Capture | Explicit learner agent per story | Automatic from all tool usage |
| Storage | memory.md (flat file) | SQLite (structured, searchable) |
| Retrieval | Load entire file | Query by relevance |
| Consolidation | Rule-based graduation | AI-compressed summaries |
| Cross-session | Knowledge base files | Injected context per session |

**Recommendation:** Don't replace Hive Mind's learning system -- augment it. Use Claude-Mem for automatic capture, Hive Mind's graduation for curation.

**Priority:** HIGH -- directly solves the memory persistence problem.

---

### Idea 7: Claude Code Web Search

Claude Code has built-in WebSearch and WebFetch tools. Latest version (`web_search_20260209`) adds dynamic filtering -- Claude writes code to filter results before they hit context, saving 24% tokens with 11% better accuracy.

**What it gives Hive Mind:**
- **Research agent upgrade:** Search the web for current API docs, Stack Overflow solutions, GitHub issues
- **Error diagnosis:** When fixer encounters unknown error, search for solutions in real-time
- **Competitive analysis:** Research agent compares PRD requirements against existing solutions

**How to enable for Hive Mind agents:**
Just add "WebSearch" and "WebFetch" to allowed tools for research/fixer agents:

```typescript
// tool-permissions.ts update
const RESEARCH_TOOLS = [...READ_ONLY_TOOLS, "Write", "WebSearch", "WebFetch"];
```

**Priority:** HIGH -- easy to enable, high value for research and diagnosis agents.

---

### Idea 8: MCP-CLI Deferred Tool Loading

Originally an undocumented `ENABLE_EXPERIMENTAL_MCP_CLI=true` flag. Now replaced by official **Tool Search** and **`defer_loading`** in Claude Code settings. Reduces MCP tool context from 30-100k tokens to near zero by loading schemas on-demand.

**What it gives Hive Mind:**
- **Token savings:** With many MCP servers (GitHub, SQLite, Figma, Vercel), deferred loading prevents 100k+ tokens of tool schemas filling context
- **More room for actual work:** Agents get full context window for code, not tool definitions
- **Scale:** Enables 10+ MCP servers configured without penalty

**How to enable:**
```json
{
  "mcpServers": {
    "github": { "command": "...", "defer_loading": true },
    "sqlite": { "command": "...", "defer_loading": true }
  }
}
```

**Priority:** HIGH -- essential prerequisite for MCP Phase 1 at scale.

---

## Part 4: Priority Summary

| Priority | Ideas | Impact |
|---|---|---|
| **HIGH** | 3 (Chrome skill), 6 (Claude-Mem), 7 (Web Search), 8 (Deferred loading) | Immediate quality + efficiency |
| **HIGH** | 5 (Context7 for live docs) | No more stale API patterns |
| **MEDIUM** | 1 (Google Workspace CLI), 4 (Community skills), 5 (/create) | Enterprise/team, project-type customization |
| **LOW** | 2 (NotebookLLM-py) | Fragile unofficial API |

---

## Revised Master Build Order (All Parts)

1. **MCP Phase 1 + deferred loading** (Q9 + Part 4 Idea 8) -- foundation for everything
2. **WebSearch + WebFetch for agents** (Part 4 Idea 7) -- add to tool-permissions.ts
3. **Context7 MCP** (Part 4 Idea 5) -- live docs for research/spec agents
4. **LSP enablement** (Part 3 Idea 3) -- IDE-level code intelligence for agents
5. **Chrome skill for web testing** (Part 4 Idea 3) -- visual GAN loop for UI projects
6. **Claude-Mem integration** (Part 4 Idea 6) -- automatic memory capture to SQLite
7. **GAN few-shot skepticism** (Part 3 Ideas 12-13) -- critic prompt improvement
8. **Agent teams as skills** (Part 3 Idea 5 + Q10) -- dynamic agent composition
9. **Community skills per project type** (Part 4 Idea 4) -- frontend-design, owasp-security, etc.
10. **Google Workspace CLI** (Part 4 Idea 1) -- enterprise notification/reporting
11. **Figma MCP** (Part 3 Ideas 10+16) -- design-aware pipeline

## Sources (Part 4)
- [Google Workspace CLI](https://github.com/googleworkspace/cli)
- [notebooklm-py](https://github.com/teng-lin/notebooklm-py)
- [Claude Code Chrome Integration](https://code.claude.com/docs/en/chrome)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Claude-Mem](https://github.com/thedotmack/claude-mem)
- [Claude Code Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [MCP-CLI Deferred Loading](https://paddo.dev/blog/claude-code-hidden-mcp-flag/)
- [Context7 MCP](https://github.com/am-will/swarms)

---

## Part 5: 3 New Ideas (Preview, Channels, Skill-Creator)

### Idea 1: Preview MCP for Claude Code

Claude Code Desktop has a built-in Preview MCP that lets agents start dev servers and preview running apps directly. Click-to-edit: users click a UI element, Claude knows which component to modify.

**How it works:**
- `preview_start` launches a dev server defined in `.claude/launch.json`
- Connects to a headless browser for screenshots, DOM inspection, click simulation, network monitoring
- Agent sees the live app, reads console logs, catches errors, and iterates

**What it gives Hive Mind:**

The missing link between BUILD and VERIFY for web projects. Currently Hive Mind runs shell-based ACs/ECs blind -- never sees the UI. With Preview:

```
EXECUTE stage (web projects):
  BUILD: implementer writes code
  PREVIEW: spawn agent with preview MCP
    - Starts dev server
    - Takes screenshots at key pages
    - Reads console for errors
    - Checks responsive layouts (mobile, tablet, desktop)
  EVALUATE: grades screenshots against design criteria
  FIX: fixer gets screenshot + DOM state + console errors
  (GAN loop with visual feedback)
```

**Key difference from Chrome extension (Part 4, Idea 3):**
- Chrome extension: requires Chrome browser, works via extension API
- Preview MCP: built into Claude Code Desktop, headless, no browser dependency
- Preview MCP is better for CI/headless pipelines (Hive Mind's use case)
- Chrome extension is better for interactive development

**Integration approach:**
1. Add `.claude/launch.json` generation to PLAN stage (auto-detect start command from package.json)
2. In VERIFY stage, if project type is web, use `preview_start` before running visual ACs
3. Evaluator receives screenshots alongside test results for multi-dimensional grading

**Priority:** HIGH -- enables visual verification without browser dependency. Critical for dark factory mode.

---

### Idea 2: Claude Channels

Claude Code added `--channels` as a research preview. MCP-based message push system:
- **Permission relay:** Channel servers forward tool approval prompts to your phone
- **Remote notifications:** Pipeline status updates pushed to mobile
- **Cross-device coordination:** Start pipeline on desktop, approve checkpoints from phone

**What it gives Hive Mind:**

Directly enhances the human-in-the-loop system:

```
Current checkpoint flow:
  Pipeline pauses -> writes .checkpoint file -> user polls `hive-mind status`
  User must be at terminal to `hive-mind approve`

With Channels:
  Pipeline pauses -> pushes notification to phone
  User approves from phone -> channel relays back
  Pipeline resumes
```

**Three applications:**

1. **Checkpoint notifications:** Push "SPEC ready for review" to phone. Approve/reject from mobile.
2. **Progress streaming:** Real-time pipeline progress pushed to a channel.
3. **Multi-user coordination:** Team lead gets notifications when any pipeline needs review.

**Integration approach:**
1. Add `--channels` support to `spawnClaude()` in `src/utils/shell.ts`
2. When checkpoint is written, push notification via channel MCP
3. Channel server listens for approval/rejection and writes to `.checkpoint`
4. Ties into three-layer notification system (v0.15.0) -- channels become the 4th layer

**Priority:** MEDIUM -- significant UX improvement, but channels is still research preview.

---

### Idea 3: Claude Skill-Creator -- Self-Improving Harness

The official Anthropic skill-creator (`github.com/anthropics/skills`, 87k+ stars) automates custom skill creation with a built-in evaluation and optimization loop.

**How it works:**
1. Describe what the skill should do
2. Skill-creator drafts `SKILL.md` with YAML frontmatter + instructions
3. Creates test cases (trigger queries)
4. Runs evaluation: splits 60/40 train/test, measures trigger rate
5. Iterates up to 5 times: proposes improved descriptions, picks best by test score
6. Outputs HTML report + optimized SKILL.md

**What it gives Hive Mind -- self-improving harness:**

After each pipeline run, convert learned patterns into executable skills:

```
Post-pipeline self-improvement:
  1. Analyze scorecard + failure logs for repeating patterns
  2. Identify patterns that could become skills:
     - "Always run tsc before tests in TypeScript projects"
     - "Check for circular imports before BUILD"
     - "Use vitest --reporter=json for parseable test output"
  3. Use skill-creator to generate + evaluate a skill from the pattern
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
  -> Learner captures pattern
  -> Graduation promotes it to KB
  -> SELF-IMPROVE creates skill: "always enable strict mode checks before BUILD"

Run 2: Skill auto-triggers during PLAN
  -> EC-generator includes strict mode ECs
  -> All stories pass strict mode checks
  -> 0 failures from this pattern
```

**Hive Mind already has the learning + graduation system. Skill-creator is the missing piece that converts graduated learnings into executable skills.**

**Integration:**
1. Add optional `SELF-IMPROVE` stage after REPORT (enabled in thorough mode)
2. Reads scorecard + failure logs + graduated learnings
3. For each candidate pattern, invoke skill-creator
4. Skills that pass evaluation are added to project `.claude/skills/`
5. Next pipeline run inherits the new skills

**Priority:** HIGH -- path to a self-improving dark factory.

---

## Part 5: Priority Summary

| Priority | Idea | Impact |
|---|---|---|
| **HIGH** | 1 (Preview MCP) | Visual verification for web projects, no browser dependency |
| **HIGH** | 3 (Skill-Creator) | Self-improving harness, gets better every run |
| **MEDIUM** | 2 (Channels) | Mobile checkpoint approval, team coordination |

---

## Revised Master Build Order (All Parts, Final)

1. **MCP Phase 1 + deferred loading** (Q9 + P4.8)
2. **WebSearch + WebFetch for agents** (P4.7)
3. **Context7 MCP** (P4.5)
4. **LSP enablement** (P3.3)
5. **Preview MCP for web testing** (P5.1)
6. **Claude-Mem integration** (P4.6)
7. **GAN few-shot skepticism** (P3.12-13)
8. **Skill-Creator self-improvement loop** (P5.3) -- SELF-IMPROVE stage
9. **Agent teams as skills** (P3.5 + Q10)
10. **Community skills per project type** (P4.4)
11. **Channels for checkpoint notifications** (P5.2)
12. **Google Workspace CLI** (P4.1)
13. **Figma MCP** (P3.10+16)

## Sources (Part 5)
- [Claude Code Preview, Review, and Merge](https://claude.com/blog/preview-review-and-merge-with-claude-code)
- [Claude Code Desktop Preview MCP](https://medium.com/@dan.avila7/claude-code-desktop-has-a-built-in-preview-mcp-heres-how-it-works-774809ff676f)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Skill-Creator Guide](https://apidog.com/blog/claude-code-skill-creator-guide/)
