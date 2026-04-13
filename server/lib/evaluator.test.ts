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

  // Q0.5/A1b — ac-lint short-circuit in story mode.
  describe("ac-lint short-circuit", () => {
    it("suspect AC is SKIPPED with reliability=suspect; no subprocess spawned", async () => {
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Suspect",
            acceptanceCriteria: [
              {
                id: "AC-01",
                description: "bad vitest count grep",
                command:
                  "npx vitest run foo.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'",
              },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01");
      expect(mockedExecute).not.toHaveBeenCalled();
      expect(report.criteria[0].status).toBe("SKIPPED");
      expect(report.criteria[0].reliability).toBe("suspect");
      expect(report.criteria[0].evidence).toContain("ac-lint: suspect");
      expect(report.criteria[0].evidence).toContain("F55-vitest-count-grep");
      // Q0.5/#168 — SKIPPED+suspect must NOT laundry to PASS.
      expect(report.verdict).toBe("INCONCLUSIVE");
    });

    // Q0.5/#168 — computeVerdict aggregation tests for suspect-skipped ACs.
    it("#168: all-suspect story returns INCONCLUSIVE, not PASS", async () => {
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "All suspect",
            acceptanceCriteria: [
              {
                id: "AC-01",
                description: "bad count grep",
                command: "npx vitest run foo.test.ts | grep -qE 'Tests[[:space:]]+[5-9]'",
              },
              {
                id: "AC-02",
                description: "lone passed grep",
                command: "npx vitest run | grep -q 'passed'",
              },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01");
      expect(mockedExecute).not.toHaveBeenCalled();
      expect(report.verdict).toBe("INCONCLUSIVE");
      expect(report.criteria.every((c) => c.status === "SKIPPED")).toBe(true);
    });

    it("#168: mixed PASS + suspect returns INCONCLUSIVE (suspect poisons)", async () => {
      mockedExecute.mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "ok" }));
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Mixed",
            acceptanceCriteria: [
              { id: "AC-01", description: "clean", command: "npx tsc --noEmit" },
              {
                id: "AC-02",
                description: "bad count grep",
                command: "npx vitest run foo.test.ts | grep -qE 'Tests[[:space:]]+[5-9]'",
              },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01");
      expect(report.verdict).toBe("INCONCLUSIVE");
    });

    it("#168: FAIL + suspect returns FAIL (hard fail wins over suspect)", async () => {
      mockedExecute.mockResolvedValueOnce(mockResult({ status: "FAIL", evidence: "bad" }));
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Fail + suspect",
            acceptanceCriteria: [
              { id: "AC-01", description: "clean fail", command: "npx tsc --noEmit" },
              {
                id: "AC-02",
                description: "bad count grep",
                command: "npx vitest run foo.test.ts | grep -qE 'Tests[[:space:]]+[5-9]'",
              },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01");
      expect(report.verdict).toBe("FAIL");
    });

    it("#168: INCONCLUSIVE + suspect returns INCONCLUSIVE (no regression)", async () => {
      mockedExecute.mockResolvedValueOnce(
        mockResult({ status: "INCONCLUSIVE", evidence: "timeout" }),
      );
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Inconclusive + suspect",
            acceptanceCriteria: [
              { id: "AC-01", description: "clean inconclusive", command: "npx tsc --noEmit" },
              {
                id: "AC-02",
                description: "bad count grep",
                command: "npx vitest run foo.test.ts | grep -qE 'Tests[[:space:]]+[5-9]'",
              },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01");
      expect(report.verdict).toBe("INCONCLUSIVE");
    });

    it("clean AC runs normally with reliability=trusted", async () => {
      mockedExecute.mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "ok" }));
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Clean",
            acceptanceCriteria: [
              { id: "AC-01", description: "clean", command: "npx tsc --noEmit" },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01");
      expect(mockedExecute).toHaveBeenCalledTimes(1);
      expect(report.criteria[0].status).toBe("PASS");
      expect(report.criteria[0].reliability).toBe("trusted");
    });

    it("exempt AC runs normally even though pattern matches", async () => {
      mockedExecute.mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "ok" }));
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Exempt",
            acceptanceCriteria: [
              {
                id: "AC-01",
                description: "exempt lone passed-grep",
                command: "npx vitest run | grep -q 'passed'",
                lintExempt: { ruleId: "F56-passed-grep", rationale: "reviewed" },
              },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01");
      expect(mockedExecute).toHaveBeenCalledTimes(1);
      expect(report.criteria[0].status).toBe("PASS");
      expect(report.criteria[0].reliability).toBe("trusted");
    });
  });

  // Q0.5/C2 — flaky field retry semantics.
  describe("flaky retry (C2)", () => {
    function flakyPlan(flaky: boolean, command = "echo ok"): ExecutionPlan {
      return {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Flaky",
            acceptanceCriteria: [
              { id: "AC-01", description: "maybe flaky", command, flaky },
            ],
          },
        ],
      };
    }

    it("flaky AC: run-1 FAIL + run-2 PASS → PASS with reliability=suspect", async () => {
      mockedExecute
        .mockResolvedValueOnce(mockResult({ status: "FAIL", evidence: "first fail" }))
        .mockResolvedValueOnce(mockResult({ status: "PASS", evidence: "retry ok" }));

      const report = await evaluateStory(flakyPlan(true), "US-01", {
        flakyRetryGapMs: 1,
      });
      expect(mockedExecute).toHaveBeenCalledTimes(2);
      expect(report.verdict).toBe("PASS");
      expect(report.criteria[0].status).toBe("PASS");
      expect(report.criteria[0].reliability).toBe("suspect");
      expect(report.criteria[0].evidence).toContain("flaky-retry");
      expect(report.criteria[0].evidence).toContain("retry ok");
    });

    it("flaky AC: both runs FAIL → FAIL, reliability=trusted", async () => {
      mockedExecute
        .mockResolvedValueOnce(mockResult({ status: "FAIL", evidence: "first fail" }))
        .mockResolvedValueOnce(mockResult({ status: "FAIL", evidence: "second fail" }));

      const report = await evaluateStory(flakyPlan(true), "US-01", {
        flakyRetryGapMs: 1,
      });
      expect(mockedExecute).toHaveBeenCalledTimes(2);
      expect(report.verdict).toBe("FAIL");
      expect(report.criteria[0].status).toBe("FAIL");
      expect(report.criteria[0].reliability).toBe("trusted");
      expect(report.criteria[0].evidence).toContain("both runs FAIL");
      expect(report.criteria[0].evidence).toContain("first fail");
    });

    it("flaky AC: run-1 PASS → no retry spawned", async () => {
      mockedExecute.mockResolvedValueOnce(
        mockResult({ status: "PASS", evidence: "clean ok" }),
      );

      const report = await evaluateStory(flakyPlan(true), "US-01", {
        flakyRetryGapMs: 1,
      });
      expect(mockedExecute).toHaveBeenCalledTimes(1);
      expect(report.verdict).toBe("PASS");
      expect(report.criteria[0].reliability).toBe("trusted");
      expect(report.criteria[0].evidence).toBe("clean ok");
    });

    it("lint-flagged AC with flaky:true → A1b short-circuit wins, no retry", async () => {
      const plan: ExecutionPlan = {
        schemaVersion: "3.0.0",
        stories: [
          {
            id: "US-01",
            title: "Lint-flagged + flaky",
            acceptanceCriteria: [
              {
                id: "AC-01",
                description: "bad count grep marked flaky",
                command: "npx vitest run foo.test.ts | grep -qE 'Tests[[:space:]]+[5-9]'",
                flaky: true,
              },
            ],
          },
        ],
      };
      const report = await evaluateStory(plan, "US-01", { flakyRetryGapMs: 1 });
      expect(mockedExecute).not.toHaveBeenCalled();
      expect(report.criteria[0].status).toBe("SKIPPED");
      expect(report.criteria[0].reliability).toBe("suspect");
      expect(report.verdict).toBe("INCONCLUSIVE");
    });

    it("flaky AC: run-1 INCONCLUSIVE → passes through, no retry spawned", async () => {
      mockedExecute.mockResolvedValueOnce(
        mockResult({ status: "INCONCLUSIVE", evidence: "spawn ENOENT" }),
      );

      const report = await evaluateStory(flakyPlan(true), "US-01", {
        flakyRetryGapMs: 1,
      });
      expect(mockedExecute).toHaveBeenCalledTimes(1);
      expect(report.verdict).toBe("INCONCLUSIVE");
      expect(report.criteria[0].status).toBe("INCONCLUSIVE");
      expect(report.criteria[0].reliability).toBe("trusted");
      expect(report.criteria[0].evidence).toBe("spawn ENOENT");
      expect(report.criteria[0].evidence).not.toContain("flaky-retry");
    });

    it("flaky AC: run-1 FAIL + run-2 INCONCLUSIVE → INCONCLUSIVE with accurate evidence prefix", async () => {
      mockedExecute
        .mockResolvedValueOnce(mockResult({ status: "FAIL", evidence: "first fail" }))
        .mockResolvedValueOnce(
          mockResult({ status: "INCONCLUSIVE", evidence: "retry ENOENT" }),
        );

      const report = await evaluateStory(flakyPlan(true), "US-01", {
        flakyRetryGapMs: 1,
      });
      expect(mockedExecute).toHaveBeenCalledTimes(2);
      expect(report.criteria[0].status).toBe("INCONCLUSIVE");
      expect(report.criteria[0].evidence).toContain("run-1 FAIL, run-2 INCONCLUSIVE");
      expect(report.criteria[0].evidence).not.toContain("both runs FAIL");
    });

    it("non-flaky AC: run-1 FAIL → FAIL, no retry (regression guard)", async () => {
      mockedExecute.mockResolvedValueOnce(
        mockResult({ status: "FAIL", evidence: "real fail" }),
      );

      const report = await evaluateStory(flakyPlan(false), "US-01", {
        flakyRetryGapMs: 1,
      });
      expect(mockedExecute).toHaveBeenCalledTimes(1);
      expect(report.verdict).toBe("FAIL");
      expect(report.criteria[0].status).toBe("FAIL");
      expect(report.criteria[0].evidence).toBe("real fail");
      expect(report.criteria[0].evidence).not.toContain("flaky-retry");
    });
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
