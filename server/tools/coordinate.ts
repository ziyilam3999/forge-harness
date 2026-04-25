import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { ExecutionPlan } from "../types/execution-plan.js";
import type { ReplanningNote } from "../types/coordinate-result.js";
import { assessPhase, loadCoordinateConfig, type AssessPhaseOptions } from "../lib/coordinator.js";
import { validateExecutionPlan } from "../validation/execution-plan.js";
import { writeRunRecord, type RunRecord } from "../lib/run-record.js";

// ── Zod schema for MCP input (REQ-14) ──────────────────────

const replanningNoteSchema = z.object({
  category: z.enum(["ac-drift", "partial-completion", "dependency-satisfied", "gap-found", "assumption-changed"]),
  severity: z.enum(["blocking", "should-address", "informational"]),
  affectedPhases: z.array(z.string()).optional(),
  affectedStories: z.array(z.string()).optional(),
  description: z.string(),
});

export const coordinateInputSchema = {
  planPath: z.string().describe("Path to execution-plan.json (required)"),
  phaseId: z.string().describe("Phase identifier, e.g. PH-01 (required in v1)"),
  budgetUsd: z.number().nonnegative("budgetUsd must be non-negative").optional().describe("Budget cap in USD (advisory signal)"),
  maxTimeMs: z.number().nonnegative("maxTimeMs must be non-negative").optional().describe("Max wall-clock time in ms (advisory signal)"),
  currentPlanStartTimeMs: z.number().optional().describe("Epoch ms for plan-execution windowing"),
  projectPath: z.string().optional().describe("Project root path for run-record reads"),
  replanningNotes: z.array(replanningNoteSchema).optional().describe("Injected replanning notes from prior calls"),
  haltClearedByHuman: z.boolean().optional().describe("Clear halt-hard gate on this call"),
  // Reserved for v2: masterPlanPath, coordinateMode ("autonomous"), startTimeMs, prdContent
};

// v0.36.0 Phase D (AC-D5): canonical named export so the contract-harvester
// can import each tool's input shape rather than AST-parsing source. Kept as
// a parallel reference to the same object passed to `server.registerTool`
// (NOT a copy), so the registration site and the harvester are guaranteed
// to see identical Zod shapes — `safeParse` results match by construction.
export const ToolInputSchemaShape = coordinateInputSchema;

// Intentional omission per REQ-14 v1.1 + §7: retry cap (3) is
// hardcoded in the coordinator, not exposed as a schema field.

type CoordinateInput = {
  planPath: string;
  phaseId: string;
  budgetUsd?: number;
  maxTimeMs?: number;
  currentPlanStartTimeMs?: number;
  projectPath?: string;
  replanningNotes?: ReplanningNote[];
  haltClearedByHuman?: boolean;
};

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Handler (REQ-14) ────────────────────────────────────────

export async function handleCoordinate(input: CoordinateInput): Promise<McpResponse> {
  const startTime = Date.now();

  // Validate numeric constraints (Zod handles at MCP boundary;
  // double-check here for direct callers)
  if (input.budgetUsd !== undefined && input.budgetUsd < 0) {
    return {
      content: [{ type: "text", text: "forge_coordinate error: budgetUsd must be non-negative" }],
      isError: true,
    };
  }
  if (input.maxTimeMs !== undefined && input.maxTimeMs < 0) {
    return {
      content: [{ type: "text", text: "forge_coordinate error: maxTimeMs must be non-negative" }],
      isError: true,
    };
  }

  // Read and validate the plan from disk
  let planJson: string;
  try {
    planJson = await readFile(input.planPath, "utf-8");
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `forge_coordinate error: cannot read planPath "${input.planPath}": ${err instanceof Error ? err.message : String(err)}`,
      }],
      isError: true,
    };
  }

  let planData: unknown;
  try {
    planData = JSON.parse(planJson);
  } catch {
    return {
      content: [{
        type: "text",
        text: `forge_coordinate error: planPath "${input.planPath}" contains invalid JSON`,
      }],
      isError: true,
    };
  }

  const validation = validateExecutionPlan(planData);
  if (!validation.valid) {
    return {
      content: [{
        type: "text",
        text: `forge_coordinate error: invalid execution plan at "${input.planPath}": ${(validation.errors ?? []).join("; ")}`,
      }],
      isError: true,
    };
  }

  const plan = planData as ExecutionPlan;
  const projectPath = input.projectPath ?? ".";

  // Load config file + merge with MCP args (REQ-15)
  const config = await loadCoordinateConfig(projectPath);

  const options: AssessPhaseOptions = {
    phaseId: input.phaseId,
    budgetUsd: input.budgetUsd ?? null,
    maxTimeMs: input.maxTimeMs ?? null,
    currentPlanStartTimeMs: input.currentPlanStartTimeMs ?? null,
    config,
    haltClearedByHuman: input.haltClearedByHuman,
  };

  try {
    const result = await assessPhase(plan, projectPath, options);
    const brief = result.brief;

    // Merge injected replanning notes
    if (input.replanningNotes && input.replanningNotes.length > 0) {
      brief.replanningNotes.push(...input.replanningNotes);
    }

    // Write RunRecord for this coordinate call
    if (input.projectPath) {
      const record: RunRecord = {
        timestamp: new Date().toISOString(),
        tool: "forge_coordinate",
        documentTier: "phase",
        mode: null,
        tier: null,
        metrics: {
          inputTokens: 0,
          outputTokens: 0,
          critiqueRounds: 0,
          findingsTotal: brief.replanningNotes.length,
          findingsApplied: 0,
          findingsRejected: 0,
          validationRetries: 0,
          durationMs: Date.now() - startTime,
          estimatedCostUsd: 0,
        },
        outcome: "success",
      };
      await writeRunRecord(input.projectPath, record);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`forge_coordinate: assessPhase failed: ${message}`);
    return {
      content: [{ type: "text", text: `forge_coordinate error: ${message}` }],
      isError: true,
    };
  }
}
