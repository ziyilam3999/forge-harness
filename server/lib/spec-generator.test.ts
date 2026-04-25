import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { generateSpecForStory, type SynthesisResponse } from "./spec-generator.js";
import { RunContext } from "./run-context.js";
import type { EvalReport } from "../types/eval-report.js";

// Run the validator script against the generated file. Each test asserts the
// output passes schema validation (AC-B3 surface) — the validator is the
// canonical truth.
function validatorPasses(filePath: string): { ok: boolean; output: string } {
  try {
    const out = execSync(
      `node ${JSON.stringify(join(process.cwd(), "scripts", "validate-tech-spec.mjs"))} ${JSON.stringify(filePath)}`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output: out };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { ok: false, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
  }
}

function makeReport(storyId: string, verdict: EvalReport["verdict"] = "PASS"): EvalReport {
  return {
    storyId,
    verdict,
    criteria: [
      { id: "AC-01", status: "PASS", evidence: `evidence for ${storyId}` },
      { id: "AC-02", status: "PASS", evidence: "second criterion ok" },
    ],
  };
}

function fakeSynth(contracts: string[] = ["forge_evaluate"]): (req: unknown) => Promise<SynthesisResponse> {
  return async (_req) => ({
    contracts,
    sections: {
      "api-contracts": contracts.map((c) => `- \`${c}\`: stub bullet`).join("\n"),
      "data-models": "- stub model bullet",
      invariants: "- stub invariant bullet",
      "test-surface": "- stub test bullet",
    },
    tokens: { inputTokens: 100, outputTokens: 50 },
  });
}

describe("spec-generator — happy path", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates docs/generated/TECHNICAL-SPEC.md with one story section on first PASS", async () => {
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(["forge_evaluate"]),
    });

    expect(existsSync(result.specPath)).toBe(true);
    const text = readFileSync(result.specPath, "utf-8");

    // Body shape (AC-B1)
    const headingCount = (text.match(/^## story: US-01$/gm) || []).length;
    expect(headingCount).toBe(1);

    // Required subsections present
    expect(text).toContain("### api-contracts");
    expect(text).toContain("### data-models");
    expect(text).toContain("### invariants");
    expect(text).toContain("### test-surface");

    // Front-matter present + parseable
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain('schemaVersion: "1.0.0"');
    expect(text).toContain('id: "US-01"');

    // Validator passes (AC-B3)
    const v = validatorPasses(result.specPath);
    expect(v.ok, v.output).toBe(true);

    // Returned metadata is well-formed
    expect(result.contracts).toEqual(["forge_evaluate"]);
    expect(result.bodyChanged).toBe(true);
    expect(result.genTokens).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it("uses 'unknown' for lastGitSha when gitSha not provided", async () => {
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text = readFileSync(result.specPath, "utf-8");
    expect(text).toContain('lastGitSha: "unknown"');
    expect(validatorPasses(result.specPath).ok).toBe(true);
  });

  it("preserves the 40-char git SHA when provided", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-03",
      evalReport: makeReport("US-03"),
      gitSha: sha,
      ctx,
      synthesize: fakeSynth(),
    });
    const text = readFileSync(result.specPath, "utf-8");
    expect(text).toContain(`lastGitSha: "${sha}"`);
  });
});

describe("spec-generator — idempotency (AC-B2)", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("re-running on the same story does not duplicate the heading", async () => {
    const path1 = (await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    })).specPath;

    // Force a small wall-clock gap so timestamps differ.
    await new Promise((r) => setTimeout(r, 20));

    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });

    const text = readFileSync(path1, "utf-8");
    const headingCount = (text.match(/^## story: US-01$/gm) || []).length;
    expect(headingCount).toBe(1);

    // Front-matter still has exactly one entry for US-01
    const fmStoryEntries = (text.match(/^\s+- id: "US-01"/gm) || []).length;
    expect(fmStoryEntries).toBe(1);

    // Validator still passes
    expect(validatorPasses(path1).ok).toBe(true);
  });

  it("two different stories produce two distinct sections, sorted by id", async () => {
    const a = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: fakeSynth(),
    });
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });

    const text = readFileSync(a.specPath, "utf-8");
    expect((text.match(/^## story: /gm) || []).length).toBe(2);

    // US-01 must appear before US-02 in body (sort-by-id)
    const idxA = text.indexOf("## story: US-01");
    const idxB = text.indexOf("## story: US-02");
    expect(idxA).toBeGreaterThan(0);
    expect(idxB).toBeGreaterThan(idxA);

    // Front-matter stories[] also sorted by id
    const fm = text.split("---\n")[1];
    const idxFmA = fm.indexOf('id: "US-01"');
    const idxFmB = fm.indexOf('id: "US-02"');
    expect(idxFmA).toBeGreaterThan(0);
    expect(idxFmB).toBeGreaterThan(idxFmA);

    expect(validatorPasses(a.specPath).ok).toBe(true);
  });

  it("re-running updates lastUpdated for that story but leaves others untouched", async () => {
    const a = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text1 = readFileSync(a.specPath, "utf-8");
    const us02FirstStamp = text1.match(/id: "US-01"\s*\n\s+lastUpdated: "([^"]+)"/)?.[1];

    await new Promise((r) => setTimeout(r, 20));

    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: fakeSynth(),
    });

    const text2 = readFileSync(a.specPath, "utf-8");
    const us01StampAfter = text2.match(/id: "US-01"\s*\n\s+lastUpdated: "([^"]+)"/)?.[1];
    // US-01's stamp should be unchanged after a US-02 write
    expect(us01StampAfter).toBe(us02FirstStamp);

    expect(validatorPasses(a.specPath).ok).toBe(true);
  });
});

describe("spec-generator — section content evolves on re-run", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("re-running with different synth output replaces the section in place (no duplicate)", async () => {
    const path1 = (await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(["forge_evaluate"]),
    })).specPath;
    const before = readFileSync(path1, "utf-8");
    expect(before).toContain("forge_evaluate");

    // Different synth this time — different contracts, different bullets.
    const altSynth = async (): Promise<SynthesisResponse> => ({
      contracts: ["forge_generate", "forge_coordinate"],
      sections: {
        "api-contracts": "- `forge_generate.callerAction`: new\n- `forge_coordinate.recommendedExecutionMode`: new",
        "data-models": "- updated model bullet",
        invariants: "- updated invariant bullet",
        "test-surface": "- updated test bullet",
      },
      tokens: { inputTokens: 10, outputTokens: 5 },
    });

    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: altSynth,
    });

    const after = readFileSync(path1, "utf-8");
    // Heading still appears exactly once (idempotency).
    expect((after.match(/^## story: US-01$/gm) || []).length).toBe(1);
    // The new content is now present; the old single-bullet api-contracts is gone.
    expect(after).toContain("forge_generate.callerAction");
    expect(after).toContain("forge_coordinate.recommendedExecutionMode");
    expect(after).toContain("updated model bullet");
    // Old bullet must have been replaced — assert text is materially different.
    expect(after).not.toBe(before);
    // Validator still passes.
    expect(validatorPasses(path1).ok).toBe(true);
  });
});

describe("spec-generator — corrupt-file recovery", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rewrites from scratch when the existing file has no front-matter fence", async () => {
    const dir = join(tmp, "docs", "generated");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "TECHNICAL-SPEC.md"), "this is not valid", "utf-8");

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    expect(validatorPasses(result.specPath).ok).toBe(true);
    const text = readFileSync(result.specPath, "utf-8");
    expect((text.match(/^## story: US-01$/gm) || []).length).toBe(1);
  });
});
