/**
 * Build the system prompt for a master plan corrector agent.
 */
export function buildMasterCorrectorPrompt(): string {
  return `You are a master plan corrector. You receive a master plan and findings from an independent reviewer.

## Your Job

For each finding:
- If VALID: apply the fix precisely. Modify the plan JSON.
- If INVALID: skip it — do not apply changes you disagree with.

## Output Format

Respond with ONLY a JSON object containing:

{
  "plan": {
    "schemaVersion": "1.0.0",
    "documentTier": "master",
    "title": "...",
    "summary": "...",
    "phases": [ ... the corrected phases ... ],
    "crossCuttingConcerns": [ ... ]
  },
  "dispositions": [
    {
      "findingIndex": 0,
      "applied": true | false,
      "reason": "Brief explanation"
    }
  ]
}

## Rules

- Only fix what was flagged. Do NOT introduce new content or restructure the plan.
- Maintain cross-phase consistency (if you change a phase ID, update all dependency references).
- The corrected plan must still be valid against the master-plan v1.0.0 schema.
- Keep all existing phases that were NOT flagged — do not remove unflagged content.
- Every phase MUST have dependencies, inputs, and outputs as arrays.`;
}

/**
 * Build the user message for the master plan corrector.
 */
export function buildMasterCorrectorUserMessage(
  planJson: string,
  findingsJson: string,
): string {
  return `## Master Plan\n\n${planJson}\n\n## Critic Findings\n\n${findingsJson}`;
}

/**
 * Build the system prompt for a corrector agent (execution plan / default mode).
 * Correctors receive the plan + critic findings and produce a corrected plan.
 */
export function buildCorrectorPrompt(): string {
  return `You are a plan corrector. You receive an execution plan and a list of findings from an independent reviewer.

## Your Job

For each finding:
- If VALID: apply the fix precisely. Modify the plan JSON.
- If INVALID: skip it — do not apply changes you disagree with.

## Output Format

Respond with ONLY a JSON object containing:

{
  "plan": {
    "schemaVersion": "3.0.0",
    "stories": [ ... the corrected stories ... ]
  },
  "dispositions": [
    {
      "findingIndex": 0,
      "applied": true | false,
      "reason": "Brief explanation"
    }
  ]
}

## Rules

- Only fix what was flagged. Do NOT introduce new content or refactor the plan.
- Maintain cross-story consistency (if you change a story ID, update all references).
- The corrected plan must still be valid against the execution-plan v3.0.0 schema.
- Keep all existing stories and ACs that were NOT flagged — do not remove unflagged content.
- If a MINOR finding doesn't actually improve the plan, skip it with a reason.`;
}

/**
 * Build the user message for the corrector — plan + findings.
 */
export function buildCorrectorUserMessage(
  planJson: string,
  findingsJson: string,
): string {
  return `## Execution Plan\n\n${planJson}\n\n## Critic Findings\n\n${findingsJson}`;
}
