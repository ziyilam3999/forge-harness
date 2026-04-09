import type { ValidationResult } from "./master-plan.js";
export type { ValidationResult };

/**
 * Validate an execution plan against the v3.0.0 schema rules.
 * Hand-written validation for clear error messages — no ajv dependency.
 */
export function validateExecutionPlan(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Plan must be a non-null object"] };
  }

  const plan = data as Record<string, unknown>;

  // 1. schemaVersion
  if (plan.schemaVersion !== "3.0.0") {
    errors.push(
      `schemaVersion must be "3.0.0", got "${String(plan.schemaVersion)}"`,
    );
  }

  // 2. stories must be non-empty array
  if (!Array.isArray(plan.stories)) {
    errors.push("stories must be an array");
    return { valid: false, errors };
  }

  if (plan.stories.length === 0) {
    errors.push("stories must contain at least one story");
    return { valid: false, errors };
  }

  const storyIds = new Set<string>();
  const allStoryIds = new Set<string>();

  // First pass: collect all story IDs for dependency checking
  for (const story of plan.stories) {
    if (story && typeof story === "object" && typeof (story as Record<string, unknown>).id === "string") {
      allStoryIds.add((story as Record<string, unknown>).id as string);
    }
  }

  let hasMissingRefs = false;

  for (let i = 0; i < plan.stories.length; i++) {
    const story = plan.stories[i] as Record<string, unknown>;
    const prefix = `stories[${i}]`;

    if (!story || typeof story !== "object") {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    // 3. Required fields
    if (typeof story.id !== "string" || story.id.length === 0) {
      errors.push(`${prefix}: id must be a non-empty string`);
      continue;
    }

    if (typeof story.title !== "string" || story.title.length === 0) {
      errors.push(`${prefix} (${story.id}): title must be a non-empty string`);
    }

    // 5. No duplicate story IDs
    if (storyIds.has(story.id)) {
      errors.push(`Duplicate story ID: "${story.id}"`);
    }
    storyIds.add(story.id);

    // 7. Dependency references (run BEFORE cycle detection)
    if (Array.isArray(story.dependencies)) {
      // Check for self-dependency
      if (story.dependencies.includes(story.id)) {
        errors.push(`Story "${story.id}" depends on itself`);
      }
      for (const dep of story.dependencies) {
        if (typeof dep !== "string") {
          errors.push(`${prefix} (${story.id}): dependency must be a string`);
        } else if (dep !== story.id && !allStoryIds.has(dep)) {
          errors.push(
            `${prefix} (${story.id}): dependency "${dep}" references non-existent story`,
          );
          hasMissingRefs = true;
        }
      }
    }

    // 3. acceptanceCriteria must be non-empty array
    if (!Array.isArray(story.acceptanceCriteria)) {
      errors.push(
        `${prefix} (${story.id}): acceptanceCriteria must be an array`,
      );
      continue;
    }

    if (story.acceptanceCriteria.length === 0) {
      errors.push(
        `${prefix} (${story.id}): acceptanceCriteria must contain at least one criterion`,
      );
      continue;
    }

    const acIds = new Set<string>();

    for (let j = 0; j < story.acceptanceCriteria.length; j++) {
      const ac = story.acceptanceCriteria[j] as Record<string, unknown>;
      const acPrefix = `${prefix} (${story.id}).acceptanceCriteria[${j}]`;

      if (!ac || typeof ac !== "object") {
        errors.push(`${acPrefix}: must be an object`);
        continue;
      }

      // 4. AC required fields
      if (typeof ac.id !== "string" || ac.id.length === 0) {
        errors.push(`${acPrefix}: id must be a non-empty string`);
      }

      if (typeof ac.description !== "string" || ac.description.length === 0) {
        errors.push(`${acPrefix}: description must be a non-empty string`);
      }

      if (typeof ac.command !== "string" || ac.command.length === 0) {
        errors.push(`${acPrefix}: command must be a non-empty string`);
      }

      // 6. No duplicate AC IDs within a story
      if (typeof ac.id === "string" && ac.id.length > 0) {
        if (acIds.has(ac.id)) {
          errors.push(
            `${prefix} (${story.id}): duplicate AC ID "${ac.id}"`,
          );
        }
        acIds.add(ac.id);
      }

      // 9. flaky must be boolean if present
      if (ac.flaky !== undefined && typeof ac.flaky !== "boolean") {
        errors.push(`${acPrefix}: flaky must be a boolean if present`);
      }
    }
  }

  // 8. Circular dependency detection (DFS) — skip if missing refs found
  if (!hasMissingRefs) {
    const cycleError = detectCycles(plan.stories as Array<Record<string, unknown>>);
    if (cycleError) {
      errors.push(cycleError);
    }
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}

// DFS color constants
const WHITE = 0; // unvisited
const GRAY = 1; // visiting (in current path)
const BLACK = 2; // done

/**
 * DFS-based cycle detection on the story dependency graph.
 * Returns an error message if a cycle is found, null otherwise.
 */
function detectCycles(
  stories: Array<Record<string, unknown>>,
): string | null {
  const deps = new Map<string, string[]>();
  for (const story of stories) {
    const id = story.id as string;
    const storyDeps = (story.dependencies as string[] | undefined) ?? [];
    // Filter out self-dependencies (already caught earlier)
    deps.set(id, storyDeps.filter((d) => d !== id));
  }

  const color = new Map<string, number>();
  for (const id of deps.keys()) {
    color.set(id, WHITE);
  }

  for (const id of deps.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id, deps, color);
      if (cycle) return cycle;
    }
  }

  return null;
}

function dfs(
  node: string,
  deps: Map<string, string[]>,
  color: Map<string, number>,
): string | null {
  color.set(node, GRAY);

  for (const neighbor of deps.get(node) ?? []) {
    if (color.get(neighbor) === GRAY) {
      return `Circular dependency detected: "${node}" -> "${neighbor}" forms a cycle`;
    }
    if (color.get(neighbor) === WHITE) {
      const result = dfs(neighbor, deps, color);
      if (result) return result;
    }
  }

  color.set(node, BLACK);
  return null;
}