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

// ── Test 4 (AC-1): YAML `|` literal block scalars ────────────────────────
//
// Reproduces the US-08 regression: subagents writing multi-line ADR fields
// with YAML's `|` literal block scalar syntax (the natural way to express
// multi-paragraph context/decision/consequences blocks). Before the W1 fix,
// `parseStubFrontMatter` rejected any indented continuation line, throwing
// at line 165-167 of adr-extractor.ts; the throw was silently swallowed by
// evaluate.ts:442-446, leaving INDEX.md stale.

describe("adr-extractor — YAML `|` literal block scalars (AC-1, real US-08 stub format)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forge-adr-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("converts a stub with `|` block-scalar fields into a canonical ADR + INDEX row", () => {
    // Mirrors monday-bot's actual US-08 stub format:
    // .forge/staging/adr/US-08/add-slack-bolt-socket-mode.md
    const dir = join(tmp, ".forge", "staging", "adr", "US-08");
    mkdirSync(dir, { recursive: true });
    const stubPath = join(dir, "add-slack-bolt-socket-mode.md");
    writeFileSync(
      stubPath,
      [
        "---",
        "title: Adopt @slack/bolt with Socket Mode for the Slack adapter",
        "story: US-08",
        "context: |",
        "  US-08 introduces the Slack-facing surface of monday-bot — handling @mention",
        "  events and the /ask slash command, and posting Block Kit replies that include",
        "  the answer text and per-citation source lines.",
        "decision: |",
        "  Add `@slack/bolt` (v4.x) as a runtime dependency and wire the adapter to use",
        "  Socket Mode (`socketMode: true`, `appToken: <xapp-...>`).",
        "consequences: |",
        "  + Bundle gains `@slack/bolt` + transitive `@slack/web-api`, `@slack/socket-mode`.",
        "  + Socket Mode means we never expose a public URL.",
        "alternatives: |",
        "  - `@slack/web-api` alone + a hand-rolled Socket Mode client: rejected.",
        "  - HTTP Receiver (default Bolt): rejected — requires public ingress.",
        "---",
        "",
        "(stub body — ignored by extractor)",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = processStory({
      projectPath: tmp,
      storyId: "US-08",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      today: "2026-04-27",
    });

    // (a) exactly one canonicalised ADR file
    expect(result.newAdrPaths.length).toBe(1);
    const adrPath = result.newAdrPaths[0];
    expect(existsSync(adrPath)).toBe(true);
    expect(adrPath).toMatch(/ADR-0001-adopt-slack-bolt-with-socket-mode-for-the-slack-adapter-US-08\.md$/);

    // The canonical ADR's body preserves the multi-paragraph content as-is.
    const adrText = readFileSync(adrPath, "utf-8");
    expect(adrText).toContain("US-08 introduces the Slack-facing surface");
    expect(adrText).toContain("Add `@slack/bolt` (v4.x) as a runtime dependency");
    expect(adrText).toContain("Bundle gains `@slack/bolt`");
    expect(adrText).toContain("HTTP Receiver (default Bolt): rejected");

    // The validator approves it.
    const v = validateAdr(adrPath);
    expect(v.ok, v.output).toBe(true);

    // (b) INDEX.md gains exactly one ADR row pointing at this story.
    const indexText = readFileSync(result.indexPath, "utf-8");
    const adrRows = indexText.split("\n").filter((l) => /^\| ADR-/.test(l));
    expect(adrRows.length).toBe(1);
    expect(adrRows[0]).toContain("ADR-0001");
    expect(adrRows[0]).toContain("US-08");
    expect(adrRows[0]).toContain("Adopt @slack/bolt with Socket Mode");

    // (c) staging dir is gone.
    expect(existsSync(join(tmp, ".forge", "staging", "adr", "US-08"))).toBe(false);

    // (d) no spurious no-decisions row was appended on a story with stubs.
    expect(result.appendedNoDecisionsRow).toBe(false);
    const noDecRows = (indexText.match(/^\| US-08 \| no new decisions \|/gm) || []).length;
    expect(noDecRows).toBe(0);
  });

  it("supports `>` folded block scalars (sibling form — joins lines with spaces)", () => {
    const dir = join(tmp, ".forge", "staging", "adr", "US-09");
    mkdirSync(dir, { recursive: true });
    const stubPath = join(dir, "use-pgvector.md");
    writeFileSync(
      stubPath,
      [
        "---",
        "title: Use pgvector for embeddings",
        "story: US-09",
        "context: >",
        "  We need a vector store that lives next to relational data so we can",
        "  filter by tenant id without crossing a network boundary.",
        "decision: >",
        "  Adopt pgvector v0.7 as a Postgres extension and store embeddings in a",
        "  dedicated table.",
        "consequences: >",
        "  Adds a Postgres extension dependency; ops needs to install it on every",
        "  environment.",
        "alternatives: >",
        "  Pinecone (rejected: separate infra, per-vector cost).",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = processStory({
      projectPath: tmp,
      storyId: "US-09",
      today: "2026-04-27",
    });

    expect(result.newAdrPaths.length).toBe(1);
    const adrText = readFileSync(result.newAdrPaths[0], "utf-8");
    // Folded scalar: continuation lines join with single spaces (no embedded newlines).
    expect(adrText).toContain(
      "We need a vector store that lives next to relational data so we can filter by tenant id without crossing a network boundary.",
    );
    expect(adrText).not.toContain("relational data so we can\nfilter");
  });
});

// ── Test 5: malformed front-matter ───────────────────────────────────────

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

// ── Test 6 (AC-1a-1, AC-1a-3): Bundle 1a agent-first header ──────────────
//
// Every regenerated INDEX.md MUST lead with the literal 5-line HTML-comment
// block + 1 blank line + 1 visible "Generated by forge-harness on YYYY-MM-DD."
// blockquote line. The 5-comment block + blank line are byte-identical across
// regenerations (idempotency); the date line is allowed to refresh.

describe("adr-extractor — agent-first header (AC-1a-1, AC-1a-3)", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "forge-adr-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("INDEX.md first 7 lines match the literal Bundle 1a header contract (AC-1a-1)", () => {
    writeStub(tmp, "US-01", "use-sqlite.md", sampleStub);
    const result = processStory({
      projectPath: tmp,
      storyId: "US-01",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      today: "2026-04-28",
    });

    const indexText = readFileSync(result.indexPath, "utf-8");
    const lines = indexText.split("\n");

    // Line 1: agent-first comment with regen policy.
    expect(lines[0]).toBe(
      "<!-- agent-first: this file is auto-regenerated by forge-harness on every story PASS. -->",
    );
    // Line 2: source-of-truth pointer.
    expect(lines[1]).toBe(
      "<!-- Source of truth: docs/decisions/<US-NN>/*.md (ADRs) and docs/generated/<US-NN>.md (TECHNICAL-SPEC). -->",
    );
    // Line 3: hand-edit prohibition.
    expect(lines[2]).toBe(
      "<!-- Do not hand-edit; edits are overwritten on next regeneration. -->",
    );
    // Line 4: regeneration tool.
    expect(lines[3]).toBe(
      "<!-- Regeneration tool: forge-harness `forge_evaluate` (PASS verdict path). -->",
    );
    // Line 5: design rationale.
    expect(lines[4]).toBe(
      "<!-- Design rationale: P60 Build for Consumer, Not Author. -->",
    );
    // Line 6: blank separator.
    expect(lines[5]).toBe("");
    // Line 7: visible "Generated by ..." blockquote with ISO date.
    expect(lines[6]).toMatch(/^> Generated by forge-harness on \d{4}-\d{2}-\d{2}\.$/);
    expect(lines[6]).toBe("> Generated by forge-harness on 2026-04-28.");
  });

  it("comment block + blank line are byte-identical across two regenerations (AC-1a-3)", () => {
    writeStub(tmp, "US-01", "use-sqlite.md", sampleStub);
    const r1 = processStory({
      projectPath: tmp,
      storyId: "US-01",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      today: "2026-04-28",
    });
    const text1 = readFileSync(r1.indexPath, "utf-8");

    // Re-run with a different `today` to confirm the comment block is stable
    // even when the visible date line refreshes.
    const r2 = processStory({
      projectPath: tmp,
      storyId: "US-01",
      gitSha: "0123456789abcdef0123456789abcdef01234567",
      today: "2099-12-31",
    });
    const text2 = readFileSync(r2.indexPath, "utf-8");

    // Strip the visible "> Generated by ..." date line from both runs.
    const stripDate = (s: string) =>
      s
        .split("\n")
        .filter((l) => !/^> Generated by forge-harness on /.test(l))
        .join("\n");

    expect(stripDate(text1)).toBe(stripDate(text2));

    // Sanity: the date lines themselves were different (proving the strip is
    // doing real work; not just two identical files passing trivially).
    expect(text1).toContain("> Generated by forge-harness on 2026-04-28.");
    expect(text2).toContain("> Generated by forge-harness on 2099-12-31.");
  });

  it("header has exactly 5 HTML-comment lines + 1 blank + 1 visible date line (AC-1a-1 line-count)", () => {
    // No-decisions story still gets the header.
    const result = processStory({
      projectPath: tmp,
      storyId: "US-99",
      gitSha: "abcabcabcabcabcabcabcabcabcabcabcabcabca",
      today: "2026-04-28",
    });
    const indexText = readFileSync(result.indexPath, "utf-8");
    const headerLines = indexText.split("\n").slice(0, 7);

    // 5 HTML-comment lines.
    const commentLines = headerLines.filter((l) => /^<!--[^\n]*-->$/.test(l));
    expect(commentLines.length).toBe(5);
    // 1 blank line (separator).
    const blankCount = headerLines.filter((l) => l === "").length;
    expect(blankCount).toBe(1);
    // 1 visible date line.
    const dateLines = headerLines.filter((l) =>
      /^> Generated by forge-harness on \d{4}-\d{2}-\d{2}\.$/.test(l),
    );
    expect(dateLines.length).toBe(1);
  });
});
