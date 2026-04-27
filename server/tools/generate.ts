import { z } from "zod";
import {
  assembleGenerateResultWithContext,
  ADR_CAPTURE_TRIGGERS,
  ADR_CAPTURE_INSTRUCTIONS,
  type AssembleInput,
} from "../lib/generator.js";
import type { EvalReport } from "../types/eval-report.js";
import { writeActivity } from "../lib/activity.js";
import { writeRunRecord, type RunRecord } from "../lib/run-record.js";

// v0.36.0 Phase C (AC-C5): re-export the ADR capture contract so the tool
// surface is the single import point for clients that want to inspect the
// triggers without pulling in the assembler. Wrapper greps THIS file for
// `adrCapture` + the four canonical trigger keywords (new external dependency,
// schema version bumped, cross-module boundary, established pattern bypass).
//
// Triggers verbatim (do not paraphrase):
//   1. new external dependency added to `package.json`
//   2. any persisted-data or wire-format schema version bumped (`schema/*.json`,
//      JSONL/JSON record shapes in `.forge/`, MCP-tool input/output Zod surface)
//   3. new cross-module boundary introduced in `server/` (a module imported
//      across a previously-isolated subtree)
//   4. bypass or override of an existing established pattern documented in
//      `hive-mind-persist/knowledge-base/01-proven-patterns.md` (P-numbered)
export { ADR_CAPTURE_TRIGGERS, ADR_CAPTURE_INSTRUCTIONS };
export type { AdrCaptureGuidance } from "../types/generate-result.js";

// ── Input Schema ─────────────────────────────────

export const generateInputSchema = {
  storyId: z.string().describe("Story ID to implement (e.g., US-01)"),

  // Plan source — at least one required
  planJson: z
    .string()
    .optional()
    .describe(
      "Inline execution plan JSON string. Takes precedence over planPath.",
    ),
  planPath: z
    .string()
    .optional()
    .describe("Absolute path to execution plan JSON file"),

  // Eval report — present on fix iterations, absent on init
  evalReport: z
    .string()
    .optional()
    .describe(
      "JSON-serialized EvalReport from forge_evaluate. Presence triggers fix/escalate path; absence triggers init path.",
    ),

  // Iteration control
  iteration: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Current iteration number (0 = init). Default: 0"),
  maxIterations: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum iterations before forced escalation. Default: 3"),
  previousScores: z
    .array(z.number())
    .optional()
    .describe(
      "Score history from prior iterations. Used for plateau detection (3+ identical trailing scores).",
    ),

  // Hash-based no-op detection
  fileHashes: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "SHA-256 file hashes from the current iteration. Keys are file paths, values are hashes.",
    ),
  previousFileHashes: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "SHA-256 file hashes from the previous iteration. Compared with fileHashes for no-op detection.",
    ),

  // Project context
  projectPath: z
    .string()
    .optional()
    .describe(
      "Absolute path to the project root. Enables codebase scanning, JSONL tracking, and audit logging.",
    ),

  // Baseline diagnostics
  baselineDiagnostics: z
    .string()
    .optional()
    .describe(
      'JSON-serialized baseline failure diagnostics: {exitCode: number, stderr: string, failingTests: string[]}. Triggers "baseline-failed" escalation.',
    ),

  // Billing context
  isMaxUser: z
    .boolean()
    .optional()
    .describe(
      "Whether the caller is on Claude Code Max (unlimited). Default: true. Affects cost projections.",
    ),

  // Three-tier document inputs (REQ-09)
  prdContent: z
    .string()
    .optional()
    .describe("PRD/vision document content for brief.documentContext"),
  masterPlanContent: z
    .string()
    .optional()
    .describe("Master plan content for brief.documentContext"),
  phasePlanContent: z
    .string()
    .optional()
    .describe("Phase plan content for brief.documentContext"),

  // Context injection (REQ-10)
  contextFiles: z
    .array(z.string())
    .optional()
    .describe(
      "Array of absolute file paths whose contents are injected into the brief. Missing files are skipped with a warning.",
    ),
};

// v0.36.0 Phase D (AC-D5): canonical named export — see coordinate.ts for rationale.
export const ToolInputSchemaShape = generateInputSchema;

// ── Handler ──────────────────────────────────────

type GenerateInput = {
  storyId: string;
  planJson?: string;
  planPath?: string;
  evalReport?: string;
  iteration?: number;
  maxIterations?: number;
  previousScores?: number[];
  fileHashes?: Record<string, string>;
  previousFileHashes?: Record<string, string>;
  projectPath?: string;
  baselineDiagnostics?: string;
  isMaxUser?: boolean;
  prdContent?: string;
  masterPlanContent?: string;
  phasePlanContent?: string;
  contextFiles?: string[];
};

