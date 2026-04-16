import type { ExecutionPlan } from "../types/execution-plan.js";
import type { EvalReport, CriterionResult } from "../types/eval-report.js";
import { executeCommand, type ExecuteOptions } from "./executor.js";
import { lintAcCommand } from "../validation/ac-lint.js";

export interface EvaluateOptions {
  timeoutMs?: number;
  cwd?: string;
  /**
   * Q0.5/C2 — gap in ms between run-1 and run-2 when an AC marked `flaky: true`
   * returns FAIL on its first run. Default 500ms. Ignored for non-flaky ACs
   * and for ACs short-circuited by ac-lint.
   */
  flakyRetryGapMs?: number;
}

const DEFAULT_FLAKY_RETRY_GAP_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Evaluate a single story from an execution plan by running all its ACs.
 *
 * Stateless: receives plan + storyId, runs shell commands, returns results.
 *
 * Q0.5/A1b — before executing each AC, run `lintAcCommand` against the
 * command string. If any non-exempt deny-list rule matches, short-circuit
 * the AC to `{status: "SKIPPED", reliability: "suspect"}` WITHOUT spawning
 * a subprocess. Zero cost, zero hung-process risk, and a clear signal that
 * the AC itself (not the code under test) is the broken thing.
 *
 * Exempt ACs execute normally regardless of pattern match.
 */
