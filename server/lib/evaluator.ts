import type { ExecutionPlan } from "../types/execution-plan.js";
import type { EvalReport, CriterionResult } from "../types/eval-report.js";
import { executeCommand, type ExecuteOptions } from "./executor.js";
import { lintAcCommand } from "../validation/ac-lint.js";

export interface EvaluateOptions {
  timeoutMs?: number;
  cwd?: string;
}

/**
 * Evaluate a single story from an execution plan by running all its ACs.
 *
 * Stateless: receives plan + storyId, runs shell commands, returns results.
 *
 * Q0.5/A1b — before executing each AC, run `lintAcCommand` against the
 * command string. If any non-exempt deny-list rule matches, short-circuit
 * the AC to `{status: "SKIPPED", reliability: "suspect"}` WITHOUT spawning
 * a subprocess. Zero cost, zero hung-process risk, and a clear signal that
 * the AC itself (not the code under test) is the broken thing.
 *
 * Exempt ACs execute normally regardless of pattern match.
 */
export async function evaluateStory(
  plan: ExecutionPlan,
  storyId: string,
  options?: EvaluateOptions,
): Promise<EvalReport> {
  const story = plan.stories.find((s) => s.id === storyId);
  if (!story) {
    throw new Error(`Story '${storyId}' not found in plan`);
  }

  const warnings: string[] = [];

  if (story.acceptanceCriteria.length === 0) {
    warnings.push(
      `Story ${storyId} has 0 acceptance criteria — PASS verdict is vacuous`,
    );
    return {
      storyId,
      verdict: "PASS",
      criteria: [],
      warnings,
    };
  }

  const execOptions: ExecuteOptions = {
    timeoutMs: options?.timeoutMs,
    cwd: options?.cwd,
  };

  const criteria: CriterionResult[] = [];

  for (const ac of story.acceptanceCriteria) {
    // Q0.5/A1b — ac-lint short-circuit (non-exempt suspect ACs never execute).
    const lint = lintAcCommand(ac.command, { lintExempt: ac.lintExempt });
    if (lint.suspect) {
      const ruleIds = lint.findings
        .filter((f) => !f.exempt)
        .map((f) => f.ruleId)
        .join(",");
      criteria.push({
        id: ac.id,
        status: "SKIPPED",
        evidence: `ac-lint: suspect (rules: ${ruleIds}); command NOT executed`,
        reliability: "suspect",
      });
      continue;
    }

    const result = await executeCommand(ac.command, execOptions);
    criteria.push({
      id: ac.id,
      status: result.status,
      evidence: result.evidence,
      reliability: "trusted",
    });
  }

  const verdict = computeVerdict(criteria);

  const report: EvalReport = {
    storyId,
    verdict,
    criteria,
  };

  if (warnings.length > 0) {
    report.warnings = warnings;
  }

  return report;
}

function computeVerdict(
  criteria: CriterionResult[],
): "PASS" | "FAIL" | "INCONCLUSIVE" {
  const hasFail = criteria.some((c) => c.status === "FAIL");
  if (hasFail) return "FAIL";

  const hasInconclusive = criteria.some((c) => c.status === "INCONCLUSIVE");
  if (hasInconclusive) return "INCONCLUSIVE";

  return "PASS";
}
