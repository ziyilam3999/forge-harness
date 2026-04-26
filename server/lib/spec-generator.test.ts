import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  generateSpecForStory,
  buildUserPrompt,
  validateAgainstVocabulary,
  type SynthesisResponse,
  type SynthesisRequest,
} from "./spec-generator.js";
import { RunContext } from "./run-context.js";
import { buildSourceVocabulary, renderVocabularyForPrompt } from "./spec-source-vocabulary.js";
import type { EvalReport } from "../types/eval-report.js";

const FIXTURE_REL = "server/lib/__fixtures__/spec-vocabulary";
const PROJECT_ROOT = resolve(__dirname, "..", "..");

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

// ── AC-3 / AC-4 / AC-8: prompt grounding (content + cap + fallback) ──────

describe("buildUserPrompt — AC-3 grounding content", () => {
  it("includes the 'Real symbols available' section verbatim", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    const vocabularyPrompt = renderVocabularyForPrompt(vocab);
    const req: SynthesisRequest = {
      storyId: "US-XX",
      evalReport: {
        storyId: "US-XX",
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "fixture" }],
      },
      diffSummary: "(unavailable)",
      vocabularyPrompt,
    };
    const out = buildUserPrompt(req);
    expect(out).toContain("## Real symbols available");
    expect(out).toContain("Foo");
    expect(out).toContain("bar");
    expect(out).toContain("Baz");
    expect(out).toContain("id");
  });
});

describe("buildUserPrompt — AC-4 token cap (≤2000 bytes for vocabulary section)", () => {
  it("renders the vocabulary block within the 2000-byte cap", () => {
    const big = {
      identifiers: new Set<string>(),
      methods: new Set<string>(),
      fields: new Set<string>(),
      testNames: new Set<string>(),
      filesScanned: [],
      warnings: [],
    };
    for (let i = 0; i < 500; i++) {
      big.identifiers.add(`SymbolWithAReasonablyLongName_${i}`);
    }
    const block = renderVocabularyForPrompt(big, 2000);
    expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(2000);
    expect(block).toMatch(/…\(\d+ more\)/);
  });
});

describe("buildUserPrompt — AC-8 no-vocabulary fallback", () => {
  it("emits 'No source vocabulary available' when affectedPaths is empty", () => {
    const empty = buildSourceVocabulary(PROJECT_ROOT, []);
    const vocabularyPrompt = renderVocabularyForPrompt(empty);
    const req: SynthesisRequest = {
      storyId: "US-DOC-ONLY",
      evalReport: {
        storyId: "US-DOC-ONLY",
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "docs only" }],
      },
      diffSummary: "(unavailable)",
      vocabularyPrompt,
    };
    const out = buildUserPrompt(req);
    expect(out).toContain("No source vocabulary available");
    expect(out).toMatch(/emit `\(none\)`/);
  });
});

// ── AC-5 / AC-6 / AC-11: post-validator strip + false-positive + mode flag ──

describe("validateAgainstVocabulary — AC-5 strip path", () => {
  it("strips a bullet naming an unknown identifier and records a warning", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    const sections: Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string> = {
      "api-contracts": "- `Foo.bar`: known method\n- `Foo.qux`: hallucinated method",
      "data-models": "- `Baz.id`: known field",
      invariants: "(none)",
      "test-surface": "(none)",
    };
    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: 1 });
    expect(result.sections["api-contracts"]).toContain("Foo.bar");
    expect(result.sections["api-contracts"]).not.toContain("Foo.qux");
    expect(result.sections["data-models"]).toContain("Baz.id");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      kind: "stripped-unknown-identifier",
      identifier: "Foo.qux",
      section: "api-contracts",
    });
  });

  it("replaces the section with '(none)' when every bullet is stripped", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    const sections: Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string> = {
      "api-contracts": "- `KnowledgeService.search`: invented\n- `KnowledgeService.delete`: invented",
      "data-models": "(none)",
      invariants: "(none)",
      "test-surface": "(none)",
    };
    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: 1 });
    expect(result.sections["api-contracts"]).toBe("(none)");
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateAgainstVocabulary — AC-6 false-positive prevention", () => {
  it("does NOT strip bullets naming default-export, generic, enum, or re-exported symbols", () => {
    // Build vocabulary across the full edge-case fixture set
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [FIXTURE_REL]);
    const sections: Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string> = {
      "api-contracts": [
        "- `DefaultClass.hello`: default-export class method",
        "- `genericFunc`: generic function",
        "- `GenericBox.unwrap`: generic class method",
        "- `Color.RED`: enum member",
        "- `MjsClass.greet`: .mjs file class method",
        "- `renamedFunc`: re-exported alias",
      ].join("\n"),
      "data-models": "- `Settings.host`: type alias field\n- `Color.GREEN`: enum member",
      invariants: "(none)",
      "test-surface": '- `"sample feature"`: harvested test name',
    };
    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: vocab.filesScanned.length });
    expect(result.warnings).toHaveLength(0);
    // Every original bullet must survive
    expect(result.sections["api-contracts"]).toContain("DefaultClass.hello");
    expect(result.sections["api-contracts"]).toContain("genericFunc");
    expect(result.sections["api-contracts"]).toContain("GenericBox.unwrap");
    expect(result.sections["api-contracts"]).toContain("Color.RED");
    expect(result.sections["api-contracts"]).toContain("MjsClass.greet");
    expect(result.sections["api-contracts"]).toContain("renamedFunc");
    expect(result.sections["data-models"]).toContain("Settings.host");
    expect(result.sections["data-models"]).toContain("Color.GREEN");
  });
});

