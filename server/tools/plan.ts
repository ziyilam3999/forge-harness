import { z } from "zod";
import { extractJson } from "../lib/anthropic.js";
import { scanCodebase } from "../lib/codebase-scan.js";
import {
  buildPlannerPrompt,
  buildPlannerUserMessage,
  buildMasterPlannerPrompt,
  buildMasterPlannerUserMessage,
  buildPhasePlannerPrompt,
  buildPhasePlannerUserMessage,
  buildUpdatePlannerPrompt,
  buildUpdatePlannerUserMessage,
  type ContextEntry,
} from "../lib/prompts/planner.js";
import { buildCriticPrompt, buildCriticUserMessage, buildMasterCriticPrompt, buildMasterCriticUserMessage } from "../lib/prompts/critic.js";
import { buildCorrectorPrompt, buildCorrectorUserMessage, buildMasterCorrectorPrompt, buildMasterCorrectorUserMessage } from "../lib/prompts/corrector.js";
import { validateExecutionPlan } from "../validation/execution-plan.js";
import { validateMasterPlan } from "../validation/master-plan.js";
import { writeRunRecord, type RunRecord } from "../lib/run-record.js";
import { RunContext, trackedCallClaude } from "../lib/run-context.js";
import type { ExecutionPlan } from "../types/execution-plan.js";
import type { MasterPlan } from "../types/master-plan.js";

/**
 * Regex patterns that indicate an AC inspects source code rather than
 * verifying observable behavior. These are Tier 1 mechanical checks —
 * deterministic, no LLM judgment involved.
 */
const IMPLEMENTATION_COUPLING_PATTERNS: RegExp[] = [
  /\bgrep\b.*\bsrc\//,      // grep ... src/
  /\bgrep\b.*\bserver\//,   // grep ... server/
  /\brg\b.*\bsrc\//,        // rg ... src/
  /\brg\b.*\bserver\//,     // rg ... server/
  /\bfind\s+src\/.*-name/,  // find src/ ... -name
  /\bfind\s+server\/.*-name/,  // find server/ ... -name
];

/**
 * Scan all AC commands in a plan for implementation-coupled patterns.
 * Returns a list of { storyId, acId, command, pattern } for each violation.
 */
export function detectCoupledACs(
  plan: ExecutionPlan,
): Array<{ storyId: string; acId: string; command: string; pattern: string }> {
  const violations: Array<{
    storyId: string;
    acId: string;
    command: string;
    pattern: string;
  }> = [];

  for (const story of plan.stories) {
    for (const ac of story.acceptanceCriteria) {
      for (const pattern of IMPLEMENTATION_COUPLING_PATTERNS) {
        if (pattern.test(ac.command)) {
          violations.push({
            storyId: story.id,
            acId: ac.id,
            command: ac.command,
            pattern: pattern.source,
          });
          break; // one match per AC is enough
        }
      }
    }
  }

  return violations;
}

export const planInputSchema = {
  intent: z.string().describe("What to build — a PRD, description, or goal statement"),
  projectPath: z
    .string()
    .optional()
    .describe(
      "Absolute path to project root for codebase context. If omitted, plans without codebase awareness.",
    ),
  mode: z
    .enum(["feature", "full-project", "bugfix"])
    .optional()
    .describe(
      "Planning mode. Auto-detected from intent if omitted — see known limitations below.",
    ),
  tier: z
    .enum(["quick", "standard", "thorough"])
    .optional()
    .describe(
      "Critique depth. quick=no critique, standard=1 round, thorough=2 rounds. Default: thorough.",
    ),
  documentTier: z
    .enum(["master", "phase", "update"])
    .optional()
    .describe(
      "Three-tier document system. " +
      "master: decompose a vision doc into phases. " +
      "phase: expand one phase into stories with ACs. " +
      "update: revise a plan based on implementation notes. " +
      "If omitted, produces a standalone execution plan (backward compatible).",
    ),
  visionDoc: z
    .string()
    .optional()
    .describe("PRD or vision document content. Required for master and phase tiers."),
  masterPlan: z
    .string()
    .optional()
    .describe("Master plan JSON string. Required for phase tier."),
  phaseId: z
    .string()
    .optional()
    .describe("Phase ID to expand (e.g., 'PH-01'). Required for phase tier."),
  implementationNotes: z
    .string()
    .optional()
    .describe("Notes on what diverged from the plan. Required for update tier."),
  currentPlan: z
    .string()
    .optional()
    .describe("Existing plan JSON string to update. Required for update tier."),
  context: z
    .array(
      z.object({
        label: z.string().describe("Label for this context entry (e.g., 'Proven patterns')"),
        content: z.string().describe("Content of the context entry"),
      }),
    )
    .optional()
    .describe(
      "Additional context entries injected by the calling agent. " +
      "Array order = priority (first = highest). Entries are dropped whole (last first) " +
      "when exceeding maxContextChars.",
    ),
  maxContextChars: z
    .number()
    .positive()
    .optional()
    .describe(
      "Maximum character budget for injected context. Default: 50000. " +
      "Entries are dropped whole (last first) to stay within budget.",
    ),
};

