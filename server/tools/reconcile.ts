import { z } from "zod";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { handlePlan } from "./plan.js";
import type { ReplanningNote, ReplanningCategory } from "../types/coordinate-result.js";
import type {
  ReconcileOutput,
  ReconcileOperation,
  ReconcileConflict,
  ReconcileStatus,
} from "../types/reconcile-output.js";

/**
 * Category precedence — highest first. When two notes touch the same story,
 * the higher-precedence note wins and lower-precedence notes are recorded as
 * conflicts.
 *
 * NOTE: gap-found is intentionally excluded from this list. gap-found notes
 * are routed to the JSONL audit log BEFORE precedence conflict resolution
 * runs, and they NEVER participate in conflicts (they are not suppressed by
 * higher-precedence notes on the same story).
 */
const CATEGORY_PRECEDENCE: ReplanningCategory[] = [
  "assumption-changed",
  "ac-drift",
  "partial-completion",
  "dependency-satisfied",
];

function precedenceRank(category: ReplanningCategory): number {
  const idx = CATEGORY_PRECEDENCE.indexOf(category);
  return idx === -1 ? CATEGORY_PRECEDENCE.length : idx;
}

export const reconcileInputSchema = {
  projectPath: z.string().describe("Absolute path to the project root"),
  replanningNotes: z
    .array(
      z.object({
        category: z.enum([
          "ac-drift",
          "partial-completion",
          "dependency-satisfied",
          "gap-found",
          "assumption-changed",
        ]),
        severity: z.enum(["blocking", "should-address", "informational"]),
        affectedPhases: z.array(z.string()).optional(),
        affectedStories: z.array(z.string()).optional(),
        description: z.string(),
      }),
    )
    .describe("ReplanningNote batch, typically produced by forge_coordinate"),
  masterPlanPath: z
    .string()
    .describe("Path to master plan JSON relative to projectPath"),
  phasePlanPaths: z
    .record(z.string(), z.string())
    .describe("Map of phaseId → relative path to phase plan JSON"),
  currentMasterPlan: z
    .string()
    .describe("Serialized current master plan JSON (for handlePlan input)"),
  currentPhasePlans: z
    .record(z.string(), z.string())
    .describe("Map of phaseId → serialized phase plan JSON"),
};

