import type { EvalReport } from "../types/eval-report.js";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

const VALID_VERDICTS = new Set(["PASS", "FAIL", "INCONCLUSIVE"]);
const VALID_STATUSES = new Set(["PASS", "FAIL", "SKIPPED", "INCONCLUSIVE"]);

/**
 * Validate an eval report against the eval-report schema rules.
 * Hand-written validation for clear error messages — no ajv dependency.
 */
export function validateEvalReport(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Report must be a non-null object"] };
  }

  const report = data as Record<string, unknown>;

  // 1. storyId
  if (typeof report.storyId !== "string" || report.storyId.length === 0) {
    errors.push("storyId must be a non-empty string");
  }

  // 2. verdict
  if (typeof report.verdict !== "string" || !VALID_VERDICTS.has(report.verdict)) {
    errors.push(
      `verdict must be one of "PASS", "FAIL", "INCONCLUSIVE", got "${String(report.verdict)}"`,
    );
  }

  // 3. criteria must be an array
  if (!Array.isArray(report.criteria)) {
    errors.push("criteria must be an array");
    return { valid: false, errors };
  }

  const criterionIds = new Set<string>();

  for (let i = 0; i < report.criteria.length; i++) {
    const criterion = report.criteria[i] as Record<string, unknown>;
    const prefix = `criteria[${i}]`;

    if (!criterion || typeof criterion !== "object") {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    // 4. id
    if (typeof criterion.id !== "string" || criterion.id.length === 0) {
      errors.push(`${prefix}: id must be a non-empty string`);
    } else {
      if (criterionIds.has(criterion.id)) {
        errors.push(`Duplicate criterion ID: "${criterion.id}"`);
      }
      criterionIds.add(criterion.id);
    }

    // 5. status
    if (
      typeof criterion.status !== "string" ||
      !VALID_STATUSES.has(criterion.status)
    ) {
      errors.push(
        `${prefix}: status must be one of "PASS", "FAIL", "SKIPPED", "INCONCLUSIVE", got "${String(criterion.status)}"`,
      );
    }

    // 6. evidence (required, must be string)
    if (typeof criterion.evidence !== "string") {
      errors.push(`${prefix}: evidence must be a string`);
    }
  }

  // 7. warnings (optional, must be array of strings if present)
  if (report.warnings !== undefined) {
    if (!Array.isArray(report.warnings)) {
      errors.push("warnings must be an array if present");
    } else {
      for (let i = 0; i < report.warnings.length; i++) {
        if (typeof report.warnings[i] !== "string") {
          errors.push(`warnings[${i}]: must be a string`);
        }
      }
    }
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}

/**
 * Type guard: check if validated data is an EvalReport.
 */
export function asEvalReport(data: unknown): EvalReport {
  const result = validateEvalReport(data);
  if (!result.valid) {
    throw new Error(
      `Invalid eval report: ${result.errors?.join("; ") ?? "unknown error"}`,
    );
  }
  return data as EvalReport;
}
