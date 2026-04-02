import { describe, it, expect } from "vitest";
import { validateEvalReport } from "./eval-report.js";

function makeValidReport() {
  return {
    storyId: "US-01",
    verdict: "PASS",
    criteria: [
      { id: "AC-01", status: "PASS", evidence: "ok" },
    ],
  };
}

describe("validateEvalReport", () => {
  it("returns valid for a correct report", () => {
    const result = validateEvalReport(makeValidReport());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("rejects null input", () => {
    const result = validateEvalReport(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Report must be a non-null object");
  });

  it("rejects missing storyId", () => {
    const report = makeValidReport();
    delete (report as Record<string, unknown>).storyId;
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("storyId"))).toBe(true);
  });

  it("rejects empty storyId", () => {
    const report = { ...makeValidReport(), storyId: "" };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("storyId"))).toBe(true);
  });

  it("rejects invalid verdict", () => {
    const report = { ...makeValidReport(), verdict: "MAYBE" };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("verdict"))).toBe(true);
  });

  it("accepts all valid verdicts", () => {
    for (const verdict of ["PASS", "FAIL", "INCONCLUSIVE"]) {
      const report = { ...makeValidReport(), verdict };
      const result = validateEvalReport(report);
      expect(result.valid).toBe(true);
    }
  });

  it("rejects non-array criteria", () => {
    const report = { ...makeValidReport(), criteria: "not-array" };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("criteria must be an array"))).toBe(true);
  });

  it("accepts empty criteria array", () => {
    const report = { ...makeValidReport(), criteria: [] };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(true);
  });

  it("rejects criterion with missing id", () => {
    const report = {
      ...makeValidReport(),
      criteria: [{ status: "PASS", evidence: "ok" }],
    };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("id must be a non-empty string"))).toBe(true);
  });

  it("rejects criterion with invalid status", () => {
    const report = {
      ...makeValidReport(),
      criteria: [{ id: "AC-01", status: "UNKNOWN", evidence: "ok" }],
    };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("status must be one of"))).toBe(true);
  });

  it("accepts all valid criterion statuses", () => {
    for (const status of ["PASS", "FAIL", "SKIPPED", "INCONCLUSIVE"]) {
      const report = {
        ...makeValidReport(),
        criteria: [{ id: "AC-01", status, evidence: "ok" }],
      };
      const result = validateEvalReport(report);
      expect(result.valid).toBe(true);
    }
  });

  it("rejects criterion with missing evidence", () => {
    const report = {
      ...makeValidReport(),
      criteria: [{ id: "AC-01", status: "PASS" }],
    };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("evidence must be a string"))).toBe(true);
  });

  it("accepts empty string evidence", () => {
    const report = {
      ...makeValidReport(),
      criteria: [{ id: "AC-01", status: "PASS", evidence: "" }],
    };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(true);
  });

  it("rejects duplicate criterion IDs", () => {
    const report = {
      ...makeValidReport(),
      criteria: [
        { id: "AC-01", status: "PASS", evidence: "ok" },
        { id: "AC-01", status: "FAIL", evidence: "bad" },
      ],
    };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("Duplicate criterion ID"))).toBe(true);
  });

  it("accepts report with warnings", () => {
    const report = { ...makeValidReport(), warnings: ["test warning"] };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(true);
  });

  it("rejects non-array warnings", () => {
    const report = { ...makeValidReport(), warnings: "not-array" };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("warnings must be an array"))).toBe(true);
  });

  it("rejects non-string warning entries", () => {
    const report = { ...makeValidReport(), warnings: [42] };
    const result = validateEvalReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("warnings[0]: must be a string"))).toBe(true);
  });
});
