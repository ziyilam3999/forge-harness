/**
 * Unit tests for `validateAffectedPaths` — covers AC-1 (auto-correction with
 * pathCorrections, OR error response naming the un-resolvable path) and AC-2
 * (clean validation when all paths resolve).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { validateAffectedPaths } from "./affected-paths-validator.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

function makePlan(stories: ExecutionPlan["stories"]): ExecutionPlan {
  return {
    schemaVersion: "3.0.0",
    stories,
  } as ExecutionPlan;
}

describe("validateAffectedPaths — v0.38.0 B1 grounding fix", () => {
  let projectPath: string;

  beforeEach(() => {
    // Create a tmp project with src/foo/ existing.
    const tmp = mkdtempSync(join(tmpdir(), "forge-validator-"));
    projectPath = tmp;
    mkdirSync(join(tmp, "src", "foo"), { recursive: true });
    mkdirSync(join(tmp, "src", "bar"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("AC-1 (a): auto-strips a leading project-name prefix when stripped form resolves; surfaces pathCorrections", () => {
    const projectName = basename(projectPath);
    const plan = makePlan([
      {
        id: "US-01",
        title: "test story",
        affectedPaths: [`${projectName}/src/foo/`],
        acceptanceCriteria: [],
      },
    ] as unknown as ExecutionPlan["stories"]);

    const result = validateAffectedPaths(plan, projectPath);

    expect(result.pathCorrections).toHaveLength(1);
    expect(result.pathCorrections[0].from).toBe(`${projectName}/src/foo/`);
    expect(result.pathCorrections[0].to).toBe("src/foo/");
    expect(result.pathCorrections[0].storyId).toBe("US-01");
    expect(result.plan.stories[0].affectedPaths).toEqual(["src/foo/"]);
    expect(result.pathUnresolvable).toEqual([]);
  });

  it("AC-1 (b): un-resolvable path with no auto-correction surfaces in pathUnresolvable; original path retained", () => {
    const plan = makePlan([
      {
        id: "US-02",
        title: "test story",
        affectedPaths: ["does-not-exist/whatever/"],
        acceptanceCriteria: [],
      },
    ] as unknown as ExecutionPlan["stories"]);

    const result = validateAffectedPaths(plan, projectPath);

    expect(result.pathUnresolvable).toHaveLength(1);
    expect(result.pathUnresolvable[0]).toEqual({
      storyId: "US-02",
      path: "does-not-exist/whatever/",
    });
    expect(result.pathCorrections).toEqual([]);
    // Original path retained byte-identical so spec-generator's no-vocabulary
    // warning still fires downstream.
    expect(result.plan.stories[0].affectedPaths).toEqual([
      "does-not-exist/whatever/",
    ]);
  });

  it("AC-2: all-resolvable paths produce no corrections and bytewise-identical persisted paths", () => {
    const plan = makePlan([
      {
        id: "US-03",
        title: "test story",
        affectedPaths: ["src/foo/", "src/bar/"],
        acceptanceCriteria: [],
      },
    ] as unknown as ExecutionPlan["stories"]);

    const result = validateAffectedPaths(plan, projectPath);

    expect(result.pathCorrections).toEqual([]);
    expect(result.pathUnresolvable).toEqual([]);
    // Same plan reference is permitted (no churn) when nothing changed.
    expect(result.plan.stories[0].affectedPaths).toEqual([
      "src/foo/",
      "src/bar/",
    ]);
  });

  it("no-op when projectPath is undefined", () => {
    const plan = makePlan([
      {
        id: "US-04",
        title: "test",
        affectedPaths: ["whatever/"],
        acceptanceCriteria: [],
      },
    ] as unknown as ExecutionPlan["stories"]);

    const result = validateAffectedPaths(plan, undefined);
    expect(result.pathCorrections).toEqual([]);
    expect(result.pathUnresolvable).toEqual([]);
    expect(result.plan).toBe(plan);
  });

  it("mixes corrections with unresolvable in the same story", () => {
    const projectName = basename(projectPath);
    const plan = makePlan([
      {
        id: "US-05",
        title: "test",
        affectedPaths: [
          `${projectName}/src/foo/`, // → src/foo/ (corrected)
          "src/bar/", // already resolves
          "ghost/", // unresolvable
        ],
        acceptanceCriteria: [],
      },
    ] as unknown as ExecutionPlan["stories"]);

    const result = validateAffectedPaths(plan, projectPath);

    expect(result.pathCorrections).toHaveLength(1);
    expect(result.pathCorrections[0].to).toBe("src/foo/");
    expect(result.pathUnresolvable).toHaveLength(1);
    expect(result.pathUnresolvable[0].path).toBe("ghost/");
    expect(result.plan.stories[0].affectedPaths).toEqual([
      "src/foo/",
      "src/bar/",
      "ghost/",
    ]);
  });
});
