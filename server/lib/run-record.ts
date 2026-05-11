import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
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
    /**
     * v0.43.0 — discriminator for which spec-gen code path produced this
     * record. Additive-optional per P50; pre-v0.43.0 records lack this
     * field. Consumers should treat absence as "in-mcp" (the legacy
     * assumption). Distinct values:
     *   - "in-mcp": legacy v0.42.x path; MCP child called Anthropic directly.
     *   - "caller-action": v0.43.0 default; MCP child emitted a
     *      `callerAction: "generate-spec-inline"` directive and the caller
     *      (Claude Code session) generated the spec inline. The merge event
     *      is appended to the SAME run record by `forge_apply_spec_gen`.
     *   - "short-circuited-hand-author": evaluate.ts detected a
     *      `<!-- hand-authored ` marker in the on-disk spec at brief-build
     *      time. No directive emitted, no LLM call, no overwrite.
     */
    specGenMode?: "in-mcp" | "caller-action" | "short-circuited-hand-author";
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
  /**
   * v0.38.0 I2 — snapshot of the story's `affectedPaths` at evaluate time so
   * the dashboard can render per-path ✓/✗ existence indicators without having
   * to re-load the original plan file. Forward-only optional; omitted by
   * non-evaluate writers.
   */
  affectedPaths?: string[];
  /**
   * v0.39.0 G5 — environmental, non-fatal warnings emitted during a tool run.
   * The dashboard surfaces each entry on the relevant story card so operators
   * see "this story passed but with caveats" (e.g., a polyfill that was
   * skipped, an optional dependency that wasn't loaded). Empty array OR field
   * absent ⇒ no UI noise. Forward-only; pre-v0.39.0 records lack this field.
   *
   * Currently populated by `forge_evaluate` when its harness emits warnings
   * the operator should know about but that did not gate AC outcome.
   */
  nonFatalWarnings?: string[];
  outcome:
    | "success"
    | "failure"
    | "partial"
    | "validation-failure"
    | "api-error"
    | "timeout"
    | "corrector-failed"
    /**
     * v0.39.0 AC-4 — `forge_generate` is a pure brief-assembler with no
     * inherent pass/fail axis. Its run records use this dedicated outcome
     * literal so future tooling can match on it without conflating with
     * an evaluator's "success".
     */
    | "ok";
}

/**
 * Spec-generator warning entry — emitted by the post-hoc validator.
 * Discriminated union by `kind`:
 *   - "stripped-unknown-identifier": a backtick-quoted identifier in a spec
 *     bullet was not found in the source vocabulary, so the bullet was
 *     removed (strict mode) or flagged (warn mode).
 *   - "stripped-unknown-chain": a backtick-quoted dotted identifier (e.g.
 *     `Foo.bar`) named an OWNER that exists in the vocabulary but a MEMBER
 *     that does not — the call chain doesn't resolve per the AST harvest.
 *     Distinct from `stripped-unknown-identifier` so monday-bot-style
 *     mis-attribution (binding behaviour to a function chain that doesn't
 *     implement it) is observable in the run record. W5 (#516).
 *   - "no-vocabulary": grounding was lenient because no source vocabulary
 *     could be built (empty/unparseable affectedPaths). The spec was written
 *     verbatim without strips.
 *   - "spec-gen-failed": the spec-generator call itself threw (LLM error,
 *     filesystem write failure, schema-validation throw, etc). Was previously
 *     swallowed silently to stderr — F4 fix surfaces it on both the run
 *     record's `generatedDocs.warnings` AND the MCP top-level
 *     `specGenWarnings`. `message` is the truncated `Error.message` for
 *     consumer triage (no stack — error-class warning, not a debug payload).
 *   - "spec-gen-skipped-on-pass": the run is structurally incomplete — PASS
 *     verdict + synthesized-fallback `generatedDocs` (specPath:"" because
 *     spec-gen failed but the ADR extractor produced canonical paths
 *     downstream). Without this marker the consumer would see PASS + empty
 *     specPath silently. F4 fix.
 *   - "spec-gen-shell-only": the LLM call inside `generateSpecForStory`
 *     threw, but the structural shell of `TECHNICAL-SPEC.md` was still
 *     regenerated successfully — frontmatter `lastUpdated` and the story's
 *     section anchors are fresh; only the prose body is a byte-stable
 *     HTML-comment placeholder until LLM creds return. Distinct from
 *     `spec-gen-failed` (which only fires when `generateSpecForStory` itself
 *     throws — e.g. the placeholder write failed). I6 fix.
 *   - "spec-gen-creds-keychain-only": macOS-only diagnostic. Emitted
 *     alongside `spec-gen-shell-only` when the run fell through to no-creds
 *     on darwin AND a Keychain entry for "Claude Code-credentials" exists
 *     but `readOAuthToken()` could not read a usable blob from it (locked
 *     Keychain, prompt-timeout, ACL mismatch, malformed JSON). Tells the
 *     operator their creds are present-but-unreadable rather than missing —
 *     the actionable path is to set `ANTHROPIC_API_KEY` to bypass, not to
 *     "log in to Claude Code" (they already are). F6 fix in v0.40.5.
 */
