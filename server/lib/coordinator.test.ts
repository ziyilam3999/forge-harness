import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RunRecord } from "./run-record.js";
import type { ExecutionPlan, Story } from "../types/execution-plan.js";
import type { EvalReport } from "../types/eval-report.js";
import type { PrimaryRecord, GeneratorRecord } from "./run-reader.js";

// Mock readRunRecords and readAuditEntries so we control the fixture data
vi.mock("./run-reader.js", () => ({
  readRunRecords: vi.fn(async () => []),
  readAuditEntries: vi.fn(async () => []),
}));

import { readRunRecords, readAuditEntries } from "./run-reader.js";
import { assessPhase, aggregateStatus, checkBudget, checkTimeBudget, collectReplanningNotes, graduateFindings, reconcileState, recoverState } from "./coordinator.js";

const mockedReadRunRecords = vi.mocked(readRunRecords);
const mockedReadAuditEntries = vi.mocked(readAuditEntries);

function makeStory(id: string, deps?: string[]): Story {
  return {
    id,
    title: `Story ${id}`,
    dependencies: deps,
    acceptanceCriteria: [{ id: `${id}-AC01`, description: "check", command: "echo ok" }],
  };
}

function makePlan(stories: Story[]): ExecutionPlan {
  return { schemaVersion: "3.0.0", stories };
}

function makePrimaryRecord(storyId: string, verdict: "PASS" | "FAIL" | "INCONCLUSIVE", timestamp: string, evalReport?: EvalReport): PrimaryRecord {
  const record: RunRecord = {
    timestamp,
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    storyId,
    evalVerdict: verdict,
    evalReport: evalReport ?? undefined,
    metrics: {
      inputTokens: 100,
      outputTokens: 50,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: 1000,
    },
    outcome: "success",
  };
  return { source: "primary", record };
}

function makePrimaryRecordWithCost(storyId: string, verdict: "PASS" | "FAIL" | "INCONCLUSIVE", timestamp: string, costUsd: number | null | undefined): PrimaryRecord {
  const record: RunRecord = {
    timestamp,
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    storyId,
    evalVerdict: verdict,
    metrics: {
      inputTokens: 100,
      outputTokens: 50,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: 1000,
      estimatedCostUsd: costUsd,
    },
    outcome: "success",
  };
  return { source: "primary", record };
}

function makePrimaryRecordWithEscalation(storyId: string, verdict: "PASS" | "FAIL" | "INCONCLUSIVE", timestamp: string, escalationReason: string): PrimaryRecord {
  const record: RunRecord = {
    timestamp,
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    storyId,
    evalVerdict: verdict,
    escalationReason,
    metrics: {
      inputTokens: 100,
      outputTokens: 50,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: 1000,
    },
    outcome: "success",
  };
  return { source: "primary", record };
}

