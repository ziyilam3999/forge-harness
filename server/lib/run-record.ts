import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { EvalReport, CriterionResult } from "../types/eval-report.js";
import { writeActivity } from "./activity.js";
import { renderDashboard } from "./dashboard-renderer.js";

/**
 * Q0.5/C1 critic-eval report — per-plan critic findings aggregated across
 * one or more plan files. Populated by `forge_evaluate(mode:"critic")`.
 *
 * Per-plan failure tolerance: if a single plan fails to parse or the LLM
 * call errors, the corresponding entry carries an `error` field and
 * `findings: []`; the overall run continues with the remaining plans.
 */
export interface CriticEvalReport {
  evaluationMode: "critic";
  results: Array<{
    planPath: string;
    findings: unknown[];
    error?: string;
  }>;
}

/**
 * A run record captures metrics from a single forge primitive invocation.
 * Written to `.forge/runs/` for self-improvement analytics across runs.
 *
 * REQ-01 v1.1 additive fields (storyId / evalVerdict / evalReport /
 * metrics.estimatedCostUsd) are optional — old records without them remain
 * valid (P50 additive, no schema version bump).
 */
export interface RunRecord {
  timestamp: string;
  tool: "forge_plan" | "forge_evaluate" | "forge_generate" | "forge_coordinate";
  documentTier: "master" | "phase" | "update" | null;
  mode: "feature" | "bugfix" | "full-project" | null;
  tier: "quick" | "standard" | "thorough" | null;
  storyId?: string;
  evalVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  /**
   * v0.38.0 B2 — top-level alias of `evalVerdict`. Additive forward-compatible
   * so consumers that probe for `verdict` (the more natural name) don't have
   * to know about the historical `evalVerdict` field. Always written when
   * `evalVerdict` is present; the two fields stay byte-identical (string
   * compare) on every record. Pre-v0.38.0 records lack this field — readers
   * should fall back to `evalVerdict` when missing.
   */
  verdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  escalationReason?: string;
  evalReport?: EvalReport;
  /**
   * Q0.5/C1 critic-eval mode output. Populated only when the run was a
   * `forge_evaluate(mode:"critic")` invocation. Additive optional field,
   * mirrors the `evalReport?` pattern above (no schema version bump).
   */
  criticReport?: CriticEvalReport;
  /**
   * Git SHA of HEAD at the moment the RunRecord is written (40-char hex).
   * v0.35.1 additive-optional field: populated by `forge_evaluate` when the
   * story PASSes so `forge_status` can surface `lastGitSha` (`server/tools/status.ts`
   * previously hardcoded `null`). Omitted when (a) projectPath is not a git
   * working copy, (b) the git call fails for any reason, or (c) the record is
   * written by a tool other than evaluate. Forward-only — historical records
   * lacking this field remain valid.
   */
  gitSha?: string;
  /**
   * v0.36.0 Phase B — auto-generated documentation artefacts produced as a
   * side-effect of a story-mode PASS. Populated by `server/lib/spec-generator.ts`
   * (and, in a later phase, the ADR extractor). Forward-only and additive-
   * optional: pre-v0.36.0 records and any non-PASS records simply omit the
   * field. Consumers should treat absence the same as `{}`.
   *
   * Fields:
   *   - `specPath`     : absolute path to `docs/generated/TECHNICAL-SPEC.md`
   *                      after the synchronous spec-generator wrote/updated it.
   *   - `adrPaths`     : Phase C populates this; Phase B always emits `[]`.
   *   - `genTimestamp` : ISO-8601 stamp at the moment the spec mutation landed.
   *   - `genTokens`    : `{ inputTokens, outputTokens }` for the spec-gen LLM
   *                      call alone (separate from the run-level `metrics`
   *                      totals so per-doc cost can be audited independently).
   *   - `contracts`    : MCP tool ids (e.g. `forge_evaluate`) that the
   *                      spec-generator declared touched. Powers AC-B4's
   *                      contract-coverage check (`spec-contract-coverage.mjs`).
   */
  generatedDocs?: {
    specPath: string;
    adrPaths: string[];
    genTimestamp: string;
    genTokens: { inputTokens: number; outputTokens: number };
    contracts: string[];
    /**
     * Soft-failure log emitted by spec-generator's grounding validator.
     * Currently populated with `{ kind: "stripped-unknown-identifier", ... }`
     * entries when the post-validator removes a backtick-quoted identifier
     * not found in the source vocabulary. ALWAYS emitted (empty array if
     * no strips happened) so consumers can rely on the field's presence.
     *
     * Forward-only: pre-2026-04-26 RunRecords lack this field; the Zod
     * schema below uses `.default([])` so historical records still parse.
     */
    warnings: SpecGeneratorWarning[];
  };
  metrics: {
    inputTokens: number;
    outputTokens: number;
    critiqueRounds: number;
    findingsTotal: number;
    findingsApplied: number;
    findingsRejected: number;
    validationRetries: number;
    durationMs: number;
    estimatedCostUsd?: number | null;
    /**
     * v0.38.0 B3 — count of `npm run build` invocations the evaluator ran for
     * this story. When all ACs share an identical `npm run build &&` prefix,
     * the evaluator runs build ONCE and rewrites each AC's command to drop the
     * shared prefix, so this field reads `1` instead of N. When ACs do not
     * share a common build prefix, the field is omitted (legacy behavior).
     */
    buildInvocationCount?: number;
  };
  /**
   * v0.38.0 B5 — rolled-up cost across the run-level cost tracker AND any
   * sub-LLM calls captured separately on `generatedDocs.genTokens`. Computed
   * as `metrics.estimatedCostUsd + (genTokens.inputTokens * inputPerMillion +
   * genTokens.outputTokens * outputPerMillion) / 1_000_000` where the per-million
   * rates match `server/lib/cost.ts`'s default model (claude-sonnet-4-6).
   * Omitted when `metrics.estimatedCostUsd` is null or no spec-gen call ran.
   * Forward-only: pre-v0.38.0 records lack this field.
   */
  totalCostUsd?: number | null;
  outcome:
    | "success"
    | "failure"
    | "partial"
    | "validation-failure"
    | "api-error"
    | "timeout"
    | "corrector-failed";
}

