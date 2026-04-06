/**
 * CostTracker — accumulates token usage per stage and estimates USD cost.
 *
 * Advisory only: isOverBudget() and remainingBudgetUsd() inform the caller
 * but never force-stop. Force-stopping mid-generation produces corrupt partial
 * output that wastes all tokens spent so far.
 */

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
    const effectiveModel = model ?? "claude-sonnet-4-6";
    if (isPricingModel(effectiveModel)) {
      const pricing = PRICING[effectiveModel];
      costUsd =
        (inputTokens / 1_000_000) * pricing.inputPerMillion +
        (outputTokens / 1_000_000) * pricing.outputPerMillion;
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