/** Keywords that trigger bugfix mode auto-detection. */
const BUGFIX_KEYWORDS = ["fix", "bug", "broken", "crash", "error"];

/**
 * Auto-detect planning mode from intent.
 *
 * KNOWN LIMITATION: keyword-based detection can produce false positives.
 * "add error handling" would be classified as bugfix because it contains "error".
 * Users should pass `mode` explicitly when intent is ambiguous.
 */
function detectMode(intent: string): "feature" | "bugfix" {
  const lower = intent.toLowerCase();
  for (const keyword of BUGFIX_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(lower)) return "bugfix";
  }
  return "feature";
}

interface CritiqueFindings {
  findings: Array<{
    severity: string;
    storyId: string;
    acId: string | null;
    description: string;
    suggestedFix: string;
  }>;
}

interface CorrectorOutput {
  plan: ExecutionPlan;
  dispositions: Array<{
    findingIndex: number;
    applied: boolean;
    reason: string;
  }>;
}

interface MasterCritiqueFindings {
  findings: Array<{
    severity: string;
    phaseId: string | null;
    description: string;
    suggestedFix: string;
  }>;
}

interface MasterCorrectorOutput {
  plan: MasterPlan;
  dispositions: Array<{
    findingIndex: number;
    applied: boolean;
    reason: string;
  }>;
}

/**
 * Run the planner agent to produce a draft execution plan.
 */
