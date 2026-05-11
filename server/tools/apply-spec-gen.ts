/**
 * forge_apply_spec_gen — v0.43.0 server-side merge half of the directive flow.
 *
 * The MCP tool a Claude Code caller invokes AFTER it has generated the
 * spec-gen content inline (via the `callerAction: "generate-spec-inline"`
 * directive returned by `forge_evaluate`'s PASS path).
 *
 * Responsibility split:
 *   - forge_evaluate emits the directive + `specGenBrief` payload + `runId`.
 *   - Caller (Claude Code session) does ONE LLM round-trip using the
 *     pre-rendered systemPrompt / userPrompt.
 *   - forge_apply_spec_gen accepts the LLM's parsed JSON output + runId,
 *     re-samples on-disk content (AC-6 race-window check), merges into
 *     TECHNICAL-SPEC.md via the shared `applySpecGenResult` code path
 *     (inherits v0.42.0 preserve-invariant), and appends the merge event
 *     onto the SAME `.forge/runs/forge_evaluate-*.json` file the directive
 *     was emitted from (AC-14).
 *
 * Makes ZERO Anthropic API calls. By design — the whole point of the
 * directive flow is keeping the MCP child off the OAuth bucket that
 * returns header-less anti-abuse 429s.
 */

import { z } from "zod";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { EvalReport } from "../types/eval-report.js";
import {
  applySpecGenResult,
  type BuildSpecGenBriefInput,
  type CallerSpecGenResult,
} from "../lib/spec-generator.js";
import {
  computeSpecGenCostUsd,
  findAndMergeRunRecord,
  type RunRecord,
} from "../lib/run-record.js";

// ── Input Schema (Zod) ────────────────────────────────────

/**
 * Input shape enforced by the MCP runtime BEFORE the handler runs.
 *
 * AC-5 contract: malformed input MUST be rejected by this schema BEFORE
 * any merge work happens. Missing `sections.invariants`, a non-string
 * `runId`, a wrongly-typed `tokens` value — all surface as a Zod
 * validation error and the file bytes stay unchanged.
 */
export const applySpecGenInputSchema = {
  runId: z
    .string()
    .regex(/^[0-9a-f]{4}$/, "runId must be 4-char lowercase hex")
    .describe(
      "The runId echoed from forge_evaluate's specGenBrief. The merge event will be appended to the same .forge/runs/forge_evaluate-{timestamp}-{runId}.json file.",
    ),
  storyId: z
    .string()
    .min(1)
    .describe("Story ID this spec section belongs to (e.g., US-01)."),
  projectPath: z
    .string()
    .min(1)
    .describe("Absolute path to project root (the directory containing docs/generated/TECHNICAL-SPEC.md)."),
  sections: z
    .object({
      "api-contracts": z.string(),
      "data-models": z.string(),
      invariants: z.string(),
      "test-surface": z.string(),
    })
    .describe(
      "Caller-generated content for each of the four canonical sub-sections under ## story: <storyId>. Use literal '(none)' for sections that have nothing to record. Empty/all-(none) sections preserve existing on-disk content (v0.42.0 no-overwrite invariant).",
    ),
  contracts: z
    .array(z.string())
    .describe(
      "MCP tool ids the story's diff touches (e.g., ['forge_evaluate', 'forge_generate']). Empty array if none.",
    ),
  tokens: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .describe(
      "Token usage from the caller's LLM round-trip. Used by the run record's totalCostUsd rollup.",
    ),
  tokensEstimated: z
    .boolean()
    .optional()
    .describe(
      "Optional: when true, the caller computed `tokens` via a byte/4 estimate (e.g. /forge-execute v1.1.0 in-session spec-inline path where Claude cannot observe its own LLM usage). Threaded onto `generatedDocs.tokensEstimated` so cost-audit consumers can mark the totalCostUsd as approximate.",
    ),
  affectedPaths: z
    .array(z.string())
    .optional()
    .describe(
      "Optional: the story's affectedPaths from the original brief. When provided, the vocabulary-grounding post-validator re-runs against the merged content. Omitting it disables grounding for this merge.",
    ),
  evalReport: z
    .unknown()
    .optional()
    .describe(
      "Optional: the eval report from the original brief. Accepted for schema compatibility with the legacy in-MCP shape; currently no-op in the apply path (the field is not persisted to the run record). May be threaded into the brief-emit echo in a future revision.",
    ),
  gitSha: z
    .string()
    .optional()
    .describe(
      "Optional: 40-char hex git SHA captured at evaluate-time. Stamps onto the spec front-matter as lastGitSha.",
    ),
};

// v0.36.0 Phase D (AC-D5) named-export convention.
export const ToolInputSchemaShape = applySpecGenInputSchema;

