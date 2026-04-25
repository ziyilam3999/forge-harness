import type { Story, StoryLineage } from "./execution-plan.js";

// ── Action discriminator ─────────────────────

export type GenerateAction = "implement" | "fix" | "pass" | "escalate";

// ── Caller-action discriminator (v0.36.0 Phase A — AC-A1) ──
//
// Tells the calling skill (e.g. /forge-execute) HOW to run this brief:
//   - "spawn-subagent-and-await" → fresh Agent subagent; main-context delta ≤ 2 KB.
//   - "execute-inline"           → legacy path, main agent executes the brief.
// Field is OPTIONAL on the wire; absent ↔ legacy "execute-inline" (G5
// backward-compat invariant). Currently the assembler emits the field for
// implement/fix actions and omits it for pass/escalate.
export type CallerAction = "execute-inline" | "spawn-subagent-and-await";

// ── Top-level result ─────────────────────────

export interface GenerateResult {
  action: GenerateAction;
  storyId: string;
  iteration: number;
  maxIterations: number;
  /**
   * v0.36.0 Phase A (AC-A1): instructs the calling skill how to run the
   * brief. Optional-additive — clients on legacy SKILL.md ignore the field
   * and execute inline (G5).
   */
  callerAction?: CallerAction;
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
  /**
   * v0.36.0 Phase C (AC-C5): instructs the implementing subagent to record
   * any architectural decision matching one of the four canonical triggers
   * as a stub at `.forge/staging/adr/<storyId>/<short-slug>.md`. forge-harness's
   * adr-extractor canonicalises the stubs on PASS. If the subagent makes no
   * qualifying decisions, it writes nothing — that is a valid outcome and
   * adr-extractor will record a "no new decisions" row instead.
   */
  adrCapture?: AdrCaptureGuidance;
}

export interface AdrCaptureGuidance {
  /** The four canonical triggers — copied verbatim from the master plan §AC-C5. */
  triggers: string[];
  /** Plain-language instruction to the subagent describing the staging contract. */
  instructions: string;
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
