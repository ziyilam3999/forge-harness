/**
 * spec-generator-monday-w3-w4-w5.test.ts — bundle-A regression tests for
 * monday-bot v0.10.0 audit items W3 / W4 / W5.
 *
 * Each describe block maps to one issue:
 *   - W3 / #514 — idempotent write: re-running on unchanged inputs leaves
 *     `INDEX.md` and `TECHNICAL-SPEC.md` byte-identical.
 *   - W4 / #515 — cross-section non-mutation: rendering a story section
 *     does NOT perturb the bytes of OTHER, unrelated story sections.
 *   - W5 / #516 — call-chain grounding: dotted identifiers like `Foo.bar()`
 *     where the owner is known but the member doesn't exist are flagged as
 *     `stripped-unknown-chain` (a distinct diagnostic) rather than
 *     pass-through.
 *
 * On master `f3ebb6c` (pre-bundle-A), every test in this file fails — see
 * `tests/fixtures/idempotent-eval/baseline-master-diff.txt` for captured
 * failures from the W3 fixture probe specifically. The fixes ship in this
 * same PR; the tests turn green on the branch.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateSpecForStory, validateAgainstVocabulary, type SynthesisResponse } from "./spec-generator.js";
import { processStory } from "./adr-extractor.js";
import { RunContext } from "./run-context.js";
import { buildSourceVocabulary, chainResolves } from "./spec-source-vocabulary.js";
import type { EvalReport } from "../types/eval-report.js";
import { idempotentWrite, __test as idemTest } from "./idempotent-write.js";

function makeReport(storyId: string, verdict: EvalReport["verdict"] = "PASS"): EvalReport {
  return {
    storyId,
    verdict,
    criteria: [
      { id: "AC-01", status: "PASS", evidence: `evidence for ${storyId}` },
    ],
  };
}

function fakeSynth(): (req: unknown) => Promise<SynthesisResponse> {
  return async () => ({
    contracts: ["forge_evaluate"],
    sections: {
      "api-contracts": "- `forge_evaluate.generatedDocs`: bullet",
      "data-models": "- some data shape",
      invariants: "- one invariant",
      "test-surface": "- test ratchet",
    },
    tokens: { inputTokens: 10, outputTokens: 5 },
  });
}

// ──────────────────────────────────────────────────────────────────────────
// W3 / #514 — auto-write dated banner churn
// ──────────────────────────────────────────────────────────────────────────

describe("W3 (#514) idempotent-write — TECHNICAL-SPEC.md", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-w3-spec-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("AC-1: TECHNICAL-SPEC.md is byte-identical across two consecutive PASSes on the same story", async () => {
    // First run: writes the file.
    const r1 = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text1 = readFileSync(r1.specPath, "utf-8");

    // Force a wall-clock gap so any volatile timestamp would actually drift
    // if the writer didn't suppress the write.
    await new Promise((res) => setTimeout(res, 30));

    // Second run on the same story with the same inputs → idempotent.
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text2 = readFileSync(r1.specPath, "utf-8");

    // Byte-for-byte identical, including the visible date line and every
    // `lastUpdated:` ISO timestamp. On master this fails because the second
    // run unconditionally overwrites with a fresh `now`.
    expect(text2).toBe(text1);
  });

  it("AC-6: a third successive PASS still produces byte-identical content", async () => {
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const path = join(tmp, "docs", "generated", "TECHNICAL-SPEC.md");
    const stamp1 = readFileSync(path, "utf-8");
    await new Promise((res) => setTimeout(res, 20));
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const stamp2 = readFileSync(path, "utf-8");
    await new Promise((res) => setTimeout(res, 20));
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const stamp3 = readFileSync(path, "utf-8");
    expect(stamp2).toBe(stamp1);
    expect(stamp3).toBe(stamp1);
  });

  it("AC-3: a NEW story whose inputs DO change writes to disk and refreshes timestamps", async () => {
    const r1 = await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const before = readFileSync(r1.specPath, "utf-8");
    expect(before).toContain("## story: US-01");
    expect(before).not.toContain("## story: US-02");

    // Different story, different content → write proceeds.
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: fakeSynth(),
    });
    const after = readFileSync(r1.specPath, "utf-8");
    expect(after).toContain("## story: US-01");
    expect(after).toContain("## story: US-02");
  });

  it("AC-4: agent-first comment block remains exactly one occurrence after re-runs", async () => {
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
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
    const text = readFileSync(join(tmp, "docs", "generated", "TECHNICAL-SPEC.md"), "utf-8");
    const matches = text.match(/<!-- agent-first:/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("W3 (#514) idempotent-write — INDEX.md", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-w3-index-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeStub(storyId: string, filename: string, fmKv: Record<string, string>) {
    const stagingDir = join(tmp, ".forge", "staging", "adr", storyId);
    mkdirSync(stagingDir, { recursive: true });
    const fmLines = Object.entries(fmKv).map(([k, v]) => `${k}: "${v.replace(/"/g, '\\"')}"`);
    writeFileSync(join(stagingDir, filename), `---\n${fmLines.join("\n")}\n---\n`, "utf-8");
  }

  it("AC-1 (INDEX): re-running with no new ADRs produces byte-identical INDEX.md across runs", () => {
    // First run: stages an ADR, processes, writes INDEX.md.
    writeStub("US-01", "use-sqlite.md", {
      title: "Use SQLite for local cache",
      story: "US-01",
      context: "ctx",
      decision: "dec",
      consequences: "cons",
      alternatives: "alts",
    });
    const r1 = processStory({
      projectPath: tmp,
      storyId: "US-01",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      today: "2026-04-30",
    });
    const text1 = readFileSync(r1.indexPath, "utf-8");

    // Second run on the same story with no new staged stubs → no body change.
    // On master, INDEX.md is unconditionally rewritten on every call (date
    // line refreshes); under W3 idempotent-write, the second call is a no-op
    // and the file's bytes (including the date line) stay identical.
    processStory({
      projectPath: tmp,
      storyId: "US-01",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      today: "2026-04-30",
    });
    const text2 = readFileSync(r1.indexPath, "utf-8");
    expect(text2).toBe(text1);
  });
});

describe("W3 (#514) idempotent-write — helper unit tests", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-w3-helper-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns false (no-op) when only the volatile date line differs", () => {
    const path = join(tmp, "doc.md");
    const c1 =
      "<!-- header -->\n> Generated by forge-harness on 2026-04-29.\n\nbody";
    writeFileSync(path, c1, "utf-8");
    const c2 =
      "<!-- header -->\n> Generated by forge-harness on 2026-04-30.\n\nbody";
    const wrote = idempotentWrite(path, c2);
    expect(wrote).toBe(false);
    // File still has the original content (yesterday's date) on disk.
    expect(readFileSync(path, "utf-8")).toBe(c1);
  });

  it("returns true (writes) when the body differs", () => {
    const path = join(tmp, "doc.md");
    writeFileSync(path, "alpha", "utf-8");
    const wrote = idempotentWrite(path, "beta");
    expect(wrote).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("beta");
  });

  it("returns true (writes) when the file does not exist yet", () => {
    const path = join(tmp, "doc.md");
    const wrote = idempotentWrite(path, "first content");
    expect(wrote).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("first content");
  });

  it("normalizes both `lastUpdated:` timestamps and the visible date line", () => {
    const a =
      'lastUpdated: "2026-04-29T10:00:00.000Z"\n> Generated by forge-harness on 2026-04-29.\nbody';
    const b =
      'lastUpdated: "2026-04-30T11:30:42.123Z"\n> Generated by forge-harness on 2026-04-30.\nbody';
    expect(idemTest.stripVolatile(a)).toBe(idemTest.stripVolatile(b));
  });
});

// ──────────────────────────────────────────────────────────────────────────
// W4 / #515 — cross-section non-mutation invariant
// ──────────────────────────────────────────────────────────────────────────

describe("W4 (#515) cross-section non-mutation", () => {
  let tmp: string;
  let ctx: RunContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-w4-"));
    ctx = new RunContext({ toolName: "forge_evaluate", projectPath: tmp, stages: ["spec-gen"] });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Extract the lines of `body` between `## story: ${id}` and the next
   * `## story:` heading (or end-of-body). The slice is what monday-bot's
   * consumer repos see on the section level.
   */
  function sectionSlice(body: string, id: string): string[] {
    const lines = body.split("\n");
    const startIdx = lines.findIndex((l) => l === `## story: ${id}`);
    if (startIdx < 0) return [];
    const tail = lines.slice(startIdx + 1);
    const nextHeadingOffset = tail.findIndex((l) => /^## story: /.test(l));
    const endIdx = nextHeadingOffset < 0 ? lines.length : startIdx + 1 + nextHeadingOffset;
    return lines.slice(startIdx, endIdx);
  }

  it("AC-1: rendering a US-10 section leaves US-01 and US-02 byte-identical", async () => {
    // First two stories: write US-01 and US-02. After this, the file has
    // exactly two sections in canonical, fix-applied form.
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: fakeSynth(),
    });
    const path = join(tmp, "docs", "generated", "TECHNICAL-SPEC.md");
    const before = readFileSync(path, "utf-8");
    const us01Before = sectionSlice(before, "US-01");
    const us02Before = sectionSlice(before, "US-02");
    expect(us01Before.length).toBeGreaterThan(0);
    expect(us02Before.length).toBeGreaterThan(0);

    // Now add a US-10 section. After my fix, US-01 and US-02 bytes are
    // identical to before the merge. On master (without the fix), the
    // boundary blank lines drift and the slices change.
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-10",
      evalReport: makeReport("US-10"),
      ctx,
      synthesize: fakeSynth(),
    });
    const after = readFileSync(path, "utf-8");
    const us01After = sectionSlice(after, "US-01");
    const us02After = sectionSlice(after, "US-02");

    expect(us01After).toEqual(us01Before);
    expect(us02After).toEqual(us02Before);
    // Sanity: US-10 was actually added.
    expect(after).toContain("## story: US-10");
  });

  it("AC-2: TECHNICAL-SPEC.md never contains a triple-blank-line gap (\\n\\n\\n)", async () => {
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: fakeSynth(),
    });
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-10",
      evalReport: makeReport("US-10"),
      ctx,
      synthesize: fakeSynth(),
    });
    const text = readFileSync(join(tmp, "docs", "generated", "TECHNICAL-SPEC.md"), "utf-8");
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("AC-3: re-rendering an existing US-X section is fully idempotent at the bytes layer (composed with W3)", async () => {
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-02",
      evalReport: makeReport("US-02"),
      ctx,
      synthesize: fakeSynth(),
    });
    const path = join(tmp, "docs", "generated", "TECHNICAL-SPEC.md");
    const before = readFileSync(path, "utf-8");

    // Re-run US-01 with the same synth → identical content → no write.
    await generateSpecForStory({
      projectPath: tmp,
      storyId: "US-01",
      evalReport: makeReport("US-01"),
      ctx,
      synthesize: fakeSynth(),
    });
    const after = readFileSync(path, "utf-8");
    expect(after).toBe(before);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// W5 / #516 — identifier validator call-chain grounding
