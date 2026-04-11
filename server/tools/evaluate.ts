import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateStory } from "../lib/evaluator.js";
import { scanCodebase } from "../lib/codebase-scan.js";
import { loadPlan } from "../lib/plan-loader.js";
import { RunContext, trackedCallClaude } from "../lib/run-context.js";
import {
  writeRunRecord,
  canonicalizeEvalReport,
  type RunRecord,
} from "../lib/run-record.js";
import {
  buildCoherenceEvalPrompt,
  buildCoherenceEvalUserMessage,
} from "../lib/prompts/coherence-eval.js";
import {
  buildDivergenceEvalPrompt,
  buildDivergenceEvalUserMessage,
} from "../lib/prompts/divergence-eval.js";
import type { CoherenceReport, CoherenceGap } from "../types/coherence-report.js";
import { verifySpecVocabularyFromContent } from "../lib/spec-vocabulary-check.js";
import type {
  DivergenceReport,
  ForwardDivergence,
  ReverseDivergence,
} from "../types/divergence-report.js";

// ── Input Schema ──────────────────────────────────────────

export const evaluateInputSchema = {
  evaluationMode: z
    .enum(["story", "coherence", "divergence"])
    .optional()
    .describe(
      'Evaluation mode. "story": run AC shell commands (default). ' +
        '"coherence": LLM-judged tier alignment (PRD <-> master <-> phase). ' +
        '"divergence": forward (AC failures) + reverse (unplanned capabilities).',
    ),

  // ── Story mode params ──
  storyId: z
    .string()
    .optional()
    .describe("Story ID to evaluate (e.g., US-01). Required for story mode."),
  planPath: z
    .string()
    .optional()
    .describe("Absolute path to execution plan JSON file"),
  planJson: z
    .string()
    .optional()
    .describe(
      "Inline execution plan JSON string. Takes precedence over planPath.",
    ),
  timeoutMs: z
    .number()
    .positive()
    .optional()
    .describe("Timeout per AC command in milliseconds. Default: 30000"),

  // ── Coherence mode params ──
  prdContent: z
    .string()
    .optional()
    .describe(
      "PRD/vision document content. Required for coherence mode.",
    ),
  masterPlanContent: z
    .string()
    .optional()
    .describe("Master plan JSON string. Used by coherence mode."),
  phasePlans: z
    .array(
      z.object({
        phaseId: z.string(),
        content: z.string(),
      }),
    )
    .optional()
    .describe(
      "Phase plan contents for coherence checking against master plan.",
    ),

  // ── Divergence mode params ──
  projectPath: z
    .string()
    .optional()
    .describe(
      "Absolute path to project root. Required for divergence mode (codebase scanning).",
    ),

  // ── Self-healing ──
  maxSelfHealingCycles: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe(
      "Maximum self-healing cycles for divergence mode. Default: 2. Set to 0 to disable.",
    ),
};

// ── Types ─────────────────────────────────────────────────

type EvaluateInput = {
  evaluationMode?: "story" | "coherence" | "divergence";
  storyId?: string;
  planPath?: string;
  planJson?: string;
  timeoutMs?: number;
  prdContent?: string;
  masterPlanContent?: string;
  phasePlans?: Array<{ phaseId: string; content: string }>;
  projectPath?: string;
  maxSelfHealingCycles?: number;
};

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Shared helpers ────────────────────────────────────────

/** Build a RunRecord for evaluate handlers (coherence / divergence share shape). */
function buildRunRecord(
  ctx: RunContext,
  startTime: number,
  findingsTotal: number,
): RunRecord {
  const costSummary = ctx.cost.summarize();
  return {
    timestamp: new Date().toISOString(),
    tool: "forge_evaluate",
    documentTier: null,
    mode: null,
    tier: null,
    metrics: {
      inputTokens: costSummary.inputTokens,
      outputTokens: costSummary.outputTokens,
      critiqueRounds: 0,
      findingsTotal,
      findingsApplied: 0,
      findingsRejected: 0,
      validationRetries: 0,
      durationMs: Date.now() - startTime,
      estimatedCostUsd: costSummary.estimatedCostUsd,
    },
    outcome: "success",
  };
}

// ── Story Mode Handler ────────────────────────────────────