async function runPlanner(
  intent: string,
  mode: "feature" | "full-project" | "bugfix",
  codebaseSummary: string | undefined,
  model: string | undefined,
  ctx: RunContext,
  context?: ContextEntry[],
  maxContextChars?: number,
): Promise<{ plan: ExecutionPlan; validationRetries: number }> {
  const system = buildPlannerPrompt(mode);
  const userMessage = buildPlannerUserMessage(intent, codebaseSummary, context, maxContextChars);

  const result = await trackedCallClaude(ctx, "Running planner", "planner", {
    system,
    messages: [{ role: "user", content: userMessage }],
    model,
    jsonMode: true,
  });

  const parsed = extractJson(result.text);
  const validation = validateExecutionPlan(parsed);

  if (!validation.valid) {
    // Retry once with error feedback
    console.error(
      "forge_plan: planner output failed validation, retrying with feedback:",
      validation.errors,
    );
    const retryResult = await trackedCallClaude(ctx, "Retrying planner (validation)", "planner", {
      system,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your JSON output failed schema validation with these errors:\n${validation.errors?.join("\n")}\n\nPlease fix the issues and respond with the corrected JSON only.`,
        },
      ],
      model,
      jsonMode: true,
    });

    const retryParsed = extractJson(retryResult.text);
    const retryValidation = validateExecutionPlan(retryParsed);
    if (!retryValidation.valid) {
      throw new Error(
        `Planner output failed validation after retry: ${retryValidation.errors?.join("; ")}`,
      );
    }
    return { plan: retryParsed as ExecutionPlan, validationRetries: 1 };
  }

  return { plan: parsed as ExecutionPlan, validationRetries: 0 };
}

/**
 * Run a critic agent on the plan. Returns findings or empty array on failure.
 */
async function runCritic(
  plan: ExecutionPlan,
  round: 1 | 2,
  model: string | undefined,
  ctx: RunContext,
): Promise<CritiqueFindings> {
  const system = buildCriticPrompt(round);
  const planJson = JSON.stringify(plan, null, 2);

  try {
    const result = await trackedCallClaude(ctx, `Running critic round ${round}`, "critic", {
      system,
      messages: [{ role: "user", content: buildCriticUserMessage(planJson) }],
      model,
      jsonMode: true,
    });

    const parsed = extractJson(result.text) as CritiqueFindings;
    if (!parsed.findings || !Array.isArray(parsed.findings)) {
      console.error("forge_plan: critic returned malformed findings, treating as zero findings");
      return { findings: [] };
    }
    return parsed;
  } catch (e) {
    console.error(
      `forge_plan: critic round ${round} failed, treating as zero findings:`,
      e instanceof Error ? e.message : String(e),
    );
    return { findings: [] };
  }
}

/**
 * Run a corrector agent. Returns corrected plan or the original on failure.
 */
async function runCorrector(
  plan: ExecutionPlan,
  findings: CritiqueFindings,
  model: string | undefined,
  ctx: RunContext,
): Promise<{ plan: ExecutionPlan; dispositions: CorrectorOutput["dispositions"] }> {
  const system = buildCorrectorPrompt();
  const planJson = JSON.stringify(plan, null, 2);
  const findingsJson = JSON.stringify(findings, null, 2);

  try {
    const result = await trackedCallClaude(ctx, "Running corrector", "corrector", {
      system,
      messages: [
        { role: "user", content: buildCorrectorUserMessage(planJson, findingsJson) },
      ],
      model,
      jsonMode: true,
    });

    const parsed = extractJson(result.text) as CorrectorOutput;

    // Validate the corrected plan
    const validation = validateExecutionPlan(parsed.plan);
    if (!validation.valid) {
      console.error(
        "forge_plan: corrector output failed validation, using pre-correction plan:",
        validation.errors,
      );
      return { plan, dispositions: [] };
    }

    return { plan: parsed.plan, dispositions: parsed.dispositions ?? [] };
  } catch (e) {
    console.error(
      "forge_plan: corrector failed, using pre-correction plan:",
      e instanceof Error ? e.message : String(e),
    );
    return { plan, dispositions: [] };
  }
}

// ── Master plan pipeline functions ──

/**
 * Run the planner agent to produce a draft master plan.
 */
async function runMasterPlanner(
  visionDoc: string,
  codebaseSummary: string | undefined,
  model: string | undefined,
  ctx: RunContext,
  context?: ContextEntry[],
  maxContextChars?: number,
): Promise<{ plan: MasterPlan; validationRetries: number }> {
  const system = buildMasterPlannerPrompt();
  const userMessage = buildMasterPlannerUserMessage(visionDoc, codebaseSummary, context, maxContextChars);

  const result = await trackedCallClaude(ctx, "Running master planner", "planner", {
    system,
    messages: [{ role: "user", content: userMessage }],
    model,
    jsonMode: true,
  });

  const parsed = extractJson(result.text);
  const validation = validateMasterPlan(parsed);

  if (!validation.valid) {
    console.error(
      "forge_plan: master planner output failed validation, retrying with feedback:",
      validation.errors,
    );
    const retryResult = await trackedCallClaude(ctx, "Retrying master planner (validation)", "planner", {
      system,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your JSON output failed schema validation with these errors:\n${validation.errors?.join("\n")}\n\nPlease fix the issues and respond with the corrected JSON only.`,
        },
      ],
      model,
      jsonMode: true,
    });

    const retryParsed = extractJson(retryResult.text);
    const retryValidation = validateMasterPlan(retryParsed);
    if (!retryValidation.valid) {
      throw new Error(
        `Master planner output failed validation after retry: ${retryValidation.errors?.join("; ")}`,
      );
    }
    return { plan: retryParsed as MasterPlan, validationRetries: 1 };
  }

  return { plan: parsed as MasterPlan, validationRetries: 0 };
}

/**
 * Run a critic agent on a master plan. Returns findings or empty array on failure.
 */