// ──────────────────────────────────────────────────────────────────────────

describe("W5 (#516) call-chain grounding — chainResolves helper", () => {
  it("returns false when the owner is a known class but the named member is NOT one of its methods/fields", () => {
    // Build a vocabulary from a hand-rolled fixture — Foo exports bar but
    // does NOT export baz. `Foo.baz` is the canonical mis-attribution shape.
    const tmp = mkdtempSync(join(tmpdir(), "forge-w5-"));
    try {
      mkdirSync(join(tmp, "src"), { recursive: true });
      writeFileSync(
        join(tmp, "src", "module.ts"),
        "export class Foo {\n  bar(): void {}\n}\n",
        "utf-8",
      );
      const vocab = buildSourceVocabulary(tmp, ["src/module.ts"]);
      // Sanity: Foo and Foo.bar are in vocab.
      expect(vocab.identifiers.has("Foo")).toBe(true);
      expect(vocab.methods.has("Foo.bar")).toBe(true);
      // chainResolves: Foo.bar OK, Foo.baz NOT OK.
      expect(chainResolves(vocab, "Foo.bar")).toBe(true);
      expect(chainResolves(vocab, "Foo.baz")).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns true (no chain check applies) when the owner is unknown — defers to the unknown-identifier path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "forge-w5-"));
    try {
      mkdirSync(join(tmp, "src"), { recursive: true });
      writeFileSync(
        join(tmp, "src", "module.ts"),
        "export class Foo {\n  bar(): void {}\n}\n",
        "utf-8",
      );
      const vocab = buildSourceVocabulary(tmp, ["src/module.ts"]);
      // SomethingElse is not in vocab at all → chainResolves returns true so
      // the legacy `unknown identifier` path can flag it instead.
      expect(chainResolves(vocab, "SomethingElse.foo")).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns true for a bare (non-dotted) identifier — no chain check applies", () => {
    const vocab = buildSourceVocabulary(resolve(__dirname, "..", ".."), ["server/lib/__fixtures__/spec-vocabulary/basic.ts"]);
    expect(chainResolves(vocab, "Foo")).toBe(true);
    expect(chainResolves(vocab, "TotallyUnknown")).toBe(true);
  });
});