async function handleStoryEval(input: EvaluateInput): Promise<McpResponse> {
  if (!input.storyId) {
    return {
      content: [{ type: "text", text: "forge_evaluate error: storyId is required for story mode" }],
      isError: true,
    };
  }

  // REQ-01 v1.1: full RunContext infrastructure for story-eval runs,
  // matching the handleCoherenceEval pattern. Enables populating
  // storyId / evalVerdict / evalReport / estimatedCostUsd on the RunRecord
  // so forge_coordinate's state reader can classify stories.
  const ctx = new RunContext({
    toolName: "forge_evaluate",
    projectPath: input.projectPath,
    stages: ["story-eval"],
  });
  const startTime = Date.now();

  const plan = loadPlan(input.planPath, input.planJson);
  const report = await evaluateStory(plan, input.storyId, {
    timeoutMs: input.timeoutMs,
  });

  // Write run record with the four REQ-01 v1.1 additive fields populated.
  // canonicalizeEvalReport sorts criteria by (id, evidence) so two runs
  // with the same criteria in different input orders produce byte-identical
  // JSON output (NFR-C02 determinism, NFR-C10 golden-file byte-identity).
  if (input.projectPath) {
    const base = buildRunRecord(ctx, startTime, report.criteria.length);
    await writeRunRecord(input.projectPath, {
      ...base,
      storyId: input.storyId,
      evalVerdict: report.verdict,
      evalReport: canonicalizeEvalReport(report),
    });
  }

  return {
    content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
  };
}

// ── Coherence Mode Handler ────────────────────────────────

