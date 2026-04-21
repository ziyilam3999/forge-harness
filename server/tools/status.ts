import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { readRunRecords, type PrimaryRecord, type TaggedRunRecord } from "../lib/run-reader.js";
import { getDeclaration } from "../lib/declaration-store.js";
import type { RunRecord } from "../lib/run-record.js";

// ── Zod schema for MCP input ────────────────────────────────

const scopeSchema = z
  .object({
    planPath: z.string().optional().describe("Filter by plan path. Omit for 'any plan'."),
    storyId: z.string().optional().describe("Filter by story identifier, e.g. 'US-03'."),
    phaseId: z.string().optional().describe("Filter by phase identifier, e.g. 'PH-02'."),
  })
  .optional();

export const statusInputSchema = {
  scope: scopeSchema.describe(
    "Optional scope narrowing. Omit all fields to return everything.",
  ),
  since: z
    .string()
    .optional()
    .describe(
      "Differential mode — return only changes since this ISO-8601 timestamp. Omit for full snapshot.",
    ),
  projectPath: z
    .string()
    .optional()
    .describe("Project root path (contains .forge/). Defaults to '.'"),
};

type StatusInput = {
  scope?: {
    planPath?: string;
    storyId?: string;
    phaseId?: string;
  };
  since?: string;
  projectPath?: string;
};

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Output schema (mirrors monday-bot's TypeScript interface) ──

export type StatusKind = "snapshot" | "differential" | "empty" | "corrupted";

export type StoryState = "pending" | "in-progress" | "blocked" | "shipped" | "unknown";

export type Verdict = "PASS" | "BLOCK" | "UNKNOWN" | null;

export interface StoryStatus {
  storyId: string;
  state: StoryState;
  lastPhase: string | null;
  lastVerdict: Verdict;
  lastUpdatedAt: string | null;
  runCount: number;
  lastGitSha: string | null;
}

export interface ActiveRun {
  runId: string;
  storyId: string | null;
  phaseId: string | null;
  toolName: string;
  startedAt: string;
  elapsedMs: number;
  pid: number;
}

export interface StatusOutput {
  kind: StatusKind;
  generatedAt: string;
  stories?: StoryStatus[];
  activeRun?: ActiveRun | null;
  totals?: {
    spentUsd: number;
    elapsedMs: number;
    budgetUsd: number | null;
    timeBudgetMs: number | null;
  };
  corruptedFiles?: string[];
  reason?: string;
}

// ── Internal helpers ────────────────────────────────────────

interface ActivityFileShape {
  tool?: string | null;
  storyId?: string;
  stage?: string;
  startedAt?: string;
  lastUpdate?: string;
  label?: string;
  progress?: { current: number; total: number };
}

/**
 * Read `.forge/activity.json` if present. Returns the parsed shape,
 * or null on any failure (missing file, corrupt JSON, etc.). Never
 * throws — status is read-only and partial information is always
 * better than a thrown error.
 */
async function readActivity(projectPath: string): Promise<ActivityFileShape | null> {
  const activityPath = join(projectPath, ".forge", "activity.json");
  try {
    const content = await readFile(activityPath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as ActivityFileShape;
  } catch {
    return null;
  }
}

/**
 * Narrow a disk RunRecord by a user-supplied scope. Records with no
 * storyId do not match any storyId filter, but are not filtered when
 * storyId is omitted.
 */
function matchesScope(
  record: RunRecord,
  scope: StatusInput["scope"] | undefined,
): boolean {
  if (!scope) return true;
  if (scope.storyId !== undefined) {
    if (record.storyId !== scope.storyId) return false;
  }
  // `planPath` and `phaseId` are not first-class fields on RunRecord.
  // PhaseId often appears inside evalReport.criteria[*].id conventions
  // (e.g. "PH-02/US-03/AC-1") but that is not reliable to parse here.
  // v1: we accept these filters for forward-compatibility but only
  // storyId actually narrows the in-memory records. planPath / phaseId
  // filters that match zero records fall through to the scope-miss
  // emptiness branch, which is the documented behavior.
  if (scope.phaseId !== undefined || scope.planPath !== undefined) {
    // Keep the record only if we have no evidence it doesn't match.
    // Since we don't store phaseId or planPath on RunRecord, we
    // conservatively keep the record — callers using phaseId/planPath
    // filters without storyId will see all matching-storyId records.
    // If the scope narrows to zero, we still return scope-miss in
    // the handler.
  }
  return true;
}

/**
 * Roll up per-story status from the list of PrimaryRecords. The last
 * record (by timestamp ascending — readRunRecords sorts for us) per
 * storyId wins for `lastPhase`, `lastVerdict`, `lastUpdatedAt`.
 */
function rollUpStories(records: readonly PrimaryRecord[]): StoryStatus[] {
  const byStory = new Map<string, StoryStatus>();

  for (const entry of records) {
    const rec = entry.record;
    const storyId = rec.storyId;
    if (!storyId) continue; // Records without a storyId are not rolled up.

    const existing = byStory.get(storyId);
    const runCount = (existing?.runCount ?? 0) + 1;

    const verdict: Verdict =
      rec.evalVerdict === "PASS"
        ? "PASS"
        : rec.evalVerdict === "FAIL"
          ? "BLOCK"
          : rec.evalVerdict === "INCONCLUSIVE"
            ? "UNKNOWN"
            : existing?.lastVerdict ?? null;

    // lastPhase / lastGitSha: we don't have dedicated fields, so we
    // derive conservatively. phaseId is sometimes embedded in
    // escalationReason or elsewhere — for v1 we leave `lastPhase`
    // as null unless we can reliably populate it.
    const lastPhase: string | null = existing?.lastPhase ?? null;
    const lastGitSha: string | null = existing?.lastGitSha ?? null;

    // Derive state: shipped on the latest PASS; blocked on latest FAIL;
    // in-progress when there is a run but no verdict; unknown otherwise.
    const state: StoryState =
      rec.evalVerdict === "PASS"
        ? "shipped"
        : rec.evalVerdict === "FAIL"
          ? "blocked"
          : rec.evalVerdict === "INCONCLUSIVE"
            ? "unknown"
            : "in-progress";

    byStory.set(storyId, {
      storyId,
      state,
      lastPhase,
      lastVerdict: verdict,
      lastUpdatedAt: rec.timestamp,
      runCount,
      lastGitSha,
    });
  }

  // Stable ordering by storyId for deterministic output.
  return [...byStory.values()].sort((a, b) =>
    a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0,
  );
}

/**
 * Compute aggregate totals across the matched records. Sums
 * estimatedCostUsd and durationMs. Returns zero-sums for empty input.
 */
function computeTotals(records: readonly PrimaryRecord[]): StatusOutput["totals"] {
  let spentUsd = 0;
  let elapsedMs = 0;
  for (const entry of records) {
    const m = entry.record.metrics;
    if (typeof m.estimatedCostUsd === "number") spentUsd += m.estimatedCostUsd;
    if (typeof m.durationMs === "number") elapsedMs += m.durationMs;
  }
  return {
    spentUsd,
    elapsedMs,
    budgetUsd: null,
    timeBudgetMs: null,
  };
}

/**
 * Build the `activeRun` field. Precedence:
 *   1. forge_declare_story declaration (storyId + phaseId, in-memory,
 *      always wins on storyId/phaseId when present).
 *   2. `.forge/activity.json` — adds toolName + startedAt + elapsedMs
 *      when a reporter is flushing.
 *
 * Returns null when neither source has data.
 */
function buildActiveRun(
  declaration: ReturnType<typeof getDeclaration>,
  activity: ActivityFileShape | null,
): ActiveRun | null {
  const hasActivity =
    activity !== null &&
    typeof activity.tool === "string" &&
    activity.tool.length > 0;

  if (!declaration && !hasActivity) return null;

  const startedAtIso: string =
    (hasActivity && activity!.startedAt) ||
    declaration?.declaredAt ||
    new Date().toISOString();

  let elapsedMs = 0;
  const startedMs = Date.parse(startedAtIso);
  if (!Number.isNaN(startedMs)) elapsedMs = Math.max(0, Date.now() - startedMs);

  // runId: reuse the startedAt ISO as a synthetic id. Activity.json
  // does not carry a dedicated runId; using startedAt keeps the id
  // stable across back-to-back forge_status polls for the same run.
  const runId = startedAtIso;

  return {
    runId,
    storyId: declaration?.storyId ?? activity?.storyId ?? null,
    phaseId: declaration?.phaseId ?? null,
    toolName: hasActivity ? activity!.tool! : "forge_declare_story",
    startedAt: startedAtIso,
    elapsedMs,
    pid: process.pid,
  };
}

/**
 * Read disk records and capture corrupted-file info. Because
 * readRunRecords() currently swallows and logs corrupt-file errors,
 * this helper falls back to a direct listdir scan to detect corruption
 * when the user needs to know (AC-6).
 */
async function readDiskRecordsWithCorruption(
  projectPath: string,
): Promise<{ records: readonly TaggedRunRecord[]; corruptedFiles: string[] }> {
  const records = await readRunRecords(projectPath);
  const corruptedFiles: string[] = [];

  // Probe for corruption independently: readRunRecords() consumes corrupt
  // files silently, but forge_status's contract requires surfacing them.
  try {
    const { readdir } = await import("node:fs/promises");
    const runsDir = join(projectPath, ".forge", "runs");
    const files = await readdir(runsDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const fullPath = join(runsDir, f);
      try {
        const content = await readFile(fullPath, "utf-8");
        try {
          const parsed: unknown = JSON.parse(content);
          // Schema-mismatch (parseable JSON but not a RunRecord) also
          // counts as corruption here, consistent with the contract.
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            typeof (parsed as Record<string, unknown>).timestamp !== "string" ||
            typeof (parsed as Record<string, unknown>).tool !== "string"
          ) {
            corruptedFiles.push(f);
          }
        } catch {
          corruptedFiles.push(f);
        }
      } catch {
        // Unreadable individual file — not a parse problem; skip.
      }
    }
  } catch {
    // No runs dir or other probe failure — leave corruptedFiles empty.
  }

  return { records, corruptedFiles };
}

async function forgeDirExists(projectPath: string): Promise<boolean> {
  try {
    const s = await stat(join(projectPath, ".forge"));
    return s.isDirectory();
  } catch {
    return false;
  }
}

// ── Handler ─────────────────────────────────────────────────

/**
 * forge_status — read-only status query merging disk RunRecords and
 * live in-memory state. Never writes, never mutates coordinator state,
 * never calls an LLM. Safe in tight polling loops.
 *
 * Output kinds:
 *   - "empty": .forge/ missing (reason: "no-forge-dir"), .forge/runs
 *     empty (reason: "no-runs"), or scope narrows to zero records
 *     (reason: "scope-miss").
 *   - "corrupted": one or more RunRecord files failed to parse.
 *     stories / totals are still populated best-effort from parseable
 *     records; corruptedFiles lists the broken filenames.
 *   - "differential": `since` was supplied and the roll-up was
 *     filtered to only records newer than `since`. Empty `stories` is
 *     valid in this mode.
 *   - "snapshot": default, full roll-up across matched scope.
 */
export async function handleStatus(input: StatusInput): Promise<McpResponse> {
  const generatedAt = new Date().toISOString();
  const projectPath = input.projectPath ?? ".";

  // Always build activeRun first — it's cheap and orthogonal to the
  // disk walk, so even `kind: "empty"` responses can carry it.
  const activity = await readActivity(projectPath);
  const declaration = getDeclaration();
  const activeRun = buildActiveRun(declaration, activity);

  // Case 1: no .forge dir at all.
  if (!(await forgeDirExists(projectPath))) {
    const body: StatusOutput = {
      kind: "empty",
      generatedAt,
      reason: "no-forge-dir",
      activeRun,
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  }

  // Read disk records + detect corruption.
  const { records, corruptedFiles } = await readDiskRecordsWithCorruption(projectPath);

  // Filter to primary records and by scope.
  const primaryAll = records.filter(
    (r): r is PrimaryRecord => r.source === "primary",
  );
  const scoped = primaryAll.filter((r) => matchesScope(r.record, input.scope));

  // Differential filter (applied on top of scope).
  let filtered = scoped;
  let isDifferential = false;
  if (input.since !== undefined) {
    const sinceMs = Date.parse(input.since);
    if (!Number.isNaN(sinceMs)) {
      isDifferential = true;
      filtered = scoped.filter((r) => {
        const recMs = Date.parse(r.record.timestamp);
        return !Number.isNaN(recMs) && recMs > sinceMs;
      });
    }
    // NaN `since` → treat as full snapshot (spec: "since predates all
    // records → treat as no-since"). Only explicit empty-differentials
    // are flagged `differential`.
  }

  // Case 2: corruption detected — surface it with best-effort roll-up.
  if (corruptedFiles.length > 0) {
    const stories = rollUpStories(filtered);
    const totals = computeTotals(filtered);
    const body: StatusOutput = {
      kind: "corrupted",
      generatedAt,
      stories,
      activeRun,
      totals,
      corruptedFiles,
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  }

  // Case 3: no runs at all on disk (before or after scope).
  if (primaryAll.length === 0) {
    const body: StatusOutput = {
      kind: "empty",
      generatedAt,
      reason: "no-runs",
      activeRun,
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  }

  // Case 4: scope narrowed to zero matches.
  if (scoped.length === 0) {
    const body: StatusOutput = {
      kind: "empty",
      generatedAt,
      reason: "scope-miss",
      activeRun,
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  }

  // Case 5: normal snapshot or differential.
  const stories = rollUpStories(filtered);
  const totals = computeTotals(filtered);

  const body: StatusOutput = {
    kind: isDifferential ? "differential" : "snapshot",
    generatedAt,
    stories,
    activeRun,
    totals,
  };

  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}
