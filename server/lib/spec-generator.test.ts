import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
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

    // Front-matter present + parseable. After Bundle 1a the file leads with the
    // agent-first header (5 HTML comments + blank + visible date line + blank),
    // so the YAML fence appears AFTER the header rather than at offset 0.
    expect(text).toMatch(/<!-- agent-first:[^\n]*-->\n/);
    expect(text).toContain("\n---\n");
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
    // W5 (#516): `Foo.qux` is now diagnosed as `stripped-unknown-chain` —
    // a more precise kind than the legacy `stripped-unknown-identifier` —
    // because the owner `Foo` IS a known class but the member `qux` is not
    // one of its public methods/fields per the AST harvest.
    expect(result.warnings[0]).toMatchObject({
      kind: "stripped-unknown-chain",
      chain: "Foo.qux",
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
    // W5: `Foo.qux` is a chain miss now (owner known, member unknown).
    const w0 = result.warnings[0];
    if (w0.kind === "stripped-unknown-chain") {
      expect(w0.chain).toBe("Foo.qux");
    } else {
      throw new Error(`expected stripped-unknown-chain warning, got ${w0.kind}`);
    }
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
    // W5 (#516): `Foo.qux` is now an `unknown chain` (owner Foo is known,
    // member qux is not). The legacy `unknown identifier` kind is reserved
    // for cases where the OWNER itself is unknown.
    expect(w.kind).toBe("stripped-unknown-chain");
    if (w.kind === "stripped-unknown-chain") {
      expect(w.chain).toBe("Foo.qux");
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

// ── Bundle 1a: agent-first header (AC-1a-2, AC-1a-3) ─────────────────────
//
// Every regenerated TECHNICAL-SPEC.md MUST lead with the literal 5-line
// HTML-comment block + 1 blank line + 1 visible "Generated by forge-harness
// on YYYY-MM-DD." blockquote line BEFORE the YAML front-matter fence. The
// 5-comment block + blank line are byte-identical across regenerations
// (idempotency); the date line refreshes.

describe("spec-generator — agent-first header (AC-1a-2, AC-1a-3)", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TECHNICAL-SPEC.md first 7 lines match the literal Bundle 1a header contract (AC-1a-2)", async () => {
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });

    const text = readFileSync(result.specPath, "utf-8");
    const lines = text.split("\n");

    expect(lines[0]).toBe(
      "<!-- agent-first: this file is auto-regenerated by forge-harness on every story PASS. -->",
    );
    expect(lines[1]).toBe(
      "<!-- Source of truth: docs/decisions/<US-NN>/*.md (ADRs) and docs/generated/<US-NN>.md (TECHNICAL-SPEC). -->",
    );
    expect(lines[2]).toBe(
      "<!-- Do not hand-edit; edits are overwritten on next regeneration. -->",
    );
    expect(lines[3]).toBe(
      "<!-- Regeneration tool: forge-harness `forge_evaluate` (PASS verdict path). -->",
    );
    expect(lines[4]).toBe(
      "<!-- Design rationale: P60 Build for Consumer, Not Author. -->",
    );
    expect(lines[5]).toBe("");
    expect(lines[6]).toMatch(/^> Generated by forge-harness on \d{4}-\d{2}-\d{2}\.$/);

    // The validator (which runs the schema check used by every spec consumer)
    // still passes after the header was prepended.
    expect(validatorPasses(result.specPath).ok).toBe(true);
  });

  it("comment block + blank line are byte-identical across two regenerations (AC-1a-3)", async () => {
    const r1 = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text1 = readFileSync(r1.specPath, "utf-8");

    // Force a wall-clock gap so the visible date line is allowed to differ
    // (we don't actually need this — the stripDate helper handles either case).
    await new Promise((r) => setTimeout(r, 20));

    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text2 = readFileSync(r1.specPath, "utf-8");

    // Strip the visible "> Generated by ..." date line. Per AC-1a-3 the
    // 5-comment block is byte-stable; remaining diffs (front-matter
    // lastUpdated timestamps) live AFTER the header, so we compare just the
    // first 7 lines minus the date line — that's the slice idempotency
    // applies to.
    const headerOnly = (s: string) =>
      s
        .split("\n")
        .slice(0, 7)
        .filter((l) => !/^> Generated by forge-harness on /.test(l))
        .join("\n");

    expect(headerOnly(text1)).toBe(headerOnly(text2));
  });

  it("header has exactly 5 HTML-comment lines + 1 blank + 1 visible date line (AC-1a-2 line-count)", async () => {
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text = readFileSync(result.specPath, "utf-8");
    const headerLines = text.split("\n").slice(0, 7);

    const commentLines = headerLines.filter((l) => /^<!--[^\n]*-->$/.test(l));
    expect(commentLines.length).toBe(5);
    const blankCount = headerLines.filter((l) => l === "").length;
    expect(blankCount).toBe(1);
    const dateLines = headerLines.filter((l) =>
      /^> Generated by forge-harness on \d{4}-\d{2}-\d{2}\.$/.test(l),
    );
    expect(dateLines.length).toBe(1);
  });
});

