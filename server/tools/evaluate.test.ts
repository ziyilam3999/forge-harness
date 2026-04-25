import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
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

// Mock run-record — don't write real files during tests, but keep
// canonicalizeEvalReport as the real implementation so the handler's
// deterministic-serialization path is exercised (PH01-US-00a AC08).
vi.mock("../lib/run-record.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/run-record.js")>(
    "../lib/run-record.js",
  );
  return {
    writeRunRecord: vi.fn(async () => {}),
    canonicalizeEvalReport: actual.canonicalizeEvalReport,
  };
});

// v0.36.0 Phase B — mock spec-generator so PASS-mode tests don't try to
// write to non-existent project paths (e.g. "/some/path"). The real
// integration is exercised by `server/lib/spec-generator.test.ts`.
vi.mock("../lib/spec-generator.js", () => ({
  generateSpecForStory: vi.fn(async (input: { projectPath: string; storyId: string }) => ({
    specPath: `${input.projectPath}/docs/generated/TECHNICAL-SPEC.md`,
    genTimestamp: "2026-04-25T00:00:00.000Z",
    genTokens: { inputTokens: 0, outputTokens: 0 },
    contracts: [],
    bodyChanged: true,
  })),
}));

// v0.36.0 Phase C — mock adr-extractor for the same reason (no real disk
// writes during evaluate.ts unit tests). Real integration tests live in
// `server/lib/adr-extractor.test.ts`.
vi.mock("../lib/adr-extractor.js", () => ({
  processStory: vi.fn((input: { projectPath: string; storyId: string }) => ({
    newAdrPaths: [],
    appendedNoDecisionsRow: false,
    indexPath: `${input.projectPath}/docs/decisions/INDEX.md`,
  })),
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

// ── PH01-US-00a: handleStoryEval RunContext + evalReport RunRecord ─────

describe("handleStoryEval RunContext infra (PH01-US-00a)", () => {
  it("writes a RunRecord whose evalReport is defined and matches input", async () => {
    const inputReport = makeEvalReport({
      verdict: "FAIL",
      criteria: [
        { id: "AC-02", status: "PASS", evidence: "two" },
        { id: "AC-01", status: "FAIL", evidence: "one" },
      ],
    });
    mockedEvaluateStory.mockResolvedValueOnce(inputReport);

    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [projectPath, record] = mockedWriteRunRecord.mock.calls[0];
    expect(projectPath).toBe("/some/path");
    expect(record.tool).toBe("forge_evaluate");
    expect(record.storyId).toBe("US-01");
    expect(record.evalVerdict).toBe("FAIL");
    expect(record.evalReport).toBeDefined();
    expect(record.evalReport!.criteria).toHaveLength(2);
    // Every criterion from the input is present in the written record
    const writtenIds = record.evalReport!.criteria.map((c) => c.id).sort();
    expect(writtenIds).toEqual(["AC-01", "AC-02"]);
    // estimatedCostUsd is populated (0 for story mode — no trackedCallClaude)
    expect(record.metrics.estimatedCostUsd).toBeDefined();
  });

  it("does not write a RunRecord when projectPath is omitted", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport());

    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      // no projectPath
    });

    expect(mockedWriteRunRecord).not.toHaveBeenCalled();
  });

  it("deterministic serialization: same EvalReport in different input order produces byte-identical evalReport field", async () => {
    const criterionA = { id: "AC-01", status: "FAIL" as const, evidence: "one" };
    const criterionB = { id: "AC-02", status: "PASS" as const, evidence: "two" };
    const criterionC = { id: "AC-03", status: "PASS" as const, evidence: "three" };

    mockedEvaluateStory
      .mockResolvedValueOnce(
        makeEvalReport({ criteria: [criterionA, criterionB, criterionC] }),
      )
      .mockResolvedValueOnce(
        makeEvalReport({ criteria: [criterionC, criterionA, criterionB] }),
      );

    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });
    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(2);
    const record1 = mockedWriteRunRecord.mock.calls[0][1];
    const record2 = mockedWriteRunRecord.mock.calls[1][1];

    // Byte-identical JSON output of the evalReport field across the two calls,
    // proving canonicalizeEvalReport's sort is applied deterministically.
    expect(JSON.stringify(record1.evalReport)).toBe(
      JSON.stringify(record2.evalReport),
    );
    // And the sort produced ascending id order regardless of input order.
    expect(record1.evalReport!.criteria.map((c) => c.id)).toEqual([
      "AC-01",
      "AC-02",
      "AC-03",
    ]);
  });
});

