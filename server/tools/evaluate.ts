import { z } from "zod";
import { readFileSync } from "node:fs";
import { validateExecutionPlan } from "../validation/execution-plan.js";
import { evaluateStory } from "../lib/evaluator.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

export const evaluateInputSchema = {
  storyId: z.string().describe("Story ID to evaluate (e.g., US-01)"),
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
};

function loadPlan(planPath?: string, planJson?: string): ExecutionPlan {
  let rawJson: string;

  if (planJson !== undefined) {
    rawJson = planJson;
  } else if (planPath !== undefined) {
    try {
      rawJson = readFileSync(planPath, "utf-8");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      throw new Error(`Plan file not found: ${planPath} (${message})`);
    }
  } else {
    throw new Error("Either planPath or planJson is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid plan JSON: ${message}`);
  }

  const validation = validateExecutionPlan(parsed);
  if (!validation.valid) {
    throw new Error(
      `Invalid execution plan: ${validation.errors?.join("; ") ?? "unknown error"}`,
    );
  }

  return parsed as ExecutionPlan;
}

export async function handleEvaluate({
  storyId,
  planPath,
  planJson,
  timeoutMs,
}: {
  storyId: string;
  planPath?: string;
  planJson?: string;
  timeoutMs?: number;
}) {
  try {
    const plan = loadPlan(planPath, planJson);
    const report = await evaluateStory(plan, storyId, { timeoutMs });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(report, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text" as const,
          text: `forge_evaluate error: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
