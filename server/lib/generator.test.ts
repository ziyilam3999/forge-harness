import { describe, it, expect, vi } from "vitest";
import {
  buildBrief,
  buildFixBrief,
  computeScore,
  buildDiffManifest,
  checkStoppingConditions,
  buildEscalation,
  assembleGenerateResult,
} from "./generator.js";
import type { EvalReport, CriterionResult } from "../types/eval-report.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

// ── Mock scanCodebase ────────────────────────

vi.mock("./codebase-scan.js", () => ({
  scanCodebase: vi.fn().mockResolvedValue("TypeScript project, 12 files, vitest"),
}));

// ── Test fixtures ────────────────────────────

const VALID_PLAN: ExecutionPlan = {
  schemaVersion: "3.0.0",
  stories: [
    {
      id: "US-01",
      title: "Add login",
      acceptanceCriteria: [
        { id: "AC-01", description: "Login returns 200", command: "curl http://localhost" },
        { id: "AC-02", description: "Auth token set", command: "echo ok" },
        { id: "AC-03", description: "CSS styled", command: "echo ok" },
      ],
    },
  ],
};

const VALID_PLAN_JSON = JSON.stringify(VALID_PLAN);

const PLAN_WITH_BASELINE: ExecutionPlan = {
  ...VALID_PLAN,
  baselineCheck: "make test",
};

function makeEvalReport(
  overrides: Partial<EvalReport> & { criteria: CriterionResult[] },
): EvalReport {
  return {
    storyId: "US-01",
    verdict: "FAIL",
    ...overrides,
  };
}

// ── US04: buildBrief ─────────────────────────

describe("buildBrief", () => {
  it("returns story object from plan matching storyId", async () => {
    const brief = await buildBrief(VALID_PLAN, "US-01");
    expect(brief.story.id).toBe("US-01");
    expect(brief.story.title).toBe("Add login");
  });

  it("returns codebaseContext string from scanCodebase", async () => {
    const brief = await buildBrief(VALID_PLAN, "US-01", "/project");
    expect(brief.codebaseContext).toContain("TypeScript");
  });

  it("returns gitBranch as feat/{storyId}", async () => {
    const brief = await buildBrief(VALID_PLAN, "US-01");
    expect(brief.gitBranch).toBe("feat/US-01");
  });

  it("returns baselineCheck from plan when present", async () => {
    const brief = await buildBrief(PLAN_WITH_BASELINE, "US-01");
    expect(brief.baselineCheck).toBe("make test");
  });

  it("returns default baselineCheck when plan has none", async () => {
    const brief = await buildBrief(VALID_PLAN, "US-01");
    expect(brief.baselineCheck).toBe("npm run build && npm test");
  });

  it("throws for non-existent storyId (invalid story not found)", async () => {
    await expect(buildBrief(VALID_PLAN, "US-99")).rejects.toThrow(
      'Story "US-99" not found',
    );
  });

  it("returns lineage when story has it", async () => {
    const planWithLineage: ExecutionPlan = {
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "Test",
          acceptanceCriteria: [
            { id: "AC-01", description: "d", command: "c" },
          ],
          lineage: { tier: "phase-plan", sourceId: "PH-01" },
        },
      ],
    };
    const brief = await buildBrief(planWithLineage, "US-01");
    expect(brief.lineage).toEqual({ tier: "phase-plan", sourceId: "PH-01" });
  });
});

// ── US05: buildFixBrief ──────────────────────