function makeGeneratorRecord(storyId: string, timestamp: string): GeneratorRecord {
  return {
    source: "generator",
    record: {
      timestamp,
      storyId,
      iteration: 0,
      action: "implement",
      score: 0.5,
      durationMs: 1000,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assessPhase", () => {
  it("empty phase returns complete status with empty arrays", async () => {
    const result = await assessPhase(makePlan([]), "/tmp/test");
    expect(result.brief.status).toBe("complete");
    expect(result.brief.stories).toEqual([]);
    expect(result.brief.readyStories).toEqual([]);
    expect(result.brief.failedStories).toEqual([]);
    expect(result.brief.depFailedStories).toEqual([]);
    expect(result.brief.completedCount).toBe(0);
    expect(result.brief.totalCount).toBe(0);
    expect(result.mode).toBe("advisory");
  });

  it("fresh plan first call: root stories are ready, dependents are pending", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
      makeStory("US-03", ["US-02"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([]);

    const result = await assessPhase(plan, "/tmp/test");
    const statusById = new Map(result.brief.stories.map((s) => [s.storyId, s]));

    expect(statusById.get("US-01")!.status).toBe("ready");
    expect(statusById.get("US-02")!.status).toBe("pending");
    expect(statusById.get("US-03")!.status).toBe("pending");
    expect(result.brief.status).toBe("in-progress");
    expect(result.brief.readyStories).toContain("US-01");
  });

  it("done-after-retry precedence: 3 FAIL then PASS → done, retryCount 3, retriesRemaining 0", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:03:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories[0];

    expect(entry.status).toBe("done");
    expect(entry.retryCount).toBe(3);
    expect(entry.retriesRemaining).toBe(0);
  });

  it("retry counter re-derivation: 3 calls return identical retryCount", async () => {
    const plan = makePlan([makeStory("US-07")]);
    const records = [
      makePrimaryRecord("US-07", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-07", "FAIL", "2026-01-01T00:01:00Z"),
    ];

    mockedReadRunRecords
      .mockResolvedValueOnce([...records])
      .mockResolvedValueOnce([...records])
      .mockResolvedValueOnce([...records]);

    const r1 = await assessPhase(plan, "/tmp/test");
    const r2 = await assessPhase(plan, "/tmp/test");
    const r3 = await assessPhase(plan, "/tmp/test");

    expect(r1.brief.stories[0].retryCount).toBe(2);
    expect(r2.brief.stories[0].retryCount).toBe(2);
    expect(r3.brief.stories[0].retryCount).toBe(2);
  });

  it("INCONCLUSIVE counts toward retry budget: 1 FAIL + 1 INCONCLUSIVE → retryCount 2", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "INCONCLUSIVE", "2026-01-01T00:01:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories[0];

    expect(entry.retryCount).toBe(2);
    expect(entry.retriesRemaining).toBe(1);
    expect(entry.status).toBe("ready-for-retry");
  });

  it("dep-failed-dominates-failed: US-01 failed, US-02 (deps:[US-01], 3 FAIL) → dep-failed (rule 2 > rule 3)", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      // US-01: 3 failures → failed
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      // US-02: 3 failures of its own
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:03:00Z"),
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:04:00Z"),
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:05:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const statusById = new Map(result.brief.stories.map((s) => [s.storyId, s]));

    expect(statusById.get("US-01")!.status).toBe("failed");
    expect(statusById.get("US-02")!.status).toBe("dep-failed");
  });

  it("transitive dep-failed chain: US-01 failed → US-02 → US-03 both dep-failed", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
      makeStory("US-03", ["US-02"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const statusById = new Map(result.brief.stories.map((s) => [s.storyId, s]));

    expect(statusById.get("US-01")!.status).toBe("failed");
    expect(statusById.get("US-02")!.status).toBe("dep-failed");
    expect(statusById.get("US-03")!.status).toBe("dep-failed");
    expect(result.brief.depFailedStories).toContain("US-02");
    expect(result.brief.depFailedStories).toContain("US-03");
    expect(result.brief.status).toBe("needs-replan");
  });

  it("generator records are ignored for classification", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      // Only generator records — should be ignored
      makeGeneratorRecord("US-01", "2026-01-01T00:00:00Z"),
      makeGeneratorRecord("US-01", "2026-01-01T00:01:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    // With no primary records, US-01 should be "ready" (never attempted)
    expect(result.brief.stories[0].status).toBe("ready");
    expect(result.brief.stories[0].retryCount).toBe(0);
  });

  it("ready-for-retry populates priorEvalReport from most recent record", async () => {
    const evalReport: EvalReport = {
      storyId: "US-01",
      verdict: "FAIL",
      criteria: [{ id: "AC-01", status: "FAIL", evidence: "error output" }],
    };
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z", evalReport),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories[0];

    expect(entry.status).toBe("ready-for-retry");
    expect(entry.priorEvalReport).toBeDefined();
    expect(entry.priorEvalReport!.criteria[0].evidence).toBe("error output");
  });

  it("happy path: 2 done + 3 ready → in-progress with correct counts", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02"),
      makeStory("US-03"),
      makeStory("US-04"),
      makeStory("US-05"),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-02", "PASS", "2026-01-01T00:01:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.completedCount).toBe(2);
    expect(result.brief.totalCount).toBe(5);
    expect(result.brief.readyStories).toHaveLength(3);
    expect(result.brief.status).toBe("in-progress");
    expect(result.brief.recommendation.length).toBeGreaterThan(0);
  });

  it("all stories done → complete status", async () => {
    const plan = makePlan([makeStory("US-01"), makeStory("US-02")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-02", "PASS", "2026-01-01T00:01:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.status).toBe("complete");
    expect(result.brief.completedCount).toBe(2);
  });

  it("all-failed → needs-replan with blocking replanning notes", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.status).toBe("needs-replan");
    expect(result.brief.replanningNotes.length).toBeGreaterThan(0);
    expect(result.brief.replanningNotes.some((n) => n.severity === "blocking")).toBe(true);
    expect(result.brief.recommendation).toContain("US-01");
  });

  it("mixed-failed: 1 failed + 4 ready → needs-replan (rule 3 dominates)", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02"),
      makeStory("US-03"),
      makeStory("US-04"),
      makeStory("US-05"),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.status).toBe("needs-replan");
    expect(result.brief.failedStories).toContain("US-01");
    expect(result.brief.readyStories).toHaveLength(4);
  });

  it("LAST RETRY: recommendation contains 'LAST RETRY: <storyId>' when retriesRemaining === 1", async () => {
    const plan = makePlan([makeStory("US-01")]);
    // 2 FAIL records → retryCount=2, retriesRemaining=1
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.stories[0].retriesRemaining).toBe(1);
    expect(result.brief.recommendation).toMatch(/LAST RETRY: US-01/);
  });

  it("depFailedStories is populated from dep-failed entries", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
      makeStory("US-03", ["US-01"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.depFailedStories).toContain("US-02");
    expect(result.brief.depFailedStories).toContain("US-03");
    expect(result.brief.depFailedStories).toHaveLength(2);
  });

  it("priorEvalReport provenance: two FAIL records → priorEvalReport matches the newest", async () => {
    const oldReport: EvalReport = {
      storyId: "US-01",
      verdict: "FAIL",
      criteria: [{ id: "AC-01", status: "FAIL", evidence: "old evidence" }],
    };
    const newReport: EvalReport = {
      storyId: "US-01",
      verdict: "FAIL",
      criteria: [{ id: "AC-01", status: "FAIL", evidence: "new evidence" }],
    };
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z", oldReport),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z", newReport),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories[0];
    expect(entry.priorEvalReport!.criteria[0].evidence).toBe("new evidence");
  });

  it("NFR-C02 deterministic dispatch: two calls on identical inputs return structurally equal results", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
    ]);
    const records = [
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:01:00Z"),
    ];
    mockedReadRunRecords
      .mockResolvedValueOnce([...records])
      .mockResolvedValueOnce([...records]);

    const r1 = await assessPhase(plan, "/tmp/test");
    const r2 = await assessPhase(plan, "/tmp/test");

    // Compare brief structure (excluding any non-deterministic fields).
    // timeBudget.elapsedMs is Date.now()-derived when priorRecords drive the start
    // (2026-04-20 dashboard fix); keep only the deterministic fields for comparison.
    const strip = (brief: typeof r1.brief) => ({
      ...brief,
      timeBudget: {
        maxTimeMs: brief.timeBudget.maxTimeMs,
        warningLevel: brief.timeBudget.warningLevel,
      },
    });
    expect(JSON.stringify(strip(r1.brief))).toBe(JSON.stringify(strip(r2.brief)));
  });

  it("NFR-C08: Object.keys of every StoryStatusEntry returns identical sorted key set across all 6 statuses", async () => {
    // Build a plan that produces all 6 status values
    const plan = makePlan([
      makeStory("US-DONE"),
      makeStory("US-READY"),
      makeStory("US-RETRY"),
      makeStory("US-FAILED"),
      makeStory("US-DEP-FAILED", ["US-FAILED"]),
      makeStory("US-PENDING", ["US-RETRY"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-DONE", "PASS", "2026-01-01T00:00:00Z"),
      // US-READY: no records → ready
      // US-RETRY: 1 FAIL → ready-for-retry
      makePrimaryRecord("US-RETRY", "FAIL", "2026-01-01T00:01:00Z"),
      // US-FAILED: 3 FAIL → failed
      makePrimaryRecord("US-FAILED", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-FAILED", "FAIL", "2026-01-01T00:03:00Z"),
      makePrimaryRecord("US-FAILED", "FAIL", "2026-01-01T00:04:00Z"),
      // US-DEP-FAILED: dep on US-FAILED → dep-failed
      // US-PENDING: dep on US-RETRY (not done) → pending
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const statusSet = new Set(result.brief.stories.map((s) => s.status));
    expect(statusSet).toEqual(new Set(["done", "ready", "ready-for-retry", "failed", "dep-failed", "pending"]));

    // All entries must have the exact same key set
    const keySets = result.brief.stories.map((s) => Object.keys(s).sort().join(","));
    const uniqueKeySets = new Set(keySets);
    expect(uniqueKeySets.size).toBe(1);
  });
});

describe("checkBudget", () => {
  it("checkBudget threshold: 79% → none, 80% → approaching, 100% → exceeded", () => {
    // 79% of $100 = $79
    const at79 = checkBudget(
      [makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 79)],
      100,
    );
    expect(at79.warningLevel).toBe("none");

    // 80% of $100 = $80
    const at80 = checkBudget(
      [makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 80)],
      100,
    );
    expect(at80.warningLevel).toBe("approaching");
    expect(at80.usedUsd).toBe(80);
    expect(at80.remainingUsd).toBe(20);

    // 100% of $100 = $100
    const at100 = checkBudget(
      [makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 100)],
      100,
    );
    expect(at100.warningLevel).toBe("exceeded");
    expect(at100.usedUsd).toBe(100);
    expect(at100.remainingUsd).toBe(0);
  });

  it("checkBudget undefined budget → warningLevel 'none', remainingUsd null, usedUsd still aggregates", () => {
    // Fixed 2026-04-20 (monday's dashboard report): aggregation now runs unconditionally
    // so the dashboard can display real spend even when no cap is set.
    const result = checkBudget(
      [makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 50)],
      undefined,
    );
    expect(result.warningLevel).toBe("none");
    expect(result.remainingUsd).toBeNull();
    expect(result.budgetUsd).toBeNull();
    expect(result.usedUsd).toBe(50);
  });

  it("checkBudget null-budget aggregation: sums primary-record costs across multiple records (dashboard fix)", () => {
    // Regression test for monday's 2026-04-20 dashboard zero-emit bug:
    // checkBudget must return a non-zero usedUsd whenever cost-bearing records
    // exist, even when no budget cap is supplied.
    const records = [
      makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 0.25),
      makePrimaryRecordWithCost("US-02", "PASS", "2026-01-01T00:01:00Z", 0.34),
      makeGeneratorRecord("US-03", "2026-01-01T00:02:00Z"),
    ];
    const result = checkBudget(records, undefined);
    expect(result.usedUsd).toBeCloseTo(0.59, 5);
    expect(result.budgetUsd).toBeNull();
    expect(result.remainingUsd).toBeNull();
    expect(result.warningLevel).toBe("none");
    expect(result.incompleteData).toBe(false);
  });

  it("checkBudget generator records excluded from budget sum", () => {
    const records = [
      makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 30),
      makeGeneratorRecord("US-01", "2026-01-01T00:01:00Z"),
      makeGeneratorRecord("US-02", "2026-01-01T00:02:00Z"),
      makePrimaryRecordWithCost("US-02", "PASS", "2026-01-01T00:03:00Z", 20),
    ];
    const result = checkBudget(records, 100);
    expect(result.usedUsd).toBe(50);
    expect(result.warningLevel).toBe("none");
  });

  it("incompleteData: null cost primary record excluded from sum, incompleteData true", () => {
    const records = [
      makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 30),
      makePrimaryRecordWithCost("US-02", "PASS", "2026-01-01T00:01:00Z", null),
      makePrimaryRecordWithCost("US-03", "PASS", "2026-01-01T00:02:00Z", 20),
    ];
    const result = checkBudget(records, 100);
    expect(result.usedUsd).toBe(50);
    expect(result.incompleteData).toBe(true);
  });

  it("null cost: undefined estimatedCostUsd sets incompleteData true", () => {
    const records = [
      makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", undefined),
    ];
    const result = checkBudget(records, 100);
    expect(result.usedUsd).toBe(0);
    expect(result.incompleteData).toBe(true);
  });

  it("NFR-C04: checkBudget never throws when budget exceeded — advisory only", () => {
    const records = [
      makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 200),
    ];
    // Must not throw
    const result = checkBudget(records, 100);
    expect(result.warningLevel).toBe("exceeded");
    expect(result.usedUsd).toBe(200);
    expect(result.remainingUsd).toBe(-100);
  });

  it("budget missing: no budget set → incompleteData false, warningLevel none", () => {
    const result = checkBudget([], undefined);
    expect(result.incompleteData).toBe(false);
    expect(result.warningLevel).toBe("none");
    expect(result.budgetUsd).toBeNull();
  });
});

