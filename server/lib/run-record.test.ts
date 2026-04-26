import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeRunRecord,
  type RunRecord,
  GeneratedDocsSchema,
  SpecGeneratorWarningSchema,
} from "./run-record.js";

let tempDir: string;

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    timestamp: "2026-04-06T12:00:00.000Z",
    tool: "forge_plan",
    documentTier: null,
    mode: "feature",
    tier: "thorough",
    metrics: {
      inputTokens: 1000,
      outputTokens: 500,
      critiqueRounds: 2,
      findingsTotal: 5,
      findingsApplied: 4,
      findingsRejected: 1,
      validationRetries: 0,
      durationMs: 45000,
    },
    outcome: "success",
    ...overrides,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forge-run-record-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("writeRunRecord", () => {
  it("writes a run record JSON file to .forge/runs/", async () => {
    const record = makeRunRecord();
    await writeRunRecord(tempDir, record);

    const runsDir = join(tempDir, ".forge", "runs");
    const files = await readdir(runsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^forge_plan-.*\.json$/);

    const content = JSON.parse(await readFile(join(runsDir, files[0]), "utf-8"));
    expect(content.tool).toBe("forge_plan");
    expect(content.metrics.inputTokens).toBe(1000);
    expect(content.outcome).toBe("success");
  });

  it("creates .forge/runs/ directory if it does not exist", async () => {
    const record = makeRunRecord();
    await writeRunRecord(tempDir, record);

    const runsDir = join(tempDir, ".forge", "runs");
    const files = await readdir(runsDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it("produces distinct filenames for concurrent invocations", async () => {
    const record = makeRunRecord();
    // Write two records with the same timestamp
    await Promise.all([
      writeRunRecord(tempDir, record),
      writeRunRecord(tempDir, record),
    ]);

    const runsDir = join(tempDir, ".forge", "runs");
    const files = await readdir(runsDir);
    expect(files).toHaveLength(2);
    expect(files[0]).not.toBe(files[1]);
  });

  it("includes token counts, finding counts, outcome, and duration", async () => {
    const record = makeRunRecord({
      metrics: {
        inputTokens: 2000,
        outputTokens: 800,
        critiqueRounds: 1,
        findingsTotal: 3,
        findingsApplied: 2,
        findingsRejected: 1,
        validationRetries: 1,
        durationMs: 30000,
      },
    });
    await writeRunRecord(tempDir, record);

    const runsDir = join(tempDir, ".forge", "runs");
    const files = await readdir(runsDir);
    const content = JSON.parse(await readFile(join(runsDir, files[0]), "utf-8"));

    expect(content.metrics.inputTokens).toBe(2000);
    expect(content.metrics.outputTokens).toBe(800);
    expect(content.metrics.findingsTotal).toBe(3);
    expect(content.metrics.findingsApplied).toBe(2);
    expect(content.metrics.findingsRejected).toBe(1);
    expect(content.metrics.validationRetries).toBe(1);
    expect(content.metrics.durationMs).toBe(30000);
    expect(content.outcome).toBe("success");
  });

  it("does not crash when write fails (e.g., invalid path)", async () => {
    const record = makeRunRecord();
    // This should not throw — it logs and swallows the error
    await expect(
      writeRunRecord("/nonexistent/path/xyz", record),
    ).resolves.toBeUndefined();
  });

  it("uses Windows-safe filenames (no colons)", async () => {
    const record = makeRunRecord({
      timestamp: "2026-04-06T12:30:45.123Z",
    });
    await writeRunRecord(tempDir, record);

    const runsDir = join(tempDir, ".forge", "runs");
    const files = await readdir(runsDir);
    expect(files[0]).not.toContain(":");
  });
});

describe("GeneratedDocsSchema (AC-10) — warnings is a typed array, default []", () => {
  it("parses a generatedDocs object lacking 'warnings' and defaults it to []", () => {
    // Forward-compat: pre-2026-04-26 records that omit `warnings` must still parse.
    const legacy = {
      specPath: "/abs/docs/generated/TECHNICAL-SPEC.md",
      adrPaths: [],
      genTimestamp: "2026-04-20T05:00:00.000Z",
      genTokens: { inputTokens: 100, outputTokens: 50 },
      contracts: ["forge_evaluate"],
    };
    const parsed = GeneratedDocsSchema.parse(legacy);
    expect(parsed.warnings).toEqual([]);
  });

  it("parses a generatedDocs object with explicit empty warnings array", () => {
    const fresh = {
      specPath: "/abs/docs/generated/TECHNICAL-SPEC.md",
      adrPaths: [],
      genTimestamp: "2026-04-26T05:00:00.000Z",
      genTokens: { inputTokens: 100, outputTokens: 50 },
      contracts: [],
      warnings: [],
    };
    const parsed = GeneratedDocsSchema.parse(fresh);
    expect(parsed.warnings).toEqual([]);
  });

  it("parses a generatedDocs object with a populated warnings array", () => {
    const withStrips = {
      specPath: "/abs/docs/generated/TECHNICAL-SPEC.md",
      adrPaths: [],
      genTimestamp: "2026-04-26T05:00:00.000Z",
      genTokens: { inputTokens: 100, outputTokens: 50 },
      contracts: [],
      warnings: [
        {
          kind: "stripped-unknown-identifier",
          identifier: "Foo.qux",
          section: "api-contracts",
          filesScanned: 3,
        },
      ],
    };
    const parsed = GeneratedDocsSchema.parse(withStrips);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].kind).toBe("stripped-unknown-identifier");
    expect(parsed.warnings[0].identifier).toBe("Foo.qux");
  });

  it("rejects a warning whose kind is unknown", () => {
    const bogus = {
      kind: "completely-different-shape",
      identifier: "Foo",
      section: "api-contracts",
      filesScanned: 1,
    };
    expect(() => SpecGeneratorWarningSchema.parse(bogus)).toThrow();
  });
});
