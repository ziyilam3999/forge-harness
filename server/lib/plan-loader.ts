import { readFileSync } from "node:fs";
import { validateExecutionPlan } from "../validation/execution-plan.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

/**
 * Load and validate an execution plan from inline JSON or a file path.
 * planJson takes precedence over planPath when both are provided.
 */
export function loadPlan(planPath?: string, planJson?: string): ExecutionPlan {
  let rawJson: string;

  if (planJson !== undefined) {
    rawJson = planJson;
  } else if (planPath !== undefined) {
    try {
      rawJson = readFileSync(planPath, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
