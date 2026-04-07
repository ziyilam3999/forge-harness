import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGenerate } from "./generate.js";
import type { ExecutionPlan } from "../types/execution-plan.js";
import type { EvalReport } from "../types/eval-report.js";

// ── Mock scanCodebase (no real codebase during tests) ──

vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn().mockResolvedValue("TypeScript project, 12 files, vitest"),
}));

// ── Test Fixtures ───────────────────────────────

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

const FAIL_REPORT: EvalReport = {
  storyId: "US-01",
  verdict: "FAIL",
  criteria: [
    { id: "AC-01", status: "PASS", evidence: "200 OK" },
    { id: "AC-02", status: "FAIL", evidence: "401 Unauthorized" },
    { id: "AC-03", status: "PASS", evidence: "styled" },
  ],
};

const FAIL_REPORT_JSON = JSON.stringify(FAIL_REPORT);

// ══════════════════════════════════════════════════
// PH04-US02: handleGenerate wiring
// ══════════════════════════════════════════════════

describe("handleGenerate: init returns implement with brief", () => {
  it("init call returns action implement with GenerationBrief", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
    });

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("implement");
    expect(result.brief).toBeDefined();
    expect(result.brief.story.id).toBe("US-01");
    expect(result.brief.gitBranch).toBe("feat/US-01");
    expect(result.iteration).toBe(0);
    expect(result.maxIterations).toBe(3);
  });
});

describe("handleGenerate: iterate returns fix on FAIL iteration", () => {
  it("fix iteration returns action fix with fixBrief", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: FAIL_REPORT_JSON,
      iteration: 1,
      maxIterations: 3,
      previousScores: [0.5],
    });

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("fix");
    expect(result.fixBrief).toBeDefined();
    expect(result.fixBrief.failedCriteria.length).toBe(1);
    expect(result.fixBrief.failedCriteria[0].id).toBe("AC-02");
  });
});

describe("handleGenerate: escalate when stopping conditions met", () => {
  it("escalates on plateau (3 identical trailing scores)", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: FAIL_REPORT_JSON,
      iteration: 2,
      maxIterations: 5,
      previousScores: [0.5, 0.667, 0.667, 0.667],
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("escalate");
    expect(result.escalation.reason).toBe("plateau");
  });

  it("escalates on max-iterations", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: FAIL_REPORT_JSON,
      iteration: 3,
      maxIterations: 3,
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("escalate");
    expect(result.escalation.reason).toBe("max-iterations");
  });

  it("escalates on INCONCLUSIVE verdict", async () => {
    const inconclusiveReport: EvalReport = {
      storyId: "US-01",
      verdict: "INCONCLUSIVE",
      criteria: [],
    };
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: JSON.stringify(inconclusiveReport),
      iteration: 1,
      maxIterations: 3,
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("escalate");
    expect(result.escalation.reason).toBe("inconclusive");
  });
});

describe("handleGenerate: error when no plan provided", () => {
  it("returns isError when neither planPath nor planJson provided", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
    });

    expect(response.isError).toBe(true);
    const body = JSON.parse(response.content[0].text);
    expect(body.error).toContain("planJson");
    expect(body.error).toContain("planPath");
  });
});

// ══════════════════════════════════════════════════
// PH04-US03: Integration tests — full cycle + NFRs
// ══════════════════════════════════════════════════

describe("integration: full init → fix → escalate cycle", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-gen-integ-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("full cycle: init → fix → escalate (plateau after 3 identical scores)", async () => {
    // Step 1: Init
    const initResponse = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      projectPath: tempDir,
    });
    const initResult = JSON.parse(initResponse.content[0].text);
    expect(initResult.action).toBe("implement");
    expect(initResult.brief.story.id).toBe("US-01");

    // Step 2: First fix iteration (score = 0.667)
    const fix1Response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: FAIL_REPORT_JSON,
      iteration: 1,
      maxIterations: 3,
      previousScores: [0.667],
      projectPath: tempDir,
    });
    const fix1Result = JSON.parse(fix1Response.content[0].text);
    expect(fix1Result.action).toBe("fix");

    // Step 3: Second fix iteration — same score (plateau starts)
    const fix2Response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: FAIL_REPORT_JSON,
      iteration: 2,
      maxIterations: 3,
      previousScores: [0.667, 0.667, 0.667],
      projectPath: tempDir,
    });
    const fix2Result = JSON.parse(fix2Response.content[0].text);
    expect(fix2Result.action).toBe("escalate");
    expect(fix2Result.escalation.reason).toBe("plateau");
    expect(fix2Result.escalation.scoreHistory).toEqual([0.667, 0.667, 0.667]);

    // Verify JSONL tracking recorded all 3 calls
    const jsonlPath = join(tempDir, ".forge", "runs", "data.jsonl");
    const jsonlContent = await readFile(jsonlPath, "utf-8");
    const lines = jsonlContent.trim().split("\n");
    expect(lines.length).toBe(3);

    const records = lines.map((l) => JSON.parse(l));
    expect(records[0].action).toBe("implement");
    expect(records[1].action).toBe("fix");
    expect(records[2].action).toBe("escalate");
  });
});

// ── NFR-01: Zero callClaude imports ─────────────

describe("NFR-01: zero callClaude in forge_generate dependency chain", () => {
  it("generate.ts does not import callClaude", async () => {
    const content = await readFile(
      join(process.cwd(), "server", "tools", "generate.ts"),
      "utf-8",
    );
    expect(content).not.toContain("callClaude");
  });

  it("generator.ts does not import callClaude", async () => {
    const content = await readFile(
      join(process.cwd(), "server", "lib", "generator.ts"),
      "utf-8",
    );
    expect(content).not.toContain("callClaude");
  });

  it("plan-loader.ts does not import callClaude", async () => {
    const content = await readFile(
      join(process.cwd(), "server", "lib", "plan-loader.ts"),
      "utf-8",
    );
    expect(content).not.toContain("callClaude");
  });

  it("generate-result.ts does not import callClaude", async () => {
    const content = await readFile(
      join(process.cwd(), "server", "types", "generate-result.ts"),
      "utf-8",
    );
    expect(content).not.toContain("callClaude");
  });
});

