import { platform as nodePlatform } from "node:os";
import type {
  AcceptanceCriterion,
  ExecutionPlan,
} from "../types/execution-plan.js";
import type {
  SmokeReport,
  SmokeReportEntry,
  SmokeVerdict,
} from "../types/smoke-report.js";
import { smokeExecute, type SmokeExecuteResult } from "./executor.js";
import { lintAcCommand } from "../validation/ac-lint.js";

/**
 * Q0.5/B1 — Smoke-test runner.
 *
 * Orchestrates per-AC characterization for `forge_evaluate(mode:"smoke-test")`.
 * Emits exactly one `SmokeReportEntry` per AC in the plan (completeness
 * invariant — see B1 D3: the single emission site prevents "forgot to emit"
 * bugs at the cost of some branching).
 *
 * Single emission-site invariant: every `continue` in the loop must push an
 * entry first. Do not add an early-return without auditing the caller for
 * length-based invariants.
 */

export const DEFAULT_SMOKE_TIMEOUT_MS = 30_000;
export const MAX_SMOKE_TIMEOUT_MS = 180_000;
export const WINDOWS_COLD_START_WARMUP_MS = 800;
const SLOW_THRESHOLD_FRACTION = 0.8;

export interface SmokeTestPlanOptions {
  cwd?: string;
  /**
   * Test-only platform override. Production callers never pass this. When
   * `"win32"`, the Windows cold-start warmup subtraction is applied regardless
   * of the actual host OS, so tests exercise the subtraction on any runner.
   */
  platformOverride?: NodeJS.Platform;
  /**
   * Test-only executor override. Substituted for `smokeExecute` when present.
   * Production callers use the real executor.
   */
  executorOverride?: (
    command: string,
    opts: { timeoutMs: number; cwd?: string },
  ) => Promise<SmokeExecuteResult>;
}

/**
 * Clamp `smokeTimeoutMs` per B1/D2. All out-of-band values (undefined, NaN,
 * negative, zero) collapse to the default; only positive finite values in
 * (0, 180000] survive, with values above the cap rounded down.
 *
 * This is the ONLY place smokeTimeoutMs clamping happens — execution-plan.ts
 * intentionally declares the field as plain `number` to keep this function
 * the single source of truth. See B1 plan D2 for the rationale.
 */
export function clampSmokeTimeoutMs(
  raw: number | undefined | null,
): number {
  if (raw === undefined || raw === null) return DEFAULT_SMOKE_TIMEOUT_MS;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_SMOKE_TIMEOUT_MS;
  }
  if (raw <= 0) return DEFAULT_SMOKE_TIMEOUT_MS;
  if (raw > MAX_SMOKE_TIMEOUT_MS) return MAX_SMOKE_TIMEOUT_MS;
  return raw;
}

/**
 * Classify a raw `SmokeExecuteResult` into a (verdict, timeoutRisk) pair.
 *
 * Precedence: `hung` wins (explicit flag), then `empty-evidence`
 * (exitCode !== 0 AND zero bytes on both streams), then `slow`
 * (elapsedMs >= 80% of the timeout budget), then `ok`.
 *
 * `timeoutRisk: true` is emitted ONLY when `verdict === "slow"` AND the
 * author did NOT set an explicit `smokeTimeoutMs` override — explicit
 * overrides are consent that the AC legitimately needs the larger budget.
 */
function classifySmokeResult(
  raw: SmokeExecuteResult,
  timeoutBudgetMs: number,
  hadExplicitOverride: boolean,
): { verdict: SmokeVerdict; timeoutRisk: boolean } {
  if (raw.hungOnTimeout) {
    return { verdict: "hung", timeoutRisk: false };
  }
  const totalBytes = raw.stdoutBytes + raw.stderrBytes;
  if (raw.exitCode !== 0 && totalBytes === 0) {
    return { verdict: "empty-evidence", timeoutRisk: false };
  }
  if (raw.elapsedMs >= timeoutBudgetMs * SLOW_THRESHOLD_FRACTION) {
    return { verdict: "slow", timeoutRisk: !hadExplicitOverride };
  }
  return { verdict: "ok", timeoutRisk: false };
}