// ── I6: shell-only path when synth() throws ─────────────────────────────

describe("spec-generator — I6 shell-only path (LLM unavailable)", () => {
  let tmp: string;
  let ctx: RunContext;

  // Synthesizer stub that always throws — simulates I8's retry exhausted
  // (refresh-token also dead, network out, no Claude Code session).
  const throwingSynth = async (): Promise<SynthesisResponse> => {
    throw new Error("AuthenticationError: 401 Unauthorized after retry");
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-shell-only-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does NOT throw when synth() throws — returns successfully with shell-only warning (AC-2 P64 two-surface)", async () => {
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: throwingSynth,
    });

    // Surface 1 (in-process / consumer-facing): result.warnings carries the
    // typed `spec-gen-shell-only` entry. The plumbing in evaluate.ts copies
    // this array onto `generatedDocs.warnings` AND `specGenWarnings` (P64).
    const shellOnlyWarnings = result.warnings.filter(
      (w) => w.kind === "spec-gen-shell-only",
    );
    expect(shellOnlyWarnings).toHaveLength(1);
    const w = shellOnlyWarnings[0];
    if (w.kind === "spec-gen-shell-only") {
      expect(w.message).toContain("AuthenticationError");
    }

    // v0.42.0 (AC-1) — preserve-on-synth-failure: when there was no
    // pre-existing TECHNICAL-SPEC.md, the file MUST NOT be created. The
    // pre-v0.42.0 path wrote a placeholder-body spec; this was the
    // silent-data-loss bug surfaced 2026-05-11 against monday-bot v0.12.3.
    expect(existsSync(result.specPath)).toBe(false);

    // `spec-gen-failed` is the F4 "generateSpecForStory itself threw" marker;
    // we did NOT throw here, so it must be absent.
    const failedKinds = result.warnings.filter((w) => w.kind === "spec-gen-failed");
    expect(failedKinds).toHaveLength(0);

    // Tokens are zero (no LLM call succeeded).
    expect(result.genTokens).toEqual({ inputTokens: 0, outputTokens: 0 });
    // No contracts inferred (synth never returned).
    expect(result.contracts).toEqual([]);
    // bodyChanged is false — we did not touch the file.
    expect(result.bodyChanged).toBe(false);
  });

  it("idempotency (AC-F): two consecutive shell-only runs leave the file absent (preserve-on-failure)", async () => {
    // v0.42.0 (AC-1) — when synth throws on a fresh tmp dir, the file is
    // NEVER created. Two consecutive throws → file still absent. The
    // pre-v0.42.0 path wrote a placeholder spec on both runs; this test now
    // asserts the preserve-on-failure invariant directly.
    const r1 = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: throwingSynth,
    });
    expect(existsSync(r1.specPath)).toBe(false);

    // Force a wall-clock gap so any per-run timestamp drift would have shown.
    await new Promise((r) => setTimeout(r, 30));

    const r2 = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: throwingSynth,
    });
    expect(existsSync(r2.specPath)).toBe(false);

    // Both runs surfaced the warning (consumer sees the cause every time).
    expect(r1.warnings.some((w) => w.kind === "spec-gen-shell-only")).toBe(true);
    expect(r2.warnings.some((w) => w.kind === "spec-gen-shell-only")).toBe(true);
  });

  it("truncates a long error message to ~200 chars to keep the warning compact", async () => {
    const longErr = "x".repeat(500);
    const longThrowingSynth = async (): Promise<SynthesisResponse> => {
      throw new Error(longErr);
    };
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: longThrowingSynth,
    });
    const w = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(w).toBeDefined();
    if (w && w.kind === "spec-gen-shell-only") {
      // 200 char window + truncation marker
      expect(w.message.length).toBeLessThan(longErr.length);
      expect(w.message).toContain("…(truncated)");
    }
  });
});

