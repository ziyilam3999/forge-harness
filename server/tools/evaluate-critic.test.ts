import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CallClaudeResult } from "../lib/anthropic.js";

// ── Mocks (mirror evaluate.test.ts mocking idiom) ─────────

vi.mock("../lib/anthropic.js", () => ({
  callClaude: vi.fn(),
  extractJson: vi.fn((text: string) => JSON.parse(text)),
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
import { callClaude } from "../lib/anthropic.js";
import { writeRunRecord } from "../lib/run-record.js";
import { handleEvaluate } from "./evaluate.js";

const mockedCallClaude = vi.mocked(callClaude);
const mockedWriteRunRecord = vi.mocked(writeRunRecord);

// ── Helpers ───────────────────────────────────────────────

function makeCallResult(data: unknown): CallClaudeResult {
  return {
    text: JSON.stringify(data),
    parsed: data,
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

function makeValidPlanObject(storyId = "US-01") {
  return {
    schemaVersion: "3.0.0",
    stories: [
      {
        id: storyId,
        title: "Test story",
        acceptanceCriteria: [
          { id: "AC-01", description: "Check", command: "echo ok" },
        ],
      },
    ],
  };
}

let tmpRoot: string;
let projectPath: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpRoot = mkdtempSync(join(tmpdir(), "critic-eval-"));
  projectPath = tmpRoot;
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ── Tests ─────────────────────────────────────────────────

describe("handleEvaluate — critic mode", () => {
  it("dispatch: evaluationMode:critic routes to critic handler (not unknown-mode error) [AC-02]", async () => {
    // Write one plan file so the handler has something to process.
    const planPath = join(tmpRoot, "plan-1.json");
    writeFileSync(planPath, JSON.stringify(makeValidPlanObject()));
    mockedCallClaude.mockResolvedValueOnce(makeCallResult({ findings: [] }));

    const result = await handleEvaluate({
      evaluationMode: "critic",
      planPaths: [planPath],
      projectPath,
    });

    expect(result.isError).not.toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).not.toMatch(/unknown evaluationMode/i);
    expect(text).toMatch(/"evaluationMode":\s*"critic"/);
  });

  it("two plans: critiques each and returns per-plan results [AC-03]", async () => {
    const planA = join(tmpRoot, "plan-a.json");
    const planB = join(tmpRoot, "plan-b.json");
    writeFileSync(planA, JSON.stringify(makeValidPlanObject("US-01")));
    writeFileSync(planB, JSON.stringify(makeValidPlanObject("US-02")));

    // One call per plan. Deterministic findings payload.
    mockedCallClaude
      .mockResolvedValueOnce(
        makeCallResult({
          findings: [
            {
              severity: "MINOR",
              storyId: "US-01",
              acId: "AC-01",
              description: "test-finding-a",
              suggestedFix: "fix",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeCallResult({
          findings: [
            {
              severity: "MAJOR",
              storyId: "US-02",
              acId: "AC-01",
              description: "test-finding-b",
              suggestedFix: "fix",
            },
          ],
        }),
      );

    const result = await handleEvaluate({
      evaluationMode: "critic",
      planPaths: [planA, planB],
      projectPath,
    });

    expect(result.isError).not.toBe(true);
    const report = JSON.parse(result.content[0]!.text) as {
      evaluationMode: string;
      results: Array<{ planPath: string; findings: unknown[]; error?: string }>;
    };
    expect(report.evaluationMode).toBe("critic");
    expect(report.results).toHaveLength(2);
    expect(report.results[0]!.planPath).toBe(planA);
    expect(report.results[0]!.findings).toHaveLength(1);
    expect(report.results[0]!.error).toBeUndefined();
    expect(report.results[1]!.planPath).toBe(planB);
    expect(report.results[1]!.findings).toHaveLength(1);
    expect(mockedCallClaude).toHaveBeenCalledTimes(2);

    // AC-05 cost surface: writeRunRecord called with estimatedCostUsd > 0
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [, record] = mockedWriteRunRecord.mock.calls[0]!;
    expect(record.metrics.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("per-plan failure: second plan unparseable, first succeeds, no throw [AC-04]", async () => {
    const planA = join(tmpRoot, "plan-a.json");
    const planB = join(tmpRoot, "plan-b.json");
    writeFileSync(planA, JSON.stringify(makeValidPlanObject("US-01")));
    // Invalid JSON — JSON.parse will throw inside the per-plan try/catch.
    writeFileSync(planB, "this is not { valid json");

    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({
        findings: [
          {
            severity: "MINOR",
            storyId: "US-01",
            acId: "AC-01",
            description: "ok",
            suggestedFix: "fix",
          },
        ],
      }),
    );

    const result = await handleEvaluate({
      evaluationMode: "critic",
      planPaths: [planA, planB],
      projectPath,
    });

    expect(result.isError).not.toBe(true);
    const report = JSON.parse(result.content[0]!.text) as {
      evaluationMode: string;
      results: Array<{ planPath: string; findings: unknown[]; error?: string }>;
    };
    expect(report.results).toHaveLength(2);
    expect(report.results[0]!.findings).toHaveLength(1);
    expect(report.results[0]!.error).toBeUndefined();
    expect(report.results[1]!.findings).toHaveLength(0);
    expect(report.results[1]!.error).toBeDefined();
    // Only the first plan triggers an LLM call; the second fails pre-call.
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
  });

  it("RunRecord shape: criticReport is written via the tagged-extension idiom [AC-05]", async () => {
    const planA = join(tmpRoot, "plan-a.json");
    writeFileSync(planA, JSON.stringify(makeValidPlanObject()));
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ findings: [] }),
    );

    await handleEvaluate({
      evaluationMode: "critic",
      planPaths: [planA],
      projectPath,
    });

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [writtenProjectPath, record] = mockedWriteRunRecord.mock.calls[0]!;
    expect(writtenProjectPath).toBe(projectPath);
    expect(record.tool).toBe("forge_evaluate");
    expect(record.outcome).toBe("success");
    expect(record.metrics.estimatedCostUsd).toBeGreaterThan(0);
    expect(record.criticReport).toBeDefined();
    expect(record.criticReport!.evaluationMode).toBe("critic");
    expect(record.criticReport!.results).toHaveLength(1);
    expect(record.criticReport!.results[0]!.planPath).toBe(planA);
  });

  it("skips run record write when projectPath is omitted", async () => {
    const planA = join(tmpRoot, "plan-a.json");
    writeFileSync(planA, JSON.stringify(makeValidPlanObject()));
    mockedCallClaude.mockResolvedValueOnce(
      makeCallResult({ findings: [] }),
    );

    await handleEvaluate({
      evaluationMode: "critic",
      planPaths: [planA],
      // projectPath intentionally omitted
    });

    expect(mockedWriteRunRecord).not.toHaveBeenCalled();
  });
});
