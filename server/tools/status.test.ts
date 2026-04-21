import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { handleStatus, statusInputSchema } from "./status.js";
import {
  clearDeclaration,
  setDeclaration,
  getDeclaration,
} from "../lib/declaration-store.js";

function makeTmpDir(): string {
  return join(tmpdir(), `forge-status-test-${randomBytes(4).toString("hex")}`);
}

function makeRecord(
  storyId: string | null,
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE" | null,
  timestamp: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    timestamp,
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    metrics: {
      inputTokens: 100,
      outputTokens: 50,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: 1234,
      estimatedCostUsd: 0.05,
    },
    outcome: "success",
    ...extra,
  };
  if (storyId) rec.storyId = storyId;
  if (verdict) rec.evalVerdict = verdict;
  return rec;
}

function parseBody(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe("forge_status — schema export (AC-11 sibling)", () => {
  it("exports statusInputSchema truthy", () => {
    expect(statusInputSchema).toBeTruthy();
    expect(typeof statusInputSchema).toBe("object");
    // scope + since + projectPath are the documented keys
    expect(statusInputSchema.scope).toBeDefined();
    expect(statusInputSchema.since).toBeDefined();
    expect(statusInputSchema.projectPath).toBeDefined();
  });
});

describe("forge_status — empty cases", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = makeTmpDir();
    clearDeclaration();
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    clearDeclaration();
  });

  it("AC-5: no .forge dir returns kind=empty reason=no-forge-dir without throwing", async () => {
    // scratch dir exists but no .forge subdir
    await mkdir(projectPath, { recursive: true });

    const result = await handleStatus({ projectPath });
    const body = parseBody(result);

    expect(body.kind).toBe("empty");
    expect(body.reason).toBe("no-forge-dir");
    expect(typeof body.generatedAt).toBe("string");
    expect(result.isError).toBeUndefined();
  });

  it("empty .forge/runs dir returns kind=empty reason=no-runs", async () => {
    await mkdir(join(projectPath, ".forge", "runs"), { recursive: true });

    const result = await handleStatus({ projectPath });
    const body = parseBody(result);

    expect(body.kind).toBe("empty");
    expect(body.reason).toBe("no-runs");
  });

  it("AC-7: scope narrows to zero matches returns kind=empty reason=scope-miss", async () => {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "a.json"),
      JSON.stringify(makeRecord("US-01", "PASS", "2026-04-20T12:00:00.000Z")),
      "utf-8",
    );
    await writeFile(
      join(runsDir, "b.json"),
      JSON.stringify(makeRecord("US-02", "FAIL", "2026-04-20T13:00:00.000Z")),
      "utf-8",
    );

    const result = await handleStatus({
      projectPath,
      scope: { storyId: "US-nonexistent" },
    });
    const body = parseBody(result);

    expect(body.kind).toBe("empty");
    expect(body.reason).toBe("scope-miss");
  });
});

describe("forge_status — corruption tolerance (AC-6)", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = makeTmpDir();
    clearDeclaration();
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    clearDeclaration();
  });

  it("AC-6: 2 valid + 1 corrupt returns kind=corrupted with non-empty stories and corruptedFiles.length===1", async () => {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });

    await writeFile(
      join(runsDir, "valid-1.json"),
      JSON.stringify(makeRecord("US-01", "PASS", "2026-04-20T12:00:00.000Z")),
      "utf-8",
    );
    await writeFile(
      join(runsDir, "valid-2.json"),
      JSON.stringify(makeRecord("US-02", "FAIL", "2026-04-20T13:00:00.000Z")),
      "utf-8",
    );
    // Corrupt file — not-JSON
    await writeFile(join(runsDir, "corrupt.json"), "{not-json", "utf-8");

    const result = await handleStatus({ projectPath });
    const body = parseBody(result);

    expect(body.kind).toBe("corrupted");
    expect(Array.isArray(body.stories)).toBe(true);
    expect(body.stories.length).toBeGreaterThan(0);
    expect(Array.isArray(body.corruptedFiles)).toBe(true);
    expect(body.corruptedFiles.length).toBe(1);
    expect(body.corruptedFiles[0]).toBe("corrupt.json");
    expect(result.isError).toBeUndefined();
  });

  it("parseable-but-schema-mismatch JSON is also surfaced as corrupted", async () => {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "ok.json"),
      JSON.stringify(makeRecord("US-03", "PASS", "2026-04-20T14:00:00.000Z")),
      "utf-8",
    );
    await writeFile(
      join(runsDir, "wrong-shape.json"),
      JSON.stringify({ unrelated: "payload" }),
      "utf-8",
    );

    const result = await handleStatus({ projectPath });
    const body = parseBody(result);

    expect(body.kind).toBe("corrupted");
    expect(body.corruptedFiles).toContain("wrong-shape.json");
  });
});

