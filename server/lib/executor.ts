import { exec, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import type { CriterionResult } from "../types/eval-report.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const EVIDENCE_CHAR_CAP = 4_000;

/**
 * Cached resolved bash.exe absolute path on Windows. Resolution is expensive
 * (calls `where bash` + multiple stat checks) so we cache the first success.
 * Failures are NOT cached so a user can install Git Bash and retry without
 * restarting the MCP server. F-05 dogfood fix.
 */
let cachedWindowsBashPath: string | undefined;

const WINDOWS_BASH_FALLBACK_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

/**
 * Resolve an absolute Windows path to bash.exe, throwing a clear actionable
 * error if none can be found. Resolution order:
 *   1. FORGE_BASH_PATH environment variable (escape hatch for non-standard installs)
 *   2. `where bash` (Windows-native PATH lookup; finds Git Bash if installed via the official installer)
 *   3. Common Git for Windows install paths
 *
 * F-05 root cause: passing `shell: "bash"` to child_process.exec on Windows
 * fails with `spawn bash ENOENT` because Node's spawn does NOT consult the
 * Windows PATH environment variable for bare executable names — it only
 * resolves absolute paths or `.exe`/`.cmd`/`.bat` names with extension.
 * Fix: resolve "bash" to its absolute path BEFORE passing to exec, using
 * Windows-native lookup mechanisms.
 *
 * Why not `shell: true`? Because that would interpret AC commands through
 * cmd.exe/PowerShell, breaking Unix-style commands (`grep`, `2>/dev/null`,
 * `\|` alternation) AND introducing shell-injection risk for any AC string
 * containing `$`, backticks, or other metacharacters.
 *
 * @internal — exported only for testing
 */
export function resolveWindowsBashPath(): string {
  if (cachedWindowsBashPath) return cachedWindowsBashPath;

  // 1. Explicit env var override
  const envPath = process.env.FORGE_BASH_PATH;
  if (envPath) {
    if (!existsSync(envPath)) {
      throw new Error(
        `forge_evaluate: FORGE_BASH_PATH is set to "${envPath}" but that file does not exist.`,
      );
    }
    cachedWindowsBashPath = envPath;
    return envPath;
  }

  // 2. `where bash` — Windows native PATH lookup
  try {
    const out = execSync("where bash", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0 && existsSync(s));
    if (first) {
      cachedWindowsBashPath = first;
      return first;
    }
  } catch {
    // `where` not available, returned non-zero, or all paths invalid — fall through
  }

  // 3. Common Git for Windows install paths
  for (const candidate of WINDOWS_BASH_FALLBACK_PATHS) {
    if (existsSync(candidate)) {
      cachedWindowsBashPath = candidate;
      return candidate;
    }
  }

  // 4. Loud failure with actionable next steps
  throw new Error(
    "forge_evaluate requires Git Bash on Windows but bash.exe was not found. " +
      "Searched: $FORGE_BASH_PATH (unset), `where bash` (no result), " +
      `${WINDOWS_BASH_FALLBACK_PATHS.join(", ")} (none exist). ` +
      "Install Git for Windows from https://git-scm.com/download/win " +
      "or set FORGE_BASH_PATH=<absolute path to bash.exe>.",
  );
}

/**
 * Reset the cached Windows bash path. Test-only — production callers must not
 * use this; the cache exists to amortize per-process resolution cost.
 *
 * @internal
 */
export function _resetWindowsBashPathCacheForTesting(): void {
  cachedWindowsBashPath = undefined;
}

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

  return new Promise<CriterionResult>((resolve, reject) => {
    let shellOption: { shell: string } | object = {};
    if (platform() === "win32") {
      try {
        shellOption = { shell: resolveWindowsBashPath() };
      } catch (err) {
        // F-05 fix: surface the resolver error as a rejection so the caller's
        // outer try/catch sees a single clear "Git Bash not installed" message
        // instead of N cryptic per-AC `spawn bash ENOENT` results.
        reject(err);
        return;
      }
    }

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
