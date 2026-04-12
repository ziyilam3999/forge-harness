import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

// Import the tool under test + types
import { handleReconcile } from "./reconcile.js";
import { computeReverseFindingId } from "./evaluate.js";
import { handlePlan } from "./plan.js";
import type { ReplanningNote } from "../types/coordinate-result.js";

// Mock handlePlan: returns a stub updated plan. The contrived dogfood is not
// about what handlePlan does — it's about whether reconcile's routing produces
// the correct non-baseline trailer count given real findings regenerated under
// the real hash scheme.
vi.mock("./plan.js", () => ({
  handlePlan: vi.fn(async () => ({
    content: [
      {
        type: "text",
        text: "=== UPDATED PLAN ===\n\n{}\n\n=== USAGE ===\nTotal tokens: 0 input / 0 output",
      },
    ],
    updatedPlan: { schemaVersion: "3.0.0", stories: [] },
    critiqueRounds: null,
  })),
}));

const mockedHandlePlan = vi.mocked(handlePlan);

const REPO_ROOT = join(__dirname, "..", "..");
const FINDINGS_PATH = join(
  REPO_ROOT,
  ".ai-workspace",
  "audits",
  "2026-04-12-reverse-divergence-findings.json",
);
const HASHED_FINDINGS_PATH = join(
  REPO_ROOT,
  ".ai-workspace",
  "audits",
  "2026-04-12-reverse-divergence-findings-hashed.json",
);
const DOGFOOD_OUTPUT_PATH = join(
  REPO_ROOT,
  ".ai-workspace",
  "dogfood",
  "2026-04-13-q0-l6-reconcile-output.json",
);

interface HashedFinding {
  id: string;
  description: string;
  location: string;
  classification: string;
  alignsWithPrd: boolean;
}

// Paths to reconcile's on-disk side effects (cleaned pre-run to keep the
// append-only JSONL from accumulating cruft across CI runs and developer
// clones — addresses cold-review nit 1).
const RECONCILE_AUDIT_JSONL = join(REPO_ROOT, ".forge", "audit", "reconcile-notes.jsonl");
const RECONCILE_OUTPUT_JSON = join(REPO_ROOT, ".forge", "reconcile", "reconcile-output.json");

