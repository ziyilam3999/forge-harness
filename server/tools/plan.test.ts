import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallClaudeResult } from "../lib/anthropic.js";

// Mock the anthropic module before importing plan
vi.mock("../lib/anthropic.js", () => ({
  callClaude: vi.fn(),
  extractJson: vi.fn((text: string) => JSON.parse(text)),
}));

// Mock codebase-scan
vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn(async () => "## Directory Structure\n```\nsrc/\n```"),
}));

// Import after mocks
const { callClaude, extractJson } = await import("../lib/anthropic.js");
const { scanCodebase } = await import("../lib/codebase-scan.js");
const { handlePlan } = await import("./plan.js");

const mockedCallClaude = vi.mocked(callClaude);
const mockedExtractJson = vi.mocked(extractJson);
const mockedScanCodebase = vi.mocked(scanCodebase);

function makeValidPlan() {
  return {
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-01",
        title: "Test story",
        dependencies: [],
        acceptanceCriteria: [
          { id: "AC-01", description: "passes", command: "echo PASS" },
        ],
        affectedPaths: ["src/"],
      },
    ],
  };
}

function makeCallResult(data: unknown): CallClaudeResult {
  return {
    text: JSON.stringify(data),
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

function makeCriticResult(findings: Array<Record<string, unknown>> = []) {
  return makeCallResult({ findings });
}

function makeCorrectorResult(plan: unknown, dispositions: Array<Record<string, unknown>> = []) {
  return makeCallResult({ plan, dispositions });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: extractJson just parses
  mockedExtractJson.mockImplementation((text: string) => JSON.parse(text));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handlePlan", () => {
  describe("basic pipeline", () => {
    it("returns valid execution plan JSON", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult()) // critic-1 (zero findings)
        .mockResolvedValueOnce(makeCriticResult()); // critic-2 (zero findings)

      const result = await handlePlan({ intent: "add dark mode" });
      expect(result.content[0].text).toContain("EXECUTION PLAN");
      expect(result.content[0].text).toContain('"schemaVersion": "3.0.0"');
      expect(result.content[0].text).toContain("USAGE");
    });

    it("includes critique summary when findings exist", async () => {
      const plan = makeValidPlan();
      const findings = [
        { severity: "MINOR", storyId: "US-01", acId: "AC-01", description: "d", suggestedFix: "f" },
      ];

      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult(findings)) // critic-1
        .mockResolvedValueOnce(makeCorrectorResult(plan, [{ findingIndex: 0, applied: true, reason: "ok" }])) // corrector-1
        .mockResolvedValueOnce(makeCriticResult()); // critic-2 (zero findings)

      const result = await handlePlan({ intent: "add dark mode" });
      expect(result.content[0].text).toContain("CRITIQUE SUMMARY");
      expect(result.content[0].text).toContain("1 findings");
    });
  });

  describe("tier behavior", () => {
    it('tier "quick" skips critique loop', async () => {
      const plan = makeValidPlan();
      mockedCallClaude.mockResolvedValueOnce(makeCallResult(plan));

      await handlePlan({ intent: "add button", tier: "quick" });
      expect(mockedCallClaude).toHaveBeenCalledTimes(1); // planner only
    });

    it('tier "standard" runs 1 critique round', async () => {
      const plan = makeValidPlan();
      const findings = [
        { severity: "MINOR", storyId: "US-01", acId: null, description: "d", suggestedFix: "f" },
      ];

      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult(findings)) // critic-1
        .mockResolvedValueOnce(makeCorrectorResult(plan, [{ findingIndex: 0, applied: true, reason: "ok" }])); // corrector-1

      await handlePlan({ intent: "add button", tier: "standard" });
      expect(mockedCallClaude).toHaveBeenCalledTimes(3); // planner + critic + corrector
    });

    it('tier "thorough" runs 2 critique rounds', async () => {
      const plan = makeValidPlan();
      const findings = [
        { severity: "MINOR", storyId: "US-01", acId: null, description: "d", suggestedFix: "f" },
      ];

      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult(findings)) // critic-1
        .mockResolvedValueOnce(makeCorrectorResult(plan, [{ findingIndex: 0, applied: true, reason: "ok" }])) // corrector-1
        .mockResolvedValueOnce(makeCriticResult(findings)) // critic-2
        .mockResolvedValueOnce(makeCorrectorResult(plan, [{ findingIndex: 0, applied: true, reason: "ok" }])); // corrector-2

      await handlePlan({ intent: "add button", tier: "thorough" });
      expect(mockedCallClaude).toHaveBeenCalledTimes(5);
    });

    it("defaults to thorough tier", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult()) // critic-1
        .mockResolvedValueOnce(makeCriticResult()); // critic-2

      await handlePlan({ intent: "add button" });
      expect(mockedCallClaude).toHaveBeenCalledTimes(3);
    });
  });

  describe("mode auto-detection", () => {
    it('detects "fix" keyword as bugfix', async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan))
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      await handlePlan({ intent: "fix the login bug" });

      const firstCall = mockedCallClaude.mock.calls[0][0];
      expect(firstCall.system).toContain("FIRST acceptance criterion");
    });

    it('detects "add feature" as feature mode', async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan))
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      await handlePlan({ intent: "add dark mode toggle" });

      const firstCall = mockedCallClaude.mock.calls[0][0];
      expect(firstCall.system).toContain("Prefer a single story");
    });

    it("uses explicit mode when provided", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan))
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      await handlePlan({ intent: "add error handling", mode: "feature" });

      const firstCall = mockedCallClaude.mock.calls[0][0];
      expect(firstCall.system).toContain("Prefer a single story");
    });
  });

  describe("error handling", () => {
    it("retries planner on validation failure", async () => {
      const invalidPlan = { schemaVersion: "3.0.0", stories: [] };
      const validPlan = makeValidPlan();

      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(invalidPlan)) // first attempt fails validation
        .mockResolvedValueOnce(makeCallResult(validPlan)) // retry succeeds
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      const result = await handlePlan({ intent: "add button" });
      expect(result.content[0].text).toContain("EXECUTION PLAN");
      expect(mockedCallClaude).toHaveBeenCalledTimes(4); // 2 planner + 2 critics
    });

    it("throws if planner fails validation after retry", async () => {
      const invalidPlan = { schemaVersion: "3.0.0", stories: [] };

      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(invalidPlan))
        .mockResolvedValueOnce(makeCallResult(invalidPlan));

      await expect(handlePlan({ intent: "add button" })).rejects.toThrow(
        "failed validation after retry",
      );
    });

    it("treats malformed critic response as zero findings", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCallResult({ not: "findings" })) // malformed critic
        .mockResolvedValueOnce(makeCriticResult()); // critic-2 ok

      const result = await handlePlan({ intent: "add button" });
      expect(result.content[0].text).toContain("EXECUTION PLAN");
    });

    it("uses pre-correction plan when corrector fails", async () => {
      const plan = makeValidPlan();
      const findings = [
        { severity: "MAJOR", storyId: "US-01", acId: null, description: "d", suggestedFix: "f" },
      ];

      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult(findings)) // critic-1
        .mockRejectedValueOnce(new Error("corrector crashed")) // corrector-1 fails
        .mockResolvedValueOnce(makeCriticResult()); // critic-2

      const result = await handlePlan({ intent: "add button" });
      expect(result.content[0].text).toContain("EXECUTION PLAN");
    });

    it("uses pre-correction plan when corrector output fails validation", async () => {
      const plan = makeValidPlan();
      const findings = [
        { severity: "MAJOR", storyId: "US-01", acId: null, description: "d", suggestedFix: "f" },
      ];
      const brokenPlan = { schemaVersion: "3.0.0", stories: [] };

      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult(findings)) // critic-1
        .mockResolvedValueOnce(makeCorrectorResult(brokenPlan)) // corrector returns invalid plan
        .mockResolvedValueOnce(makeCriticResult()); // critic-2

      const result = await handlePlan({ intent: "add button" });
      expect(result.content[0].text).toContain("EXECUTION PLAN");
      expect(result.content[0].text).toContain("US-01"); // original plan preserved
    });
  });

  describe("codebase scanning", () => {
    it("calls scanCodebase when projectPath provided", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan))
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      await handlePlan({ intent: "add button", projectPath: "/some/path" });
      expect(mockedScanCodebase).toHaveBeenCalledWith("/some/path");
    });

    it("does not call scanCodebase when projectPath omitted", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan))
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      await handlePlan({ intent: "add button" });
      expect(mockedScanCodebase).not.toHaveBeenCalled();
    });
  });

  describe("planner prompt calibration rules", () => {
    it("contains evidence format matching rule (D1)", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan))
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      await handlePlan({ intent: "add button" });

      const firstCall = mockedCallClaude.mock.calls[0][0];
      expect(firstCall.system).toContain("exactly match");
    });

    it("contains build prerequisite rule (D2)", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan))
        .mockResolvedValueOnce(makeCriticResult())
        .mockResolvedValueOnce(makeCriticResult());

      await handlePlan({ intent: "add button" });

      const firstCall = mockedCallClaude.mock.calls[0][0];
      expect(firstCall.system).toContain("build output directory");
    });
  });

  describe("critic zero findings", () => {
    it("skips corrector when critic finds no issues", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)) // planner
        .mockResolvedValueOnce(makeCriticResult()) // critic-1 zero findings
        .mockResolvedValueOnce(makeCriticResult()); // critic-2 zero findings

      await handlePlan({ intent: "add button" });
      expect(mockedCallClaude).toHaveBeenCalledTimes(3);
    });
  });
});
