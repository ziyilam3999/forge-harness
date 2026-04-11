import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { EvalReport, CriterionResult } from "../types/eval-report.js";

/**
 * A run record captures metrics from a single forge primitive invocation.
 * Written to `.forge/runs/` for self-improvement analytics across runs.
 *
 * REQ-01 v1.1 additive fields (storyId / evalVerdict / evalReport /
 * metrics.estimatedCostUsd) are optional — old records without them remain
 * valid (P50 additive, no schema version bump).
 */
export interface RunRecord {
  timestamp: string;
  tool: "forge_plan" | "forge_evaluate" | "forge_generate" | "forge_coordinate";
  documentTier: "master" | "phase" | "update" | null;
  mode: "feature" | "bugfix" | "full-project" | null;
  tier: "quick" | "standard" | "thorough" | null;
  storyId?: string;
  evalVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  escalationReason?: string;
  evalReport?: EvalReport;
  metrics: {
    inputTokens: number;
    outputTokens: number;
    critiqueRounds: number;
    findingsTotal: number;
    findingsApplied: number;
    findingsRejected: number;
    validationRetries: number;
    durationMs: number;
    estimatedCostUsd?: number | null;
  };
  outcome: "success" | "validation-failure" | "api-error" | "timeout";
}

/**
 * Canonicalize an EvalReport for deterministic serialization (REQ-01 v1.1).
 *
 * Sorts `criteria` by `(id, evidence)` lexicographically so two reports with
 * the same criteria in different input orders produce byte-identical JSON
 * output. Preserves NFR-C02 (deterministic dispatch) and NFR-C10 (golden-file
 * byte-identity) preconditions.
 *
 * Note: the PRD/phase-plan wording refers to `EvalReport.findings` sorted by
 * `(failedAcId, description)`, but the actual `EvalReport` shape exposes
 * `criteria: CriterionResult[]` with `{id, status, evidence}`. This helper
 * adapts the spec to the real type — sort-by-id-then-evidence is the direct
 * analog of sort-by-failedAcId-then-description.
 */
export function canonicalizeEvalReport(report: EvalReport): EvalReport {
  const sortedCriteria: CriterionResult[] = [...report.criteria].sort((a, b) => {
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    if (a.evidence !== b.evidence) return a.evidence < b.evidence ? -1 : 1;
    return 0;
  });
  return { ...report, criteria: sortedCriteria };
}

/**
 * Generate a Windows-safe filename for a run record.
 * Format: {tool}-{timestamp}-{suffix}.json
 * The 4-char hex suffix handles same-millisecond collisions.
 */
function makeRunFilename(tool: string, timestamp: string): string {
  const safeDateStr = timestamp.replace(/[:.]/g, "-");
  const suffix = randomBytes(2).toString("hex");
  return `${tool}-${safeDateStr}-${suffix}.json`;
}

/**
 * Write a run record to `.forge/runs/`. Creates the directory if needed.
 * Failure is logged and swallowed — never crashes the tool.
 *
 * CANONICAL: this is the RunRecord writer used by forge_plan, forge_evaluate,
 * and (future) forge_coordinate. One JSON file per invocation, schema defined
 * by the `RunRecord` interface above (includes `tool`, `metrics`, etc.).
 *
 * Not to be confused with `appendGeneratorIterationRecord` in
 * `./generator.ts`, which is the separate JSONL iteration-stream writer used
 * internally by forge_generate for per-iteration self-tracking (different
 * schema, different file: `.forge/runs/data.jsonl`).
 */
export async function writeRunRecord(
  projectPath: string,
  record: RunRecord,
): Promise<void> {
  try {
    const runsDir = join(projectPath, ".forge", "runs");
    await mkdir(runsDir, { recursive: true });

    const filename = makeRunFilename(record.tool, record.timestamp);
    const filePath = join(runsDir, filename);

    await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
  } catch (err) {
    console.error(
      "forge: failed to write run record (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
