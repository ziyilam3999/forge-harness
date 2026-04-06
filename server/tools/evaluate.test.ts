import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallClaudeResult } from "../lib/anthropic.js";

// Mock the evaluator
vi.mock("../lib/evaluator.js", () => ({
  evaluateStory: vi.fn(),
}));

// Mock anthropic — extractJson and callClaude
vi.mock("../lib/anthropic.js", () => ({
  callClaude: vi.fn(),
  extractJson: vi.fn((text: string) => JSON.parse(text)),
}));

// Mock codebase-scan
vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn(async () => "## Directory Structure\n```\nserver/\nsrc/\n```"),
}));

// Mock run-record — don't write real files during tests
vi.mock("../lib/run-record.js", () => ({
  writeRunRecord: vi.fn(async () => {}),
}));

// Mock run-context — trackedCallClaude delegates to the mocked callClaude
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
    toolName = "forge_evaluate";

    constructor() {
      const self = this;
      this.cost.summarize = () => ({
        inputTokens: self._inputTokens,
        outputTokens: self._outputTokens,
        estimatedCostUsd: 0.001,
        breakdown: [],
        isOAuthAuth: false,
      });
    }
  }

  return {
    RunContext: MockRunContext,
    trackedCallClaude: vi.fn(
      async (ctx: any, _stage: string, _role: string, options: any) => {
        const result = await mockedClaude(options);
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
import { evaluateStory } from "../lib/evaluator.js";
import { callClaude } from "../lib/anthropic.js";
import { scanCodebase } from "../lib/codebase-scan.js";
import { writeRunRecord } from "../lib/run-record.js";
import { handleEvaluate } from "./evaluate.js";
import type { EvalReport } from "../types/eval-report.js";

const mockedEvaluateStory = vi.mocked(evaluateStory);
const mockedCallClaude = vi.mocked(callClaude);
const mockedScanCodebase = vi.mocked(scanCodebase);
const mockedWriteRunRecord = vi.mocked(writeRunRecord);

function makeValidPlanJson(): string {
  return JSON.stringify({
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-01",
        title: "Test story",
        acceptanceCriteria: [
          { id: "AC-01", description: "Check", command: "echo ok" },
        ],
      },
    ],
  });
}

function makeEvalReport(overrides?: Partial<EvalReport>): EvalReport {
  return {
    storyId: "US-01",
    verdict: "PASS",
    criteria: [{ id: "AC-01", status: "PASS", evidence: "ok" }],
    ...overrides,
  };
}

function makeCallResult(data: unknown): CallClaudeResult {
  return {
    text: JSON.stringify(data),
    parsed: data,
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Story Mode (backward-compatible existing tests) ───────

describe("handleEvaluate — story mode", () => {
  it("returns eval report as JSON in MCP response", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const report = JSON.parse(result.content[0].text);
    expect(report.storyId).toBe("US-01");
    expect(report.verdict).toBe("PASS");
    expect(report.criteria).toHaveLength(1);
  });

  it("defaults to story mode when evaluationMode is omitted", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
    });

    expect(result.isError).toBeUndefined();
    const report = JSON.parse(result.content[0].text);
    expect(report.verdict).toBe("PASS");
  });

  it("works with explicit evaluationMode: story", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "story",
      storyId: "US-01",
      planJson: makeValidPlanJson(),
    });

    expect(result.isError).toBeUndefined();
  });

  it("returns error when neither planPath nor planJson provided", async () => {
    const result = await handleEvaluate({ storyId: "US-01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Either planPath or planJson is required");
  });

  it("returns error for invalid plan JSON", async () => {
    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: "not json",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid plan JSON");
  });

  it("returns error when plan fails validation", async () => {
    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: JSON.stringify({ schemaVersion: "1.0.0", stories: [] }),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid execution plan");
  });

  it("returns error when story not found", async () => {
    mockedEvaluateStory.mockRejectedValueOnce(
      new Error("Story 'US-99' not found in plan"),
    );

    const result = await handleEvaluate({
      storyId: "US-99",
      planJson: makeValidPlanJson(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Story 'US-99' not found");
  });

  it("passes timeoutMs to evaluateStory", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      timeoutMs: 5000,
    });

    expect(mockedEvaluateStory).toHaveBeenCalledWith(
      expect.anything(),
      "US-01",
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it("planJson takes precedence over planPath", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const result = await handleEvaluate({
      storyId: "US-01",
      planPath: "/nonexistent/path.json",
      planJson: makeValidPlanJson(),
    });

    expect(result.isError).toBeUndefined();
  });

  it("returns error for planPath to nonexistent file", async () => {
    const result = await handleEvaluate({
      storyId: "US-01",
      planPath: "/nonexistent/path.json",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Plan file not found");
  });

  it("returns FAIL verdict in report", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        verdict: "FAIL",
        criteria: [{ id: "AC-01", status: "FAIL", evidence: "error output" }],
      }),
    );

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.verdict).toBe("FAIL");
  });

  it("returns error when storyId is missing in story mode", async () => {
    const result = await handleEvaluate({
      evaluationMode: "story",
      planJson: makeValidPlanJson(),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("storyId is required");
  });
});

