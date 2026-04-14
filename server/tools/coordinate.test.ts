import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

// Mock run-record to avoid writing real files
vi.mock("../lib/run-record.js", () => ({
  writeRunRecord: vi.fn(async () => {}),
}));

import { handleCoordinate, coordinateInputSchema } from "./coordinate.js";
import { writeRunRecord } from "../lib/run-record.js";

const mockedWriteRunRecord = vi.mocked(writeRunRecord);

const TEST_DIR = join(tmpdir(), "coordinate-test-" + process.pid);
const RUNS_DIR = join(TEST_DIR, ".forge", "runs");

function makeValidPlan(stories?: unknown[]) {
  return {
    schemaVersion: "3.0.0",
    stories: stories ?? [
      { id: "US-01", title: "First", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "test", command: "echo pass" }] },
      { id: "US-02", title: "Second", dependencies: ["US-01"], acceptanceCriteria: [{ id: "AC-02", description: "test", command: "echo pass" }] },
    ],
  };
}

function makeRunRecord(storyId: string, verdict: "PASS" | "FAIL" | "INCONCLUSIVE") {
  return {
    timestamp: new Date().toISOString(),
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    storyId,
    evalVerdict: verdict,
    evalReport: { storyId, verdict, criteria: [{ id: "AC-01", status: verdict === "PASS" ? "PASS" : "FAIL", evidence: "test" }] },
    metrics: { inputTokens: 100, outputTokens: 50, critiqueRounds: 0, findingsTotal: 0, findingsApplied: 0, findingsRejected: 0, validationRetries: 0, durationMs: 1000, estimatedCostUsd: 0.01 },
    outcome: "success",
  };
}

