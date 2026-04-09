import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanCodebase } from "./codebase-scan.js";
import { loadPlan } from "./plan-loader.js";
import { RunContext } from "./run-context.js";
import type { ExecutionPlan, Story } from "../types/execution-plan.js";
import type { EvalReport, CriterionResult } from "../types/eval-report.js";
import type {
  GenerateResult,
  GenerationBrief,
  FixBrief,
  FailedCriterion,
  EvalHint,
  Escalation,
  EscalationReason,
  EscalationDiagnostics,
  DiffManifest,
  DocumentContext,
  CostEstimate,
} from "../types/generate-result.js";

// ── Constants ────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_BASELINE_CHECK = "npm run build && npm test";
const STDERR_TRUNCATION_LIMIT = 2000;

/** Opus pricing per million tokens (USD). */
const OPUS_INPUT_PER_MILLION = 15.0;
const OPUS_OUTPUT_PER_MILLION = 75.0;

// ── Input types ──────────────────────────────

export interface AssembleInput {
  storyId: string;
  planJson?: string;
  planPath?: string;
  evalReport?: EvalReport;
  iteration?: number;
  maxIterations?: number;
  previousScores?: number[];
  fileHashes?: Record<string, string>;
  previousFileHashes?: Record<string, string>;
  projectPath?: string;
  baselineDiagnostics?: {
    exitCode: number;
    stderr: string;
    failingTests: string[];
  };
  /** When true (default), projected costs are $0 (no API calls from Max). */
  isMaxUser?: boolean;
  // ── PH-03: Three-tier document inputs (REQ-09) ──
  prdContent?: string;
  masterPlanContent?: string;
  phasePlanContent?: string;
  // ── PH-03: Context injection (REQ-10) ──
  contextFiles?: string[];
}

/** Options for buildBrief that carry PH-03 document/context fields. */
export interface BuildBriefOptions {
  prdContent?: string;
  masterPlanContent?: string;
  phasePlanContent?: string;
  contextFiles?: string[];
}

// ── US04: Init brief assembly (REQ-01) ──────

export async function buildBrief(
  plan: ExecutionPlan,
  storyId: string,
  projectPath?: string,
  options?: BuildBriefOptions,
): Promise<GenerationBrief> {
  const story = findStory(plan, storyId);

  let codebaseContext = "";
  if (projectPath) {
    codebaseContext = await scanCodebase(projectPath);
  }

  const brief: GenerationBrief = {
    story,
    codebaseContext,
    gitBranch: `feat/${storyId}`,
    baselineCheck: plan.baselineCheck ?? DEFAULT_BASELINE_CHECK,
    lineage: story.lineage,
  };

  // PH-03 US01: Three-tier document context (REQ-09)
  const documentContext = buildDocumentContext(options);
  if (documentContext) {
    brief.documentContext = documentContext;
  }

  // PH-03 US02: Context injection (REQ-10)
  const injectedContext = await readContextFiles(options?.contextFiles);
  if (injectedContext) {
    brief.injectedContext = injectedContext;
  }

  return brief;
}

// ── US05: Fix brief assembly (REQ-02, REQ-13) ──

export function buildFixBrief(
  evalReport: EvalReport,
  plan: ExecutionPlan,
  storyId: string,
): FixBrief {
  const story = findStory(plan, storyId);
  const acMap = new Map(
    story.acceptanceCriteria.map((ac) => [ac.id, ac]),
  );

  const failedCriteria: FailedCriterion[] = evalReport.criteria
    .filter((c) => c.status === "FAIL")
    .map((c) => ({
      id: c.id,
      description: acMap.get(c.id)?.description ?? c.id,
      evidence: c.evidence,
    }));

  const score = computeScore(evalReport.criteria);

  // failFastIds: failed criteria in plan order (functionality first by default)
  const planOrder = story.acceptanceCriteria.map((ac) => ac.id);
  const failedIds = new Set(failedCriteria.map((c) => c.id));
  const failFastIds = planOrder.filter((id) => failedIds.has(id));

  const evalHint: EvalHint = { failFastIds };

  const guidance =
    failedCriteria.length === 1
      ? `Fix the failing criterion: ${failedCriteria[0].id}`
      : `Fix ${failedCriteria.length} failing criteria. Start with ${failFastIds[0]}.`;

  return { failedCriteria, score, evalHint, guidance };
}