// ── Discriminated Schema Routing ──────────────────────────

describe("discriminated schema routing", () => {
  it("story mode ignores prdContent", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "story",
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      prdContent: "This should be ignored in story mode",
    });

    expect(result.isError).toBeUndefined();
    // Should not have called callClaude (LLM) — story mode is mechanical
    expect(mockedCallClaude).not.toHaveBeenCalled();
  });

  it("coherence mode requires prdContent", async () => {
    const result = await handleEvaluate({
      evaluationMode: "coherence",
      // prdContent missing
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("prdContent is required");
  });

  it("coherence mode does not require storyId", async () => {
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ gaps: [], summary: "All aligned." }),
    );

    const result = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a thing",
    });

    expect(result.isError).toBeUndefined();
  });

  it("divergence mode requires plan", async () => {
    const result = await handleEvaluate({
      evaluationMode: "divergence",
      // no planPath or planJson
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("planPath or planJson is required");
  });
});

// ── Coherence Mode ────────────────────────────────────────

describe("handleEvaluate — coherence mode", () => {
  it("detects gaps between PRD and master plan", async () => {
    const coherenceResult = {
      gaps: [
        {
          id: "GAP-01",
          severity: "CRITICAL",
          sourceDocument: "prd",
          targetDocument: "masterPlan",
          description: "PRD requires user authentication, but no phase covers auth",
          missingRequirement: "User authentication with OAuth2",
        },
      ],
      summary: "1 critical gap: authentication missing from master plan",
    };

    mockedCallClaude.mockResolvedValueOnce(makeCallResult(coherenceResult));

    const result = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a system with user authentication via OAuth2",
      masterPlanContent: JSON.stringify({
        schemaVersion: "1.0.0",
        documentTier: "master",
        title: "Build system",
        summary: "Build a system",
        phases: [
          { id: "PH-01", title: "Database", description: "Set up DB", dependencies: [], inputs: [], outputs: [], estimatedStories: 2 },
        ],
      }),
    });

    expect(result.isError).toBeUndefined();
    const report = JSON.parse(result.content[0].text);
    expect(report.evaluationMode).toBe("coherence");
    expect(report.status).toBe("complete");
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0].severity).toBe("CRITICAL");
    expect(report.gaps[0].sourceDocument).toBe("prd");
    expect(report.gaps[0].targetDocument).toBe("masterPlan");
  });

  it("detects gaps between master plan and phase plan", async () => {
    const coherenceResult = {
      gaps: [
        {
          id: "GAP-01",
          severity: "MAJOR",
          sourceDocument: "masterPlan",
          targetDocument: "phasePlan",
          description: "Phase PH-01 declares output 'server/types/' but stories do not produce types",
          missingRequirement: "Type definitions output",
        },
      ],
      summary: "1 major gap in phase plan PH-01",
    };

    mockedCallClaude.mockResolvedValueOnce(makeCallResult(coherenceResult));

    const result = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a typed API",
      masterPlanContent: JSON.stringify({
        phases: [
          { id: "PH-01", title: "Types", outputs: ["server/types/"] },
        ],
      }),
      phasePlans: [
        {
          phaseId: "PH-01",
          content: JSON.stringify({
            schemaVersion: "3.0.0",
            stories: [{ id: "US-01", title: "Set up build" }],
          }),
        },
      ],
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0].sourceDocument).toBe("masterPlan");
    expect(report.gaps[0].targetDocument).toBe("phasePlan");
  });

  it("returns no gaps when tiers are aligned", async () => {
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ gaps: [], summary: "All tiers are aligned." }),
    );

    const result = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a thing",
      masterPlanContent: '{"phases": []}',
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.status).toBe("complete");
    expect(report.gaps).toHaveLength(0);
  });

  it("returns eval-failed status on LLM error (does not crash)", async () => {
    mockedCallClaude.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const result = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a thing",
    });

    // Should NOT have isError — graceful degradation
    expect(result.isError).toBeUndefined();
    const report = JSON.parse(result.content[0].text);
    expect(report.evaluationMode).toBe("coherence");
    expect(report.status).toBe("eval-failed");
    expect(report.gaps).toEqual([]);
    expect(report.summary).toContain("failed");
  });

  it("passes PRD, master plan, and phase plans to the LLM prompt", async () => {
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ gaps: [], summary: "OK" }),
    );

    await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "My PRD content here",
      masterPlanContent: '{"master": "plan"}',
      phasePlans: [{ phaseId: "PH-01", content: '{"phase": "plan"}' }],
    });

    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
    const callArgs = mockedCallClaude.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("My PRD content here");
    expect(callArgs.messages[0].content).toContain("Master Plan");
    expect(callArgs.messages[0].content).toContain("Phase PH-01");
  });

  it("writes run record when projectPath is provided", async () => {
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({
        gaps: [{ id: "GAP-01", severity: "MINOR", sourceDocument: "prd", targetDocument: "masterPlan", description: "d", missingRequirement: "r" }],
        summary: "1 gap",
      }),
    );

    await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a thing",
      projectPath: "/some/path",
    });

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [projectPath, record] = mockedWriteRunRecord.mock.calls[0];
    expect(projectPath).toBe("/some/path");
    expect(record.tool).toBe("forge_evaluate");
    expect(record.metrics.findingsTotal).toBe(1);
  });
});

