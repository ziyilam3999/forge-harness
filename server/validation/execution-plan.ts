export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateExecutionPlan(_data: unknown): ValidationResult {
  // Stub — real validation against schema/execution-plan.schema.json in Phase 1
  return { valid: true };
}