// #548 (v0.40.7) — Surface Anthropic's `retry-after` header on 429 in the
// spec-gen-shell-only warning so operators know when it's safe to retry.
//
// The SDK exposes `RateLimitError` (extends APIError<429, Headers>) with a
// `Headers` Web-API instance. Accessor is `.get('retry-after')` —
// bracket-index is a TS error.
describe("spec-generator — #548 retry-after surfaced on 429 RateLimitError", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-548-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // AC-548-1 — RateLimitError with retry-after: N → message contains "retry after Ns".
  it("AC-548-1: includes retry-after seconds when 429 with header", async () => {
    const Anthropic = await import("@anthropic-ai/sdk");
    const headers = new Headers({ "retry-after": "60" });
    const rateLimitErr = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      headers,
    );
    const synthThrowsRateLimit = async (): Promise<SynthesisResponse> => {
      throw rateLimitErr;
    };
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: synthThrowsRateLimit,
      // v0.42.0 — bypass real wall-clock sleep on the retry path so the test
      // doesn't burn 60s on the retry-after header. The retry still fires
      // (synth is invoked twice, the second invocation also throws because
      // the stub is unconditional, falling into the no-overwrite path).
      sleepFn: async () => {},
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(shellOnly).toBeDefined();
    if (shellOnly && shellOnly.kind === "spec-gen-shell-only") {
      expect(shellOnly.message).toContain("retry after 60s");
    }
  });

  // AC-548-2 — non-RateLimitError synth throw produces message WITHOUT retry-after.
  it("AC-548-2: non-RateLimitError throw produces message without retry-after", async () => {
    const synthThrowsGeneric = async (): Promise<SynthesisResponse> => {
      throw new Error("ENOTFOUND api.anthropic.com");
    };
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: synthThrowsGeneric,
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(shellOnly).toBeDefined();
    if (shellOnly && shellOnly.kind === "spec-gen-shell-only") {
      expect(shellOnly.message).not.toContain("retry after");
    }
  });

  // AC-548-2 (no-header coverage) — RateLimitError WITHOUT the header → no suffix.
  it("AC-548-2: RateLimitError without retry-after header produces unsuffixed message", async () => {
    const Anthropic = await import("@anthropic-ai/sdk");
    const headers = new Headers();
    const rateLimitNoHeader = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      headers,
    );
    const synthThrowsNoHeader = async (): Promise<SynthesisResponse> => {
      throw rateLimitNoHeader;
    };
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: synthThrowsNoHeader,
      // v0.42.0 — bypass real wall-clock sleep on the retry-on-429 path.
      sleepFn: async () => {},
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(shellOnly).toBeDefined();
    if (shellOnly && shellOnly.kind === "spec-gen-shell-only") {
      expect(shellOnly.message).not.toContain("retry after");
    }
  });

  // Non-numeric retry-after value (HTTP-date fallback) — preserved verbatim.
  it("AC-548-1 (HTTP-date variant): non-integer retry-after is preserved verbatim", async () => {
    const Anthropic = await import("@anthropic-ai/sdk");
    const httpDate = "Wed, 21 Oct 2026 07:28:00 GMT";
    const headers = new Headers({ "retry-after": httpDate });
    const rateLimitDate = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      headers,
    );
    const synthThrowsDate = async (): Promise<SynthesisResponse> => {
      throw rateLimitDate;
    };
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: synthThrowsDate,
      // v0.42.0 — bypass real wall-clock sleep on the retry-on-429 path.
      sleepFn: async () => {},
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    if (shellOnly && shellOnly.kind === "spec-gen-shell-only") {
      expect(shellOnly.message).toContain(`retry after ${httpDate}`);
    }
  });
});

