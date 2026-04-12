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
}

// ── Coordinate mode ─────────────────────────────────────────

export type CoordinateMode = "advisory" | "autonomous";

// ── Top-level result ────────────────────────────────────────

export interface CoordinateResult {
  mode: CoordinateMode;
  phaseId: string;
  brief: PhaseTransitionBrief;
}
