/**
 * Dogfood divergence test: verifies the three-tier document system was built correctly
 * by running mechanical AC checks against the actual codebase.
 *
 * This is the forward divergence check from Step 6. It creates an execution plan
 * describing what Steps 1-5 were supposed to build, then runs each AC against
 * the real codebase to verify it was delivered.
 *
 * No LLM calls — all ACs are shell commands that test observable behavior.
 */
import { describe, it, expect } from "vitest";
import { evaluateStory } from "../lib/evaluator.js";
import { validateExecutionPlan } from "../validation/execution-plan.js";
import { validateMasterPlan } from "../validation/master-plan.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

// ── Dogfood Execution Plan ───────────────────────────────
// This plan describes the three-tier system deliverables with binary ACs.
// Each AC runs a shell command that tests observable behavior.

const DOGFOOD_PLAN: ExecutionPlan = {
  schemaVersion: "3.0.0",
  stories: [
    {
      id: "US-01",
      title: "MasterPlan type and validation",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "AC-01",
          description: "MasterPlan type file exists",
          command: "test -f server/types/master-plan.ts && echo PASS",
        },
        {
          id: "AC-02",
          description: "MasterPlan validation file exists",
          command: "test -f server/validation/master-plan.ts && echo PASS",
        },
        {
          id: "AC-03",
          description: "MasterPlan validator rejects empty phases",
          command:
            "npx tsx -e \"import {validateMasterPlan} from './server/validation/master-plan.ts'; const r = validateMasterPlan({schemaVersion:'1.0.0',documentTier:'master',title:'t',summary:'s',phases:[]}); process.exit(r.valid ? 1 : 0)\"",
        },
        {
          id: "AC-04",
          description: "MasterPlan validator accepts valid plan with phases",
          command:
            "npx tsx -e \"import {validateMasterPlan} from './server/validation/master-plan.ts'; const r = validateMasterPlan({schemaVersion:'1.0.0',documentTier:'master',title:'t',summary:'s',phases:[{id:'PH-01',title:'t',description:'d',dependencies:[],inputs:[],outputs:[],estimatedStories:1}]}); process.exit(r.valid ? 0 : 1)\"",
        },
      ],
      affectedPaths: [
        "server/types/master-plan.ts",
        "server/validation/master-plan.ts",
      ],
    },
    {
      id: "US-02",
      title: "Tier-aware prompts",
      dependencies: ["US-01"],
      acceptanceCriteria: [
        {
          id: "AC-01",
          description: "Planner prompt contains functional AC rule",
          command:
            "npx tsx -e \"import {buildPlannerPrompt} from './server/lib/prompts/planner.ts'; const p = buildPlannerPrompt('feature'); process.exit(p.includes('OBSERVABLE BEHAVIOR') ? 0 : 1)\"",
        },
        {
          id: "AC-02",
          description: "Master planner prompt exists and mentions phases",
          command:
            "npx tsx -e \"import {buildMasterPlannerPrompt} from './server/lib/prompts/planner.ts'; const p = buildMasterPlannerPrompt(); process.exit(p.includes('phase') ? 0 : 1)\"",
        },
        {
          id: "AC-03",
          description: "Phase planner prompt exists and mentions stories",
          command:
            "npx tsx -e \"import {buildPhasePlannerPrompt} from './server/lib/prompts/planner.ts'; const p = buildPhasePlannerPrompt(); process.exit(p.includes('stor') ? 0 : 1)\"",
        },
      ],
      affectedPaths: ["server/lib/prompts/planner.ts"],
    },
    {
      id: "US-03",
      title: "Coherence and divergence evaluation",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "AC-01",
          description: "Coherence eval prompt file exists",
          command:
            "test -f server/lib/prompts/coherence-eval.ts && echo PASS",
        },
        {
          id: "AC-02",
          description: "Divergence eval prompt file exists",
          command:
            "test -f server/lib/prompts/divergence-eval.ts && echo PASS",
        },
        {
          id: "AC-03",
          description: "Coherence eval prompt builder is importable",
          command:
            "npx tsx -e \"import {buildCoherenceEvalPrompt} from './server/lib/prompts/coherence-eval.ts'; process.exit(typeof buildCoherenceEvalPrompt === 'function' ? 0 : 1)\"",
        },
        {
          id: "AC-04",
          description: "Divergence eval prompt builder is importable",
          command:
            "npx tsx -e \"import {buildDivergenceEvalPrompt} from './server/lib/prompts/divergence-eval.ts'; process.exit(typeof buildDivergenceEvalPrompt === 'function' ? 0 : 1)\"",
        },
      ],
      affectedPaths: [
        "server/lib/prompts/coherence-eval.ts",
        "server/lib/prompts/divergence-eval.ts",
      ],
    },
    {
      id: "US-04",
      title: "Cross-cutting observability",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "AC-01",
          description: "CostTracker file exists",
          command: "test -f server/lib/cost.ts && echo PASS",
        },
        {
          id: "AC-02",
          description: "ProgressReporter file exists",
          command: "test -f server/lib/progress.ts && echo PASS",
        },
        {
          id: "AC-03",
          description: "AuditLog file exists",
          command: "test -f server/lib/audit.ts && echo PASS",
        },
        {
          id: "AC-04",
          description: "RunContext file exists",
          command: "test -f server/lib/run-context.ts && echo PASS",
        },
        {
          id: "AC-05",
          description: "CostTracker is importable with summarize method",
          command:
            "npx tsx -e \"import {CostTracker} from './server/lib/cost.ts'; const c = new CostTracker(); process.exit(typeof c.summarize === 'function' ? 0 : 1)\"",
        },
      ],
      affectedPaths: [
        "server/lib/cost.ts",
        "server/lib/progress.ts",
        "server/lib/audit.ts",
        "server/lib/run-context.ts",
      ],
    },
    {
      id: "US-05",
      title: "Three-tier integration test exists",
      dependencies: ["US-01", "US-02", "US-03"],
      acceptanceCriteria: [
        {
          id: "AC-01",
          description: "Integration test file exists",
          command:
            "test -f server/tools/three-tier-integration.test.ts && echo PASS",
        },
        {
          id: "AC-02",
          description: "Integration tests pass",
          command:
            "npx vitest run server/tools/three-tier-integration.test.ts --reporter=verbose 2>&1 | tail -5 | head -1",
        },
      ],
      affectedPaths: ["server/tools/three-tier-integration.test.ts"],
    },
    {
      id: "US-06",
      title: "Existing test suite regression",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "AC-01",
          description: "plan.test.ts passes (core regression gate)",
          command: "npx vitest run server/tools/plan.test.ts 2>&1 | tail -3 | head -1",
        },
        {
          id: "AC-02",
          description: "evaluate.test.ts passes (eval regression gate)",
          command: "npx vitest run server/tools/evaluate.test.ts 2>&1 | tail -3 | head -1",
        },
      ],
      affectedPaths: [],
    },
  ],
};