// #546 (v0.40.7 → v0.41.0) — Narrowing: when synth() failure is HTTP 4xx/5xx
// (other than 401 auth-class), the `spec-gen-creds-keychain-only` warning
// must NOT fire on darwin. The keychain probe is only meaningful for
// auth-class failures; on a 429/500/etc. the credentials are FINE and the
// warning would misdirect the operator.
//
// AC-546-1: behavioral observable — given any synth() throw whose
// stringified err.message begins with HTTP 4xx/5xx (non-401), the warnings
// array contains spec-gen-shell-only AND does NOT contain
// spec-gen-creds-keychain-only.
// AC-546-2: regression-positive — non-HTTP synth() throws still emit the
// keychain-only warning on darwin (preserves the original F6 path).
// AC-546-5: P64 producer/consumer seam — verify the regex
// `^[45][0-9]{2}\b` matches real Anthropic SDK 429 stringification shape
// (`${status} ${msg}` per APIError.makeMessage).
describe("spec-generator — #546 keychain-only narrowing on 4xx/5xx (darwin)", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-546-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // AC-546-1 — 429 rate-limit must suppress keychain-only on darwin.
  it("AC-546-1: 4xx synth error suppresses spec-gen-creds-keychain-only on darwin", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const rateLimit429 = async (): Promise<SynthesisResponse> => {
      throw new Error(
        '429 {"type":"error","error":{"type":"rate_limit_error","message":"Error"},"request_id":"req_011Car5MF8ndJ4KDzMwWvpBn"}',
      );
    };
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: rateLimit429,
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(shellOnly).toBeDefined();
    const keychainOnly = result.warnings.find(
      (w) => w.kind === "spec-gen-creds-keychain-only",
    );
    expect(keychainOnly).toBeUndefined();
  });

  // AC-546-1 (5xx coverage) — 500 server error also suppresses keychain-only.
  it("AC-546-1: 5xx synth error suppresses spec-gen-creds-keychain-only on darwin", async () => {
    if (process.platform !== "darwin") return;
    const serverError = async (): Promise<SynthesisResponse> => {
      throw new Error("500 InternalServerError: upstream failure");
    };
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: serverError,
    });
    const keychainOnly = result.warnings.find(
      (w) => w.kind === "spec-gen-creds-keychain-only",
    );
    expect(keychainOnly).toBeUndefined();
  });

  // AC-546-2 — regression positive — 401 (auth-class) STILL emits keychain-only.
  // F1 (v0.41.1) — execFileSyncFn injection seam lets us deterministically
  // simulate "Keychain entry exists" so we assert keychain-only IS present.
  // Closes the F64 (Intermediate-Only Test Assertion) gap from v0.41.0.
  it("AC-546-2: 401 auth error still emits spec-gen-creds-keychain-only on darwin (F6 path preserved)", async () => {
    if (process.platform !== "darwin") return;
    const auth401 = async (): Promise<SynthesisResponse> => {
      throw new Error("401 AuthenticationError: invalid bearer");
    };
    // Stub execFileSync to simulate "entry exists" (success return).
    const fakeExecFile = (() => Buffer.from("")) as unknown as typeof import("node:child_process").execFileSync;
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: auth401,
      execFileSyncFn: fakeExecFile,
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(shellOnly).toBeDefined();
    // Positive assertion (F1 closure) — gate is OFF for 401, probe ran,
    // stub returned success, so keychain-only IS present.
    const keychainOnly = result.warnings.find(
      (w) => w.kind === "spec-gen-creds-keychain-only",
    );
    expect(keychainOnly).toBeDefined();
  });

  // AC-546-2 — non-HTTP error (network out) STILL emits keychain-only.
  it("AC-546-2: non-HTTP synth error path is unaffected by narrowing", async () => {
    if (process.platform !== "darwin") return;
    const networkOut = async (): Promise<SynthesisResponse> => {
      throw new Error("ENOTFOUND api.anthropic.com — connection refused");
    };
    const fakeExecFile = (() => Buffer.from("")) as unknown as typeof import("node:child_process").execFileSync;
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: networkOut,
      execFileSyncFn: fakeExecFile,
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(shellOnly).toBeDefined();
    // Positive assertion (F1 closure) — gate is OFF for non-HTTP, probe ran,
    // keychain-only IS present.
    const keychainOnly = result.warnings.find(
      (w) => w.kind === "spec-gen-creds-keychain-only",
    );
    expect(keychainOnly).toBeDefined();
  });

  // F1 (v0.41.1) — sibling negative-path: when execFileSyncFn THROWS
  // (entry-absent), keychain-only is correctly NOT emitted even on the
  // non-suppressed (401) path. Confirms gate-off + probe-ran + entry-absent
  // → no warning. P64 producer/consumer seam fully asserted.
  it("AC-546-2 / F1: 401 with entry-absent (stub throws) produces NO keychain-only warning", async () => {
    if (process.platform !== "darwin") return;
    const auth401 = async (): Promise<SynthesisResponse> => {
      throw new Error("401 AuthenticationError: invalid bearer");
    };
    const fakeExecFileThrow = ((): Buffer => {
      throw new Error("entry not found");
    }) as unknown as typeof import("node:child_process").execFileSync;
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: auth401,
      execFileSyncFn: fakeExecFileThrow,
    });
    const shellOnly = result.warnings.find((w) => w.kind === "spec-gen-shell-only");
    expect(shellOnly).toBeDefined();
    const keychainOnly = result.warnings.find(
      (w) => w.kind === "spec-gen-creds-keychain-only",
    );
    expect(keychainOnly).toBeUndefined();
  });

  // F1 (v0.41.1) — confirm gate-ON path: 4xx synth + execFileSyncFn never
  // called (probe doesn't run because the gate suppressed it). Asserts
  // suppression is TRUE pre-emptive, not "probe ran but found nothing."
  it("AC-546-1 / F1: 4xx synth never invokes execFileSyncFn (probe pre-empted)", async () => {
    if (process.platform !== "darwin") return;
    let probeCalled = false;
    const rateLimit429 = async (): Promise<SynthesisResponse> => {
      throw new Error(
        '429 {"type":"error","error":{"type":"rate_limit_error"}}',
      );
    };
    const trackingExecFile = ((): Buffer => {
      probeCalled = true;
      return Buffer.from("");
    }) as unknown as typeof import("node:child_process").execFileSync;
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: rateLimit429,
      execFileSyncFn: trackingExecFile,
    });
    expect(probeCalled).toBe(false);
  });

  // AC-546-5 — P64 producer/consumer seam: verify the regex matches real
  // Anthropic SDK error stringification.
  it("AC-546-5: regex matches real Anthropic SDK 429 stringification (P64 seam)", () => {
    const sdkShape =
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"Error"},"request_id":"req_011Car5MF8ndJ4KDzMwWvpBn"}';
    expect(/^[45][0-9]{2}\b/.test(sdkShape)).toBe(true);

    expect(/^[45][0-9]{2}\b/.test("500 InternalServerError")).toBe(true);

    expect(/^[45][0-9]{2}\b/.test("401 AuthenticationError")).toBe(true);
    expect(/^401\b/.test("401 AuthenticationError")).toBe(true);

    expect(/^[45][0-9]{2}\b/.test("ENOTFOUND api.anthropic.com")).toBe(false);
    expect(/^[45][0-9]{2}\b/.test("AuthenticationError without status prefix")).toBe(false);

    expect(/^[45][0-9]{2}\b/.test("301 Moved Permanently")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// v0.42.0 — Preserve TECHNICAL-SPEC content on synth failure + retry-on-429
//
// Cairn-stone: F-FORGE-SPEC-GEN-OVERWRITES-ON-SYNTH-FAILURE.
// Plan: .ai-workspace/plans/2026-05-11-spec-generator-preserve-on-synth-failure.md
// KB pattern: P34 (Strict Output Contract — Fail Over Silent Corruption).
//
// Tests are grouped by AC. Each group seeds a fixture TECHNICAL-SPEC.md
// containing real hand-authored content with a randomised KEEP-ME-VERBATIM
// sentinel and asserts the post-call sha256 matches the pre-call sha256.
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute sha256 of file bytes; returns null if the file doesn't exist.
 * Mirrors the AC-2 / AC-1 byte-identical contract: existence + content both
 * matter, so null → null is also a valid PASS (no-overwrite means the file
 * MUST NOT be created from thin air on the failure path either).
 */
function sha256OrNull(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Seed a TECHNICAL-SPEC.md fixture under `projectPath/docs/generated/` with
 * real content under `## story: <id>` including a KEEP-ME-VERBATIM sentinel.
 * Returns the absolute path. Mimics the production file shape (header +
 * frontmatter + story body) so parseSpec() accepts it.
 */
function seedFixtureSpec(
  projectPath: string,
  storyId: string,
  sentinel: string,
): string {
  const specPath = join(projectPath, "docs", "generated", "TECHNICAL-SPEC.md");
  mkdirSync(join(projectPath, "docs", "generated"), { recursive: true });
  const body = [
    "<!-- agent-first: this file is auto-regenerated by forge-harness on every story PASS. -->",
    "<!-- Source of truth: docs/decisions/<US-NN>/*.md (ADRs) and docs/generated/<US-NN>.md (TECHNICAL-SPEC). -->",
    "<!-- Do not hand-edit; edits are overwritten on next regeneration. -->",
    "<!-- Regeneration tool: forge-harness `forge_evaluate` (PASS verdict path). -->",
    "<!-- Design rationale: P60 Build for Consumer, Not Author. -->",
    "",
    "> Generated by forge-harness on 2026-05-11.",
    "",
    "---",
    'schemaVersion: "1.0.0"',
    'lastUpdated: "2026-05-11T00:00:00.000Z"',
    "stories:",
    `  - id: "${storyId}"`,
    '    lastUpdated: "2026-05-11T00:00:00.000Z"',
    '    lastGitSha: "unknown"',
    "---",
    "",
    `## story: ${storyId}`,
    "",
    "### api-contracts",
    "",
    `- \`${sentinel}\`: hand-authored sentinel that MUST survive synth failure`,
    "- `forge_evaluate.report.verdict`: returns PASS when ACs satisfied",
    "",
    "### data-models",
    "",
    "- hand-authored data model bullet — preserve me",
    "",
    "### invariants",
    "",
    "- hand-authored invariant — preserve me",
    "",
    "### test-surface",
    "",
    "- hand-authored test surface — preserve me",
    "",
  ].join("\n");
  writeFileSync(specPath, body);
  return specPath;
}

describe("spec-generator — v0.42.0 AC-1 preserve-on-synth-throw", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-v0.42.0-ac1-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("AC-1: synth throw on Anthropic.AuthenticationError preserves existing file bytes (sha256 match)", async () => {
    const Anthropic = await import("@anthropic-ai/sdk");
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-01", sentinel);
    const before = sha256OrNull(specPath);
    expect(before).not.toBeNull();

    const throwingSynth = async (): Promise<SynthesisResponse> => {
      throw new Anthropic.default.AuthenticationError(
        401,
        { type: "error", error: { type: "authentication_error", message: "invalid bearer" } },
        undefined,
        new Headers(),
      );
    };

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: throwingSynth,
      sleepFn: async () => {},
    });

    const after = sha256OrNull(specPath);
    expect(after).toBe(before);
    expect(readFileSync(specPath, "utf-8")).toContain(sentinel);

    // Warnings still surface — loud failure preserved (P34).
    expect(
      result.warnings.some((w) => w.kind === "spec-gen-shell-only"),
    ).toBe(true);
  });

  it("AC-1: synth throw on generic Error preserves existing file bytes (sha256 match)", async () => {
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-02", sentinel);
    const before = sha256OrNull(specPath);

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: async () => {
        throw new Error("500 InternalServerError: upstream down");
      },
      sleepFn: async () => {},
    });

    expect(sha256OrNull(specPath)).toBe(before);
    expect(readFileSync(specPath, "utf-8")).toContain(sentinel);
    expect(result.warnings.some((w) => w.kind === "spec-gen-shell-only")).toBe(true);
  });
});