describe("validateAgainstVocabulary — AC-11 mode flag", () => {
  const ORIGINAL = process.env.FORGE_SPEC_VALIDATOR_MODE;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FORGE_SPEC_VALIDATOR_MODE;
    else process.env.FORGE_SPEC_VALIDATOR_MODE = ORIGINAL;
  });

  it("FORGE_SPEC_VALIDATOR_MODE=warn → does not strip, but still records warnings", () => {
    process.env.FORGE_SPEC_VALIDATOR_MODE = "warn";
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    const sections: Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string> = {
      "api-contracts": "- `Foo.bar`: known\n- `Foo.qux`: hallucinated",
      "data-models": "(none)",
      invariants: "(none)",
      "test-surface": "(none)",
    };
    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: 1 });
    // Bullet retained
    expect(result.sections["api-contracts"]).toContain("Foo.qux");
    expect(result.sections["api-contracts"]).toContain("Foo.bar");
    // Warning still recorded
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].identifier).toBe("Foo.qux");
  });

  it("default (mode unset) strips the bullet", () => {
    delete process.env.FORGE_SPEC_VALIDATOR_MODE;
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    const sections: Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string> = {
      "api-contracts": "- `Foo.bar`: known\n- `Foo.qux`: hallucinated",
      "data-models": "(none)",
      invariants: "(none)",
      "test-surface": "(none)",
    };
    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: 1 });
    expect(result.sections["api-contracts"]).not.toContain("Foo.qux");
    expect(result.sections["api-contracts"]).toContain("Foo.bar");
    expect(result.warnings).toHaveLength(1);
  });
});

// ── AC-3 end-to-end via generateSpecForStory ──────────────────────────────

describe("generateSpecForStory — affectedPaths integration", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-grounding-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("captures the synthesizer's request — vocabularyPrompt contains real symbol names from affectedPaths", async () => {
    // Mirror a fixture file into the temp project
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "module.ts"),
      "export class Foo {\n  bar(x: string): string { return x; }\n}\nexport interface Baz { id: string }\n",
      "utf-8",
    );

    let captured: SynthesisRequest | null = null;
    const synthSpy = async (req: SynthesisRequest): Promise<SynthesisResponse> => {
      captured = req;
      return {
        contracts: [],
        sections: {
          "api-contracts": "- `Foo.bar`: real method",
          "data-models": "- `Baz.id`: real field",
          invariants: "(none)",
          "test-surface": "(none)",
        },
        tokens: { inputTokens: 1, outputTokens: 1 },
      };
    };

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-X",
      evalReport: {
        storyId: "US-X",
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "ok" }],
      },
      affectedPaths: ["src/module.ts"],
      ctx,
      synthesize: synthSpy,
    });

    expect(captured).not.toBeNull();
    expect(captured!.vocabularyPrompt).toContain("Foo");
    expect(captured!.vocabularyPrompt).toContain("bar");
    expect(captured!.vocabularyPrompt).toContain("Baz");
    expect(captured!.vocabularyPrompt).toContain("id");
    // Validator did not strip these because they're in vocab
    expect(result.warnings).toHaveLength(0);
  });

  it("strips invented identifiers via validator end-to-end", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "module.ts"),
      "export class Foo {\n  bar(): void {}\n}\n",
      "utf-8",
    );

    const synthHallucinator = async (): Promise<SynthesisResponse> => ({
      contracts: [],
      sections: {
        "api-contracts": "- `Foo.bar`: real\n- `Foo.qux`: invented",
        "data-models": "(none)",
        invariants: "(none)",
        "test-surface": "(none)",
      },
      tokens: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-Y",
      evalReport: {
        storyId: "US-Y",
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "ok" }],
      },
      affectedPaths: ["src/module.ts"],
      ctx,
      synthesize: synthHallucinator,
    });

    expect(result.warnings).toHaveLength(1);
    const w = result.warnings[0];
    expect(w.kind).toBe("stripped-unknown-identifier");
    if (w.kind === "stripped-unknown-identifier") {
      expect(w.identifier).toBe("Foo.qux");
    }

    const text = readFileSync(result.specPath, "utf-8");
    expect(text).toContain("Foo.bar");
    expect(text).not.toContain("Foo.qux");
  });

  it("AC-8: emits exactly one 'no-vocabulary' warning when affectedPaths is empty", async () => {
    const synthSpy = async (): Promise<SynthesisResponse> => ({
      contracts: [],
      sections: {
        "api-contracts": "- `SomeNew.thing`: would normally be stripped",
        "data-models": "- `Another.field`: also normally stripped",
        invariants: "(none)",
        "test-surface": "(none)",
      },
      tokens: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-EMPTY",
      evalReport: {
        storyId: "US-EMPTY",
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "ok" }],
      },
      affectedPaths: [],
      ctx,
      synthesize: synthSpy,
    });

    // Exactly one warning, of kind "no-vocabulary"
    expect(result.warnings).toHaveLength(1);
    const w = result.warnings[0];
    expect(w.kind).toBe("no-vocabulary");
    if (w.kind === "no-vocabulary") {
      expect(w.filesScanned).toBe(0);
    }

    // Spec wrote verbatim — no strips happened (lenient mode)
    const text = readFileSync(result.specPath, "utf-8");
    expect(text).toContain("SomeNew.thing");
    expect(text).toContain("Another.field");
  });
});
