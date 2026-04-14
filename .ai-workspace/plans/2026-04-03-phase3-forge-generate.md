# Forge Harness — Phase 3: forge_generate

## Context

Phase 1 shipped `forge_plan` (v0.4.1) — planning engine with double-critique. Phase 2 shipped `forge_evaluate` (v0.4.2) — stateless binary grading via shell commands. Phase 3 implements `forge_generate` — the GAN loop controller that orchestrates the implement → evaluate → fix cycle.

**Billing constraint:** The user is on Claude Code Max (unlimited subscription). MCP server tools that call `callClaude()` hit api.anthropic.com directly — separate ANTHROPIC_API_KEY billing. forge_generate must NOT make Claude API calls. All LLM work happens in Claude Code (Max, free).

**Design doc alignment:** The design doc (`docs/forge-harness-plan.md:280`) says: *"The skill IS the generator. /generate runs in a Claude session."* forge_generate as an MCP tool is a **GAN loop controller** — it provides structured context (briefs), runs evaluations (shell commands, no LLM), and makes stopping decisions. Claude Code does the actual code generation.

## ELI5

The robot doesn't cook the meal — YOU cook (Claude Code, free). The robot writes the recipe card, checks if the dish tastes right (runs shell commands), and tells you whether to keep going, fix something, or give up. The taste-testing is just running checklist commands — no thinking needed, no extra cost.

---

## Architecture

### How the GAN Loop Works

```
Claude Code (Max, free)                    MCP Server (forge tools)
─────────────────────────                  ────────────────────────
                                           
1. Call forge_generate(storyId, plan)  ──► [init] Load plan, find story,
                                                  scan codebase, baseline check
                                           ◄──── Return: GenerationBrief
                                                  (story + context + git branch
                                                   + baseline instructions)

2. Run baseline check (build + test)
3. Create git branch: feat/{story-id}
4. Implement code based on brief          

5. Call forge_evaluate(storyId, plan)  ──► [eval] Run AC shell commands
                                           ◄──── Return: EvalReport (PASS/FAIL)

6. If PASS → squash-merge, done!

7. If FAIL:
   Call forge_generate(storyId, plan,  ──► [iterate] Check stopping conditions:
        evalReport, iteration, scores)          - plateau? no-op? max iterations?
                                                - compute score, compare history
                                           ◄──── Return: decision + fix brief
                                                  OR escalation report

8. Fix code based on fix brief
9. Go to step 5
```

### What forge_generate Does (no API calls)

| Call | Input | Output | LLM? |
|------|-------|--------|------|
| Init (iteration=0) | storyId, plan | GenerationBrief (story + codebase context + git instructions) | No |
| Iterate (iteration>=1) | storyId, plan, evalReport, scores | Decision (continue/escalate) + fix brief or escalation | No |
| — | — | Evaluation happens via forge_evaluate (shell commands only) | No |

### Design Doc Alignment (8 GAN Elements)

| # | Element | Status |
|---|---------|--------|
| 1 | Separation of concerns (generator ≠ evaluator) | Claude Code = generator, forge_evaluate = evaluator (stateless, no generation context) |
| 2 | Binary evaluation (shell exit codes) | forge_evaluate, already shipped |
| 3 | Two-tier feedback | Fast tier: Claude Code hooks (free). Slow tier: forge_evaluate (free, shell only) |
| 4 | Hash-based no-op detection | In forge_generate stopping logic (caller passes file hashes) |
| 5 | Confidence-based short-circuit | Deferred (binary ACs are definitive, no confidence ambiguity) |
| 6 | Last-failure-only context | Fix brief includes only latest eval report |
| 7 | Escalate when stuck | forge_generate returns escalation decision with structured report |
| 8 | Structured escalation | hypothesis + what was tried + what failed |

### Features from Design Doc — Tracked