/**
 * Spec-generator warning entry — emitted by the post-hoc validator.
 * Discriminated union by `kind`:
 *   - "stripped-unknown-identifier": a backtick-quoted identifier in a spec
 *     bullet was not found in the source vocabulary, so the bullet was
 *     removed (strict mode) or flagged (warn mode).
 *   - "no-vocabulary": grounding was lenient because no source vocabulary
 *     could be built (empty/unparseable affectedPaths). The spec was written
 *     verbatim without strips.
 */
export type SpecGeneratorWarning =
  | {
      kind: "stripped-unknown-identifier";
      identifier: string;
      section: string;
      filesScanned: number;
    }
  | {
      kind: "no-vocabulary";
      filesScanned: number;
    };

/**
 * Zod schema for `RunRecord.generatedDocs` — gives runtime validation for
 * AC-10 (warnings is a typed array, default `[]`). Pairs with the static
 * TypeScript interface above; the two MUST stay in sync. Designed
 * additive-only: a real run-record JSON missing the `warnings` field still
 * parses cleanly because of `.default([])`.
 */
export const SpecGeneratorWarningSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stripped-unknown-identifier"),
    identifier: z.string(),
    section: z.string(),
    filesScanned: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("no-vocabulary"),
    filesScanned: z.number().int().nonnegative(),
  }),
]);

export const GeneratedDocsSchema = z.object({
  specPath: z.string(),
  adrPaths: z.array(z.string()),
  genTimestamp: z.string(),
  genTokens: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  contracts: z.array(z.string()),
  warnings: z.array(SpecGeneratorWarningSchema).default([]),
});

/**
 * v0.38.0 B5 — token-rate constants for the spec-generator's default model.
 * Mirrors the `claude-sonnet-4-6` row of `server/lib/cost.ts`'s PRICING table
 * (the spec-gen call uses the default model — no explicit `model:` is passed
 * in `defaultSynthesize`). Re-declared here to avoid a circular import; if
 * the central PRICING table ever drifts, this constant must move with it.
 */
