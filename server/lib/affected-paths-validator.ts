/**
 * affected-paths-validator.ts — server-side validator that runs at plan
 * persistence time. Closes the v0.38.0 B1 audit finding: monday-bot's
 * `affectedPaths` carried a leading `monday-bot/` project-name prefix that
 * silently broke grounding because the vocab builder couldn't resolve any
 * files.
 *
 * Strategy:
 *   - For each story's `affectedPaths`, probe each entry via
 *     `pathExistsInRepo`.
 *   - On miss, attempt `tryStripProjectNamePrefix`. If the stripped form
 *     resolves, auto-correct in place AND record a `pathCorrection` for the
 *     response.
 *   - On miss with no correction available, record an `unresolvable` entry.
 *     The caller decides whether to throw (strict) or include in the response
 *     as a warning (current default).
 *
 * Returns a NEW plan object with corrected paths — never mutates the input.
 *
 * Skips validation entirely when no `projectPath` is supplied (callers that
 * plan without codebase awareness can't validate paths against a repo).
 */
import type { ExecutionPlan } from "../types/execution-plan.js";
import {
  pathExistsInRepo,
  tryStripProjectNamePrefix,
} from "./path-resolver.js";

export interface PathCorrection {
  storyId: string;
  from: string;
  to: string;
}

export interface PathUnresolvable {
  storyId: string;
  path: string;
}

export interface AffectedPathsValidationResult {
  /** Plan with `affectedPaths` rewritten on each correction. New object. */
  plan: ExecutionPlan;
  /** Auto-stripped prefix corrections (B1 happy path). */
  pathCorrections: PathCorrection[];
  /** Paths that didn't resolve and couldn't be auto-corrected. */
  pathUnresolvable: PathUnresolvable[];
}

/**
 * Validate every `affectedPaths` entry on every story in `plan` against the
 * `projectPath` repo. Auto-correct project-name-prefix typos when possible.
 *
 * Pure: returns a new plan object; does not mutate input.
 *
 * When `projectPath` is undefined, returns `{plan, pathCorrections: [],
 * pathUnresolvable: []}` unchanged — the validator is a no-op without a repo
 * to probe.
 */
export function validateAffectedPaths(
  plan: ExecutionPlan,
  projectPath: string | undefined,
): AffectedPathsValidationResult {
  if (!projectPath) {
    return { plan, pathCorrections: [], pathUnresolvable: [] };
  }

  const pathCorrections: PathCorrection[] = [];
  const pathUnresolvable: PathUnresolvable[] = [];
  let anyChange = false;

  const newStories = plan.stories.map((story) => {
    if (!story.affectedPaths || story.affectedPaths.length === 0) {
      return story;
    }
    const newPaths: string[] = [];
    let storyChanged = false;
    for (const p of story.affectedPaths) {
      if (pathExistsInRepo(projectPath, p)) {
        newPaths.push(p);
        continue;
      }
      // Try the project-name-prefix strip.
      const stripped = tryStripProjectNamePrefix(projectPath, p);
      if (stripped) {
        pathCorrections.push({
          storyId: story.id,
          from: p,
          to: stripped.corrected,
        });
        newPaths.push(stripped.corrected);
        storyChanged = true;
        continue;
      }
      // Unresolvable — keep original (so the spec-generator's no-vocabulary
      // warning still fires) and record for the response.
      pathUnresolvable.push({ storyId: story.id, path: p });
      newPaths.push(p);
    }
    if (!storyChanged) return story;
    anyChange = true;
    return { ...story, affectedPaths: newPaths };
  });

  const newPlan: ExecutionPlan = anyChange ? { ...plan, stories: newStories } : plan;
  return { plan: newPlan, pathCorrections, pathUnresolvable };
}