async function runMasterCritic(
  plan: MasterPlan,
  round: 1 | 2,
  model: string | undefined,
  ctx: RunContext,
  visionDoc?: string,
): Promise<MasterCritiqueFindings> {
  const system = buildMasterCriticPrompt(round);
  const planJson = JSON.stringify(plan, null, 2);

  try {
    const result = await trackedCallClaude(ctx, `Running master critic round ${round}`, "critic", {
      system,
      messages: [{ role: "user", content: buildMasterCriticUserMessage(planJson, visionDoc) }],
      model,
      jsonMode: true,
    });

    const parsed = extractJson(result.text) as MasterCritiqueFindings;
    if (!parsed.findings || !Array.isArray(parsed.findings)) {
      console.error("forge_plan: master critic returned malformed findings, treating as zero findings");
      return { findings: [] };
    }
    return parsed;
  } catch (e) {
    console.error(
      `forge_plan: master critic round ${round} failed, treating as zero findings:`,
      e instanceof Error ? e.message : String(e),
    );
    return { findings: [] };
  }
}

/**
 * Run a corrector agent on a master plan. Returns corrected plan or the original on failure.
 */
async function runMasterCorrector(
  plan: MasterPlan,
  findings: MasterCritiqueFindings,
  model: string | undefined,
  ctx: RunContext,
): Promise<{ plan: MasterPlan; dispositions: MasterCorrectorOutput["dispositions"] }> {
  const system = buildMasterCorrectorPrompt();
  const planJson = JSON.stringify(plan, null, 2);
  const findingsJson = JSON.stringify(findings, null, 2);

  try {
    const result = await trackedCallClaude(ctx, "Running master corrector", "corrector", {
      system,
      messages: [
        { role: "user", content: buildMasterCorrectorUserMessage(planJson, findingsJson) },
      ],
      model,
      jsonMode: true,
    });

    const parsed = extractJson(result.text) as MasterCorrectorOutput;

    const validation = validateMasterPlan(parsed.plan);
    if (!validation.valid) {
      console.error(
        "forge_plan: master corrector output failed validation, using pre-correction plan:",
        validation.errors,
      );
      return { plan, dispositions: [] };
    }

    return { plan: parsed.plan, dispositions: parsed.dispositions ?? [] };
  } catch (e) {
    console.error(
      "forge_plan: master corrector failed, using pre-correction plan:",
      e instanceof Error ? e.message : String(e),
    );
    return { plan, dispositions: [] };
  }
}

/**
 * Run the phase planner — expands a single master plan phase into an execution plan.
 */
async function runPhasePlanner(
  visionDoc: string,
  masterPlan: string,
  phaseId: string,
  mode: "feature" | "full-project" | "bugfix",
  codebaseSummary: string | undefined,
  model: string | undefined,
  ctx: RunContext,
  context?: ContextEntry[],
  maxContextChars?: number,
): Promise<{ plan: ExecutionPlan; validationRetries: number }> {
  const system = buildPhasePlannerPrompt(mode);
  const userMessage = buildPhasePlannerUserMessage(
    visionDoc, masterPlan, phaseId, codebaseSummary, context, maxContextChars,
  );

  const result = await trackedCallClaude(ctx, "Running phase planner", "planner", {
    system,
    messages: [{ role: "user", content: userMessage }],
    model,
    jsonMode: true,
  });

  const parsed = extractJson(result.text);
  const validation = validateExecutionPlan(parsed);

  if (!validation.valid) {
    console.error(
      "forge_plan: phase planner output failed validation, retrying with feedback:",
      validation.errors,
    );
    const retryResult = await trackedCallClaude(ctx, "Retrying phase planner (validation)", "planner", {
      system,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your JSON output failed schema validation with these errors:\n${validation.errors?.join("\n")}\n\nPlease fix the issues and respond with the corrected JSON only.`,
        },
      ],
      model,
      jsonMode: true,
    });

    const retryParsed = extractJson(retryResult.text);
    const retryValidation = validateExecutionPlan(retryParsed);
    if (!retryValidation.valid) {
      throw new Error(
        `Phase planner output failed validation after retry: ${retryValidation.errors?.join("; ")}`,
      );
    }
    return { plan: retryParsed as ExecutionPlan, validationRetries: 1 };
  }

  return { plan: parsed as ExecutionPlan, validationRetries: 0 };
}

/**
 * Run the update planner — revises an existing plan based on implementation notes.
 */
async function runUpdatePlanner(
  currentPlan: string,
  implementationNotes: string,
  model: string | undefined,
  ctx: RunContext,
  context?: ContextEntry[],
  maxContextChars?: number,
): Promise<{ plan: ExecutionPlan; validationRetries: number }> {
  const system = buildUpdatePlannerPrompt();
  const userMessage = buildUpdatePlannerUserMessage(currentPlan, implementationNotes, context, maxContextChars);

  const result = await trackedCallClaude(ctx, "Running update planner", "planner", {
    system,
    messages: [{ role: "user", content: userMessage }],
    model,
    jsonMode: true,
  });

  const parsed = extractJson(result.text);
  const validation = validateExecutionPlan(parsed);

  if (!validation.valid) {
    console.error(
      "forge_plan: update planner output failed validation, retrying with feedback:",
      validation.errors,
    );
    const retryResult = await trackedCallClaude(ctx, "Retrying update planner (validation)", "planner", {
      system,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your JSON output failed schema validation with these errors:\n${validation.errors?.join("\n")}\n\nPlease fix the issues and respond with the corrected JSON only.`,
        },
      ],
      model,
      jsonMode: true,
    });

    const retryParsed = extractJson(retryResult.text);
    const retryValidation = validateExecutionPlan(retryParsed);
    if (!retryValidation.valid) {
      throw new Error(
        `Update planner output failed validation after retry: ${retryValidation.errors?.join("; ")}`,
      );
    }
    return { plan: retryParsed as ExecutionPlan, validationRetries: 1 };
  }

  return { plan: parsed as ExecutionPlan, validationRetries: 0 };
}