describe("spec-generator — v0.42.0 AC-1b preserve-on-empty-sections", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-v0.42.0-ac1b-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("AC-1b (a): synth resolves with empty sections object preserves existing content + emits spec-gen-empty-sections", async () => {
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-01", sentinel);
    const before = sha256OrNull(specPath);

    // Stub synth: success but EMPTY sections object. defaultSynthesize's
    // for-loop at lines 386-389 leaves all four section defaults at "(none)".
    // We mimic the post-defaultSynthesize shape since `input.synthesize` is
    // a peer of defaultSynthesize in the contract (sees the same call site).
    const emptySectionsSynth = async (): Promise<SynthesisResponse> => ({
      contracts: [],
      sections: {
        "api-contracts": "(none)",
        "data-models": "(none)",
        invariants: "(none)",
        "test-surface": "(none)",
      },
      tokens: { inputTokens: 50, outputTokens: 0 },
    });

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: emptySectionsSynth,
    });

    expect(sha256OrNull(specPath)).toBe(before);
    expect(readFileSync(specPath, "utf-8")).toContain(sentinel);
    expect(
      result.warnings.some((w) => w.kind === "spec-gen-empty-sections"),
    ).toBe(true);
    // shell-only is the THROW signal; this path is SUCCESS-but-empty, so
    // shell-only must NOT be set.
    expect(
      result.warnings.some((w) => w.kind === "spec-gen-shell-only"),
    ).toBe(false);
  });

  it("AC-1b (b): synth resolves with all-(none) sections preserves existing content (same as empty path)", async () => {
    // Same logical behavior as (a) — the production defaultSynthesize
    // defaults each missing section to "(none)" so { sections: {} } and
    // explicit all-(none) collapse to the same caller-observable shape.
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-02", sentinel);
    const before = sha256OrNull(specPath);

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: async () => ({
        contracts: [],
        sections: {
          "api-contracts": "(none)",
          "data-models": "(none)",
          invariants: "(none)",
          "test-surface": "(none)",
        },
        tokens: { inputTokens: 50, outputTokens: 0 },
      }),
    });

    expect(sha256OrNull(specPath)).toBe(before);
    expect(readFileSync(specPath, "utf-8")).toContain(sentinel);
    expect(result.warnings.some((w) => w.kind === "spec-gen-empty-sections")).toBe(true);
  });

  it("AC-1b (c): legit case — three real sections + one (none) DOES overwrite (canonical behavior preserved)", async () => {
    // This is the regression-protection assertion: a story legitimately
    // having `(none)` in ONE section but real content in the others MUST
    // still flow through the normal write path. The fix narrows the
    // empty-sections gate to the all-four-(none) case.
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-03", sentinel);
    const before = sha256OrNull(specPath);

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-03",
      evalReport: makeReport("US-03"),
      ctx,
      synthesize: async () => ({
        contracts: ["forge_evaluate"],
        sections: {
          "api-contracts": "- `forge_evaluate.report`: PASS verdict structure",
          "data-models": "- `EvalReport`: shape returned by handleEvaluate",
          invariants: "(none)",
          "test-surface": "- `evaluate.test.ts`: covers PASS verdict",
        },
        tokens: { inputTokens: 100, outputTokens: 80 },
      }),
    });

    // File content changed: the sentinel from the pre-call body is gone,
    // replaced by the new section. The legit path is NOT preserve-on-failure.
    expect(sha256OrNull(specPath)).not.toBe(before);
    expect(readFileSync(specPath, "utf-8")).not.toContain(sentinel);
    expect(result.warnings.some((w) => w.kind === "spec-gen-empty-sections")).toBe(false);
    expect(result.warnings.some((w) => w.kind === "spec-gen-shell-only")).toBe(false);
  });
});