describe("forge_status — snapshot and roll-up", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = makeTmpDir();
    clearDeclaration();
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    clearDeclaration();
  });

  it("returns kind=snapshot with per-story roll-up", async () => {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });

    // Two runs for US-01 — latest wins
    await writeFile(
      join(runsDir, "r1.json"),
      JSON.stringify(makeRecord("US-01", "FAIL", "2026-04-20T10:00:00.000Z")),
      "utf-8",
    );
    await writeFile(
      join(runsDir, "r2.json"),
      JSON.stringify(makeRecord("US-01", "PASS", "2026-04-20T12:00:00.000Z")),
      "utf-8",
    );
    // One run for US-02
    await writeFile(
      join(runsDir, "r3.json"),
      JSON.stringify(makeRecord("US-02", "FAIL", "2026-04-20T11:00:00.000Z")),
      "utf-8",
    );

    const result = await handleStatus({ projectPath });
    const body = parseBody(result);

    expect(body.kind).toBe("snapshot");
    expect(Array.isArray(body.stories)).toBe(true);
    const us01 = body.stories.find((s: { storyId: string }) => s.storyId === "US-01");
    const us02 = body.stories.find((s: { storyId: string }) => s.storyId === "US-02");
    expect(us01).toBeDefined();
    expect(us01.lastVerdict).toBe("PASS");
    expect(us01.state).toBe("shipped");
    expect(us01.runCount).toBe(2);
    expect(us01.lastUpdatedAt).toBe("2026-04-20T12:00:00.000Z");

    expect(us02).toBeDefined();
    expect(us02.lastVerdict).toBe("BLOCK");
    expect(us02.state).toBe("blocked");
    expect(us02.runCount).toBe(1);
  });

  it("totals aggregates estimatedCostUsd and durationMs across matched records", async () => {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "r1.json"),
      JSON.stringify(makeRecord("US-01", "PASS", "2026-04-20T10:00:00.000Z")),
      "utf-8",
    );
    await writeFile(
      join(runsDir, "r2.json"),
      JSON.stringify(makeRecord("US-02", "PASS", "2026-04-20T11:00:00.000Z")),
      "utf-8",
    );

    const result = await handleStatus({ projectPath });
    const body = parseBody(result);

    expect(body.totals).toBeDefined();
    expect(body.totals.spentUsd).toBeCloseTo(0.1, 5);
    expect(body.totals.elapsedMs).toBe(2468);
    expect(body.totals.budgetUsd).toBeNull();
    expect(body.totals.timeBudgetMs).toBeNull();
  });

  it("scope.storyId filters roll-up to matching story only", async () => {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "r1.json"),
      JSON.stringify(makeRecord("US-01", "PASS", "2026-04-20T10:00:00.000Z")),
      "utf-8",
    );
    await writeFile(
      join(runsDir, "r2.json"),
      JSON.stringify(makeRecord("US-02", "PASS", "2026-04-20T11:00:00.000Z")),
      "utf-8",
    );

    const result = await handleStatus({ projectPath, scope: { storyId: "US-01" } });
    const body = parseBody(result);

    expect(body.kind).toBe("snapshot");
    expect(body.stories.length).toBe(1);
    expect(body.stories[0].storyId).toBe("US-01");
  });
});