// ── Shared utilities ──

/**
 * Format critique summary for output (works for both master and execution plan findings).
 */
function formatCritiqueSummary(
  rounds: Array<{ findings: { findings: Array<{ severity?: string }> }; dispositions: Array<{ applied: boolean }> }>,
): string {
  if (rounds.length === 0) return "";

  const lines: string[] = ["=== CRITIQUE SUMMARY ==="];

  for (let i = 0; i < rounds.length; i++) {
    const { findings, dispositions } = rounds[i];
    const critical = findings.findings.filter((f) => f.severity === "CRITICAL").length;
    const major = findings.findings.filter((f) => f.severity === "MAJOR").length;
    const minor = findings.findings.filter((f) => f.severity === "MINOR").length;
    const applied = dispositions.filter((d) => d.applied).length;

    lines.push(
      `Round ${i + 1}: ${findings.findings.length} findings ` +
        `(${critical} CRITICAL, ${major} MAJOR, ${minor} MINOR) — ${applied} applied`,
    );
  }

  return lines.join("\n");
}

/**
 * Build cost/usage summary section.
 */
function buildUsageSection(ctx: RunContext): string {
  const costSummary = ctx.cost.summarize();
  const costLabel = costSummary.isOAuthAuth ? "equivalent API cost" : "estimated cost";
  const costStr = costSummary.estimatedCostUsd !== null
    ? `$${costSummary.estimatedCostUsd.toFixed(4)} ${costLabel}`
    : "cost unknown (missing token data)";
  return `=== USAGE ===\nTotal tokens: ${costSummary.inputTokens} input / ${costSummary.outputTokens} output\n${costStr}`;
}

/**
 * Shared: optional codebase scan step.
 */
async function scanCodebaseIfNeeded(
  projectPath: string | undefined,
  ctx: RunContext,
): Promise<string | undefined> {
  if (projectPath) {
    ctx.progress.begin("Scanning codebase");
    const summary = await scanCodebase(projectPath);
    ctx.progress.complete("Scanning codebase");
    return summary;
  }
  ctx.progress.skip("Scanning codebase");
  return undefined;
}

/**
 * Shared: write a run record if projectPath is set.
 */
async function writeRunRecordIfNeeded(
  projectPath: string | undefined,
  startTime: number,
  documentTier: RunRecord["documentTier"],
  effectiveMode: RunRecord["mode"],
  effectiveTier: RunRecord["tier"],
  critiqueRounds: Array<{ findings: { findings: unknown[] }; dispositions: Array<{ applied: boolean }> }>,
  validationRetries: number,
  ctx: RunContext,
): Promise<void> {
  if (!projectPath) return;

  const costSummary = ctx.cost.summarize();
  const findingsTotal = critiqueRounds.reduce((sum, r) => sum + r.findings.findings.length, 0);
  const findingsApplied = critiqueRounds.reduce(
    (sum, r) => sum + r.dispositions.filter((d) => d.applied).length, 0,
  );

  const runRecord: RunRecord = {
    timestamp: new Date(startTime).toISOString(),
    tool: "forge_plan",
    documentTier,
    mode: effectiveMode,
    tier: effectiveTier,
    metrics: {
      inputTokens: costSummary.inputTokens,
      outputTokens: costSummary.outputTokens,
      critiqueRounds: critiqueRounds.length,
      findingsTotal,
      findingsApplied,
      findingsRejected: findingsTotal - findingsApplied,
      validationRetries,
      durationMs: Date.now() - startTime,
    },
    outcome: "success",
  };
  await writeRunRecord(projectPath, runRecord);
}

