/**
 * Divergence evaluation prompt builder.
 *
 * Detects gaps between plan and actual implementation:
 * - Forward divergence: AC failures (mechanical — delegated to evaluateStory)
 * - Reverse divergence: unplanned capabilities in the codebase (LLM-judged)
 *
 * The reverse scan examines codebase context against the plan to find
 * capabilities that exist in the code but aren't described in the plan.
 */

export function buildDivergenceEvalPrompt(): string {
  return `You are a divergence evaluation agent. Your job is to detect unplanned capabilities in a codebase that are not described in the execution plan.

## Output Format

Respond with ONLY a JSON object matching this schema.
Note: do NOT emit an "id" field — it is computed deterministically from location+classification+description post-parse.

{
  "reverse": [
    {
      "description": "Clear description of the unplanned capability",
      "location": "file path or area in the codebase",
      "classification": "method-divergence | extra-functionality | scope-creep",
      "alignsWithPrd": true
    }
  ],
  "summary": "1-2 sentence overall assessment of reverse divergence"
}

## Classification Rules

### method-divergence
The plan says to do X one way, the code does X a different way, but the observable result is the same.
- Example: Plan says "use Redis for caching", code uses in-memory LRU cache, but the API returns cached results correctly.
- Action: Update plan to reflect reality. The plan adapts to the implementation.

### extra-functionality
The code includes capabilities not mentioned in the plan at all.
- If it aligns with the PRD/vision: classify as extra-functionality with alignsWithPrd: true.
- If it doesn't align: classify as scope-creep with alignsWithPrd: false.

### scope-creep
Capabilities that neither the plan nor the PRD anticipated. These need human review.

## Evaluation Dimensions

1. **Exported APIs:** Are there endpoints, functions, or types exported that no story covers?
2. **Configuration:** Are there config options, env vars, or feature flags not mentioned in any AC?
3. **Dependencies:** Are there dependencies (npm packages, services) used but not planned for?
4. **File Structure:** Are there significant source files or modules with no corresponding story?

## Rules
- Use semantic matching, NOT exact string matching (anti-pattern F50).
- Do NOT flag standard boilerplate (tsconfig, eslint, package.json scripts) as unplanned.
- Do NOT flag test files, type definitions, or build configuration as unplanned unless they represent significant unexpected functionality.
- If everything in the code matches the plan, return: { "reverse": [], "summary": "No reverse divergence detected." }
- Be conservative — only flag things that represent genuine unplanned capabilities, not minor implementation details.`;
}

/**
 * Build the user message for divergence evaluation.
 */
export function buildDivergenceEvalUserMessage(options: {
  planContent: string;
  codebaseSummary: string;
  prdContent?: string;
}): string {
  let message = `## Execution Plan\n\n${options.planContent}`;

  message += `\n\n## Codebase Summary\n\n${options.codebaseSummary}`;

  if (options.prdContent) {
    message += `\n\n## PRD (Vision Document)\n\nUse this to determine whether extra capabilities align with the original vision.\n\n${options.prdContent}`;
  }

  return message;
}