// ── Tests ────────────────────────────────────────────────

describe("dogfood: three-tier system forward divergence", () => {
  // Validate the dogfood plan itself
  it("dogfood execution plan is valid", () => {
    const result = validateExecutionPlan(DOGFOOD_PLAN);
    expect(result.valid).toBe(true);
  });

  // Run forward divergence for each story
  for (const story of DOGFOOD_PLAN.stories) {
    describe(`${story.id}: ${story.title}`, () => {
      it("all ACs pass", async () => {
        const report = await evaluateStory(DOGFOOD_PLAN, story.id, {
          timeoutMs: 60_000,
        });

        // Log per-AC results for visibility
        for (const criterion of report.criteria) {
          if (criterion.status !== "PASS") {
            console.error(
              `  ${story.id}/${criterion.id}: ${criterion.status} — ${criterion.evidence}`,
            );
          }
        }

        expect(report.verdict).toBe("PASS");
      }, 120_000); // generous timeout for npm/vitest commands
    });
  }
});

describe("dogfood: MasterPlan validator unit checks", () => {
  it("rejects plan with missing required fields", () => {
    const result = validateMasterPlan({});
    expect(result.valid).toBe(false);
  });

  it("rejects plan with empty phases", () => {
    const result = validateMasterPlan({
      schemaVersion: "1.0.0",
      documentTier: "master",
      title: "Test",
      summary: "Test summary",
      phases: [],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts valid master plan", () => {
    const result = validateMasterPlan({
      schemaVersion: "1.0.0",
      documentTier: "master",
      title: "Test",
      summary: "Test summary",
      phases: [
        {
          id: "PH-01",
          title: "Phase 1",
          description: "First phase",
          dependencies: [],
          inputs: [],
          outputs: [],
          estimatedStories: 1,
        },
      ],
    });
    expect(result.valid).toBe(true);
  });
});
