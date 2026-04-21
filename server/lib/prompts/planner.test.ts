import { describe, it, expect } from "vitest";
import {
  buildPlannerPrompt,
  buildPlannerUserMessage,
  buildMasterPlannerPrompt,
  buildMasterPlannerUserMessage,
  buildPhasePlannerPrompt,
  buildPhasePlannerUserMessage,
  buildUpdatePlannerPrompt,
  buildUpdatePlannerUserMessage,
  truncateContext,
  DEFAULT_MAX_CONTEXT_CHARS,
  type ContextEntry,
} from "./planner.js";
import {
  AC_CWD_POLICY_MARKER,
  AC_CWD_POLICY_BASENAME_TOKEN,
  AC_CWD_POLICY_WRONG_EXAMPLE,
  AC_CWD_POLICY_RIGHT_EXAMPLE,
  AC_CWD_POLICY_PROVENANCE,
} from "./shared/ac-subprocess-rules.js";

describe("truncateContext", () => {
  it("returns all entries when within budget", () => {
    const entries: ContextEntry[] = [
      { label: "Patterns", content: "P1: tight scope" },
      { label: "Anti-patterns", content: "F2: no consequences" },
    ];
    const result = truncateContext(entries, 1000);
    expect(result).toHaveLength(2);
  });

  it("drops last entries first when exceeding budget", () => {
    const entries: ContextEntry[] = [
      { label: "High priority", content: "A".repeat(100) },
      { label: "Medium priority", content: "B".repeat(100) },
      { label: "Low priority", content: "C".repeat(100) },
    ];
    // Budget fits ~2 entries (each ~110 chars with overhead)
    const result = truncateContext(entries, 250);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("High priority");
    expect(result[1].label).toBe("Medium priority");
  });

  it("drops entries whole — never mid-truncates", () => {
    const entries: ContextEntry[] = [
      { label: "Big entry", content: "X".repeat(500) },
    ];
    const result = truncateContext(entries, 100);
    // The single entry exceeds budget, so it gets dropped entirely
    expect(result).toHaveLength(0);
  });

  it("returns empty array for zero budget", () => {
    const entries: ContextEntry[] = [
      { label: "Any", content: "content" },
    ];
    const result = truncateContext(entries, 0);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    const result = truncateContext([], 1000);
    expect(result).toHaveLength(0);
  });
});

describe("buildPlannerUserMessage", () => {
  it("includes intent", () => {
    const msg = buildPlannerUserMessage("add dark mode");
    expect(msg).toContain("## Intent");
    expect(msg).toContain("add dark mode");
  });

  it("includes codebase context when provided", () => {
    const msg = buildPlannerUserMessage("add button", "## Directory Structure\nsrc/");
    expect(msg).toContain("## Codebase Context");
    expect(msg).toContain("src/");
  });

  it("injects context entries under Additional Context heading", () => {
    const context: ContextEntry[] = [
      { label: "Proven patterns", content: "P27: tight scope" },
      { label: "Anti-patterns", content: "F2: no consequences" },
    ];
    const msg = buildPlannerUserMessage("add button", undefined, context);
    expect(msg).toContain("## Additional Context");
    expect(msg).toContain("### Proven patterns");
    expect(msg).toContain("P27: tight scope");
    expect(msg).toContain("### Anti-patterns");
    expect(msg).toContain("F2: no consequences");
  });

  it("truncates context at maxContextChars", () => {
    const context: ContextEntry[] = [
      { label: "Small", content: "fits" },
      { label: "Big", content: "X".repeat(10000) },
    ];
    const msg = buildPlannerUserMessage("intent", undefined, context, 100);
    expect(msg).toContain("### Small");
    expect(msg).not.toContain("### Big");
    expect(msg).toContain("1 context entries omitted");
  });

  it("does not add Additional Context section when context is empty", () => {
    const msg = buildPlannerUserMessage("intent", undefined, []);
    expect(msg).not.toContain("Additional Context");
  });

  it("does not add Additional Context section when context is undefined", () => {
    const msg = buildPlannerUserMessage("intent");
    expect(msg).not.toContain("Additional Context");
  });

  it("uses DEFAULT_MAX_CONTEXT_CHARS when maxContextChars not specified", () => {
    // Verify the default exists and is a reasonable value
    expect(DEFAULT_MAX_CONTEXT_CHARS).toBe(50_000);
  });
});

