export interface ExecutionPlan {
  schemaVersion: "3.0.0";
  prdPath?: string; // Reserved for future use; not populated by the planner in Phase 1.
  documentTier?: "phase"; // Three-tier system: marks this plan as a phase-level document.
  phaseId?: string; // PH-XX reference linking this plan to a MasterPlan phase.
  stories: Story[];
}

export interface Story {
  id: string;
  title: string;
  dependencies?: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  affectedPaths?: string[];
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  command: string;
  flaky?: boolean; // Not populated by the planner in Phase 1. Exists for future manual annotation.
}