beforeEach(async () => {
  await mkdir(RUNS_DIR, { recursive: true });
  mockedWriteRunRecord.mockClear();
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ── Schema tests ────────────────────────────────────────────

describe("coordinateInputSchema", () => {
  it("declares planPath and phaseId", () => {
    expect(coordinateInputSchema.planPath).toBeDefined();
    expect(coordinateInputSchema.phaseId).toBeDefined();
  });

  it("declares haltClearedByHuman", () => {
    expect(coordinateInputSchema.haltClearedByHuman).toBeDefined();
  });

  it("declares currentPlanStartTimeMs", () => {
    expect(coordinateInputSchema.currentPlanStartTimeMs).toBeDefined();
  });
});

// ── Input validation ────────────────────────────────────────

describe("handleCoordinate — input validation", () => {
  it("negative budgetUsd rejected with isError", async () => {
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", budgetUsd: -5, projectPath: TEST_DIR });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("budgetUsd must be non-negative");
  });

  it("missing planPath does not exist returns isError", async () => {
    const result = await handleCoordinate({ planPath: join(TEST_DIR, "nonexistent.json"), phaseId: "PH-01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cannot read planPath");
  });

  it("invalid JSON planPath returns isError", async () => {
    const planPath = join(TEST_DIR, "bad.json");
    await writeFile(planPath, "not json {{{");
    const result = await handleCoordinate({ planPath, phaseId: "PH-01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("invalid JSON");
  });

  it("invalid schema returns isError", async () => {
    const planPath = join(TEST_DIR, "bad-schema.json");
    await writeFile(planPath, JSON.stringify({ schemaVersion: "2.0.0", stories: [] }));
    const result = await handleCoordinate({ planPath, phaseId: "PH-01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("invalid execution plan");
  });
});

// ── Happy path MCP ──────────────────────────────────────────

describe("handleCoordinate — happy path MCP", () => {
  it("valid plan returns brief without errors", async () => {
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    expect(result.isError).toBeUndefined();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mode).toBe("advisory");
    expect(parsed.phaseId).toBe("PH-01");
    expect(parsed.brief).toBeDefined();
    expect(parsed.brief.stories).toHaveLength(2);
    expect(parsed.brief.totalCount).toBe(2);
  });

  it("halt-hard non-latching: complete then failure flips status", async () => {
    const plan = makeValidPlan([
      { id: "US-01", title: "Story 1", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "test", command: "echo pass" }] },
    ]);
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));

    // PASS record → story done → phase complete
    await writeFile(join(RUNS_DIR, "eval-001.json"), JSON.stringify(makeRunRecord("US-01", "PASS")));
    const result1 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const brief1 = JSON.parse(result1.content[0].text).brief;
    expect(brief1.status).toBe("complete");

    // Add FAIL record → non-latching: should NOT stay complete
    await writeFile(join(RUNS_DIR, "eval-002.json"), JSON.stringify(makeRunRecord("US-01", "FAIL")));
    const result2 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const brief2 = JSON.parse(result2.content[0].text).brief;
    expect(brief2.status).not.toBe("complete");
  });

  it("writes RunRecord when projectPath provided", async () => {
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    expect(mockedWriteRunRecord).toHaveBeenCalledTimes(1);
    const [, record] = mockedWriteRunRecord.mock.calls[0];
    expect(record.tool).toBe("forge_coordinate");
  });

  it("merges injected replanningNotes", async () => {
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    const result = await handleCoordinate({
      planPath, phaseId: "PH-01", projectPath: TEST_DIR,
      replanningNotes: [{ category: "gap-found", severity: "informational", description: "test note" }],
    });

    const brief = JSON.parse(result.content[0].text).brief;
    expect(brief.replanningNotes.some((n: { description: string }) => n.description === "test note")).toBe(true);
  });
});

// ── Advisory checkpoint gates (PH04-US-02) ──────────────────

describe("handleCoordinate — advisory checkpoint gates", () => {
  it("advisory mode: no checkpointRequired field in brief", async () => {
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.brief).toBeDefined();
    expect("checkpointRequired" in parsed.brief).toBe(false);
    expect("checkpointRequired" in parsed).toBe(false);
  });

  it("determinism twice: re-invocation with same inputs returns structurally equal briefs", async () => {
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    const result1 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const result2 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });

    const brief1 = JSON.parse(result1.content[0].text).brief;
    const brief2 = JSON.parse(result2.content[0].text).brief;

    // Compare non-timestamp fields
    expect(brief1.status).toBe(brief2.status);
    expect(brief1.stories.length).toBe(brief2.stories.length);
    expect(brief1.readyStories).toEqual(brief2.readyStories);
    expect(brief1.completedCount).toBe(brief2.completedCount);
    expect(brief1.totalCount).toBe(brief2.totalCount);
    expect(brief1.failedStories).toEqual(brief2.failedStories);
    expect(brief1.depFailedStories).toEqual(brief2.depFailedStories);
  });

  it("stateless advisory: no gate state files written to disk", async () => {
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });

    // Check that no gate/checkpoint files were written
    const { readdir } = await import("node:fs/promises");
    const forgeDir = join(TEST_DIR, ".forge");
    const entries = await readdir(forgeDir);
    // Only "runs" dir should exist (from beforeEach), no gate/checkpoint files
    const gateFiles = entries.filter((e) => e.includes("gate") || e.includes("checkpoint") || e.includes("state"));
    expect(gateFiles).toHaveLength(0);
  });
});

// ── Integration tests (PH04-US-03) ──────────────────────────