| Feature | Design doc ref | In plan? | Notes |
|---------|---------------|----------|-------|
| Baseline check (build+test before start) | Loop step 0 | Yes | Returned in init brief |
| Git branch per story | Loop step 2 | Yes | Branch name in brief |
| Squash-merge on PASS | Commit strategy | Yes | Instruction in brief |
| Dynamic stopping (score plateau) | Line 285 | Yes | forge_generate computes |
| No-op detection (hash unchanged) | Line 286 | Yes | Caller passes hashes |
| Max iterations (default 3) | Line 291 | Yes | Input param |
| Structured escalation | Line 292 | Yes | In escalation output |
| Self-tracking (.forge/runs/) | Line 310 | Yes | forge_generate writes JSONL |
| Command blocklist | Line 290 | Deferred | Phase 4 (coordinator sandbox) |

---

## Input Schema

```typescript
const generateInputSchema = {
  storyId: z.string().describe("Story ID to implement (e.g., US-01)"),
  planPath: z.string().optional().describe("Path to execution-plan.json"),
  planJson: z.string().optional().describe("Inline plan JSON (precedence over planPath)"),
  projectPath: z.string().optional().describe("Project root (defaults to cwd)"),
  maxIterations: z.number().optional().describe("Max GAN loop iterations (default 3)"),
  timeoutMs: z.number().optional().describe("Timeout per AC command in ms (default 30000)"),
  // Iteration context (omit for init call)
  iteration: z.number().optional().describe("Current iteration (1-indexed, omit for init)"),
  evalReport: z.string().optional().describe("Previous EvalReport JSON (for fix iterations)"),
  previousScores: z.array(z.number()).optional().describe("Scores from previous iterations for plateau detection"),
  fileHashes: z.record(z.string()).optional().describe("SHA-256 hashes of files from previous iteration for no-op detection"),
};
```

## Output Schema

```typescript
interface GenerationBrief {
  story: Story;                    // from the plan
  codebaseContext: string;         // from scanCodebase()
  gitBranch: string;               // e.g., "feat/US-01"
  baselineCheck: string;           // e.g., "npm run build && npm test"
}

interface FixBrief {
  failedCriteria: Array<{
    id: string;
    description: string;
    evidence: string;              // what the command output was
  }>;
  score: number;                   // PASS/total ratio
  guidance: string;                // last-failure-only: formatted eval report
}

interface Escalation {
  reason: "no-op" | "plateau" | "max-iterations" | "inconclusive" | "baseline-failed";
  description: string;
  hypothesis?: string;
  lastEvalVerdict?: "FAIL" | "INCONCLUSIVE";
  scoreHistory: number[];
}

interface GenerateResult {
  action: "implement" | "fix" | "escalate" | "pass";
  storyId: string;
  iteration: number;
  maxIterations: number;
  brief?: GenerationBrief;         // present when action = "implement"
  fixBrief?: FixBrief;             // present when action = "fix"
  escalation?: Escalation;         // present when action = "escalate"
  currentScore?: number;           // present after evaluation
}
```

---

## File Specs

### New Files

| File | Purpose | ~Lines |
|------|---------|--------|
| `server/types/generate-result.ts` | GenerateResult, GenerationBrief, FixBrief, Escalation interfaces | 40 |
| `server/lib/plan-loader.ts` | Shared loadPlan() extracted from evaluate.ts | 35 |
| `server/lib/generator.ts` | Core logic: buildBrief, buildFixBrief, checkStoppingConditions | 150 |
| `server/lib/plan-loader.test.ts` | Tests for shared loadPlan() | 60 |
| `server/lib/generator.test.ts` | Core logic tests (briefs, stopping, escalation) | 200 |
| `server/tools/generate.test.ts` | Handler tests (MCP response format, input validation) | 120 |

### Modified Files

| File | Change |
|------|--------|
| `server/tools/generate.ts` | Replace stub with handler using generator.ts |
| `server/tools/evaluate.ts` | Import loadPlan from plan-loader |
| `server/index.ts` | Update tool description |

