/**
 * CostTracker — accumulates token usage per stage and estimates USD cost.
 *
 * Advisory only: isOverBudget() and remainingBudgetUsd() inform the caller
 * but never force-stop. Force-stopping mid-generation produces corrupt partial
 * output that wastes all tokens spent so far.
 */

import { DEFAULT_MODEL } from "./anthropic.js";

/** Hardcoded pricing per million tokens (USD). */
const PRICING = {
  "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-opus-4-6": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  "claude-haiku-4-5": { inputPerMillion: 0.8, outputPerMillion: 4.0 },
} as const;

/** When this date is more than 90 days old, emit a staleness warning. */
export const PRICING_LAST_UPDATED = "2025-05-01";

type PricingModel = keyof typeof PRICING;

function isPricingModel(model: string): model is PricingModel {
  return model in PRICING;
}

export interface StageUsage {
  stage: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  breakdown: StageUsage[];
  isOAuthAuth: boolean;
}

export class CostTracker {
  private stages: StageUsage[] = [];
  private budgetUsd: number | null;
  private isOAuth: boolean;
  private stalePricingWarned = false;
  private unknownModelWarned = false;

  constructor(options: { budgetUsd?: number; isOAuth?: boolean } = {}) {
    this.budgetUsd = options.budgetUsd ?? null;
    this.isOAuth = options.isOAuth ?? false;
    this.checkPricingStaleness();
  }

  private checkPricingStaleness(): void {
    const updatedDate = new Date(PRICING_LAST_UPDATED);
    const daysSinceUpdate = Math.floor(
      (Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceUpdate > 90 && !this.stalePricingWarned) {
      console.error(
        `forge: Pricing data is ${daysSinceUpdate} days old; estimates may be inaccurate.`,
      );
      this.stalePricingWarned = true;
    }
  }

  /**
   * P45 (v0.40.6) — warn once per CostTracker instance when the operator-set
   * FORGE_MODEL (or per-call override) is not in the PRICING table.
   *
   * Mirrors `stalePricingWarned` (lines 44, 58) — single-instance latch so
   * the warning fires exactly once even if many `recordUsage` calls land for
   * the same unknown model in one run. Estimates remain `null` (P45 + F46:
   * never silent $0 — operators must distinguish "no PRICING row" from
   * "actual zero").
   */
  private warnUnknownModel(model: string): void {
    if (this.unknownModelWarned) return;
    console.error(
      `forge: model "${model}" is not in the cost-tracking PRICING table ` +
        `(known: ${Object.keys(PRICING).join(", ")}). ` +
        `Estimates will be null for this run; calls still proceed.`,
    );
    this.unknownModelWarned = true;
  }

  /**
   * Record token usage for a stage.
   * If usage fields are missing (null/undefined), logs a warning per P45
   * and records estimatedCostUsd as null.
   */
  recordUsage(
    stage: string,
    inputTokens: number | undefined | null,
    outputTokens: number | undefined | null,
    model?: string,
  ): void {
    if (inputTokens == null || outputTokens == null) {
      console.error(
        `forge: Missing token data for stage "${stage}"; cost estimate unavailable.`,
      );
      this.stages.push({
        stage,
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        estimatedCostUsd: null,
      });
      return;
    }

    let costUsd: number | null = null;
    const effectiveModel = model ?? DEFAULT_MODEL;
    if (isPricingModel(effectiveModel)) {
      const pricing = PRICING[effectiveModel];
      costUsd =
        (inputTokens / 1_000_000) * pricing.inputPerMillion +
        (outputTokens / 1_000_000) * pricing.outputPerMillion;
    } else {
      this.warnUnknownModel(effectiveModel);
    }

    this.stages.push({
      stage,
      inputTokens,
      outputTokens,
      estimatedCostUsd: costUsd,
    });
  }

  /** Total input tokens across all stages. */
  get totalInputTokens(): number {
    return this.stages.reduce((sum, s) => sum + s.inputTokens, 0);
  }

  /** Total output tokens across all stages. */
  get totalOutputTokens(): number {
    return this.stages.reduce((sum, s) => sum + s.outputTokens, 0);
  }

  /** Total estimated cost, or null if any stage had missing data. */
  get totalCostUsd(): number | null {
    if (this.stages.some((s) => s.estimatedCostUsd === null)) return null;
    return this.stages.reduce((sum, s) => sum + (s.estimatedCostUsd ?? 0), 0);
  }

  /** Advisory: is the total cost over the configured budget? */
  isOverBudget(): boolean {
    if (this.budgetUsd === null || this.totalCostUsd === null) return false;
    return this.totalCostUsd > this.budgetUsd;
  }

  /** Advisory: remaining budget in USD (null if no budget set or cost unknown). */
  remainingBudgetUsd(): number | null {
    if (this.budgetUsd === null || this.totalCostUsd === null) return null;
    return this.budgetUsd - this.totalCostUsd;
  }

  /** Get a full cost summary. */
  summarize(): CostSummary {
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      estimatedCostUsd: this.totalCostUsd,
      breakdown: [...this.stages],
      isOAuthAuth: this.isOAuth,
    };
  }
}