type ApplySpecGenInput = {
  runId: string;
  storyId: string;
  projectPath: string;
  sections: {
    "api-contracts": string;
    "data-models": string;
    invariants: string;
    "test-surface": string;
  };
  contracts: string[];
  tokens: { inputTokens: number; outputTokens: number };
  tokensEstimated?: boolean;
  affectedPaths?: string[];
  evalReport?: unknown;
  gitSha?: string;
};

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Handler ───────────────────────────────────────────────

export async function handleApplySpecGen(
  input: ApplySpecGenInput,
): Promise<McpResponse> {
  // v0.43.2 (I1 fold) — pre-validate runId before any disk mutation. The Zod
  // schema only checks shape (4-char lowercase hex); it cannot verify the
  // runId corresponds to a real brief-emit record. Without this probe, a
  // syntactically-valid but nonexistent runId would still trigger the spec
  // file write, with only a log-and-continue warning when findAndMergeRunRecord
  // (line ~210 below) fails to locate the record. Closing the disk-mutates-
  // without-observability gap is the v0.43.2 correctness win.
  const runsDir = join(input.projectPath, ".forge", "runs");
  let runRecordExists = false;
  try {
    const entries = await readdir(runsDir);
    runRecordExists = entries.some((e) => e.endsWith(`-${input.runId}.json`));
  } catch {
    runRecordExists = false;
  }
  if (!runRecordExists) {
    return {
      content: [
        {
          type: "text",
          text: `forge_apply_spec_gen error: no brief-emit run record found for runId=${input.runId} under ${input.projectPath}/.forge/runs/. The runId must be echoed verbatim from a prior forge_evaluate call that emitted a generate-spec-inline directive.`,
        },
      ],
      isError: true,
    };
  }

  // Reuse the lib-layer merge logic. `applySpecGenResult` is the canonical
  // single locus for: (a) AC-6 race-window hand-author preserve, (b) v0.42.0
  // empty-sections no-overwrite invariant, (c) vocabulary-grounded post-validator.
  const briefInput: BuildSpecGenBriefInput = {
    projectPath: input.projectPath,
    storyId: input.storyId,
    // We only need a placeholder eval report for the merge call (the field is
    // not used by applySpecGenResult except to thread through to the result
    // shape if needed); accept the caller's snapshot when provided, else
    // construct a minimal PASS placeholder. AC-5 still validates input
    // schema-shape regardless.
    evalReport: (input.evalReport as EvalReport | undefined) ?? {
      storyId: input.storyId,
      verdict: "PASS",
      criteria: [],
    },
    affectedPaths: input.affectedPaths,
    gitSha: input.gitSha,
  };
  const callerResult: CallerSpecGenResult = {
    sections: input.sections,
    contracts: input.contracts,
    tokens: input.tokens,
  };

  let result;
  try {
    result = applySpecGenResult(briefInput, callerResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `forge_apply_spec_gen error: ${message}`,
        },
      ],
      isError: true,
    };
  }

  // AC-14 — append the merge event onto the SAME run record the brief-emit
  // event was written to. The runId is the 4-char hex suffix on the file
  // name. When the brief-emit record cannot be located (e.g. caller passed
  // a stale runId, or the file was hand-deleted), we log + continue — the
  // merge itself succeeded; only observability degraded.
  const generatedDocs: NonNullable<RunRecord["generatedDocs"]> = {
    specPath: result.specPath,
    adrPaths: [],
    genTimestamp: result.genTimestamp,
    genTokens: result.genTokens,
    contracts: result.contracts,
    warnings: result.warnings,
    specGenMode: "caller-action",
    ...(input.tokensEstimated === true ? { tokensEstimated: true } : {}),
  };
  // totalCostUsd: forge_apply_spec_gen owns the spec-gen leg's cost; the
  // run-level (shell-AC) cost was already recorded by evaluate.ts in the
  // brief-emit event. The shared rollup re-derives from genTokens. We
  // overwrite the prior `generatedDocs` envelope so its `specGenMode` flips
  // from "caller-action-pending" (set at brief-emit) to "caller-action".
  const totalCostUsd = computeSpecGenCostUsd(result.genTokens);

  const mergedPath = await findAndMergeRunRecord(
    input.projectPath,
    input.runId,
    { generatedDocs, totalCostUsd },
  );
  if (mergedPath === null) {
    console.error(
      `forge_apply_spec_gen: could not locate run record for runId=${input.runId} under ${input.projectPath}/.forge/runs/ (continuing; merge succeeded on disk but the event will not be visible in observability)`,
    );
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            specPath: result.specPath,
            warnings: result.warnings,
            contracts: result.contracts,
            bodyChanged: result.bodyChanged,
            runRecordPath: mergedPath,
          },
          null,
          2,
        ),
      },
    ],
  };
}
