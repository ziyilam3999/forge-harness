import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

// Mock handlePlan — Q0/L5: returns structured updatedPlan + critiqueRounds
// sidecar fields alongside a text blob. reconcile.ts reads the structured
// field directly and no longer parses the text envelope, so the text body
// here is purely cosmetic (kept realistic for readability).
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
    updatedPlan: { schemaVersion: "3.0.0", stories: [] },
    critiqueRounds: null,
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
    expect(output.haltedOnNoteIndex).toBe(1);
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

// ── Adversarial 3: handlePlan response missing structured updatedPlan field ──
// Q0/L5: reconcile reads resp.updatedPlan directly. If handlePlan ever drops
// the field (regression or bug), reconcile must fail loudly instead of
// writing garbage to the plan file.
describe("handleReconcile — missing structured updatedPlan field failure path", () => {
  it("master route: handlePlan response without updatedPlan yields error + failed status (sole op)", async () => {
    await writePlanFiles();
    const base = makeBase();

    // Override mock: text content is irrelevant now — the load-bearing
    // signal is the absence of the structured updatedPlan sidecar field.
    mockedHandlePlan.mockImplementationOnce(async () => ({
      content: [{ type: "text" as const, text: "anything" }],
      // updatedPlan intentionally absent
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
    // Only op failed and no deferredNotes → "failed", not "partial"
    expect(output.status).toBe("failed");
    expect(output.errors?.length ?? 0).toBeGreaterThan(0);
    expect(output.operations).toHaveLength(1);
    expect(output.operations[0].planPathWritten).toBe("");
    expect(result.isError).toBe(true);
  });
});

// ── MAJOR-1: 3-way overlap stale winningCategory rewrite ──
describe("handleReconcile — 3-way overlap conflict audit rewrite", () => {
  it("rewrites stale winningCategory when pairwise winner is later suppressed", async () => {
    await writePlanFiles();
    const base = makeBase();

    // Note 0: ac-drift       — wins pairwise vs note 1, later suppressed by note 2
    // Note 1: partial-completion — loses to note 0 (stale winner)
    // Note 2: assumption-changed — highest precedence, suppresses note 0
    // All three touch US-01.
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
          category: "partial-completion",
          severity: "should-address",
          description: "partial",
          affectedStories: ["US-01"],
          affectedPhases: ["PH-01"],
        },
        {
          category: "assumption-changed",
          severity: "should-address",
          description: "assumption flipped",
          affectedStories: ["US-01"],
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    // conflicts must exist and note 1's winning category must be rewritten
    // to the surviving highest-precedence note (assumption-changed), not "ac-drift"
    const losersByIdx = new Map<number, string>();
    for (const c of output.conflicts) {
      losersByIdx.set(c.noteIndex, c.winningCategory);
    }
    expect(losersByIdx.get(1)).toBe("assumption-changed");
    expect(losersByIdx.get(1)).not.toBe("ac-drift");
    // Note 0 also a loser, correctly recorded
    expect(losersByIdx.get(0)).toBe("assumption-changed");
  });
});

// ── MAJOR-3: half-failed mixed status ──
describe("handleReconcile — mixed success/failure status", () => {
  it("half-failed: first op succeeds, second op fails → status=partial", async () => {
    await writePlanFiles();
    const base = makeBase();

    // First handlePlan call (master route): valid structured response
    // Second handlePlan call (phase route PH-01): missing updatedPlan sidecar
    mockedHandlePlan.mockImplementationOnce(async () => ({
      content: [
        {
          type: "text" as const,
          text:
            "=== UPDATED PLAN ===\n\n" +
            JSON.stringify({ schemaVersion: "3.0.0", stories: [] }, null, 2) +
            "\n\n=== USAGE ===\nTotal tokens: 0 input / 0 output",
        },
      ],
      updatedPlan: { schemaVersion: "3.0.0", stories: [] },
      critiqueRounds: null,
    }));
    mockedHandlePlan.mockImplementationOnce(async () => ({
      content: [{ type: "text" as const, text: "missing sidecar" }],
      // updatedPlan intentionally absent
    }));

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "drift",
        },
        {
          category: "partial-completion",
          severity: "should-address",
          description: "partial",
          affectedPhases: ["PH-01"],
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    expect(output.status).toBe("partial");
    const successful = output.operations.filter(
      (op: { planPathWritten: string }) => op.planPathWritten !== "",
    );
    const failed = output.operations.filter(
      (op: { planPathWritten: string }) => op.planPathWritten === "",
    );
    expect(successful).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(output.errors?.length ?? 0).toBeGreaterThan(0);
  });

  it("all-failed multi-op: 2 ac-drift routes all fail → status=failed", async () => {
    await writePlanFiles();
    const base = makeBase();

    // Both handlePlan calls return responses without the updatedPlan sidecar.
    // ac-drift collapses into a single master-update op (batched), so we only
    // need one bad response to cause total failure with operations.length > 0.
    mockedHandlePlan.mockImplementationOnce(async () => ({
      content: [{ type: "text" as const, text: "missing sidecar 1" }],
      // updatedPlan intentionally absent
    }));

    const result = await handleReconcile({
      ...base,
      replanningNotes: [
        {
          category: "ac-drift",
          severity: "should-address",
          description: "drift 1",
        },
        {
          category: "ac-drift",
          severity: "should-address",
          description: "drift 2",
        },
      ],
    });

    const output = JSON.parse(result.content[0].text);
    expect(output.status).toBe("failed");
    expect(output.operations.length).toBeGreaterThan(0);
    for (const op of output.operations) {
      expect(op.planPathWritten).toBe("");
    }
    expect(output.errors?.length ?? 0).toBeGreaterThan(0);
    expect(output.rewriteCount).toBe(0);
    // No plan files should have been written
    const masterPath = join(TEST_DIR, "master.json");
    const hashAfter = await sha256File(masterPath);
    // master.json had seed content; if it was overwritten it would change
    const seedHash = createHash("sha256")
      .update(JSON.stringify({ seed: "master" }))
      .digest("hex");
    expect(hashAfter).toBe(seedHash);
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
