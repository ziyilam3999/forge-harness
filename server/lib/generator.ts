import { scanCodebase } from "./codebase-scan.js";
import { loadPlan } from "./plan-loader.js";
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
} from "../types/generate-result.js";

// ── Constants ────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_BASELINE_CHECK = "npm run build && npm test";
const STDERR_TRUNCATION_LIMIT = 2000;

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
}

// ── US04: Init brief assembly (REQ-01) ──────

export async function buildBrief(
  plan: ExecutionPlan,
  storyId: string,
  projectPath?: string,
): Promise<GenerationBrief> {
  const story = findStory(plan, storyId);

  let codebaseContext = "";
  if (projectPath) {
    codebaseContext = await scanCodebase(projectPath);
  }

  return {
    story,
    codebaseContext,
    gitBranch: `feat/${storyId}`,
    baselineCheck: plan.baselineCheck ?? DEFAULT_BASELINE_CHECK,
    lineage: story.lineage,
  };
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
    const brief = await buildBrief(plan, input.storyId, input.projectPath);
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

// ── Helpers ──────────────────────────────────

function findStory(plan: ExecutionPlan, storyId: string): Story {
  const story = plan.stories.find((s) => s.id === storyId);
  if (!story) {
    throw new Error(`Story "${storyId}" not found in plan`);
  }
  return story;
}
