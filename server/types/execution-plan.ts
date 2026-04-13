export interface ExecutionPlan {
  schemaVersion: "3.0.0";
  prdPath?: string; // Reserved for future use; not populated by the planner in Phase 1.
  documentTier?: "phase"; // Three-tier system: marks this plan as a phase-level document.
  phaseId?: string; // PH-XX reference linking this plan to a MasterPlan phase.
  baselineCheck?: string; // Shell command to verify project health before generation (e.g. "npm run build && npm test").
  stories: Story[];
}

export interface StoryLineage { tier: "phase-plan" | "master-plan" | "prd"; sourceId: string }

export interface Story {
  id: string;
  title: string;
  dependencies?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  affectedPaths?: string[];
  lineage?: StoryLineage;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  command: string;
  flaky?: boolean; // Not populated by the planner in Phase 1. Exists for future manual annotation.
  /**
   * Per-rule ac-lint exemptions (Q0.5/A1). When an AC's command matches a
   * deny-list pattern but the author has a justified reason (e.g. an
   * intentional-looking pattern that is not actually subprocess-unsafe in
   * this context), they can attach a `lintExempt` entry naming the specific
   * `ruleId`. The lint module honors the exemption: matching findings are
   * still reported, but `exempt: true` downgrades the overall `suspect`
   * verdict for that rule. Other rules still fire normally. See
   * `server/validation/ac-lint.ts`. Governance cap: plans with >3 total
   * lintExempt entries across all ACs are flagged for review.
   */
  lintExempt?: { ruleId: string; rationale: string } | Array<{ ruleId: string; rationale: string }>;
}
