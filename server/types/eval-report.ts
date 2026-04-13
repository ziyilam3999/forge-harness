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
  /**
   * Reliability of this result (Q0.5/A3 minimum slice).
   *
   * - Absent (undefined): treat as "trusted" for backward compatibility.
   *   Existing consumers that don't know about this field see the same shape
   *   as before A3 shipped.
   * - "trusted": result is mechanically verifiable — the AC command passed
   *   ac-lint clean and executed.
   * - "suspect": ac-lint flagged this AC's command as matching a subprocess-
   *   safety deny-list rule (F55/F56/F36). The command was NOT executed;
   *   `status` is set to "SKIPPED" and `evidence` carries the matched rule
   *   ids. Downstream readers should treat this as "we don't know the real
   *   answer, the AC itself is broken".
   *
   * Note: the full A3 PR will add a third "unverified" value (for the
   * `lintExempt` override path). A1 ships only the trusted/suspect split.
   */
  reliability?: "trusted" | "suspect";
}