describe("checkTimeBudget", () => {
  it("checkTimeBudget threshold: time 80% → approaching, time 100% → exceeded", () => {
    const now = Date.now();
    const maxTimeMs = 10000;

    // 79% elapsed → none
    const at79 = checkTimeBudget(now - 7900, maxTimeMs);
    expect(at79.warningLevel).toBe("none");

    // 80% elapsed → approaching
    const at80 = checkTimeBudget(now - 8000, maxTimeMs);
    expect(at80.warningLevel).toBe("approaching");

    // 100% elapsed → exceeded
    const at100 = checkTimeBudget(now - 10000, maxTimeMs);
    expect(at100.warningLevel).toBe("exceeded");
  });

  it("startTimeMs missing → elapsedMs 0, time unknown (NOT none)", () => {
    const result = checkTimeBudget(undefined, 10000);
    expect(result.elapsedMs).toBe(0);
    expect(result.warningLevel).toBe("unknown");
  });

  it("startTimeMs missing BUT priorRecords present → derives elapsed from earliest record timestamp (dashboard fix)", () => {
    // Regression test for monday's 2026-04-20 dashboard zero-emit bug:
    // when the caller doesn't track startTimeMs (e.g. forge_coordinate({planPath, phaseId})),
    // checkTimeBudget must fall back to the earliest primary-record timestamp so the
    // dashboard displays real elapsed time rather than "0m 00s".
    const records = [
      makePrimaryRecordWithCost("US-02", "PASS", "2026-01-01T00:05:00Z", 0.20),
      makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 0.30),
      makePrimaryRecordWithCost("US-03", "PASS", "2026-01-01T00:10:00Z", 0.10),
    ];
    const result = checkTimeBudget(undefined, 3_600_000, records);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.maxTimeMs).toBe(3_600_000);
    // warningLevel should be a concrete bucket (not "unknown") now that elapsed is derived.
    expect(result.warningLevel).not.toBe("unknown");
  });

  it("startTimeMs missing AND priorRecords empty → preserves elapsedMs 0, warningLevel unknown", () => {
    const result = checkTimeBudget(undefined, 10000, []);
    expect(result.elapsedMs).toBe(0);
    expect(result.warningLevel).toBe("unknown");
  });

  it("startTimeMs present is authoritative — priorRecords do not override caller's start time", () => {
    const callerStart = Date.now() - 5000;
    const records = [
      // Record timestamps from an hour ago — should NOT be used because caller provided startTimeMs.
      makePrimaryRecordWithCost("US-01", "PASS", new Date(Date.now() - 3_600_000).toISOString(), 0.10),
    ];
    const result = checkTimeBudget(callerStart, 10_000, records);
    // elapsed should be ~5000ms (from callerStart), not ~3_600_000ms (from records).
    expect(result.elapsedMs).toBeGreaterThanOrEqual(5000);
    expect(result.elapsedMs).toBeLessThan(10_000);
  });

  it("maxTimeMs missing → time no-op, warningLevel none", () => {
    const result = checkTimeBudget(Date.now() - 5000, undefined);
    expect(result.warningLevel).toBe("none");
    expect(result.maxTimeMs).toBeNull();
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it("checkTimeBudget never throws — pure computation with edge cases", () => {
    // Both missing
    expect(() => checkTimeBudget(undefined, undefined)).not.toThrow();
    // Zero maxTimeMs
    expect(() => checkTimeBudget(Date.now(), 0)).not.toThrow();
    // Negative elapsed (future start time)
    expect(() => checkTimeBudget(Date.now() + 100000, 10000)).not.toThrow();
    // Very large values
    expect(() => checkTimeBudget(0, Number.MAX_SAFE_INTEGER)).not.toThrow();
  });

  it("checkTimeBudget pure: both present, under 80% → warningLevel none", () => {
    const result = checkTimeBudget(Date.now() - 1000, 10000);
    expect(result.warningLevel).toBe("none");
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.maxTimeMs).toBe(10000);
  });
});

describe("INCONCLUSIVE handling", () => {
  it("exhaust mixed: 1 FAIL + 1 INCONCLUSIVE + 1 FAIL → retryCount 3, status failed", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "INCONCLUSIVE", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories[0];

    expect(entry.retryCount).toBe(3);
    expect(entry.status).toBe("failed");
    expect(entry.retriesRemaining).toBe(0);
  });

  it("three consecutive INCONCLUSIVE → retryCount 3, status failed (INCONCLUSIVE exhausts retry budget)", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "INCONCLUSIVE", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "INCONCLUSIVE", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "INCONCLUSIVE", "2026-01-01T00:02:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories[0];

    expect(entry.retryCount).toBe(3);
    expect(entry.status).toBe("failed");
  });

  it("dep ready-for-retry: downstream remains pending, NOT dep-failed", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
    ]);
    // US-01 has 1 FAIL → ready-for-retry (not terminal)
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const statusById = new Map(result.brief.stories.map((s) => [s.storyId, s]));

    expect(statusById.get("US-01")!.status).toBe("ready-for-retry");
    expect(statusById.get("US-02")!.status).toBe("pending");
    expect(result.brief.depFailedStories).not.toContain("US-02");
  });

  it("all failed → needs-replan: every story failed or dep-failed triggers needs-replan", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
    ]);
    // US-01: 3 failures → failed; US-02 depends on US-01 → dep-failed
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");

    expect(result.brief.status).toBe("needs-replan");
    expect(result.brief.failedStories).toContain("US-01");
    expect(result.brief.depFailedStories).toContain("US-02");
  });
});

