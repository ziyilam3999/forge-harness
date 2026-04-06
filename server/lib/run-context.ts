/**
 * RunContext — bundles CostTracker + ProgressReporter + AuditLog.
 *
 * `trackedCallClaude` wraps `callClaude` to auto-track token usage,
 * report progress, and audit decisions. callClaude stays pure —
 * observability is layered on top.
 */

import { callClaude, type CallClaudeOptions, type CallClaudeResult } from "./anthropic.js";
import { CostTracker } from "./cost.js";
import { ProgressReporter } from "./progress.js";
import { AuditLog } from "./audit.js";

export interface RunContextOptions {
  toolName: string;
  projectPath?: string;
  stages: string[];
  budgetUsd?: number;
  isOAuth?: boolean;
}

export class RunContext {
  readonly cost: CostTracker;
  readonly progress: ProgressReporter;
  readonly audit: AuditLog;
  readonly toolName: string;

  constructor(options: RunContextOptions) {
    this.toolName = options.toolName;
    this.cost = new CostTracker({
      budgetUsd: options.budgetUsd,
      isOAuth: options.isOAuth,
    });
    this.progress = new ProgressReporter(options.toolName, options.stages);
    this.audit = new AuditLog(options.toolName, options.projectPath);
  }
}

/**
 * Wrapper around callClaude that auto-tracks token usage and logs audit entries.
 * callClaude itself remains pure — this function adds observability on top.
 */
export async function trackedCallClaude(
  ctx: RunContext,
  stageName: string,
  agentRole: string,
  options: CallClaudeOptions,
): Promise<CallClaudeResult> {
  ctx.progress.begin(stageName);

  try {
    const result = await callClaude(options);

    ctx.cost.recordUsage(
      stageName,
      result.usage.inputTokens,
      result.usage.outputTokens,
      options.model,
    );

    await ctx.audit.log({
      stage: stageName,
      agentRole,
      decision: "call_complete",
      reasoning: `${result.usage.inputTokens} input / ${result.usage.outputTokens} output tokens`,
    });

    ctx.progress.complete(stageName);
    return result;
  } catch (err) {
    ctx.progress.fail(stageName);

    await ctx.audit.log({
      stage: stageName,
      agentRole,
      decision: "call_failed",
      reasoning: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}
