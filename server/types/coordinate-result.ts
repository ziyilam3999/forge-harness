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
}

// ── Coordinate mode ─────────────────────────────────────────

export type CoordinateMode = "advisory" | "autonomous";

// ── Top-level result ────────────────────────────────────────

export interface CoordinateResult {
  mode: CoordinateMode;
  phaseId: string;
  brief: PhaseTransitionBrief;
}