export function computeScore(criteria: CriterionResult[]): number {
  const nonSkipped = criteria.filter((c) => c.status !== "SKIPPED");
  if (nonSkipped.length === 0) return 0;
  const passed = nonSkipped.filter((c) => c.status === "PASS").length;
  return Math.round((passed / nonSkipped.length) * 1000) / 1000;
}

// ── US05: Diff manifest (REQ-14) ────────────

export function buildDiffManifest(
  currentHashes: Record<string, string>,
  previousHashes: Record<string, string>,
): DiffManifest {
  const changed: string[] = [];
  const unchanged: string[] = [];
  const newFiles: string[] = [];

  const prevKeys = new Set(Object.keys(previousHashes));

  for (const [file, hash] of Object.entries(currentHashes)) {
    if (!prevKeys.has(file)) {
      newFiles.push(file);
    } else if (previousHashes[file] !== hash) {
      changed.push(file);
    } else {
      unchanged.push(file);
    }
  }

  return { changed, unchanged, new: newFiles };
}

// ── US06: Stopping conditions (REQ-03/04/05/07/15) ──

export type StoppingResult = {
  reason: EscalationReason;
  diagnostics?: EscalationDiagnostics;
} | null;

export function checkStoppingConditions(input: {
  evalReport?: EvalReport;
  iteration: number;
  maxIterations: number;
  previousScores?: number[];
  fileHashes?: Record<string, string>;
  previousFileHashes?: Record<string, string>;
  baselineDiagnostics?: {
    exitCode: number;
    stderr: string;
    failingTests: string[];
  };
}): StoppingResult {
  // INCONCLUSIVE has highest precedence (REQ-07)
  if (input.evalReport?.verdict === "INCONCLUSIVE") {
    return { reason: "inconclusive" };
  }

  // Baseline-failed (REQ-15) — only on iteration 0 with diagnostics
  if (input.baselineDiagnostics) {
    return {
      reason: "baseline-failed",
      diagnostics: {
        exitCode: input.baselineDiagnostics.exitCode,
        stderr: input.baselineDiagnostics.stderr.slice(0, STDERR_TRUNCATION_LIMIT),
        failingTests: input.baselineDiagnostics.failingTests,
      },
    };
  }

  // Max iterations (REQ-05)
  if (input.iteration >= input.maxIterations) {
    return { reason: "max-iterations" };
  }

  // No-op detection (REQ-04) — hash-based
  if (
    input.fileHashes &&
    input.previousFileHashes &&
    Object.keys(input.fileHashes).length > 0
  ) {
    const currentKeys = Object.keys(input.fileHashes).sort();
    const prevKeys = Object.keys(input.previousFileHashes).sort();
    if (
      currentKeys.length === prevKeys.length &&
      currentKeys.every((k, i) => k === prevKeys[i]) &&
      currentKeys.every((k) => input.fileHashes![k] === input.previousFileHashes![k])
    ) {
      return { reason: "no-op" };
    }
  }

  // Plateau detection (REQ-03): triggers when last 2 scores are identical
  // (meaning score delta = 0 for the most recent iteration)
  // Requires at least 3 scores to confirm the pattern (per PRD: [0.3, 0.5, 0.5] triggers)
  if (input.previousScores && input.previousScores.length >= 3) {
    const scores = input.previousScores;
    const last = scores[scores.length - 1];
    const secondLast = scores[scores.length - 2];
    if (last === secondLast) {
      return { reason: "plateau" };
    }
  }

  return null;
}

// ── US07: Structured escalation reports (REQ-06) ──

export function buildEscalation(
  reason: EscalationReason,
  input: {
    previousScores?: number[];
    evalReport?: EvalReport;
    diagnostics?: EscalationDiagnostics;
  },
): Escalation {
  const scoreHistory = input.previousScores ?? [];
  const lastEvalVerdict: "FAIL" | "INCONCLUSIVE" =
    input.evalReport?.verdict === "INCONCLUSIVE" ? "INCONCLUSIVE" : "FAIL";

  const descriptions: Record<EscalationReason, string> = {
    plateau: `Score has not improved for the last ${Math.min(3, scoreHistory.length)} iterations (stuck at ${scoreHistory[scoreHistory.length - 1] ?? 0}).`,
    "no-op": "The last fix attempt produced no code changes — the generator is looping without effect.",
    "max-iterations": `Reached the maximum iteration limit. Best score achieved: ${Math.max(...(scoreHistory.length > 0 ? scoreHistory : [0]))}.`,
    inconclusive: "Evaluation returned INCONCLUSIVE — evaluation tools may be unavailable or misconfigured.",
    "baseline-failed": "The project baseline check (build + test) failed before the generation loop could start.",
  };

  const hypotheses: Record<EscalationReason, string | null> = {
    plateau: "The failing criteria may require an architectural change rather than incremental fixes.",
    "no-op": "The generator may not understand the failing criteria, or the fix is outside its visible context.",
    "max-iterations": "The remaining failures may be too complex for automated iteration. Manual intervention recommended.",
    inconclusive: null,
    "baseline-failed": null,
  };

  const escalation: Escalation = {
    reason,
    description: descriptions[reason],
    hypothesis: hypotheses[reason],
    lastEvalVerdict,
    scoreHistory,
  };

  if (reason === "baseline-failed" && input.diagnostics) {
    escalation.diagnostics = input.diagnostics;
  }

  return escalation;
}