describe("spec-generator — v0.42.0 AC-3 retry-on-429", () => {
  let tmp: string;
  let ctx: RunContext;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-v0.42.0-ac3-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
    savedEnv = process.env.FORGE_SPEC_RETRY_ON_429;
    delete process.env.FORGE_SPEC_RETRY_ON_429;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.FORGE_SPEC_RETRY_ON_429;
    else process.env.FORGE_SPEC_RETRY_ON_429 = savedEnv;
  });

  it("AC-3: RateLimitError on first call + success on retry → exactly 2 synth invocations + outputTokens > 0", async () => {
    const Anthropic = await import("@anthropic-ai/sdk");
    const rateLimit = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      new Headers({ "retry-after": "1" }),
    );
    let invocations = 0;
    const flakeySynth = async (): Promise<SynthesisResponse> => {
      invocations++;
      if (invocations === 1) throw rateLimit;
      return {
        contracts: ["forge_evaluate"],
        sections: {
          "api-contracts": "- `forge_evaluate.report`: ok",
          "data-models": "- `EvalReport`: ok",
          invariants: "- ok",
          "test-surface": "- ok",
        },
        tokens: { inputTokens: 100, outputTokens: 50 },
      };
    };

    const sleepCalls: number[] = [];
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: flakeySynth,
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    expect(invocations).toBe(2);
    expect(result.genTokens.outputTokens).toBeGreaterThan(0);
    // Retry-after: 1 second → sleep called with 1000ms (well under the
    // default 60s cap, so the requested value passes through unclamped).
    expect(sleepCalls).toEqual([1000]);
  });
});

