/**
 * Coherence evaluation report — LLM-judged alignment between document tiers.
 * Checks: PRD <-> master plan, master plan <-> phase plans.
 */

export interface CoherenceGap {
  id: string; // GAP-01, GAP-02, etc.
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  sourceDocument: "prd" | "masterPlan" | "phasePlan";
  targetDocument: "masterPlan" | "phasePlan";
  description: string;
  missingRequirement: string;
}

export interface CoherenceReport {
  evaluationMode: "coherence";
  status: "complete" | "eval-failed";
  gaps: CoherenceGap[];
  summary: string;
}
