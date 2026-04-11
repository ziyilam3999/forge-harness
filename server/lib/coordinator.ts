import type { ExecutionPlan, Story } from "../types/execution-plan.js";
import type { EscalationReason } from "../types/generate-result.js";
import type { RunRecord } from "./run-record.js";
import type { EvalReport } from "../types/eval-report.js";
import type {
  CoordinateResult,
  StoryStatusEntry,
  StoryStatus,
  PhaseTransitionBrief,
  BudgetInfo,
  BudgetWarningLevel,
  TimeBudgetInfo,
  TimeWarningLevel,
  ReplanningNote,
  ReplanningCategory,
  GraduateFindingsResult,
  Finding,
} from "../types/coordinate-result.js";
import { topoSort } from "./topo-sort.js";
import { readRunRecords, readAuditEntries, type PrimaryRecord, type TaggedRunRecord } from "./run-reader.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const MAX_RETRIES = 3;

// ── Config file schema (REQ-15) ─────────────────────────────

const observabilitySchema = z.object({
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  writeAuditLog: z.boolean().optional(),
  writeRunRecord: z.boolean().optional(),
}).optional();

const coordinateConfigSchema = z.object({
  storyOrdering: z.enum(["topological", "depth-first", "small-first"]).optional(),
  phaseBoundaryBehavior: z.enum(["auto-advance", "halt-and-notify", "halt-hard"]).optional(),
  briefVerbosity: z.enum(["concise", "detailed"]).optional(),
  observability: observabilitySchema,
}).strict();

export type CoordinateConfig = z.infer<typeof coordinateConfigSchema>;

export interface ResolvedConfig {
  storyOrdering: "topological" | "depth-first" | "small-first";
  phaseBoundaryBehavior: "auto-advance" | "halt-and-notify" | "halt-hard";
  briefVerbosity: "concise" | "detailed";
  observability: {
    logLevel: "debug" | "info" | "warn" | "error";
    writeAuditLog: boolean;
    writeRunRecord: boolean;
  };
  configSource: Record<string, "file" | "args" | "default">;
}

const CONFIG_DEFAULTS: Omit<ResolvedConfig, "configSource"> = {
  storyOrdering: "topological",
  phaseBoundaryBehavior: "auto-advance",
  briefVerbosity: "concise",
  observability: { logLevel: "info", writeAuditLog: true, writeRunRecord: true },
};

const KNOWN_CONFIG_FIELDS = ["storyOrdering", "phaseBoundaryBehavior", "briefVerbosity", "observability"];
const RESOURCE_CAP_FIELDS = ["budgetUsd", "maxTimeMs", "escalationThresholds"];

/**
 * Load optional `.forge/coordinate.config.json` (REQ-15).
 * Missing file → defaults (not an error). Corrupt/invalid → console.error + defaults.
 * Zod .strict() rejects unknown top-level fields with a named-field warning.
 */
