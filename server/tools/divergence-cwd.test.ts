import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (same pattern as evaluate.test.ts) ──

vi.mock("../lib/evaluator.js", () => ({
  evaluateStory: vi.fn(),
}));

vi.mock("../lib/anthropic.js", () => ({
  callClaude: vi.fn(),
  extractJson: vi.fn((text: string) => JSON.parse(text)),
}));

vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn(async () => "## Directory Structure\n```\nserver/\n```"),
}));

vi.mock("../lib/run-record.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/run-record.js")>(
    "../lib/run-record.js",
  );
  return {
    writeRunRecord: vi.fn(async () => {}),
    canonicalizeEvalReport: actual.canonicalizeEvalReport,
  };
});

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
import { handleEvaluate } from "./evaluate.js";
import type { EvalReport } from "../types/eval-report.js";

const mockedEvaluateStory = vi.mocked(evaluateStory);

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── BUG-DIV-CWD Regression ─────────────────────────────────

describe("BUG-DIV-CWD: divergence mode passes cwd to evaluateStory", () => {
  it("passes projectPath as cwd to evaluateStory for each story in forward eval", async () => {
    mockedEvaluateStory.mockResolvedValue(makeEvalReport());

    await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/my/project",
    });

    // evaluateStory should have been called with cwd in the options
    expect(mockedEvaluateStory).toHaveBeenCalledWith(
      expect.anything(), // plan
      "US-01", // story id
      expect.objectContaining({ cwd: "/my/project" }),
    );
  });
});

// ── reverseFindings Input Tests ─────────────────────────────

describe("handleEvaluate — divergence mode reverseFindings", () => {
  const validFindings = JSON.stringify([
    {
      id: "REV-01",
      description: "Extra helper function",
      location: "server/lib/utils.ts",
      classification: "extra-functionality",
      alignsWithPrd: false,
    },
    {
      id: "REV-02",
      description: "Different sort algorithm",
      location: "server/lib/topo-sort.ts",
      classification: "method-divergence",
      alignsWithPrd: true,
    },
  ]);

  it("accepts valid reverseFindings and includes them in the report", async () => {
    mockedEvaluateStory.mockResolvedValue(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/my/project",
      reverseFindings: validFindings,
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.reverse).toHaveLength(2);
    // Q0/L2: reverseFindings[].id is overwritten with deterministic hash
    expect(report.reverse[0].id).toMatch(/^rev-[a-f0-9]{12}$/);
    expect(report.reverse[1].classification).toBe("method-divergence");
    expect(report.summary).toContain("2 pre-computed reverse finding(s)");
  });

  it("rejects invalid JSON with parse-failure summary", async () => {
    mockedEvaluateStory.mockResolvedValue(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/my/project",
      reverseFindings: "not valid json{{{",
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.reverse).toHaveLength(0);
    expect(report.summary).toContain("reverseFindings parse failed");
  });

  it("rejects malformed shape (missing required fields)", async () => {
    mockedEvaluateStory.mockResolvedValue(makeEvalReport());

    const malformed = JSON.stringify([
      { id: "REV-01", description: "Missing fields" },
    ]);

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/my/project",
      reverseFindings: malformed,
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.reverse).toHaveLength(0);
    expect(report.summary).toContain("missing required field");
  });

  it("rejects invalid classification enum value", async () => {
    mockedEvaluateStory.mockResolvedValue(makeEvalReport());

    const badEnum = JSON.stringify([
      {
        id: "REV-01",
        description: "Bad enum",
        location: "server/foo.ts",
        classification: "invalid-value",
        alignsWithPrd: true,
      },
    ]);

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/my/project",
      reverseFindings: badEnum,
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.reverse).toHaveLength(0);
    expect(report.summary).toContain("invalid classification");
  });

  it("handles empty array as explicit 'no findings' claim", async () => {
    mockedEvaluateStory.mockResolvedValue(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/my/project",
      reverseFindings: "[]",
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.reverse).toHaveLength(0);
    expect(report.summary).toContain("0 pre-computed reverse finding(s)");
    // Distinguishable from "no analysis performed" — should NOT say "No codebase context"
    expect(report.summary).not.toContain("No codebase context");
  });

  it("reverseFindings takes precedence over projectPath LLM scan", async () => {
    mockedEvaluateStory.mockResolvedValue(makeEvalReport());

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/my/project",
      reverseFindings: validFindings,
    });

    const report = JSON.parse(result.content[0].text);
    // Should use pre-computed findings, NOT run the LLM scan
    expect(report.reverse).toHaveLength(2);
    expect(report.summary).toContain("pre-computed");
    // scanCodebase should NOT have been called (LLM path skipped)
    const { scanCodebase } = await import("../lib/codebase-scan.js");
    expect(vi.mocked(scanCodebase)).not.toHaveBeenCalled();
  });
});
