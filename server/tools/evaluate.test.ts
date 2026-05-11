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
// canonicalizeEvalReport AND computeSpecGenCostUsd as the real implementation
// so the handler's deterministic-serialization (PH01-US-00a AC08) and
// v0.38.0 totalCostUsd math paths are exercised.
vi.mock("../lib/run-record.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/run-record.js")>(
    "../lib/run-record.js",
  );
  return {
    writeRunRecord: vi.fn(async () => {}),
    canonicalizeEvalReport: actual.canonicalizeEvalReport,
    computeSpecGenCostUsd: actual.computeSpecGenCostUsd,
    // v0.43.0 — deterministic runId so directive-flow tests can assert on it.
    generateRunId: vi.fn(() => "abcd"),
    findAndMergeRunRecord: vi.fn(async () => null),
  };
});

// v0.36.0 Phase B — mock spec-generator so PASS-mode tests don't try to
// write to non-existent project paths (e.g. "/some/path"). The real
// integration is exercised by `server/lib/spec-generator.test.ts`.
//
// v0.43.0 — also stub the new caller-action directive-flow helpers
// (`buildSpecGenBrief`, `extractCurrentSectionContent`, `hasHandAuthoredMarker`)
// so the default code path in evaluate.ts has all the helpers it imports.
// Individual tests override these as needed.
vi.mock("../lib/spec-generator.js", () => ({
  generateSpecForStory: vi.fn(async (input: { projectPath: string; storyId: string }) => ({
    specPath: `${input.projectPath}/docs/generated/TECHNICAL-SPEC.md`,
    genTimestamp: "2026-04-25T00:00:00.000Z",
    genTokens: { inputTokens: 0, outputTokens: 0 },
    contracts: [],
    bodyChanged: true,
    warnings: [],
  })),
  buildSpecGenBrief: vi.fn(
    (input: { projectPath: string; storyId: string; affectedPaths?: string[]; evalReport: unknown }, runId: string) => ({
      storyId: input.storyId,
      runId,
      specPath: `${input.projectPath}/docs/generated/TECHNICAL-SPEC.md`,
      affectedPaths: input.affectedPaths ?? [],
      systemPrompt: "test-system-prompt",
      userPrompt: "test-user-prompt",
      vocabularyPrompt: "test-vocab-prompt",
      diffSummary: "test-diff",
      evalReport: input.evalReport,
      expectedSections: [
        "api-contracts",
        "data-models",
        "invariants",
        "test-surface",
      ],
      currentSectionContent: {
        "api-contracts": "",
        "data-models": "",
        invariants: "",
        "test-surface": "",
      },
    }),
  ),
  extractCurrentSectionContent: vi.fn(() => ({
    "api-contracts": "",
    "data-models": "",
    invariants: "",
    "test-surface": "",
  })),
  hasHandAuthoredMarker: vi.fn(() => false),
}));

