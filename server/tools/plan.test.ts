import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallClaudeResult } from "../lib/anthropic.js";

// Mock the anthropic module
vi.mock("../lib/anthropic.js", () => ({
  callClaude: vi.fn(),
  extractJson: vi.fn((text: string) => JSON.parse(text)),
}));

// Mock codebase-scan
vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn(async () => "## Directory Structure\n```\nsrc/\n```"),
}));

// Mock run-record — don't write real files during tests
vi.mock("../lib/run-record.js", () => ({
  writeRunRecord: vi.fn(async () => {}),
}));

// Mock run-context — trackedCallClaude delegates to the mocked callClaude
// and accumulates tokens for cost.summarize()
vi.mock("../lib/run-context.js", async () => {
  const { callClaude: mockedClaude } = await import("../lib/anthropic.js");

  class MockRunContext {
    _inputTokens = 0;
    _outputTokens = 0;
    cost = {
      summarize: () => ({
        inputTokens: (this as any)._inputTokens ?? 0,
        outputTokens: (this as any)._outputTokens ?? 0,
        estimatedCostUsd: 0.001,
        breakdown: [],
        isOAuthAuth: false,
      }),
      recordUsage: vi.fn(),
    };
    progress = { begin: vi.fn(), complete: vi.fn(), skip: vi.fn(), fail: vi.fn(), getResults: () => [] };
    audit = { log: vi.fn(async () => {}) };
    toolName = "forge_plan";

    constructor() {
      // Bind summarize to the instance
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
    trackedCallClaude: vi.fn(async (ctx: any, _stage: string, _role: string, options: any) => {
      const result = await mockedClaude(options);
      if (ctx && result.usage) {
        ctx._inputTokens = (ctx._inputTokens ?? 0) + result.usage.inputTokens;
        ctx._outputTokens = (ctx._outputTokens ?? 0) + result.usage.outputTokens;
      }
      return result;
    }),
  };
});

// Import after mocks
const { callClaude, extractJson } = await import("../lib/anthropic.js");
const { scanCodebase } = await import("../lib/codebase-scan.js");
const { writeRunRecord } = await import("../lib/run-record.js");
// trackedCallClaude is mocked — import not needed for direct use
const { handlePlan, detectCoupledACs } = await import("./plan.js");
const { buildPlannerPrompt } = await import("../lib/prompts/planner.js");
const { buildCriticPrompt } = await import("../lib/prompts/critic.js");

const mockedCallClaude = vi.mocked(callClaude);
const mockedExtractJson = vi.mocked(extractJson);
const mockedScanCodebase = vi.mocked(scanCodebase);
const mockedWriteRunRecord = vi.mocked(writeRunRecord);

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
    it("contains evidence format matching rule (D1)", () => {
      const prompt = buildPlannerPrompt("feature");
      expect(prompt).toContain("exactly match");
    });

    it("contains build prerequisite rule (D2)", () => {
      const prompt = buildPlannerPrompt("feature");
      expect(prompt).toContain("build output directory");
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

  describe("implementation coupling detection", () => {
    it("includes coupling warnings in output when ACs inspect source code", async () => {
      const plan = {
        schemaVersion: "3.0.0" as const,
        stories: [
          {
            id: "US-01",
            title: "Add caching",
            dependencies: [],
            acceptanceCriteria: [
              { id: "AC-01", description: "uses Redis", command: 'grep -r "Redis" src/' },
            ],
            affectedPaths: ["src/"],
          },
        ],
      };
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)); // planner only (quick tier)

      const result = await handlePlan({ intent: "add caching", tier: "quick" });
      expect(result.content[0].text).toContain("IMPLEMENTATION COUPLING WARNINGS");
      expect(result.content[0].text).toContain("US-01/AC-01");
    });

    it("does not include coupling warnings when ACs are clean", async () => {
      const plan = makeValidPlan();
      mockedCallClaude
        .mockResolvedValueOnce(makeCallResult(plan)); // planner

      const result = await handlePlan({ intent: "add button", tier: "quick" });
      expect(result.content[0].text).not.toContain("IMPLEMENTATION COUPLING");
    });
  });
});

describe("detectCoupledACs", () => {
  function makePlanWithAC(command: string) {
    return {
      schemaVersion: "3.0.0" as const,
      stories: [
        {
          id: "US-01",
          title: "Test",
          dependencies: [],
          acceptanceCriteria: [{ id: "AC-01", description: "test", command }],
          affectedPaths: ["src/"],
        },
      ],
    };
  }

  it("flags grep -r against src/", () => {
    const violations = detectCoupledACs(makePlanWithAC('grep -r "Redis" src/'));
    expect(violations).toHaveLength(1);
    expect(violations[0].storyId).toBe("US-01");
    expect(violations[0].acId).toBe("AC-01");
  });

  it("flags grep with flags against server/", () => {
    const violations = detectCoupledACs(makePlanWithAC('grep -rn "class Cache" server/lib/'));
    expect(violations).toHaveLength(1);
  });

  it("flags rg against src/", () => {
    const violations = detectCoupledACs(makePlanWithAC('rg "import.*Redis" src/'));
    expect(violations).toHaveLength(1);
  });

  it("flags rg against server/", () => {
    const violations = detectCoupledACs(makePlanWithAC('rg "class UserCache" server/'));
    expect(violations).toHaveLength(1);
  });

  it("flags find src/ -name", () => {
    const violations = detectCoupledACs(makePlanWithAC('find src/ -name "*.cache.ts"'));
    expect(violations).toHaveLength(1);
  });

  it("flags find server/ -name", () => {
    const violations = detectCoupledACs(makePlanWithAC('find server/ -type f -name "*.ts"'));
    expect(violations).toHaveLength(1);
  });

  it("does not flag behavioral commands", () => {
    expect(detectCoupledACs(makePlanWithAC("echo PASS"))).toHaveLength(0);
    expect(detectCoupledACs(makePlanWithAC("npx tsc && echo PASS"))).toHaveLength(0);
    expect(detectCoupledACs(makePlanWithAC("curl localhost:3000/api | jq '.status'"))).toHaveLength(0);
    expect(detectCoupledACs(makePlanWithAC("npm test"))).toHaveLength(0);
  });

  it("does not flag grep used on command output (not source dirs)", () => {
    expect(detectCoupledACs(makePlanWithAC("node app.js | grep 'started'"))).toHaveLength(0);
    expect(detectCoupledACs(makePlanWithAC("npm run build 2>&1 | grep -q 'success'"))).toHaveLength(0);
  });

  it("reports one violation per AC even if multiple patterns match", () => {
    // This command matches both grep and rg patterns conceptually, but only one pattern can match at a time
    const violations = detectCoupledACs(makePlanWithAC('grep -r "foo" src/ && rg "bar" server/'));
    // grep pattern matches first, so only 1 violation
    expect(violations).toHaveLength(1);
  });
});