describe("Q0/L6 contrived reconcile dogfood", () => {
  beforeEach(() => {
    // Clean reconcile's append-only JSONL and output JSON before every run
    // so the test is idempotent regardless of prior runs. Both paths are
    // under .forge/ which is gitignored — cleanup is safe.
    if (existsSync(RECONCILE_AUDIT_JSONL)) rmSync(RECONCILE_AUDIT_JSONL);
    if (existsSync(RECONCILE_OUTPUT_JSON)) rmSync(RECONCILE_OUTPUT_JSON);
    mockedHandlePlan.mockClear();
  });

  it("regenerates REV-NN IDs under the deterministic hash scheme", () => {
    const findings = JSON.parse(readFileSync(FINDINGS_PATH, "utf-8")) as Array<
      Omit<HashedFinding, "id"> & { id: string }
    >;
    expect(findings.length).toBe(7);

    const hashed: HashedFinding[] = findings.map((f) => ({
      ...f,
      id: computeReverseFindingId(f.location, f.classification, f.description),
    }));

    // Lock every new id to the rev-<12hex> format
    for (const f of hashed) {
      expect(f.id).toMatch(/^rev-[a-f0-9]{12}$/);
    }

    // Persist the hashed file (force-added despite .ai-workspace/ gitignore).
    // Deterministic content — safe to rewrite on every CI run.
    writeFileSync(HASHED_FINDINGS_PATH, JSON.stringify(hashed, null, 2) + "\n");

    // REV-03 (alignsWithPrd: false, spec mismatch) — confirm it's the single
    // outlier that must route to master-update.
    const specMismatch = hashed.find((f) => !f.alignsWithPrd);
    expect(specMismatch).toBeDefined();
    expect(specMismatch!.description).toContain("checkTimeBudget");
    expect(hashed.filter((f) => !f.alignsWithPrd).length).toBe(1);
  });

  it("routes the 7 findings through forge_reconcile producing 1 master write + 6 deferred", async () => {
    const hashed = JSON.parse(readFileSync(HASHED_FINDINGS_PATH, "utf-8")) as HashedFinding[];
    expect(hashed.length).toBe(7);

    // Synthesize ReplanningNotes from each finding.
    // REV-03 (alignsWithPrd: false) → "ac-drift" (spec mismatch requires
    //   master-plan reconciliation).
    // All other 6 → "gap-found" (alignsWithPrd: true — capabilities that exist
    //   but weren't planned; structurally deferred to "next planning session"
    //   per plan.md:49-54).
    //
    // NOTE: this ternary is 7-findings-specific. A future finding with
    // alignsWithPrd:false AND classification:"extra-functionality" (extra code
    // that also violates spec) would route to ac-drift here, when
    // assumption-changed might be a better fit. No such finding exists in the
    // current data set; generalize this mapping when the first counterexample
    // appears. Cold-review nit 2.
    const notes: ReplanningNote[] = hashed.map((f) => ({
      category: f.alignsWithPrd === false ? "ac-drift" : "gap-found",
      severity: "should-address",
      affectedStories: [f.id],
      description: `[${f.id}] ${f.location} — ${f.description}`,
    }));

    expect(notes.filter((n) => n.category === "gap-found").length).toBe(6);
    expect(notes.filter((n) => n.category === "ac-drift").length).toBe(1);

    // Reconcile writes audit jsonl + reconcile-output.json under
    // projectPath/.forge/, which is gitignored — safe to use REPO_ROOT.
    const projectPath = REPO_ROOT;

    const result = await handleReconcile({
      projectPath,
      replanningNotes: notes,
      // Placeholder — mocked handlePlan doesn't read this, but reconcile will
      // attempt to write the updated plan to this relative path. Point it at a
      // gitignored location so the on-disk write is harmless.
      masterPlanPath: ".forge/reconcile/q0-l6-master-plan.out.json",
      phasePlanPaths: {},
      currentMasterPlan: "{}",
      currentPhasePlans: {},
    });

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0].text) as {
      status: string;
      operations: Array<{ route: string; noteIds: number[]; planPathWritten: string }>;
      deferredNotes: ReplanningNote[];
      rewriteCount: number;
      haltedOnNoteIndex?: number;
    };

    // Primary dogfood assertions
    expect(output.status).toBe("success");
    expect(output.rewriteCount).toBe(1);
    expect(output.operations.length).toBe(1);
    expect(output.operations[0].route).toBe("master-update");
    expect(output.deferredNotes.length).toBe(6);
    expect(output.haltedOnNoteIndex).toBeUndefined();

    // Cold-review nit 3: assert handlePlan mock was invoked exactly once with
    // documentTier: "update" — locks the contract that reconcile calls the
    // right nested seam, not a future refactor that silently routes elsewhere.
    expect(mockedHandlePlan).toHaveBeenCalledTimes(1);
    expect(mockedHandlePlan).toHaveBeenCalledWith(
      expect.objectContaining({ documentTier: "update" }),
    );

    // Cold-review nit 4: verify the 6 gap-found entries actually landed in the
    // JSONL audit file. The beforeEach cleanup means the file only contains
    // THIS run's entries, so line count is the direct assertion.
    expect(existsSync(RECONCILE_AUDIT_JSONL)).toBe(true);
    const jsonlLines = readFileSync(RECONCILE_AUDIT_JSONL, "utf-8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(jsonlLines.length).toBe(6);
    for (const line of jsonlLines) {
      const entry = JSON.parse(line);
      expect(entry.category).toBe("gap-found");
      expect(entry.deferred).toBe(true);
    }

    // Persist the canonical dogfood output alongside hashed findings. The PR
    // body's non-baseline trailer references this file.
    mkdirSync(dirname(DOGFOOD_OUTPUT_PATH), { recursive: true });
    const dogfoodRecord = {
      runAt: "2026-04-13T15:00:00+08:00",
      inputFindings: {
        path: ".ai-workspace/audits/2026-04-12-reverse-divergence-findings-hashed.json",
        count: hashed.length,
      },
      synthesizedNotes: {
        total: notes.length,
        byCategory: {
          "ac-drift": 1,
          "gap-found": 6,
        },
      },
      reconcileOutput: {
        status: output.status,
        rewriteCount: output.rewriteCount,
        operationsCount: output.operations.length,
        deferredNotesCount: output.deferredNotes.length,
        terminalStateTotal: output.rewriteCount + output.deferredNotes.length,
      },
      trailerLine: `plan-refresh: ${output.rewriteCount} items`,
      dogfoodInterpretation:
        "All 7 findings reached terminal state: 1 routed to plan rewrite, 6 formally deferred via gap-found pre-pass. Zero findings lost. First non-baseline plan-refresh trailer in the history of this repo.",
    };
    writeFileSync(DOGFOOD_OUTPUT_PATH, JSON.stringify(dogfoodRecord, null, 2) + "\n");

    // Sanity: terminal state total must equal input finding count.
    expect(dogfoodRecord.reconcileOutput.terminalStateTotal).toBe(7);
  });
});