### NOT needed (vs old plan)

| Removed | Why |
|---------|-----|
| `server/lib/prompts/generator.ts` | No Claude API calls → no prompt builders needed |
| File writing / path traversal logic | Claude Code writes files, not the MCP tool |
| Claude API retry logic | No API calls |

---

## Implementation Order

### Step 0: Dogfood forge_plan via MCP

1. Run `forge_plan` via MCP (thorough tier) with Phase 3 intent
2. Save output to `.ai-workspace/plans/2026-04-03-phase3-forge-plan-output.json`
3. Diff against manual plan — classify any forge_plan deficiencies
4. Use the output JSON structure as canonical mock template for tests

### Step 1: Leaf types and shared utilities

1. Create `server/types/generate-result.ts`
2. Create `server/lib/plan-loader.ts` (extract from evaluate.ts)
3. Update `server/tools/evaluate.ts` to import from plan-loader
4. Run `npm test` — verify zero regression

### Step 2: Core logic

5. Create `server/lib/generator.ts`:
   - `buildBrief(plan, storyId, projectPath)` → GenerationBrief
   - `buildFixBrief(evalReport)` → FixBrief
   - `checkStoppingConditions(evalReport, iteration, maxIterations, previousScores, fileHashes)` → "continue" | Escalation
   - `computeScore(evalReport)` → number

### Step 3: MCP handler

6. Replace `server/tools/generate.ts` stub with full handler
7. Update `server/index.ts` tool description

### Step 4: Tests

8. Create `server/lib/plan-loader.test.ts`
9. Create `server/lib/generator.test.ts`
10. Create `server/tools/generate.test.ts`

### Step 5: Verification

11. `npm run build` — passes
12. `npm test` — all tests pass
13. Manual smoke test: call handleGenerate() for init + iterate flows

---

## Test Cases & AC

### US-01: Types and shared plan loader

- **AC-01:** GenerateResult and related interfaces exported from `server/types/generate-result.ts`
  ```
  npx tsc --noEmit && grep -q 'export interface GenerateResult' server/types/generate-result.ts && echo PASS
  ```

- **AC-02:** loadPlan() exported from `server/lib/plan-loader.ts`, handles planJson precedence
  ```
  npm run build && node --input-type=module -e "import { loadPlan } from './dist/lib/plan-loader.js'; const plan = loadPlan(undefined, JSON.stringify({schemaVersion:'3.0.0',stories:[{id:'US-01',title:'Test',acceptanceCriteria:[{id:'AC-01',description:'d',command:'echo ok'}]}]})); console.log(plan.stories[0].id === 'US-01' ? 'PASS' : 'FAIL');"
  ```

- **AC-03:** Existing evaluate tests still pass after loadPlan extraction
  ```
  npx vitest run server/tools/evaluate.test.ts 2>&1 && echo PASS
  ```

### US-02: Core generator logic (generator.ts)

Dependencies: US-01

