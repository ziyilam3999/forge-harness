/**
 * Q0.5/A1 — mechanical lint for AC shell commands.
 *
 * Imports the structured deny-list from
 * `server/lib/prompts/shared/ac-subprocess-rules.ts` (single source of truth,
 * shared with the planner prompt). Runs each rule's regex against a single AC
 * command, or across every AC in an execution plan.
 *
 * Integration points (permanent consumers):
 *   - `server/tools/plan.ts` — called after planner output, before write.
 *   - `server/tools/evaluate.ts` (via `server/lib/evaluator.ts`) — called
 *     before each AC's shell command is executed; non-exempt suspect ACs
 *     short-circuit to `reliability=suspect` without spawning a subprocess.
 *   - `scripts/run-ac-lint.mjs` — advisory CI driver (see
 *     `.github/workflows/ac-lint.yml`).
 *
 * Scope deliberately excluded from A1 (deferred to full A3 / A2 PRs):
 *   - No "unverified" reliability state (that's full A3).
 *   - No critic prompt wiring (that's A2).
 */

import { AC_LINT_RULES, type AcLintRule } from "../lib/prompts/shared/ac-subprocess-rules.js";

export interface LintExempt {
  ruleId: string;
  rationale: string;
}

export interface LintFinding {
  ruleId: string;
  description: string;
  severity: "suspect";
  /** The substring of the command that matched. */
  snippet: string;
  /** True iff the AC had a `lintExempt` entry for this rule. */
  exempt: boolean;
  /** Present only when `exempt === true`. */
  exemptRationale?: string;
}

export interface LintAcCommandOptions {
  lintExempt?: LintExempt | LintExempt[];
}

export interface LintAcCommandResult {
  /** All rule matches (exempt AND non-exempt). */
  findings: LintFinding[];
  /** True iff at least one finding is non-exempt. */
  suspect: boolean;
}

function normalizeExempt(
  exempt?: LintExempt | LintExempt[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (!exempt) return out;
  const arr = Array.isArray(exempt) ? exempt : [exempt];
  for (const e of arr) {
    if (e && typeof e.ruleId === "string") {
      out.set(e.ruleId, e.rationale ?? "");
    }
  }
  return out;
}

/**
 * Run every AC_LINT_RULES regex against a single command string.
 *
 * Returns ALL matches (exempt ones flagged with `exempt: true`). `suspect`
 * is true iff at least one finding has `exempt: false`.
 */
export function lintAcCommand(
  command: string,
  opts?: LintAcCommandOptions,
): LintAcCommandResult {
  const exemptMap = normalizeExempt(opts?.lintExempt);
  const findings: LintFinding[] = [];

  for (const rule of AC_LINT_RULES) {
    const match = rule.pattern.exec(command);
    if (!match) continue;
    const isExempt = exemptMap.has(rule.id);
    const finding: LintFinding = {
      ruleId: rule.id,
      description: rule.description,
      severity: rule.severity,
      snippet: match[0],
      exempt: isExempt,
    };
    if (isExempt) {
      finding.exemptRationale = exemptMap.get(rule.id);
    }
    findings.push(finding);
  }

  const suspect = findings.some((f) => !f.exempt);
  return { findings, suspect };
}

// ── Plan-level API ────────────────────────────────────────

/**
 * Minimal duck-typed plan shape. Uses a subset of the real `ExecutionPlan`
 * so this module can accept partial plans (e.g. in tests) and hand-built
 * objects without forcing the full schemaVersion envelope.
 */
export interface LintablePlan {
  stories: Array<{
    id: string;
    acceptanceCriteria?: Array<{
      id: string;
      command: string;
      lintExempt?: LintExempt | LintExempt[];
    }>;
    // Legacy / alias — some older internal shapes use `acs`.
    acs?: Array<{
      id: string;
      command: string;
      lintExempt?: LintExempt | LintExempt[];
    }>;
  }>;
}

export interface LintPlanFinding extends LintFinding {
  storyId: string;
  acId: string;
}

export interface LintPlanReport {
  /** Every finding across every AC, flat. */
  findings: LintPlanFinding[];
  /** AC ids that have at least one NON-exempt finding. */
  suspectAcIds: string[];
  /** Total `lintExempt` entries across all ACs (for the governance cap). */
  lintExemptCount: number;
  /** True iff `lintExemptCount > 3` (plan-governance cap per Q0.5/A1). */
  governanceViolation: boolean;
}

const GOVERNANCE_CAP = 3;

export function lintPlan(plan: LintablePlan): LintPlanReport {
  const findings: LintPlanFinding[] = [];
  const suspectAcIds = new Set<string>();
  let lintExemptCount = 0;

  for (const story of plan.stories ?? []) {
    const acs = story.acceptanceCriteria ?? story.acs ?? [];
    for (const ac of acs) {
      // Count exemption entries for governance.
      if (ac.lintExempt) {
        const arr = Array.isArray(ac.lintExempt) ? ac.lintExempt : [ac.lintExempt];
        lintExemptCount += arr.length;
      }

      const result = lintAcCommand(ac.command, { lintExempt: ac.lintExempt });
      for (const f of result.findings) {
        findings.push({ ...f, storyId: story.id, acId: ac.id });
      }
      if (result.suspect) {
        suspectAcIds.add(ac.id);
      }
    }
  }

  return {
    findings,
    suspectAcIds: Array.from(suspectAcIds),
    lintExemptCount,
    governanceViolation: lintExemptCount > GOVERNANCE_CAP,
  };
}

// Re-export for consumers that want to inspect the rule list.
export { AC_LINT_RULES };
export type { AcLintRule };