// ── NFR-02: Response time ───────────────────────

describe("NFR-02: response time under 5 seconds for init", () => {
  it("init call completes in under 5 seconds", async () => {
    const start = performance.now();
    await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});

describe("NFR-02: iteration response time under 2 seconds for fix", () => {
  it("iteration call completes in under 2 seconds", async () => {
    const start = performance.now();
    await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: FAIL_REPORT_JSON,
      iteration: 1,
      maxIterations: 3,
      previousScores: [0.5],
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

// ── NFR-03: Windows path safety ─────────────────

describe("NFR-03: Windows path safety — no colons in filenames", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-gen-win-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("JSONL and audit filenames contain no colons", async () => {
    await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      projectPath: tempDir,
    });

    // Check JSONL path
    const runsDir = join(tempDir, ".forge", "runs");
    const runFiles = await readdir(runsDir);
    for (const f of runFiles) {
      expect(f).not.toContain(":");
    }

    // Check audit path
    const auditDir = join(tempDir, ".forge", "audit");
    const auditFiles = await readdir(auditDir);
    for (const f of auditFiles) {
      expect(f).not.toContain(":");
    }
  });
});

// ── NFR-04: Read-only (no project file mutations) ──

describe("NFR-04: read-only — no project file mutations", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "forge-gen-ro-"));
    // Write a plan file and a source file to verify they aren't modified
    await writeFile(
      join(tempDir, "execution-plan.json"),
      VALID_PLAN_JSON,
      "utf-8",
    );
    await writeFile(join(tempDir, "src.ts"), "const x = 1;", "utf-8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("forge_generate does not modify execution plan or project source files", async () => {
    const planBefore = await readFile(
      join(tempDir, "execution-plan.json"),
      "utf-8",
    );
    const srcBefore = await readFile(join(tempDir, "src.ts"), "utf-8");

    await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      projectPath: tempDir,
    });

    const planAfter = await readFile(
      join(tempDir, "execution-plan.json"),
      "utf-8",
    );
    const srcAfter = await readFile(join(tempDir, "src.ts"), "utf-8");

    expect(planAfter).toBe(planBefore);
    expect(srcAfter).toBe(srcBefore);
  });

  it("forge_generate is idempotent — same input produces same output structure", async () => {
    const input = {
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
    };
    const r1 = JSON.parse((await handleGenerate(input)).content[0].text);
    const r2 = JSON.parse((await handleGenerate(input)).content[0].text);

    expect(r1.action).toBe(r2.action);
    expect(r1.brief.story.id).toBe(r2.brief.story.id);
    expect(r1.brief.gitBranch).toBe(r2.brief.gitBranch);
  });
});

// ── NFR-06: schemaVersion 3.0.0 compatibility ──

describe("NFR-06: schema compatibility with schemaVersion 3.0.0", () => {
  it("accepts execution plan with schemaVersion 3.0.0", async () => {
    const plan: ExecutionPlan = {
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "Test",
          acceptanceCriteria: [
            { id: "AC-01", description: "test", command: "echo ok" },
          ],
        },
      ],
    };
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: JSON.stringify(plan),
    });

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("implement");
  });

  it("accepts plan with all optional fields (baselineCheck, lineage, documentTier, phaseId)", async () => {
    const plan: ExecutionPlan = {
      schemaVersion: "3.0.0",
      documentTier: "phase",
      phaseId: "PH-01",
      baselineCheck: "npm test",
      stories: [
        {
          id: "US-01",
          title: "Test",
          acceptanceCriteria: [
            { id: "AC-01", description: "test", command: "echo ok" },
          ],
          lineage: { tier: "phase-plan", sourceId: "PH-01" },
          dependencies: [],
          affectedPaths: ["server/"],
        },
      ],
    };
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: JSON.stringify(plan),
    });

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.brief.baselineCheck).toBe("npm test");
    expect(result.brief.lineage).toEqual({ tier: "phase-plan", sourceId: "PH-01" });
  });
});

// ── Document context forwarding ─────────────────

describe("handleGenerate: document context forwarding", () => {
  it("three-tier document inputs appear in brief.documentContext", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      prdContent: "PRD content",
      masterPlanContent: "Master plan content",
      phasePlanContent: "Phase plan content",
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.brief.documentContext).toEqual({
      prdContent: "PRD content",
      masterPlanContent: "Master plan content",
      phasePlanContent: "Phase plan content",
    });
  });

  it("costEstimate is present in response", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.costEstimate).toBeDefined();
    expect(result.costEstimate.briefTokens).toBeGreaterThan(0);
  });
});

// ── Error handling ──────────────────────────────

describe("handleGenerate: error handling", () => {
  it("returns isError for invalid planJson", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: "not-valid-json{{{",
    });

    expect(response.isError).toBe(true);
  });

  it("returns isError for non-existent storyId", async () => {
    const response = await handleGenerate({
      storyId: "US-99",
      planJson: VALID_PLAN_JSON,
    });

    expect(response.isError).toBe(true);
    const body = JSON.parse(response.content[0].text);
    expect(body.error).toContain("US-99");
  });

  it("returns isError for invalid evalReport JSON", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: VALID_PLAN_JSON,
      evalReport: "not-valid-json",
    });

    expect(response.isError).toBe(true);
  });
});
