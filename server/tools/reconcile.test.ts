import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

// Mock handlePlan — stub returns a fixed updated plan as a text blob in the
// same shape evaluate/plan produces in real runs.
vi.mock("./plan.js", () => ({
  handlePlan: vi.fn(async () => ({
    content: [
      {
        type: "text" as const,
        text:
          "=== UPDATED PLAN ===\n\n" +
          JSON.stringify({ schemaVersion: "3.0.0", stories: [] }, null, 2) +
          "\n\n=== USAGE ===\nTotal tokens: 0 input / 0 output",
      },
    ],
  })),
}));

import { handleReconcile, reconcileInputSchema } from "./reconcile.js";
import { handlePlan } from "./plan.js";

const mockedHandlePlan = vi.mocked(handlePlan);

const TEST_DIR = join(tmpdir(), "reconcile-test-" + process.pid);

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function makeBase() {
  return {
    projectPath: TEST_DIR,
    masterPlanPath: "master.json",
    phasePlanPaths: {
      "PH-01": "phase-01.json",
      "PH-02": "phase-02.json",
      "PH-03": "phase-03.json",
      "PH-04": "phase-04.json",
    },
    currentMasterPlan: JSON.stringify({ schemaVersion: "3.0.0", stories: [] }),
    currentPhasePlans: {
      "PH-01": JSON.stringify({ schemaVersion: "3.0.0", stories: [{ id: "US-01" }] }),
      "PH-02": JSON.stringify({ schemaVersion: "3.0.0", stories: [{ id: "US-02" }] }),
      "PH-03": JSON.stringify({ schemaVersion: "3.0.0", stories: [{ id: "US-03" }] }),
      "PH-04": JSON.stringify({ schemaVersion: "3.0.0", stories: [{ id: "US-04" }] }),
    },
  };
}

async function writePlanFiles() {
  // Seed plan files with distinct content so sha256 diffing is meaningful
  await writeFile(join(TEST_DIR, "master.json"), JSON.stringify({ seed: "master" }));
  await writeFile(join(TEST_DIR, "phase-01.json"), JSON.stringify({ seed: "ph-01" }));
  await writeFile(join(TEST_DIR, "phase-02.json"), JSON.stringify({ seed: "ph-02" }));
  await writeFile(join(TEST_DIR, "phase-03.json"), JSON.stringify({ seed: "ph-03" }));
  await writeFile(join(TEST_DIR, "phase-04.json"), JSON.stringify({ seed: "ph-04" }));
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  mockedHandlePlan.mockClear();
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ── Schema ──
describe("reconcileInputSchema", () => {
  it("declares all required fields", () => {
    expect(reconcileInputSchema.projectPath).toBeDefined();
    expect(reconcileInputSchema.replanningNotes).toBeDefined();
    expect(reconcileInputSchema.masterPlanPath).toBeDefined();
    expect(reconcileInputSchema.phasePlanPaths).toBeDefined();
    expect(reconcileInputSchema.currentMasterPlan).toBeDefined();
    expect(reconcileInputSchema.currentPhasePlans).toBeDefined();
  });
});

// ── AC1: gap-found writes JSONL ──
describe("handleReconcile — gap-found routing", () => {
  it("AC1: single gap-found note writes exactly one JSONL line with deferred:true", async () => {
    await writePlanFiles();
    const base = makeBase();
    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "gap-found",
          severity: "informational",
          description: "need new story for auth",
        },
      ],
    });
    expect(result.isError).toBeFalsy();

    const jsonlPath = join(TEST_DIR, ".forge", "audit", "reconcile-notes.jsonl");
    expect(await fileExists(jsonlPath)).toBe(true);
    const content = await readFile(jsonlPath, "utf-8");
    const lines = content.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.deferred).toBe(true);
    expect(parsed.category).toBe("gap-found");
    expect(parsed.description).toBe("need new story for auth");
  });

  it("AC2: gap-found surfaces in deferredNotes with identity", async () => {
    await writePlanFiles();
    const base = makeBase();
    const note = {
      category: "gap-found" as const,
      severity: "informational" as const,
      description: "need new story",
    };
    const result = await handleReconcile({ ...base, replanningNotes: [note] });
    const output = JSON.parse(result.content[0].text);
    expect(output.deferredNotes).toHaveLength(1);
    expect(output.deferredNotes[0].description).toBe("need new story");
    expect(output.deferredNotes[0].category).toBe("gap-found");
  });
});