describe("handleCoordinate — integration", () => {
  it("configSource end-to-end provenance with mixed file/args", async () => {
    // Write config file with storyOrdering and briefVerbosity
    const configDir = join(TEST_DIR, ".forge");
    await writeFile(join(configDir, "coordinate.config.json"), JSON.stringify({
      storyOrdering: "depth-first",
      briefVerbosity: "detailed",
    }));

    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(makeValidPlan()));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const brief = JSON.parse(result.content[0].text).brief;

    // configSource should show file provenance for the fields we set
    expect(brief.configSource).toBeDefined();
    expect(brief.configSource.storyOrdering).toBe("file");
    expect(brief.configSource.briefVerbosity).toBe("file");
    // phaseBoundaryBehavior not in file → default
    expect(brief.configSource.phaseBoundaryBehavior).toBe("default");
  });

  it("halt-hard 3-step clearing state machine", async () => {
    // Config: halt-hard
    const configDir = join(TEST_DIR, ".forge");
    await writeFile(join(configDir, "coordinate.config.json"), JSON.stringify({
      phaseBoundaryBehavior: "halt-hard",
    }));

    const plan = makeValidPlan([
      { id: "US-01", title: "Story", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "t", command: "echo pass" }] },
    ]);
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));

    // PASS record → story done
    await writeFile(join(RUNS_DIR, "eval-001.json"), JSON.stringify(makeRunRecord("US-01", "PASS")));

    // Call 1: phase complete + halt-hard → status "halted"
    const r1 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const b1 = JSON.parse(r1.content[0].text).brief;
    expect(b1.status).toBe("halted");
    expect(b1.replanningNotes.some((n: { description: string }) => n.description.includes("halt-hard"))).toBe(true);

    // Call 2: no flag → still halted (idempotent)
    const r2 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const b2 = JSON.parse(r2.content[0].text).brief;
    expect(b2.status).toBe("halted");

    // Call 3: haltClearedByHuman: true → complete
    const r3 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR, haltClearedByHuman: true });
    const b3 = JSON.parse(r3.content[0].text).brief;
    expect(b3.status).toBe("complete");
    expect(b3.replanningNotes.some((n: { description: string }) => n.description.includes("halt-hard"))).toBe(false);
  });

  it("NFR-C10 empty config identical: no config vs empty {} config produces byte-identical brief excluding configSource", async () => {
    const plan = makeValidPlan();
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));

    // Call 1: no config file
    const r1 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const b1 = JSON.parse(r1.content[0].text).brief;

    // Write empty config
    const configDir = join(TEST_DIR, ".forge");
    await writeFile(join(configDir, "coordinate.config.json"), "{}");

    // Call 2: empty {} config
    const r2 = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const b2 = JSON.parse(r2.content[0].text).brief;

    // Compare all fields except configSource
    const strip = (b: Record<string, unknown>) => {
      const rest = { ...b };
      delete rest.configSource;
      return rest;
    };
    expect(JSON.stringify(strip(b1))).toBe(JSON.stringify(strip(b2)));
  });

  it("NFR-C07 schema 3.0.0 compatible: valid v3.0.0 plan accepted", async () => {
    const plan = {
      schemaVersion: "3.0.0",
      documentTier: "phase",
      phaseId: "PH-01",
      stories: [
        { id: "S-01", title: "Test", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "test", command: "echo ok" }] },
      ],
    };
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.brief.totalCount).toBe(1);
  });

  it("all stories done → phase complete", async () => {
    const plan = makeValidPlan([
      { id: "US-01", title: "S1", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "t", command: "echo p" }] },
    ]);
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));
    await writeFile(join(RUNS_DIR, "eval-001.json"), JSON.stringify(makeRunRecord("US-01", "PASS")));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const brief = JSON.parse(result.content[0].text).brief;
    expect(brief.status).toBe("complete");
    expect(brief.completedCount).toBe(1);
  });

  it("INCONCLUSIVE routed to ready-for-retry", async () => {
    const plan = makeValidPlan([
      { id: "US-01", title: "S1", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "t", command: "echo p" }] },
    ]);
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));
    await writeFile(join(RUNS_DIR, "eval-001.json"), JSON.stringify(makeRunRecord("US-01", "INCONCLUSIVE")));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const brief = JSON.parse(result.content[0].text).brief;
    expect(brief.stories[0].status).toBe("ready-for-retry");
  });

  it("budget enforcement with incomplete cost data", async () => {
    const plan = makeValidPlan([
      { id: "US-01", title: "S1", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "t", command: "echo p" }] },
    ]);
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));

    // Record with null cost
    const record = makeRunRecord("US-01", "FAIL");
    (record.metrics as Record<string, unknown>).estimatedCostUsd = null;
    await writeFile(join(RUNS_DIR, "eval-001.json"), JSON.stringify(record));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR, budgetUsd: 10 });
    const brief = JSON.parse(result.content[0].text).brief;
    expect(brief.budget.incompleteData).toBe(true);
  });

  it("empty-dependency plan: all stories ready", async () => {
    const plan = makeValidPlan([
      { id: "US-01", title: "S1", dependencies: [], acceptanceCriteria: [{ id: "AC-01", description: "t", command: "echo p" }] },
      { id: "US-02", title: "S2", dependencies: [], acceptanceCriteria: [{ id: "AC-02", description: "t", command: "echo p" }] },
    ]);
    const planPath = join(TEST_DIR, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));

    const result = await handleCoordinate({ planPath, phaseId: "PH-01", projectPath: TEST_DIR });
    const brief = JSON.parse(result.content[0].text).brief;
    expect(brief.readyStories).toContain("US-01");
    expect(brief.readyStories).toContain("US-02");
  });
});
