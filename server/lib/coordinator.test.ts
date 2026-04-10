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
import { assessPhase } from "./coordinator.js";

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
