import type { Story, StoryLineage } from "./execution-plan.js";

// ── Action discriminator ─────────────────────

export type GenerateAction = "implement" | "fix" | "pass" | "escalate";

// ── Top-level result ─────────────────────────

export interface GenerateResult {
  action: GenerateAction;
  storyId: string;
  iteration: number;
  maxIterations: number;
  brief?: GenerationBrief;
  fixBrief?: FixBrief;
  escalation?: Escalation;
  costEstimate?: CostEstimate;
  diffManifest?: DiffManifest;
}

// ── Init brief (REQ-01) ─────────────────────

export interface GenerationBrief {
  story: Story;
  codebaseContext: string;
  gitBranch: string;
  baselineCheck: string;
  documentContext?: DocumentContext;
  injectedContext?: string[];
  lineage?: StoryLineage;
}

export interface DocumentContext {
  prdContent?: string;
  masterPlanContent?: string;
  phasePlanContent?: string;
}

// ── Fix brief (REQ-02) ──────────────────────

export interface FixBrief {
  failedCriteria: FailedCriterion[];
  score: number;
  evalHint: EvalHint;
  guidance: string;
}

export interface FailedCriterion {
  id: string;
  description: string;
  evidence: string;
}

export interface EvalHint {
  failFastIds: string[];
}

// ── Escalation (REQ-06) ─────────────────────

export type EscalationReason =
  | "plateau"
  | "no-op"
  | "max-iterations"
  | "inconclusive"
  | "baseline-failed";

export interface Escalation {
  reason: EscalationReason;
  description: string;
  hypothesis: string | null;
  lastEvalVerdict: "FAIL" | "INCONCLUSIVE";
  scoreHistory: number[];
  diagnostics?: EscalationDiagnostics;
}

export interface EscalationDiagnostics {
  exitCode: number;
  stderr: string;
  failingTests: string[];
}

// ── Cost estimate (REQ-16) ──────────────────

export interface CostEstimate {
  briefTokens: number;
  projectedIterationCostUsd: number;
  projectedRemainingCostUsd: number;
}

// ── Diff manifest (REQ-14) ──────────────────

export interface DiffManifest {
  changed: string[];
  unchanged: string[];
  new: string[];
}
