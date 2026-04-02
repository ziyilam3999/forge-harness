export interface ExecutionPlan {
  schemaVersion: "3.0.0";
  prdPath?: string; // Reserved for future use; not populated by the planner in Phase 1.
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
