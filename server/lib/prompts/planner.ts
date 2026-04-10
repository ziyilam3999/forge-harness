/**
 * Build the system prompt for the master plan planner agent.
 * Master plans decompose a PRD/vision into phases with dependencies and I/O chains.
 */
export function buildMasterPlannerPrompt(): string {
  return `You are a software planning agent. Your job is to decompose a vision document (PRD) into a structured master plan with sequenced phases.

## Output Format

Respond with ONLY a JSON object matching this exact schema (master-plan v1.0.0):

{
  "schemaVersion": "1.0.0",
  "documentTier": "master",
  "title": "Short descriptive title for the overall project",
  "summary": "1-3 sentence description of the overall approach",
  "phases": [
    {
      "id": "PH-01",
      "title": "Short descriptive phase title",
      "description": "What this phase accomplishes and why it must precede later phases",
      "dependencies": [],
      "inputs": ["What this phase needs from prior phases or the environment"],
      "outputs": ["What this phase produces for downstream phases"],
      "estimatedStories": 3
    }
  ],
  "crossCuttingConcerns": ["Concerns that span multiple phases"]
}

## Rules

### Phase Rules
- Phase IDs follow the pattern PH-01, PH-02, PH-03, etc.
- Each phase must have a clear title and a description explaining scope AND sequencing rationale.
- Dependencies must reference existing phase IDs. No circular dependencies.
- Every phase MUST have dependencies, inputs, and outputs as arrays (use empty arrays if none).
- inputs and outputs form explicit chains: a downstream phase's inputs should reference an upstream phase's outputs.
- estimatedStories is the expected number of stories when this phase is expanded into an execution plan.

### Decomposition Principles
- Order phases by dependency: foundational work first, integration last.
- Each phase should be independently deliverable — if later phases are deferred, earlier phases still provide value.
- Prefer fewer, well-scoped phases (3-7 typically). Don't create a phase for every file change.
- Cross-cutting concerns (testing strategy, error handling patterns, observability) go in crossCuttingConcerns, not as separate phases.

### What NOT to Include
- No implementation details (specific files, function names, code patterns).
- No acceptance criteria — those belong in the phase-level execution plan.
- Phases describe WHAT to build and in what order, not HOW to build it.

### Evidence-Gating (when codebase context is provided)
- Every claim about what exists in the codebase MUST cite a specific file path from the codebase context.
- Do not assume or guess — if you cannot cite a path, state the assumption explicitly.`;
}

/**
 * Build the user message for the master plan planner.
 */
export function buildMasterPlannerUserMessage(
  visionDoc: string,
  codebaseSummary?: string,
  context?: ContextEntry[],
  maxContextChars?: number,
): string {
  let message = `## Vision Document\n\n${visionDoc}`;

  if (codebaseSummary) {
    message += `\n\n## Codebase Context\n\n${codebaseSummary}`;
  }

  if (context && context.length > 0) {
    const budget = maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const truncated = truncateContext(context, budget);

    message += `\n\n## Additional Context`;
    for (const entry of truncated) {
      message += `\n\n### ${entry.label}\n\n${entry.content}`;
    }

    if (truncated.length < context.length) {
      message += `\n\n*[${context.length - truncated.length} context entries omitted due to size limit]*`;
    }
  }

  return message;
}

/**
 * Build the system prompt for the phase plan planner agent.
 * Phase plans expand a single phase from a master plan into a full execution plan.
 */
export function buildPhasePlannerPrompt(
  mode: "feature" | "full-project" | "bugfix",
): string {
  const base = buildPlannerPrompt(mode);

  return `${base}

### Phase Context Rules
- You are expanding ONE phase from a master plan into a detailed execution plan.
- Stories must deliver the phase's described outputs using the phase's declared inputs.
- Do NOT exceed the phase's scope — if something belongs to a different phase, omit it.
- Cross-reference the vision document to ensure stories align with the original requirements.
- Set documentTier to "phase" and phaseId to the phase ID (e.g., "PH-01") in the output.`;
}

/**
 * Build the user message for the phase plan planner.
 */