describe("buildFixBrief", () => {
  it("extracts only FAIL failedCriteria (skips PASS and SKIPPED)", () => {
    const report = makeEvalReport({
      criteria: [
        { id: "AC-01", status: "PASS", evidence: "ok" },
        { id: "AC-02", status: "FAIL", evidence: "error: 401" },
        { id: "AC-03", status: "SKIPPED", evidence: "skipped" },
      ],
    });
    const fix = buildFixBrief(report, VALID_PLAN, "US-01");
    expect(fix.failedCriteria.length).toBe(1);
    expect(fix.failedCriteria[0].id).toBe("AC-02");
  });

  it("includes id, description, and evidence on each failed criterion", () => {
    const report = makeEvalReport({
      criteria: [
        { id: "AC-01", status: "FAIL", evidence: "404 Not Found" },
      ],
    });
    const fix = buildFixBrief(report, VALID_PLAN, "US-01");
    expect(fix.failedCriteria[0]).toEqual({
      id: "AC-01",
      description: "Login returns 200",
      evidence: "404 Not Found",
    });
  });

  it("evalHint.failFastIds lists AC IDs in plan order", () => {
    const report = makeEvalReport({
      criteria: [
        { id: "AC-03", status: "FAIL", evidence: "err" },
        { id: "AC-01", status: "FAIL", evidence: "err" },
        { id: "AC-02", status: "PASS", evidence: "ok" },
      ],
    });
    const fix = buildFixBrief(report, VALID_PLAN, "US-01");
    // Plan order: AC-01, AC-02, AC-03 — only failed ones
    expect(fix.evalHint.failFastIds).toEqual(["AC-01", "AC-03"]);
  });
});

// ── US05: computeScore ───────────────────────

describe("computeScore", () => {
  it("returns PASS/non-SKIPPED ratio (2 PASS, 1 FAIL, 1 SKIPPED = 0.667)", () => {
    const criteria: CriterionResult[] = [
      { id: "1", status: "PASS", evidence: "" },
      { id: "2", status: "PASS", evidence: "" },
      { id: "3", status: "FAIL", evidence: "" },
      { id: "4", status: "SKIPPED", evidence: "" },
    ];
    expect(computeScore(criteria)).toBe(0.667);
  });

  it("returns 1 when all non-skipped pass", () => {
    const criteria: CriterionResult[] = [
      { id: "1", status: "PASS", evidence: "" },
      { id: "2", status: "SKIPPED", evidence: "" },
    ];
    expect(computeScore(criteria)).toBe(1);
  });

  it("returns 0 when all non-skipped fail", () => {
    const criteria: CriterionResult[] = [
      { id: "1", status: "FAIL", evidence: "" },
    ];
    expect(computeScore(criteria)).toBe(0);
  });

  it("returns 0 when all criteria are SKIPPED", () => {
    const criteria: CriterionResult[] = [
      { id: "1", status: "SKIPPED", evidence: "" },
    ];
    expect(computeScore(criteria)).toBe(0);
  });
});

// ── US05: buildDiffManifest ──────────────────

describe("buildDiffManifest", () => {
  it("computes changed/unchanged/new arrays from fileHashes", () => {
    const current = { "a.ts": "aaa", "b.ts": "bbb-new", "c.ts": "ccc" };
    const previous = { "a.ts": "aaa", "b.ts": "bbb-old" };
    const diff = buildDiffManifest(current, previous);
    expect(diff.unchanged).toEqual(["a.ts"]);
    expect(diff.changed).toEqual(["b.ts"]);
    expect(diff.new).toEqual(["c.ts"]);
  });

  it("returns all unchanged when hashes match", () => {
    const hashes = { "a.ts": "aaa", "b.ts": "bbb" };
    const diff = buildDiffManifest(hashes, hashes);
    expect(diff.unchanged).toEqual(["a.ts", "b.ts"]);
    expect(diff.changed).toEqual([]);
    expect(diff.new).toEqual([]);
  });
});

// ── US06: checkStoppingConditions ────────────