/**
 * Build dynamic stage list for the progress reporter.
 */
function buildStageList(documentTier: string | undefined, effectiveTier: string): string[] {
  const tierLabel = documentTier === "master" ? "master " : documentTier === "update" ? "update " : documentTier === "phase" ? "phase " : "";
  const stages = ["Scanning codebase", `Running ${tierLabel}planner`];
  if (effectiveTier !== "quick") {
    const maxRounds = effectiveTier === "thorough" ? 2 : 1;
    for (let r = 1; r <= maxRounds; r++) {
      stages.push(`Running ${documentTier === "master" ? "master " : ""}critic round ${r}`);
      stages.push(`Running ${documentTier === "master" ? "master " : ""}corrector`);
    }
  }
  return stages;
}

// ── Document tier handlers ──

/**
 * Handle master plan generation: vision doc → MasterPlan with phases.
 */
async function handleMasterPlan(options: HandlePlanOptions) {
  const { visionDoc, projectPath, tier, context, maxContextChars } = options;
  if (!visionDoc) {
    return {
      content: [{ type: "text" as const, text: "Error: visionDoc is required for documentTier 'master'." }],
      isError: true,
    };
  }

  const startTime = Date.now();
  const effectiveTier = tier ?? "thorough";

  const ctx = new RunContext({
    toolName: "forge_plan",
    projectPath,
    stages: buildStageList("master", effectiveTier),
  });

  const codebaseSummary = await scanCodebaseIfNeeded(projectPath, ctx);

  // Run master planner
  const plannerResult = await runMasterPlanner(
    visionDoc, codebaseSummary, undefined, ctx, context, maxContextChars,
  );
  let plan = plannerResult.plan;
  const validationRetries = plannerResult.validationRetries;

  // Critique loop (same tier-based rounds as execution plans)
  const critiqueRounds: Array<{
    findings: MasterCritiqueFindings;
    dispositions: MasterCorrectorOutput["dispositions"];
  }> = [];

  if (effectiveTier !== "quick") {
    const maxRounds = effectiveTier === "thorough" ? 2 : 1;
    for (let round = 1; round <= maxRounds; round++) {
      const findings = await runMasterCritic(plan, round as 1 | 2, undefined, ctx, visionDoc);

      if (findings.findings.length === 0) {
        critiqueRounds.push({ findings, dispositions: [] });
        continue;
      }

      const { plan: correctedPlan, dispositions } = await runMasterCorrector(plan, findings, undefined, ctx);
      plan = correctedPlan;
      critiqueRounds.push({ findings, dispositions });
    }
  }

  // Build output
  const sections: string[] = [
    "=== MASTER PLAN ===",
    JSON.stringify(plan, null, 2),
  ];

  const critiqueSummary = formatCritiqueSummary(critiqueRounds);
  if (critiqueSummary) sections.push(critiqueSummary);
  sections.push(buildUsageSection(ctx));

  await writeRunRecordIfNeeded(
    projectPath, startTime, "master", null, effectiveTier, critiqueRounds, validationRetries, ctx,
  );

  return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
}

/**
 * Handle phase plan generation: expand one master plan phase into stories with ACs.
 */
