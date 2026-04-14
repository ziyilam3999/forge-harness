/**
 * Q0.5/A3-bis — Lint-exemption audit state.
 *
 * Tracks when each plan's `lintExempt` overrides were last re-validated against
 * the current ac-lint rule surface. Two staleness triggers: rule-set hash drift
 * (`AC_LINT_RULES` / `AC_SUBPROCESS_RULES_PROMPT` changed) and 14-day calendar.
 *
 * Persisted to `.ai-workspace/lint-audit/{planSlug}.audit.json` (committed).
 */

export interface LintAuditEntry {
  /** Stable plan identifier (parentDir__basename, no .md). */
  planId: string;
  /** Original plan path the audit was computed against (informational). */
  planPath: string;
  /** ISO-8601 of the last successful re-validation. */
  lastAuditedAt: string;
  /** Hash of the rule surface at last audit (`getAcLintRulesHash()`). */
  ruleHash: string;
  /** Number of per-AC `lintExempt: true` ACs in the plan at audit time. */
  perAcExemptCount: number;
  /** Number of plan-level `lintExempt[]` entries in the plan at audit time. */
  planLevelExemptCount: number;
}

export type LintRefreshTriggerReason =
  | "rule-change"
  | "14d-elapsed"
  | "none";

export interface LintRefreshStaleEntry {
  /** Identifier for the exempt AC or plan-level rule. */
  exemptionId: string;
  /** Where the exemption lives: per-AC override or plan-level deny-list bypass. */
  scope: "per-ac" | "plan-level";
  /** The original rationale string (verbatim from the plan). */
  rationale: string;
  /** Lint findings produced by re-running the rule WITHOUT the exemption. */
  currentFindings: string[];
}

export interface LintRefreshReport {
  triggered: boolean;
  triggerReason: LintRefreshTriggerReason;
  staleEntries: LintRefreshStaleEntry[];
}
