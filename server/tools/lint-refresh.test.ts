/**
 * Q0.5/A3-bis — lint-refresh tool tests.
 * Covers AC-bis-05..09.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runLintRefresh } from "./lint-refresh.js";
import { getAcLintRulesHash } from "../lib/prompts/shared/ac-subprocess-rules.js";
import type { ExecutionPlan } from "../types/execution-plan.js";
import type { LintAuditEntry } from "../types/lint-audit.js";
import { computePlanSlug } from "../lib/lint-audit.js";

let tempDir: string;
let plansDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forge-lint-refresh-test-"));
  plansDir = join(tempDir, ".ai-workspace", "plans");
  await mkdir(plansDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writePlanFile(name: string, plan: ExecutionPlan): Promise<string> {
  const path = join(plansDir, name);
  await writeFile(path, JSON.stringify(plan), "utf-8");
  return path;
}

function auditPathFor(planPath: string): string {
  return join(
    tempDir,
    ".ai-workspace",
    "lint-audit",
    `${computePlanSlug(planPath)}.audit.json`,
  );
}

const cleanPlan = (): ExecutionPlan =>
  ({
    schemaVersion: "3.0.0",
    stories: [
      {
        id: "US-01",
        title: "Clean plan — no exemptions",
        acceptanceCriteria: [
          { id: "AC01", description: "Happy path", command: "echo ok" },
        ],
      },
    ],
  }) as unknown as ExecutionPlan;

const exemptPlan = (): ExecutionPlan =>
  ({
    schemaVersion: "3.0.0",
    lintExempt: [
      {
        scope: "plan",
        rules: ["F36-source-tree-grep"],
        batch: ["AC02"],
        rationale: "bootstrap absorption — auth-module source greps grandfathered in",
      },
    ],
    stories: [
      {
        id: "US-01",
        title: "Plan with per-AC + plan-level exemptions",
        acceptanceCriteria: [
          {
            id: "AC01",
            description: "Per-AC exempt",
            command: "grep -rn 'Redis' src/",
            lintExempt: {
              ruleId: "F36-source-tree-grep",
              rationale: "legacy cache probe pending migration",
            },
          },
          {
            id: "AC02",
            description: "Plan-level exempt",
            command: "grep -rn 'AuthService' server/auth/",
          },
        ],
      },
    ],
  }) as unknown as ExecutionPlan;

describe("runLintRefresh — AC-bis-05..09", () => {
  it("AC-bis-05: clean plan returns triggered:false and writes baseline audit", async () => {
    const planPath = await writePlanFile("clean.json", cleanPlan());
    const report = await runLintRefresh(planPath, { projectPath: tempDir });

    expect(report.triggered).toBe(false);
    expect(report.triggerReason).toBe("none");
    expect(report.staleEntries).toEqual([]);

    const auditRaw = await readFile(auditPathFor(planPath), "utf-8");
    const entry = JSON.parse(auditRaw) as LintAuditEntry;
    expect(entry.perAcExemptCount).toBe(0);
    expect(entry.planLevelExemptCount).toBe(0);
    expect(entry.ruleHash).toBe(getAcLintRulesHash());
  });

  it("AC-bis-06: first-run on exempt plan drifts with rule-change reason + counts both scopes", async () => {
    const planPath = await writePlanFile("exempt.json", exemptPlan());
    const report = await runLintRefresh(planPath, { projectPath: tempDir });

    expect(report.triggered).toBe(true);
    expect(report.triggerReason).toBe("rule-change");

    const auditRaw = await readFile(auditPathFor(planPath), "utf-8");
    const entry = JSON.parse(auditRaw) as LintAuditEntry;
    expect(entry.perAcExemptCount).toBe(1);
    expect(entry.planLevelExemptCount).toBe(1);
  });

  it("AC-bis-07: re-running immediately returns triggered:false", async () => {
    const planPath = await writePlanFile("exempt.json", exemptPlan());
    await runLintRefresh(planPath, { projectPath: tempDir });
    const second = await runLintRefresh(planPath, { projectPath: tempDir });

    expect(second.triggered).toBe(false);
    expect(second.triggerReason).toBe("none");
  });

  it("AC-bis-08: mutating lastAuditedAt to 15 days ago triggers 14d-elapsed", async () => {
    const planPath = await writePlanFile("exempt.json", exemptPlan());
    await runLintRefresh(planPath, { projectPath: tempDir });

    // Hand-edit the audit file to push lastAuditedAt back 15 days.
    const auditPath = auditPathFor(planPath);
    const entry = JSON.parse(await readFile(auditPath, "utf-8")) as LintAuditEntry;
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86_400 * 1000).toISOString();
    entry.lastAuditedAt = fifteenDaysAgo;
    await writeFile(auditPath, JSON.stringify(entry), "utf-8");

    const report = await runLintRefresh(planPath, { projectPath: tempDir });
    expect(report.triggered).toBe(true);
    expect(report.triggerReason).toBe("14d-elapsed");
  });

  it("AC-bis-09: re-lint actually re-runs lintAcCommand without the exemption — findings reach the report", async () => {
    const planPath = await writePlanFile("exempt.json", exemptPlan());
    const report = await runLintRefresh(planPath, { projectPath: tempDir });

    // Per-AC exemption entry must surface the F36 finding that the exemption
    // would normally suppress (exempt flag stripped).
    const perAcEntry = report.staleEntries.find(
      (e) => e.scope === "per-ac" && e.exemptionId === "AC01:F36-source-tree-grep",
    );
    expect(perAcEntry).toBeDefined();
    expect(perAcEntry!.currentFindings.length).toBeGreaterThan(0);
    expect(perAcEntry!.currentFindings[0]).toContain("F36-source-tree-grep");
    // #199: exemption that still matches a rule is NOT obsolete.
    expect(perAcEntry!.isObsolete).toBe(false);

    // Plan-level exemption entry must surface the AC02 finding.
    const planEntry = report.staleEntries.find((e) => e.scope === "plan-level");
    expect(planEntry).toBeDefined();
    expect(planEntry!.currentFindings.some((f) => f.startsWith("AC02"))).toBe(true);
  });

  it("AC-bis-polish-01 (#198): force:true on a fresh audit labels reason 'forced', not 'rule-change'", async () => {
    const planPath = await writePlanFile("exempt.json", exemptPlan());
    // Establish a fresh baseline audit first.
    await runLintRefresh(planPath, { projectPath: tempDir });

    // Force-refresh immediately — audit is fresh, so isStale returns null,
    // and the force branch must label the refresh "forced" instead of
    // reporting a bogus "rule-change".
    const forced = await runLintRefresh(planPath, {
      projectPath: tempDir,
      force: true,
    });
    expect(forced.triggered).toBe(true);
    expect(forced.triggerReason).toBe("forced");
  });

  it("AC-bis-polish-02 (#199): exemption with zero current findings is flagged isObsolete:true", async () => {
    // Per-AC exemption that does NOT trip any current rule — safe to drop.
    const plan = {
      schemaVersion: "3.0.0",
      stories: [
        {
          id: "US-01",
          title: "Obsolete exemption",
          acceptanceCriteria: [
            {
              id: "AC01",
              description: "Harmless command still exempted",
              command: "echo ok",
              lintExempt: {
                ruleId: "F36-source-tree-grep",
                rationale: "once upon a time this used grep",
              },
            },
          ],
        },
      ],
    } as unknown as ExecutionPlan;

    const planPath = await writePlanFile("obsolete.json", plan);
    const report = await runLintRefresh(planPath, { projectPath: tempDir });

    const entry = report.staleEntries.find(
      (e) => e.exemptionId === "AC01:F36-source-tree-grep",
    );
    expect(entry).toBeDefined();
    expect(entry!.currentFindings).toEqual([]);
    expect(entry!.isObsolete).toBe(true);
  });
});
