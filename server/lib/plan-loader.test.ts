import { describe, it, expect, vi, afterEach } from "vitest";
import { loadPlan } from "./plan-loader.js";

const VALID_PLAN_JSON = JSON.stringify({
  schemaVersion: "3.0.0",
  stories: [
    {
      id: "US-01",
      title: "Test story",
      acceptanceCriteria: [
        { id: "AC-01", description: "Works", command: "echo PASS" },
      ],
    },
  ],
});

describe("loadPlan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses planJson when provided", () => {
    const plan = loadPlan(undefined, VALID_PLAN_JSON);
    expect(plan.schemaVersion).toBe("3.0.0");
    expect(plan.stories[0].id).toBe("US-01");
  });

  it("planJson takes precedence over planPath", () => {
    // planPath is a bogus path — should not be read because planJson is provided
    const plan = loadPlan("/nonexistent/path.json", VALID_PLAN_JSON);
    expect(plan.stories[0].id).toBe("US-01");
  });

  it("throws when neither planPath nor planJson provided", () => {
    expect(() => loadPlan()).toThrow("Either planPath or planJson is required");
  });

  it("throws on invalid JSON", () => {
    expect(() => loadPlan(undefined, "not-json")).toThrow("Invalid plan JSON");
  });

  it("throws on invalid plan schema", () => {
    const badPlan = JSON.stringify({ schemaVersion: "2.0.0", stories: [] });
    expect(() => loadPlan(undefined, badPlan)).toThrow("Invalid execution plan");
  });

  it("throws when planPath file not found", () => {
    expect(() => loadPlan("/nonexistent/plan.json")).toThrow("Plan file not found");
  });

  it("accepts plan with optional baselineCheck and lineage fields", () => {
    const planWithExtras = JSON.stringify({
      schemaVersion: "3.0.0",
      baselineCheck: "npm test",
      stories: [
        {
          id: "US-01",
          title: "Test",
          acceptanceCriteria: [
            { id: "AC-01", description: "Works", command: "echo ok" },
          ],
          lineage: { tier: "phase-plan", sourceId: "PH-01" },
        },
      ],
    });
    const plan = loadPlan(undefined, planWithExtras);
    expect(plan.baselineCheck).toBe("npm test");
    expect(plan.stories[0].lineage).toEqual({
      tier: "phase-plan",
      sourceId: "PH-01",
    });
  });
});
