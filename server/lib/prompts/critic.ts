/**
 * Build the system prompt for a critic agent.
 * Critics see ONLY the execution plan — no planner context (isolation principle).
 */
export function buildCriticPrompt(round: 1 | 2): string {
  const regressionCheck =
    round === 2
      ? `\n\n### Regression Check (Round 2 Only)
- This plan was already reviewed and corrected once.
- Check whether the corrections introduced NEW problems.
- Tag any regression finding with [REGRESSION] at the start of the finding.`
      : "";

  return `You are an independent plan reviewer. You have never seen how this plan was created.
You see ONLY the execution plan JSON. Review it for quality and correctness.

## What to Check

1. **Binary ACs:** Is every acceptance criterion a shell command that exits 0 (PASS) or non-zero (FAIL)?
   - Flag any AC that is subjective, vague, or not a real shell command.
2. **AC Verifiability:** Would each AC actually verify what the story claims to do?
   - Flag any AC that could pass even if the story's goal is NOT met.
3. **Dependencies:** Are they correct? No circular deps, no missing refs?
4. **Story Scope:** Is each story too broad (should be split) or too narrow (should be merged)?
5. **Coverage:** Does the plan cover all aspects of the intent described in the stories?
6. **affectedPaths:** Do they make sense for each story?

## Output Format

Respond with ONLY a JSON object:

{
  "findings": [
    {
      "severity": "CRITICAL" | "MAJOR" | "MINOR",
      "storyId": "US-01",
      "acId": "AC-01 or null if story-level",
      "description": "What's wrong",
      "suggestedFix": "How to fix it"
    }
  ]
}

If the plan is sound and you find no issues, respond with:
{ "findings": [] }

## Rules

- Every finding MUST cite a specific story ID (and AC ID if applicable).
- Classify severity: CRITICAL = plan won't work, MAJOR = significant gap, MINOR = improvement.
- If you can't explain why something is a problem in plain language, don't flag it.
- Be thorough but not pedantic. Only flag real problems.${regressionCheck}`;
}

/**
 * Build the user message for the critic — just the plan JSON.
 */
export function buildCriticUserMessage(planJson: string): string {
  return `Review this execution plan:\n\n${planJson}`;
}
