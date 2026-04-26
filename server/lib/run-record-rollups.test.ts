/**
 * v0.38.0 — RunRecord rollups: top-level verdict alias (AC-8) and
 * totalCostUsd computed via computeSpecGenCostUsd (AC-10).
 *
 * Pure unit tests of the math + invariants — exercises computeSpecGenCostUsd
 * directly and verifies the alias contract via a written run record fixture
 * read back from disk (since AC-8 / AC-10 are observable from outside the
 * diff via `jq -e`-style JSON assertions).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeSpecGenCostUsd,
  writeRunRecord,
  type RunRecord,
} from "./run-record.js";

describe("computeSpecGenCostUsd — v0.38.0 B5 token-rate math", () => {
  it("returns 0 for undefined genTokens", () => {
    expect(computeSpecGenCostUsd(undefined)).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeSpecGenCostUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("matches the claude-sonnet-4-6 per-million rate from cost.ts (input $3 / output $15)", () => {
    // 1M input + 1M output = $3 + $15 = $18.
    expect(
      computeSpecGenCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(18, 6);
  });

  it("scales linearly: 1k tokens each ≈ $0.018", () => {
    expect(
      computeSpecGenCostUsd({ inputTokens: 1000, outputTokens: 1000 }),
    ).toBeCloseTo(0.018, 6);
  });
});

describe("RunRecord rollups on disk — AC-8 verdict alias + AC-10 totalCostUsd", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "forge-runrec-"));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  function readSoleRunRecord(): RunRecord {
    const dir = join(projectPath, ".forge", "runs");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const content = readFileSync(join(dir, files[0]), "utf-8");
    return JSON.parse(content) as RunRecord;
  }

  it("AC-8: written record satisfies record.verdict === record.evalVerdict", async () => {
    const record: RunRecord = {
      timestamp: new Date().toISOString(),
      tool: "forge_evaluate",
      documentTier: null,
      mode: null,
      tier: null,
      storyId: "US-01",
      evalVerdict: "PASS",
      verdict: "PASS",
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        critiqueRounds: 0,
        findingsTotal: 0,
        findingsApplied: 0,
        findingsRejected: 0,
        validationRetries: 0,
        durationMs: 100,
        estimatedCostUsd: 0.001,
      },
      outcome: "success",
    };
    await writeRunRecord(projectPath, record);
    const written = readSoleRunRecord();
    expect(written.verdict).toBeDefined();
    expect(written.evalVerdict).toBeDefined();
    expect(written.verdict).toBe(written.evalVerdict);
  });

  it("AC-10: totalCostUsd === metrics.estimatedCostUsd + computeSpecGenCostUsd(generatedDocs.genTokens)", async () => {
    const genTokens = { inputTokens: 5000, outputTokens: 1000 };
    const baseCost = 0.0123;
    const expectedTotal = baseCost + computeSpecGenCostUsd(genTokens);
    const record: RunRecord = {
      timestamp: new Date().toISOString(),
      tool: "forge_evaluate",
      documentTier: null,
      mode: null,
      tier: null,
      storyId: "US-02",
      evalVerdict: "PASS",
      verdict: "PASS",
      generatedDocs: {
        specPath: "TECH.md",
        adrPaths: [],
        genTimestamp: new Date().toISOString(),
        genTokens,
        contracts: [],
        warnings: [],
      },
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        critiqueRounds: 0,
        findingsTotal: 0,
        findingsApplied: 0,
        findingsRejected: 0,
        validationRetries: 0,
        durationMs: 100,
        estimatedCostUsd: baseCost,
      },
      totalCostUsd: expectedTotal,
      outcome: "success",
    };
    await writeRunRecord(projectPath, record);
    const written = readSoleRunRecord();

    // Equality via the verification expression in AC-10.
    const computed =
      (written.metrics.estimatedCostUsd ?? 0) +
      computeSpecGenCostUsd(written.generatedDocs?.genTokens);
    expect(written.totalCostUsd).toBeCloseTo(computed, 10);
  });
});
