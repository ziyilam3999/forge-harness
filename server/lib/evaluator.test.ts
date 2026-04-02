import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./executor.js", () => ({
  executeCommand: vi.fn(),
}));

import { executeCommand } from "./executor.js";
import { evaluateStory } from "./evaluator.js";
import type { ExecutionPlan } from "../types/execution-plan.js";
import type { CriterionResult } from "../types/eval-report.js";

const mockedExecute = vi.mocked(executeCommand);

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-01",
        title: "Test story",
        acceptanceCriteria: [
          { id: "AC-01", description: "Check A", command: "echo ok" },
          { id: "AC-02", description: "Check B", command: "echo ok" },
        ],
      },
    ],
    ...overrides,
  };
}

function mockResult(partial: Partial<CriterionResult>): CriterionResult {
  return {
    id: "",
    status: "PASS",
    evidence: "",
    ...partial,
  };
}

describe("evaluateStory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns PASS when all ACs pass", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "ok" }))
      .mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "ok" }));

    const report = await evaluateStory(makePlan(), "US-01");
    expect(report.verdict).toBe("PASS");
    expect(report.criteria).toHaveLength(2);
    expect(report.criteria.every((c) => c.status === "PASS")).toBe(true);
  });

  it("returns FAIL when any AC fails", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "ok" }))
      .mockResolvedValueOnce(mockResult({ status: "FAIL", evidence: "bad" }));

    const report = await evaluateStory(makePlan(), "US-01");
    expect(report.verdict).toBe("FAIL");
    expect(report.criteria[1].status).toBe("FAIL");
  });

  it("throws when story not found", async () => {
    await expect(
      evaluateStory(makePlan(), "US-99"),
    ).rejects.toThrow("Story 'US-99' not found in plan");
  });

  it("captures evidence from executor results", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "hello world" }))
      .mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "42" }));

    const report = await evaluateStory(makePlan(), "US-01");
    expect(report.criteria[0].evidence).toBe("hello world");
    expect(report.criteria[1].evidence).toBe("42");
  });

  it("returns INCONCLUSIVE when command exec fails", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "ok" }))
      .mockResolvedValueOnce(
        mockResult({ status: "INCONCLUSIVE", evidence: "Command execution failed: not found" }),
      );

    const report = await evaluateStory(makePlan(), "US-01");
    expect(report.verdict).toBe("INCONCLUSIVE");
    expect(report.criteria[1].status).toBe("INCONCLUSIVE");
  });

  it("FAIL takes priority over INCONCLUSIVE", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "INCONCLUSIVE", evidence: "err" }))
      .mockResolvedValueOnce(mockResult({ status: "FAIL", evidence: "bad" }));

    const report = await evaluateStory(makePlan(), "US-01");
    expect(report.verdict).toBe("FAIL");
  });

  it("returns PASS with warning for zero ACs", async () => {
    const plan = makePlan({
      stories: [
        { id: "US-01", title: "Empty", acceptanceCriteria: [] },
      ],
    });
    const report = await evaluateStory(plan, "US-01");
    expect(report.verdict).toBe("PASS");
    expect(report.criteria).toHaveLength(0);
    expect(report.warnings).toContain(
      "Story US-01 has 0 acceptance criteria — PASS verdict is vacuous",
    );
  });

  it("assigns correct AC IDs from story", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "PASS" }))
      .mockResolvedValueOnce(mockResult({ status: "PASS" }));

    const report = await evaluateStory(makePlan(), "US-01");
    expect(report.criteria[0].id).toBe("AC-01");
    expect(report.criteria[1].id).toBe("AC-02");
  });

  it("passes timeout and cwd options to executor", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "PASS" }))
      .mockResolvedValueOnce(mockResult({ status: "PASS" }));

    await evaluateStory(makePlan(), "US-01", {
      timeoutMs: 5000,
      cwd: "/tmp",
    });

    expect(mockedExecute).toHaveBeenCalledWith(
      "echo ok",
      expect.objectContaining({ timeoutMs: 5000, cwd: "/tmp" }),
    );
  });

  it("does not include warnings field when no warnings", async () => {
    mockedExecute
      .mockResolvedValueOnce(mockResult({ status: "PASS" }))
      .mockResolvedValueOnce(mockResult({ status: "PASS" }));

    const report = await evaluateStory(makePlan(), "US-01");
    expect(report.warnings).toBeUndefined();
  });

  it("runs ACs sequentially", async () => {
    const callOrder: number[] = [];
    mockedExecute
      .mockImplementationOnce(async () => {
        callOrder.push(1);
        return mockResult({ status: "PASS" });
      })
      .mockImplementationOnce(async () => {
        callOrder.push(2);
        return mockResult({ status: "PASS" });
      });

    await evaluateStory(makePlan(), "US-01");
    expect(callOrder).toEqual([1, 2]);
  });
});
