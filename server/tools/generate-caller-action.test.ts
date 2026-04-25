import { describe, it, expect, vi } from "vitest";
import { handleGenerate } from "./generate.js";
import type { ExecutionPlan } from "../types/execution-plan.js";
import type { EvalReport } from "../types/eval-report.js";

// ──────────────────────────────────────────────────────────────────────
// v0.36.0 Phase A — AC-A6
//
// The action discriminator (`implement | fix | pass | escalate`) tells the
// caller WHAT to do. The caller-action discriminator (`callerAction`) tells
// it HOW: spawn a fresh subagent (so main context stays bounded ≤ 2 KB,
// G1) or fall through to inline.
//
// AC-A6 mandates 3 wire-shape tests:
//   1. action=implement → callerAction="spawn-subagent-and-await"
//   2. action=fix       → callerAction="spawn-subagent-and-await"
//   3. action=pass      → callerAction absent
//
// (Backward-compat — AC-A4 — is verified inside /forge-execute, not here.)
// ──────────────────────────────────────────────────────────────────────

vi.mock("../lib/codebase-scan.js", () => ({
  scanCodebase: vi.fn().mockResolvedValue("TypeScript project, 12 files, vitest"),
}));

const PLAN: ExecutionPlan = {
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

const PLAN_JSON = JSON.stringify(PLAN);

const FAIL_REPORT: EvalReport = {
  storyId: "US-01",
  verdict: "FAIL",
  criteria: [
    { id: "AC-01", status: "PASS", evidence: "200 OK" },
    { id: "AC-02", status: "FAIL", evidence: "401 Unauthorized" },
    { id: "AC-03", status: "PASS", evidence: "styled" },
  ],
};

const PASS_REPORT: EvalReport = {
  storyId: "US-01",
  verdict: "PASS",
  criteria: [
    { id: "AC-01", status: "PASS", evidence: "200 OK" },
    { id: "AC-02", status: "PASS", evidence: "token set" },
    { id: "AC-03", status: "PASS", evidence: "styled" },
  ],
};

describe("forge_generate caller-action discriminator (v0.36.0 AC-A6)", () => {
  it("implement action → callerAction=spawn-subagent-and-await", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: PLAN_JSON,
    });

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("implement");
    expect(result.callerAction).toBe("spawn-subagent-and-await");
  });

  it("fix action → callerAction=spawn-subagent-and-await", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: PLAN_JSON,
      evalReport: JSON.stringify(FAIL_REPORT),
      iteration: 1,
      maxIterations: 3,
    });

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("fix");
    expect(result.callerAction).toBe("spawn-subagent-and-await");
  });

  it("pass action → callerAction absent (no caller work needed)", async () => {
    const response = await handleGenerate({
      storyId: "US-01",
      planJson: PLAN_JSON,
      evalReport: JSON.stringify(PASS_REPORT),
      iteration: 1,
      maxIterations: 3,
    });

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.action).toBe("pass");
    expect(result.callerAction).toBeUndefined();
  });
});
