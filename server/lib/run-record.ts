import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * A run record captures metrics from a single forge primitive invocation.
 * Written to `.forge/runs/` for self-improvement analytics across runs.
 */
export interface RunRecord {
  timestamp: string;
  tool: "forge_plan" | "forge_evaluate" | "forge_generate" | "forge_coordinate";
  documentTier: "master" | "phase" | "update" | null;
  mode: "feature" | "bugfix" | "full-project" | null;
  tier: "quick" | "standard" | "thorough" | null;
  metrics: {
    inputTokens: number;
    outputTokens: number;
    critiqueRounds: number;
    findingsTotal: number;
    findingsApplied: number;
    findingsRejected: number;
    validationRetries: number;
    durationMs: number;
  };
  outcome: "success" | "validation-failure" | "api-error" | "timeout";
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
