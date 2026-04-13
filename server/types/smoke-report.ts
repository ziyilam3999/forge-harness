/**
 * Q0.5/B1 — Smoke-test report types.
 *
 * `forge_evaluate(mode: "smoke-test")` characterizes every AC in a plan WITHOUT
 * grading pass/fail. It answers "does this command even run cleanly?" at
 * authoring time, so broken ACs are caught before they hit a real evaluation.
 *
 * Verdict values:
 *   - "ok"              — terminated cleanly under 80% of the timeout budget
 *   - "slow"            — terminated but used > 80% of the budget
 *   - "empty-evidence"  — non-zero exit AND zero bytes on stdout+stderr
 *   - "hung"            — hit the soft timeout (SIGTERM/SIGKILL escalation)
 *   - "skipped-suspect" — ac-lint flagged the command shape before execution;
 *                         `reason` carries the rule id. NOT executed.
 *
 * `timeoutRisk: true` is a modifier set only when `verdict === "slow"` AND the
 * AC lacks an explicit `smokeTimeoutMs` override (i.e., the author didn't
 * consent to the larger budget). Never set on `skipped-suspect`.
 *
 * `exited`, `elapsedMs`, `evidenceBytes` are `null` on `skipped-suspect`
 * because the command never ran.
 */

export type SmokeVerdict =
  | "ok"
  | "slow"
  | "empty-evidence"
  | "hung"
  | "skipped-suspect";

export interface SmokeReportEntry {
  acId: string;
  verdict: SmokeVerdict;
  exited: number | null;
  elapsedMs: number | null;
  evidenceBytes: number | null;
  timeoutRisk: boolean;
  reason?: string;
}

export interface SmokeReport {
  planId?: string;
  timestamp: string;
  entries: SmokeReportEntry[];
}