// ── AC3: atomic halt on blocking ──
describe("handleReconcile — atomic halt", () => {
  it("AC3: blocking note halts entire batch, no handlePlan call, plan files byte-identical", async () => {
    await writePlanFiles();
    const base = makeBase();

    const hashesBefore = {
      master: await sha256File(join(TEST_DIR, "master.json")),
      ph01: await sha256File(join(TEST_DIR, "phase-01.json")),
      ph02: await sha256File(join(TEST_DIR, "phase-02.json")),
      ph03: await sha256File(join(TEST_DIR, "phase-03.json")),
      ph04: await sha256File(join(TEST_DIR, "phase-04.json")),
    };

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        { category: "ac-drift", severity: "should-address", description: "minor" },
        {
          category: "assumption-changed",
          severity: "blocking",
          description: "major refactor needed",
        },
        {
          category: "partial-completion",
          severity: "informational",
          description: "ok",
          affectedPhases: ["PH-01"],
        },
      ],
    });

    expect(result.isError).toBe(true);
    const output = JSON.parse(result.content[0].text);
    expect(output.status).toBe("halted");
    expect(output.haltedOnNoteId).toBe(1);
    expect(output.rewriteCount).toBe(0);
    expect(output.operations).toHaveLength(0);

    // handlePlan must NOT have been called
    expect(mockedHandlePlan).not.toHaveBeenCalled();

    // All plan files byte-identical
    const hashesAfter = {
      master: await sha256File(join(TEST_DIR, "master.json")),
      ph01: await sha256File(join(TEST_DIR, "phase-01.json")),
      ph02: await sha256File(join(TEST_DIR, "phase-02.json")),
      ph03: await sha256File(join(TEST_DIR, "phase-03.json")),
      ph04: await sha256File(join(TEST_DIR, "phase-04.json")),
    };
    expect(hashesAfter).toEqual(hashesBefore);

    // reconcile-output.json written
    const outputFile = join(TEST_DIR, ".forge", "reconcile", "reconcile-output.json");
    expect(await fileExists(outputFile)).toBe(true);
  });
});

// ── AC4: affectedPhases narrows phase route ──
describe("handleReconcile — phase route narrowing", () => {
  it("AC4: partial-completion with affectedPhases=[PH-02,PH-04] leaves PH-01+PH-03 untouched", async () => {
    await writePlanFiles();
    const base = makeBase();

    const h01Before = await sha256File(join(TEST_DIR, "phase-01.json"));
    const h02Before = await sha256File(join(TEST_DIR, "phase-02.json"));
    const h03Before = await sha256File(join(TEST_DIR, "phase-03.json"));
    const h04Before = await sha256File(join(TEST_DIR, "phase-04.json"));

    await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "partial-completion",
          severity: "should-address",
          description: "some parts done",
          affectedPhases: ["PH-02", "PH-04"],
        },
      ],
    });

    const h01After = await sha256File(join(TEST_DIR, "phase-01.json"));
    const h02After = await sha256File(join(TEST_DIR, "phase-02.json"));
    const h03After = await sha256File(join(TEST_DIR, "phase-03.json"));
    const h04After = await sha256File(join(TEST_DIR, "phase-04.json"));

    expect(h01After).toBe(h01Before);
    expect(h03After).toBe(h03Before);
    expect(h02After).not.toBe(h02Before);
    expect(h04After).not.toBe(h04Before);
  });
});

// ── AC5: affectedPhases ignored on master route ──
describe("handleReconcile — master route ignores phases", () => {
  it("AC5: ac-drift with affectedPhases=[PH-02] rewrites master, leaves PH-02 phase untouched", async () => {
    await writePlanFiles();
    const base = makeBase();

    const hMasterBefore = await sha256File(join(TEST_DIR, "master.json"));
    const h02Before = await sha256File(join(TEST_DIR, "phase-02.json"));

    await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "ac drifted",
          affectedPhases: ["PH-02"],
        },
      ],
    });

    const hMasterAfter = await sha256File(join(TEST_DIR, "master.json"));
    const h02After = await sha256File(join(TEST_DIR, "phase-02.json"));

    expect(hMasterAfter).not.toBe(hMasterBefore);
    expect(h02After).toBe(h02Before);
  });
});

// ── AC6/AC7: precedence ──
describe("handleReconcile — precedence conflict resolution", () => {
  it("AC6: ac-drift beats partial-completion on same story", async () => {
    await writePlanFiles();
    const base = makeBase();

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "ac drift",
          affectedStories: ["US-01"],
        },
        {
          category: "partial-completion",
          severity: "should-address",
          description: "partial",
          affectedStories: ["US-01"],
          affectedPhases: ["PH-01"],
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    expect(output.conflicts).toHaveLength(1);
    expect(output.conflicts[0].winningCategory).toBe("ac-drift");
  });

  it("AC7: assumption-changed beats ac-drift on same story", async () => {
    await writePlanFiles();
    const base = makeBase();

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "drift",
          affectedStories: ["US-09"],
        },
        {
          category: "assumption-changed",
          severity: "should-address",
          description: "assumption changed",
          affectedStories: ["US-09"],
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    expect(output.conflicts).toHaveLength(1);
    expect(output.conflicts[0].winningCategory).toBe("assumption-changed");
  });
});