// ── US08: Core orchestrator ─────────────────

export async function assembleGenerateResult(
  input: AssembleInput,
): Promise<GenerateResult> {
  const plan = loadPlan(input.planPath, input.planJson);
  const iteration = input.iteration ?? 0;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const base: Pick<GenerateResult, "storyId" | "iteration" | "maxIterations"> = {
    storyId: input.storyId,
    iteration,
    maxIterations,
  };

  // Init path: no eval report means first call
  if (!input.evalReport) {
    const brief = await buildBrief(plan, input.storyId, input.projectPath, {
      prdContent: input.prdContent,
      masterPlanContent: input.masterPlanContent,
      phasePlanContent: input.phasePlanContent,
      contextFiles: input.contextFiles,
    });
    return { ...base, action: "implement", brief };
  }

  // PASS path
  if (input.evalReport.verdict === "PASS") {
    return { ...base, action: "pass" };
  }

  // Check stopping conditions
  const stop = checkStoppingConditions({
    evalReport: input.evalReport,
    iteration,
    maxIterations,
    previousScores: input.previousScores,
    fileHashes: input.fileHashes,
    previousFileHashes: input.previousFileHashes,
    baselineDiagnostics: input.baselineDiagnostics,
  });

  if (stop) {
    const escalation = buildEscalation(stop.reason, {
      previousScores: input.previousScores,
      evalReport: input.evalReport,
      diagnostics: stop.diagnostics,
    });
    return { ...base, action: "escalate", escalation };
  }

  // Fix path
  const fixBrief = buildFixBrief(input.evalReport, plan, input.storyId);

  const result: GenerateResult = { ...base, action: "fix", fixBrief };

  // Attach diff manifest on fix iterations (REQ-14)
  if (iteration > 0 && input.fileHashes && input.previousFileHashes) {
    result.diffManifest = buildDiffManifest(
      input.fileHashes,
      input.previousFileHashes,
    );
  }

  return result;
}

// ── PH-02: Infrastructure wrapper ───────────

/** JSONL run record written to .forge/runs/data.jsonl */
export interface RunRecord {
  timestamp: string;
  storyId: string;
  iteration: number;
  action: string;
  score: number | null;
  durationMs: number;
}

/**
 * Infrastructure-wrapped version of assembleGenerateResult.
 * Adds RunContext (progress, audit, cost tracking), JSONL self-tracking,
 * and cost estimation. All infrastructure failures degrade gracefully (NFR-05).
 */