describe("spec-generator — v0.42.0 AC-3b retry-exhaustion → no-overwrite", () => {
  let tmp: string;
  let ctx: RunContext;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-v0.42.0-ac3b-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
    savedEnv = process.env.FORGE_SPEC_RETRY_ON_429;
    delete process.env.FORGE_SPEC_RETRY_ON_429;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.FORGE_SPEC_RETRY_ON_429;
    else process.env.FORGE_SPEC_RETRY_ON_429 = savedEnv;
  });

  it("AC-3b: RateLimitError on BOTH attempts → file bytes preserved + shell-only warning + outputTokens === 0", async () => {
    const Anthropic = await import("@anthropic-ai/sdk");
    const rateLimit = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      new Headers({ "retry-after": "1" }),
    );
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-01", sentinel);
    const before = sha256OrNull(specPath);

    let invocations = 0;
    const persistentlyThrottled = async (): Promise<SynthesisResponse> => {
      invocations++;
      throw rateLimit;
    };

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: persistentlyThrottled,
      sleepFn: async () => {},
    });

    expect(invocations).toBe(2); // first call + one retry
    expect(sha256OrNull(specPath)).toBe(before);
    expect(readFileSync(specPath, "utf-8")).toContain(sentinel);
    expect(result.warnings.some((w) => w.kind === "spec-gen-shell-only")).toBe(true);
    expect(result.genTokens.outputTokens).toBe(0);
  });
});

describe("spec-generator — v0.42.0 AC-4 FORGE_SPEC_RETRY_ON_429 three modes", () => {
  let tmp: string;
  let ctx: RunContext;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-v0.42.0-ac4-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
    savedEnv = process.env.FORGE_SPEC_RETRY_ON_429;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.FORGE_SPEC_RETRY_ON_429;
    else process.env.FORGE_SPEC_RETRY_ON_429 = savedEnv;
  });

  it("AC-4 (a): unset env → retry enabled at default 60s cap → flaky synth succeeds on second call", async () => {
    delete process.env.FORGE_SPEC_RETRY_ON_429;
    const Anthropic = await import("@anthropic-ai/sdk");
    const rateLimit = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      new Headers({ "retry-after": "1" }),
    );
    let invocations = 0;
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: async () => {
        invocations++;
        if (invocations === 1) throw rateLimit;
        return {
          contracts: [],
          sections: {
            "api-contracts": "- `forge_evaluate.report`: ok",
            "data-models": "- ok",
            invariants: "- ok",
            "test-surface": "- ok",
          },
          tokens: { inputTokens: 100, outputTokens: 50 },
        };
      },
      sleepFn: async () => {},
    });
    expect(invocations).toBe(2);
    expect(result.genTokens.outputTokens).toBe(50);
  });

  it("AC-4 (b): FORGE_SPEC_RETRY_ON_429=0 → retry disabled → first throw goes to no-overwrite", async () => {
    process.env.FORGE_SPEC_RETRY_ON_429 = "0";
    const Anthropic = await import("@anthropic-ai/sdk");
    const rateLimit = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      new Headers({ "retry-after": "1" }),
    );
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-01", sentinel);
    const before = sha256OrNull(specPath);

    let invocations = 0;
    const sleepCalls: number[] = [];
    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: async () => {
        invocations++;
        throw rateLimit;
      },
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    expect(invocations).toBe(1); // NO retry attempt
    expect(sleepCalls).toEqual([]); // sleep never invoked
    expect(sha256OrNull(specPath)).toBe(before);
    expect(result.warnings.some((w) => w.kind === "spec-gen-shell-only")).toBe(true);
  });

  it("AC-4 (c): FORGE_SPEC_RETRY_ON_429=30 → retry-after value from header clamped to 30s", async () => {
    process.env.FORGE_SPEC_RETRY_ON_429 = "30";
    const Anthropic = await import("@anthropic-ai/sdk");
    // header says "retry after 120s" but cap is 30 → sleep called with 30000ms
    const rateLimit = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      new Headers({ "retry-after": "120" }),
    );
    let invocations = 0;
    const sleepCalls: number[] = [];
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: async () => {
        invocations++;
        if (invocations === 1) throw rateLimit;
        return {
          contracts: [],
          sections: {
            "api-contracts": "- ok",
            "data-models": "- ok",
            invariants: "- ok",
            "test-surface": "- ok",
          },
          tokens: { inputTokens: 1, outputTokens: 1 },
        };
      },
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    expect(sleepCalls).toEqual([30 * 1000]); // clamped to env cap, not 120s
    expect(invocations).toBe(2);
  });
});

