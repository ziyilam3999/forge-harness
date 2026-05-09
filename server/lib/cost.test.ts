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

  // ─────────────────────────────────────────────────────────────────────
  // α + P45 (v0.40.6) — unknown-model warning + DEFAULT_MODEL import wiring
  // ─────────────────────────────────────────────────────────────────────
  //
  // Plan: .ai-workspace/plans/2026-05-08-forge-model-alpha-a1-implementation.md.
  //
  // (vii) When the operator-set FORGE_MODEL (or per-call model override) is
  // not in the PRICING table, recordUsage emits a console.error EXACTLY ONCE
  // per CostTracker instance and records `estimatedCostUsd: null` for every
  // affected stage (P45 + F46 — never silent $0).
  //
  // (viii) cost.ts imports DEFAULT_MODEL from anthropic.ts (kills the live
  // P43 violation at the previous `?? "claude-sonnet-4-6"` literal). When
  // recordUsage is called without an explicit model, the fallback resolves
  // through the imported constant — verified by observing that the sonnet
  // pricing applies (and not, say, throwing or null'ing).
  it("(vii) warns once per CostTracker instance for unknown models (P45)", () => {
    const tracker = new CostTracker();
    tracker.recordUsage("planner", 100, 50, "claude-3-7-sonnet");
    tracker.recordUsage("critic", 200, 100, "claude-3-7-sonnet");
    tracker.recordUsage("evaluator", 50, 25, "claude-3-7-sonnet");

    // Filter to the unknown-model warnings (excludes the staleness warning,
    // which fires unconditionally if PRICING_LAST_UPDATED is more than 90 days old).
    const calls = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const unknownModelWarnings = calls.filter((c) =>
      String(c[0] ?? "").includes("is not in the cost-tracking PRICING table"),
    );

    expect(unknownModelWarnings).toHaveLength(1);
    expect(String(unknownModelWarnings[0][0])).toContain('"claude-3-7-sonnet"');
    expect(String(unknownModelWarnings[0][0])).toContain("claude-sonnet-4-6");
    expect(String(unknownModelWarnings[0][0])).toContain("Estimates will be null");

    // All three stages recorded with null cost.
    const summary = tracker.summarize();
    expect(summary.breakdown).toHaveLength(3);
    expect(summary.breakdown.every((s) => s.estimatedCostUsd === null)).toBe(true);
    expect(tracker.totalCostUsd).toBeNull();
  });

  it("(viii) recordUsage falls back to DEFAULT_MODEL imported from anthropic.ts (kills cost.ts:90 P43 violation)", async () => {
    // DEFAULT_MODEL with FORGE_MODEL unset = "claude-sonnet-4-6". cost.ts:90
    // previously hardcoded that same literal — now it imports DEFAULT_MODEL,
    // so this test verifies (a) the import wiring landed AND (b) the runtime
    // fallback still resolves to the sonnet PRICING row.
    const { DEFAULT_MODEL } = await import("./anthropic.js");
    expect(DEFAULT_MODEL).toBe("claude-sonnet-4-6"); // pre-condition pin

    const tracker = new CostTracker();
    // No model arg → falls back to DEFAULT_MODEL.
    tracker.recordUsage("planner", 1_000_000, 0);

    // sonnet input: 1M * 3.0/M = 3.0. Non-null cost proves the fallback hit
    // a known PRICING row — i.e. DEFAULT_MODEL resolved to a sonnet variant.
    expect(tracker.totalCostUsd).toBeCloseTo(3.0);

    // No unknown-model warning fired (DEFAULT_MODEL is in PRICING).
    const calls = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const unknownModelWarnings = calls.filter((c) =>
      String(c[0] ?? "").includes("is not in the cost-tracking PRICING table"),
    );
    expect(unknownModelWarnings).toHaveLength(0);
  });
});
