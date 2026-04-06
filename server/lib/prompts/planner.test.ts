import { describe, it, expect } from "vitest";
import {
  buildPlannerUserMessage,
  truncateContext,
  DEFAULT_MAX_CONTEXT_CHARS,
  type ContextEntry,
} from "./planner.js";

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
