import { describe, it, expect } from "vitest";
import { validateExecutionPlan } from "./execution-plan.js";

function validPlan(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-01",
        title: "Test story",
        dependencies: [],
        acceptanceCriteria: [
          {
            id: "AC-01",
            description: "Runs successfully",
            command: "echo PASS",
          },
        ],
        affectedPaths: ["server/"],
      },
    ],
    ...overrides,
  };
}

describe("validateExecutionPlan", () => {
  it("accepts a valid plan", () => {
    const result = validateExecutionPlan(validPlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("rejects null input", () => {
    const result = validateExecutionPlan(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Plan must be a non-null object");
  });

  it("rejects wrong schemaVersion", () => {
    const result = validateExecutionPlan(validPlan({ schemaVersion: "2.0.0" }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects missing schemaVersion", () => {
    const plan = validPlan();
    delete (plan as Record<string, unknown>).schemaVersion;
    const result = validateExecutionPlan(plan);
    expect(result.valid).toBe(false);
  });

  it("rejects non-array stories", () => {
    const result = validateExecutionPlan(validPlan({ stories: "not-an-array" }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("stories must be an array"))).toBe(true);
  });

  it("rejects empty stories array", () => {
    const result = validateExecutionPlan(validPlan({ stories: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("at least one story"))).toBe(true);
  });

  it("rejects story with missing id", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          { title: "No ID", acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("id must be a non-empty string"))).toBe(true);
  });

  it("rejects story with empty title", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          { id: "US-01", title: "", acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("title must be a non-empty string"))).toBe(true);
  });

  it("rejects duplicate story IDs", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          { id: "US-01", title: "A", acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }] },
          { id: "US-01", title: "B", acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes('Duplicate story ID: "US-01"'))).toBe(true);
  });

  it("rejects empty acceptanceCriteria", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [{ id: "US-01", title: "A", acceptanceCriteria: [] }],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("at least one criterion"))).toBe(true);
  });

  it("rejects AC with missing command", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          { id: "US-01", title: "A", acceptanceCriteria: [{ id: "AC-01", description: "d" }] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("command must be a non-empty string"))).toBe(true);
  });

  it("rejects duplicate AC IDs within a story", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          {
            id: "US-01",
            title: "A",
            acceptanceCriteria: [
              { id: "AC-01", description: "d", command: "c" },
              { id: "AC-01", description: "d2", command: "c2" },
            ],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes('duplicate AC ID "AC-01"'))).toBe(true);
  });

  it("rejects dependency referencing non-existent story", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          {
            id: "US-01",
            title: "A",
            dependencies: ["US-99"],
            acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes('"US-99" references non-existent story'))).toBe(true);
  });

  it("rejects self-dependency with specific error message", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          {
            id: "US-01",
            title: "A",
            dependencies: ["US-01"],
            acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes('"US-01" depends on itself'))).toBe(true);
  });

  it("rejects circular dependencies", () => {
    const result = validateExecutionPlan({
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "A",
          dependencies: ["US-02"],
          acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
        },
        {
          id: "US-02",
          title: "B",
          dependencies: ["US-01"],
          acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("Circular dependency"))).toBe(true);
  });

  it("rejects non-boolean flaky field", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          {
            id: "US-01",
            title: "A",
            acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c", flaky: "yes" }],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("flaky must be a boolean"))).toBe(true);
  });

  it("accepts plan with baselineCheck field", () => {
    const result = validateExecutionPlan({
      ...validPlan(),
      baselineCheck: "npm run build && npm test",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts story with lineage field", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          {
            id: "US-01",
            title: "A",
            acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
            lineage: { tier: "phase-plan", sourceId: "PH-01" },
          },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts valid boolean flaky field", () => {
    const result = validateExecutionPlan(
      validPlan({
        stories: [
          {
            id: "US-01",
            title: "A",
            acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c", flaky: true }],
          },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts plan with valid dependencies", () => {
    const result = validateExecutionPlan({
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "A",
          dependencies: [],
          acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
        },
        {
          id: "US-02",
          title: "B",
          dependencies: ["US-01"],
          acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("skips cycle detection when missing refs exist", () => {
    // US-01 depends on US-03 (missing) and US-02 depends on US-01
    // This should report missing ref but NOT attempt cycle detection
    const result = validateExecutionPlan({
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "A",
          dependencies: ["US-03"],
          acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
        },
        {
          id: "US-02",
          title: "B",
          dependencies: ["US-01"],
          acceptanceCriteria: [{ id: "AC-01", description: "d", command: "c" }],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("non-existent"))).toBe(true);
    // Should not mention circular dependency
    expect(result.errors?.some((e) => e.includes("Circular"))).toBe(false);
  });
});
