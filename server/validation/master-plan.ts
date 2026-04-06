export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate a master plan against the v1.0.0 schema rules.
 * Hand-written validation for clear error messages — no ajv dependency.
 *
 * Checks:
 *  1. schemaVersion = "1.0.0"
 *  2. documentTier = "master"
 *  3. title is non-empty string
 *  4. summary is non-empty string
 *  5. phases is non-empty array
 *  6. Each phase: id, title, description are non-empty strings
 *  7. Each phase: dependencies, inputs, outputs are arrays of strings
 *  8. Each phase: estimatedStories is a positive integer
 *  9. No duplicate phase IDs
 * 10. Phase dependencies reference existing phase IDs; no self-deps
 * 11. No circular phase dependencies (DFS)
 * 12. crossCuttingConcerns is array of strings if present
 */
export function validateMasterPlan(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Plan must be a non-null object"] };
  }

  const plan = data as Record<string, unknown>;

  // 1. schemaVersion
  if (plan.schemaVersion !== "1.0.0") {
    errors.push(
      `schemaVersion must be "1.0.0", got "${String(plan.schemaVersion)}"`,
    );
  }

  // 2. documentTier
  if (plan.documentTier !== "master") {
    errors.push(
      `documentTier must be "master", got "${String(plan.documentTier)}"`,
    );
  }

  // 3. title
  if (typeof plan.title !== "string" || plan.title.length === 0) {
    errors.push("title must be a non-empty string");
  }

  // 4. summary
  if (typeof plan.summary !== "string" || plan.summary.length === 0) {
    errors.push("summary must be a non-empty string");
  }

  // 5. phases must be non-empty array
  if (!Array.isArray(plan.phases)) {
    errors.push("phases must be an array");
    return { valid: false, errors };
  }

  if (plan.phases.length === 0) {
    errors.push("phases must contain at least one phase");
    return { valid: false, errors };
  }

  const phaseIds = new Set<string>();
  const allPhaseIds = new Set<string>();

  // First pass: collect all phase IDs for dependency checking
  for (const phase of plan.phases) {
    if (
      phase &&
      typeof phase === "object" &&
      typeof (phase as Record<string, unknown>).id === "string"
    ) {
      allPhaseIds.add((phase as Record<string, unknown>).id as string);
    }
  }

  let hasMissingRefs = false;

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i] as Record<string, unknown>;
    const prefix = `phases[${i}]`;

    if (!phase || typeof phase !== "object") {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    // 6a. id
    if (typeof phase.id !== "string" || phase.id.length === 0) {
      errors.push(`${prefix}: id must be a non-empty string`);
      continue;
    }

    const phaseLabel = `${prefix} (${phase.id})`;

    // 6b. title
    if (typeof phase.title !== "string" || phase.title.length === 0) {
      errors.push(`${phaseLabel}: title must be a non-empty string`);
    }

    // 6c. description
    if (typeof phase.description !== "string" || phase.description.length === 0) {
      errors.push(`${phaseLabel}: description must be a non-empty string`);
    }

    // 9. No duplicate phase IDs
    if (phaseIds.has(phase.id)) {
      errors.push(`Duplicate phase ID: "${phase.id}"`);
    }
    phaseIds.add(phase.id);

    // 7a. dependencies — required array of strings
    if (!Array.isArray(phase.dependencies)) {
      errors.push(`${phaseLabel}: dependencies must be an array`);
    } else {
      // 10. Self-dependency check
      if (phase.dependencies.includes(phase.id)) {
        errors.push(`Phase "${phase.id}" depends on itself`);
      }
      for (const dep of phase.dependencies) {
        if (typeof dep !== "string") {
          errors.push(`${phaseLabel}: dependency must be a string`);
        } else if (dep !== phase.id && !allPhaseIds.has(dep)) {
          errors.push(
            `${phaseLabel}: dependency "${dep}" references non-existent phase`,
          );
          hasMissingRefs = true;
        }
      }
    }

    // 7b. inputs — required array of strings
    if (!Array.isArray(phase.inputs)) {
      errors.push(`${phaseLabel}: inputs must be an array`);
    } else {
      for (const input of phase.inputs) {
        if (typeof input !== "string") {
          errors.push(`${phaseLabel}: input must be a string`);
        }
      }
    }

    // 7c. outputs — required array of strings
    if (!Array.isArray(phase.outputs)) {
      errors.push(`${phaseLabel}: outputs must be an array`);
    } else {
      for (const output of phase.outputs) {
        if (typeof output !== "string") {
          errors.push(`${phaseLabel}: output must be a string`);
        }
      }
    }

    // 8. estimatedStories — positive integer
    if (
      typeof phase.estimatedStories !== "number" ||
      !Number.isInteger(phase.estimatedStories) ||
      phase.estimatedStories < 1
    ) {
      errors.push(
        `${phaseLabel}: estimatedStories must be a positive integer`,
      );
    }
  }

  // 11. Circular dependency detection (DFS) — skip if missing refs found
  if (!hasMissingRefs) {
    const cycleError = detectPhaseCycles(
      plan.phases as Array<Record<string, unknown>>,
    );
    if (cycleError) {
      errors.push(cycleError);
    }
  }

  // 12. crossCuttingConcerns — optional array of strings
  if (plan.crossCuttingConcerns !== undefined) {
    if (!Array.isArray(plan.crossCuttingConcerns)) {
      errors.push("crossCuttingConcerns must be an array if present");
    } else {
      for (let i = 0; i < plan.crossCuttingConcerns.length; i++) {
        if (typeof plan.crossCuttingConcerns[i] !== "string") {
          errors.push(`crossCuttingConcerns[${i}] must be a string`);
        }
      }
    }
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}

// ── DFS-based cycle detection (same algorithm as execution-plan.ts) ──

const WHITE = 0; // unvisited
const GRAY = 1; // visiting (in current path)
const BLACK = 2; // done

function detectPhaseCycles(
  phases: Array<Record<string, unknown>>,
): string | null {
  const deps = new Map<string, string[]>();
  for (const phase of phases) {
    const id = phase.id as string;
    const phaseDeps = (phase.dependencies as string[] | undefined) ?? [];
    deps.set(id, phaseDeps.filter((d) => d !== id));
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