describe("recoverState", () => {
  it("recoverState idempotent: crash-safe re-run produces same result as atomic write", async () => {
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
    ]);

    // Simulate "partial write" — only US-01's records exist (as if US-02 eval was killed mid-run)
    const partialRecords = [
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:00:00Z"),
    ];
    mockedReadRunRecords.mockResolvedValueOnce([...partialRecords]);
    const partialResult = await recoverState(plan, "/tmp/test");

    // Simulate "full write" — same records (US-02 never got a record, so same input)
    mockedReadRunRecords.mockResolvedValueOnce([...partialRecords]);
    const fullResult = await recoverState(plan, "/tmp/test");

    // Both runs must produce identical status maps
    expect(partialResult.get("US-01")!.status).toBe("done");
    expect(partialResult.get("US-02")!.status).toBe("ready");
    expect(fullResult.get("US-01")!.status).toBe(partialResult.get("US-01")!.status);
    expect(fullResult.get("US-02")!.status).toBe(partialResult.get("US-02")!.status);
  });

  it("recoverState idempotent: twice in a row on same inputs returns identical maps", async () => {
    const plan = makePlan([makeStory("US-01"), makeStory("US-02")]);
    const records = [
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:01:00Z"),
    ];
    mockedReadRunRecords
      .mockResolvedValueOnce([...records])
      .mockResolvedValueOnce([...records]);

    const r1 = await recoverState(plan, "/tmp/test");
    const r2 = await recoverState(plan, "/tmp/test");

    for (const [id, entry] of r1) {
      const other = r2.get(id)!;
      expect(entry.status).toBe(other.status);
      expect(entry.retryCount).toBe(other.retryCount);
      expect(entry.retriesRemaining).toBe(other.retriesRemaining);
    }
  });

  it("no-storyId record: missing storyId records are skipped without throwing", async () => {
    const plan = makePlan([makeStory("US-01")]);
    const recordWithoutStoryId: PrimaryRecord = {
      source: "primary",
      record: {
        timestamp: "2026-01-01T00:00:00Z",
        tool: "forge_evaluate",
        documentTier: null,
        mode: null,
        tier: null,
        // no storyId
        metrics: {
          inputTokens: 100, outputTokens: 50, critiqueRounds: 0,
          findingsTotal: 0, findingsApplied: 0, findingsRejected: 0,
          validationRetries: 0, durationMs: 1000,
        },
        outcome: "success",
      },
    };
    mockedReadRunRecords.mockResolvedValueOnce([
      recordWithoutStoryId,
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:01:00Z"),
    ]);

    // Should not throw
    const result = await recoverState(plan, "/tmp/test");
    expect(result.get("US-01")!.status).toBe("done");
  });

  it("priorEvalReport on failed story: populated from most recent non-PASS record", async () => {
    const evalReport: EvalReport = {
      storyId: "US-01",
      verdict: "FAIL",
      criteria: [{ id: "AC-01", status: "FAIL", evidence: "fatal error" }],
    };
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z", evalReport),
    ]);

    const result = await recoverState(plan, "/tmp/test");
    const entry = result.get("US-01")!;

    expect(entry.status).toBe("failed");
    expect(entry.priorEvalReport).toBeDefined();
    expect(entry.priorEvalReport!.criteria[0].evidence).toBe("fatal error");
  });

  it("no persistent state: recoverState is stateless — no coordinator state file on disk", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "PASS", "2026-01-01T00:00:00Z"),
    ]);

    const result = await recoverState(plan, "/tmp/test-stateless");
    expect(result.get("US-01")!.status).toBe("done");

    // Verify no state file was written — readRunRecords was our only I/O,
    // and recoverState itself performs no writes (pure function over read data)
    const { readdir } = await import("node:fs/promises");
    const forgeDir = (await import("node:path")).join("/tmp/test-stateless", ".forge");
    try {
      const entries = await readdir(forgeDir, { recursive: true });
      // No coordinator-specific state files should exist
      const stateFiles = entries.filter((e: string) =>
        e.includes("coordinator-state") || e.includes("coordinator.json"),
      );
      expect(stateFiles).toHaveLength(0);
    } catch {
      // .forge dir doesn't exist at all — that's fine, proves no state was written
    }
  });
});

describe("ReplanningNote v1.1 triggers", () => {
  it("retries-exhausted: one terminal-failed story emits exactly one ac-drift blocking note", async () => {
    const plan = makePlan([makeStory("US-01")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
    ]);
    const result = await assessPhase(plan, "/tmp/test");
    const retriesExhausted = result.brief.replanningNotes.filter(
      (n) => n.description.includes("retries-exhausted"),
    );
    expect(retriesExhausted).toHaveLength(1);
    expect(retriesExhausted[0].category).toBe("ac-drift");
    expect(retriesExhausted[0].severity).toBe("blocking");
    expect(retriesExhausted[0].affectedStories).toEqual(["US-01"]);
  });

  it("retries-exhausted: multiple terminal-failed stories emit multiple notes (one per story)", async () => {
    const plan = makePlan([makeStory("US-01"), makeStory("US-02")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:04:00Z"),
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:05:00Z"),
      makePrimaryRecord("US-02", "FAIL", "2026-01-01T00:06:00Z"),
    ]);
    const result = await assessPhase(plan, "/tmp/test");
    const retriesExhausted = result.brief.replanningNotes.filter(
      (n) => n.description.includes("retries-exhausted"),
    );
    expect(retriesExhausted).toHaveLength(2);
    expect(retriesExhausted.map((n) => n.affectedStories![0]).sort()).toEqual(["US-01", "US-02"]);
  });

  it("dep-failed-chain: ONE note per distinct root failed story with transitive closure", async () => {
    // US-01 (failed) → US-02 → US-03 (chain)
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
      makeStory("US-03", ["US-02"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
    ]);
    const result = await assessPhase(plan, "/tmp/test");
    const depFailedChain = result.brief.replanningNotes.filter(
      (n) => n.description.includes("dep-failed-chain"),
    );
    expect(depFailedChain).toHaveLength(1);
    expect(depFailedChain[0].category).toBe("assumption-changed");
    expect(depFailedChain[0].severity).toBe("blocking");
    expect(depFailedChain[0].affectedStories).toContain("US-01");
    expect(depFailedChain[0].affectedStories).toContain("US-02");
    expect(depFailedChain[0].affectedStories).toContain("US-03");
  });

  it("two independent dep-failed chains: two roots emit two dep-failed-chain notes", async () => {
    // Chain 1: US-01 (failed) → US-02, US-03
    // Chain 2: US-05 (failed) → US-06
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
      makeStory("US-03", ["US-01"]),
      makeStory("US-05"),
      makeStory("US-06", ["US-05"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
      makePrimaryRecord("US-05", "FAIL", "2026-01-01T00:04:00Z"),
      makePrimaryRecord("US-05", "FAIL", "2026-01-01T00:05:00Z"),
      makePrimaryRecord("US-05", "FAIL", "2026-01-01T00:06:00Z"),
    ]);
    const result = await assessPhase(plan, "/tmp/test");
    const depFailedChain = result.brief.replanningNotes.filter(
      (n) => n.description.includes("dep-failed-chain"),
    );
    expect(depFailedChain).toHaveLength(2);
    // Each chain note should have the root story in affectedStories
    const roots = depFailedChain.map((n) => n.affectedStories![0]).sort();
    expect(roots).toEqual(["US-01", "US-05"]);
  });

  it("both triggers fire: retries-exhausted AND dep-failed-chain emitted in same phase", async () => {
    // US-01 (failed) → US-02 (dep-failed)
    const plan = makePlan([
      makeStory("US-01"),
      makeStory("US-02", ["US-01"]),
    ]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
    ]);
    const result = await assessPhase(plan, "/tmp/test");
    const retriesExhausted = result.brief.replanningNotes.filter(
      (n) => n.description.includes("retries-exhausted"),
    );
    const depFailedChain = result.brief.replanningNotes.filter(
      (n) => n.description.includes("dep-failed-chain"),
    );
    expect(retriesExhausted.length).toBeGreaterThanOrEqual(1);
    expect(depFailedChain.length).toBeGreaterThanOrEqual(1);
    // Both are blocking
    expect(retriesExhausted[0].severity).toBe("blocking");
    expect(depFailedChain[0].severity).toBe("blocking");
  });
});

