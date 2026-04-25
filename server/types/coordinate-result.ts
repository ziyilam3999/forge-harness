import type { EvalReport } from "./eval-report.js";

// ── Story-level status ──────────────────────────────────────

export type StoryStatus =
  | "done"
  | "ready"
  | "ready-for-retry"
  | "failed"
  | "pending"
  | "dep-failed";

export interface StoryStatusEntry {
  storyId: string;
  status: StoryStatus;
  retryCount: number;
  retriesRemaining: number;
  /** Non-optional (NFR-C08). Populated for ready-for-retry and failed; null otherwise. */
  priorEvalReport: EvalReport | null;
  /** Non-optional (NFR-C08). Human-readable status reason; null when not relevant. */
  evidence: string | null;
}

// ── Phase-level status ──────────────────────────────────────

export type PhaseStatus =
  | "in-progress"
  | "complete"
  | "needs-replan"
  | "halted";

export type BudgetWarningLevel = "none" | "approaching" | "exceeded";
export type TimeWarningLevel = "none" | "approaching" | "exceeded" | "unknown";

export interface BudgetInfo {
  usedUsd: number;
  budgetUsd: number | null;
  remainingUsd: number | null;
  incompleteData: boolean;
  warningLevel: BudgetWarningLevel;
  /**
   * v0.35.1 AC-6 — when the running MCP process resolved credentials via
   * Claude OAuth (Max plan) rather than an `ANTHROPIC_API_KEY`, this flag
   * is `true` so the dashboard's BUDGET widget can annotate the spent
   * amount as "Max plan — $0 actual (API-equivalent)". When resolved via
   * API key (or unknown), omit or set to `false`.
   *
   * Optional-additive: the pipe runs from `getCredentialSource()` →
   * `RunContext.isOAuth` → the brief assembler. Existing callers that
   * construct BudgetInfo literals (tests, shims) need no change.
   */
  isOAuth?: boolean;
}

export interface TimeBudgetInfo {
  elapsedMs: number;
  maxTimeMs: number | null;
  warningLevel: TimeWarningLevel;
}

// ── Replanning notes (REQ-10) ──────────────────────────────

export type ReplanningCategory =
  | "ac-drift"
  | "partial-completion"
  | "dependency-satisfied"
  | "gap-found"
  | "assumption-changed";

export type ReplanningSeverity = "blocking" | "should-address" | "informational";

export interface ReplanningNote {
  category: ReplanningCategory;
  severity: ReplanningSeverity;
  affectedPhases?: string[];
  affectedStories?: string[];
  description: string;
}

// ── Graduation findings (REQ-12) ───────────────────────────

export interface Finding {
  escalationReason: string;
  distinctStoryCount: number;
  storyIds: string[];
}

export interface GraduateFindingsResult {
  findings: Finding[];
  windowInflationRisk: boolean;
}

// ── Drift tracking (Q0/L3) ─────────────────────────────────

export interface DriftCounts {
  reverse: number;
  orphaned: number;
  dangling: number;
  overflow?: boolean; // true when any subfield was capped at 50
}

// ── PhaseTransitionBrief ────────────────────────────────────

export interface PhaseTransitionBrief {
  status: PhaseStatus;
  stories: StoryStatusEntry[];
  readyStories: string[];
  depFailedStories: string[];
  failedStories: string[];
  completedCount: number;
  totalCount: number;
  budget: BudgetInfo;
  timeBudget: TimeBudgetInfo;
  replanningNotes: ReplanningNote[];
  recommendation: string;
  configSource: Record<string, "file" | "args" | "default">;
  /**
   * Drift since last plan update.
   * - reverse: count of reverseFindings entries emitted by forge_evaluate(divergence)
   *   (source: server/types/eval-report.ts reverseFindings array length)
   * - orphaned: count of records in coordinator.reconcileState whose parent story no
   *   longer exists in the master plan (formally: a reconcileState record whose
   *   parentStoryId is absent from masterPlan.stories[*].id)
   * - dangling: count of phase plan dependencies whose target story is missing or
   *   already-completed (formally: a phasePlan.deps[].targetStoryId that either does
   *   not match any story in the master plan OR matches a story whose status=completed).
   * Capped at 50 per subfield; full list spills to .ai-workspace/drift/{timestamp}.json
   * when overflow=true.
   */
  driftSinceLastPlanUpdate?: DriftCounts;
  /**
   * Count of ReplanningNote entries with category: "gap-found" written to
   * .forge/audit/reconcile-notes.jsonl during the most recent forge_reconcile run.
   * Additive optional (P50).
   */
  deferredReplanningNotes?: number;
  /**
   * v0.36.0 AC-A5 — advisory hint to the orchestrating session about whether
   * the upcoming wave of stories should be implemented in fresh subagents or
   * inline. Set to "subagent" when the phase has ≥ 3 open stories (open =
   * status NOT in {done, failed, dep-failed}); set to "inline" otherwise.
   * Optional-additive: legacy callers ignore it, and forge_generate's own
   * callerAction directive remains the per-story authority.
   */
  recommendedExecutionMode?: "subagent" | "inline";
}

// ── Coordinate mode ─────────────────────────────────────────

export type CoordinateMode = "advisory" | "autonomous";

// ── Top-level result ────────────────────────────────────────

export interface CoordinateResult {
  mode: CoordinateMode;
  phaseId: string;
  brief: PhaseTransitionBrief;
}
