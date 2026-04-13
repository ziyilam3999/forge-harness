import {
  AC_SUBPROCESS_RULES_PROMPT,
  AC_LINT_RULES,
} from "./shared/ac-subprocess-rules.js";

/**
 * Render the structured rule list as a markdown block the critic can cite.
 * Exposed so tests can assert exact rule-id coverage.
 */
export function renderAcLintRulesForCritic(): string {
  const lines = AC_LINT_RULES.map(
    (r) =>
      `- **${r.id}**: ${r.description}\n  - Wrong: \`${r.wrongExample}\`\n  - Right: \`${r.rightExample}\``,
  );
  return lines.join("\n");
}

/**
 * Build the system prompt for a master plan critic agent.
 * Reviews a master plan for vision coverage and phase sequencing quality.
 */
export function buildMasterCriticPrompt(round: 1 | 2): string {
  const regressionCheck =
    round === 2
      ? `\n\n### Regression Check (Round 2 Only)
- This plan was already reviewed and corrected once.
- Check whether the corrections introduced NEW problems.
- Tag any regression finding with [REGRESSION] at the start of the finding.`
      : "";

  return `You are an independent plan reviewer. You have never seen how this master plan was created.
You see ONLY the master plan JSON and the vision document. Review for quality and correctness.

## What to Check

1. **Vision Coverage:** Does the master plan cover ALL requirements from the vision document?
   - Flag any requirement that has no corresponding phase.
2. **Phase Sequencing:** Are dependencies correct? Do inputs/outputs chain properly?
   - Flag any phase whose inputs are not produced by a listed dependency's outputs.
3. **Dependency Graph:** No circular deps, no missing refs, sensible ordering?
4. **Phase Scope:** Is each phase appropriately scoped — not too broad, not too narrow?
   - Phases should be independently deliverable. A phase with 15+ estimated stories may need splitting.
5. **Cross-Cutting Concerns:** Are shared concerns properly identified?
   - Flag concerns embedded in phases that should be cross-cutting.
6. **No Implementation Details:** Master plans describe WHAT, not HOW.
   - Flag any reference to specific files, function names, or code patterns.
7. **Context Contradiction:** If additional context was provided, does the plan contradict any context entry?
   - Flag if the planner contradicts context without citing the precedence rule (PRD > KB > memory > prior plans).

## Output Format

Respond with ONLY a JSON object:

{
  "findings": [
    {
      "severity": "CRITICAL" | "MAJOR" | "MINOR",
      "phaseId": "PH-01 or null if plan-level",
      "description": "What's wrong",
      "suggestedFix": "How to fix it"
    }
  ]
}

If the plan is sound, respond with: { "findings": [] }

## Rules

- Every finding MUST cite a specific phase ID (or null for plan-level issues).
- Classify severity: CRITICAL = plan won't work, MAJOR = significant gap, MINOR = improvement.
- Be thorough but not pedantic. Only flag real problems.${regressionCheck}`;
}

/**
 * Build the user message for the master plan critic.
 */
export function buildMasterCriticUserMessage(
  planJson: string,
  visionDoc?: string,
): string {
  let message = `Review this master plan:\n\n${planJson}`;
  if (visionDoc) {
    message += `\n\n## Vision Document (for coverage checking)\n\n${visionDoc}`;
  }
  return message;
}

/**
 * Build the system prompt for a critic agent (execution plan / default mode).
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
3. **Implementation Coupling:** Does any AC verify implementation method instead of observable behavior?
   - Flag any AC that greps/searches source code for specific patterns, class names, imports, or file structures.
   - ACs should test WHAT the system does (API responses, CLI output, exit codes), not HOW it's built.
   - Examples of coupled ACs: \`grep -r "Redis" src/\`, \`rg "class.*Cache" server/\`, \`find src/ -name "*.ts" | xargs grep "import"\`
4. **Dependencies:** Are they correct? No circular deps, no missing refs?
5. **Story Scope:** Is each story too broad (should be split) or too narrow (should be merged)?
6. **Coverage:** Does the plan cover all aspects of the intent described in the stories?
7. **affectedPaths:** Do they make sense for each story?
8. **Evidence-Gating:** If the plan references specific files, functions, or patterns in the codebase,
   are those references grounded in the codebase context? Flag any claim about the codebase that
   appears to be assumed rather than cited from provided context.
9. **Subprocess Safety (AC Command Contract):** Every AC command runs inside
   \`node:child_process.exec()\` — no TTY, no stdin, 30s timeout. Flag any AC
   command that violates the rules below. When flagging, cite the specific
   rule id (e.g. "F55-vitest-count-grep") in your \`description\`.

${AC_SUBPROCESS_RULES_PROMPT}

**Subprocess-safety rules (cite the id in findings):**
${renderAcLintRulesForCritic()}

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
