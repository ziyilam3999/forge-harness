import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  buildSourceVocabulary,
  renderVocabularyForPrompt,
  vocabularyContains,
} from "./spec-source-vocabulary.js";

const PROJECT_ROOT = resolve(__dirname, "..", "..");
// FIXTURE_REL is relative to PROJECT_ROOT, POSIX-form (Windows resolves both).
const FIXTURE_REL = "server/lib/__fixtures__/spec-vocabulary";

describe("spec-source-vocabulary — AC-1 basic class + interface", () => {
  it("extracts class identifier, public methods, interface fields", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    expect(vocab.identifiers.has("Foo")).toBe(true);
    expect(vocab.identifiers.has("Baz")).toBe(true);
    expect(vocab.methods.has("Foo.bar")).toBe(true);
    // Private method must NOT appear
    expect(vocab.methods.has("Foo.secret")).toBe(false);
    expect(vocab.fields.has("Baz.id")).toBe(true);
  });
});

describe("spec-source-vocabulary — AC-2 edge cases", () => {
  it("default export contributes its class name to identifiers", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/default-export.ts`]);
    expect(vocab.identifiers.has("DefaultClass")).toBe(true);
    expect(vocab.identifiers.has("default")).toBe(true);
    expect(vocab.methods.has("DefaultClass.hello")).toBe(true);
  });

  it("generic function's bare name (no <T>) appears in identifiers", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/generic.ts`]);
    expect(vocab.identifiers.has("genericFunc")).toBe(true);
    // Generic class also without <T>
    expect(vocab.identifiers.has("GenericBox")).toBe(true);
    expect(vocab.methods.has("GenericBox.unwrap")).toBe(true);
    // No mangled `<T>` leakage
    for (const id of vocab.identifiers) {
      expect(id.includes("<")).toBe(false);
    }
  });

  it("enum name in identifiers; each member in fields", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/enum.ts`]);
    expect(vocab.identifiers.has("Color")).toBe(true);
    expect(vocab.fields.has("Color.RED")).toBe(true);
    expect(vocab.fields.has("Color.GREEN")).toBe(true);
    expect(vocab.fields.has("Color.BLUE")).toBe(true);
  });

  it("re-exports surface re-exported and renamed names", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/re-export.ts`]);
    expect(vocab.identifiers.has("Foo")).toBe(true);
    expect(vocab.identifiers.has("renamedFunc")).toBe(true);
  });

  it(".mjs file's class and function names harvested", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/mjs-module.mjs`]);
    expect(vocab.identifiers.has("MjsClass")).toBe(true);
    expect(vocab.methods.has("MjsClass.greet")).toBe(true);
    expect(vocab.identifiers.has("mjsFunc")).toBe(true);
  });

  it("type alias with object literal exposes top-level fields; const exports surface their names", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/types-and-consts.ts`]);
    expect(vocab.identifiers.has("Settings")).toBe(true);
    expect(vocab.fields.has("Settings.host")).toBe(true);
    expect(vocab.fields.has("Settings.port")).toBe(true);
    expect(vocab.identifiers.has("DEFAULT_HOST")).toBe(true);
    expect(vocab.identifiers.has("DEFAULT_PORT")).toBe(true);
  });

  it("test files contribute describe/it strings to testNames", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/sample-tests`]);
    expect(vocab.testNames.has("sample feature")).toBe(true);
    expect(vocab.testNames.has("does the thing")).toBe(true);
    expect(vocab.testNames.has("does the other thing")).toBe(true);
  });
});

describe("spec-source-vocabulary — directory-prefix walking", () => {
  it("a directory affectedPath collects every .ts/.mjs file under it", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [FIXTURE_REL]);
    // Mix of fixture file outputs:
    expect(vocab.identifiers.has("Foo")).toBe(true);          // basic.ts
    expect(vocab.identifiers.has("DefaultClass")).toBe(true); // default-export.ts
    expect(vocab.identifiers.has("Color")).toBe(true);        // enum.ts
    expect(vocab.identifiers.has("MjsClass")).toBe(true);     // mjs-module.mjs
    expect(vocab.identifiers.has("Settings")).toBe(true);     // types-and-consts.ts
    // Test files harvested separately, but directory walk should still pick them up.
    expect(vocab.testNames.has("sample feature")).toBe(true);
  });

  it("missing affectedPath becomes a soft warning, not a throw", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, ["does/not/exist/path"]);
    expect(vocab.warnings.some((w) => w.includes("does not exist"))).toBe(true);
    expect(vocab.identifiers.size).toBe(0);
  });
});

describe("spec-source-vocabulary — empty input fallback (AC-8 helper)", () => {
  it("empty affectedPaths records a 'no source vocabulary available' warning", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, []);
    expect(vocab.warnings.length).toBeGreaterThan(0);
    expect(vocab.warnings[0]).toMatch(/no source vocabulary/i);
  });
});

describe("renderVocabularyForPrompt — content + token cap (AC-3, AC-4)", () => {
  it("emits a 'Real symbols available' section listing classes, types, methods, fields", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    const out = renderVocabularyForPrompt(vocab);
    expect(out).toContain("## Real symbols available");
    expect(out).toContain("Foo");
    expect(out).toContain("bar");
    expect(out).toContain("Baz");
    expect(out).toContain("id");
    expect(out).toMatch(/Restrict yourself to these/);
  });

  it("falls back to 'No source vocabulary available' for an empty vocab", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, []);
    const out = renderVocabularyForPrompt(vocab);
    expect(out).toContain("No source vocabulary available");
    expect(out).toMatch(/emit `\(none\)`/);
  });

  it("caps output at 2000 bytes and appends '…(N more)' when over budget", () => {
    // Synthesise a giant vocabulary by faking a big set
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
    const out = renderVocabularyForPrompt(big, 2000);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(2000);
    expect(out).toMatch(/…\(\d+ more\)/);
  });
});

describe("vocabularyContains — predicate semantics", () => {
  it("matches bare identifiers, qualified methods, qualified fields, and test names", () => {
    const vocab = buildSourceVocabulary(PROJECT_ROOT, [`${FIXTURE_REL}/basic.ts`]);
    expect(vocabularyContains(vocab, "Foo")).toBe(true);
    expect(vocabularyContains(vocab, "Foo.bar")).toBe(true);
    expect(vocabularyContains(vocab, "Baz.id")).toBe(true);
    expect(vocabularyContains(vocab, "Bogus")).toBe(false);
    expect(vocabularyContains(vocab, "Foo.bogus")).toBe(false);
  });
});