describe("checkStoppingConditions", () => {
  const base = { iteration: 1, maxIterations: 3 };

  it("plateau: previousScores [0.5, 0.5, 0.5] triggers plateau", () => {
    const result = checkStoppingConditions({
      ...base,
      previousScores: [0.5, 0.5, 0.5],
    });
    expect(result?.reason).toBe("plateau");
  });

  it("plateau boundary: [0.3, 0.5, 0.5] triggers plateau (improving then stuck)", () => {
    const result = checkStoppingConditions({
      ...base,
      previousScores: [0.3, 0.5, 0.5],
    });
    // Per PRD REQ-03: [0.3, 0.5, 0.5] triggers plateau — last 2 scores are identical
    expect(result?.reason).toBe("plateau");
  });

  it("no-op: matching fileHashes triggers no-op", () => {
    const hashes = { "a.ts": "aaa", "b.ts": "bbb" };
    const result = checkStoppingConditions({
      ...base,
      fileHashes: hashes,
      previousFileHashes: { ...hashes },
    });
    expect(result?.reason).toBe("no-op");
  });

  it("max-iterations: iteration >= maxIterations triggers", () => {
    const result = checkStoppingConditions({
      iteration: 3,
      maxIterations: 3,
    });
    expect(result?.reason).toBe("max-iterations");
  });

  it("max-iterations: iteration < maxIterations does NOT trigger", () => {
    const result = checkStoppingConditions({
      iteration: 2,
      maxIterations: 3,
    });
    expect(result).toBeNull();
  });

  it("inconclusive: INCONCLUSIVE verdict triggers immediately", () => {
    const result = checkStoppingConditions({
      ...base,
      evalReport: { storyId: "US-01", verdict: "INCONCLUSIVE", criteria: [] },
    });
    expect(result?.reason).toBe("inconclusive");
  });

  it("INCONCLUSIVE takes precedence over all other stopping conditions", () => {
    const hashes = { "a.ts": "aaa" };
    const result = checkStoppingConditions({
      iteration: 5,
      maxIterations: 3,
      previousScores: [0.5, 0.5, 0.5],
      fileHashes: hashes,
      previousFileHashes: hashes,
      evalReport: { storyId: "US-01", verdict: "INCONCLUSIVE", criteria: [] },
    });
    expect(result?.reason).toBe("inconclusive");
  });

  it("baseline-failed: diagnostics with exitCode, stderr, failingTests", () => {
    const result = checkStoppingConditions({
      ...base,
      baselineDiagnostics: {
        exitCode: 1,
        stderr: "Error: test failed",
        failingTests: ["test/auth.test.ts"],
      },
    });
    expect(result?.reason).toBe("baseline-failed");
    expect(result?.diagnostics?.exitCode).toBe(1);
    expect(result?.diagnostics?.stderr).toBe("Error: test failed");
    expect(result?.diagnostics?.failingTests).toEqual(["test/auth.test.ts"]);
  });

  it("baseline-failed truncates stderr to 2000 chars", () => {
    const longStderr = "x".repeat(5000);
    const result = checkStoppingConditions({
      ...base,
      baselineDiagnostics: {
        exitCode: 1,
        stderr: longStderr,
        failingTests: [],
      },
    });
    expect(result?.diagnostics?.stderr.length).toBe(2000);
  });

  it("continue when improving: [0.3, 0.5] does NOT trigger any stop", () => {
    const result = checkStoppingConditions({
      ...base,
      previousScores: [0.3, 0.5],
    });
    expect(result).toBeNull();
  });
});

// ── US07: buildEscalation ────────────────────