// ── v0.36.0 Phase B: spec-generator integration ───────────

import { generateSpecForStory } from "../lib/spec-generator.js";
const mockedGenerateSpec = vi.mocked(generateSpecForStory);

describe("handleStoryEval — v0.36.0 Phase B spec-generator integration", () => {
  it("invokes spec-generator on PASS and stamps generatedDocs into the RunRecord", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));

    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(mockedGenerateSpec).toHaveBeenCalledTimes(1);
    const args = mockedGenerateSpec.mock.calls[0][0];
    expect(args.projectPath).toBe("/some/path");
    expect(args.storyId).toBe("US-01");
    expect(args.evalReport.verdict).toBe("PASS");

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const record = mockedWriteRunRecord.mock.calls[0][1];
    expect(record.generatedDocs).toBeDefined();
    expect(record.generatedDocs!.specPath).toContain("TECHNICAL-SPEC.md");
    expect(record.generatedDocs!.adrPaths).toEqual([]);
    expect(record.generatedDocs!.genTimestamp).toBe("2026-04-25T00:00:00.000Z");
  });

  it("does NOT invoke spec-generator on FAIL verdict", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        verdict: "FAIL",
        criteria: [{ id: "AC-01", status: "FAIL", evidence: "broken" }],
      }),
    );

    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(mockedGenerateSpec).not.toHaveBeenCalled();
    const record = mockedWriteRunRecord.mock.calls[0][1];
    expect(record.generatedDocs).toBeUndefined();
  });

  it("does NOT invoke spec-generator when projectPath is missing (no RunRecord context)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));

    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      // no projectPath
    });

    expect(mockedGenerateSpec).not.toHaveBeenCalled();
  });

  it("swallows spec-generator failure and still writes the RunRecord (verdict not masked)", async () => {
    mockedGenerateSpec.mockRejectedValueOnce(new Error("synthetic spec-gen crash"));
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(result.isError).toBeUndefined();
    expect(mockedGenerateSpec).toHaveBeenCalledTimes(1);
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const record = mockedWriteRunRecord.mock.calls[0][1];
    // verdict still surfaced, generatedDocs absent
    expect(record.evalVerdict).toBe("PASS");
    expect(record.generatedDocs).toBeUndefined();
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

  it("coherence RunRecord contains numeric or null estimatedCostUsd (PH01-US-00b)", async () => {
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ gaps: [], summary: "All aligned." }),
    );

    await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a thing",
      projectPath: "/some/path",
    });

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [, record] = mockedWriteRunRecord.mock.calls[0];
    const cost = record.metrics.estimatedCostUsd;
    expect(cost === null || typeof cost === "number").toBe(true);
  });

  it("coherence spec-vocabulary-drift: PRD with invalid field reference produces VOCAB gap (PH04-US-05)", async () => {
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ gaps: [], summary: "All aligned." }),
    );

    const prdContent =
      "The `EvalReport.findings` should be sorted.\n" +
      "Also check `EvalReport.criteria` for valid fields.";

    const result = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent,
      projectPath: join(import.meta.dirname, "..", ".."),
    });

    expect(result.isError).toBeUndefined();
    const report = JSON.parse(result.content[0].text);
    expect(report.evaluationMode).toBe("coherence");

    const vocabGaps = report.gaps.filter((g: { id: string }) => g.id.startsWith("VOCAB"));
    expect(vocabGaps.length).toBeGreaterThanOrEqual(1);
    expect(vocabGaps[0].description).toContain("spec-vocabulary-drift");
    expect(vocabGaps[0].description).toContain("EvalReport");
    expect(vocabGaps[0].description).toContain("findings");
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

  // Q0.5/A3 — AC-A3-06: mixed-reliability forward split.
  // Three failing ACs (trusted-FAIL, suspect-SKIPPED, unverified-FAIL) land
  // in forward[] each carrying the correct reliability tag from the source
  // criterion.
  it("AC-A3-06: propagates reliability into ForwardDivergence entries", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        storyId: "US-01",
        verdict: "FAIL",
        criteria: [
          {
            id: "AC-01",
            status: "FAIL",
            evidence: "real failure",
            reliability: "trusted",
          },
          {
            id: "AC-02",
            status: "SKIPPED",
            evidence: "ac-lint: suspect",
            reliability: "suspect",
          },
          {
            id: "AC-03",
            status: "FAIL",
            evidence: "override, failed anyway",
            reliability: "unverified",
          },
        ],
      }),
    );

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
    });

    const report = JSON.parse(result.content[0].text);
    // SKIPPED doesn't land in forward[] (handler filters on FAIL/INCONCLUSIVE).
    expect(report.forward).toHaveLength(2);
    const byAcId = Object.fromEntries(
      report.forward.map((fd: { acId: string; reliability?: string }) => [
        fd.acId,
        fd.reliability,
      ]),
    );
    expect(byAcId["AC-01"]).toBe("trusted");
    expect(byAcId["AC-03"]).toBe("unverified");
  });

  // Q0.5/A3 — AC-A3-07: summary string carries split counts.
  it("AC-A3-07: DivergenceReport.summary reports trusted/suspect/unverified counts", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        storyId: "US-01",
        verdict: "FAIL",
        criteria: [
          {
            id: "AC-01",
            status: "FAIL",
            evidence: "real failure",
            reliability: "trusted",
          },
          {
            id: "AC-02",
            status: "FAIL",
            evidence: "override failed",
            reliability: "unverified",
          },
          {
            id: "AC-03",
            status: "INCONCLUSIVE",
            evidence: "infra broke",
            // undefined reliability → counted as trusted per backward compat.
          },
        ],
      }),
    );

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.forward).toHaveLength(3);
    // Summary string should be greppable for each reliability count.
    expect(report.summary).toContain("2 trusted");
    expect(report.summary).toContain("0 suspect");
    expect(report.summary).toContain("1 unverified");
  });

  it("AC-A3-07b: undefined reliability is counted as trusted (backward-compat)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        storyId: "US-01",
        verdict: "INCONCLUSIVE",
        criteria: [
          {
            id: "AC-01",
            status: "INCONCLUSIVE",
            evidence: "infra broke",
            // reliability intentionally omitted → must count as trusted
          },
        ],
      }),
    );

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
    });

    const report = JSON.parse(result.content[0].text);
    expect(report.summary).toContain("1 trusted / 0 suspect / 0 unverified");
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

