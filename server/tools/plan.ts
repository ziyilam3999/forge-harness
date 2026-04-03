import { z } from "zod";
import { callClaude, extractJson } from "../lib/anthropic.js";
import { scanCodebase } from "../lib/codebase-scan.js";
import { buildPlannerPrompt, buildPlannerUserMessage } from "../lib/prompts/planner.js";
import { buildCriticPrompt, buildCriticUserMessage } from "../lib/prompts/critic.js";
import { buildCorrectorPrompt, buildCorrectorUserMessage } from "../lib/prompts/corrector.js";
import { validateExecutionPlan } from "../validation/execution-plan.js";
import type { ExecutionPlan } from "../types/execution-plan.js";

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

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Run the planner agent to produce a draft execution plan.
 */
async function runPlanner(
  intent: string,
  mode: "feature" | "full-project" | "bugfix",
  codebaseSummary: string | undefined,
  model: string | undefined,
  usage: UsageAccumulator,
): Promise<ExecutionPlan> {
  const system = buildPlannerPrompt(mode);
  const userMessage = buildPlannerUserMessage(intent, codebaseSummary);

  const result = await callClaude({
    system,
    messages: [{ role: "user", content: userMessage }],
    model,
    jsonMode: true,
  });
  usage.inputTokens += result.usage.inputTokens;
  usage.outputTokens += result.usage.outputTokens;

  const parsed = extractJson(result.text);
  const validation = validateExecutionPlan(parsed);

  if (!validation.valid) {
    // Retry once with error feedback
    console.error(
      "forge_plan: planner output failed validation, retrying with feedback:",
      validation.errors,
    );
    const retryResult = await callClaude({
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
    usage.inputTokens += retryResult.usage.inputTokens;
    usage.outputTokens += retryResult.usage.outputTokens;

    const retryParsed = extractJson(retryResult.text);
    const retryValidation = validateExecutionPlan(retryParsed);
    if (!retryValidation.valid) {
      throw new Error(
        `Planner output failed validation after retry: ${retryValidation.errors?.join("; ")}`,
      );
    }
    return retryParsed as ExecutionPlan;
  }

  return parsed as ExecutionPlan;
}

/**
 * Run a critic agent on the plan. Returns findings or empty array on failure.
 */
async function runCritic(
  plan: ExecutionPlan,
  round: 1 | 2,
  model: string | undefined,
  usage: UsageAccumulator,
): Promise<CritiqueFindings> {
  const system = buildCriticPrompt(round);
  const planJson = JSON.stringify(plan, null, 2);

  try {
    const result = await callClaude({
      system,
      messages: [{ role: "user", content: buildCriticUserMessage(planJson) }],
      model,
      jsonMode: true,
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

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
  usage: UsageAccumulator,
): Promise<{ plan: ExecutionPlan; dispositions: CorrectorOutput["dispositions"] }> {
  const system = buildCorrectorPrompt();
  const planJson = JSON.stringify(plan, null, 2);
  const findingsJson = JSON.stringify(findings, null, 2);

  try {
    const result = await callClaude({
      system,
      messages: [
        { role: "user", content: buildCorrectorUserMessage(planJson, findingsJson) },
      ],
      model,
      jsonMode: true,
    });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

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
}: {
  intent: string;
  projectPath?: string;
  mode?: "feature" | "full-project" | "bugfix";
  tier?: "quick" | "standard" | "thorough";
}) {
  const effectiveMode = mode ?? detectMode(intent);
  const effectiveTier = tier ?? "thorough";

  const usage: UsageAccumulator = { inputTokens: 0, outputTokens: 0 };

  // Step 1: Optional codebase scan
  let codebaseSummary: string | undefined;
  if (projectPath) {
    codebaseSummary = await scanCodebase(projectPath);
  }

  // Step 2: Run planner
  let plan = await runPlanner(intent, effectiveMode, codebaseSummary, undefined, usage);

  // Step 3: Critique loop
  const critiqueRounds: Array<{
    findings: CritiqueFindings;
    dispositions: CorrectorOutput["dispositions"];
  }> = [];

  if (effectiveTier !== "quick") {
    const maxRounds = effectiveTier === "thorough" ? 2 : 1;

    for (let round = 1; round <= maxRounds; round++) {
      const findings = await runCritic(plan, round as 1 | 2, undefined, usage);

      if (findings.findings.length === 0) {
        critiqueRounds.push({ findings, dispositions: [] });
        continue;
      }

      const { plan: correctedPlan, dispositions } = await runCorrector(
        plan,
        findings,
        undefined,
        usage,
      );
      plan = correctedPlan;
      critiqueRounds.push({ findings, dispositions });
    }
  }

  // Step 4: Build output
  const sections: string[] = [
    "=== EXECUTION PLAN ===",
    JSON.stringify(plan, null, 2),
  ];

  const critiqueSummary = formatCritiqueSummary(critiqueRounds);
  if (critiqueSummary) {
    sections.push(critiqueSummary);
  }

  sections.push(
    `=== USAGE ===\nTotal tokens: ${usage.inputTokens} input / ${usage.outputTokens} output`,
  );

  return {
    content: [
      {
        type: "text" as const,
        text: sections.join("\n\n"),
      },
    ],
  };
}