// ── AC8: plan.ts not modified ──
describe("handleReconcile — plan.ts untouched", () => {
  it("AC8: git diff master..HEAD -- server/tools/plan.ts is empty", () => {
    const repoRoot = join(__dirname, "..", "..");
    let output = "";
    try {
      output = execSync("git diff master..HEAD -- server/tools/plan.ts", {
        cwd: repoRoot,
        encoding: "utf-8",
      });
    } catch {
      // Skip if not in git context
      return;
    }
    expect(output).toBe("");
  });
});

// ── AC9: handlePlan called with documentTier:"update" ──
describe("handleReconcile — handlePlan invocation", () => {
  it('AC9: handlePlan called with documentTier:"update"', async () => {
    await writePlanFiles();
    const base = makeBase();

    await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "drift",
        },
      ],
    });

    expect(mockedHandlePlan).toHaveBeenCalledWith(
      expect.objectContaining({ documentTier: "update" }),
    );
  });
});

// ── Blocker 3 regression: gap-found is never suppressed by precedence ──
describe("handleReconcile — gap-found bypasses precedence", () => {
  it("gap-found survives even when ac-drift touches the same story", async () => {
    await writePlanFiles();
    const base = makeBase();

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "drift",
          affectedStories: ["US-01"],
        },
        {
          category: "gap-found",
          severity: "informational",
          description: "need new capability",
          affectedStories: ["US-01"],
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    // gap-found survives
    expect(output.deferredNotes).toHaveLength(1);
    expect(output.deferredNotes[0].category).toBe("gap-found");

    // JSONL has exactly 1 line
    const jsonlPath = join(TEST_DIR, ".forge", "audit", "reconcile-notes.jsonl");
    const content = await readFile(jsonlPath, "utf-8");
    expect(content.trimEnd().split("\n")).toHaveLength(1);

    // ac-drift still triggered master route
    expect(mockedHandlePlan).toHaveBeenCalledWith(
      expect.objectContaining({ documentTier: "update" }),
    );

    // conflicts must NOT mention gap-found
    for (const c of output.conflicts ?? []) {
      expect(c.conflictingCategories).not.toContain("gap-found");
      expect(c.winningCategory).not.toBe("gap-found");
    }
  });

  it("pure gap-found batch with overlapping stories: both survive", async () => {
    await writePlanFiles();
    const base = makeBase();

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "gap-found",
          severity: "informational",
          description: "gap 1",
          affectedStories: ["US-01"],
        },
        {
          category: "gap-found",
          severity: "informational",
          description: "gap 2",
          affectedStories: ["US-01"],
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    expect(output.deferredNotes).toHaveLength(2);
    expect(output.conflicts).toHaveLength(0);

    const jsonlPath = join(TEST_DIR, ".forge", "audit", "reconcile-notes.jsonl");
    const content = await readFile(jsonlPath, "utf-8");
    expect(content.trimEnd().split("\n")).toHaveLength(2);
  });
});

// ── Adversarial 3: handlePlan returns non-enveloped payload ──
describe("handleReconcile — parseHandlePlanOutput failure path", () => {
  it("master route: non-enveloped handlePlan response yields error + partial status", async () => {
    await writePlanFiles();
    const base = makeBase();

    // Override mock: return raw garbage (no === UPDATED PLAN === marker, no valid JSON)
    mockedHandlePlan.mockImplementationOnce(async () => ({
      content: [{ type: "text" as const, text: "this is not a plan, not json, no envelope" }],
    }));

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "drift",
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    expect(output.status).toBe("partial");
    expect(output.errors?.length ?? 0).toBeGreaterThan(0);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0].planPathWritten).toBe("");
    expect(result.isError).toBe(true);
  });
});

// ── AC10: output schema ──
describe("handleReconcile — output schema", () => {
  it("AC10: reconcile-output.json has all required keys", async () => {
    await writePlanFiles();
    const base = makeBase();

    await handleReconcile({
      ...base,
      replanningNotes: [
        { category: "gap-found", severity: "informational", description: "gap" },
      ],
    });

    const outputFile = join(TEST_DIR, ".forge", "reconcile", "reconcile-output.json");
    const parsed = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(parsed).toHaveProperty("status");
    expect(parsed).toHaveProperty("operations");
    expect(parsed).toHaveProperty("deferredNotes");
    expect(parsed).toHaveProperty("conflicts");
    expect(parsed).toHaveProperty("rewriteCount");
    expect(parsed).toHaveProperty("timestamp");
    expect(Array.isArray(parsed.operations)).toBe(true);
    expect(Array.isArray(parsed.deferredNotes)).toBe(true);
    expect(Array.isArray(parsed.conflicts)).toBe(true);
  });
});
