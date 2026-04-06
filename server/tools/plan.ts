import { z } from "zod";
import { extractJson } from "../lib/anthropic.js";
import { scanCodebase } from "../lib/codebase-scan.js";
import {
  buildPlannerPrompt,
  buildPlannerUserMessage,
  type ContextEntry,
} from "../lib/prompts/planner.js";
import { buildCriticPrompt, buildCriticUserMessage } from "../lib/prompts/critic.js";
import { buildCorrectorPrompt, buildCorrectorUserMessage } from "../lib/prompts/corrector.js";
import { validateExecutionPlan } from "../validation/execution-plan.js";
import { writeRunRecord, type RunRecord } from "../lib/run-record.js";
import { RunContext, trackedCallClaude } from "../lib/run-context.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

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

/**
 * Format critique summary for output.
 */
function formatCritiqueSummary(
  rounds: Array<{ findings: CritiqueFindings; dispositions: CorrectorOutput["dispositions"] }>,
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
 * Main handler for forge_plan.
 */
export async function handlePlan({
  intent,
  projectPath,
  mode,
  tier,
  context,
  maxContextChars,
}: {
  intent: string;
  projectPath?: string;
  mode?: "feature" | "full-project" | "bugfix";
  tier?: "quick" | "standard" | "thorough";
  context?: Array<{ label: string; content: string }>;
  maxContextChars?: number;
}) {
  const startTime = Date.now();
  const effectiveMode = mode ?? detectMode(intent);
  const effectiveTier = tier ?? "thorough";

  // Build dynamic stage list based on tier
  const stages = ["Scanning codebase", "Running planner"];
  if (effectiveTier !== "quick") {
    const maxRounds = effectiveTier === "thorough" ? 2 : 1;
    for (let r = 1; r <= maxRounds; r++) {
      stages.push(`Running critic round ${r}`);
      stages.push("Running corrector");
    }
  }

  const ctx = new RunContext({
    toolName: "forge_plan",
    projectPath,
    stages,
  });

  // Step 1: Optional codebase scan
  let codebaseSummary: string | undefined;
  if (projectPath) {
    ctx.progress.begin("Scanning codebase");
    codebaseSummary = await scanCodebase(projectPath);
    ctx.progress.complete("Scanning codebase");
  } else {
    ctx.progress.skip("Scanning codebase");
  }

  // Step 2: Run planner (with context injection)
  const plannerResult = await runPlanner(
    intent, effectiveMode, codebaseSummary, undefined, ctx, context, maxContextChars,
  );
  let plan = plannerResult.plan;
  const validationRetries = plannerResult.validationRetries;

  // Step 3: Critique loop
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

      const { plan: correctedPlan, dispositions } = await runCorrector(
        plan,
        findings,
        undefined,
        ctx,
      );
      plan = correctedPlan;
      critiqueRounds.push({ findings, dispositions });
    }
  }

  // Step 4: Tier 1 — scan final plan for implementation coupling
  const coupledACs = detectCoupledACs(plan);
  if (coupledACs.length > 0) {
    console.error(
      `forge_plan: ${coupledACs.length} AC(s) inspect source code instead of verifying behavior:`,
      coupledACs.map((v) => `${v.storyId}/${v.acId}`).join(", "),
    );
  }

  // Step 5: Build output
  const sections: string[] = [
    "=== EXECUTION PLAN ===",
    JSON.stringify(plan, null, 2),
  ];

  if (coupledACs.length > 0) {
    const lines = [
      `=== IMPLEMENTATION COUPLING WARNINGS (${coupledACs.length}) ===`,
      ...coupledACs.map(
        (v) =>
          `${v.storyId}/${v.acId}: AC inspects source code — should verify observable behavior instead.\n  command: ${v.command}`,
      ),
    ];
    sections.push(lines.join("\n"));
  }

  const critiqueSummary = formatCritiqueSummary(critiqueRounds);
  if (critiqueSummary) {
    sections.push(critiqueSummary);
  }

  const costSummary = ctx.cost.summarize();
  const costLabel = costSummary.isOAuthAuth ? "equivalent API cost" : "estimated cost";
  const costStr = costSummary.estimatedCostUsd !== null
    ? `$${costSummary.estimatedCostUsd.toFixed(4)} ${costLabel}`
    : "cost unknown (missing token data)";

  sections.push(
    `=== USAGE ===\nTotal tokens: ${costSummary.inputTokens} input / ${costSummary.outputTokens} output\n${costStr}`,
  );

  // Step 6: Write run record
  const findingsTotal = critiqueRounds.reduce((sum, r) => sum + r.findings.findings.length, 0);
  const findingsApplied = critiqueRounds.reduce(
    (sum, r) => sum + r.dispositions.filter((d) => d.applied).length, 0,
  );

  if (projectPath) {
    const runRecord: RunRecord = {
      timestamp: new Date(startTime).toISOString(),
      tool: "forge_plan",
      documentTier: null,
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

  return {
    content: [
      {
        type: "text" as const,
        text: sections.join("\n\n"),
      },
    ],
  };
}
