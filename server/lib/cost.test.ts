import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CostTracker, PRICING_LAST_UPDATED } from "./cost.js";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CostTracker", () => {
  it("reports tokens and estimated USD for known models", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", 1_000_000, 500_000, "claude-sonnet-4-6");

    expect(tracker.totalInputTokens).toBe(1_000_000);
    expect(tracker.totalOutputTokens).toBe(500_000);
    // sonnet: 1M * 3.0/M + 0.5M * 15.0/M = 3.0 + 7.5 = 10.5
    expect(tracker.totalCostUsd).toBeCloseTo(10.5);
  });

  it("accumulates across multiple stages", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", 100, 50, "claude-sonnet-4-6");
    tracker.recordUsage("critic", 200, 100, "claude-sonnet-4-6");

    expect(tracker.totalInputTokens).toBe(300);
    expect(tracker.totalOutputTokens).toBe(150);
  });

  it("returns null cost for unknown models", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", 100, 50, "unknown-model-xyz");

    expect(tracker.totalInputTokens).toBe(100);
    expect(tracker.totalCostUsd).toBeNull();
  });

  it("warns on missing token data and records null cost", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", null, null);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Missing token data"),
    );
    expect(tracker.totalCostUsd).toBeNull();
  });

  it("warns on undefined token data", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", undefined, 50);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Missing token data"),
    );
  });

  it("reports isOverBudget when total exceeds budget", () => {
    const tracker = new CostTracker({ budgetUsd: 0.001 });
    tracker.recordUsage("planner", 1_000_000, 500_000, "claude-sonnet-4-6");

    expect(tracker.isOverBudget()).toBe(true);
  });

  it("reports not over budget when under limit", () => {
    const tracker = new CostTracker({ budgetUsd: 100 });
    tracker.recordUsage("planner", 100, 50, "claude-sonnet-4-6");

    expect(tracker.isOverBudget()).toBe(false);
  });

  it("returns false for isOverBudget when no budget set", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", 100, 50, "claude-sonnet-4-6");

    expect(tracker.isOverBudget()).toBe(false);
  });

  it("reports remaining budget in USD", () => {
    const tracker = new CostTracker({ budgetUsd: 100 });
    tracker.recordUsage("planner", 1_000_000, 0, "claude-sonnet-4-6");

    // Used $3.0, remaining = $97.0
    expect(tracker.remainingBudgetUsd()).toBeCloseTo(97.0);
  });

  it("returns null for remainingBudgetUsd when no budget set", () => {
    const tracker = new CostTracker();
    expect(tracker.remainingBudgetUsd()).toBeNull();
  });

  it("includes OAuth label in summary", () => {
    const tracker = new CostTracker({ isOAuth: true });
    const summary = tracker.summarize();

    expect(summary.isOAuthAuth).toBe(true);
  });

  it("provides stage breakdown in summary", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", 100, 50, "claude-sonnet-4-6");
    tracker.recordUsage("critic", 200, 100, "claude-sonnet-4-6");

    const summary = tracker.summarize();
    expect(summary.breakdown).toHaveLength(2);
    expect(summary.breakdown[0].stage).toBe("planner");
    expect(summary.breakdown[1].stage).toBe("critic");
  });

  it("defaults to sonnet pricing when no model specified", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", 1_000_000, 0);

    // sonnet input: 1M * 3.0/M = 3.0
    expect(tracker.totalCostUsd).toBeCloseTo(3.0);
  });

  it("has a valid PRICING_LAST_UPDATED date", () => {
    const date = new Date(PRICING_LAST_UPDATED);
    expect(date.toString()).not.toBe("Invalid Date");
  });
});