export async function evaluateStory(
  plan: ExecutionPlan,
  storyId: string,
  options?: EvaluateOptions,
): Promise<EvalReport> {
  const story = plan.stories.find((s) => s.id === storyId);
  if (!story) {
    throw new Error(`Story '${storyId}' not found in plan`);
  }

  const warnings: string[] = [];

  if (story.acceptanceCriteria.length === 0) {
    warnings.push(
      `Story ${storyId} has 0 acceptance criteria — PASS verdict is vacuous`,
    );
    return {
      storyId,
      verdict: "PASS",
      criteria: [],
      warnings,
    };
  }

  const execOptions: ExecuteOptions = {
    timeoutMs: options?.timeoutMs,
    cwd: options?.cwd,
  };

  const criteria: CriterionResult[] = [];
  // Q0.5/A3 — per-AC warnings for flaky+fired-exemption collision. Collected
  // inside the loop and concatenated into `warnings` after.
  const dualFlagWarnings: string[] = [];

  for (const ac of story.acceptanceCriteria) {
    // Q0.5/A1b — ac-lint short-circuit (non-exempt suspect ACs never execute).
    const lint = lintAcCommand(ac.command, { lintExempt: ac.lintExempt });
    if (lint.suspect) {
      const ruleIds = lint.findings
        .filter((f) => !f.exempt)
        .map((f) => f.ruleId)
        .join(",");
      criteria.push({
        id: ac.id,
        status: "SKIPPED",
        evidence: `ac-lint: suspect (rules: ${ruleIds}); command NOT executed`,
        reliability: "suspect",
      });
      continue;
    }

    // Q0.5/A3 — Option 2 detection (per forge-plan T1545). An AC whose
    // per-AC `lintExempt` entry FIRED (actively suppressed a real finding)
    // is tagged "unverified" on the normal execution path. Vestigial
    // exemptions (declared but nothing matched) stay "trusted". Plan-level
    // `ExecutionPlan.lintExempt[]` absorptions are OUT OF SCOPE — those
    // drop findings entirely and report "trusted" by construction
    // (deferred to Q0.5/A3-bis).
    const exemptionFired = lint.findings.some((f) => f.exempt === true);

    const firstRun = await executeCommand(ac.command, execOptions);

    // Q0.5/C2 — flaky retry gate. Only fires when (a) the AC author opted in
    // via `flaky: true`, (b) ac-lint passed clean (we're past the A1b
    // short-circuit), and (c) run-1 actually returned FAIL. PASS and
    // INCONCLUSIVE are NOT retried: PASS needs no retry, and INCONCLUSIVE
    // means the subprocess machinery itself failed (ENOENT, etc.) — retrying
    // won't fix a missing binary.
    if (ac.flaky === true && firstRun.status === "FAIL") {
      // Clamp negative/NaN to zero so a malformed option can never become a
      // long delay via setTimeout coercion (setTimeout itself already
      // clamps, but an explicit Math.max documents intent and survives
      // future refactors of `sleep`).
      const rawGap = options?.flakyRetryGapMs ?? DEFAULT_FLAKY_RETRY_GAP_MS;
      const gapMs = Number.isFinite(rawGap) ? Math.max(0, rawGap) : DEFAULT_FLAKY_RETRY_GAP_MS;
      await sleep(gapMs);
      const secondRun = await executeCommand(ac.command, execOptions);

      if (secondRun.status === "PASS") {
        // Flake detected — the retry passed but we can't fully trust the
        // result because the same command failed moments ago. Report PASS
        // so the AC doesn't block the verdict, but surface the soft signal
        // via reliability="suspect" and an evidence prefix so callers can
        // audit the flake rate downstream.
        // Q0.5/A3 — dual-flag warning (T1510 blessed + T1545 clarified). A flaky
        // AC whose exemption fired is reported as "suspect" (runtime signal
        // outranks authoring override) — but the collision itself is a soft
        // smell that deserves an explicit, per-AC warning so analytics can
        // grep for it. Scoped to the retry-PASS branch only: flake is a
        // property of the PASS path; both-FAIL stays tagged "unverified"
        // without a dual-flag warning (tag-vs-warning mismatch fixed).
        if (exemptionFired) {
          dualFlagWarnings.push(
            `AC '${ac.id}' has flaky: true AND a lintExempt entry whose exemption fired during this run — reporting as suspect (flake takes precedence). Override review recommended.`,
          );
        }
        criteria.push({
          id: ac.id,
          status: "PASS",
          evidence: `flaky-retry: first-run FAIL, retry PASS — ${secondRun.evidence}`,
          reliability: "suspect",
        });
        continue;
      }

      // Retry did not pass. Emit an evidence prefix that accurately reflects
      // run-2's actual status — FAIL means "both runs failed" (strongest
      // real-failure signal), INCONCLUSIVE means "run-2 subprocess machinery
      // broke" (e.g. ENOENT on retry; treat as flaky-then-infra rather than
      // real failure). Forward secondRun.status either way so downstream
      // aggregation behaves correctly.
      const prefix =
        secondRun.status === "FAIL"
          ? "flaky-retry: both runs FAIL"
          : `flaky-retry: run-1 FAIL, run-2 ${secondRun.status}`;
      criteria.push({
        id: ac.id,
        status: secondRun.status,
        evidence: `${prefix} — ${firstRun.evidence}`,
        reliability: exemptionFired ? "unverified" : "trusted",
      });
      continue;
    }

    criteria.push({
      id: ac.id,
      status: firstRun.status,
      evidence: firstRun.evidence,
      reliability: exemptionFired ? "unverified" : "trusted",
    });
  }

  // Q0.5/A3 — aggregate unverified-count warning (per T1545 text).
  const unverifiedCriteria = criteria.filter(
    (c) => c.reliability === "unverified",
  );
  const unverifiedCount = unverifiedCriteria.length;
  if (unverifiedCount > 0) {
    const unverifiedIds = unverifiedCriteria.map((c) => c.id);
    warnings.push(
      `${unverifiedCount} AC(s) ran with a fired lintExempt override — reliability is unverified (${unverifiedIds.join(", ")})`,
    );
  }
  // Q0.5/A3 — dual-flag per-AC warnings (flaky + fired exemption collision).
  warnings.push(...dualFlagWarnings);

  const verdict = computeVerdict(criteria);

  const report: EvalReport = {
    storyId,
    verdict,
    criteria,
  };

  if (warnings.length > 0) {
    report.warnings = warnings;
  }

  return report;
}

function computeVerdict(
  criteria: CriterionResult[],
): "PASS" | "FAIL" | "INCONCLUSIVE" {
  const hasFail = criteria.some((c) => c.status === "FAIL");
  if (hasFail) return "FAIL";

  const hasInconclusive = criteria.some((c) => c.status === "INCONCLUSIVE");
  if (hasInconclusive) return "INCONCLUSIVE";

  // Q0.5/#168 — SKIPPED criteria with reliability:"suspect" must NOT launder
  // to PASS. These are ACs that ac-lint short-circuited because the command
  // shape itself is broken (F55/F56/F36 rule match) — we have zero signal
  // about the code under test. Treating them as PASS would silently green-
  // light every story whose ACs are all deny-listed. Correct aggregation is
  // INCONCLUSIVE: "we don't know".
  const hasSuspectSkip = criteria.some(
    (c) => c.status === "SKIPPED" && c.reliability === "suspect",
  );
  if (hasSuspectSkip) return "INCONCLUSIVE";

  return "PASS";
}
