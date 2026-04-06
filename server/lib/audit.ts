/**
 * AuditLog — append-only decision trail for agent actions.
 *
 * Persists to `.forge/audit/{tool}-{timestamp}.jsonl` (Windows-safe, no colons).
 * Failure policy: warn and continue, never crash the tool.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

export interface AuditEntry {
  timestamp: string;
  stage: string;
  agentRole: string;
  decision: string;
  reasoning: string;
}

/** Warning threshold for audit file count. */
const FILE_COUNT_WARNING_THRESHOLD = 1000;

export class AuditLog {
  private toolName: string;
  private projectPath: string | null;
  private filePath: string | null = null;
  private initialized = false;

  constructor(toolName: string, projectPath?: string) {
    this.toolName = toolName;
    this.projectPath = projectPath ?? null;
  }

  /**
   * Initialize the audit log file. Creates the directory if needed.
   * Returns false if initialization fails (no projectPath, permission error, etc.).
   */
  private async init(): Promise<boolean> {
    if (this.initialized) return this.filePath !== null;
    this.initialized = true;

    if (!this.projectPath) return false;

    try {
      const auditDir = join(this.projectPath, ".forge", "audit");
      await mkdir(auditDir, { recursive: true });

      // Windows-safe timestamp: replace colons and dots
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.filePath = join(auditDir, `${this.toolName}-${safeTimestamp}.jsonl`);

      // Check file count and warn if approaching threshold
      await this.checkFileCount(auditDir);

      return true;
    } catch (err) {
      console.error(
        "forge: failed to initialize audit log (continuing):",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  private async checkFileCount(auditDir: string): Promise<void> {
    try {
      const files = await readdir(auditDir);
      if (files.length >= FILE_COUNT_WARNING_THRESHOLD) {
        console.error(
          `forge: audit directory has ${files.length} files (~${Math.round(files.length * 2)}KB). ` +
          `Consider archiving old files: rm .forge/audit/*-2025-*`,
        );
      }
    } catch {
      // Non-critical — skip count check
    }
  }

  /**
   * Log an audit entry. Failures are swallowed with a warning.
   */
  async log(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
    const ready = await this.init();
    if (!ready || !this.filePath) return;

    try {
      const fullEntry: AuditEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };
      await appendFile(this.filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
    } catch (err) {
      console.error(
        "forge: failed to write audit entry (continuing):",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Get the audit file path (null if not initialized or no projectPath). */
  getFilePath(): string | null {
    return this.filePath;
  }
}