export type SpecGeneratorWarning =
  | {
      kind: "stripped-unknown-identifier";
      identifier: string;
      section: string;
      filesScanned: number;
    }
  | {
      kind: "stripped-unknown-chain";
      chain: string;
      section: string;
      filesScanned: number;
    }
  | {
      kind: "no-vocabulary";
      filesScanned: number;
    }
  | {
      kind: "spec-gen-failed";
      message: string;
    }
  | {
      kind: "spec-gen-skipped-on-pass";
      message: string;
    }
  | {
      kind: "spec-gen-shell-only";
      message: string;
    }
  | {
      kind: "spec-gen-creds-keychain-only";
      message: string;
    }
  | {
      // v0.42.0 — emitted when `synth()` resolves successfully but returns
      // an empty / all-`(none)` sections object (e.g. LLM 200 OK with
      // `{sections: {}}` JSON-mode partial-success). The spec-generator
      // SKIPS the file write so existing TECHNICAL-SPEC content is preserved.
      // Distinct from `spec-gen-shell-only` (synth threw) — the synth call
      // succeeded but produced nothing usable. Plan AC-1b.
      kind: "spec-gen-empty-sections";
      message: string;
    }
  | {
      // v0.42.1 — emitted ALONGSIDE `spec-gen-shell-only` when the retry
      // loop exhausted on an HTTP 429 `RateLimitError` specifically (not
      // other shell-only failure modes). Additive-optional per P50:
      // legacy consumers that don't know about this kind still see the
      // `spec-gen-shell-only` warning in the same array; new consumers
      // can branch on this kind for operator-actionable mitigation
      // guidance (concurrent OAuth bucket pressure, env-var knobs).
      // v0.42.0's no-overwrite invariant still applies — the
      // TECHNICAL-SPEC file is preserved when this warning fires.
      kind: "spec-gen-rate-limit-exhausted";
      message: string;
    }
  | {
      // v0.43.0 (AC-3b) — forge_evaluate's PASS path detected a
      // `<!-- hand-authored ` marker on at least one sub-section of the
      // story's existing `## story: <id>` block in on-disk TECHNICAL-SPEC.md.
      // The PASS path refused to emit the `generate-spec-inline` directive
      // (the caller never gets work) AND refused to call Anthropic
      // directly on the legacy path. The verdict stays PASS; the existing
      // file is left UNCHANGED. Surfaced on BOTH the on-disk record's
      // `generatedDocs.warnings` AND the MCP top-level `specGenWarnings`.
      kind: "spec-gen-short-circuited-hand-author";
      message: string;
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
    kind: z.literal("stripped-unknown-chain"),
    chain: z.string(),
    section: z.string(),
    filesScanned: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("no-vocabulary"),
    filesScanned: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("spec-gen-failed"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("spec-gen-skipped-on-pass"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("spec-gen-shell-only"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("spec-gen-creds-keychain-only"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("spec-gen-empty-sections"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("spec-gen-rate-limit-exhausted"),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("spec-gen-short-circuited-hand-author"),
    message: z.string(),
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
  // v0.43.0 — additive optional. Legacy records lack the field; consumers
  // treat absence as "in-mcp".
  specGenMode: z
    .enum(["in-mcp", "caller-action", "short-circuited-hand-author"])
    .optional(),
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
 *
 * v0.43.0 — when `forcedSuffix` is provided (4-char hex), it replaces the
 * randomly generated one. This is how `forge_apply_spec_gen` lands its merge
 * event in the SAME run-record file as the brief-emit event from evaluate.ts
 * (AC-14 observability atomicity).
 */
export function makeRunFilename(
  tool: string,
  timestamp: string,
  forcedSuffix?: string,
): string {
  const safeDateStr = timestamp.replace(/[:.]/g, "-");
  const suffix = forcedSuffix ?? randomBytes(2).toString("hex");
  return `${tool}-${safeDateStr}-${suffix}.json`;
}

/**
 * v0.43.0 — generate a fresh 4-char hex run-id. Used by `forge_evaluate`
 * when it emits a `callerAction: "generate-spec-inline"` directive so the
 * caller can round-trip the id back through `forge_apply_spec_gen` (AC-14).
 */
export function generateRunId(): string {
  return randomBytes(2).toString("hex");
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
  options?: { runId?: string },
): Promise<void> {
  try {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });

    // v0.43.0 — when `runId` is provided, the filename suffix uses it
    // verbatim so brief-emit + merge events share one record file (AC-14).
    const filename = makeRunFilename(
      record.tool,
      record.timestamp,
      options?.runId,
    );
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

/**
 * v0.43.0 — locate the run record whose filename suffix matches `runId`
 * under `<projectPath>/.forge/runs/`, merge the supplied patch fields
 * onto it, and rewrite the file in place. This is how `forge_apply_spec_gen`
 * attaches its merge event to the SAME record that `forge_evaluate` wrote
 * when it emitted the brief-emit event (AC-14 observability atomicity).
 *
 * Returns the resolved file path on success, or `null` when no matching
 * run record file was found (caller should fall back to creating a fresh
 * record file rather than dropping the merge event silently).
 *
 * Failure to read/parse/write is logged + swallowed (mirrors `writeRunRecord`).
 */
export async function findAndMergeRunRecord(
  projectPath: string,
  runId: string,
  patch: {
    generatedDocs?: NonNullable<RunRecord["generatedDocs"]>;
    totalCostUsd?: number | null;
  },
): Promise<string | null> {
  try {
    const runsDir = join(projectPath, ".forge", "runs");
    let entries: string[];
    try {
      entries = await readdir(runsDir);
    } catch {
      return null;
    }
    // Filename shape: `<tool>-<timestamp>-<suffix>.json`. We match by
    // suffix == runId (4-char hex). The `.json` extension AND `-` separator
    // anchor the suffix so a runId substring earlier in the name won't false-match.
    const target = entries.find((e) => e.endsWith(`-${runId}.json`));
    if (!target) return null;
    const filePath = join(runsDir, target);
    const raw = await readFile(filePath, "utf-8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.error(
        `forge: failed to parse run record ${filePath} for runId=${runId} (continuing):`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    if (patch.generatedDocs !== undefined) {
      parsed.generatedDocs = patch.generatedDocs;
    }
    if (patch.totalCostUsd !== undefined) {
      parsed.totalCostUsd = patch.totalCostUsd;
    }
    await writeFile(filePath, JSON.stringify(parsed, null, 2), "utf-8");
    return filePath;
  } catch (err) {
    console.error(
      `forge: findAndMergeRunRecord(runId=${runId}) failed (continuing):`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