export async function handleGenerate(input: GenerateInput) {
  // Validate: at least one plan source required
  if (!input.planJson && !input.planPath) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error:
              "Either planJson or planPath must be provided to forge_generate.",
          }),
        },
      ],
      isError: true,
    };
  }

  // v0.39.0 G3/AC-4/AC-5 — observability completion for forge_generate.
  // The handler writes an activity signal at start (so the dashboard's
  // in-progress overlay can route this story while the brief is being
  // assembled) and clears it on return. After completion (success or
  // failure) it also writes a parallel `.forge/runs/forge_generate-*.json`
  // run record carrying {tool, storyId, timestamp, outcome, metrics}. The
  // shape mirrors evaluate/coordinate so analytics joins stay uniform.
  //
  // All side effects are best-effort: writeActivity + writeRunRecord both
  // swallow their own errors. We never let observability bookkeeping take
  // down the brief assembly itself.
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  const projectPath = input.projectPath;

  if (projectPath) {
    await writeActivity(projectPath, {
      tool: "forge_generate",
      storyId: input.storyId,
      stage: "assemble",
      startedAt: startedAtIso,
      lastUpdate: startedAtIso,
      label: input.evalReport ? "fix iteration" : "init",
    });
  }

  try {
    // Parse JSON-serialized complex inputs
    let evalReport: EvalReport | undefined;
    if (input.evalReport) {
      evalReport = JSON.parse(input.evalReport) as EvalReport;
    }

    let baselineDiagnostics: AssembleInput["baselineDiagnostics"];
    if (input.baselineDiagnostics) {
      baselineDiagnostics = JSON.parse(input.baselineDiagnostics);
    }

    // Build AssembleInput from MCP params
    const assembleInput: AssembleInput = {
      storyId: input.storyId,
      planJson: input.planJson,
      planPath: input.planPath,
      evalReport,
      iteration: input.iteration,
      maxIterations: input.maxIterations,
      previousScores: input.previousScores,
      fileHashes: input.fileHashes,
      previousFileHashes: input.previousFileHashes,
      projectPath: input.projectPath,
      baselineDiagnostics,
      isMaxUser: input.isMaxUser,
      prdContent: input.prdContent,
      masterPlanContent: input.masterPlanContent,
      phasePlanContent: input.phasePlanContent,
      contextFiles: input.contextFiles,
    };

    const result = await assembleGenerateResultWithContext(assembleInput);

    if (projectPath) {
      await writeForgeGenerateRunRecord(projectPath, {
        storyId: input.storyId,
        timestamp: startedAtIso,
        outcome: "ok",
        durationMs: Date.now() - startedAtMs,
      });
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    if (projectPath) {
      await writeForgeGenerateRunRecord(projectPath, {
        storyId: input.storyId,
        timestamp: startedAtIso,
        outcome: "failure",
        durationMs: Date.now() - startedAtMs,
      });
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error:
              err instanceof Error ? err.message : "Unknown error in forge_generate",
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Build and persist a `.forge/runs/forge_generate-*.json` record for one
 * handleGenerate invocation. Schema mirrors evaluate/coordinate writers:
 * the same `RunRecord` interface, with `tool: "forge_generate"`. The vast
 * majority of fields default to null/zero because forge_generate is a
 * pure read-only brief-assembler — it has no documentTier, no LLM token
 * spend, no critique rounds, no eval verdict. The fields that ARE
 * meaningful (timestamp, storyId, outcome, durationMs) carry the
 * dashboard's grounding-signal needs.
 *
 * `writeRunRecord` itself does writeActivity(null) + renderDashboard
 * post-write (see `server/lib/run-record.ts`), so the activity overlay
 * is cleared atomically with the record landing.
 */
async function writeForgeGenerateRunRecord(
  projectPath: string,
  args: {
    storyId: string;
    timestamp: string;
    outcome: Extract<RunRecord["outcome"], "ok" | "failure">;
    durationMs: number;
  },
): Promise<void> {
  const record: RunRecord = {
    timestamp: args.timestamp,
    tool: "forge_generate",
    documentTier: null,
    mode: null,
    tier: null,
    storyId: args.storyId,
    metrics: {
      inputTokens: 0,
      outputTokens: 0,
      critiqueRounds: 0,
      findingsTotal: 0,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: args.durationMs,
    },
    outcome: args.outcome,
  };
  await writeRunRecord(projectPath, record);
}
