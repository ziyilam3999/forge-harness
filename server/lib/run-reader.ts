import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunRecord } from "./run-record.js";

// ── Tagged union types ──────────────────────────────────────

export interface GeneratorIterationRecord {
  timestamp: string;
  storyId: string;
  iteration: number;
  action: string;
  score: number | null;
  durationMs: number;
}

export interface PrimaryRecord {
  source: "primary";
  record: RunRecord;
}

export interface GeneratorRecord {
  source: "generator";
  record: GeneratorIterationRecord;
}

export type TaggedRunRecord = PrimaryRecord | GeneratorRecord;

// ── Validation helpers ──────────────────────────────────────

function isPrimaryRecord(data: unknown): data is RunRecord {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.timestamp === "string" &&
    typeof obj.tool === "string" &&
    typeof obj.metrics === "object" &&
    obj.metrics !== null &&
    typeof obj.outcome === "string"
  );
}

function isGeneratorRecord(data: unknown): data is GeneratorIterationRecord {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.timestamp === "string" &&
    typeof obj.storyId === "string" &&
    typeof obj.iteration === "number" &&
    typeof obj.action === "string"
  );
}

function getTimestamp(entry: TaggedRunRecord): string {
  return entry.record.timestamp;
}

// ── Reader ──────────────────────────────────────────────────

async function readPrimaryRecords(runsDir: string): Promise<PrimaryRecord[]> {
  const results: PrimaryRecord[] = [];

  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    if (code === "EACCES" || code === "EPERM") {
      console.error(`forge: permission denied reading ${runsDir} (skipping)`);
      return [];
    }
    throw err;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(runsDir, file), "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (isPrimaryRecord(parsed)) {
        results.push({ source: "primary", record: parsed });
      } else {
        console.error(`forge: schema mismatch in ${file} (skipping)`);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        console.error(`forge: permission denied reading ${file} (skipping)`);
      } else {
        console.error(`forge: corrupt JSON in ${file} (skipping)`);
      }
    }
  }

  return results;
}

async function readGeneratorRecords(runsDir: string): Promise<GeneratorRecord[]> {
  const results: GeneratorRecord[] = [];
  const jsonlPath = join(runsDir, "data.jsonl");

  let content: string;
  try {
    content = await readFile(jsonlPath, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    if (code === "EACCES" || code === "EPERM") {
      console.error(`forge: permission denied reading data.jsonl (skipping)`);
      return [];
    }
    throw err;
  }

  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isGeneratorRecord(parsed)) {
        results.push({ source: "generator", record: parsed });
      } else {
        console.error("forge: schema mismatch in data.jsonl line (skipping)");
      }
    } catch {
      console.error("forge: truncated JSONL line in data.jsonl (skipping)");
    }
  }

  return results;
}

/**
 * Read all run records from `.forge/runs/` and return them as a tagged
 * discriminated union sorted by timestamp ascending.
 *
 * Gracefully handles: missing directories, corrupt JSON, truncated JSONL,
 * schema mismatches, and permission errors (logs and skips).
 */
export async function readRunRecords(projectPath: string): Promise<ReadonlyArray<TaggedRunRecord>> {
  const runsDir = join(projectPath, ".forge", "runs");

  const [primary, generator] = await Promise.all([
    readPrimaryRecords(runsDir),
    readGeneratorRecords(runsDir),
  ]);

  const all: TaggedRunRecord[] = [...primary, ...generator];
  all.sort((a, b) => getTimestamp(a).localeCompare(getTimestamp(b)));

  return all;
}

/**
 * Placeholder for audit log reader (full implementation in PH-03 US-03 per REQ-11).
 */
export async function readAuditEntries(_projectPath: string): Promise<ReadonlyArray<unknown>> {
  return [];
}
