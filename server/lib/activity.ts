/**
 * Activity signal writer — ephemeral `.forge/activity.json` file.
 *
 * Captures "what is running right now": tool name, story id, current stage,
 * start + last-update timestamps. Consumed by the Kanban dashboard renderer
 * to populate the "In Progress" column (the derived 7th state that has no
 * StoryStatus value).
 *
 * Write semantics:
 *  - Atomic: write to `.forge/activity.tmp.json`, then rename to final path.
 *  - Idempotent directory bootstrap: `mkdir('.forge', { recursive: true })`.
 *  - Non-fatal failure policy: matches `writeRunRecord` and `AuditLog`.
 *    Any I/O error is logged to stderr and swallowed — never thrown.
 *
 * Clear semantics:
 *  - `writeActivity(projectPath, null)` writes `{ "tool": null }` to mark
 *    "nothing is running". Mirrors the post-`writeRunRecord` hook which
 *    signals the end of a primitive's lifecycle.
 */

import { writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface Activity {
  tool: string;
  storyId?: string;
  stage: string;
  startedAt: string;
  lastUpdate: string;
  label?: string;
  progress?: { current: number; total: number };
}

export type ActivityWrite = Activity | null;

function activityPaths(projectPath: string): { forgeDir: string; tmpPath: string; finalPath: string } {
  const forgeDir = join(projectPath, ".forge");
  return {
    forgeDir,
    tmpPath: join(forgeDir, "activity.tmp.json"),
    finalPath: join(forgeDir, "activity.json"),
  };
}

/**
 * Write (or clear) the activity signal. Pass `null` to signal "nothing
 * running" ({"tool": null}). Any failure is logged + swallowed.
 */
export async function writeActivity(projectPath: string, activity: ActivityWrite): Promise<void> {
  try {
    const { forgeDir, tmpPath, finalPath } = activityPaths(projectPath);
    await mkdir(forgeDir, { recursive: true });
    const payload = activity === null ? { tool: null } : activity;
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    await rename(tmpPath, finalPath);
  } catch (err) {
    console.error(
      "forge: failed to write activity signal (continuing):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
