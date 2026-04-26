/**
 * path-resolver.ts — shared helpers for resolving `affectedPaths` against a
 * project root. Extracted from `spec-source-vocabulary.ts` so the same logic
 * can be reused by:
 *   1. The vocab builder (existing — `resolveAffectedFiles`).
 *   2. The plan-pipeline validator (v0.38.0 B1 fix — strip project-name prefix).
 *   3. The dashboard renderer (v0.38.0 I2 — per-path ✓/✗ existence indicator).
 *
 * Three copies of path-check logic was the divergence risk B1 was rooted in.
 * Centralising here so the planner-side strip and the dashboard-side check
 * agree on what "exists" means.
 */
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";

/**
 * Does `relativePath` resolve to an existing file or directory under
 * `projectPath`? Returns false on any I/O error (existsSync swallows EACCES,
 * EPERM internally and returns false anyway).
 *
 * Edge cases:
 *   - Empty relativePath → resolves to projectPath itself, which exists →
 *     returns true. Callers should validate non-empty before calling.
 *   - Absolute relativePath → `resolve` ignores `projectPath`. Callers should
 *     normalise to relative before calling.
 */
export function pathExistsInRepo(
  projectPath: string,
  relativePath: string,
): boolean {
  if (!relativePath) return false;
  return existsSync(resolve(projectPath, relativePath));
}

/**
 * Attempt to auto-correct a leading project-name prefix on `relativePath`.
 *
 * Heuristic: when `relativePath` starts with `<basename(projectPath)>/`, strip
 * the prefix and check whether the stripped form resolves under `projectPath`.
 *
 * Returns:
 *   - `{ corrected: <stripped form> }` when the strip yields a path that
 *     exists in the repo.
 *   - `null` when the prefix doesn't match, the strip leaves an empty path,
 *     or the stripped form still doesn't resolve.
 *
 * Does NOT mutate inputs. Caller decides whether to apply the correction.
 *
 * Example: `projectPath = /code/monday-bot`, `relativePath = "monday-bot/src/foo/"`.
 * basename = "monday-bot". Strip yields "src/foo/". If `<projectPath>/src/foo/`
 * exists → return `{ corrected: "src/foo/" }`. If not → return null.
 */
export function tryStripProjectNamePrefix(
  projectPath: string,
  relativePath: string,
): { corrected: string } | null {
  if (!relativePath) return null;
  const projectName = basename(projectPath);
  if (!projectName) return null;
  const prefix = `${projectName}/`;
  if (!relativePath.startsWith(prefix)) return null;
  const stripped = relativePath.slice(prefix.length);
  if (!stripped) return null;
  if (pathExistsInRepo(projectPath, stripped)) {
    return { corrected: stripped };
  }
  return null;
}
