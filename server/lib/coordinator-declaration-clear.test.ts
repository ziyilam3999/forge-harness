/**
 * v0.35.1 AC-1 — activeRun clears when forge_coordinate marks story done.
 *
 * Goal invariant 1: after `assessPhase` (the production classification path
 * invoked by the `forge_coordinate` handler) classifies the declared story
 * as `done`, the declaration store must return `null` on the next read —
 * so `forge_status` surfaces `activeRun: null` for that story.
 *
 * Per the plan: "The test MUST exercise the real production code path, not
 * a test helper that calls `clearDeclaration()` directly." Here the test
 * seeds a PASS RunRecord on disk + a declaration in memory, invokes
 * `assessPhase(plan, projectPath)`, and asserts the declaration is null
 * afterwards. No direct `clearDeclaration()` call from the test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assessPhase } from "./coordinator.js";
import {
  clearDeclaration,
  getDeclaration,
  setDeclaration,
} from "./declaration-store.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

function makePlan(): ExecutionPlan {
  return {
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-04",
        title: "Story US-04",
        acceptanceCriteria: [
          { id: "US-04-AC01", description: "check", command: "echo ok" },
        ],
      },
    ],
  };
}

async function seedPassRecord(
  projectPath: string,
  storyId: string,
): Promise<void> {
  const runsDir = join(projectPath, ".forge", "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    timestamp: "2026-04-21T09:00:00.000Z",
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    storyId,
    evalVerdict: "PASS",
    metrics: {
      inputTokens: 100,
      outputTokens: 50,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: 1000,
      estimatedCostUsd: 0.01,
    },
    outcome: "success",
  };
  await writeFile(
    join(runsDir, "forge_evaluate-2026-04-21T09-00-00-000Z-aa.json"),
    JSON.stringify(record, null, 2),
    "utf-8",
  );
}

describe("AC-1 — coordinator clears in-memory declaration after PASS", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "forge-coord-decl-clear-"));
    clearDeclaration();
  });

  afterEach(async () => {
    clearDeclaration();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("activeRun clears when forge_coordinate marks story done — production assessPhase path", async () => {
    // Seed a PASS record for US-04.
    await seedPassRecord(tmpRoot, "US-04");

    // Declare US-04 in the in-memory store (as forge_declare_story would).
    setDeclaration("US-04", "PH-01");
    expect(getDeclaration()?.storyId).toBe("US-04");

    // Production classification path — NOT a direct clearDeclaration().
    const result = await assessPhase(makePlan(), tmpRoot, { phaseId: "PH-01" });

    // Sanity: assessPhase classified US-04 as done.
    expect(result.brief.stories.find((s) => s.storyId === "US-04")?.status).toBe(
      "done",
    );

    // The declaration must be cleared — the fix is inside assessPhase,
    // NOT in this test.
    expect(getDeclaration()).toBeNull();
  });

  it("does not clear declaration when its story is not yet done", async () => {
    // No PASS record on disk → US-04 classifies as `ready`, not `done`.
    setDeclaration("US-04", "PH-01");
    await assessPhase(makePlan(), tmpRoot, { phaseId: "PH-01" });
    expect(getDeclaration()?.storyId).toBe("US-04");
  });

  it("does not clear declaration when its story is absent from the current phase plan", async () => {
    // Seed a PASS record for US-04, but declare a DIFFERENT story (US-99)
    // that isn't in the plan. assessPhase classifies only US-04; US-99 is
    // not touched.
    await seedPassRecord(tmpRoot, "US-04");
    setDeclaration("US-99", "PH-01");
    await assessPhase(makePlan(), tmpRoot, { phaseId: "PH-01" });
    expect(getDeclaration()?.storyId).toBe("US-99");
  });
});