const SPEC_GEN_INPUT_PER_MILLION = 3.0;
const SPEC_GEN_OUTPUT_PER_MILLION = 15.0;

/**
 * Compute the spec-gen sub-LLM cost in USD from a `genTokens` snapshot.
 * Uses the same per-million rates as `server/lib/cost.ts` for the default
 * spec-gen model. Returns 0 when both token counts are zero (e.g. ADR-only
 * fallback path that synthesises generatedDocs without an LLM call).
 *
 * Exported so AC-10's verification expression can reuse the same math the
 * production writer uses — guarantees byte-identical equality on disk vs
 * spec.
 */
export function computeSpecGenCostUsd(
  genTokens: { inputTokens: number; outputTokens: number } | undefined,
): number {
  if (!genTokens) return 0;
  return (
    (genTokens.inputTokens / 1_000_000) * SPEC_GEN_INPUT_PER_MILLION +
    (genTokens.outputTokens / 1_000_000) * SPEC_GEN_OUTPUT_PER_MILLION
  );
}

/**
 * Canonicalize an EvalReport for deterministic serialization (REQ-01 v1.1).
 *
 * Sorts `criteria` by `(id, evidence)` lexicographically so two reports with
 * the same criteria in different input orders produce byte-identical JSON
 * output. Preserves NFR-C02 (deterministic dispatch) and NFR-C10 (golden-file
 * byte-identity) preconditions.
 *
 * Note: the PRD/phase-plan wording refers to `EvalReport.findings` sorted by
 * `(failedAcId, description)`, but the actual `EvalReport` shape exposes
 * `criteria: CriterionResult[]` with `{id, status, evidence}`. This helper
 * adapts the spec to the real type — sort-by-id-then-evidence is the direct
 * analog of sort-by-failedAcId-then-description.
 */
export function canonicalizeEvalReport(report: EvalReport): EvalReport {
  const sortedCriteria: CriterionResult[] = [...report.criteria].sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.evidence !== b.evidence) return a.evidence < b.evidence ? -1 : 1;
    return 0;
  });
  return { ...report, criteria: sortedCriteria };
}

/**
 * Generate a Windows-safe filename for a run record.
 * Format: {tool}-{timestamp}-{suffix}.json
 * The 4-char hex suffix handles same-millisecond collisions.
 */
function makeRunFilename(tool: string, timestamp: string): string {
  const safeDateStr = timestamp.replace(/[:.]/g, "-");
  const suffix = randomBytes(2).toString("hex");
  return `${tool}-${safeDateStr}-${suffix}.json`;
}

/**
 * Write a run record to `.forge/runs/`. Creates the directory if needed.
 * Failure is logged and swallowed — never crashes the tool.
 *
 * CANONICAL: this is the RunRecord writer used by forge_plan, forge_evaluate,
 * and (future) forge_coordinate. One JSON file per invocation, schema defined
 * by the `RunRecord` interface above (includes `tool`, `metrics`, etc.).
 *
 * Not to be confused with `appendGeneratorIterationRecord` in
 * `./generator.ts`, which is the separate JSONL iteration-stream writer used
 * internally by forge_generate for per-iteration self-tracking (different
 * schema, different file: `.forge/runs/data.jsonl`).
 */
export async function writeRunRecord(
  projectPath: string,
  record: RunRecord,
): Promise<void> {
  try {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });

    const filename = makeRunFilename(record.tool, record.timestamp);
    const filePath = join(runsDir, filename);

    await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
  } catch (err) {
    console.error(
      "forge: failed to write run record (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Dashboard hooks (S8, additive, non-fatal): after a primitive finishes,
  // clear the in-flight activity signal and re-render the dashboard so the
  // operator sees the story move out of the "In Progress" column. Both
  // callees swallow their own errors, but we also wrap the whole block
  // so that any hook failure never crashes this function.
  try {
    await writeActivity(projectPath, null);
    await renderDashboard(projectPath);
  } catch (err) {
    console.error(
      "forge: failed to update dashboard post-run-record (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
