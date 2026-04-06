import { describe, it, expect } from "vitest";
import { validateMasterPlan } from "./master-plan.js";

function validMasterPlan(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: "1.0.0",
    documentTier: "master",
    title: "Build three-tier document system",
    summary: "Implement master plan generation, phase expansion, and coherence evaluation.",
    phases: [
      {
        id: "PH-01",
        title: "Types and validation",
        description: "Create MasterPlan types and validators",
        dependencies: [],
        inputs: [],
        outputs: ["server/types/master-plan.ts", "server/validation/master-plan.ts"],
        estimatedStories: 2,
      },
    ],
    ...overrides,
  };
}

function twoPhases() {
  return {
    schemaVersion: "1.0.0",
    documentTier: "master",
    title: "Multi-phase project",
    summary: "A project with two sequential phases.",
    phases: [
      {
        id: "PH-01",
        title: "Foundation",
        description: "Set up types",
        dependencies: [],
        inputs: [],
        outputs: ["types/"],
        estimatedStories: 3,
      },
      {
        id: "PH-02",
        title: "Prompts",
        description: "Tier-aware prompts",
        dependencies: ["PH-01"],
        inputs: ["types/"],
        outputs: ["prompts/"],
        estimatedStories: 4,
      },
    ],
  };
}

describe("validateMasterPlan", () => {
  // ── Happy path ──

  it("accepts a valid single-phase master plan", () => {
    const result = validateMasterPlan(validMasterPlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("accepts a valid multi-phase master plan with dependencies", () => {
    const result = validateMasterPlan(twoPhases());
    expect(result.valid).toBe(true);
  });

  it("accepts crossCuttingConcerns when present as string array", () => {
    const result = validateMasterPlan(
      validMasterPlan({ crossCuttingConcerns: ["Cost tracking", "Audit trail"] }),
    );
    expect(result.valid).toBe(true);
  });

  // ── Null / wrong type ──

  it("rejects null input", () => {
    const result = validateMasterPlan(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Plan must be a non-null object");
  });

  it("rejects non-object input", () => {
    const result = validateMasterPlan("not an object");
    expect(result.valid).toBe(false);
  });

  // ── schemaVersion ──

  it("rejects wrong schemaVersion", () => {
    const result = validateMasterPlan(validMasterPlan({ schemaVersion: "2.0.0" }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects missing schemaVersion", () => {
    const plan = validMasterPlan();
    delete (plan as Record<string, unknown>).schemaVersion;
    const result = validateMasterPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  // ── documentTier ──

  it("rejects wrong documentTier", () => {
    const result = validateMasterPlan(validMasterPlan({ documentTier: "phase" }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("documentTier"))).toBe(true);
  });

  it("rejects missing documentTier", () => {
    const plan = validMasterPlan();
    delete (plan as Record<string, unknown>).documentTier;
    const result = validateMasterPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("documentTier"))).toBe(true);
  });

  // ── title ──

  it("rejects empty title", () => {
    const result = validateMasterPlan(validMasterPlan({ title: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("title must be a non-empty string"))).toBe(true);
  });

  it("rejects non-string title", () => {
    const result = validateMasterPlan(validMasterPlan({ title: 42 }));
    expect(result.valid).toBe(false);
  });

  // ── summary ──

  it("rejects empty summary", () => {
    const result = validateMasterPlan(validMasterPlan({ summary: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("summary must be a non-empty string"))).toBe(true);
  });

  it("rejects missing summary", () => {
    const plan = validMasterPlan();
    delete (plan as Record<string, unknown>).summary;
    const result = validateMasterPlan(plan);
    expect(result.valid).toBe(false);
  });

  // ── phases array ──

  it("rejects non-array phases", () => {
    const result = validateMasterPlan(validMasterPlan({ phases: "not-an-array" }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("phases must be an array"))).toBe(true);
  });

  it("rejects empty phases array", () => {
    const result = validateMasterPlan(validMasterPlan({ phases: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("at least one phase"))).toBe(true);
  });

  // ── Phase fields ──

  it("rejects phase with missing id", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            title: "No ID",
            description: "Missing id field",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("id must be a non-empty string"))).toBe(true);
  });

  it("rejects phase with empty title", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "",
            description: "Valid desc",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("title must be a non-empty string"))).toBe(true);
  });

  it("rejects phase with empty description", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("description must be a non-empty string"))).toBe(true);
  });

  // ── estimatedStories ──

  it("rejects zero estimatedStories", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: 0,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("estimatedStories must be a positive integer"))).toBe(true);
  });

  it("rejects non-integer estimatedStories", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: 2.5,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("estimatedStories"))).toBe(true);
  });

  it("rejects negative estimatedStories", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: -1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
  });

  // ── dependencies / inputs / outputs arrays ──

  it("rejects missing dependencies array", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("dependencies must be an array"))).toBe(true);
  });

  it("rejects missing inputs array", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            dependencies: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("inputs must be an array"))).toBe(true);
  });

  it("rejects missing outputs array", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            dependencies: [],
            inputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("outputs must be an array"))).toBe(true);
  });

  it("rejects non-string entries in inputs", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            dependencies: [],
            inputs: [42],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("input must be a string"))).toBe(true);
  });

  it("rejects non-string entries in outputs", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "Valid",
            description: "Valid desc",
            dependencies: [],
            inputs: [],
            outputs: [false],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("output must be a string"))).toBe(true);
  });

  // ── Duplicate phase IDs ──

  it("rejects duplicate phase IDs", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "A",
            description: "First",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
          {
            id: "PH-01",
            title: "B",
            description: "Duplicate",
            dependencies: [],
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes('Duplicate phase ID: "PH-01"'))).toBe(true);
  });

  // ── Dependency validation ──

  it("rejects dependency referencing non-existent phase", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "A",
            description: "First",
            dependencies: ["PH-99"],
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes('"PH-99" references non-existent phase'))).toBe(true);
  });

  it("rejects self-dependency", () => {
    const result = validateMasterPlan(
      validMasterPlan({
        phases: [
          {
            id: "PH-01",
            title: "A",
            description: "Self-dep",
            dependencies: ["PH-01"],
            inputs: [],
            outputs: [],
            estimatedStories: 1,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes('"PH-01" depends on itself'))).toBe(true);
  });

  it("rejects circular dependencies", () => {
    const result = validateMasterPlan({
      schemaVersion: "1.0.0",
      documentTier: "master",
      title: "Circular",
      summary: "A plan with circular phase dependencies.",
      phases: [
        {
          id: "PH-01",
          title: "A",
          description: "Depends on PH-02",
          dependencies: ["PH-02"],
          inputs: [],
          outputs: [],
          estimatedStories: 1,
        },
        {
          id: "PH-02",
          title: "B",
          description: "Depends on PH-01",
          dependencies: ["PH-01"],
          inputs: [],
          outputs: [],
          estimatedStories: 1,
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("Circular dependency"))).toBe(true);
  });

  it("skips cycle detection when missing refs exist", () => {
    const result = validateMasterPlan({
      schemaVersion: "1.0.0",
      documentTier: "master",
      title: "Missing ref",
      summary: "A plan with a missing dependency reference.",
      phases: [
        {
          id: "PH-01",
          title: "A",
          description: "Depends on non-existent",
          dependencies: ["PH-99"],
          inputs: [],
          outputs: [],
          estimatedStories: 1,
        },
        {
          id: "PH-02",
          title: "B",
          description: "Depends on PH-01",
          dependencies: ["PH-01"],
          inputs: [],
          outputs: [],
          estimatedStories: 1,
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("non-existent"))).toBe(true);
    // Should not mention circular dependency
    expect(result.errors?.some((e) => e.includes("Circular"))).toBe(false);
  });

  // ── crossCuttingConcerns ──

  it("rejects non-array crossCuttingConcerns", () => {
    const result = validateMasterPlan(
      validMasterPlan({ crossCuttingConcerns: "not-an-array" }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("crossCuttingConcerns must be an array"))).toBe(true);
  });

  it("rejects non-string entries in crossCuttingConcerns", () => {
    const result = validateMasterPlan(
      validMasterPlan({ crossCuttingConcerns: ["valid", 42] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("crossCuttingConcerns[1] must be a string"))).toBe(true);
  });

  // ── Edge cases ──

  it("accepts plan without crossCuttingConcerns (optional field)", () => {
    const plan = validMasterPlan();
    delete (plan as Record<string, unknown>).crossCuttingConcerns;
    const result = validateMasterPlan(plan);
    expect(result.valid).toBe(true);
  });

  it("collects multiple errors at once", () => {
    const result = validateMasterPlan({
      schemaVersion: "9.0.0",
      documentTier: "wrong",
      title: "",
      summary: "",
      phases: [
        {
          id: "PH-01",
          title: "",
          description: "",
          dependencies: [],
          inputs: [],
          outputs: [],
          estimatedStories: 0,
        },
      ],
    });
    expect(result.valid).toBe(false);
    // Should have at least errors for: schemaVersion, documentTier, title, summary, phase title, phase description, estimatedStories
    expect(result.errors!.length).toBeGreaterThanOrEqual(7);
  });

  it("rejects phase that is a non-object", () => {
    const result = validateMasterPlan(
      validMasterPlan({ phases: ["not-an-object"] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("must be an object"))).toBe(true);
  });
});
