/**
 * Q0.5/A3-bis — forge_lint_refresh tool.
 *
 * Pure re-validation pass over every `lintExempt` entry in an execution plan:
 * - Compares the stored rule-surface hash against the current one
 * - Flags entries older than 14 days even when the hash matches
 * - Re-runs `lintAcCommand` against each exempt AC *without* its exemption and
 *   collects current findings so a human can decide whether the override is
 *   still warranted
 *
 * Does NOT mutate the plan. Writes the fresh audit record only when the
 * refresh actually fires.
 */

import { z } from "zod";
import { dirname, isAbsolute, resolve } from "node:path";

import { loadPlan } from "../lib/plan-loader.js";
import { lintAcCommand } from "../validation/ac-lint.js";
import { getAcLintRulesHash } from "../lib/prompts/shared/ac-subprocess-rules.js";
import {
  computePlanSlug,
  isStale,
  loadAudit,
  writeAudit,
} from "../lib/lint-audit.js";
import type {
  LintAuditEntry,
  LintRefreshReport,
  LintRefreshStaleEntry,
  LintRefreshTriggerReason,
} from "../types/lint-audit.js";
import type {
  AcceptanceCriterion,
  ExecutionPlan,
  Story,
} from "../types/execution-plan.js";

// ── Input schema ──────────────────────────────────────────

export const lintRefreshInputSchema = {
  planPath: z
    .string()
    .describe("Path to execution plan JSON file"),
  force: z
    .boolean()
    .optional()
    .describe(
      "When true, skip the staleness check and always re-lint. Default false.",
    ),
  projectPath: z
    .string()
    .optional()
    .describe(
      "Project root for .ai-workspace/lint-audit/ persistence. Defaults to the plan file's ancestor (two dirs up from planPath).",
    ),
  now: z
    .string()
    .optional()
    .describe("ISO-8601 override for 'current time' — test hook."),
};

export interface LintRefreshInput {
  planPath: string;
  force?: boolean;
  projectPath?: string;
  now?: string;
}

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Helpers ──────────────────────────────────────────────

/** Default project root = the directory containing `.ai-workspace/plans/` */
function defaultProjectPath(planPath: string): string {
  const abs = isAbsolute(planPath) ? planPath : resolve(planPath);
  // planPath = <root>/.ai-workspace/plans/<file>.json → go up two levels
  return resolve(dirname(abs), "..", "..");
}

function allAcs(plan: ExecutionPlan): Array<{ story: Story; ac: AcceptanceCriterion }> {
  const out: Array<{ story: Story; ac: AcceptanceCriterion }> = [];
  for (const story of plan.stories) {
    for (const ac of story.acceptanceCriteria ?? []) {
      out.push({ story, ac });
    }
  }
  return out;
}

function countExemptions(plan: ExecutionPlan): {
  perAc: number;
  planLevel: number;
} {
  let perAc = 0;
  for (const { ac } of allAcs(plan)) {
    if (!ac.lintExempt) continue;
    const arr = Array.isArray(ac.lintExempt) ? ac.lintExempt : [ac.lintExempt];
    perAc += arr.length;
  }
  const planLevel = plan.lintExempt?.length ?? 0;
  return { perAc, planLevel };
}

