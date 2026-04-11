import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseTypeDefinitions, extractTypeReferences, verifySpecVocabulary } from "./spec-vocabulary-check.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "spec-vocab-test-" + process.pid);

beforeEach(async () => {
  await mkdir(join(TEST_DIR, "types"), { recursive: true });
  await mkdir(join(TEST_DIR, "lib"), { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ── parseTypeDefinitions ────────────────────────────────────

describe("parseTypeDefinitions", () => {
  it("multi-root: builds Map containing types from server/types/ AND server/lib/ including RunRecord", async () => {
    await writeFile(
      join(TEST_DIR, "types", "eval-report.ts"),
      `export interface EvalReport {\n  storyId: string;\n  verdict: "PASS" | "FAIL";\n  criteria: CriterionResult[];\n}\n`,
    );
    await writeFile(
      join(TEST_DIR, "lib", "run-record.ts"),
      `export interface RunRecord {\n  timestamp: string;\n  tool: string;\n  storyId?: string;\n  evalVerdict?: string;\n  evalReport?: EvalReport;\n  metrics: { inputTokens: number; outputTokens: number; };\n}\n`,
    );

    const typeMap = await parseTypeDefinitions([join(TEST_DIR, "types"), join(TEST_DIR, "lib")]);

    expect(typeMap.has("EvalReport")).toBe(true);
    expect(typeMap.get("EvalReport")!.has("criteria")).toBe(true);
    expect(typeMap.has("RunRecord")).toBe(true);
    expect(typeMap.get("RunRecord")!.has("timestamp")).toBe(true);
    expect(typeMap.get("RunRecord")!.has("storyId")).toBe(true);
    expect(typeMap.get("RunRecord")!.has("metrics")).toBe(true);
  });

  it("excludes *.test.ts files", async () => {
    await writeFile(join(TEST_DIR, "types", "foo.test.ts"), `export interface TestOnly { x: number; }\n`);
    await writeFile(join(TEST_DIR, "types", "real.ts"), `export interface RealType { y: string; }\n`);

    const typeMap = await parseTypeDefinitions([join(TEST_DIR, "types")]);
    expect(typeMap.has("TestOnly")).toBe(false);
    expect(typeMap.has("RealType")).toBe(true);
  });

  it("handles type aliases (type X = { ... })", async () => {
    await writeFile(
      join(TEST_DIR, "types", "alias.ts"),
      `export type StoryConfig = {\n  ordering: string;\n  verbose?: boolean;\n};\n`,
    );

    const typeMap = await parseTypeDefinitions([join(TEST_DIR, "types")]);
    expect(typeMap.has("StoryConfig")).toBe(true);
    expect(typeMap.get("StoryConfig")!.has("ordering")).toBe(true);
  });

  it("handles missing directory gracefully", async () => {
    const typeMap = await parseTypeDefinitions([join(TEST_DIR, "nonexistent")]);
    expect(typeMap.size).toBe(0);
  });
});

// ── extractTypeReferences ���──────────────────────────────────

describe("extractTypeReferences", () => {
  it("finds backtick-quoted TypeName.fieldName patterns in markdown", () => {
    const content = [
      "# Spec",
      "The `EvalReport.criteria` field contains results.",
      "Check `RunRecord.metrics.estimatedCostUsd` for cost data.",
      "Also `Story.dependencies` is optional.",
      "No match: `lowercase.field` or `Type.PascalCase`",
    ].join("\n");

    const refs = extractTypeReferences(content);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ type: "EvalReport", field: "criteria", line: 2 });
    expect(refs[1]).toEqual({ type: "RunRecord", field: "metrics", line: 3 });
    expect(refs[2]).toEqual({ type: "Story", field: "dependencies", line: 4 });
  });

  it("ignores non-backtick references", () => {
    const refs = extractTypeReferences("EvalReport.criteria without backticks.");
    expect(refs).toHaveLength(0);
  });
});

// ── verifySpecVocabulary ────────────────────────────────────

describe("verifySpecVocabulary", () => {
  it("drift detection POSITIVE: EvalReport.findings �� unknown-field", async () => {
    await writeFile(
      join(TEST_DIR, "types", "eval-report.ts"),
      `export interface EvalReport {\n  storyId: string;\n  verdict: string;\n  criteria: CriterionResult[];\n}\n`,
    );
    const prdPath = join(TEST_DIR, "prd.md");
    await writeFile(prdPath, "The `EvalReport.findings` should be sorted.\n");

    const results = await verifySpecVocabulary(prdPath, [join(TEST_DIR, "types")]);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("EvalReport");
    expect(results[0].field).toBe("findings");
    expect(results[0].kind).toBe("unknown-field");
  });

  it("no drift with valid fields → negative empty result", async () => {
    await writeFile(
      join(TEST_DIR, "types", "eval-report.ts"),
      `export interface EvalReport {\n  storyId: string;\n  verdict: string;\n  criteria: CriterionResult[];\n}\n`,
    );
    const prdPath = join(TEST_DIR, "prd.md");
    await writeFile(prdPath, "Check `EvalReport.criteria` and `EvalReport.verdict`.\n");

    const results = await verifySpecVocabulary(prdPath, [join(TEST_DIR, "types")]);
    expect(results).toHaveLength(0);
  });

  it("unknown type: FooBar.baz → kind: unknown-type (not a crash)", async () => {
    await writeFile(join(TEST_DIR, "types", "eval-report.ts"), `export interface EvalReport { storyId: string; }\n`);
    const prdPath = join(TEST_DIR, "prd.md");
    await writeFile(prdPath, "Reference `FooBar.baz` in the spec.\n");

    const results = await verifySpecVocabulary(prdPath, [join(TEST_DIR, "types")]);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("unknown-type");
  });

  it("real PRD regression: forge-coordinate-prd.md has zero unknown-field results", async () => {
    const projectRoot = join(import.meta.dirname, "..", "..");
    const prdPath = join(projectRoot, "docs", "forge-coordinate-prd.md");
    const sourceDirs = [join(projectRoot, "server", "types"), join(projectRoot, "server", "lib")];

    const results = await verifySpecVocabulary(prdPath, sourceDirs);
    const unknownFields = results.filter((r) => r.kind === "unknown-field");
    if (unknownFields.length > 0) {
      console.error("Unexpected unknown-field results:", JSON.stringify(unknownFields, null, 2));
    }
    expect(unknownFields).toHaveLength(0);
  });

  it("handles missing PRD gracefully (returns empty)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = await verifySpecVocabulary(join(TEST_DIR, "nonexistent.md"), [join(TEST_DIR, "types")]);
    expect(results).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