async function handleCoherenceEval(
  input: EvaluateInput,
): Promise<McpResponse> {
  if (!input.prdContent) {
    return {
      content: [
        {
          type: "text",
          text: "forge_evaluate error: prdContent is required for coherence mode",
        },
      ],
      isError: true,
    };
  }

  const stages = ["coherence-eval"];
  const ctx = new RunContext({
    toolName: "forge_evaluate",
    projectPath: input.projectPath,
    stages,
  });

  const startTime = Date.now();

  try {
    const system = buildCoherenceEvalPrompt();
    const userMessage = buildCoherenceEvalUserMessage({
      prdContent: input.prdContent,
      masterPlanContent: input.masterPlanContent,
      phasePlans: input.phasePlans,
    });

    const result = await trackedCallClaude(ctx, "coherence-eval", "coherence-evaluator", {
      system,
      messages: [{ role: "user", content: userMessage }],
      jsonMode: true,
    });

    const parsed = result.parsed as Record<string, unknown>;

    // Validate the response structure
    const gaps = Array.isArray(parsed.gaps) ? parsed.gaps as CoherenceGap[] : [];

    // Mechanical spec-vocabulary-drift check (F-03 secondary, PH-04 US-05).
    // Runs alongside LLM coherence — zero LLM calls, pure regex matching.
    if (input.prdContent && input.projectPath) {
      try {
        const sourceDirs = [
          join(input.projectPath, "server", "types"),
          join(input.projectPath, "server", "lib"),
        ];
        const driftResults = await verifySpecVocabularyFromContent(input.prdContent, sourceDirs);
        const unknownFields = driftResults.filter((r) => r.kind === "unknown-field");
        for (const drift of unknownFields) {
          gaps.push({
            id: `VOCAB-${gaps.length + 1}`,
            severity: "MAJOR",
            sourceDocument: "prd",
            targetDocument: "phasePlan",
            description: `spec-vocabulary-drift: PRD references \`${drift.type}.${drift.field}\` (line ${drift.line}) but field '${drift.field}' does not exist on type '${drift.type}'`,
            missingRequirement: `Type ${drift.type} has no field named '${drift.field}' — possible vocabulary drift from an older spec revision`,
          });
        }
      } catch (err) {
        console.error(
          `forge_evaluate: spec-vocabulary-check failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const summary =
      typeof parsed.summary === "string"
        ? parsed.summary
        : `Found ${gaps.length} gap(s)`;

    const report: CoherenceReport = {
      evaluationMode: "coherence",
      status: "complete",
      gaps,
      summary,
    };

    // Write run record if projectPath available
    if (input.projectPath) {
      await writeRunRecord(
        input.projectPath,
        buildRunRecord(ctx, startTime, gaps.length),
      );
    }

    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  } catch (err) {
    // Graceful degradation per plan D4: warn and return empty findings
    const message = err instanceof Error ? err.message : String(err);
    console.error(`forge_evaluate: coherence eval failed: ${message}`);

    const report: CoherenceReport = {
      evaluationMode: "coherence",
      status: "eval-failed",
      gaps: [],
      summary: `Coherence evaluation failed: ${message}`,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  }
}

// ── Divergence Mode Handler ───────────────────────────────

async function handleDivergenceEval(
  input: EvaluateInput,
): Promise<McpResponse> {
  if (!input.planPath && !input.planJson) {
    return {
      content: [
        {
          type: "text",
          text: "forge_evaluate error: planPath or planJson is required for divergence mode",
        },
      ],
      isError: true,
    };
  }

  const stages = ["forward-eval", "reverse-eval"];
  const ctx = new RunContext({
    toolName: "forge_evaluate",
    projectPath: input.projectPath,
    stages,
  });

  const startTime = Date.now();

  // ── Forward divergence: mechanical AC failures ──
  const plan = loadPlan(input.planPath, input.planJson);
  const forwardDivergences: ForwardDivergence[] = [];

  ctx.progress.begin("forward-eval");
  for (const story of plan.stories) {
    try {
      const report = await evaluateStory(plan, story.id, {
        timeoutMs: input.timeoutMs,
      });
      for (const criterion of report.criteria) {
        if (criterion.status === "FAIL" || criterion.status === "INCONCLUSIVE") {
          forwardDivergences.push({
            storyId: story.id,
            acId: criterion.id,
            status: criterion.status,
            evidence: criterion.evidence,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      forwardDivergences.push({
        storyId: story.id,
        acId: "EVAL-ERROR",
        status: "INCONCLUSIVE",
        evidence: `Evaluation error: ${message}`,
      });
    }
  }
  ctx.progress.complete("forward-eval");

  // ── Reverse divergence: LLM-judged unplanned capabilities ──
  let reverseDivergences: ReverseDivergence[] = [];
  let reverseSummary = "No codebase context available for reverse divergence scan.";

  if (input.projectPath) {
    try {
      const codebaseSummary = await scanCodebase(input.projectPath);
      const system = buildDivergenceEvalPrompt();
      const planContent = input.planJson ?? readFileSync(input.planPath!, "utf-8");
      const userMessage = buildDivergenceEvalUserMessage({
        planContent,
        codebaseSummary,
        prdContent: input.prdContent,
      });

      const result = await trackedCallClaude(
        ctx,
        "reverse-eval",
        "divergence-evaluator",
        {
          system,
          messages: [{ role: "user", content: userMessage }],
          jsonMode: true,
        },
      );

      const parsed = result.parsed as Record<string, unknown>;
      reverseDivergences = Array.isArray(parsed.reverse)
        ? (parsed.reverse as ReverseDivergence[])
        : [];
      reverseSummary =
        typeof parsed.summary === "string"
          ? parsed.summary
          : `Found ${reverseDivergences.length} reverse divergence(s)`;
    } catch (err) {
      // Graceful degradation: warn and return empty reverse findings
      const message = err instanceof Error ? err.message : String(err);
      console.error(`forge_evaluate: reverse divergence scan failed: ${message}`);
      reverseSummary = `Reverse divergence scan failed: ${message}`;
    }
  } else {
    ctx.progress.skip("reverse-eval");
  }

  const totalDivergences = forwardDivergences.length + reverseDivergences.length;

  const report: DivergenceReport = {
    evaluationMode: "divergence",
    status: "complete",
    forward: forwardDivergences,
    reverse: reverseDivergences,
    selfHealingCycles: 0, // incremented by calling agent across invocations
    maxCyclesReached: false, // set by calling agent based on cycle count vs max
    summary:
      `Forward: ${forwardDivergences.length} AC failure(s). ` +
      `Reverse: ${reverseDivergences.length} unplanned capability(ies). ` +
      reverseSummary,
  };

  // Write run record if projectPath available
  if (input.projectPath) {
    await writeRunRecord(
      input.projectPath,
      buildRunRecord(ctx, startTime, totalDivergences),
    );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
  };
}

// ── Main Router ───────────────────────────────────────────

export async function handleEvaluate(input: EvaluateInput): Promise<McpResponse> {
  const mode = input.evaluationMode ?? "story";

  try {
    switch (mode) {
      case "story":
        return await handleStoryEval(input);
      case "coherence":
        return await handleCoherenceEval(input);
      case "divergence":
        return await handleDivergenceEval(input);
      default:
        return {
          content: [
            {
              type: "text",
              text: `forge_evaluate error: unknown evaluationMode "${mode}"`,
            },
          ],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `forge_evaluate error: ${message}` }],
      isError: true,
    };
  }
}
