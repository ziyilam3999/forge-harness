import type { ExecutionPlan, Story } from "../types/execution-plan.js";
import type { RunRecord } from "./run-record.js";
import type { EvalReport } from "../types/eval-report.js";
import type {
  CoordinateResult,
  StoryStatusEntry,
  StoryStatus,
  PhaseTransitionBrief,
  BudgetInfo,
  TimeBudgetInfo,
  ReplanningNote,
} from "../types/coordinate-result.js";
import { topoSort } from "./topo-sort.js";
import { readRunRecords, type PrimaryRecord } from "./run-reader.js";

const MAX_RETRIES = 3;

export interface AssessPhaseOptions {
  phaseId?: string;
  budgetUsd?: number | null;
  maxTimeMs?: number | null;
  currentPlanStartTimeMs?: number | null;
}

/**
 * Classify every story in the target phase using the 6-state precedence chain
 * (REQ-04). State is re-derived from `.forge/runs/` on every call — no
 * coordinator-local state file to corrupt (REQ-09).
 */
export async function assessPhase(
  plan: ExecutionPlan,
  projectPath: string,
  options: AssessPhaseOptions = {},
): Promise<CoordinateResult> {
  const stories = plan.stories;
  const sorted = stories.length > 0 ? topoSort(stories) : [];

  // Read all run records and filter to primary records only
  const allRecords = await readRunRecords(projectPath);
  const primaryRecords = allRecords
    .filter((r): r is PrimaryRecord => r.source === "primary")
    .map((r) => r.record);

  // Optional: filter by currentPlanStartTimeMs
  const startFilter = options.currentPlanStartTimeMs ?? null;
  const filteredRecords = startFilter !== null
    ? primaryRecords.filter((r) => new Date(r.timestamp).getTime() >= startFilter)
    : primaryRecords;

  // Group primary records by storyId
  const recordsByStory = new Map<string, RunRecord[]>();
  for (const record of filteredRecords) {
    if (!record.storyId) continue;
    const list = recordsByStory.get(record.storyId) ?? [];
    list.push(record);
    recordsByStory.set(record.storyId, list);
  }

  // Sort each story's records by timestamp ascending
  for (const records of recordsByStory.values()) {
    records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // Build story ID set for dependency lookup
  const storyIds = new Set(stories.map((s) => s.id));

  // Phase 1: classify each story using the 6-state precedence chain
  const statusMap = new Map<string, StoryStatusEntry>();

  // We need to process in topo order so we can check dependency statuses
  for (const story of sorted) {
    const records = recordsByStory.get(story.id) ?? [];
    const mostRecent = records.length > 0 ? records[records.length - 1] : null;
    const retryCount = records.filter(
      (r) => r.evalVerdict !== "PASS",
    ).length;
    const retriesRemaining = Math.max(0, MAX_RETRIES - retryCount);

    const status = classifyStory(
      story,
      mostRecent,
      retryCount,
      records.length,
      statusMap,
      storyIds,
    );

    const priorEvalReport = getPriorEvalReport(status, mostRecent);
    const evidence = getEvidence(status, story, retryCount, statusMap);

    statusMap.set(story.id, {
      storyId: story.id,
      status,
      retryCount,
      retriesRemaining,
      priorEvalReport,
      evidence,
    });
  }

  const entries = sorted.map((s) => statusMap.get(s.id)!);
  const brief = buildBrief(entries, options);

  return {
    mode: "advisory",
    phaseId: options.phaseId ?? "default",
    brief,
  };
}

function classifyStory(
  story: Story,
  mostRecent: RunRecord | null,
  retryCount: number,
  totalRecords: number,
  statusMap: Map<string, StoryStatusEntry>,
  storyIds: Set<string>,
): StoryStatus {
  const deps = (story.dependencies ?? []).filter((d) => storyIds.has(d));

  // Rule 1: done — most recent primary record is PASS
  if (mostRecent?.evalVerdict === "PASS") {
    return "done";
  }

  // Rule 2: dep-failed — any transitive dependency is failed
  if (hasFailedTransitiveDep(story, statusMap, storyIds)) {
    return "dep-failed";
  }

  // Rule 3: failed — retry budget exhausted (most recent is guaranteed non-PASS since rule 1 returned early)
  if (retryCount >= MAX_RETRIES) {
    return "failed";
  }

  // Rule 4: ready-for-retry — most recent is FAIL/INCONCLUSIVE, retryCount < 3, all deps done
  if (
    totalRecords > 0 &&
    mostRecent &&
    (mostRecent.evalVerdict === "FAIL" || mostRecent.evalVerdict === "INCONCLUSIVE") &&
    retryCount < MAX_RETRIES &&
    allDepsDone(deps, statusMap)
  ) {
    return "ready-for-retry";
  }

  // Rule 5: ready — zero prior records AND all deps done
  if (totalRecords === 0 && allDepsDone(deps, statusMap)) {
    return "ready";
  }

  // Rule 6: pending — catch-all
  return "pending";
}

function allDepsDone(deps: string[], statusMap: Map<string, StoryStatusEntry>): boolean {
  return deps.every((depId) => {
    const entry = statusMap.get(depId);
    return entry?.status === "done";
  });
}

function hasFailedTransitiveDep(
  story: Story,
  statusMap: Map<string, StoryStatusEntry>,
  storyIds: Set<string>,
): boolean {
  const deps = (story.dependencies ?? []).filter((d) => storyIds.has(d));
  for (const depId of deps) {
    const entry = statusMap.get(depId);
    if (!entry) continue;
    if (entry.status === "failed" || entry.status === "dep-failed") {
      return true;
    }
  }
  return false;
}

function getPriorEvalReport(status: StoryStatus, mostRecent: RunRecord | null): EvalReport | null {
  if ((status === "ready-for-retry" || status === "failed") && mostRecent?.evalReport) {
    return mostRecent.evalReport;
  }
  return null;
}

function getEvidence(
  status: StoryStatus,
  story: Story,
  retryCount: number,
  statusMap: Map<string, StoryStatusEntry>,
): string | null {
  switch (status) {
    case "done":
      return retryCount > 0 ? `passed after ${retryCount} retry(ies)` : "passed on first attempt";
    case "failed":
      return `retry budget exhausted (${retryCount}/${MAX_RETRIES})`;
    case "dep-failed": {
      const failedDeps = (story.dependencies ?? []).filter((d) => {
        const e = statusMap.get(d);
        return e?.status === "failed" || e?.status === "dep-failed";
      });
      return `dep ${failedDeps.join(", ")} failed`;
    }
    case "ready-for-retry":
      return `${retryCount} prior attempt(s), retrying`;
    case "ready":
      return null;
    case "pending":
      return null;
  }
}

function buildBrief(entries: StoryStatusEntry[], options: AssessPhaseOptions): PhaseTransitionBrief {
  const readyStories = entries
    .filter((e) => e.status === "ready" || e.status === "ready-for-retry")
    .map((e) => e.storyId);
  const failedStories = entries
    .filter((e) => e.status === "failed")
    .map((e) => e.storyId);
  const depFailedStories = entries
    .filter((e) => e.status === "dep-failed")
    .map((e) => e.storyId);
  const completedCount = entries.filter((e) => e.status === "done").length;
  const totalCount = entries.length;

  const status = resolvePhaseStatus(entries, completedCount, totalCount);
  const replanningNotes = buildReplanningNotes(failedStories, depFailedStories);
  const recommendation = buildRecommendation(status, readyStories, failedStories);

  return {
    status,
    stories: entries,
    readyStories,
    depFailedStories,
    failedStories,
    completedCount,
    totalCount,
    budget: buildBudget(options),
    timeBudget: buildTimeBudget(options),
    replanningNotes,
    recommendation,
    configSource: {},
  };
}

function resolvePhaseStatus(
  entries: StoryStatusEntry[],
  completedCount: number,
  totalCount: number,
): "in-progress" | "complete" | "needs-replan" | "halted" {
  // Rule 2: complete — all done, no failed/dep-failed
  const hasFailed = entries.some((e) => e.status === "failed");
  const hasDepFailed = entries.some((e) => e.status === "dep-failed");

  if (completedCount === totalCount && !hasFailed && !hasDepFailed) {
    return "complete";
  }

  // Rule 3: needs-replan — any failed or dep-failed
  if (hasFailed || hasDepFailed) {
    return "needs-replan";
  }

  // Rule 4: in-progress
  return "in-progress";
}

function buildReplanningNotes(failedStories: string[], depFailedStories: string[]): ReplanningNote[] {
  const notes: ReplanningNote[] = [];
  for (const id of failedStories) {
    notes.push({
      category: "ac-drift",
      severity: "blocking",
      storyId: id,
      message: `Story ${id} exhausted retry budget (3/3) — requires replan`,
    });
  }
  if (depFailedStories.length > 0) {
    notes.push({
      category: "dep-failed-chain",
      severity: "blocking",
      storyId: null,
      message: `${depFailedStories.length} stories dep-failed: ${depFailedStories.join(", ")}`,
    });
  }
  return notes;
}

function buildRecommendation(
  status: string,
  readyStories: string[],
  failedStories: string[],
): string {
  switch (status) {
    case "complete":
      return "All stories complete. Phase is ready for transition.";
    case "needs-replan":
      return `Replan needed. Failed stories: ${failedStories.join(", ")}. Run forge_plan(update) to address.`;
    case "in-progress":
      return readyStories.length > 0
        ? `Continue execution. Ready stories: ${readyStories.join(", ")}.`
        : "Waiting on in-progress dependencies.";
    default:
      return "";
  }
}

function buildBudget(options: AssessPhaseOptions): BudgetInfo {
  return {
    usedUsd: 0,
    budgetUsd: options.budgetUsd ?? null,
    remainingUsd: options.budgetUsd != null ? options.budgetUsd : null,
    incompleteData: true,
    warningLevel: "none",
  };
}

function buildTimeBudget(options: AssessPhaseOptions): TimeBudgetInfo {
  return {
    elapsedMs: 0,
    maxTimeMs: options.maxTimeMs ?? null,
    warningLevel: options.maxTimeMs != null ? "none" : "unknown",
  };
}