describe("collectReplanningNotes", () => {
  it("EscalationReason mapping: all 5 input values produce correct categories", () => {
    const notes = collectReplanningNotes([
      { escalationReason: "plateau", storyId: "US-01" },
      { escalationReason: "no-op", storyId: "US-02" },
      { escalationReason: "max-iterations", storyId: "US-03" },
      { escalationReason: "inconclusive", storyId: "US-04" },
      { escalationReason: "baseline-failed", storyId: "US-05" },
    ]);
    expect(notes).toHaveLength(5);
    expect(notes[0].category).toBe("partial-completion"); // plateau
    expect(notes[1].category).toBe("gap-found");          // no-op
    expect(notes[2].category).toBe("partial-completion"); // max-iterations
    expect(notes[3].category).toBe("gap-found");          // inconclusive
    expect(notes[4].category).toBe("assumption-changed"); // baseline-failed
  });

  it("FAIL eval verdict maps to ac-drift; INCONCLUSIVE maps to gap-found", () => {
    const notes = collectReplanningNotes([
      { evalVerdict: "FAIL", storyId: "US-01" },
      { evalVerdict: "INCONCLUSIVE", storyId: "US-02" },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0].category).toBe("ac-drift");
    expect(notes[0].severity).toBe("blocking");
    expect(notes[1].category).toBe("gap-found");
    expect(notes[1].severity).toBe("should-address");
  });

  it("PASS eval verdict produces no note", () => {
    const notes = collectReplanningNotes([
      { evalVerdict: "PASS", storyId: "US-01" },
    ]);
    expect(notes).toHaveLength(0);
  });

  it("unknown EscalationReason routes to gap-found with P45 console.error warning", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notes = collectReplanningNotes([
      { escalationReason: "never-heard-of-this", storyId: "US-99" },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].category).toBe("gap-found");
    expect(notes[0].severity).toBe("informational");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/WARNING: unknown EscalationReason routed to gap-found: never-heard-of-this/),
    );
    errorSpy.mockRestore();
  });

  it("blocking notes from FAIL verdict appear with blocking severity for routing summary", () => {
    const notes = collectReplanningNotes([
      { evalVerdict: "FAIL", storyId: "US-10" },
    ]);
    const blockingNotes = notes.filter((n) => n.severity === "blocking");
    expect(blockingNotes.length).toBeGreaterThanOrEqual(1);
    expect(blockingNotes[0].description).toContain("US-10");
  });
});

describe("aggregateStatus", () => {
  it("velocity is zero when zero completed stories (never NaN/Infinity)", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:00:00Z"),
    ]);
    const result = await aggregateStatus("/tmp/test");
    expect(result.velocityStoriesPerHour).toBe(0);
    expect(Number.isFinite(result.velocityStoriesPerHour)).toBe(true);
  });

  it("velocity is zero when zero elapsed time (same-millisecond records)", async () => {
    // With records all at the same time and completed, elapsed = now - earliest ≈ positive
    // But with zero records entirely, velocity = 0
    mockedReadRunRecords.mockResolvedValueOnce([]);
    const result = await aggregateStatus("/tmp/test");
    expect(result.velocityStoriesPerHour).toBe(0);
    expect(Number.isNaN(result.velocityStoriesPerHour)).toBe(false);
  });

  it("velocity computed only from PASS-verdict primary records", async () => {
    // 2 stories PASS, 1 FAIL — only 2 count toward velocity
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "PASS", hourAgo),
      makePrimaryRecord("US-02", "PASS", hourAgo),
      makePrimaryRecord("US-03", "FAIL", hourAgo),
      makeGeneratorRecord("US-01", hourAgo), // generator records should not count
    ]);
    const result = await aggregateStatus("/tmp/test");
    // 2 completed / ~1 hour ≈ 2 (allow some tolerance)
    expect(result.velocityStoriesPerHour).toBeGreaterThan(1.5);
    expect(result.velocityStoriesPerHour).toBeLessThan(2.5);
  });

  it("accumulatedCostUsd excludes null estimatedCostUsd records and sets incompleteData", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 1.50),
      makePrimaryRecordWithCost("US-02", "PASS", "2026-01-01T00:01:00Z", null),
      makePrimaryRecordWithCost("US-03", "PASS", "2026-01-01T00:02:00Z", 2.00),
    ]);
    const result = await aggregateStatus("/tmp/test");
    expect(result.accumulatedCostUsd).toBe(3.50);
    expect(result.incompleteData).toBe(true);
  });

  it("includeAudit true returns auditEntries array; default false has no auditEntries", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([]);
    mockedReadAuditEntries.mockResolvedValueOnce([{ action: "test" }]);
    const withAudit = await aggregateStatus("/tmp/test", { includeAudit: true });
    expect(withAudit.auditEntries).toBeDefined();
    expect(withAudit.auditEntries).toHaveLength(1);

    mockedReadRunRecords.mockResolvedValueOnce([]);
    const withoutAudit = await aggregateStatus("/tmp/test", { includeAudit: false });
    expect(withoutAudit.auditEntries).toBeUndefined();
  });
});

describe("graduateFindings", () => {
  it("distinct-storyId dedup: 3 records same storyId same escalation → findings empty (count: 1 < 3)", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecordWithEscalation("US-05", "FAIL", "2026-01-01T00:01:00Z", "plateau"),
      makePrimaryRecordWithEscalation("US-05", "FAIL", "2026-01-01T00:02:00Z", "plateau"),
      makePrimaryRecordWithEscalation("US-05", "FAIL", "2026-01-01T00:03:00Z", "plateau"),
    ]);
    const result = await graduateFindings("/tmp/test");
    expect(result.findings).toHaveLength(0);
  });

  it("threshold: 3 records with three distinct story IDs all escalation plateau → findings has one entry with count 3", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecordWithEscalation("US-01", "FAIL", "2026-01-01T00:01:00Z", "plateau"),
      makePrimaryRecordWithEscalation("US-02", "FAIL", "2026-01-01T00:02:00Z", "plateau"),
      makePrimaryRecordWithEscalation("US-03", "FAIL", "2026-01-01T00:03:00Z", "plateau"),
    ]);
    const result = await graduateFindings("/tmp/test");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].escalationReason).toBe("plateau");
    expect(result.findings[0].distinctStoryCount).toBe(3);
  });

  it("windowInflationRisk: false when currentPlanStartTimeMs provided, true when not", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([]);
    const withWindow = await graduateFindings("/tmp/test", { currentPlanStartTimeMs: Date.now() });
    expect(withWindow.windowInflationRisk).toBe(false);

    mockedReadRunRecords.mockResolvedValueOnce([]);
    const withoutWindow = await graduateFindings("/tmp/test");
    expect(withoutWindow.windowInflationRisk).toBe(true);
  });

  it("graduateFindings empty result returns {findings: [], windowInflationRisk: <bool>} (never null)", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([]);
    const result = await graduateFindings("/tmp/test");
    expect(result).toBeDefined();
    expect(result.findings).toEqual([]);
    expect(typeof result.windowInflationRisk).toBe("boolean");
  });

  it("generator records are excluded from graduation counting (not counted)", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecordWithEscalation("US-01", "FAIL", "2026-01-01T00:01:00Z", "plateau"),
      makePrimaryRecordWithEscalation("US-02", "FAIL", "2026-01-01T00:02:00Z", "plateau"),
      makeGeneratorRecord("US-03", "2026-01-01T00:03:00Z"), // generator — should NOT count
    ]);
    const result = await graduateFindings("/tmp/test");
    // Only 2 distinct stories from primary records, not 3
    expect(result.findings).toHaveLength(0);
  });
});

