import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressReporter } from "./progress.js";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProgressReporter", () => {
  it("logs stage progress to stderr with correct count", () => {
    const reporter = new ProgressReporter("forge_plan", [
      "Scanning codebase",
      "Running planner",
      "Running critic",
    ]);

    reporter.begin("Running planner");
    expect(console.error).toHaveBeenCalledWith(
      "forge_plan: [2/3] Running planner...",
    );
  });

  it("logs first stage as [1/N]", () => {
    const reporter = new ProgressReporter("forge_plan", [
      "Scanning codebase",
      "Running planner",
    ]);

    reporter.begin("Scanning codebase");
    expect(console.error).toHaveBeenCalledWith(
      "forge_plan: [1/2] Scanning codebase...",
    );
  });

  it("tracks completed stages with duration", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.begin("Stage A");
    reporter.complete("Stage A");

    const results = reporter.getResults();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Stage A");
    expect(results[0].status).toBe("completed");
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("tracks failed stages", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.begin("Stage A");
    reporter.fail("Stage A");

    const results = reporter.getResults();
    expect(results[0].status).toBe("failed");
  });

  it("tracks skipped stages with 0 duration", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.skip("Stage A");

    const results = reporter.getResults();
    expect(results[0].status).toBe("skipped");
    expect(results[0].durationMs).toBe(0);
  });

  it("handles unknown stages by appending dynamically", () => {
    const reporter = new ProgressReporter("forge_plan", ["Stage A"]);
    reporter.begin("Unexpected Stage");

    expect(console.error).toHaveBeenCalledWith(
      "forge_plan: [2/2] Unexpected Stage...",
    );
    expect(reporter.totalStages).toBe(2);
  });

  it("reports correct total stages", () => {
    const reporter = new ProgressReporter("forge_plan", [
      "A", "B", "C", "D",
    ]);
    expect(reporter.totalStages).toBe(4);
  });
});
