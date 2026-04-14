/**
 * Q0.5/A3-bis — Lint-exemption audit persistence.
 *
 * Read/write helpers for `.ai-workspace/lint-audit/{planSlug}.audit.json`.
 * Pure over (projectPath, planPath, fs, now) so tests can drive it against
 * a tmp dir.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

import type { LintAuditEntry } from "../types/lint-audit.js";

const FOURTEEN_DAYS_MS = 14 * 86_400 * 1_000;

/**
 * Stable identifier for a plan file: `{parentDirName}__{basename-without-md}`.
 * Collision-resistant across sibling dirs (e.g., `phases/phase-01.md` vs
 * `archive/phase-01.md`).
 */
export function computePlanSlug(planPath: string): string {
  const parsed = parse(planPath);
  const parent = parse(parsed.dir).base;
  return `${parent}__${parsed.name}`;
}

function auditFilePath(projectPath: string, planPath: string): string {
  return join(
    projectPath,
    ".ai-workspace",
    "lint-audit",
    `${computePlanSlug(planPath)}.audit.json`,
  );
}

/**
 * Read the audit entry for a plan. Returns `null` when the file does not
 * exist (absent baseline = drift, per AC-bis-06). Re-throws on other IO or
 * JSON-parse errors so the caller's non-fatal wrapper can surface them.
 */
export async function loadAudit(
  projectPath: string,
  planPath: string,
): Promise<LintAuditEntry | null> {
  const path = auditFilePath(projectPath, planPath);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as LintAuditEntry;
}

/**
 * Write an audit entry. Creates `.ai-workspace/lint-audit/` if missing.
 */
export async function writeAudit(
  projectPath: string,
  entry: LintAuditEntry,
): Promise<void> {
  const path = auditFilePath(projectPath, entry.planPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entry, null, 2) + "\n", "utf-8");
}

/**
 * Determine whether an audit entry is stale against the current rule surface.
 *
 * Precedence: hash drift beats calendar — if rules changed we always
 * re-review, regardless of how recent the last audit was.
 *
 * Returns `null` when fresh.
 */
export function isStale(
  entry: LintAuditEntry,
  currentHash: string,
  now: Date,
): "rule-change" | "14d-elapsed" | null {
  if (entry.ruleHash !== currentHash) return "rule-change";
  const ageMs = now.getTime() - new Date(entry.lastAuditedAt).getTime();
  if (ageMs > FOURTEEN_DAYS_MS) return "14d-elapsed";
  return null;
}