export async function assembleGenerateResultWithContext(
  input: AssembleInput,
): Promise<GenerateResult> {
  const startTime = Date.now();
  const iteration = input.iteration ?? 0;
  const stageName = iteration === 0 ? "init" : "iterate";

  // Create RunContext (NFR-05: failure here is non-fatal)
  let ctx: RunContext | null = null;
  try {
    ctx = new RunContext({
      toolName: "forge_generate",
      projectPath: input.projectPath,
      stages: [stageName],
    });
    ctx.progress.begin(stageName);
  } catch (err) {
    console.error(
      "forge_generate: failed to create RunContext (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Run core logic (this must always succeed or throw)
  const result = await assembleGenerateResult(input);

  // Attach cost estimate (NFR-05: graceful)
  try {
    result.costEstimate = computeCostEstimate(result, input);
  } catch (err) {
    console.error(
      "forge_generate: cost estimation failed (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }

  const durationMs = Date.now() - startTime;

  // Complete progress (NFR-05: graceful)
  try {
    ctx?.progress.complete(stageName);
  } catch {
    // swallow
  }

  // Write audit entry (NFR-05: graceful)
  try {
    if (ctx) {
      await ctx.audit.log({
        stage: stageName,
        agentRole: "generator",
        decision: result.action,
        reasoning: `iteration ${iteration}, action=${result.action}, durationMs=${durationMs}`,
      });
    }
  } catch (err) {
    console.error(
      "forge_generate: audit log failed (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Write JSONL run record (NFR-05: graceful)
  try {
    await writeRunRecord(input.projectPath, {
      timestamp: new Date(startTime).toISOString(),
      storyId: input.storyId,
      iteration,
      action: result.action,
      score: extractScore(result),
      durationMs,
    });
  } catch (err) {
    console.error(
      "forge_generate: JSONL write failed (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }

  return result;
}

// ── PH-02 US02: JSONL self-tracking ─────────

/**
 * Append a run record to .forge/runs/data.jsonl.
 * No-op when projectPath is undefined. Failures are swallowed (NFR-05).
 */
export async function writeRunRecord(
  projectPath: string | undefined,
  record: RunRecord,
): Promise<void> {
  if (!projectPath) return;

  const runsDir = join(projectPath, ".forge", "runs");
  await mkdir(runsDir, { recursive: true });
  const filePath = join(runsDir, "data.jsonl");
  await appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
}

// ── PH-02 US03: Cost estimation ─────────────

/**
 * Compute a cost estimate for the generate result.
 * briefTokens = character count of serialized payload / 4.
 * projectedIterationCostUsd uses Opus pricing (input + output).
 * For Max users (default), projected costs are $0.
 */
export function computeCostEstimate(
  result: GenerateResult,
  input: AssembleInput,
): CostEstimate {
  const payload = result.brief ?? result.fixBrief ?? result.escalation;
  const serialized = payload ? JSON.stringify(payload) : "";
  const briefTokens = Math.ceil(serialized.length / 4);

  const isMaxUser = input.isMaxUser !== false; // default true
  const iteration = input.iteration ?? 0;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  let projectedIterationCostUsd = 0;
  if (!isMaxUser) {
    // Assume output tokens ≈ input tokens for a rough iteration estimate
    projectedIterationCostUsd =
      (briefTokens / 1_000_000) * OPUS_INPUT_PER_MILLION +
      (briefTokens / 1_000_000) * OPUS_OUTPUT_PER_MILLION;
  }

  const remaining = Math.max(0, maxIterations - iteration);
  const projectedRemainingCostUsd = projectedIterationCostUsd * remaining;

  return {
    briefTokens,
    projectedIterationCostUsd,
    projectedRemainingCostUsd,
  };
}

// ── PH-03 Helpers ───────────────────────────

/** Build DocumentContext from options. Returns undefined when no docs provided. */
function buildDocumentContext(
  options?: BuildBriefOptions,
): DocumentContext | undefined {
  if (!options) return undefined;
  const { prdContent, masterPlanContent, phasePlanContent } = options;
  if (!prdContent && !masterPlanContent && !phasePlanContent) return undefined;

  const ctx: DocumentContext = {};
  if (prdContent) ctx.prdContent = prdContent;
  if (masterPlanContent) ctx.masterPlanContent = masterPlanContent;
  if (phasePlanContent) ctx.phasePlanContent = phasePlanContent;
  return ctx;
}

/** Read context files, skipping missing ones with a warning. Returns undefined when empty. */
async function readContextFiles(
  contextFiles?: string[],
): Promise<string[] | undefined> {
  if (!contextFiles || contextFiles.length === 0) return undefined;

  const contents: string[] = [];
  for (const filePath of contextFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      contents.push(content);
    } catch {
      console.warn(`forge_generate: context file not found, skipping: ${filePath}`);
    }
  }

  return contents.length > 0 ? contents : undefined;
}

// ── Helpers ──────────────────────────────────

function findStory(plan: ExecutionPlan, storyId: string): Story {
  const story = plan.stories.find((s) => s.id === storyId);
  if (!story) {
    throw new Error(`Story "${storyId}" not found in plan`);
  }
  return story;
}

/** Extract score from result for JSONL tracking. */
function extractScore(result: GenerateResult): number | null {
  if (result.fixBrief) return result.fixBrief.score;
  if (result.action === "pass") return 1;
  if (result.action === "escalate" && result.escalation) {
    const history = result.escalation.scoreHistory;
    if (history && history.length > 0) {
      return history[history.length - 1] ?? null;
    }
  }
  return null;
}
