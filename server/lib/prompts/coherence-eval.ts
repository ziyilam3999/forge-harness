/**
 * Coherence evaluation prompt builder.
 *
 * Checks alignment between document tiers:
 * - PRD (vision) <-> Master Plan (phase decomposition)
 * - Master Plan <-> Phase Plans (execution plans for individual phases)
 *
 * Uses structured output (JSON with specific field checks) rather than
 * open-ended prose, reducing F9/F18 self-scoring bias surface area.
 */

export function buildCoherenceEvalPrompt(): string {
  return `You are a coherence evaluation agent. Your job is to detect gaps between document tiers in a three-tier planning system.

## Output Format

Respond with ONLY a JSON object matching this schema:

{
  "gaps": [
    {
      "id": "GAP-01",
      "severity": "CRITICAL | MAJOR | MINOR",
      "sourceDocument": "prd | masterPlan | phasePlan",
      "targetDocument": "masterPlan | phasePlan",
      "description": "Clear description of the alignment gap",
      "missingRequirement": "The specific requirement or element that is missing or misaligned"
    }
  ],
  "summary": "1-2 sentence overall assessment of tier alignment"
}

## Evaluation Dimensions

Check each of these dimensions systematically. For each dimension, either report a gap or confirm coverage.

### PRD -> Master Plan Alignment (when both provided)
1. **Requirement Coverage:** Every functional requirement in the PRD must map to at least one phase.
2. **Success Criteria Traceability:** Each PRD success criterion must be achievable by the combined phases.
3. **Scope Fidelity:** The master plan must not introduce capabilities beyond what the PRD describes (scope creep).
4. **Out-of-Scope Respect:** Items explicitly marked out-of-scope in the PRD must not appear in any phase.

### Master Plan -> Phase Plan Alignment (when phase plans provided)
5. **Phase Output Delivery:** Each phase plan's stories must collectively deliver the outputs declared in the master plan phase.
6. **Phase Input Consumption:** Each phase plan must use only the inputs declared in its master plan phase entry (plus environment).
7. **Dependency Honoring:** If master plan says PH-02 depends on PH-01, phase plan PH-02 must not assume artifacts from PH-03.
8. **Estimated Stories Accuracy:** The actual story count should be within ±50% of estimatedStories (flag large deviations).

## Severity Classification
- **CRITICAL:** A PRD requirement has no coverage in any phase, OR a phase plan contradicts the PRD.
- **MAJOR:** A phase plan partially covers a requirement but misses key aspects, OR I/O chain is broken.
- **MINOR:** Estimated story count deviation, minor scope additions that align with PRD intent.

## Rules
- Use semantic matching, NOT exact string matching for requirement coverage (anti-pattern F50).
- If a requirement is covered by a different approach than the PRD assumed, that is NOT a gap — the plan adapts to implementation realities.
- Report only genuine gaps. Do not fabricate issues to appear thorough.
- If no gaps exist, return an empty array: { "gaps": [], "summary": "All tiers are aligned." }`;
}

/**
 * Build the user message for coherence evaluation.
 * Includes whichever tier documents are available.
 */
export function buildCoherenceEvalUserMessage(options: {
  prdContent: string;
  masterPlanContent?: string;
  phasePlans?: Array<{ phaseId: string; content: string }>;
}): string {
  let message = `## PRD (Vision Document)\n\n${options.prdContent}`;

  if (options.masterPlanContent) {
    message += `\n\n## Master Plan\n\n${options.masterPlanContent}`;
  }

  if (options.phasePlans && options.phasePlans.length > 0) {
    message += `\n\n## Phase Plans`;
    for (const pp of options.phasePlans) {
      message += `\n\n### Phase ${pp.phaseId}\n\n${pp.content}`;
    }
  }

  return message;
}