/**
 * Apply the Windows cold-start warmup subtraction to the first AC's elapsed
 * time. Only applies when `platform === "win32"` AND this is the first AC
 * (index 0). Floors at zero — no negative elapsedMs in reports.
 */
function applyWindowsWarmup(
  elapsedMs: number,
  isFirstAc: boolean,
  platform: NodeJS.Platform,
): number {
  if (!isFirstAc) return elapsedMs;
  if (platform !== "win32") return elapsedMs;
  return Math.max(0, elapsedMs - WINDOWS_COLD_START_WARMUP_MS);
}

/**
 * Run smoke-test against every AC in every story of the plan.
 *
 * Invariant: `report.entries.length === total AC count` — verified by
 * test 8 in `smoke-runner.test.ts`. Every loop iteration MUST push exactly
 * one entry before `continue`ing.
 */
export async function smokeTestPlan(
  plan: ExecutionPlan,
  options: SmokeTestPlanOptions = {},
): Promise<SmokeReport> {
  const platform = options.platformOverride ?? nodePlatform();
  const executor = options.executorOverride ?? smokeExecute;
  const entries: SmokeReportEntry[] = [];

  let acIndex = 0;
  for (const story of plan.stories) {
    for (const ac of story.acceptanceCriteria) {
      const isFirstAc = acIndex === 0;
      acIndex++;

      // Step 1: ac-lint short-circuit. If a non-exempt rule matches, emit
      // skipped-suspect WITHOUT execution. The emission site stays inside
      // the loop — do not hoist this into the router (B1 D3).
      const lint = lintAcCommand(ac.command, { lintExempt: ac.lintExempt });
      if (lint.suspect) {
        const nonExemptRules = lint.findings
          .filter((f) => !f.exempt)
          .map((f) => f.ruleId)
          .join(",");
        entries.push({
          acId: ac.id,
          verdict: "skipped-suspect",
          exited: null,
          elapsedMs: null,
          evidenceBytes: null,
          timeoutRisk: false,
          reason: nonExemptRules,
        });
        continue;
      }

      // Step 2: resolve the per-AC timeout budget. Clamp defends against
      // malformed overrides per B1/D2 — every invalid value collapses to
      // the default.
      const hadExplicitOverride =
        ac.smokeTimeoutMs !== undefined && ac.smokeTimeoutMs !== null;
      const timeoutBudgetMs = clampSmokeTimeoutMs(ac.smokeTimeoutMs);

      // Step 3: run smokeExecute. Errors bubble out — the caller decides
      // whether a transport failure aborts the whole sweep or marks the
      // AC. For now, let it throw: an unexpected executor error means the
      // smoke-runner harness itself is broken and retrying won't help.
      const raw = await executor(ac.command, {
        timeoutMs: timeoutBudgetMs,
        cwd: options.cwd,
      });

      const elapsedMs = applyWindowsWarmup(
        raw.elapsedMs,
        isFirstAc,
        platform,
      );

      const { verdict, timeoutRisk } = classifySmokeResult(
        raw,
        timeoutBudgetMs,
        hadExplicitOverride,
      );

      entries.push({
        acId: ac.id,
        verdict,
        exited: raw.exitCode,
        elapsedMs,
        evidenceBytes: raw.stdoutBytes + raw.stderrBytes,
        timeoutRisk,
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    entries,
  };
}

/**
 * Minimal shape to satisfy the per-AC smokeTimeoutMs lookup. Exported for
 * tests that want to build synthetic plans without importing the full
 * ExecutionPlan type.
 */
export type SmokeTestAc = Pick<
  AcceptanceCriterion,
  "id" | "command" | "lintExempt" | "smokeTimeoutMs"
>;