export async function loadCoordinateConfig(projectPath: string, args: Partial<CoordinateConfig> = {}): Promise<ResolvedConfig> {
  const configPath = join(projectPath, ".forge", "coordinate.config.json");
  const configSource: Record<string, "file" | "args" | "default"> = {};

  let fileConfig: CoordinateConfig = {};
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = coordinateConfigSchema.safeParse(parsed);

    if (!result.success) {
      // Identify unknown fields for targeted warnings
      const unknownFields = Object.keys(parsed).filter((k) => !KNOWN_CONFIG_FIELDS.includes(k));
      const resourceCapWarnings = unknownFields.filter((f) => RESOURCE_CAP_FIELDS.includes(f));
      const otherWarnings = unknownFields.filter((f) => !RESOURCE_CAP_FIELDS.includes(f));

      if (resourceCapWarnings.length > 0) {
        console.error(`forge: config rejected: resource-cap fields [${resourceCapWarnings.join(", ")}] are MCP input args only`);
      }
      if (otherWarnings.length > 0) {
        console.error(`forge: config contains unknown fields [${otherWarnings.join(", ")}]; falling back to defaults`);
      }

      // Salvage individually valid fields
      const validFields: Partial<CoordinateConfig> = {};
      const soResult = z.enum(["topological", "depth-first", "small-first"]).safeParse(parsed.storyOrdering);
      if (soResult.success) validFields.storyOrdering = soResult.data;
      const pbResult = z.enum(["auto-advance", "halt-and-notify", "halt-hard"]).safeParse(parsed.phaseBoundaryBehavior);
      if (pbResult.success) validFields.phaseBoundaryBehavior = pbResult.data;
      const bvResult = z.enum(["concise", "detailed"]).safeParse(parsed.briefVerbosity);
      if (bvResult.success) validFields.briefVerbosity = bvResult.data;
      const obsResult = observabilitySchema.safeParse(parsed.observability);
      if (obsResult.success) validFields.observability = obsResult.data;

      // If the failure was ONLY due to unknown fields (strict mode), and all known fields are valid, use the salvaged fields
      if (unknownFields.length > 0) {
        fileConfig = validFields;
      }
      // If known fields had invalid values, they were already skipped by safeParse above
      if (unknownFields.length === 0) {
        // Pure schema-invalid values — log warning
        console.error(`forge: config has invalid values; skipping invalid fields, applying valid ones`);
        fileConfig = validFields;
      }
    } else {
      fileConfig = result.data;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`forge: failed to read config at ${configPath} (using defaults): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Per-field merge: args > file > defaults
  function resolve<K extends keyof Omit<ResolvedConfig, "configSource" | "observability">>(field: K): Omit<ResolvedConfig, "configSource" | "observability">[K] {
    if (args[field] !== undefined) {
      configSource[field] = "args";
      return args[field] as Omit<ResolvedConfig, "configSource" | "observability">[K];
    }
    if (fileConfig[field] !== undefined) {
      configSource[field] = "file";
      return fileConfig[field] as Omit<ResolvedConfig, "configSource" | "observability">[K];
    }
    configSource[field] = "default";
    return CONFIG_DEFAULTS[field];
  }

  const resolved: ResolvedConfig = {
    storyOrdering: resolve("storyOrdering"),
    phaseBoundaryBehavior: resolve("phaseBoundaryBehavior"),
    briefVerbosity: resolve("briefVerbosity"),
    observability: { ...CONFIG_DEFAULTS.observability, ...(fileConfig.observability ?? {}), ...(args.observability ?? {}) },
    configSource,
  };

  // Observability provenance
  if (args.observability) configSource["observability"] = "args";
  else if (fileConfig.observability) configSource["observability"] = "file";
  else configSource["observability"] = "default";

  // writeRunRecord: false warning chain (NFR-C03 opt-out)
  if (resolved.observability.writeRunRecord === false) {
    console.error("forge: WARNING: observability.writeRunRecord is false — crash recovery data will not be written");
  }

  return resolved;
}

export interface AssessPhaseOptions {
  phaseId?: string;
  budgetUsd?: number | null;
  maxTimeMs?: number | null;
  currentPlanStartTimeMs?: number | null;
  config?: ResolvedConfig;
  haltClearedByHuman?: boolean;
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

  // ── REQ-13: reconcileState runs FIRST ──────────────────────
  const storyIds = new Set(stories.map((s) => s.id));
  reconcileOrphans(primaryRecords, storyIds);
  const danglingDeps = detectDanglingDeps(stories, storyIds);

  // Optional: filter by currentPlanStartTimeMs
  const startFilter = options.currentPlanStartTimeMs ?? null;
  const filteredRecords = startFilter !== null
    ? primaryRecords.filter((r) => new Date(r.timestamp).getTime() >= startFilter)
    : primaryRecords;

  // Group primary records by storyId (only records matching current plan)
  const recordsByStory = new Map<string, RunRecord[]>();
  for (const record of filteredRecords) {
    if (!record.storyId) continue;
    if (!storyIds.has(record.storyId)) continue; // skip orphaned records
    const list = recordsByStory.get(record.storyId) ?? [];
    list.push(record);
    recordsByStory.set(record.storyId, list);
  }

  // Sort each story's records by timestamp ascending
  for (const records of recordsByStory.values()) {
    records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

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

    // Dangling-dep override: if this story has a dangling dep, force pending
    const danglingDepIds = danglingDeps.get(story.id);
    if (danglingDepIds && danglingDepIds.length > 0) {
      statusMap.set(story.id, {
        storyId: story.id,
        status: "pending",
        retryCount,
        retriesRemaining,
        priorEvalReport: getPriorEvalReport("pending", mostRecent),
        evidence: `dep ${danglingDepIds.join(", ")} missing from plan`,
      });
      continue;
    }

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
  const brief = assemblePhaseTransitionBrief(entries, options, allRecords, stories, {
    config: options.config,
    haltClearedByHuman: options.haltClearedByHuman,
  });

  return {
    mode: "advisory",
    phaseId: options.phaseId ?? "default",
    brief,
  };
}

/**
 * REQ-13: Detect orphaned records — storyIds in run records not in current plan.
 * Logs console.error for each orphan. Returns the set of orphaned storyIds.
 */
function reconcileOrphans(primaryRecords: RunRecord[], storyIds: Set<string>): Set<string> {
  const orphanedIds = new Set<string>();
  for (const record of primaryRecords) {
    if (!record.storyId) continue;
    if (!storyIds.has(record.storyId) && !orphanedIds.has(record.storyId)) {
      orphanedIds.add(record.storyId);
      console.error(`forge: orphaned record for storyId '${record.storyId}' not in current plan (excluded from classification)`);
    }
  }
  return orphanedIds;
}

/**
 * REQ-13: Detect dangling dependencies — stories referencing dep IDs not in plan.
 * Logs console.error P45 warning for each dangling dep.
 * Returns a Map from storyId → list of dangling dep IDs.
 */
function detectDanglingDeps(stories: Story[], storyIds: Set<string>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const story of stories) {
    const dangling: string[] = [];
    for (const dep of story.dependencies ?? []) {
      if (!storyIds.has(dep)) {
        dangling.push(dep);
        console.error(`forge: dangling dependency '${dep}' referenced by story '${story.id}' not in current plan`);
      }
    }
    if (dangling.length > 0) {
      result.set(story.id, dangling);
    }
  }
  return result;
}

/**
 * REQ-13: Exported reconcileState — runs plan mutation reconciliation.
 * Detects orphaned records, new stories, and dangling dependencies.
 * Returns reconciliation info for observability.
 */
export interface ReconcileResult {
  orphanedStoryIds: string[];
  danglingDeps: Map<string, string[]>;
}

export async function reconcileState(plan: ExecutionPlan, projectPath: string): Promise<ReconcileResult> {
  const allRecords = await readRunRecords(projectPath);
  const primaryRecords = allRecords
    .filter((r): r is PrimaryRecord => r.source === "primary")
    .map((r) => r.record);

  const storyIds = new Set(plan.stories.map((s) => s.id));
  const orphanedIds = reconcileOrphans(primaryRecords, storyIds);
  const danglingDepsMap = detectDanglingDeps(plan.stories, storyIds);

  return {
    orphanedStoryIds: [...orphanedIds],
    danglingDeps: danglingDepsMap,
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

/**
 * Assemble a PhaseTransitionBrief from classified story entries (REQ-05).
 * Applies the 4-case status resolution rule and populates all brief fields.
 */
export interface AssembleBriefOptions {
  config?: ResolvedConfig;
  haltClearedByHuman?: boolean;
}

export function assemblePhaseTransitionBrief(
  entries: StoryStatusEntry[],
  options: AssessPhaseOptions = {},
  allRecords: ReadonlyArray<TaggedRunRecord> = [],
  planStories: Story[] = [],
  briefOptions?: AssembleBriefOptions,
): PhaseTransitionBrief {
  const config = briefOptions?.config;
  const haltClearedByHuman = briefOptions?.haltClearedByHuman ?? false;

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

  let status = resolvePhaseStatus(entries, completedCount, totalCount);
  const replanningNotes = buildReplanningNotes(entries, planStories);

  // halt-hard state machine (REQ-15): re-evaluated every call, not latched.
  if (config?.phaseBoundaryBehavior === "halt-hard" && status === "complete" && !haltClearedByHuman) {
    status = "halted";
    replanningNotes.push({
      category: "assumption-changed",
      severity: "blocking",
      description: "halt-hard: phase structurally complete but requires human clearance (haltClearedByHuman: true) to proceed",
    });
  }

  let recommendation = buildRecommendation(status, readyStories, failedStories, entries);

  // writeRunRecord: false → prefix recommendation (NFR-C03 opt-out chain)
  if (config?.observability?.writeRunRecord === false) {
    recommendation = "WARNING: crash recovery disabled. " + recommendation;
  }

  // briefVerbosity: detailed → append story details
  if (config?.briefVerbosity === "detailed") {
    const details = entries.map((e) => `  ${e.storyId}: ${e.status} (retries: ${e.retryCount}, remaining: ${e.retriesRemaining})`).join("\n");
    recommendation += "\n\nStory details:\n" + details;
  }

  return {
    status,
    stories: entries,
    readyStories,
    depFailedStories,
    failedStories,
    completedCount,
    totalCount,
    budget: checkBudget(allRecords, options.budgetUsd ?? undefined),
    timeBudget: checkTimeBudget(options.currentPlanStartTimeMs ?? undefined, options.maxTimeMs ?? undefined),
    replanningNotes,
    recommendation,
    configSource: config?.configSource ?? {},
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

function buildReplanningNotes(entries: StoryStatusEntry[], stories: Story[]): ReplanningNote[] {
  const notes: ReplanningNote[] = [];
  const failedEntries = entries.filter((e) => e.status === "failed");
  const depFailedEntries = entries.filter((e) => e.status === "dep-failed");

  // v1.1 retries-exhausted trigger: one note per terminal-failed story
  for (const entry of failedEntries) {
    notes.push({
      category: "ac-drift",
      severity: "blocking",
      affectedStories: [entry.storyId],
      description: `retries-exhausted: Story ${entry.storyId} exhausted retry budget (${entry.retryCount}/${MAX_RETRIES}) — requires plan correction (re-scope, re-phrase ACs, or remove)`,
    });
  }

  // v1.1 dep-failed-chain trigger: one note per distinct root failed story
  if (depFailedEntries.length > 0) {
    // Build adjacency: storyId → list of direct dependents
    const dependentsMap = new Map<string, string[]>();
    for (const story of stories) {
      for (const dep of story.dependencies ?? []) {
        const list = dependentsMap.get(dep) ?? [];
        list.push(story.id);
        dependentsMap.set(dep, list);
      }
    }

    // For each root failed story, compute transitive closure of downstream dep-failed stories
    const entryMap = new Map(entries.map((e) => [e.storyId, e]));
    for (const root of failedEntries) {
      const closure: string[] = [];
      const queue = [root.storyId];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const dependent of dependentsMap.get(current) ?? []) {
          if (visited.has(dependent)) continue;
          visited.add(dependent);
          const depEntry = entryMap.get(dependent);
          if (depEntry?.status === "dep-failed") {
            closure.push(dependent);
            queue.push(dependent);
          }
        }
      }
      if (closure.length > 0) {
        notes.push({
          category: "assumption-changed",
          severity: "blocking",
          affectedStories: [root.storyId, ...closure],
          description: `dep-failed-chain: Root story ${root.storyId} failed; downstream dep-failed: ${closure.join(", ")}`,
        });
      }
    }
  }

  return notes;
}

/**
 * Mechanical mapping from EscalationReason and EvalReport.verdict to ReplanningNote (REQ-10).
 * No LLM calls — pure classification. Unknown reasons route to gap-found with P45 warning.
 */
export interface CollectReplanningInput {
  escalationReason?: string;
  evalVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  storyId?: string;
}

const ESCALATION_REASON_TO_CATEGORY: Record<EscalationReason, ReplanningCategory> = {
  "plateau": "partial-completion",
  "no-op": "gap-found",
  "max-iterations": "partial-completion",
  "inconclusive": "gap-found",
  "baseline-failed": "assumption-changed",
};

const KNOWN_ESCALATION_REASONS = new Set<string>(Object.keys(ESCALATION_REASON_TO_CATEGORY));

export function collectReplanningNotes(inputs: CollectReplanningInput[]): ReplanningNote[] {
  const notes: ReplanningNote[] = [];

  for (const input of inputs) {
    // Map escalation reasons
    if (input.escalationReason) {
      if (KNOWN_ESCALATION_REASONS.has(input.escalationReason)) {
        const category = ESCALATION_REASON_TO_CATEGORY[input.escalationReason as EscalationReason];
        notes.push({
          category,
          severity: category === "assumption-changed" ? "blocking" : "should-address",
          affectedStories: input.storyId ? [input.storyId] : undefined,
          description: `EscalationReason '${input.escalationReason}' mapped to ${category} for story ${input.storyId ?? "unknown"}`,
        });
      } else {
        console.error(`WARNING: unknown EscalationReason routed to gap-found: ${input.escalationReason}`);
        notes.push({
          category: "gap-found",
          severity: "informational",
          affectedStories: input.storyId ? [input.storyId] : undefined,
          description: `Unknown EscalationReason '${input.escalationReason}' routed to gap-found for story ${input.storyId ?? "unknown"}`,
        });
      }
    }

    // Map eval verdicts
    if (input.evalVerdict === "FAIL") {
      notes.push({
        category: "ac-drift",
        severity: "blocking",
        affectedStories: input.storyId ? [input.storyId] : undefined,
        description: `Eval verdict FAIL mapped to ac-drift for story ${input.storyId ?? "unknown"}`,
      });
    } else if (input.evalVerdict === "INCONCLUSIVE") {
      notes.push({
        category: "gap-found",
        severity: "should-address",
        affectedStories: input.storyId ? [input.storyId] : undefined,
        description: `Eval verdict INCONCLUSIVE mapped to gap-found for story ${input.storyId ?? "unknown"}`,
      });
    }
  }

  return notes;
}

function buildRecommendation(
  status: string,
  readyStories: string[],
  failedStories: string[],
  entries: StoryStatusEntry[],
): string {
  const parts: string[] = [];

  // LAST RETRY warnings (binary-greppable)
  const lastRetryEntries = entries.filter((e) => e.retriesRemaining === 1);
  for (const entry of lastRetryEntries) {
    parts.push(`LAST RETRY: ${entry.storyId}`);
  }

  switch (status) {
    case "complete":
      parts.push("All stories complete. Phase is ready for transition.");
      break;
    case "needs-replan":
      parts.push(`Replan needed. Failed stories: ${failedStories.join(", ")}. Run forge_plan(update) to address.`);
      break;
    case "in-progress":
      parts.push(
        readyStories.length > 0
          ? `Continue execution. Ready stories: ${readyStories.join(", ")}.`
          : "Waiting on in-progress dependencies.",
      );
      break;
  }

  return parts.join(" ");
}

/**
 * Pure budget check over tagged-union run records (REQ-06, NFR-C04, NFR-C09).
 * Filters to primary records, sums estimatedCostUsd, returns BudgetInfo.
 * Advisory only — never throws on exceeded budget.
 */
export function checkBudget(priorRecords: ReadonlyArray<TaggedRunRecord>, budgetUsd: number | undefined): BudgetInfo {
  if (budgetUsd === undefined || budgetUsd === null) {
    return {
      usedUsd: 0,
      budgetUsd: null,
      remainingUsd: null,
      incompleteData: false,
      warningLevel: "none",
    };
  }

  let usedUsd = 0;
  let incompleteData = false;

  for (const entry of priorRecords) {
    if (entry.source !== "primary") continue;
    const cost = entry.record.metrics.estimatedCostUsd;
    if (cost === undefined || cost === null) {
      incompleteData = true;
      continue;
    }
    usedUsd += cost;
  }

  const ratio = budgetUsd > 0 ? usedUsd / budgetUsd : 0;
  let warningLevel: BudgetWarningLevel = "none";
  if (ratio >= 1) {
    warningLevel = "exceeded";
  } else if (ratio >= 0.8) {
    warningLevel = "approaching";
  }

  return {
    usedUsd,
    budgetUsd,
    remainingUsd: budgetUsd - usedUsd,
    incompleteData,
    warningLevel,
  };
}

/**
 * Pure wall-clock time budget check (REQ-07).
 * Missing startTimeMs → 'unknown' (not 'none'). Missing maxTimeMs → 'none' (no-op).
 * Never throws — pure computation.
 */
export function checkTimeBudget(startTimeMs: number | undefined, maxTimeMs: number | undefined): TimeBudgetInfo {
  if (startTimeMs === undefined || startTimeMs === null) {
    return { elapsedMs: 0, maxTimeMs: maxTimeMs ?? null, warningLevel: "unknown" };
  }

  const elapsedMs = Date.now() - startTimeMs;

  if (maxTimeMs === undefined || maxTimeMs === null) {
    return { elapsedMs, maxTimeMs: null, warningLevel: "none" };
  }

  const ratio = maxTimeMs > 0 ? elapsedMs / maxTimeMs : 0;
  let warningLevel: TimeWarningLevel = "none";
  if (ratio >= 1) {
    warningLevel = "exceeded";
  } else if (ratio >= 0.8) {
    warningLevel = "approaching";
  }

  return { elapsedMs, maxTimeMs, warningLevel };
}

/**
 * Pure state recovery from run records (REQ-09, NFR-C03).
 * Reads `.forge/runs/`, filters to primary records matching plan stories,
 * classifies each story via the 6-state precedence chain.
 * No persistent coordinator state file — all state is re-derived from run records.
 * Composition: reconcileState (PH-03) runs FIRST; recoverState operates on the reconciled view.
 */
export async function recoverState(plan: ExecutionPlan, projectPath: string): Promise<Map<string, StoryStatusEntry>> {
  const stories = plan.stories;
  const sorted = stories.length > 0 ? topoSort(stories) : [];

  const allRecords = await readRunRecords(projectPath);
  const primaryRecords = allRecords
    .filter((r): r is PrimaryRecord => r.source === "primary")
    .map((r) => r.record);

  const storyIds = new Set(stories.map((s) => s.id));

  const recordsByStory = new Map<string, RunRecord[]>();
  for (const record of primaryRecords) {
    if (!record.storyId) continue;
    if (!storyIds.has(record.storyId)) continue;
    const list = recordsByStory.get(record.storyId) ?? [];
    list.push(record);
    recordsByStory.set(record.storyId, list);
  }

  for (const records of recordsByStory.values()) {
    records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  const statusMap = new Map<string, StoryStatusEntry>();

  for (const story of sorted) {
    const records = recordsByStory.get(story.id) ?? [];
    const mostRecent = records.length > 0 ? records[records.length - 1] : null;
    const retryCount = records.filter((r) => r.evalVerdict !== "PASS").length;
    const retriesRemaining = Math.max(0, MAX_RETRIES - retryCount);

    const status = classifyStory(story, mostRecent, retryCount, records.length, statusMap, storyIds);
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

  return statusMap;
}

/**
 * Aggregate observability status from run records (REQ-11).
 * Returns accumulated cost, velocity (stories/hour), and optional audit entries.
 */
export interface AggregateStatusOptions {
  includeAudit?: boolean;
  currentPlanStartTimeMs?: number;
  storyIds?: string[];
}

export interface AggregateStatusResult {
  accumulatedCostUsd: number;
  incompleteData: boolean;
  velocityStoriesPerHour: number;
  auditEntries?: ReadonlyArray<Record<string, unknown>>;
}

export async function aggregateStatus(projectPath: string, options: AggregateStatusOptions = {}): Promise<AggregateStatusResult> {
  const allRecords = await readRunRecords(projectPath);
  const primaryRecords = allRecords
    .filter((r): r is PrimaryRecord => r.source === "primary")
    .map((r) => r.record);

  // Optional window clipping
  const startFilter = options.currentPlanStartTimeMs ?? null;
  const windowedRecords = startFilter !== null
    ? primaryRecords.filter((r) => new Date(r.timestamp).getTime() >= startFilter)
    : primaryRecords;

  // Optional story ID filter
  const storyFilter = options.storyIds ? new Set(options.storyIds) : null;
  const filteredRecords = storyFilter
    ? windowedRecords.filter((r) => r.storyId && storyFilter.has(r.storyId))
    : windowedRecords;

  // Accumulated cost
  let accumulatedCostUsd = 0;
  let incompleteData = false;
  for (const record of filteredRecords) {
    const cost = record.metrics.estimatedCostUsd;
    if (cost === undefined || cost === null) {
      incompleteData = true;
      continue;
    }
    accumulatedCostUsd += cost;
  }

  // Velocity: completedStoryCount / elapsedHours
  const passStoryIds = new Set<string>();
  for (const record of filteredRecords) {
    if (record.evalVerdict === "PASS" && record.storyId) {
      passStoryIds.add(record.storyId);
    }
  }
  const completedStoryCount = passStoryIds.size;

  let velocityStoriesPerHour = 0;
  if (completedStoryCount > 0 && filteredRecords.length > 0) {
    const earliestTimestamp = filteredRecords.reduce((min, r) => {
      return r.timestamp < min ? r.timestamp : min;
    }, filteredRecords[0].timestamp);
    const elapsedMs = Date.now() - new Date(earliestTimestamp).getTime();
    const elapsedHours = elapsedMs / 3_600_000;
    if (elapsedHours > 0) {
      velocityStoriesPerHour = completedStoryCount / elapsedHours;
    }
  }

  const result: AggregateStatusResult = {
    accumulatedCostUsd,
    incompleteData,
    velocityStoriesPerHour,
  };

  if (options.includeAudit) {
    result.auditEntries = await readAuditEntries(projectPath);
  }

  return result;
}

/**
 * Graduate repeated failure patterns into structured findings (REQ-12).
 * Dedupes by (storyId, escalationReason) BEFORE the ≥3 threshold to prevent
 * a single retry-exhausted story from self-graduating.
 */
export interface GraduateFindingsOptions {
  currentPlanStartTimeMs?: number;
  storyIds?: string[];
}

export async function graduateFindings(projectPath: string, options: GraduateFindingsOptions = {}): Promise<GraduateFindingsResult> {
  const windowInflationRisk = options.currentPlanStartTimeMs === undefined;

  const allRecords = await readRunRecords(projectPath);
  const primaryRecords = allRecords
    .filter((r): r is PrimaryRecord => r.source === "primary")
    .map((r) => r.record);

  // Optional window clipping
  const startFilter = options.currentPlanStartTimeMs ?? null;
  const windowedRecords = startFilter !== null
    ? primaryRecords.filter((r) => new Date(r.timestamp).getTime() >= startFilter)
    : primaryRecords;

  // Optional story ID filter
  const storyFilter = options.storyIds ? new Set(options.storyIds) : null;
  const filteredRecords = storyFilter
    ? windowedRecords.filter((r) => r.storyId && storyFilter.has(r.storyId))
    : windowedRecords;

  // Dedup by (storyId, escalationReason) — each story contributes at most 1 per reason
  const seen = new Set<string>();
  const reasonCounts = new Map<string, Set<string>>();

  for (const record of filteredRecords) {
    if (!record.storyId) continue;
    const reason = record.escalationReason;
    if (!reason) continue;

    const dedupKey = `${record.storyId}::${reason}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const storySet = reasonCounts.get(reason) ?? new Set<string>();
    storySet.add(record.storyId);
    reasonCounts.set(reason, storySet);
  }

  // Apply ≥3 threshold
  const findings: Finding[] = [];
  for (const [reason, storySet] of reasonCounts) {
    if (storySet.size >= 3) {
      findings.push({
        escalationReason: reason,
        distinctStoryCount: storySet.size,
        storyIds: [...storySet].sort(),
      });
    }
  }

  return { findings, windowInflationRisk };
}