async function handlePhasePlan(options: HandlePlanOptions) {
  const { visionDoc, masterPlan, phaseId, projectPath, mode, tier, context, maxContextChars } = options;
  if (!visionDoc || !masterPlan || !phaseId) {
    return {
      content: [{ type: "text" as const, text: "Error: visionDoc, masterPlan, and phaseId are required for documentTier 'phase'." }],
      isError: true,
    };
  }

  const startTime = Date.now();
  const effectiveMode = mode ?? "full-project";
  const effectiveTier = tier ?? "thorough";

  const ctx = new RunContext({
    toolName: "forge_plan",
    projectPath,
    stages: buildStageList("phase", effectiveTier),
  });

  const codebaseSummary = await scanCodebaseIfNeeded(projectPath, ctx);

  // Run phase planner
  const plannerResult = await runPhasePlanner(
    visionDoc, masterPlan, phaseId, effectiveMode, codebaseSummary, undefined, ctx, context, maxContextChars,
  );
  let plan = plannerResult.plan;
  const validationRetries = plannerResult.validationRetries;

  // Standard critique loop (reuse execution plan critic/corrector)
  const critiqueRounds: Array<{
    findings: CritiqueFindings;
    dispositions: CorrectorOutput["dispositions"];
  }> = [];

  if (effectiveTier !== "quick") {
    const maxRounds = effectiveTier === "thorough" ? 2 : 1;
    for (let round = 1; round <= maxRounds; round++) {
      const findings = await runCritic(plan, round as 1 | 2, undefined, ctx);

      if (findings.findings.length === 0) {
        critiqueRounds.push({ findings, dispositions: [] });
        continue;
      }

      const { plan: correctedPlan, dispositions } = await runCorrector(plan, findings, undefined, ctx);
      plan = correctedPlan;
      critiqueRounds.push({ findings, dispositions });
    }
  }

  // Implementation coupling check
  const coupledACs = detectCoupledACs(plan);
  if (coupledACs.length > 0) {
    console.error(
      `forge_plan: ${coupledACs.length} AC(s) inspect source code instead of verifying behavior:`,
      coupledACs.map((v) => `${v.storyId}/${v.acId}`).join(", "),
    );
  }

  // Build output
  const sections: string[] = [
    `=== PHASE PLAN (${phaseId}) ===`,
    JSON.stringify(plan, null, 2),
  ];

  if (coupledACs.length > 0) {
    sections.push([
      `=== IMPLEMENTATION COUPLING WARNINGS (${coupledACs.length}) ===`,
      ...coupledACs.map(
        (v) => `${v.storyId}/${v.acId}: AC inspects source code — should verify observable behavior instead.\n  command: ${v.command}`,
      ),
    ].join("\n"));
  }

  const critiqueSummary = formatCritiqueSummary(critiqueRounds);
  if (critiqueSummary) sections.push(critiqueSummary);
  sections.push(buildUsageSection(ctx));

  await writeRunRecordIfNeeded(
    projectPath, startTime, "phase", effectiveMode, effectiveTier, critiqueRounds, validationRetries, ctx,
  );

  return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
}

/**
 * Handle update mode: revise an existing plan based on implementation notes.
 */
async function handleUpdatePlan(options: HandlePlanOptions) {
  const { currentPlan, implementationNotes, projectPath, tier, context, maxContextChars } = options;
  if (!currentPlan || !implementationNotes) {
    return {
      content: [{ type: "text" as const, text: "Error: currentPlan and implementationNotes are required for documentTier 'update'." }],
      isError: true,
    };
  }

  const startTime = Date.now();
  const effectiveTier = tier ?? "standard"; // updates default to standard (1 critique round)

  const ctx = new RunContext({
    toolName: "forge_plan",
    projectPath,
    stages: buildStageList("update", effectiveTier),
  });

  // No codebase scan for updates — the implementation notes contain the relevant context
  ctx.progress.skip("Scanning codebase");

  // Run update planner
  const plannerResult = await runUpdatePlanner(
    currentPlan, implementationNotes, undefined, ctx, context, maxContextChars,
  );
  let plan = plannerResult.plan;
  const validationRetries = plannerResult.validationRetries;

  // Critique loop
  const critiqueRounds: Array<{
    findings: CritiqueFindings;
    dispositions: CorrectorOutput["dispositions"];
  }> = [];

  if (effectiveTier !== "quick") {
    const maxRounds = effectiveTier === "thorough" ? 2 : 1;
    for (let round = 1; round <= maxRounds; round++) {
      const findings = await runCritic(plan, round as 1 | 2, undefined, ctx);

      if (findings.findings.length === 0) {
        critiqueRounds.push({ findings, dispositions: [] });
        continue;
      }

      const { plan: correctedPlan, dispositions } = await runCorrector(plan, findings, undefined, ctx);
      plan = correctedPlan;
      critiqueRounds.push({ findings, dispositions });
    }
  }

  // Build output
  const sections: string[] = [
    "=== UPDATED PLAN ===",
    JSON.stringify(plan, null, 2),
  ];

  const critiqueSummary = formatCritiqueSummary(critiqueRounds);
  if (critiqueSummary) sections.push(critiqueSummary);
  sections.push(buildUsageSection(ctx));

  await writeRunRecordIfNeeded(
    projectPath, startTime, "update", null, effectiveTier, critiqueRounds, validationRetries, ctx,
  );

  return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
}