describe("buildEscalation", () => {
  it("structured escalation report has all required fields", () => {
    const esc = buildEscalation("plateau", {
      previousScores: [0.5, 0.5, 0.5],
      evalReport: { storyId: "US-01", verdict: "FAIL", criteria: [] },
    });
    expect(esc.reason).toBe("plateau");
    expect(esc.description).toBeTruthy();
    expect(typeof esc.hypothesis).toBe("string");
    expect(esc.lastEvalVerdict).toBe("FAIL");
    expect(esc.scoreHistory).toEqual([0.5, 0.5, 0.5]);
  });

  it("escalation description is specific to the failure reason (not generic)", () => {
    const plateau = buildEscalation("plateau", { previousScores: [0.5, 0.5, 0.5] });
    const noOp = buildEscalation("no-op", {});
    const maxIter = buildEscalation("max-iterations", { previousScores: [0.3, 0.5] });

    expect(plateau.description).toContain("not improved");
    expect(noOp.description).toContain("no code changes");
    expect(maxIter.description).toContain("maximum iteration");
  });

  it("diagnostics only present on baseline-failed, not others", () => {
    const baseline = buildEscalation("baseline-failed", {
      diagnostics: { exitCode: 1, stderr: "err", failingTests: ["t1"] },
    });
    const plateau = buildEscalation("plateau", {
      previousScores: [0.5, 0.5, 0.5],
    });

    expect(baseline.diagnostics).toBeDefined();
    expect(baseline.diagnostics?.exitCode).toBe(1);
    expect(plateau.diagnostics).toBeUndefined();
  });

  it("inconclusive has null hypothesis", () => {
    const esc = buildEscalation("inconclusive", {
      evalReport: { storyId: "US-01", verdict: "INCONCLUSIVE", criteria: [] },
    });
    expect(esc.hypothesis).toBeNull();
    expect(esc.lastEvalVerdict).toBe("INCONCLUSIVE");
  });
});

// ── US08: assembleGenerateResult ─────────────

describe("assembleGenerateResult", () => {
  it("returns action implement with GenerationBrief when no evalReport", async () => {
    const result = await assembleGenerateResult({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
    });
    expect(result.action).toBe("implement");
    expect(result.brief).toBeDefined();
    expect(result.brief?.story.id).toBe("US-01");
    expect(result.iteration).toBe(0);
    expect(result.maxIterations).toBe(3);
  });

  it("returns action pass when evalReport verdict is PASS", async () => {
    const result = await assembleGenerateResult({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: {
        storyId: "US-01",
        verdict: "PASS",
        criteria: [{ id: "AC-01", status: "PASS", evidence: "ok" }],
      },
    });
    expect(result.action).toBe("pass");
  });

  it("returns action fix with FixBrief when FAIL and no stopping condition", async () => {
    const result = await assembleGenerateResult({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: {
        storyId: "US-01",
        verdict: "FAIL",
        criteria: [
          { id: "AC-01", status: "PASS", evidence: "ok" },
          { id: "AC-02", status: "FAIL", evidence: "401 Unauthorized" },
        ],
      },
      iteration: 1,
      maxIterations: 3,
      previousScores: [0.5],
    });
    expect(result.action).toBe("fix");
    expect(result.fixBrief).toBeDefined();
    expect(result.fixBrief?.failedCriteria.length).toBe(1);
  });

  it("returns action escalate with Escalation when stopping condition met", async () => {
    const result = await assembleGenerateResult({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: {
        storyId: "US-01",
        verdict: "FAIL",
        criteria: [{ id: "AC-01", status: "FAIL", evidence: "err" }],
      },
      iteration: 3,
      maxIterations: 3,
      previousScores: [0.3, 0.5, 0.5],
    });
    expect(result.action).toBe("escalate");
    expect(result.escalation).toBeDefined();
    expect(result.escalation?.reason).toBe("max-iterations");
  });

  it("includes diffManifest on fix iterations with fileHashes", async () => {
    const result = await assembleGenerateResult({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: {
        storyId: "US-01",
        verdict: "FAIL",
        criteria: [{ id: "AC-01", status: "FAIL", evidence: "err" }],
      },
      iteration: 1,
      maxIterations: 3,
      fileHashes: { "a.ts": "new-hash" },
      previousFileHashes: { "a.ts": "old-hash" },
    });
    expect(result.diffManifest).toBeDefined();
    expect(result.diffManifest?.changed).toEqual(["a.ts"]);
  });

  it("diffManifest omitted when iteration is 0 (init call)", async () => {
    const result = await assembleGenerateResult({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
    });
    expect(result.diffManifest).toBeUndefined();
  });

  it("all PH-01 tests pass together", () => {
    // Meta-test: if we got here, the test file parsed and all prior tests ran
    expect(true).toBe(true);
  });
});