describe("spec-generator — v0.42.0 AC-5 default-60 cap clamps retry-after: 120 to 60s", () => {
  let tmp: string;
  let ctx: RunContext;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-v0.42.0-ac5-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
    savedEnv = process.env.FORGE_SPEC_RETRY_ON_429;
    delete process.env.FORGE_SPEC_RETRY_ON_429;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.FORGE_SPEC_RETRY_ON_429;
    else process.env.FORGE_SPEC_RETRY_ON_429 = savedEnv;
  });

  it("AC-5: env unset + retry-after: 120 → sleep called with 60s (default cap)", async () => {
    const Anthropic = await import("@anthropic-ai/sdk");
    const rateLimit = new Anthropic.default.RateLimitError(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Error" } },
      undefined,
      new Headers({ "retry-after": "120" }),
    );
    let invocations = 0;
    const sleepCalls: number[] = [];
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: async () => {
        invocations++;
        if (invocations === 1) throw rateLimit;
        return {
          contracts: [],
          sections: {
            "api-contracts": "- ok",
            "data-models": "- ok",
            invariants: "- ok",
            "test-surface": "- ok",
          },
          tokens: { inputTokens: 1, outputTokens: 1 },
        };
      },
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    });
    // Default cap 60s clamps the 120s request.
    expect(sleepCalls).toEqual([60 * 1000]);
  });
});

describe("spec-generator — v0.42.0 AC-2 / AC-11 MCP-level dual-surface warning", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-spec-gen-v0.42.0-ac2-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("AC-2 / AC-11: end-to-end synth throw → file bytes preserved AND result.warnings carries spec-gen-shell-only (dual surface)", async () => {
    // AC-2 part 1: the file's KEEP-ME-VERBATIM sentinel survives.
    // AC-11 part 1: result.warnings (which evaluate.ts copies onto BOTH
    // `generatedDocs.warnings` on disk AND `specGenWarnings` on the MCP
    // response — see server/tools/evaluate.ts lines 432-510 — must contain
    // `spec-gen-shell-only`. This test asserts the spec-generator side of
    // that contract; the evaluate.ts plumbing is already exercised by
    // evaluate-grounding.test.ts AC-6.
    const sentinel = `KEEP-ME-VERBATIM-${Math.random().toString(36).slice(2, 10)}`;
    const specPath = seedFixtureSpec(tmp, "US-99", sentinel);
    const before = sha256OrNull(specPath);

    const result = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-99",
      evalReport: makeReport("US-99"),
      ctx,
      synthesize: async () => {
        throw new Error("synthetic spec-gen throw for AC-2 / AC-11");
      },
      sleepFn: async () => {},
    });

    // AC-2 (file bytes preserved).
    expect(sha256OrNull(specPath)).toBe(before);
    expect(readFileSync(specPath, "utf-8")).toContain(sentinel);

    // AC-11 (warnings carry the spec-gen-shell-only entry — this is the
    // SAME array that evaluate.ts stamps onto generatedDocs.warnings and
    // specGenWarnings via the P64 producer/consumer seam at evaluate.ts:438).
    expect(result.warnings.some((w) => w.kind === "spec-gen-shell-only")).toBe(true);
  });
});
