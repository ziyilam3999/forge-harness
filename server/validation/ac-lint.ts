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

/**
 * Q0.5/C1-bis — plan-level `lintExempt` variant for bootstrap absorption of
 * pre-existing drift backlogs (see `.ai-workspace/plans/2026-04-13-q05-c1-...`).
 *
 * Discriminator: `scope: "plan"` present → this variant. Absent → the existing
 * per-AC `LintExempt` shape. Field name is reused intentionally (single-locus)
 * with a discriminated union at the type level.
 *
 * Semantics differ from per-AC on purpose:
 *   - Per-AC: findings are KEPT with `exempt: true` flag (visible audit trail).
 *   - Plan-level: findings are DROPPED entirely (bootstrap absorption — drift
 *     is conceptually gone, not just acknowledged).
 *
 * Governance: plan-level entries count in a SEPARATE bucket
 * (`lintExemptPlanEntriesCount`) with no cap. The per-AC 3-cap
 * (`GOVERNANCE_CAP`) is unchanged and only feeds `governanceViolation`.
 */
export interface LintExemptPlan {
  scope: "plan";
  /** Non-empty. Each entry must be an id in `AC_LINT_RULES`. */
  rules: string[];
  /** Required. Convention: `{YYYY-MM-DD}-{context-slug}`. */
  batch: string;
  /** Required, non-empty. */
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
  /**
   * Q0.5/C1-bis — plan-level bootstrap-absorption exemptions. Findings whose
   * `ruleId` matches any entry here are DROPPED from `findings[]` entirely
   * (bootstrap-absorption semantics, distinct from per-AC "keep with exempt
   * flag"). Plan-level entries are schema-validated (non-empty `rules`, all
   * in `AC_LINT_RULES`, non-empty `batch`, non-empty `rationale`) — invalid
   * entries throw from `lintPlan()`.
   */
  lintExempt?: LintExemptPlan[];
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
  /** Every finding across every AC, flat. Plan-level exempt rules are dropped. */
  findings: LintPlanFinding[];
  /** AC ids that have at least one NON-exempt finding. */
  suspectAcIds: string[];
  /** Total per-AC `lintExempt` entries (feeds `governanceViolation`). */
  lintExemptCount: number;
  /**
   * Q0.5/C1-bis — total plan-level `lintExempt` entries (does NOT feed
   * `governanceViolation`; no cap).
   */
  lintExemptPlanEntriesCount: number;
  /** True iff `lintExemptCount > 3` (plan-governance cap per Q0.5/A1). */
  governanceViolation: boolean;
}

const GOVERNANCE_CAP = 3;

/**
 * Q0.5/C1-bis — validate plan-level `lintExempt[]` entries and collect the
 * union of exempted rule ids. Throws on any malformed entry:
 *   - missing / non-"plan" `scope`
 *   - empty or non-array `rules`
 *   - rule id not in `AC_LINT_RULES`
 *   - missing / empty `batch`
 *   - missing / empty `rationale`
 *
 * Returns the union set of exempted rule ids across all batches.
 */
function validateAndCollectPlanLevelExempts(
  entries: LintExemptPlan[] | undefined,
): Set<string> {
  const exempted = new Set<string>();
  if (!entries) return exempted;
  if (!Array.isArray(entries)) {
    throw new Error("plan.lintExempt must be an array of LintExemptPlan entries");
  }
  const knownRuleIds = new Set(AC_LINT_RULES.map((r) => r.id));
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const where = `plan.lintExempt[${i}]`;
    if (!e || typeof e !== "object") {
      throw new Error(`${where}: must be an object`);
    }
    if (e.scope !== "plan") {
      throw new Error(`${where}: scope must be "plan" (got ${JSON.stringify(e.scope)})`);
    }
    if (!Array.isArray(e.rules) || e.rules.length === 0) {
      throw new Error(`${where}: rules must be a non-empty array`);
    }
    for (const r of e.rules) {
      if (typeof r !== "string" || !knownRuleIds.has(r)) {
        throw new Error(
          `${where}: rule id ${JSON.stringify(r)} is not in AC_LINT_RULES ` +
            `(known: ${Array.from(knownRuleIds).join(", ")})`,
        );
      }
      exempted.add(r);
    }
    if (typeof e.batch !== "string" || e.batch.length === 0) {
      throw new Error(`${where}: batch must be a non-empty string`);
    }
    if (typeof e.rationale !== "string" || e.rationale.length === 0) {
      throw new Error(`${where}: rationale must be a non-empty string`);
    }
  }
  return exempted;
}

export function lintPlan(plan: LintablePlan): LintPlanReport {
  const planExemptedRules = validateAndCollectPlanLevelExempts(plan.lintExempt);
  const lintExemptPlanEntriesCount = plan.lintExempt?.length ?? 0;

  const findings: LintPlanFinding[] = [];
  const suspectAcIds = new Set<string>();
  let lintExemptCount = 0;

  for (const story of plan.stories ?? []) {
    const acs = story.acceptanceCriteria ?? story.acs ?? [];
    for (const ac of acs) {
      // Count per-AC exemption entries for governance (unchanged).
      if (ac.lintExempt) {
        const arr = Array.isArray(ac.lintExempt) ? ac.lintExempt : [ac.lintExempt];
        lintExemptCount += arr.length;
      }

      const result = lintAcCommand(ac.command, { lintExempt: ac.lintExempt });

      // Q0.5/C1-bis — drop findings whose ruleId is in the plan-level exempt
      // set. This is additive to the per-AC filter (which keeps findings with
      // `exempt: true`): plan-level means "absorbed, not surfaced."
      const visibleFindings = result.findings.filter(
        (f) => !planExemptedRules.has(f.ruleId),
      );

      for (const f of visibleFindings) {
        findings.push({ ...f, storyId: story.id, acId: ac.id });
      }
      // Recompute suspect from the post-plan-filter view: if all matching
      // rules were plan-exempted, the AC is no longer suspect even though
      // the raw `result.suspect` was true.
      const stillSuspect = visibleFindings.some((f) => !f.exempt);
      if (stillSuspect) {
        suspectAcIds.add(ac.id);
      }
    }
  }

  return {
    findings,
    suspectAcIds: Array.from(suspectAcIds),
    lintExemptCount,
    lintExemptPlanEntriesCount,
    governanceViolation: lintExemptCount > GOVERNANCE_CAP,
  };
}

// Re-export for consumers that want to inspect the rule list.
export { AC_LINT_RULES };
export type { AcLintRule };