- **AC-01:** buildBrief() returns GenerationBrief with story, codebaseContext, gitBranch, baselineCheck
  ```
  npx vitest run server/lib/generator.test.ts -t "buildBrief" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-02:** buildFixBrief() extracts failed criteria and evidence from eval report
  ```
  npx vitest run server/lib/generator.test.ts -t "buildFixBrief" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-03:** computeScore() returns PASS/total ratio, excluding SKIPPED
  ```
  npx vitest run server/lib/generator.test.ts -t "computeScore" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-04:** checkStoppingConditions() returns "continue" when score improves
  ```
  npx vitest run server/lib/generator.test.ts -t "continue when improving" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-05:** checkStoppingConditions() escalates with "plateau" when score unchanged for 2 evals
  ```
  npx vitest run server/lib/generator.test.ts -t "plateau" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-06:** checkStoppingConditions() escalates with "max-iterations" at limit
  ```
  npx vitest run server/lib/generator.test.ts -t "max-iterations" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-07:** checkStoppingConditions() escalates with "no-op" when all file hashes unchanged
  ```
  npx vitest run server/lib/generator.test.ts -t "no-op" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-08:** checkStoppingConditions() escalates with "inconclusive" on INCONCLUSIVE verdict
  ```
  npx vitest run server/lib/generator.test.ts -t "inconclusive" 2>&1 | grep -q 'passed' && echo PASS
  ```

### US-03: MCP tool handler (generate.ts)

Dependencies: US-01, US-02

- **AC-01:** handleGenerate() with no iteration context returns action "implement" with brief
  ```
  npx vitest run server/tools/generate.test.ts -t "init returns implement" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-02:** handleGenerate() with evalReport returns action "fix" with fixBrief (when conditions allow)
  ```
  npx vitest run server/tools/generate.test.ts -t "iterate returns fix" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-03:** handleGenerate() returns action "escalate" when stopping conditions met
  ```
  npx vitest run server/tools/generate.test.ts -t "escalate" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-04:** handleGenerate() returns isError when neither planPath nor planJson provided
  ```
  npx vitest run server/tools/generate.test.ts -t "no plan" 2>&1 | grep -q 'passed' && echo PASS
  ```

- **AC-05:** Full test suite passes
  ```
  npm run build && npx vitest run 2>&1 && echo PASS
  ```

- **AC-06:** TypeScript compilation succeeds
  ```
  npx tsc --noEmit && echo PASS
  ```

---

## Design Doc Divergence Audit

Compared `docs/forge-harness-plan.md` against actual Phase 1-3 implementations.

| Phase | Divergence | Status |
|---|---|---|
| Phase 1 (forge_plan) | ~35% | Healthy — core pipeline faithful, cuts are phase-appropriate |
| Phase 2 (forge_evaluate) | ~30% | Healthy — core grading faithful, missing features are optimizations |
| Phase 3 (forge_generate) | ~5% | Aligned — "brief assembler" adapts to Max billing while keeping all 8 GAN elements |

### Intentional naming improvements over design doc
- `title` (impl) > `intent` (doc) — clearer for stories
- `command` (impl) > `verify` (doc) — more precise for shell commands
- JSON EvalReport (impl) > eval-report.md (doc) — better for MCP machine consumption

### Deferred features (add when needed, not now)
- Context7 MCP in planner → Phase 5
- UI prototyping auto-trigger → Phase 5
- Specialist parallel critics → Phase 5 (thorough tier)
- Fail-fast, differential eval → optimization, low priority (no API cost in evaluate)
- Self-tracking (.forge/runs/) → Phase 4 (coordinator needs it)
- Budget/cost fields in plan schema → Phase 4 (coordinator needs it)
- `status` field on stories → Phase 4 (coordinator needs it)

### No fix needed now
All divergences are either intentional improvements or phase-appropriate deferrals. The design doc is a north star, not a rigid spec.

---

## Checkpoint

- [ ] Run forge_plan via MCP, save output as mock template
- [ ] Diff forge_plan output against manual plan, classify findings
- [ ] Create `server/types/generate-result.ts`
- [ ] Create `server/lib/plan-loader.ts` (extract from evaluate.ts)
- [ ] Update `server/tools/evaluate.ts` to use shared plan-loader
- [ ] Verify existing tests pass (zero regression)
- [ ] Create `server/lib/generator.ts` (briefs + stopping logic)
- [ ] Replace `server/tools/generate.ts` stub with full handler
- [ ] Update `server/index.ts` tool description
- [ ] Create `server/lib/plan-loader.test.ts`
- [ ] Create `server/lib/generator.test.ts`
- [ ] Create `server/tools/generate.test.ts`
- [ ] `npm run build` passes
- [ ] `npm test` — all tests pass
- [ ] Smoke test: init + iterate flows
- [ ] Ship via `/ship`
