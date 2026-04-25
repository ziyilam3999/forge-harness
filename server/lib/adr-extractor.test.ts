import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { processStory } from "./adr-extractor.js";

// ── helpers ──────────────────────────────────────────────────────────────

function writeStub(
  projectPath: string,
  storyId: string,
  filename: string,
  fm: Record<string, string | number | null>,
): string {
  const dir = join(projectPath, ".forge", "staging", "adr", storyId);
  mkdirSync(dir, { recursive: true });
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === "number") lines.push(`${k}: ${v}`);
    else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "", "(stub body — ignored by extractor)", "");
  const path = join(dir, filename);
  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

function validateAdr(filePath: string): { ok: boolean; output: string } {
  try {
    const out = execSync(
      `node ${JSON.stringify(join(process.cwd(), "scripts", "validate-adr.mjs"))} ${JSON.stringify(filePath)}`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output: out };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { ok: false, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
  }
}

const sampleStub = {
  title: "Use SQLite for local cache",
  story: "US-01",
  context: "We need a small key-value store for cached eval reports.",
  decision: "Adopt SQLite via better-sqlite3.",
  consequences: "One more native dep; reads stay synchronous.",
  alternatives: "- LevelDB (rejected: more deps, async API)",
};

// ── Test 1: happy path ───────────────────────────────────────────────────

describe("adr-extractor — happy path (AC-C1, AC-C2, AC-C3)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forge-adr-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("converts a single staged stub into a canonical ADR + INDEX row", () => {
    writeStub(tmp, "US-01", "use-sqlite.md", sampleStub);

    const result = processStory({
      projectPath: tmp,
      storyId: "US-01",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      today: "2026-04-25",
    });

    // AC-C1: ADR file exists at the canonical location
    expect(result.newAdrPaths.length).toBe(1);
    const adrPath = result.newAdrPaths[0];
    expect(existsSync(adrPath)).toBe(true);
    expect(adrPath).toMatch(/ADR-0001-use-sqlite-for-local-cache-US-01\.md$/);

    // Staging cleared
    const stagingDir = join(tmp, ".forge", "staging", "adr", "US-01");
    expect(existsSync(stagingDir)).toBe(false);

    // AC-C2: validator approves the canonical ADR
    const v = validateAdr(adrPath);
    expect(v.ok, v.output).toBe(true);

    // AC-C3: INDEX.md contains exactly one ADR row
    const indexText = readFileSync(result.indexPath, "utf-8");
    const adrRows = indexText.split("\n").filter((l) => /^\| ADR-/.test(l));
    expect(adrRows.length).toBe(1);
    expect(adrRows[0]).toContain("ADR-0001");
    expect(adrRows[0]).toContain("US-01");
    expect(adrRows[0]).toContain(sampleStub.title);

    // AC-C5 telemetry: no-decisions row was NOT appended on a story with stubs
    expect(result.appendedNoDecisionsRow).toBe(false);
  });
});

// ── Test 2: no-decisions story ───────────────────────────────────────────

describe("adr-extractor — no-decisions story (AC-C1, AC-C4 INDEX dedup)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forge-adr-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("appends a single 'no new decisions' row, idempotent on re-run", () => {
    const r1 = processStory({
      projectPath: tmp,
      storyId: "US-99",
      gitSha: "abcabcabcabcabcabcabcabcabcabcabcabcabca",
      today: "2026-04-25",
    });
    expect(r1.newAdrPaths.length).toBe(0);
    expect(r1.appendedNoDecisionsRow).toBe(true);

    // INDEX.md has exactly one US-99 no-decisions row
    let indexText = readFileSync(r1.indexPath, "utf-8");
    let matchCount = (indexText.match(/^\| US-99 \| no new decisions \|/gm) || []).length;
    expect(matchCount).toBe(1);

    // Re-run on the same no-decisions story — must NOT duplicate the row
    const r2 = processStory({
      projectPath: tmp,
      storyId: "US-99",
      gitSha: "abcabcabcabcabcabcabcabcabcabcabcabcabca",
      today: "2026-04-25",
    });
    expect(r2.appendedNoDecisionsRow).toBe(false);
    indexText = readFileSync(r2.indexPath, "utf-8");
    matchCount = (indexText.match(/^\| US-99 \| no new decisions \|/gm) || []).length;
    expect(matchCount).toBe(1);
  });
});

