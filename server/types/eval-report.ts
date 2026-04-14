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
   * Reliability classification for this criterion's result.
   *
   * - "trusted": the AC's command passed ac-lint subprocess-safety checks
   *   cleanly (no findings, OR findings exist but none were marked exempt).
   *   The verdict reflects a real run against real safety guarantees.
   *
   * - "suspect": ac-lint flagged a non-exempted finding and the AC was
   *   short-circuited to SKIPPED (or flaky-retry suspect path). Verdict
   *   is provisional pending author cleanup.
   *
   * - "unverified": the AC ran to completion BUT one or more per-AC
   *   `lintExempt` entries actively suppressed a finding during this run.
   *   The author exercised an override; the safety check was bypassed for
   *   this command. The verdict stands (PASS still passes, FAIL still
   *   fails) but the reliability of the signal is reduced. Surfaced as a
   *   warning in EvalReport.warnings[], never downgrades verdict.
   *
   * Plan-level `ExecutionPlan.lintExempt[]` (scope: "plan") absorbs
   * findings entirely and is OUT OF SCOPE for this tag — those ACs report
   * "trusted" by construction. Plan-level coverage is deferred to
   * Q0.5/A3-bis (dual-trigger refresh tool).
   */
  reliability?: "trusted" | "suspect" | "unverified";
}