/**
 * Handle default (no documentTier) — original execution plan pipeline, fully backward compatible.
 */
async function handleDefaultPlan(options: HandlePlanOptions) {
  const { intent, projectPath, mode, tier, context, maxContextChars } = options;
  const startTime = Date.now();
  const effectiveMode = mode ?? detectMode(intent);
  const effectiveTier = tier ?? "thorough";

  const ctx = new RunContext({
    toolName: "forge_plan",
    projectPath,
    stages: buildStageList(undefined, effectiveTier),
  });

  const codebaseSummary = await scanCodebaseIfNeeded(projectPath, ctx);

  const plannerResult = await runPlanner(
    intent, effectiveMode, codebaseSummary, undefined, ctx, context, maxContextChars,
  );
  let plan = plannerResult.plan;
  const validationRetries = plannerResult.validationRetries;

  // Critique loop
  const critiqueRounds: Array<{
    findings: CritiqueFindings;
    dispositions: CorrectorOutput["dispositions"];
  }> = [];

  if (effectiveTier !== "quick") {
    const maxRounds = effectiveTier === "thorough" ? 2 : 1;
    for (let round = 1; round <= maxRounds; round++) {
      const findings = await runCritic(plan, round as 1 | 2, undefined, ctx);

      if (findings.findings.length === 0) {
        critiqueRounds.push({ findings, dispositions: [] });
        continue;
      }

      const { plan: correctedPlan, dispositions } = await runCorrector(plan, findings, undefined, ctx);
      plan = correctedPlan;
      critiqueRounds.push({ findings, dispositions });
    }
  }

  // Implementation coupling check
  const coupledACs = detectCoupledACs(plan);
  if (coupledACs.length > 0) {
    console.error(
      `forge_plan: ${coupledACs.length} AC(s) inspect source code instead of verifying behavior:`,
      coupledACs.map((v) => `${v.storyId}/${v.acId}`).join(", "),
    );
  }

  // Build output
  const sections: string[] = [
    "=== EXECUTION PLAN ===",
    JSON.stringify(plan, null, 2),
  ];

  if (coupledACs.length > 0) {
    sections.push([
      `=== IMPLEMENTATION COUPLING WARNINGS (${coupledACs.length}) ===`,
      ...coupledACs.map(
        (v) => `${v.storyId}/${v.acId}: AC inspects source code — should verify observable behavior instead.\n  command: ${v.command}`,
      ),
    ].join("\n"));
  }

  const critiqueSummary = formatCritiqueSummary(critiqueRounds);
  if (critiqueSummary) sections.push(critiqueSummary);
  sections.push(buildUsageSection(ctx));

  await writeRunRecordIfNeeded(
    projectPath, startTime, null, effectiveMode, effectiveTier, critiqueRounds, validationRetries, ctx,
  );

  return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
}

// ── Main handler ──

interface HandlePlanOptions {
  intent: string;
  projectPath?: string;
  mode?: "feature" | "full-project" | "bugfix";
  tier?: "quick" | "standard" | "thorough";
  documentTier?: "master" | "phase" | "update";
  visionDoc?: string;
  masterPlan?: string;
  phaseId?: string;
  implementationNotes?: string;
  currentPlan?: string;
  context?: Array<{ label: string; content: string }>;
  maxContextChars?: number;
}

/**
 * Main handler for forge_plan.
 * Routes to tier-specific handlers based on documentTier, or falls through to default.
 */
export async function handlePlan(options: HandlePlanOptions) {
  switch (options.documentTier) {
    case "master":
      return handleMasterPlan(options);
    case "phase":
      return handlePhasePlan(options);
    case "update":
      return handleUpdatePlan(options);
    default:
      return handleDefaultPlan(options);
  }
}