// ── Test 3: duplicate-PASS idempotent ────────────────────────────────────

describe("adr-extractor — duplicate-PASS idempotency (AC-C4 ADR dedup)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forge-adr-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("re-running PASS on the same story does not create duplicate ADR files", () => {
    writeStub(tmp, "US-02", "use-zod.md", { ...sampleStub, story: "US-02", title: "Adopt Zod for schema validation" });

    const r1 = processStory({
      projectPath: tmp,
      storyId: "US-02",
      today: "2026-04-25",
    });
    expect(r1.newAdrPaths.length).toBe(1);

    // Second PASS — staging is already empty (extractor cleared it).
    // Re-running with no new stubs MUST NOT create another ADR file.
    const r2 = processStory({
      projectPath: tmp,
      storyId: "US-02",
      today: "2026-04-25",
    });
    expect(r2.newAdrPaths.length).toBe(0);

    // Filesystem reflects exactly ONE ADR file across both runs
    const decisionsDir = join(tmp, "docs", "decisions");
    const adrFiles = readdirSync(decisionsDir).filter((n) => /^ADR-\d{4}-/.test(n));
    expect(adrFiles.length).toBe(1);

    // INDEX.md still has exactly one ADR row
    const indexText = readFileSync(r2.indexPath, "utf-8");
    const adrRows = indexText.split("\n").filter((l) => /^\| ADR-/.test(l));
    expect(adrRows.length).toBe(1);

    // The second run (no stubs) DID NOT add a no-decisions row, because the
    // story already has an ADR. Per AC-C1: "ADR exists OR no-decisions row" —
    // we only add the no-decisions row when the story has NEVER staged any
    // ADRs. The "already-has-ADR" check is via the INDEX rebuild observing
    // the existing ADR file; we conservatively only add the row when the
    // current call yields zero ADRs AND the story has no row already.
    // This second run has zero ADRs from THIS call but the story already has
    // an ADR row, so no no-decisions row gets added.
    const noDecRows = (indexText.match(/^\| US-02 \| no new decisions \|/gm) || []).length;
    expect(noDecRows).toBe(0);
  });
});

// ── Test 4: malformed front-matter ───────────────────────────────────────

describe("adr-extractor — malformed stub (AC-C6)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forge-adr-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("throws a clear error and does NOT delete the stub when front-matter is malformed", () => {
    // Missing required `decision` field.
    const dir = join(tmp, ".forge", "staging", "adr", "US-03");
    mkdirSync(dir, { recursive: true });
    const stubPath = join(dir, "broken.md");
    writeFileSync(
      stubPath,
      [
        "---",
        'title: "broken stub"',
        'story: "US-03"',
        'context: "context"',
        'consequences: "consequences"',
        'alternatives: "alternatives"',
        // decision: missing
        "---",
        "",
        "body",
      ].join("\n"),
      "utf-8",
    );

    expect(() =>
      processStory({
        projectPath: tmp,
        storyId: "US-03",
        today: "2026-04-25",
      }),
    ).toThrow(/missing or empty required field: decision/);

    // Stub still on disk so the operator can fix it and re-run.
    expect(existsSync(stubPath)).toBe(true);

    // No ADR file written.
    const decisionsDir = join(tmp, "docs", "decisions");
    if (existsSync(decisionsDir)) {
      const adrFiles = readdirSync(decisionsDir).filter((n) => /^ADR-\d{4}-/.test(n));
      expect(adrFiles.length).toBe(0);
    }
  });
});
