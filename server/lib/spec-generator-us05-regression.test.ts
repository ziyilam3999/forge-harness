/**
 * AC-7 — US-05 regression replay.
 *
 * Reproduces the hallucinated US-05 spec (`KnowledgeService.search`,
 * `KnowledgeDocument`, etc., that did not exist in the source) and asserts
 * the new grounding + post-validator pair strips the fabrications and
 * preserves only the real surface (`query`, `indexFile`, `getStatus`,
 * `QueryResult`, `ServiceStatus`).
 *
 * Fixture inputs:
 *   - `__fixtures__/us-05-replay/src/knowledge/service.ts` (snapshot from
 *     monday-bot commit 9fecce5)
 *   - `__fixtures__/us-05-replay/tests/knowledge.test.ts` (same snapshot)
 *   - `__fixtures__/us-05-replay/eval-report.json` (distilled from the
 *     run-record `forge_evaluate-2026-04-26T05-14-38-941Z-4702.json`)
 *
 * Determinism: synthesis is stubbed to emit the actual hallucinated bullet
 * shape captured in the run-record; we exercise the validator path, not a
 * real LLM call.
 *
 * AC-9 (US-03 invariant preservation) lives in this file too — same project
 * uses the dimension-384 fixture inline.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateSpecForStory, type SynthesisResponse } from "./spec-generator.js";
import { RunContext } from "./run-context.js";
import type { EvalReport } from "../types/eval-report.js";

const FIXTURE_ROOT = resolve(__dirname, "__fixtures__", "us-05-replay");

function loadEvalReport(): EvalReport {
  const txt = readFileSync(join(FIXTURE_ROOT, "eval-report.json"), "utf-8");
  return JSON.parse(txt) as EvalReport;
}

/**
 * Replay the exact hallucination shape captured in the 2026-04-26 run-record:
 *   - `KnowledgeService.search`
 *   - `KnowledgeService.index`
 *   - `KnowledgeService.delete`
 *   - `KnowledgeDocument`
 *   - `KnowledgeResult`
 *
 * Real method names (`query`, `indexFile`, `getStatus`) and types
 * (`QueryResult`, `ServiceStatus`) are mixed in to verify the validator
 * keeps them while dropping the fabrications.
 */
function hallucinatorSynth(): (req: unknown) => Promise<SynthesisResponse> {
  return async (_req) => ({
    contracts: [],
    sections: {
      "api-contracts": [
        "- `KnowledgeService.search(query: string): Promise<KnowledgeResult[]>`",
        "- `KnowledgeService.index(doc: KnowledgeDocument): Promise<void>`",
        "- `KnowledgeService.delete(id: string): Promise<void>`",
        "- `KnowledgeService.query(question: string): Promise<QueryResult>`",
        "- `KnowledgeService.indexFile(absolutePath: string): Promise<void>`",
        "- `KnowledgeService.getStatus(): ServiceStatus`",
      ].join("\n"),
      "data-models": [
        "- `KnowledgeDocument`: persisted shape with `id`, `content`, metadata",
        "- `KnowledgeResult`: response shape returned by `search`",
        "- `QueryResult`: `answer` and `citations` fields",
        "- `ServiceStatus`: `documentCount`, `watcherAlive`, `uptimeSeconds`",
      ].join("\n"),
      invariants: "(none)",
      "test-surface": '- `"query without indexed documents"`: covered\n- `"indexFile + query end-to-end"`: covered',
    },
    tokens: { inputTokens: 100, outputTokens: 50 },
  });
}

describe("AC-7 — US-05 regression replay", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-us05-replay-"));
    // Mirror the snapshot into the temp project so affectedPaths resolves.
    cpSync(join(FIXTURE_ROOT, "src"), join(tmp, "src"), { recursive: true });
    cpSync(join(FIXTURE_ROOT, "tests"), join(tmp, "tests"), { recursive: true });
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("strips hallucinated bullets and preserves the real surface", async () => {
    const report = loadEvalReport();
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-05",
      evalReport: report,
      affectedPaths: ["src/knowledge/", "tests/knowledge.test.ts"],
      ctx,
      synthesize: hallucinatorSynth(),
    });

    const text = readFileSync(result.specPath, "utf-8");

    // ── Real surface preserved ────────────────────────────────
    expect(text).toContain("KnowledgeService.query");
    expect(text).toContain("KnowledgeService.indexFile");
    expect(text).toContain("KnowledgeService.getStatus");
    expect(text).toContain("QueryResult");
    expect(text).toContain("ServiceStatus");

    // ── Hallucinations gone ───────────────────────────────────
    // These three method names were the heart of the regression. They must
    // not appear inside the api-contracts / data-models bullet identifiers.
    // We assert the bullet lines naming them are gone.
    expect(text).not.toMatch(/`KnowledgeService\.search/);
    expect(text).not.toMatch(/`KnowledgeService\.index\b(?!File)/);
    expect(text).not.toMatch(/`KnowledgeService\.delete/);
    expect(text).not.toMatch(/`KnowledgeDocument`/);
    expect(text).not.toMatch(/`KnowledgeResult`/);

    // ── Warnings recorded ─────────────────────────────────────
    const stripped = result.warnings
      .filter((w): w is Extract<typeof w, { kind: "stripped-unknown-identifier" }> => w.kind === "stripped-unknown-identifier")
      .map((w) => w.identifier)
      .sort();
    expect(stripped).toContain("KnowledgeService.search");
    expect(stripped).toContain("KnowledgeService.index");
    expect(stripped).toContain("KnowledgeService.delete");
    expect(stripped.some((id) => id === "KnowledgeDocument")).toBe(true);
    expect(stripped.some((id) => id === "KnowledgeResult")).toBe(true);
  });
});

// ── AC-9 — US-03 invariant preserved ──────────────────────────────────────

describe("AC-9 — US-03 invariant preservation (dimension-384 substring)", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-us03-invariant-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });

    // Synthesise a minimal source surface for US-03 (embedding/dimension).
    mkdirSync(join(tmp, "src", "embeddings"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "embeddings", "embed.ts"),
      [
        "export const EMBEDDING_DIMENSION = 384;",
        "export class Embedder {",
        "  async embed(text: string): Promise<number[]> { return new Array(EMBEDDING_DIMENSION).fill(0); }",
        "}",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("an LLM bullet stating 'embedding dimension MUST be 384' survives validation", async () => {
    const synthWithInvariant = async (): Promise<SynthesisResponse> => ({
      contracts: [],
      sections: {
        "api-contracts": "- `Embedder.embed`: returns embedding vectors",
        "data-models": "(none)",
        // Prose invariant — no backtick identifiers, so the validator must
        // leave it untouched.
        invariants: "- Embedding dimension MUST be 384 (sentence-transformers/all-MiniLM-L6-v2 default).",
        "test-surface": "(none)",
      },
      tokens: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-03",
      evalReport: {
        storyId: "US-03",
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "embeddings dimension verified" }],
      },
      affectedPaths: ["src/embeddings/"],
      ctx,
      synthesize: synthWithInvariant,
    });

    const text = readFileSync(result.specPath, "utf-8");
    expect(text).toContain("dimension");
    expect(text).toContain("384");
    expect(result.warnings).toHaveLength(0);
  });
});
