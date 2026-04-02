export interface EvalReport {
  storyId: string;
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  criteria: CriterionResult[];
  warnings?: string[];
}

export interface CriterionResult {
  id: string;
  status: "PASS" | "FAIL" | "SKIPPED" | "INCONCLUSIVE";
  evidence: string;
}