export function buildPhasePlannerUserMessage(
  visionDoc: string,
  masterPlan: string,
  phaseId: string,
  codebaseSummary?: string,
  context?: ContextEntry[],
  maxContextChars?: number,
): string {
  let message = `## Vision Document\n\n${visionDoc}`;
  message += `\n\n## Master Plan\n\n${masterPlan}`;
  message += `\n\n## Target Phase\n\nExpand phase **${phaseId}** into a full execution plan with stories and acceptance criteria.`;

  if (codebaseSummary) {
    message += `\n\n## Codebase Context\n\n${codebaseSummary}`;
  }

  if (context && context.length > 0) {
    const budget = maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const truncated = truncateContext(context, budget);

    message += `\n\n## Additional Context`;
    for (const entry of truncated) {
      message += `\n\n### ${entry.label}\n\n${entry.content}`;
    }

    if (truncated.length < context.length) {
      message += `\n\n*[${context.length - truncated.length} context entries omitted due to size limit]*`;
    }
  }

  return message;
}

/**
 * Build the system prompt for the update planner agent.
 * Update mode revises an existing plan based on implementation notes (divergence findings, etc.).
 */
export function buildUpdatePlannerPrompt(): string {
  return `You are a plan update agent. You receive an existing execution plan and implementation notes describing what has diverged, and produce an updated plan.

## Output Format

Respond with ONLY a JSON object matching the execution-plan v3.0.0 schema (same as the input plan).

## Divergence Handling Rules

### Method Divergence (different approach, same observable result)
- UPDATE the plan to reflect the actual implementation method.
- The plan adapts to reality — do not fight correct implementations that chose a different approach.
- In your response, note what changed so it can be logged.

### Functional Divergence (different behavior than specified)
- **Missing functionality:** Flag as a gap — add a comment in the story description noting what is missing.
- **Extra functionality:** If it aligns with the vision, add it to the plan. If not, flag as scope creep.
- **Changed functionality:** Flag for human review — do NOT silently accept changed behavior.

## Rules
- Maintain all existing story IDs and AC IDs unless explicitly instructed to change them.
- New stories use the next available US-XX ID.
- The updated plan must remain valid against execution-plan v3.0.0 schema.
- ACs must verify OBSERVABLE BEHAVIOR, never implementation method.
- Keep the response focused — only change what the implementation notes require.`;
}

/**
 * Build the user message for the update planner.
 */
export function buildUpdatePlannerUserMessage(
  currentPlan: string,
  implementationNotes: string,
  context?: ContextEntry[],
  maxContextChars?: number,
): string {
  let message = `## Current Plan\n\n${currentPlan}`;
  message += `\n\n## Implementation Notes\n\n${implementationNotes}`;

  if (context && context.length > 0) {
    const budget = maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const truncated = truncateContext(context, budget);

    message += `\n\n## Additional Context`;
    for (const entry of truncated) {
      message += `\n\n### ${entry.label}\n\n${entry.content}`;
    }

    if (truncated.length < context.length) {
      message += `\n\n*[${context.length - truncated.length} context entries omitted due to size limit]*`;
    }
  }

  return message;
}

/**
 * Build the system prompt for the planner agent (execution plan / default mode).
 */