// v0.36.0 Phase C — mock adr-extractor for the same reason (no real disk
// writes during evaluate.ts unit tests). Real integration tests live in
// `server/lib/adr-extractor.test.ts`.
vi.mock("../lib/adr-extractor.js", () => ({
  processStory: vi.fn((input: { projectPath: string; storyId: string }) => ({
    newAdrPaths: [],
    appendedNoDecisionsRow: false,
    indexPath: `${input.projectPath}/docs/decisions/INDEX.md`,
    canonicalized: [],
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
  // v0.43.0 — the default story-mode PASS path emits a `generate-spec-inline`
  // directive instead of calling `generateSpecForStory`. The legacy tests in
  // this file were written against the in-MCP synth path, so we pin
  // `FORGE_SPEC_CALLER_ACTION=0` here to keep them exercising the path
  // they were designed for. The new directive-flow tests live in their own
  // describe block below and `vi.stubEnv("FORGE_SPEC_CALLER_ACTION", "")`
  // back out of legacy mode per test.
  vi.stubEnv("FORGE_SPEC_CALLER_ACTION", "0");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

  it("F4 — surfaces spec-generator failure as typed warnings on BOTH the run record and the MCP top-level response (verdict not masked)", async () => {
    mockedGenerateSpec.mockRejectedValueOnce(new Error("synthetic spec-gen crash"));
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    // Eval verdict still surfaced — the doc-gen hiccup MUST NOT mask it.
    expect(result.isError).toBeUndefined();
    expect(mockedGenerateSpec).toHaveBeenCalledTimes(1);
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const record = mockedWriteRunRecord.mock.calls[0][1];
    expect(record.evalVerdict).toBe("PASS");

    // F4 fix — `generatedDocs` is now synthesised as a structurally-incomplete
    // envelope (specPath:"") carrying the failure warnings. Previously this
    // was silently `undefined` — the bug. The envelope is the on-disk surface
    // for the warnings; the MCP top-level `specGenWarnings` is the parallel
    // surface (P64 producer/consumer seam).
    expect(record.generatedDocs).toBeDefined();
    expect(record.generatedDocs!.specPath).toBe("");
    expect(record.generatedDocs!.warnings).toHaveLength(2);

    const onDiskKinds = record.generatedDocs!.warnings.map((w) => w.kind);
    expect(onDiskKinds).toContain("spec-gen-failed");
    expect(onDiskKinds).toContain("spec-gen-skipped-on-pass");

    const failedWarning = record.generatedDocs!.warnings.find(
      (w) => w.kind === "spec-gen-failed",
    );
    expect(failedWarning).toBeDefined();
    if (failedWarning && failedWarning.kind === "spec-gen-failed") {
      expect(failedWarning.message).toBe("synthetic spec-gen crash");
    }

    // P64 — the MCP top-level surface MUST carry the same warnings.
    expect(result.specGenWarnings).toEqual(record.generatedDocs!.warnings);
  });

  it("v0.42.1 AC-13: spec-gen-rate-limit-exhausted surfaces on BOTH generatedDocs.warnings and result.specGenWarnings (dual-surface)", async () => {
    // Simulate what the real spec-generator emits when the retry loop
    // exhausts on a header-less 429 (AC-6): both spec-gen-shell-only AND
    // spec-gen-rate-limit-exhausted in the warnings array. evaluate.ts
    // must thread BOTH onto the run-record (on-disk) and the MCP-response
    // top-level field (in-band) — that's the P64 dual-surface contract
    // established by v0.42.0's F4 fix.
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    mockedGenerateSpec.mockResolvedValueOnce({
      specPath: "/some/path/docs/generated/TECHNICAL-SPEC.md",
      genTimestamp: "2026-05-11T07:13:00.000Z",
      genTokens: { inputTokens: 0, outputTokens: 0 },
      contracts: [],
      bodyChanged: false,
      warnings: [
        {
          kind: "spec-gen-shell-only",
          message: "429 rate_limit_error",
        },
        {
          kind: "spec-gen-rate-limit-exhausted",
          message:
            "forge_evaluate retried 2 times on HTTP 429 but the rate-limit window did not clear. " +
            "Likely cause: a concurrent OAuth token bucket consumer (e.g. Claude Code main session) is sharing the same bucket.",
        },
      ],
    });

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    // Surface 1: on-disk run record.
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const record = mockedWriteRunRecord.mock.calls[0][1];
    expect(record.generatedDocs).toBeDefined();
    const onDiskKinds = record.generatedDocs!.warnings.map((w) => w.kind);
    expect(onDiskKinds).toContain("spec-gen-shell-only");
    expect(onDiskKinds).toContain("spec-gen-rate-limit-exhausted");

    // Surface 2: in-band MCP response.
    expect(result.specGenWarnings).toBeDefined();
    const mcpKinds = (result.specGenWarnings ?? []).map((w) => w.kind);
    expect(mcpKinds).toContain("spec-gen-shell-only");
    expect(mcpKinds).toContain("spec-gen-rate-limit-exhausted");

    // Parity guarantee: both surfaces carry the same array shape.
    expect(result.specGenWarnings).toEqual(record.generatedDocs!.warnings);
  });
});

// ── v0.40.x I1: surface canonicalized ADR triples on response ──

import { processStory as processAdrStoryMock } from "../lib/adr-extractor.js";
const mockedProcessAdrStory = vi.mocked(processAdrStoryMock);

describe("handleStoryEval — v0.40.x I1 adrCanonicalized response field", () => {
  it("populates `adrCanonicalized` on story-mode PASS when adr-extractor returned canonicalized triples", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    mockedProcessAdrStory.mockReturnValueOnce({
      newAdrPaths: ["/some/path/docs/decisions/ADR-0007-some-slug-US-01.md"],
      appendedNoDecisionsRow: false,
      indexPath: "/some/path/docs/decisions/INDEX.md",
      canonicalized: [
        {
          from: "/some/path/.forge/staging/adr/US-01/some-slug.md",
          to: "/some/path/docs/decisions/ADR-0007-some-slug-US-01.md",
          adrId: "ADR-0007",
        },
      ],
    });

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(result.isError).toBeUndefined();
    expect(result.adrCanonicalized).toBeDefined();
    expect(result.adrCanonicalized).toHaveLength(1);
    expect(result.adrCanonicalized![0]).toEqual({
      from: "/some/path/.forge/staging/adr/US-01/some-slug.md",
      to: "/some/path/docs/decisions/ADR-0007-some-slug-US-01.md",
      adrId: "ADR-0007",
    });
  });

  it("populates `adrCanonicalized` as an empty array on story-mode PASS when no staging stubs existed", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    // Default mock returns canonicalized: [] — the no-staging-stubs case.

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(result.isError).toBeUndefined();
    expect(result.adrCanonicalized).toBeDefined();
    expect(result.adrCanonicalized).toEqual([]);
  });

  it("omits `adrCanonicalized` on story-mode FAIL (adr-extractor not invoked)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        verdict: "FAIL",
        criteria: [{ id: "AC-01", status: "FAIL", evidence: "broken" }],
      }),
    );

    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(result.isError).toBeUndefined();
    expect(result.adrCanonicalized).toBeUndefined();
    // Sanity — adr-extractor should NOT have been called on a FAIL verdict.
    expect(mockedProcessAdrStory).not.toHaveBeenCalled();
  });

  it("omits `adrCanonicalized` on coherence-mode responses (scope guard — story-mode-only)", async () => {
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ gaps: [], summary: "All aligned." }),
    );

    const result = await handleEvaluate({
      evaluationMode: "coherence",
      prdContent: "Build a thing",
    });

    expect(result.isError).toBeUndefined();
    expect(result.adrCanonicalized).toBeUndefined();
  });

  it("omits `adrCanonicalized` on divergence-mode responses (scope guard — story-mode-only)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(
      makeEvalReport({
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "ok" }],
      }),
    );
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ reverse: [], summary: "No reverse divergences." }),
    );

    const result = await handleEvaluate({
      evaluationMode: "divergence",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(result.isError).toBeUndefined();
    expect(result.adrCanonicalized).toBeUndefined();
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

// ── v0.43.0: callerAction directive flow (AC-1, AC-2, AC-3, AC-3b, AC-4) ──

import {
  buildSpecGenBrief as mockedBuildSpecGenBriefImport,
  extractCurrentSectionContent as mockedExtractCurrentImport,
  hasHandAuthoredMarker as mockedHasHandAuthoredImport,
  generateSpecForStory as mockedGenerateSpecForStoryImport,
} from "../lib/spec-generator.js";
const mockedBuildSpecGenBrief = vi.mocked(mockedBuildSpecGenBriefImport);
const mockedExtractCurrent = vi.mocked(mockedExtractCurrentImport);
const mockedHasHandAuthored = vi.mocked(mockedHasHandAuthoredImport);
const mockedGenerateSpecForStory2 = vi.mocked(mockedGenerateSpecForStoryImport);

describe("v0.43.0 — callerAction directive flow on PASS path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // CRITICAL: override the top-level legacy-pin so this describe block
    // exercises the NEW default path. Tests inside flip back to "0" as
    // needed for the AC-4 opt-out coverage.
    vi.stubEnv("FORGE_SPEC_CALLER_ACTION", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("AC-1: PASS path emits `callerAction: \"generate-spec-inline\"` AND a `specGenBrief`", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });
    expect(result.isError).toBeUndefined();
    expect(result.callerAction).toBe("generate-spec-inline");
    expect(result.specGenBrief).toBeDefined();
  });

  it("AC-2: ZERO Anthropic synth calls on the default PASS path (synth.callCount === 0)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });
    // The legacy in-MCP synth path goes through `generateSpecForStory`, which
    // wraps `trackedCallClaude` → `callClaude`. The directive flow does not
    // call any of these. Assert both layers are untouched.
    expect(mockedGenerateSpecForStory2).not.toHaveBeenCalled();
    expect(mockedCallClaude).not.toHaveBeenCalled();
  });

  it("AC-3: specGenBrief carries the required 10 fields (storyId, runId, specPath, affectedPaths, systemPrompt, userPrompt, vocabularyPrompt, diffSummary, evalReport, expectedSections, currentSectionContent)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });
    const brief = result.specGenBrief!;
    expect(brief).toBeDefined();
    expect(brief.storyId).toBe("US-01");
    expect(typeof brief.runId).toBe("string");
    expect(brief.runId.length).toBeGreaterThan(0);
    expect(typeof brief.specPath).toBe("string");
    expect(Array.isArray(brief.affectedPaths)).toBe(true);
    expect(typeof brief.systemPrompt).toBe("string");
    expect(typeof brief.userPrompt).toBe("string");
    expect(typeof brief.vocabularyPrompt).toBe("string");
    expect(typeof brief.diffSummary).toBe("string");
    expect(brief.evalReport).toBeDefined();
    expect(brief.expectedSections).toEqual([
      "api-contracts",
      "data-models",
      "invariants",
      "test-surface",
    ]);
    expect(brief.currentSectionContent).toBeDefined();
    expect(brief.currentSectionContent["api-contracts"]).toBeDefined();
    expect(brief.currentSectionContent["data-models"]).toBeDefined();
    expect(brief.currentSectionContent.invariants).toBeDefined();
    expect(brief.currentSectionContent["test-surface"]).toBeDefined();
  });

  it("AC-3b: hand-author marker on on-disk content → NO directive AND NO brief AND warning surfaces on both surfaces", async () => {
    // Simulate hand-author marker on one sub-section.
    mockedExtractCurrent.mockReturnValueOnce({
      "api-contracts": "<!-- hand-authored 2026-05-11 by operator -->\n- something",
      "data-models": "",
      invariants: "",
      "test-surface": "",
    });
    mockedHasHandAuthored.mockReturnValueOnce(true);

    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    const result = await handleEvaluate({
      storyId: "US-13",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });

    expect(result.callerAction).toBeUndefined();
    expect(result.specGenBrief).toBeUndefined();
    // No Anthropic call.
    expect(mockedCallClaude).not.toHaveBeenCalled();
    expect(mockedGenerateSpecForStory2).not.toHaveBeenCalled();
    // Warning surfaced on MCP top-level field.
    const mcpKinds = (result.specGenWarnings ?? []).map((w) => w.kind);
    expect(mcpKinds).toContain("spec-gen-short-circuited-hand-author");
    // Warning ALSO surfaced on the on-disk record.
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const record = mockedWriteRunRecord.mock.calls[0][1];
    const onDiskKinds = (record.generatedDocs?.warnings ?? []).map((w) => w.kind);
    expect(onDiskKinds).toContain("spec-gen-short-circuited-hand-author");
    // Run record records the discriminator.
    expect(record.generatedDocs?.specGenMode).toBe(
      "short-circuited-hand-author",
    );
  });

  it("AC-4 (a): FORGE_SPEC_CALLER_ACTION=0 routes to legacy in-MCP synth (synth called ≥1)", async () => {
    vi.stubEnv("FORGE_SPEC_CALLER_ACTION", "0");
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    const result = await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });
    expect(result.callerAction).toBeUndefined();
    expect(result.specGenBrief).toBeUndefined();
    expect(mockedGenerateSpecForStory2).toHaveBeenCalledTimes(1);
    // The run record stamps the legacy discriminator.
    const record = mockedWriteRunRecord.mock.calls[0][1];
    expect(record.generatedDocs?.specGenMode).toBe("in-mcp");
  });

  it("AC-4 (b): env unset (default) routes to the directive flow (synth called 0)", async () => {
    // beforeEach already pins env=""; assert directive emission.
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });
    expect(mockedGenerateSpecForStory2).not.toHaveBeenCalled();
    expect(mockedBuildSpecGenBrief).toHaveBeenCalledTimes(1);
    // The run record stamps the new-path discriminator.
    const record = mockedWriteRunRecord.mock.calls[0][1];
    expect(record.generatedDocs?.specGenMode).toBe("caller-action");
  });

  it("AC-14: directive-emit run record uses the runId as filename suffix (`runId` option threaded to writeRunRecord)", async () => {
    mockedEvaluateStory.mockResolvedValueOnce(makeEvalReport({ verdict: "PASS" }));
    await handleEvaluate({
      storyId: "US-01",
      planJson: makeValidPlanJson(),
      projectPath: "/some/path",
    });
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [, , options] = mockedWriteRunRecord.mock.calls[0];
    expect(options).toBeDefined();
    expect(options).toMatchObject({ runId: expect.stringMatching(/^[0-9a-f]{4}$/) });
    // The brief's runId matches the writeRunRecord runId option.
    const briefRunId = mockedBuildSpecGenBrief.mock.calls[0][1];
    expect((options as { runId?: string }).runId).toBe(briefRunId);
  });
});

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