describe("W5 (#516) call-chain grounding — validator end-to-end", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "forge-w5-validator-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("AC-1: monday-bot's mis-attribution scenario — a chain to a non-implementing layer is flagged", () => {
    // Mirror monday's exact case: a class `KnowledgeService` exists but it
    // does NOT export a `search` method (the actual not-found logic lives
    // in upstream constants). Bullet binds the invariant to the chain.
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "module.ts"),
      [
        "export class KnowledgeService {",
        "  // search() does NOT exist on this class — the implementing",
        "  // logic lives elsewhere. Binding an invariant to",
        "  // KnowledgeService.search() is a layer mis-attribution.",
        "  fetch(): void {}",
        "}",
        "export const NO_CONTEXT_ANSWER = \"I couldn't find that.\";",
      ].join("\n"),
      "utf-8",
    );
    const vocab = buildSourceVocabulary(tmp, ["src/module.ts"]);

    const sections = {
      "api-contracts":
        "- `KnowledgeService.search`: surfaces the not-found message (THIS IS THE MIS-ATTRIBUTION)",
      "data-models": "- `NO_CONTEXT_ANSWER`: the constant carrying the not-found copy",
      invariants: "(none)",
      "test-surface": "(none)",
    } as Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string>;

    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: 1 });

    // The invented chain bullet is stripped (rejected) on the branch.
    expect(result.sections["api-contracts"]).not.toContain("KnowledgeService.search");
    // The NO_CONTEXT_ANSWER bullet (the actual implementing layer) survives.
    expect(result.sections["data-models"]).toContain("NO_CONTEXT_ANSWER");

    // A `stripped-unknown-chain` warning was emitted with the offending chain.
    const chainWarn = result.warnings.find(
      (w): w is Extract<typeof w, { kind: "stripped-unknown-chain" }> =>
        w.kind === "stripped-unknown-chain",
    );
    expect(chainWarn).toBeDefined();
    expect(chainWarn!.chain).toBe("KnowledgeService.search");
    expect(chainWarn!.section).toBe("api-contracts");
  });

  it("AC-2: `Foo.baz` where Foo is a known class but baz is NOT a method → flagged as `unknown chain`", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "module.ts"),
      "export class Foo {\n  bar(): void {}\n}\n",
      "utf-8",
    );
    const vocab = buildSourceVocabulary(tmp, ["src/module.ts"]);

    const sections = {
      "api-contracts": "- `Foo.bar`: real method\n- `Foo.baz`: not a real method",
      "data-models": "(none)",
      invariants: "(none)",
      "test-surface": "(none)",
    } as Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string>;

    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: 1 });

    // Real `Foo.bar` survives; invented `Foo.baz` is stripped.
    expect(result.sections["api-contracts"]).toContain("Foo.bar");
    expect(result.sections["api-contracts"]).not.toContain("Foo.baz");
    // Diagnostic: distinct `unknown chain` kind, not the legacy `unknown identifier`.
    const wChain = result.warnings.find((w) => w.kind === "stripped-unknown-chain");
    const wId = result.warnings.find((w) => w.kind === "stripped-unknown-identifier");
    expect(wChain).toBeDefined();
    expect(wId).toBeUndefined();
    expect(wChain!.kind).toBe("stripped-unknown-chain");
    if (wChain!.kind === "stripped-unknown-chain") {
      expect(wChain!.chain).toBe("Foo.baz");
    }
  });

  it("AC-5: a bullet whose chain DOES resolve passes through unchanged", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "module.ts"),
      "export class Foo {\n  bar(): void {}\n  qux(): void {}\n}\n",
      "utf-8",
    );
    const vocab = buildSourceVocabulary(tmp, ["src/module.ts"]);
    const sections = {
      "api-contracts": "- `Foo.bar`: real method\n- `Foo.qux`: also real",
      "data-models": "(none)",
      invariants: "(none)",
      "test-surface": "(none)",
    } as Record<"api-contracts" | "data-models" | "invariants" | "test-surface", string>;
    const result = validateAgainstVocabulary(sections, vocab, { filesScanned: 1 });
    expect(result.sections["api-contracts"]).toContain("Foo.bar");
    expect(result.sections["api-contracts"]).toContain("Foo.qux");
    expect(result.warnings).toHaveLength(0);
  });
});

describe("W5 (#516) prompt clause — option (c)", () => {
  it("system prompt names the call-chain grounding rule (W5)", async () => {
    // The prompt is private, but we can assert via the synth's user-prompt
    // builder side-effect: the system clause "W5" makes it into the source
    // file. We grep the compiled module text directly.
    const src = readFileSync(resolve(__dirname, "spec-generator.ts"), "utf-8");
    expect(src).toMatch(/Attribution discipline \(W5\)/);
    expect(src).toMatch(/Call-chain grounding \(W5\)/);
  });
});
