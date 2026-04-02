import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/evaluator.js", () => ({
  evaluateStory: vi.fn(),
}));

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

describe("handleEvaluate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

    // Should succeed because planJson is used, not planPath
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
});