function collectStaleEntries(plan: ExecutionPlan): LintRefreshStaleEntry[] {
  const out: LintRefreshStaleEntry[] = [];

  // Per-AC exemptions: re-lint without the exemption and capture raw findings.
  for (const { ac } of allAcs(plan)) {
    if (!ac.lintExempt) continue;
    const result = lintAcCommand(ac.command);
    const exemptArr = Array.isArray(ac.lintExempt) ? ac.lintExempt : [ac.lintExempt];
    for (const exempt of exemptArr) {
      out.push({
        exemptionId: `${ac.id}:${exempt.ruleId}`,
        scope: "per-ac",
        rationale: exempt.rationale ?? "",
        currentFindings: result.findings
          .filter((f) => f.ruleId === exempt.ruleId)
          .map((f) => `${f.ruleId}: ${f.snippet}`),
      });
    }
  }

  // Plan-level exemptions: bootstrap-absorption entries. Re-lint every AC in
  // the matching batch against the exempted rules *without* the absorption.
  for (const planExempt of plan.lintExempt ?? []) {
    const batchSet = new Set(planExempt.batch);
    const rulesSet = new Set(planExempt.rules);
    const findings: string[] = [];
    for (const { ac } of allAcs(plan)) {
      if (!batchSet.has(ac.id)) continue;
      const result = lintAcCommand(ac.command);
      for (const f of result.findings) {
        if (rulesSet.has(f.ruleId)) {
          findings.push(`${ac.id} · ${f.ruleId}: ${f.snippet}`);
        }
      }
    }
    out.push({
      exemptionId: `plan:${planExempt.rules.join(",")}`,
      scope: "plan-level",
      rationale: planExempt.rationale,
      currentFindings: findings,
    });
  }

  return out;
}

// ── Core ─────────────────────────────────────────────────

/**
 * Pure functional entry point — reused by `server/tools/plan.ts`'s
 * `documentTier: "update"` hook. Any thrown error is the caller's to catch
 * (the hook wraps this in try/catch so plan-update never blocks on refresh).
 */
export async function runLintRefresh(
  planPath: string,
  opts: {
    force?: boolean;
    projectPath?: string;
    now?: Date;
    /**
     * Pre-loaded plan to audit instead of reading `planPath` from disk. Used
     * by `plan.ts`'s `documentTier: "update"` hook so the refresh sees the
     * freshly-revised plan in memory rather than the stale on-disk copy.
     * The `planPath` is still used for slug computation and audit location.
     */
    plan?: ExecutionPlan;
  } = {},
): Promise<LintRefreshReport> {
  const projectPath = opts.projectPath ?? defaultProjectPath(planPath);
  const now = opts.now ?? new Date();
  const currentHash = getAcLintRulesHash();

  const plan: ExecutionPlan = opts.plan ?? loadPlan(planPath);
  const counts = countExemptions(plan);

  // No exemptions at all → write a baseline audit and return triggered:false.
  // AC-bis-05 expects this behaviour so downstream tooling can still see a
  // fresh audit file even when nothing was exempt.
  if (counts.perAc === 0 && counts.planLevel === 0) {
    const entry: LintAuditEntry = {
      planId: computePlanSlug(planPath),
      planPath,
      lastAuditedAt: now.toISOString(),
      ruleHash: currentHash,
      perAcExemptCount: 0,
      planLevelExemptCount: 0,
    };
    await writeAudit(projectPath, entry);
    return {
      triggered: false,
      triggerReason: "none",
      staleEntries: [],
    };
  }

  const existing = await loadAudit(projectPath, planPath);
  let reason: LintRefreshTriggerReason;

  if (opts.force) {
    reason = existing ? (isStale(existing, currentHash, now) ?? "rule-change") : "rule-change";
  } else if (!existing) {
    // Absent baseline = treat as rule-change drift (AC-bis-06).
    reason = "rule-change";
  } else {
    const staleness = isStale(existing, currentHash, now);
    if (!staleness) {
      return { triggered: false, triggerReason: "none", staleEntries: [] };
    }
    reason = staleness;
  }

  const staleEntries = collectStaleEntries(plan);

  const fresh: LintAuditEntry = {
    planId: computePlanSlug(planPath),
    planPath,
    lastAuditedAt: now.toISOString(),
    ruleHash: currentHash,
    perAcExemptCount: counts.perAc,
    planLevelExemptCount: counts.planLevel,
  };
  await writeAudit(projectPath, fresh);

  return {
    triggered: true,
    triggerReason: reason,
    staleEntries,
  };
}

// ── MCP handler ──────────────────────────────────────────

export async function handleLintRefresh(
  input: LintRefreshInput,
): Promise<McpResponse> {
  try {
    const report = await runLintRefresh(input.planPath, {
      force: input.force,
      projectPath: input.projectPath,
      now: input.now ? new Date(input.now) : undefined,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `forge_lint_refresh error: ${message}` }],
      isError: true,
    };
  }
}
