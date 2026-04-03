import { exec } from "node:child_process";
import { platform } from "node:os";
import type { CriterionResult } from "../types/eval-report.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const EVIDENCE_CHAR_CAP = 4_000;

export interface ExecuteOptions {
  timeoutMs?: number;
  cwd?: string;
  maxBuffer?: number;
}

function truncateEvidence(evidence: string): string {
  if (evidence.length <= EVIDENCE_CHAR_CAP) {
    return evidence;
  }
  return "[truncated] " + evidence.slice(-EVIDENCE_CHAR_CAP);
}

function buildEvidence(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  return truncateEvidence(combined);
}

/**
 * Execute a shell command and return a CriterionResult.
 *
 * Uses child_process.exec with shell string execution.
 * On Windows, forces { shell: 'bash' } for Unix-style AC commands.
 */
export function executeCommand(
  command: string,
  options: ExecuteOptions,
): Promise<CriterionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const cwd = options.cwd ?? process.cwd();

  const shellOption = platform() === "win32" ? { shell: "bash" as const } : {};

  return new Promise<CriterionResult>((resolve) => {
    exec(
      command,
      {
        timeout: timeoutMs,
        maxBuffer,
        cwd,
        ...shellOption,
      },
      (error, stdout, stderr) => {
        const stdoutStr = String(stdout ?? "");
        const stderrStr = String(stderr ?? "");

        if (!error) {
          resolve({
            id: "",
            status: "PASS",
            evidence: buildEvidence(stdoutStr, stderrStr),
          });
          return;
        }

        // Timeout: error.killed is true when exec kills the process
        if (error.killed) {
          resolve({
            id: "",
            status: "FAIL",
            evidence: truncateEvidence(`Command timeout after ${timeoutMs}ms`),
          });
          return;
        }

        // Exec-level error: error.code is a string (e.g., 'ENOENT')
        if (typeof error.code === "string") {
          resolve({
            id: "",
            status: "INCONCLUSIVE",
            evidence: truncateEvidence(`Command execution failed: ${error.message}`),
          });
          return;
        }

        // Non-zero exit code: error.code is a number
        if (typeof error.code === "number") {
          resolve({
            id: "",
            status: "FAIL",
            evidence: buildEvidence(stdoutStr, stderrStr),
          });
          return;
        }

        // Fallback: signal-killed or unexpected error shape
        resolve({
          id: "",
          status: "INCONCLUSIVE",
          evidence: truncateEvidence(`Command execution failed: ${error.message}`),
        });
      },
    );
  });
}