describe("forge_status — differential mode", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = makeTmpDir();
    clearDeclaration();
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    clearDeclaration();
  });

  it("since=T filters to records strictly newer than T and marks kind=differential", async () => {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "r1.json"),
      JSON.stringify(makeRecord("US-01", "PASS", "2026-04-20T09:00:00.000Z")),
      "utf-8",
    );
    await writeFile(
      join(runsDir, "r2.json"),
      JSON.stringify(makeRecord("US-02", "PASS", "2026-04-20T12:00:00.000Z")),
      "utf-8",
    );

    const result = await handleStatus({
      projectPath,
      since: "2026-04-20T10:00:00.000Z",
    });
    const body = parseBody(result);

    expect(body.kind).toBe("differential");
    const ids = body.stories.map((s: { storyId: string }) => s.storyId);
    expect(ids).toContain("US-02");
    expect(ids).not.toContain("US-01");
  });
});

describe("forge_status + forge_declare_story — activeRun (AC-8a)", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = makeTmpDir();
    clearDeclaration();
    await mkdir(join(projectPath, ".forge", "runs"), { recursive: true });
    // seed at least one record so stories array is populated
    await writeFile(
      join(projectPath, ".forge", "runs", "seed.json"),
      JSON.stringify(makeRecord("US-00", "PASS", "2026-04-20T10:00:00.000Z")),
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    clearDeclaration();
  });

  it("AC-8a: after forge_declare_story, forge_status reflects storyId + phaseId in activeRun", async () => {
    // Import handler in-test so we exercise the real MCP handler shape
    const { handleDeclareStory } = await import("./declare-story.js");
    const declareResult = await handleDeclareStory({
      storyId: "US-03",
      phaseId: "PH-02",
    });
    expect(declareResult.isError).toBeUndefined();

    // Sanity check the store directly — guards against a silent mis-wire
    const declaration = getDeclaration();
    expect(declaration).not.toBeNull();
    expect(declaration?.storyId).toBe("US-03");
    expect(declaration?.phaseId).toBe("PH-02");

    const statusResult = await handleStatus({ projectPath });
    const body = parseBody(statusResult);

    expect(body.activeRun).not.toBeNull();
    expect(body.activeRun.storyId).toBe("US-03");
    expect(body.activeRun.phaseId).toBe("PH-02");
    expect(typeof body.activeRun.pid).toBe("number");
    expect(typeof body.activeRun.elapsedMs).toBe("number");
    expect(body.activeRun.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("activeRun.storyId is null when no declaration has been made in this test", async () => {
    // No setDeclaration call in this test; beforeEach cleared any prior state.
    const statusResult = await handleStatus({ projectPath });
    const body = parseBody(statusResult);

    // activeRun may be null (when there's no activity.json either) or may
    // have storyId: null. Both are valid signals for "no active story."
    if (body.activeRun !== null) {
      expect(body.activeRun.storyId).toBeNull();
    } else {
      expect(body.activeRun).toBeNull();
    }
  });

  it("setDeclaration overwrites prior declaration", async () => {
    setDeclaration("US-01", "PH-01");
    setDeclaration("US-99", "PH-99");

    const result = await handleStatus({ projectPath });
    const body = parseBody(result);
    expect(body.activeRun.storyId).toBe("US-99");
    expect(body.activeRun.phaseId).toBe("PH-99");
  });

  it("phaseId is optional on declare-story", async () => {
    const { handleDeclareStory } = await import("./declare-story.js");
    const r = await handleDeclareStory({ storyId: "US-05" });
    expect(r.isError).toBeUndefined();
    const body = JSON.parse(r.content[0].text);
    expect(body.storyId).toBe("US-05");
    expect(body.phaseId).toBeNull();
  });

  it("empty storyId is rejected by declare-story handler", async () => {
    const { handleDeclareStory } = await import("./declare-story.js");
    const r = await handleDeclareStory({ storyId: "" });
    expect(r.isError).toBe(true);
  });
});
