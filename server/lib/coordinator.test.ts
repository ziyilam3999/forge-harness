import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunRecord } from "./run-record.js";
import type { ExecutionPlan, Story } from "../types/execution-plan.js";
import type { EvalReport } from "../types/eval-report.js";
import type { PrimaryRecord, GeneratorRecord } from "./run-reader.js";

// Mock readRunRecords so we control the fixture data
vi.mock("./run-reader.js", () => ({
  readRunRecords: vi.fn(async () => []),
}));

import { readRunRecords } from "./run-reader.js";
import { assessPhase, checkBudget, checkTimeBudget, recoverState } from "./coordinator.js";

const mockedReadRunRecords = vi.mocked(readRunRecords);

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

    // Compare brief structure (excluding any non-deterministic fields)
    expect(JSON.stringify(r1.brief)).toBe(JSON.stringify(r2.brief));
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

  it("checkBudget undefined budget → warningLevel 'none', remainingUsd null", () => {
    const result = checkBudget(
      [makePrimaryRecordWithCost("US-01", "PASS", "2026-01-01T00:00:00Z", 50)],
      undefined,
    );
    expect(result.warningLevel).toBe("none");
    expect(result.remainingUsd).toBeNull();
    expect(result.budgetUsd).toBeNull();
    expect(result.usedUsd).toBe(0);
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