interface ReconcileInput {
  projectPath: string;
  replanningNotes: ReplanningNote[];
  masterPlanPath: string;
  phasePlanPaths: Record<string, string>;
  currentMasterPlan: string;
  currentPhasePlans: Record<string, string>;
}

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function resolvePath(projectPath: string, p: string): string {
  return isAbsolute(p) ? p : join(projectPath, p);
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function formatNotesAsMarkdown(notes: ReplanningNote[]): string {
  return notes
    .map((n) => `- [${n.category}/${n.severity}] ${n.description}`)
    .join("\n");
}

function parseHandlePlanOutput(text: string): unknown | null {
  // handlePlan update returns "=== UPDATED PLAN ===\n\n<JSON>\n\n=== CRITIQUE..."
  // We need to extract the JSON object between the header and next section.
  const marker = "=== UPDATED PLAN ===";
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // Try direct JSON parse
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  const after = text.slice(idx + marker.length);
  // Find the first `{` and the matching end `}` using brace counting.
  const start = after.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < after.length; i++) {
    const ch = after[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const jsonStr = after.slice(start, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Forge Reconcile — Intelligent Clipboard orchestrator for plan writeback.
 *
 * Sorts notes by category precedence, atomically halts on any blocking note,
 * routes surviving notes to master-update or phase-update via handlePlan, and
 * writes gap-found notes to .forge/audit/reconcile-notes.jsonl.
 *
 * Does NOT call Claude directly — all LLM work is delegated to handlePlan.
 */
export async function handleReconcile(input: ReconcileInput): Promise<McpResponse> {
  const {
    projectPath,
    replanningNotes,
    masterPlanPath,
    phasePlanPaths,
    currentMasterPlan,
    currentPhasePlans,
  } = input;

  const reconcileDir = join(projectPath, ".forge", "reconcile");
  const auditDir = join(projectPath, ".forge", "audit");
  const outputPath = join(reconcileDir, "reconcile-output.json");
  const jsonlPath = join(auditDir, "reconcile-notes.jsonl");

  // ── Atomic halt check — scan the entire original batch first ──
  const haltIdx = replanningNotes.findIndex((n) => n.severity === "blocking");
  if (haltIdx !== -1) {
    const output: ReconcileOutput = {
      status: "halted",
      operations: [],
      deferredNotes: [],
      conflicts: [],
      haltedOnNoteId: haltIdx,
      rewriteCount: 0,
      timestamp: new Date().toISOString(),
    };
    await ensureDir(reconcileDir);
    await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      isError: true,
    };
  }

  // ── Ensure audit + reconcile dirs exist (gap-found pass needs auditDir) ──
  await ensureDir(auditDir);
  await ensureDir(reconcileDir);

  const deferredNotes: ReplanningNote[] = [];
  const operations: ReconcileOperation[] = [];
  const errors: string[] = [];

  // ── Pass 1: unconditional gap-found extraction (NEVER suppressed) ──
  // gap-found notes bypass precedence conflict resolution entirely. They are
  // always appended to the JSONL audit log and surfaced in deferredNotes.
  const gapFoundHandled = new Set<number>();
  for (let i = 0; i < replanningNotes.length; i++) {
    const note = replanningNotes[i];
    if (note.category !== "gap-found") continue;
    gapFoundHandled.add(i);
    deferredNotes.push(note);
    const jsonlLine =
      JSON.stringify({
        ...note,
        deferred: true,
        recordedAt: new Date().toISOString(),
      }) + "\n";
    try {
      await appendFile(jsonlPath, jsonlLine, "utf-8");
    } catch (err) {
      errors.push(
        `Failed to append gap-found note #${i} to ${jsonlPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── Pass 2: precedence conflict resolution (non-gap-found only) ──
  // For each pair of notes that share at least one story in affectedStories,
  // keep only the highest-precedence note. Track losers in conflicts[].
  const conflicts: ReconcileConflict[] = [];
  const suppressed = new Set<number>(); // indices removed by conflict resolution

  for (let i = 0; i < replanningNotes.length; i++) {
    if (gapFoundHandled.has(i)) continue;
    if (suppressed.has(i)) continue;
    const a = replanningNotes[i];
    const aStories = new Set(a.affectedStories ?? []);
    if (aStories.size === 0) continue;

    for (let j = i + 1; j < replanningNotes.length; j++) {
      if (gapFoundHandled.has(j)) continue;
      if (suppressed.has(j)) continue;
      const b = replanningNotes[j];
      const bStories = b.affectedStories ?? [];
      const overlaps = bStories.some((s) => aStories.has(s));
      if (!overlaps) continue;

      const rankA = precedenceRank(a.category);
      const rankB = precedenceRank(b.category);

      if (rankA <= rankB) {
        // a wins; b is a loser
        suppressed.add(j);
        conflicts.push({
          noteIndex: j,
          conflictingCategories: [a.category, b.category],
          winningCategory: a.category,
        });
      } else {
        // b wins; a is a loser
        suppressed.add(i);
        conflicts.push({
          noteIndex: i,
          conflictingCategories: [a.category, b.category],
          winningCategory: b.category,
        });
        break; // i is gone; stop comparing
      }
    }
  }

  // ── Pass 3: route surviving non-gap-found notes ──
  const masterRouteIdx: number[] = [];
  const phaseRouteByPhase: Map<string, number[]> = new Map();

  for (let i = 0; i < replanningNotes.length; i++) {
    if (gapFoundHandled.has(i)) continue;
    if (suppressed.has(i)) continue;
    const note = replanningNotes[i];

    if (note.category === "ac-drift" || note.category === "assumption-changed") {
      masterRouteIdx.push(i);
      continue;
    }

    if (
      note.category === "partial-completion" ||
      note.category === "dependency-satisfied"
    ) {
      const phases = note.affectedPhases ?? [];
      if (phases.length === 0) {
        errors.push(
          `Note #${i} (${note.category}) has no affectedPhases — skipped`,
        );
        continue;
      }
      for (const ph of phases) {
        const list = phaseRouteByPhase.get(ph) ?? [];
        list.push(i);
        phaseRouteByPhase.set(ph, list);
      }
      continue;
    }

    // Nit 8 — default branch: guard future enum additions.
    errors.push(`Unknown ReplanningNote category: ${(note as { category: string }).category}`);
  }

  // ── Execute master-update route (if any) ──
  if (masterRouteIdx.length > 0) {
    const masterNotes = masterRouteIdx.map((i) => replanningNotes[i]);
    const implementationNotes = formatNotesAsMarkdown(masterNotes);
    const resp = await handlePlan({
      intent: "",
      documentTier: "update",
      currentPlan: currentMasterPlan,
      implementationNotes,
      projectPath,
    });

    let planPathWritten = "";
    if ((resp as { isError?: boolean }).isError) {
      errors.push(
        `handlePlan (master-update) returned error: ${resp.content[0]?.text ?? "unknown"}`,
      );
    } else {
      const parsed = parseHandlePlanOutput(resp.content[0]?.text ?? "");
      if (parsed === null) {
        errors.push("handlePlan (master-update): failed to parse updated plan JSON");
      } else {
        const target = resolvePath(projectPath, masterPlanPath);
        try {
          await ensureDir(dirname(target));
          await writeFile(target, JSON.stringify(parsed, null, 2), "utf-8");
          planPathWritten = masterPlanPath;
        } catch (err) {
          errors.push(
            `Failed to write master plan to ${target}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    operations.push({
      route: "master-update",
      noteIds: masterRouteIdx,
      planPathWritten,
    });
  }

  // ── Execute phase-update route (one op per affected phase) ──
  // Sort phase keys for determinism.
  const phaseKeys = [...phaseRouteByPhase.keys()].sort();
  for (const phaseId of phaseKeys) {
    const noteIds = phaseRouteByPhase.get(phaseId)!;
    const phaseNotes = noteIds.map((i) => replanningNotes[i]);
    const implementationNotes = formatNotesAsMarkdown(phaseNotes);

    const currentPhasePlan = currentPhasePlans[phaseId];
    if (currentPhasePlan === undefined) {
      errors.push(`No currentPhasePlan provided for phase ${phaseId}`);
      operations.push({
        route: "phase-update",
        affectedPhases: [phaseId],
        noteIds,
        planPathWritten: "",
      });
      continue;
    }

    // Nit 9 — guard missing phasePlanPaths entry BEFORE calling handlePlan.
    if (phasePlanPaths[phaseId] === undefined) {
      errors.push(`No phasePlanPaths entry for phase ${phaseId}; plan not written (handlePlan skipped)`);
      operations.push({
        route: "phase-update",
        affectedPhases: [phaseId],
        noteIds,
        planPathWritten: "",
      });
      continue;
    }

    const resp = await handlePlan({
      intent: "",
      documentTier: "update",
      currentPlan: currentPhasePlan,
      implementationNotes,
      projectPath,
    });

    let planPathWritten = "";
    if ((resp as { isError?: boolean }).isError) {
      errors.push(
        `handlePlan (phase-update ${phaseId}) returned error: ${resp.content[0]?.text ?? "unknown"}`,
      );
    } else {
      const parsed = parseHandlePlanOutput(resp.content[0]?.text ?? "");
      if (parsed === null) {
        errors.push(
          `handlePlan (phase-update ${phaseId}): failed to parse updated plan JSON`,
        );
      } else {
        const rel = phasePlanPaths[phaseId];
        if (rel === undefined) {
          errors.push(
            `No phasePlanPaths entry for phase ${phaseId}; plan not written`,
          );
        } else {
          const target = resolvePath(projectPath, rel);
          try {
            await ensureDir(dirname(target));
            await writeFile(target, JSON.stringify(parsed, null, 2), "utf-8");
            planPathWritten = rel;
          } catch (err) {
            errors.push(
              `Failed to write phase plan ${phaseId} to ${target}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
    }

    operations.push({
      route: "phase-update",
      affectedPhases: [phaseId],
      noteIds,
      planPathWritten,
    });
  }

  const rewriteCount = operations.filter((op) => op.planPathWritten !== "").length;

  let status: ReconcileStatus;
  if (operations.length === 0 && deferredNotes.length === 0 && errors.length === 0) {
    status = "no-op";
  } else if (errors.length > 0 && (operations.length > 0 || deferredNotes.length > 0)) {
    // Nit 11 — some work succeeded, some failed.
    status = "partial";
  } else if (errors.length > 0) {
    // Nothing succeeded at all.
    status = "partial";
  } else {
    status = "success";
  }

  const output: ReconcileOutput = {
    status,
    operations,
    deferredNotes,
    conflicts,
    rewriteCount,
    timestamp: new Date().toISOString(),
    ...(errors.length > 0 ? { errors } : {}),
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf-8");

  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    isError: errors.length > 0,
  };
}
