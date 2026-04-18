/**
 * Unit test for `writeCoordinateBrief` — coordinate-brief.json persistence
 * (AC-15 of the 2026-04-18 kanban-dashboard plan).
 *
 * The dashboard renderer reads this file back on every render, so the
 * write must (a) land on disk with the 4 required fields (status /
 * stories / completedCount / totalCount) and (b) not throw on I/O errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeCoordinateBrief } from "./coordinator.js";
import type { PhaseTransitionBrief } from "../types/coordinate-result.js";

function fixtureBrief(): PhaseTransitionBrief {
  return {
    status: "in-progress",
    stories: [
      {
        storyId: "US-01",
        status: "done",
        retryCount: 0,
        retriesRemaining: 3,
        priorEvalReport: null,
        evidence: "passed on first attempt",
      },
      {
        storyId: "US-02",
        status: "ready",
        retryCount: 0,
        retriesRemaining: 3,
        priorEvalReport: null,
        evidence: null,
      },
    ],
    readyStories: ["US-02"],
    depFailedStories: [],
    failedStories: [],
    completedCount: 1,
    totalCount: 2,
    budget: {
      usedUsd: 1.23,
      budgetUsd: 10,
      remainingUsd: 8.77,
      incompleteData: false,
      warningLevel: "none",
    },
    timeBudget: { elapsedMs: 5000, maxTimeMs: 60_000, warningLevel: "none" },
    replanningNotes: [],
    recommendation: "Continue execution.",
    configSource: {},
  };
}

describe("writeCoordinateBrief (AC-15)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-coord-brief-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes .forge/coordinate-brief.json with the 4 required fields populated", async () => {
    const brief = fixtureBrief();
    await writeCoordinateBrief(tmpRoot, brief);
    const raw = await readFile(
      join(tmpRoot, ".forge", "coordinate-brief.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as PhaseTransitionBrief;
    expect(parsed.status).toBe("in-progress");
    expect(parsed.stories).toHaveLength(2);
    expect(parsed.completedCount).toBe(1);
    expect(parsed.totalCount).toBe(2);
  });

  it("does not throw when the project path is bogus (failure is logged + swallowed)", async () => {
    const bogus = process.platform === "win32"
      ? "Z:\\nonexistent\\forge-root"
      : "/nonexistent/forge-root";
    await expect(writeCoordinateBrief(bogus, fixtureBrief())).resolves.toBeUndefined();
  });
});