describe("reconcileState (PH03-US-05)", () => {
  it("reconcileState runs first inside assessPhase (before recoverState)", async () => {
    // Verify orphan detection fires during assessPhase
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const plan = makePlan([makeStory("US-02")]); // plan only has US-02
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"), // orphaned — not in plan
      makePrimaryRecord("US-02", "PASS", "2026-01-01T00:02:00Z"),
    ]);
    const result = await assessPhase(plan, "/tmp/test");
    // US-01 should be orphaned (logged), US-02 should be done
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("orphaned record for storyId 'US-01'"));
    expect(result.brief.stories).toHaveLength(1);
    expect(result.brief.stories[0].storyId).toBe("US-02");
    expect(result.brief.stories[0].status).toBe("done");
    errorSpy.mockRestore();
  });

  it("orphaned record: storyId not in plan is excluded and console.error is called", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("ORPHAN-01", "FAIL", "2026-01-01T00:01:00Z"),
    ]);
    const result = await reconcileState(makePlan([makeStory("US-01")]), "/tmp/test");
    expect(result.orphanedStoryIds).toContain("ORPHAN-01");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("orphaned"));
    errorSpy.mockRestore();
  });

  it("new story: present in plan, zero prior records → initially pending via REQ-04", async () => {
    mockedReadRunRecords.mockResolvedValueOnce([]); // no prior records
    const plan = makePlan([makeStory("NEW-01")]);
    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.stories).toHaveLength(1);
    expect(result.brief.stories[0].storyId).toBe("NEW-01");
    expect(result.brief.stories[0].status).toBe("ready"); // no deps, zero records → ready
    expect(result.brief.stories[0].retryCount).toBe(0);
  });

  it("full plan replacement: all story IDs differ from prior records → all old orphaned, all new pending", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("OLD-01", "PASS", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("OLD-02", "FAIL", "2026-01-01T00:02:00Z"),
    ]);
    const plan = makePlan([makeStory("NEW-01"), makeStory("NEW-02")]);
    const result = await assessPhase(plan, "/tmp/test");
    // Old records orphaned
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("orphaned record for storyId 'OLD-01'"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("orphaned record for storyId 'OLD-02'"));
    // New stories are ready (no deps, no records)
    expect(result.brief.stories.every((s) => s.status === "ready")).toBe(true);
    errorSpy.mockRestore();
  });

  it("rename failed story → old ID orphaned warning + new ID pending with retry counter 0 (fresh budget)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
    ]);
    // Plan has been renamed: US-01 → US-01-renamed
    const plan = makePlan([makeStory("US-01-renamed")]);
    const result = await assessPhase(plan, "/tmp/test");
    // Old ID orphaned
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("orphaned record for storyId 'US-01'"));
    // New ID is ready (zero records, zero retries)
    expect(result.brief.stories).toHaveLength(1);
    expect(result.brief.stories[0].storyId).toBe("US-01-renamed");
    expect(result.brief.stories[0].status).toBe("ready");
    expect(result.brief.stories[0].retryCount).toBe(0);
    errorSpy.mockRestore();
  });

  it("dependency change makes pending story satisfiable → shows as ready", async () => {
    // US-02 used to depend on US-01 (not done). Now plan changed: US-02 has no deps.
    mockedReadRunRecords.mockResolvedValueOnce([]);
    const plan = makePlan([makeStory("US-02")]); // no deps — dependency removed
    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.stories[0].status).toBe("ready");
  });

  it("dep-failed upstream-replanned-away: downstream lifts to ready on next call", async () => {
    // First call: US-01 failed → US-02 dep-failed
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
    ]);
    const plan1 = makePlan([makeStory("US-01"), makeStory("US-02", ["US-01"])]);
    const result1 = await assessPhase(plan1, "/tmp/test");
    expect(result1.brief.stories.find((s) => s.storyId === "US-02")!.status).toBe("dep-failed");

    // Second call: US-01 removed from plan. US-02 has no deps now.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:01:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:02:00Z"),
      makePrimaryRecord("US-01", "FAIL", "2026-01-01T00:03:00Z"),
    ]);
    const plan2 = makePlan([makeStory("US-02")]); // US-01 removed, US-02 dep removed
    const result2 = await assessPhase(plan2, "/tmp/test");
    expect(result2.brief.stories[0].storyId).toBe("US-02");
    expect(result2.brief.stories[0].status).toBe("ready"); // lifted from dep-failed
    errorSpy.mockRestore();
  });

  it("dangling dependency: downstream is pending with evidence 'dep <id> missing from plan' and P45 console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedReadRunRecords.mockResolvedValueOnce([]);
    // US-02 depends on US-01, but US-01 is NOT in the plan (dangling dep)
    const plan = makePlan([makeStory("US-02", ["US-01"])]);
    const result = await assessPhase(plan, "/tmp/test");
    expect(result.brief.stories).toHaveLength(1);
    expect(result.brief.stories[0].status).toBe("pending");
    expect(result.brief.stories[0].evidence).toContain("dep US-01 missing from plan");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("dangling dependency 'US-01'"));
    errorSpy.mockRestore();
  });
});

// ── loadCoordinateConfig tests (PH04-US-01b) ───────────────