// ── Divergence Mode ───────────────────────────────────────

describe("handleEvaluate — divergence mode", () => {
  it("detects forward divergence (AC failures)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        storyId: "US-01",
        verdict: "FAIL",
        criteria: [
          { id: "AC-01", status: "FAIL", evidence: "exit code 1" },
          { id: "AC-02", status: "PASS", evidence: "ok" },
        ],
      }),
    );

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.evaluationMode).toBe("divergence");
    expect(report.status).toBe("complete");
    expect(report.forward).toHaveLength(1);
    expect(report.forward[0].storyId).toBe("US-01");
    expect(report.forward[0].acId).toBe("AC-01");
    expect(report.forward[0].status).toBe("FAIL");
  });

  it("detects reverse divergence (unplanned capabilities) via LLM", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const reverseResult = {
      reverse: [
        {
          id: "REV-01",
          description: "Codebase has a WebSocket server not mentioned in any story",
          location: "server/ws.ts",
          classification: "extra-functionality",
          alignsWithPrd: false,
        },
      ],
      summary: "1 unplanned capability found",
    };
    mockedCallClaude.mockResolvedValueOnce(makeCallResult(reverseResult));

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.reverse).toHaveLength(1);
    expect(report.reverse[0].id).toBe("REV-01");
    expect(report.reverse[0].classification).toBe("extra-functionality");
    expect(report.reverse[0].alignsWithPrd).toBe(false);
  });

  it("skips reverse scan when projectPath is not provided", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      // no projectPath
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.reverse).toHaveLength(0);
    expect(mockedCallClaude).not.toHaveBeenCalled();
    expect(mockedScanCodebase).not.toHaveBeenCalled();
  });

  it("handles reverse scan LLM failure gracefully", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());
    mockedCallClaude.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    // Should NOT crash
    expect(result.isError).toBeUndefined();
    const report = JSON.parse(result.content[0].text);
    expect(report.status).toBe("complete");
    expect(report.reverse).toHaveLength(0);
    expect(report.summary).toContain("failed");
  });

  it("evaluates all stories in the plan for forward divergence", async () => {
    const multiStoryPlan = JSON.stringify({
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "Story 1",
          acceptanceCriteria: [
            { id: "AC-01", description: "Check 1", command: "echo ok" },
          ],
        },
        {
          id: "US-02",
          title: "Story 2",
          dependencies: ["US-01"],
          acceptanceCriteria: [
            { id: "AC-01", description: "Check 2", command: "echo ok" },
          ],
        },
      ],
    });

    mockedEvaluateStory
      .mockResolvedValueOnce(
        makeEvalReport({ storyId: "US-01", verdict: "PASS" }),
      )
      .mockResolvedValueOnce(
        makeEvalReport({
          storyId: "US-02",
          verdict: "FAIL",
          criteria: [{ id: "AC-01", status: "FAIL", evidence: "broken" }],
        }),
      );

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: multiStoryPlan,
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.forward).toHaveLength(1);
    expect(report.forward[0].storyId).toBe("US-02");
    expect(mockedEvaluateStory).toHaveBeenCalledTimes(2);
  });

  it("handles evaluateStory throwing for a story", async () => {
    mockedEvaluateStory.mockRejectedValueOnce(
      new Error("Command not found"),
    );

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.forward).toHaveLength(1);
    expect(report.forward[0].acId).toBe("EVAL-ERROR");
    expect(report.forward[0].status).toBe("INCONCLUSIVE");
  });

  it("writes run record with total divergence count", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        verdict: "FAIL",
        criteria: [{ id: "AC-01", status: "FAIL", evidence: "fail" }],
      }),
    );
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({
        reverse: [
          { id: "REV-01", description: "d", location: "f", classification: "extra-functionality", alignsWithPrd: true },
        ],
        summary: "1 reverse",
      }),
    );

    await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [, record] = mockedWriteRunRecord.mock.calls[0];
    expect(record.metrics.findingsTotal).toBe(2); // 1 forward + 1 reverse
  });

  it("passes prdContent to divergence eval for alignment checking", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ reverse: [], summary: "OK" }),
    );

    await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
      prdContent: "The original vision document",
    });

    const callArgs = mockedCallClaude.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("The original vision document");
  });
});

// ── Self-Healing Cycle Tracking ───────────────────────────

describe("self-healing cycle support", () => {
  it("report includes selfHealingCycles and maxCyclesReached fields", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
    });

    const report = JSON.parse(result.content[0].text);
    expect(report).toHaveProperty("selfHealingCycles");
    expect(report).toHaveProperty("maxCyclesReached");
    expect(typeof report.selfHealingCycles).toBe("number");
    expect(typeof report.maxCyclesReached).toBe("boolean");
  });

  it("accepts maxSelfHealingCycles parameter", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    // Should not throw
    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      maxSelfHealingCycles: 0, // disable self-healing
    });

    expect(result.isError).toBeUndefined();
  });
});