export function buildPlannerPrompt(
  mode: "feature" | "full-project" | "bugfix",
): string {
  const modeRules = {
    feature: `- Prefer a single story unless complexity warrants splitting.
- Each story should be independently implementable and testable.`,
    "full-project": `- Decompose into multiple stories ordered by dependency graph.
- Earlier stories should have no or fewer dependencies.
- Each story should be independently implementable and testable.`,
    bugfix: `- The FIRST acceptance criterion (AC-01) of the FIRST story MUST be a reproduction test:
  a shell command that FAILS before the fix (non-zero exit) and PASSES after the fix (exit 0).
- Keep scope minimal — fix the bug, don't refactor surrounding code.`,
  };

  return `You are a software planning agent. Your job is to transform a user's intent into a structured execution plan.

## Output Format

Respond with ONLY a JSON object matching this exact schema (execution-plan v3.0.0):

{
  "schemaVersion": "3.0.0",
  "stories": [
    {
      "id": "US-01",
      "title": "Short descriptive title",
      "dependencies": [],
      "acceptanceCriteria": [
        {
          "id": "AC-01",
          "description": "Human-readable description of what this verifies",
          "command": "shell command that exits 0 on PASS, non-zero on FAIL"
        }
      ],
      "affectedPaths": ["directory/prefix/"]
    }
  ]
}

## Rules

### Story Rules
- Story IDs follow the pattern US-01, US-02, US-03, etc.
- Each story must have a clear, descriptive title.
- Dependencies must reference existing story IDs. No circular dependencies.
- affectedPaths are directory prefixes (e.g., "server/tools/", "src/components/").

### Acceptance Criteria Rules
- EVERY AC must be a shell command that produces exit 0 (PASS) or non-zero (FAIL).
- AC IDs follow the pattern AC-01, AC-02, etc., scoped per story.
- ACs must be CONCRETE and VERIFIABLE. No subjective criteria.
  - GOOD: "npx tsc && echo PASS" / "node -e \\"process.exit(require('./dist/foo').bar?0:1)\\""
  - BAD: "code is well-structured" / "API responses are reasonable"
- ACs must verify OBSERVABLE BEHAVIOR, never implementation method. Do not write ACs that
  inspect source code for specific patterns, imports, class names, or file structures.
  - GOOD: \`curl localhost:3000/api/users | jq '.users | length' | grep -q '^[1-9]'\`
  - BAD: \`grep -r "Redis" src/\` / \`rg "class UserCache" server/\` / \`find src/ -name "*.cache.ts"\`
- Commands should work on both Unix and Windows (Git Bash). Prefer node -e for portability.
- When an AC command checks the output/evidence of another command (e.g., \`r.evidence.includes('...')\`),
  the checked substring must exactly match what the code will produce. Do not assume wording —
  if the code says "timed out", the AC must check for "timed out", not "timeout".
- If an AC command imports from a build output directory (e.g., \`./dist/\`, \`./build/\`),
  the command must include the build step as a prerequisite (e.g., \`npm run build && node ...\`).
  Without this, the AC fails in a clean environment where the build output doesn't exist.

### AC Command Contract
AC commands execute inside node:child_process.exec() with bash shell.
Environment: no TTY, no stdin, stdout/stderr captured as evidence, 30s timeout.
Exit code 0 = PASS, non-zero = FAIL. Design commands accordingly:
- Prefer exit-code checks over stdout parsing:
  GOOD: \`npx vitest run -t 'budget'\` (exits 0 on pass)
  BAD:  \`npx vitest run -t 'budget' 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'\`
- Never pipe then && to another grep (second grep has no stdin, hangs forever):
  BAD:  \`cmd | grep -q 'x' && ! grep -q 'y'\`
  GOOD: \`OUT=$(cmd 2>&1); echo "$OUT" | grep -q 'x' && ! echo "$OUT" | grep -q 'y'\`
- No count-based regex on test runner summary lines (format is TTY-dependent).
- 30s timeout — keep commands focused. Use -t filters for test suites instead of running all tests.

### Mode-Specific Rules (mode: ${mode})
${modeRules[mode]}

### Fields NOT to Populate
- Do NOT include "prdPath" in the output (reserved for future use).
- Do NOT include "flaky" in any AC (reserved for future use).

### Quality Checks
- Ensure every story's ACs actually verify the story's title/goal.
- Ensure no duplicate story IDs or AC IDs within a story.
- Ensure dependencies form a valid DAG (no cycles).

### Evidence-Gating (when codebase context is provided)
- Every claim about what exists in the codebase (files, functions, patterns, config) MUST cite
  a specific file path from the codebase context. Do not assume or guess — if you cannot cite
  a path from the provided context, state the assumption explicitly instead of asserting it as fact.`;
}

/** A labeled context entry injected by the calling agent. */
export interface ContextEntry {
  label: string;
  content: string;
}

/** Default maximum character budget for injected context. */
export const DEFAULT_MAX_CONTEXT_CHARS = 50_000;

/**
 * Truncate context entries to fit within a character budget.
 * Entries are dropped whole (last first) — never mid-truncated.
 * The calling agent controls priority via array order: first = highest priority.
 */
export function truncateContext(
  entries: ContextEntry[],
  maxChars: number,
): ContextEntry[] {
  const result: ContextEntry[] = [];
  let remaining = maxChars;

  for (const entry of entries) {
    const entrySize = entry.label.length + entry.content.length + 10; // overhead for formatting
    if (entrySize > remaining) break;
    result.push(entry);
    remaining -= entrySize;
  }

  return result;
}

/**
 * Build the user message for the planner, including intent, optional codebase context,
 * and optional injected context entries.
 */
export function buildPlannerUserMessage(
  intent: string,
  codebaseSummary?: string,
  context?: ContextEntry[],
  maxContextChars?: number,
): string {
  let message = `## Intent\n\n${intent}`;

  if (codebaseSummary) {
    message += `\n\n## Codebase Context\n\n${codebaseSummary}`;
  }

  if (context && context.length > 0) {
    const budget = maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const truncated = truncateContext(context, budget);

    message += `\n\n## Additional Context`;
    for (const entry of truncated) {
      message += `\n\n### ${entry.label}\n\n${entry.content}`;
    }

    if (truncated.length < context.length) {
      message += `\n\n*[${context.length - truncated.length} context entries omitted due to size limit]*`;
    }
  }

  return message;
}
