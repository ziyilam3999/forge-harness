/**
 * Divergence evaluation report — detects gaps between plan and implementation.
 * Forward: AC failures (mechanical). Reverse: unplanned capabilities (LLM-judged).
 */

export interface ForwardDivergence {
  storyId: string;
  acId: string;
  status: "FAIL" | "INCONCLUSIVE";
  evidence: string;
}

export interface ReverseDivergence {
  id: string; // REV-01, REV-02, etc.
  description: string;
  location: string; // file path or area in the codebase
  classification:
    | "method-divergence"
    | "extra-functionality"
    | "scope-creep";
  alignsWithPrd: boolean;
}

export interface DivergenceReport {
  evaluationMode: "divergence";
  status: "complete" | "eval-failed";
  forward: ForwardDivergence[];
  reverse: ReverseDivergence[];
  selfHealingCycles: number;
  maxCyclesReached: boolean;
  summary: string;
}