describe("planner prompt rules", () => {
  it("contains functional AC rule — observable behavior (D3)", () => {
    const prompt = buildPlannerPrompt("feature");
    expect(prompt).toContain("OBSERVABLE BEHAVIOR");
    expect(prompt).toContain("never implementation method");
  });

  it("contains evidence-gating rule for codebase claims", () => {
    const prompt = buildPlannerPrompt("feature");
    expect(prompt).toContain("Evidence-Gating");
    expect(prompt).toContain("cite");
  });
});

describe("critic prompt rules", () => {
  it("contains implementation coupling check dimension", () => {
    const prompt = buildCriticPrompt(1);
    expect(prompt).toContain("Implementation Coupling");
    expect(prompt).toContain("observable behavior");
  });

  it("contains evidence-gating check dimension", () => {
    const prompt = buildCriticPrompt(1);
    expect(prompt).toContain("Evidence-Gating");
  });

  it("includes implementation coupling dimension in round 2 as well", () => {
    const prompt = buildCriticPrompt(2);
    expect(prompt).toContain("Implementation Coupling");
  });
});

describe("context injection", () => {
  it("passes context entries to the planner prompt", async () => {
    const plan = makeValidPlan();
    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(plan)); // planner only

    await handlePlan({
      intent: "add button",
      tier: "quick",
      context: [
        { label: "Proven patterns", content: "P27: tight scope" },
        { label: "Anti-patterns", content: "F2: no consequences" },
      ],
    });

    const firstCall = mockedCallClaude.mock.calls[0][0];
    expect(firstCall.messages[0].content).toContain("Proven patterns");
    expect(firstCall.messages[0].content).toContain("P27: tight scope");
    expect(firstCall.messages[0].content).toContain("Anti-patterns");
  });

  it("respects maxContextChars by dropping last entries first", async () => {
    const plan = makeValidPlan();
    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(plan));

    await handlePlan({
      intent: "add button",
      tier: "quick",
      context: [
        { label: "Small", content: "fits" },
        { label: "Big", content: "X".repeat(10000) },
      ],
      maxContextChars: 100,
    });

    const firstCall = mockedCallClaude.mock.calls[0][0];
    expect(firstCall.messages[0].content).toContain("Small");
    expect(firstCall.messages[0].content).not.toContain("Big");
  });

  it("does not add context section when context is empty or omitted", async () => {
    const plan = makeValidPlan();
    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(plan));

    await handlePlan({ intent: "add button", tier: "quick" });

    const firstCall = mockedCallClaude.mock.calls[0][0];
    expect(firstCall.messages[0].content).not.toContain("Additional Context");
  });
});

describe("run records", () => {
  it("writes a run record when projectPath is provided", async () => {
    const plan = makeValidPlan();
    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(plan)); // planner only

    await handlePlan({ intent: "add button", tier: "quick", projectPath: "/some/path" });

    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [projectPath, record] = mockedWriteRunRecord.mock.calls[0];
    expect(projectPath).toBe("/some/path");
    expect(record.tool).toBe("forge_plan");
    expect(record.outcome).toBe("success");
    expect(record.metrics.inputTokens).toBeGreaterThan(0);
    expect(record.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("does not write a run record when projectPath is omitted", async () => {
    const plan = makeValidPlan();
    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(plan));

    await handlePlan({ intent: "add button", tier: "quick" });

    expect(mockedWriteRunRecord).not.toHaveBeenCalled();
  });

  it("includes critique metrics in run record", async () => {
    const plan = makeValidPlan();
    const findings = [
      { severity: "MINOR", storyId: "US-01", acId: null, description: "d", suggestedFix: "f" },
    ];

    mockedCallClaude
      .mockResolvedValueOnce(makeCallResult(plan)) // planner
      .mockResolvedValueOnce(makeCriticResult(findings)) // critic-1
      .mockResolvedValueOnce(makeCorrectorResult(plan, [{ findingIndex: 0, applied: true, reason: "ok" }])) // corrector-1
      .mockResolvedValueOnce(makeCriticResult()); // critic-2

    await handlePlan({ intent: "add button", projectPath: "/some/path" });

    const [, record] = mockedWriteRunRecord.mock.calls[0];
    expect(record.metrics.critiqueRounds).toBe(2);
    expect(record.metrics.findingsTotal).toBe(1);
    expect(record.metrics.findingsApplied).toBe(1);
    expect(record.metrics.findingsRejected).toBe(0);
  });
});