import { loadCoordinateConfig, assemblePhaseTransitionBrief, computeDriftCounts, type ResolvedConfig, type DriftInputs } from "./coordinator.js";
import { mkdtemp, readFile as fsReadFile, readdir, rm } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { writeFile as fsWriteFile, mkdir as fsMkdir, rm as fsRm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadCoordinateConfig", () => {
  const CFG_DIR = join(tmpdir(), "coord-config-test-" + process.pid);
  const FORGE_DIR = join(CFG_DIR, ".forge");

  beforeEach(async () => {
    await fsMkdir(FORGE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fsRm(CFG_DIR, { recursive: true, force: true });
  });

  it("config no file → defaults applied with all 'default' provenance", async () => {
    const cfg = await loadCoordinateConfig(CFG_DIR);
    expect(cfg.storyOrdering).toBe("topological");
    expect(cfg.phaseBoundaryBehavior).toBe("auto-advance");
    expect(cfg.briefVerbosity).toBe("concise");
    expect(cfg.configSource["storyOrdering"]).toBe("default");
    expect(cfg.configSource["phaseBoundaryBehavior"]).toBe("default");
    expect(cfg.configSource["briefVerbosity"]).toBe("default");
  });

  it("config full file → all 4 fields applied with 'file' provenance", async () => {
    await fsWriteFile(join(FORGE_DIR, "coordinate.config.json"), JSON.stringify({
      storyOrdering: "depth-first",
      phaseBoundaryBehavior: "halt-hard",
      briefVerbosity: "detailed",
      observability: { logLevel: "debug", writeAuditLog: false, writeRunRecord: true },
    }));

    const cfg = await loadCoordinateConfig(CFG_DIR);
    expect(cfg.storyOrdering).toBe("depth-first");
    expect(cfg.phaseBoundaryBehavior).toBe("halt-hard");
    expect(cfg.briefVerbosity).toBe("detailed");
    expect(cfg.configSource["storyOrdering"]).toBe("file");
    expect(cfg.configSource["phaseBoundaryBehavior"]).toBe("file");
    expect(cfg.configSource["briefVerbosity"]).toBe("file");
    expect(cfg.configSource["observability"]).toBe("file");
  });

  it("config args override file → mixed provenance", async () => {
    await fsWriteFile(join(FORGE_DIR, "coordinate.config.json"), JSON.stringify({
      storyOrdering: "depth-first",
      briefVerbosity: "detailed",
    }));

    const cfg = await loadCoordinateConfig(CFG_DIR, { storyOrdering: "small-first" });
    expect(cfg.storyOrdering).toBe("small-first");
    expect(cfg.briefVerbosity).toBe("detailed");
    expect(cfg.configSource["storyOrdering"]).toBe("args");
    expect(cfg.configSource["briefVerbosity"]).toBe("file");
  });

  it("config corrupt JSON → graceful fallback to defaults, console.error called", async () => {
    await fsWriteFile(join(FORGE_DIR, "coordinate.config.json"), "{broken json!!");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cfg = await loadCoordinateConfig(CFG_DIR);
    expect(cfg.storyOrdering).toBe("topological");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("config schema-invalid storyOrdering 'random' → field skipped, valid fields applied", async () => {
    await fsWriteFile(join(FORGE_DIR, "coordinate.config.json"), JSON.stringify({
      storyOrdering: "random",
      briefVerbosity: "detailed",
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cfg = await loadCoordinateConfig(CFG_DIR);
    expect(cfg.storyOrdering).toBe("topological"); // invalid → default
    expect(cfg.briefVerbosity).toBe("detailed");    // valid → applied
    errSpy.mockRestore();
  });

  it("config mid-write race (truncated JSON) → graceful fallback", async () => {
    await fsWriteFile(join(FORGE_DIR, "coordinate.config.json"), '{"storyOrdering": "dep');
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cfg = await loadCoordinateConfig(CFG_DIR);
    expect(cfg.storyOrdering).toBe("topological");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("config budgetUsd in file → rejected by strict with named-field warning", async () => {
    await fsWriteFile(join(FORGE_DIR, "coordinate.config.json"), JSON.stringify({
      budgetUsd: 100,
      storyOrdering: "depth-first",
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cfg = await loadCoordinateConfig(CFG_DIR);
    // storyOrdering should still be salvaged
    expect(cfg.storyOrdering).toBe("depth-first");
    // Warning should name budgetUsd as resource-cap
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("budgetUsd"));
    errSpy.mockRestore();
  });

  it("writeRunRecord false → P45 warning + crash recovery disabled in recommendation", async () => {
    await fsWriteFile(join(FORGE_DIR, "coordinate.config.json"), JSON.stringify({
      observability: { writeRunRecord: false },
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const cfg = await loadCoordinateConfig(CFG_DIR);
    expect(cfg.observability.writeRunRecord).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("writeRunRecord"));

    // Also verify the recommendation prefix via assemblePhaseTransitionBrief
    const brief = await assemblePhaseTransitionBrief([], {}, [], [], { config: cfg });
    expect(brief.recommendation).toContain("WARNING: crash recovery disabled.");
    errSpy.mockRestore();
  });
});

describe("storyOrdering depth-first behavioral", () => {
  it("depth-first chain: finishes one chain before crossing to another", async () => {
    // 2-chain plan: A→B→C and D→E→F
    // depth-first should process A,B,C then D,E,F (not interleave)
    mockedReadRunRecords.mockResolvedValueOnce([]);
    const plan = makePlan([
      makeStory("A", []),
      makeStory("B", ["A"]),
      makeStory("C", ["B"]),
      makeStory("D", []),
      makeStory("E", ["D"]),
      makeStory("F", ["E"]),
    ]);

    const cfg: ResolvedConfig = {
      storyOrdering: "depth-first",
      phaseBoundaryBehavior: "auto-advance",
      briefVerbosity: "concise",
      observability: { logLevel: "info", writeAuditLog: true, writeRunRecord: true },
      configSource: { storyOrdering: "file" },
    };

    const result = await assessPhase(plan, "/tmp/test", { config: cfg });
    const readyIds = result.brief.readyStories;

    // With depth-first ordering, only root stories should be ready
    // (A and D have no deps, so both are ready — topo order gives them first)
    expect(readyIds).toContain("A");
    expect(readyIds).toContain("D");
    expect(result.brief.stories).toHaveLength(6);
  });
});

// ── Q0/L3 — driftSinceLastPlanUpdate + INVOKE recommendation ──

function emptyMasterPlan() {
  return { stories: [] as Array<{ id: string; status?: string }> };
}

describe("driftSinceLastPlanUpdate — non-triviality fixtures (derived)", () => {
  it("Fixture A: 3 reverseFindings → reverse=3, orphaned=0, dangling=0 — INVOKE appended", async () => {
    const driftInputs: DriftInputs = {
      reverseFindings: [
        { id: "rev-aaaaaaaaaaaa", location: "src/a.ts", classification: "extra-functionality", description: "d1" },
        { id: "rev-bbbbbbbbbbbb", location: "src/b.ts", classification: "scope-creep", description: "d2" },
        { id: "rev-cccccccccccc", location: "src/c.ts", classification: "method-divergence", description: "d3" },
      ],
      reconcileState: [],
      masterPlan: emptyMasterPlan(),
      phasePlans: [],
    };
    const brief = await assemblePhaseTransitionBrief([], {}, [], [], { driftInputs });
    expect(brief.driftSinceLastPlanUpdate).toEqual({ reverse: 3, orphaned: 0, dangling: 0 });
    expect(brief.recommendation).toMatch(/INVOKE.*forge_plan\s*\(.*update/);
  });

  it("Fixture B: reconcileState parentStoryId absent from masterPlan → orphaned=1", async () => {
    const driftInputs: DriftInputs = {
      reverseFindings: [],
      reconcileState: [{ parentStoryId: "ORPHAN-01" }],
      masterPlan: { stories: [{ id: "OTHER-01" }] },
      phasePlans: [],
    };
    const brief = await assemblePhaseTransitionBrief([], {}, [], [], { driftInputs });
    expect(brief.driftSinceLastPlanUpdate).toEqual({ reverse: 0, orphaned: 1, dangling: 0 });
    expect(brief.recommendation).toMatch(/INVOKE.*forge_plan\s*\(.*update/);
  });

  it("Fixture C: phasePlan dep targetStoryId absent from masterPlan → dangling=1", async () => {
    const driftInputs: DriftInputs = {
      reverseFindings: [],
      reconcileState: [],
      masterPlan: { stories: [{ id: "OTHER" }] },
      phasePlans: [{ deps: [{ targetStoryId: "MISSING-01" }] }],
    };
    const brief = await assemblePhaseTransitionBrief([], {}, [], [], { driftInputs });
    expect(brief.driftSinceLastPlanUpdate).toEqual({ reverse: 0, orphaned: 0, dangling: 1 });
    expect(brief.recommendation).toMatch(/INVOKE.*forge_plan\s*\(.*update/);
  });

  it("All zero drift — no INVOKE appended", async () => {
    const driftInputs: DriftInputs = {
      reverseFindings: [],
      reconcileState: [],
      masterPlan: emptyMasterPlan(),
      phasePlans: [],
    };
    const brief = await assemblePhaseTransitionBrief([], {}, [], [], { driftInputs });
    expect(brief.recommendation).not.toMatch(/INVOKE/);
  });

  it("deferredReplanningNotes pass-through", async () => {
    const brief = await assemblePhaseTransitionBrief([], {}, [], [], {
      deferredReplanningNotes: 3,
    });
    expect(brief.deferredReplanningNotes).toBe(3);
  });
});

// ── computeDriftCounts — direct unit tests (cap + spill) ──

describe("computeDriftCounts — cap boundary + overflow spill", () => {
  let spillDir: string;

  beforeEach(async () => {
    spillDir = await mkdtemp(pathJoin(tmpdir(), "drift-spill-"));
  });

  afterEach(async () => {
    await rm(spillDir, { recursive: true, force: true });
  });

  function mkReverse(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `rev-${i.toString().padStart(12, "0")}`,
      location: `src/f${i}.ts`,
      classification: "extra-functionality",
      description: `d${i}`,
    }));
  }

  it("cap boundary: exactly 49 reverse findings → reverse=49, no overflow, no spill file", async () => {
    const drift = await computeDriftCounts(
      {
        reverseFindings: mkReverse(49),
        reconcileState: [],
        masterPlan: emptyMasterPlan(),
        phasePlans: [],
      },
      { driftSpillDir: spillDir },
    );
    expect(drift.reverse).toBe(49);
    expect(drift.overflow).toBeUndefined();
    const contents = await readdir(spillDir);
    expect(contents).toHaveLength(0);
  });

  it("cap trigger: 51 reverse findings → reverse=50, overflow=true, spill file contains all 51", async () => {
    const drift = await computeDriftCounts(
      {
        reverseFindings: mkReverse(51),
        reconcileState: [],
        masterPlan: emptyMasterPlan(),
        phasePlans: [],
      },
      { driftSpillDir: spillDir },
    );
    expect(drift.reverse).toBe(50);
    expect(drift.overflow).toBe(true);

    const files = await readdir(spillDir);
    expect(files).toHaveLength(1);
    const content = JSON.parse(await fsReadFile(pathJoin(spillDir, files[0]), "utf-8"));
    expect(content.reverse).toHaveLength(51);
  });

  it("mixed cap: 51 reverse + 3 orphaned + 3 dangling → reverse=50, orphaned=3, dangling=3, overflow=true", async () => {
    const drift = await computeDriftCounts(
      {
        reverseFindings: mkReverse(51),
        reconcileState: [
          { parentStoryId: "O1" },
          { parentStoryId: "O2" },
          { parentStoryId: "O3" },
        ],
        masterPlan: { stories: [{ id: "X" }] },
        phasePlans: [
          { deps: [{ targetStoryId: "M1" }, { targetStoryId: "M2" }, { targetStoryId: "M3" }] },
        ],
      },
      { driftSpillDir: spillDir },
    );
    expect(drift.reverse).toBe(50);
    expect(drift.orphaned).toBe(3);
    expect(drift.dangling).toBe(3);
    expect(drift.overflow).toBe(true);
  });
});

// ── v0.39.2 AC-5 / F5 — retryCount semantics ──────────────────────────────

/**
 * Build a `forge_generate` primary record (NOT a generator-iteration record).
 * forge_generate writes a top-level RunRecord with `tool: "forge_generate"`
 * and NO `evalVerdict` field — see server/tools/generate.ts:300-319. Those
 * records flow into the coordinator's `recordsByStory` join exactly like
 * forge_evaluate records, which is why the retry filter must distinguish
 * "no verdict" from "FAIL/INCONCLUSIVE verdict".
 */
function makeGeneratePrimaryRecord(
  storyId: string,
  timestamp: string,
): PrimaryRecord {
  const record: RunRecord = {
    timestamp,
    tool: "forge_generate",
    documentTier: null,
    mode: null,
    tier: null,
    storyId,
    // explicitly NO evalVerdict — that's the bug surface
    metrics: {
      inputTokens: 0,
      outputTokens: 0,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: 1000,
    },
    outcome: "ok",
  };
  return { source: "primary", record };
}

function makePlanPrimaryRecord(
  storyId: string,
  timestamp: string,
): PrimaryRecord {
  const record: RunRecord = {
    timestamp,
    tool: "forge_plan",
    documentTier: null,
    mode: null,
    tier: null,
    storyId,
    metrics: {
      inputTokens: 0,
      outputTokens: 0,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: 1000,
    },
    outcome: "success",
  };
  return { source: "primary", record };
}

describe("retryCount counts only failed evaluate records", () => {
  it("retryCount counts only failed evaluate records: PASS evaluate + forge_generate record yields retryCount=0 (assessPhase)", async () => {
    const plan = makePlan([makeStory("US-08")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makeGeneratePrimaryRecord("US-08", "2026-04-27T03:00:00Z"),
      makePrimaryRecord("US-08", "PASS", "2026-04-27T03:07:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories.find((s) => s.storyId === "US-08")!;
    expect(entry.retryCount).toBe(0);
    expect(entry.retriesRemaining).toBe(3);
  });

  it("retryCount counts only failed evaluate records: PASS evaluate + forge_plan + forge_generate records yields retryCount=0 (assessPhase)", async () => {
    const plan = makePlan([makeStory("US-08")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePlanPrimaryRecord("US-08", "2026-04-27T02:00:00Z"),
      makeGeneratePrimaryRecord("US-08", "2026-04-27T03:00:00Z"),
      makePrimaryRecord("US-08", "PASS", "2026-04-27T03:07:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories.find((s) => s.storyId === "US-08")!;
    expect(entry.retryCount).toBe(0);
    expect(entry.retriesRemaining).toBe(3);
  });

  it("retryCount counts only failed evaluate records: PASS evaluate + forge_generate record yields retryCount=0 (recoverState)", async () => {
    // Both filter sites must be fixed — the live-state path (assessPhase)
    // and the recovery path (recoverState). v0.39.2 plan AC-5 explicitly
    // requires both sites to be covered.
    const plan = makePlan([makeStory("US-08")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makeGeneratePrimaryRecord("US-08", "2026-04-27T03:00:00Z"),
      makePrimaryRecord("US-08", "PASS", "2026-04-27T03:07:00Z"),
    ]);

    const result = await recoverState(plan, "/tmp/test");
    const entry = result.get("US-08")!;
    expect(entry.retryCount).toBe(0);
    expect(entry.retriesRemaining).toBe(3);
  });

  it("retryCount counts only failed evaluate records: FAIL then PASS yields retryCount=1 (positive control, both sites)", async () => {
    // Positive control: a real retry (one FAIL eval before the PASS) MUST
    // continue to register as retryCount=1 — the fix narrows the filter,
    // it doesn't disable retry-counting.
    const plan = makePlan([makeStory("US-08")]);
    mockedReadRunRecords
      .mockResolvedValueOnce([
        makePrimaryRecord("US-08", "FAIL", "2026-04-27T03:00:00Z"),
        makePrimaryRecord("US-08", "PASS", "2026-04-27T03:07:00Z"),
      ])
      .mockResolvedValueOnce([
        makePrimaryRecord("US-08", "FAIL", "2026-04-27T03:00:00Z"),
        makePrimaryRecord("US-08", "PASS", "2026-04-27T03:07:00Z"),
      ]);

    const live = await assessPhase(plan, "/tmp/test");
    const recovered = await recoverState(plan, "/tmp/test");
    expect(live.brief.stories.find((s) => s.storyId === "US-08")!.retryCount).toBe(1);
    expect(recovered.get("US-08")!.retryCount).toBe(1);
  });

  it("retryCount counts only failed evaluate records: INCONCLUSIVE evaluate counts as a retry (positive control)", async () => {
    // INCONCLUSIVE is the second authoritative failure verdict — it MUST
    // continue to count as a retry per the existing classifyStory rule.
    const plan = makePlan([makeStory("US-08")]);
    mockedReadRunRecords.mockResolvedValueOnce([
      makePrimaryRecord("US-08", "INCONCLUSIVE", "2026-04-27T03:00:00Z"),
      makePrimaryRecord("US-08", "PASS", "2026-04-27T03:07:00Z"),
    ]);

    const result = await assessPhase(plan, "/tmp/test");
    const entry = result.brief.stories.find((s) => s.storyId === "US-08")!;
    expect(entry.retryCount).toBe(1);
  });
});