describe("buildMasterPlannerPrompt", () => {
  it("specifies master-plan v1.0.0 schema", () => {
    const prompt = buildMasterPlannerPrompt();
    expect(prompt).toContain('"schemaVersion": "1.0.0"');
    expect(prompt).toContain('"documentTier": "master"');
  });

  it("includes phase decomposition rules", () => {
    const prompt = buildMasterPlannerPrompt();
    expect(prompt).toContain("Phase Rules");
    expect(prompt).toContain("PH-01");
    expect(prompt).toContain("estimatedStories");
  });

  it("prohibits implementation details", () => {
    const prompt = buildMasterPlannerPrompt();
    expect(prompt).toContain("No implementation details");
  });

  it("includes evidence-gating rule", () => {
    const prompt = buildMasterPlannerPrompt();
    expect(prompt).toContain("Evidence-Gating");
  });
});

describe("buildMasterPlannerUserMessage", () => {
  it("includes vision document", () => {
    const msg = buildMasterPlannerUserMessage("Build a feature");
    expect(msg).toContain("## Vision Document");
    expect(msg).toContain("Build a feature");
  });

  it("includes codebase context when provided", () => {
    const msg = buildMasterPlannerUserMessage("Build", "## Dir\nsrc/");
    expect(msg).toContain("## Codebase Context");
  });

  it("injects context entries", () => {
    const msg = buildMasterPlannerUserMessage("Build", undefined, [
      { label: "KB", content: "patterns" },
    ]);
    expect(msg).toContain("### KB");
    expect(msg).toContain("patterns");
  });
});

describe("buildPhasePlannerPrompt", () => {
  it("extends the base planner prompt", () => {
    const prompt = buildPhasePlannerPrompt("feature");
    expect(prompt).toContain("Prefer a single story"); // from base
    expect(prompt).toContain("Phase Context Rules"); // phase extension
  });

  it("includes phase-specific constraints", () => {
    const prompt = buildPhasePlannerPrompt("full-project");
    expect(prompt).toContain("ONE phase");
    expect(prompt).toContain("documentTier");
    expect(prompt).toContain("phaseId");
  });
});

describe("buildPhasePlannerUserMessage", () => {
  it("includes vision doc, master plan, and phase ID", () => {
    const msg = buildPhasePlannerUserMessage("PRD here", '{"phases":[]}', "PH-01");
    expect(msg).toContain("## Vision Document");
    expect(msg).toContain("PRD here");
    expect(msg).toContain("## Master Plan");
    expect(msg).toContain("## Target Phase");
    expect(msg).toContain("PH-01");
  });
});

describe("buildUpdatePlannerPrompt", () => {
  it("describes method vs functional divergence handling", () => {
    const prompt = buildUpdatePlannerPrompt();
    expect(prompt).toContain("Method Divergence");
    expect(prompt).toContain("Functional Divergence");
  });

  it("requires observable behavior ACs", () => {
    const prompt = buildUpdatePlannerPrompt();
    expect(prompt).toContain("OBSERVABLE BEHAVIOR");
  });
});

describe("buildUpdatePlannerUserMessage", () => {
  it("includes current plan and implementation notes", () => {
    const msg = buildUpdatePlannerUserMessage('{"stories":[]}', "Used Redis instead of Memcached");
    expect(msg).toContain("## Current Plan");
    expect(msg).toContain("## Implementation Notes");
    expect(msg).toContain("Used Redis instead of Memcached");
  });
});

describe("AC cwd-policy — prevents doubled-cd defect (monday-bot 2026-04-20)", () => {
  const modes = ["feature", "full-project", "bugfix"] as const;

  it.each(modes)(
    "buildPlannerPrompt(%s) tells the model cwd is already projectPath",
    (mode) => {
      const prompt = buildPlannerPrompt(mode);
      expect(prompt).toContain("Working directory");
      expect(prompt).toContain(AC_CWD_POLICY_MARKER);
      expect(prompt).toContain("projectPath");
    },
  );

  it.each(modes)(
    "buildPlannerPrompt(%s) forbids the doubled-cd-into-basename prefix",
    (mode) => {
      const prompt = buildPlannerPrompt(mode);
      expect(prompt).toContain(AC_CWD_POLICY_BASENAME_TOKEN);
      expect(prompt).toContain(AC_CWD_POLICY_WRONG_EXAMPLE);
      expect(prompt).toContain(AC_CWD_POLICY_RIGHT_EXAMPLE);
    },
  );

  it("the forbidden example names monday-bot so future readers see the provenance", () => {
    const prompt = buildPlannerPrompt("full-project");
    expect(prompt).toContain(AC_CWD_POLICY_PROVENANCE);
  });

  it("buildPhasePlannerPrompt inherits the cwd-policy from the base prompt", () => {
    const prompt = buildPhasePlannerPrompt("feature");
    expect(prompt).toContain(AC_CWD_POLICY_MARKER);
    expect(prompt).toContain(AC_CWD_POLICY_BASENAME_TOKEN);
  });
});
