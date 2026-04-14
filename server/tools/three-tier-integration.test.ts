/**
 * Integration test for the full 3-tier document flow:
 *   PRD (vision doc) → forge_plan(master) → forge_plan(phase) → forge_evaluate(coherence)
 *
 * All LLM calls are mocked. The test verifies that:
 * 1. The output of each stage is valid input for the next stage
 * 2. The data flows correctly through the pipeline
 * 3. Coherence eval detects gaps when tiers are misaligned
 * 4. The full pipeline succeeds when tiers are aligned
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallClaudeResult } from "../lib/anthropic.js";
import { extractPlanJson, findCallByContent } from "../lib/test-utils.js";

// ── Mocks (same pattern as plan.test.ts / evaluate.test.ts) ──

vi.mock("../lib/anthropic.js", () => ({
  callClaude: vi.fn(),
  extractJson: vi.fn((text: string) => JSON.parse(text)),
}));

vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn(async () => "## Directory Structure\n```\nserver/\nsrc/\n```"),
}));

vi.mock("../lib/run-record.js", () => ({
  writeRunRecord: vi.fn(async () => {}),
}));

vi.mock("../lib/evaluator.js", () => ({
  evaluateStory: vi.fn(),
}));

vi.mock("../lib/run-context.js", async () => {
  const { callClaude: mockedClaude } = await import("../lib/anthropic.js");

  class MockRunContext {
    _inputTokens = 0;
    _outputTokens = 0;
    cost = {
      summarize: () => ({
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0.001,
        breakdown: [],
        isOAuthAuth: false,
      }),
      recordUsage: vi.fn(),
    };
    progress = {
      begin: vi.fn(),
      complete: vi.fn(),
      skip: vi.fn(),
      fail: vi.fn(),
      getResults: () => [],
    };
    audit = { log: vi.fn(async () => {}) };
    toolName = "forge_plan";

    constructor() {
      this.cost.summarize = () => ({
        inputTokens: this._inputTokens,
        outputTokens: this._outputTokens,
        estimatedCostUsd: 0.001,
        breakdown: [],
        isOAuthAuth: false,
      });
    }
  }

  return {
    RunContext: MockRunContext,
    trackedCallClaude: vi.fn(
      async (
        ctx: { _inputTokens?: number; _outputTokens?: number } | null,
        _stage: string,
        _role: string,
        options: unknown,
      ) => {
        const result = await mockedClaude(
          options as Parameters<typeof mockedClaude>[0],
        );
        if (ctx && result.usage) {
          ctx._inputTokens =
            (ctx._inputTokens ?? 0) + result.usage.inputTokens;
          ctx._outputTokens =
            (ctx._outputTokens ?? 0) + result.usage.outputTokens;
        }
        return result;
      },
    ),
  };
});

// Import after mocks
const { callClaude } = await import("../lib/anthropic.js");
const { handlePlan } = await import("./plan.js");
const { handleEvaluate } = await import("./evaluate.js");

const mockedCallClaude = vi.mocked(callClaude);

// ── Test Fixtures ────────────────────────────────────────

const VISION_DOC = `
# Product Requirements Document: Forge Harness Improvement

## Problem
forge_plan produces monolithic plans that try to be both vision and spec, causing ~35% divergence.

## Objective
Build a three-tier document system: PRD → Master Plan → Phase Plans.

## Requirements
- R1: Master plan decomposes PRD into sequenced phases
- R2: Each phase produces an execution plan with stories and ACs
- R3: Coherence evaluation validates alignment between all tiers
- R4: Cost estimation tracks token usage across all primitives

## Success Criteria
- Divergence count drops below 93 baseline
- All phases have binary, testable ACs
`;

function makeCallResult(data: unknown): CallClaudeResult {
  return {
    text: JSON.stringify(data),
    parsed: data,
    usage: { inputTokens: 200, outputTokens: 100 },
  };
}

function makeMasterPlan() {
  return {
    schemaVersion: "1.0.0",
    documentTier: "master",
    title: "Three-Tier Document System",
    summary:
      "Decompose forge_plan into a three-tier system with master plans, phase plans, and coherence evaluation.",
    phases: [
      {
        id: "PH-01",
        title: "Types and Validation",
        description:
          "Create MasterPlan types and validation. Covers R1 (phase decomposition schema).",
        dependencies: [],
        inputs: [],
        outputs: ["server/types/master-plan.ts", "server/validation/master-plan.ts"],
        estimatedStories: 2,
      },
      {
        id: "PH-02",
        title: "Tier-Aware Pipeline",
        description:
          "Add documentTier routing to forge_plan. Covers R2 (execution plans per phase).",
        dependencies: ["PH-01"],
        inputs: ["server/types/master-plan.ts"],
        outputs: ["server/tools/plan.ts"],
        estimatedStories: 3,
      },
      {
        id: "PH-03",
        title: "Coherence Evaluation",
        description:
          "Add coherence mode to forge_evaluate. Covers R3 (tier alignment).",
        dependencies: ["PH-01"],
        inputs: ["server/types/master-plan.ts"],
        outputs: ["server/tools/evaluate.ts"],
        estimatedStories: 2,
      },
      {
        id: "PH-04",
        title: "Cross-Cutting Observability",
        description:
          "Add cost tracking to all primitives. Covers R4 (token usage).",
        dependencies: [],
        inputs: [],
        outputs: ["server/lib/cost.ts", "server/lib/run-context.ts"],
        estimatedStories: 2,
      },
    ],
    crossCuttingConcerns: ["Test coverage", "Backward compatibility"],
  };
}

function makePhasePlan(phaseId: string) {
  return {
    schemaVersion: "3.0.0",
    documentTier: "phase",
    phaseId,
    stories: [
      {
        id: "US-01",
        title: "Create MasterPlan type definition",
        dependencies: [],
        acceptanceCriteria: [
          {
            id: "AC-01",
            description: "MasterPlan type compiles without errors",
            command: "npx tsc --noEmit server/types/master-plan.ts && echo PASS",
          },
          {
            id: "AC-02",
            description: "MasterPlan has required fields: schemaVersion, documentTier, title, summary, phases",
            command:
              "node -e \"const m = require('./server/types/master-plan.js'); console.log('PASS')\"",
          },
        ],
        affectedPaths: ["server/types/master-plan.ts"],
      },
      {
        id: "US-02",
        title: "Create MasterPlan validator",
        dependencies: ["US-01"],
        acceptanceCriteria: [
          {
            id: "AC-01",
            description: "Validator rejects plan with empty phases array",
            command:
              'node -e "const v = require(\'./server/validation/master-plan.js\'); const r = v.validateMasterPlan({schemaVersion:\'1.0.0\',documentTier:\'master\',title:\'t\',summary:\'s\',phases:[]}); console.log(!r.valid ? \'PASS\' : \'FAIL\')"',
          },
        ],
        affectedPaths: ["server/validation/master-plan.ts"],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Integration Tests ────────────────────────────────────

describe("three-tier integration: PRD → master → phase → coherence", () => {
  it("full pipeline: master plan output feeds into phase plan, both feed into coherence eval", async () => {
    const masterPlan = makeMasterPlan();
    const phasePlan = makePhasePlan("PH-01");

    // ── Stage 1: PRD → Master Plan ──
    // planner returns master plan (quick tier = 1 call)
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(masterPlan));

    const masterResult = await handlePlan({
      intent: "Build three-tier document system",
      documentTier: "master",
      visionDoc: VISION_DOC,
      tier: "quick",
    });

    // Verify master plan was produced
    expect((masterResult as { isError?: boolean }).isError).toBeUndefined();
    expect(masterResult.content[0].text).toContain("MASTER PLAN");
    expect(masterResult.content[0].text).toContain('"schemaVersion": "1.0.0"');

    // Extract the master plan JSON from the output
    const masterPlanJson = extractPlanJson(masterResult.content[0].text);
    const parsedMaster = JSON.parse(masterPlanJson);
    expect(parsedMaster.phases).toHaveLength(4);
    expect(parsedMaster.phases[0].id).toBe("PH-01");

    // ── Stage 2: Master Plan + PRD → Phase Plan (PH-01) ──
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(phasePlan));

    const phaseResult = await handlePlan({
      intent: "Expand PH-01: Types and Validation",
      documentTier: "phase",
      visionDoc: VISION_DOC,
      masterPlan: masterPlanJson,
      phaseId: "PH-01",
      tier: "quick",
    });

    // Verify phase plan was produced
    expect((phaseResult as { isError?: boolean }).isError).toBeUndefined();
    expect(phaseResult.content[0].text).toContain("PHASE PLAN (PH-01)");
    expect(phaseResult.content[0].text).toContain('"schemaVersion": "3.0.0"');

    // Extract the phase plan JSON
    const phasePlanJson = extractPlanJson(phaseResult.content[0].text);
    const parsedPhase = JSON.parse(phasePlanJson);
    expect(parsedPhase.stories).toHaveLength(2);

    // ── Stage 3: Coherence Eval (PRD ↔ Master ↔ Phase) ──
    const coherenceResult = {
      gaps: [],
      summary: "All tiers are aligned. R1 (phase decomposition) is covered by PH-01 stories.",
    };
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(coherenceResult));

    const evalResult = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: VISION_DOC,
      masterPlanContent: masterPlanJson,
      phasePlans: [{ phaseId: "PH-01", content: phasePlanJson }],
    });

    // Verify coherence eval succeeded with no gaps
    expect((evalResult as { isError?: boolean }).isError).toBeUndefined();
    const evalReport = JSON.parse(evalResult.content[0].text);
    expect(evalReport.evaluationMode).toBe("coherence");
    expect(evalReport.status).toBe("complete");
    expect(evalReport.gaps).toHaveLength(0);

    // Verify the coherence LLM call received all three tiers
    const coherenceCall = findCallByContent(mockedCallClaude.mock.calls, [
      "Product Requirements Document",
      "Master Plan",
      "Phase PH-01",
    ]);
    expect(coherenceCall.messages[0].content).toContain("Product Requirements Document");
    expect(coherenceCall.messages[0].content).toContain("Master Plan");
    expect(coherenceCall.messages[0].content).toContain("Phase PH-01");
  });

  it("coherence eval detects gaps when phase plan misses master plan requirements", async () => {
    const masterPlan = makeMasterPlan();

    // Phase plan that misses the validator story (only has type definition)
    const incompletePhasePlan = {
      schemaVersion: "3.0.0",
      documentTier: "phase",
      phaseId: "PH-01",
      stories: [
        {
          id: "US-01",
          title: "Create MasterPlan type definition",
          dependencies: [],
          acceptanceCriteria: [
            { id: "AC-01", description: "Type compiles", command: "npx tsc --noEmit && echo PASS" },
          ],
          affectedPaths: ["server/types/master-plan.ts"],
        },
        // US-02 (validator) is MISSING — should be caught by coherence eval
      ],
    };

    // Stage 1: master plan
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(masterPlan));
    const masterResult = await handlePlan({
      intent: "Build three-tier document system",
      documentTier: "master",
      visionDoc: VISION_DOC,
      tier: "quick",
    });
    const masterPlanJson = extractPlanJson(masterResult.content[0].text);

    // Stage 2: incomplete phase plan
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(incompletePhasePlan));
    const phaseResult = await handlePlan({
      intent: "Expand PH-01",
      documentTier: "phase",
      visionDoc: VISION_DOC,
      masterPlan: masterPlanJson,
      phaseId: "PH-01",
      tier: "quick",
    });
    const phasePlanJson = extractPlanJson(phaseResult.content[0].text);

    // Stage 3: coherence eval detects missing validation coverage
    const coherenceWithGaps = {
      gaps: [
        {
          id: "GAP-01",
          severity: "MAJOR",
          sourceDocument: "masterPlan",
          targetDocument: "phasePlan",
          description:
            "PH-01 declares output 'server/validation/master-plan.ts' but no story covers validation",
          missingRequirement: "MasterPlan validator implementation",
        },
      ],
      summary: "1 major gap: validation story missing from PH-01",
    };
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(coherenceWithGaps));

    const evalResult = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: VISION_DOC,
      masterPlanContent: masterPlanJson,
      phasePlans: [{ phaseId: "PH-01", content: phasePlanJson }],
    });

    const evalReport = JSON.parse(evalResult.content[0].text);
    expect(evalReport.status).toBe("complete");
    expect(evalReport.gaps).toHaveLength(1);
    expect(evalReport.gaps[0].severity).toBe("MAJOR");
    expect(evalReport.gaps[0].sourceDocument).toBe("masterPlan");
    expect(evalReport.gaps[0].targetDocument).toBe("phasePlan");
    expect(evalReport.gaps[0].description).toContain("validation");
  });

  it("pipeline handles coherence eval LLM failure gracefully", async () => {
    const masterPlan = makeMasterPlan();
    const phasePlan = makePhasePlan("PH-01");

    // Stage 1 + 2 succeed
    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(masterPlan))
      .mockResolvedValueOnce(makeCallResult(phasePlan));

    const masterResult = await handlePlan({
      intent: "Build",
      documentTier: "master",
      visionDoc: VISION_DOC,
      tier: "quick",
    });
    const masterPlanJson = extractPlanJson(masterResult.content[0].text);

    const phaseResult = await handlePlan({
      intent: "Expand",
      documentTier: "phase",
      visionDoc: VISION_DOC,
      masterPlan: masterPlanJson,
      phaseId: "PH-01",
      tier: "quick",
    });
    const phasePlanJson = extractPlanJson(phaseResult.content[0].text);

    // Stage 3: LLM fails
    mockedCallClaude.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const evalResult = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: VISION_DOC,
      masterPlanContent: masterPlanJson,
      phasePlans: [{ phaseId: "PH-01", content: phasePlanJson }],
    });

    // Should degrade gracefully, not crash
    expect((evalResult as { isError?: boolean }).isError).toBeUndefined();
    const evalReport = JSON.parse(evalResult.content[0].text);
    expect(evalReport.evaluationMode).toBe("coherence");
    expect(evalReport.status).toBe("eval-failed");
    expect(evalReport.gaps).toEqual([]);
  });

  it("pipeline works with multiple phases evaluated together", async () => {
    const masterPlan = makeMasterPlan();
    const phase01Plan = makePhasePlan("PH-01");
    const phase04Plan = {
      schemaVersion: "3.0.0",
      documentTier: "phase",
      phaseId: "PH-04",
      stories: [
        {
          id: "US-01",
          title: "Create CostTracker",
          dependencies: [],
          acceptanceCriteria: [
            {
              id: "AC-01",
              description: "CostTracker reports tokens and estimated USD",
              command: "npx vitest run server/lib/cost.test.ts && echo PASS",
            },
          ],
          affectedPaths: ["server/lib/cost.ts"],
        },
      ],
    };

    // Stage 1: master plan
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(masterPlan));
    const masterResult = await handlePlan({
      intent: "Build",
      documentTier: "master",
      visionDoc: VISION_DOC,
      tier: "quick",
    });
    const masterPlanJson = extractPlanJson(masterResult.content[0].text);

    // Stage 2a: phase PH-01
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(phase01Plan));
    const ph01Result = await handlePlan({
      intent: "Expand PH-01",
      documentTier: "phase",
      visionDoc: VISION_DOC,
      masterPlan: masterPlanJson,
      phaseId: "PH-01",
      tier: "quick",
    });
    const ph01Json = extractPlanJson(ph01Result.content[0].text);

    // Stage 2b: phase PH-04 (no dependency on PH-01)
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(phase04Plan));
    const ph04Result = await handlePlan({
      intent: "Expand PH-04",
      documentTier: "phase",
      visionDoc: VISION_DOC,
      masterPlan: masterPlanJson,
      phaseId: "PH-04",
      tier: "quick",
    });
    const ph04Json = extractPlanJson(ph04Result.content[0].text);

    // Stage 3: coherence eval with both phases
    const coherenceResult = {
      gaps: [],
      summary: "Both phases PH-01 and PH-04 align with master plan and PRD.",
    };
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(coherenceResult));

    const evalResult = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: VISION_DOC,
      masterPlanContent: masterPlanJson,
      phasePlans: [
        { phaseId: "PH-01", content: ph01Json },
        { phaseId: "PH-04", content: ph04Json },
      ],
    });

    const evalReport = JSON.parse(evalResult.content[0].text);
    expect(evalReport.status).toBe("complete");
    expect(evalReport.gaps).toHaveLength(0);

    // Verify both phases were included in the LLM prompt
    const coherenceCall = findCallByContent(mockedCallClaude.mock.calls, [
      "Phase PH-01",
      "Phase PH-04",
    ]);
    expect(coherenceCall.messages[0].content).toContain("Phase PH-01");
    expect(coherenceCall.messages[0].content).toContain("Phase PH-04");
  });

  it("master plan output passes schema validation end-to-end", async () => {
    const masterPlan = makeMasterPlan();
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(masterPlan));

    const result = await handlePlan({
      intent: "Build",
      documentTier: "master",
      visionDoc: VISION_DOC,
      tier: "quick",
    });

    // Extract and re-parse to verify it's valid JSON that could be passed to next stage
    const parsed = JSON.parse(extractPlanJson(result.content[0].text));

    // Verify master plan structural invariants
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.documentTier).toBe("master");
    expect(parsed.title).toBeTruthy();
    expect(parsed.summary).toBeTruthy();
    expect(parsed.phases.length).toBeGreaterThan(0);

    // Verify every phase has required fields (these are what phase planner needs)
    for (const phase of parsed.phases) {
      expect(phase.id).toMatch(/^PH-\d+$/);
      expect(phase.title).toBeTruthy();
      expect(phase.description).toBeTruthy();
      expect(Array.isArray(phase.dependencies)).toBe(true);
      expect(Array.isArray(phase.inputs)).toBe(true);
      expect(Array.isArray(phase.outputs)).toBe(true);
      expect(phase.estimatedStories).toBeGreaterThan(0);
    }

    // Verify dependency references are valid
    const phaseIds = new Set(parsed.phases.map((p: { id: string }) => p.id));
    for (const phase of parsed.phases) {
      for (const dep of phase.dependencies) {
        expect(phaseIds.has(dep)).toBe(true);
      }
    }
  });

  it("phase plan output is valid ExecutionPlan that could be evaluated", async () => {
    const masterPlan = makeMasterPlan();
    const phasePlan = makePhasePlan("PH-01");

    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(masterPlan))
      .mockResolvedValueOnce(makeCallResult(phasePlan));

    // Generate master plan
    const masterResult = await handlePlan({
      intent: "Build",
      documentTier: "master",
      visionDoc: VISION_DOC,
      tier: "quick",
    });
    const masterPlanJson = extractPlanJson(masterResult.content[0].text);

    // Generate phase plan
    const phaseResult = await handlePlan({
      intent: "Expand PH-01",
      documentTier: "phase",
      visionDoc: VISION_DOC,
      masterPlan: masterPlanJson,
      phaseId: "PH-01",
      tier: "quick",
    });

    const parsed = JSON.parse(extractPlanJson(phaseResult.content[0].text));

    // Verify it's a valid ExecutionPlan v3.0.0
    expect(parsed.schemaVersion).toBe("3.0.0");
    expect(parsed.stories.length).toBeGreaterThan(0);

    // Verify every story has what evaluateStory needs
    for (const story of parsed.stories) {
      expect(story.id).toBeTruthy();
      expect(story.title).toBeTruthy();
      expect(story.acceptanceCriteria.length).toBeGreaterThan(0);
      for (const ac of story.acceptanceCriteria) {
        expect(ac.id).toBeTruthy();
        expect(ac.description).toBeTruthy();
        expect(ac.command).toBeTruthy();
      }
    }
  });
});
