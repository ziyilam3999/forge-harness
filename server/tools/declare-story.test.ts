import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

function makeTmpDir(): string {
  return join(tmpdir(), `forge-declare-test-${randomBytes(4).toString("hex")}`);
}

describe("forge_declare_story — schema export (AC-11)", () => {
  it("declareStoryInputSchema is defined and truthy", async () => {
    const mod = await import("./declare-story.js");
    expect(mod.declareStoryInputSchema).toBeTruthy();
    expect(typeof mod.declareStoryInputSchema).toBe("object");
    expect(mod.declareStoryInputSchema.storyId).toBeDefined();
    expect(mod.declareStoryInputSchema.phaseId).toBeDefined();
  });

  it("handleDeclareStory is a function", async () => {
    const mod = await import("./declare-story.js");
    expect(typeof mod.handleDeclareStory).toBe("function");
  });
});

describe("forge_status — AC-8b: freshly-isolated module state has activeRun.storyId === null (or activeRun === null)", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = makeTmpDir();
    await mkdir(join(projectPath, ".forge", "runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    vi.resetModules();
  });

  it("fresh module state — no prior declaration — activeRun reflects null story", async () => {
    // Reset all modules so declaration-store.ts re-initializes with
    // currentDeclaration = null. This is the test-isolation variant
    // requested by AC-8b.
    vi.resetModules();

    const { handleStatus } = await import("./status.js");
    const result = await handleStatus({ projectPath });
    const body = JSON.parse(result.content[0].text);

    // AC-8b: activeRun === null OR activeRun.storyId === null
    if (body.activeRun === null) {
      expect(body.activeRun).toBeNull();
    } else {
      expect(body.activeRun.storyId).toBeNull();
    }
  });

  it("freshly-reset module: declaration does not leak from a prior test file", async () => {
    vi.resetModules();
    const { getDeclaration } = await import("../lib/declaration-store.js");
    expect(getDeclaration()).toBeNull();
  });
});

describe("forge_declare_story — handler behavior", () => {
  beforeEach(async () => {
    const { clearDeclaration } = await import("../lib/declaration-store.js");
    clearDeclaration();
  });

  afterEach(async () => {
    const { clearDeclaration } = await import("../lib/declaration-store.js");
    clearDeclaration();
  });

  it("returns kind=declared with echoed storyId and phaseId", async () => {
    const { handleDeclareStory } = await import("./declare-story.js");
    const result = await handleDeclareStory({ storyId: "US-07", phaseId: "PH-03" });

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.kind).toBe("declared");
    expect(body.storyId).toBe("US-07");
    expect(body.phaseId).toBe("PH-03");
    expect(typeof body.declaredAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.declaredAt))).toBe(false);
  });

  it("writes through to the declaration store (get returns the set value)", async () => {
    const { handleDeclareStory } = await import("./declare-story.js");
    const { getDeclaration } = await import("../lib/declaration-store.js");

    await handleDeclareStory({ storyId: "US-42", phaseId: "PH-11" });
    const decl = getDeclaration();

    expect(decl).not.toBeNull();
    expect(decl?.storyId).toBe("US-42");
    expect(decl?.phaseId).toBe("PH-11");
  });

  it("rejects empty phaseId (when explicitly passed) as error", async () => {
    const { handleDeclareStory } = await import("./declare-story.js");
    const result = await handleDeclareStory({ storyId: "US-01", phaseId: "" } as { storyId: string; phaseId: string });
    expect(result.isError).toBe(true);
  });

  it("omitted phaseId stores null", async () => {
    const { handleDeclareStory } = await import("./declare-story.js");
    const { getDeclaration } = await import("../lib/declaration-store.js");

    await handleDeclareStory({ storyId: "US-solo" });
    const decl = getDeclaration();
    expect(decl?.phaseId).toBeNull();
  });
});