// ── Q0/L2 — deterministic reverseFindings ids ──

import { computeReverseFindingId } from "./evaluate.js";

describe("computeReverseFindingId — determinism", () => {
  it("same inputs produce the same id across calls", () => {
    const a = computeReverseFindingId("server/foo.ts:10", "method-divergence", "x");
    const b = computeReverseFindingId("server/foo.ts:10", "method-divergence", "x");
    expect(a).toBe(b);
    expect(a).toMatch(/^rev-[a-f0-9]{12}$/);
  });

  it("different inputs produce different ids", () => {
    const a = computeReverseFindingId("server/foo.ts:10", "method-divergence", "x");
    const b = computeReverseFindingId("server/foo.ts:11", "method-divergence", "x");
    expect(a).not.toBe(b);
  });

  it("lexically-equivalent input arrays emit same ids across two parse runs", () => {
    const input = [
      { location: "server/a.ts:5", classification: "method-divergence", description: "alpha" },
      { location: "server/b.ts:9", classification: "scope-creep", description: "beta" },
    ];
    const ids1 = input.map((i) =>
      computeReverseFindingId(i.location, i.classification, i.description),
    );
    const ids2 = [...input].map((i) =>
      computeReverseFindingId(i.location, i.classification, i.description),
    );
    expect(ids1).toEqual(ids2);
  });
});
