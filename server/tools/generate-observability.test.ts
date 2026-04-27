/**
 * v0.39.0 G3/AC-4/AC-5 — forge_generate observability completion.
 *
 * AC-4: every successful handleGenerate writes exactly one
 *       `.forge/runs/forge_generate-*.json` carrying
 *       {tool, storyId, timestamp (ISO), outcome, metrics.durationMs}.
 * AC-5: while assembleGenerateResultWithContext is in flight, the
 *       project's `.forge/activity.json` reflects {tool: "forge_generate",
 *       storyId}; after handleGenerate returns, activity.json is cleared
 *       to {tool: null} (the post-write hook in writeRunRecord clears it).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn().mockResolvedValue("TypeScript project, 12 files, vitest"),
}));

import type { ExecutionPlan } from "../types/execution-plan.js";

const VALID_PLAN: ExecutionPlan = {
  schemaVersion: "3.0.0",
  stories: [
    {
      id: "US-99",
      title: "Cadence + observability",
      acceptanceCriteria: [
        { id: "AC-01", description: "smoke", command: "echo ok" },
      ],
    },
  ],
};
const VALID_PLAN_JSON = JSON.stringify(VALID_PLAN);

describe("AC-4 — forge_generate writes a run record", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-gen-runrec-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("after handleGenerate, .forge/runs/ contains exactly one forge_generate-*.json with the AC-4 shape", async () => {
    const { handleGenerate } = await import("./generate.js");
    const response = await handleGenerate({
      storyId: "US-99",
      planJson: VALID_PLAN_JSON,
      projectPath: tempDir,
    });
    expect(response.isError).toBeUndefined();

    const runsDir = join(tempDir, ".forge", "runs");
    const files = await readdir(runsDir);
    const generateRecords = files.filter(
      (f) => f.startsWith("forge_generate-") && f.endsWith(".json"),
    );
    expect(generateRecords.length).toBe(1);

    const recordPath = join(runsDir, generateRecords[0]);
    const recordRaw = await readFile(recordPath, "utf-8");
    const record = JSON.parse(recordRaw);

    expect(record.tool).toBe("forge_generate");
    expect(record.storyId).toBe("US-99");
    expect(typeof record.timestamp).toBe("string");
    // ISO-8601 timestamp shape (matches the same pattern other writers use)
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(typeof record.outcome).toBe("string");
    expect(record.outcome).toBe("ok");
    expect(record.metrics).toBeDefined();
    expect(typeof record.metrics.durationMs).toBe("number");
    expect(record.metrics.durationMs).toBeGreaterThan(0);
  });
});

describe("AC-5 — forge_generate writes activity.json mid-call", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-gen-activity-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("activity.json contains {tool: 'forge_generate', storyId: 'US-99'} mid-call and {tool: null} after return", async () => {
    // Stub the assembler with a 50ms delay so we can sample activity.json
    // mid-call. The real assembler runs in ~11ms which is too short to
    // observe externally without a stub.
    vi.resetModules();
    vi.doMock("../lib/generator.js", async () => {
      const real = await vi.importActual<typeof import("../lib/generator.js")>(
        "../lib/generator.js",
      );
      return {
        ...real,
        assembleGenerateResultWithContext: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 50));
          return {
            action: "implement",
            iteration: 0,
            maxIterations: 3,
            brief: { story: { id: "US-99" } },
          };
        }),
      };
    });

    const { handleGenerate } = await import("./generate.js");
    const activityPath = join(tempDir, ".forge", "activity.json");

    const inFlight = handleGenerate({
      storyId: "US-99",
      planJson: VALID_PLAN_JSON,
      projectPath: tempDir,
    });

    // Sample mid-call (give the writeActivity call a moment to flush).
    let midCallActivity: { tool: string | null; storyId?: string } | null = null;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      try {
        const raw = await readFile(activityPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.tool === "forge_generate") {
          midCallActivity = parsed;
          break;
        }
      } catch {
        // file not yet present
      }
    }

    expect(midCallActivity).not.toBeNull();
    expect(midCallActivity?.tool).toBe("forge_generate");
    expect(midCallActivity?.storyId).toBe("US-99");

    await inFlight;

    // After return: activity should be cleared (writeRunRecord's
    // post-write hook calls writeActivity(projectPath, null)).
    const afterRaw = await readFile(activityPath, "utf-8");
    const after = JSON.parse(afterRaw);
    expect(after.tool).toBe(null);

    vi.doUnmock("../lib/generator.js");
  });
});
