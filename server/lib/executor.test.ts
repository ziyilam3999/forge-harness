import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  platform: vi.fn(() => "linux"),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

import { exec, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import {
  executeCommand,
  resolveWindowsBashPath,
  _resetWindowsBashPathCacheForTesting,
} from "./executor.js";

const mockedExec = vi.mocked(exec);
const mockedExecSync = vi.mocked(execSync);
const mockedPlatform = vi.mocked(platform);
const mockedExistsSync = vi.mocked(existsSync);

function simulateExec(
  error: Error | null,
  stdout: string,
  stderr: string,
) {
  mockedExec.mockImplementationOnce((_cmd, _opts, callback) => {
    (callback as (err: Error | null, stdout: string, stderr: string) => void)(
      error,
      stdout,
      stderr,
    );
    return {} as ReturnType<typeof exec>;
  });
}

describe("executeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPlatform.mockReturnValue("linux" as ReturnType<typeof platform>);
  });

  it("returns PASS for exit code 0", async () => {
    simulateExec(null, "hello", "");
    const result = await executeCommand("echo hello", {});
    expect(result.status).toBe("PASS");
    expect(result.evidence).toBe("hello");
  });

  it("returns PASS with empty evidence for silent commands", async () => {
    simulateExec(null, "", "");
    const result = await executeCommand("true", {});
    expect(result.status).toBe("PASS");
    expect(result.evidence).toBe("");
  });

  it("includes stderr in evidence for PASS results", async () => {
    simulateExec(null, "output", "warning");
    const result = await executeCommand("cmd", {});
    expect(result.status).toBe("PASS");
    expect(result.evidence).toBe("output\nwarning");
  });

  it("returns FAIL for non-zero exit code", async () => {
    const error = Object.assign(new Error("exit 1"), { code: 1 });
    simulateExec(error, "", "error output");
    const result = await executeCommand("exit 1", {});
    expect(result.status).toBe("FAIL");
    expect(result.evidence).toBe("error output");
  });

  it("returns FAIL for timeout (error.killed = true)", async () => {
    const error = Object.assign(new Error("killed"), { killed: true, code: null });
    simulateExec(error, "", "");
    const result = await executeCommand("sleep 30", { timeoutMs: 1000 });
    expect(result.status).toBe("FAIL");
    expect(result.evidence).toContain("timeout");
    expect(result.evidence).toContain("1000");
  });

  it("returns INCONCLUSIVE for ENOENT (binary not found)", async () => {
    const error = Object.assign(new Error("not found"), { code: "ENOENT" });
    simulateExec(error, "", "");
    const result = await executeCommand("nonexistent_binary", {});
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.evidence).toContain("execution failed");
  });

  it("returns INCONCLUSIVE for signal-killed process (fallback)", async () => {
    const error = Object.assign(new Error("signal"), {
      code: null,
      killed: false,
      signal: "SIGTERM",
    });
    simulateExec(error, "", "");
    const result = await executeCommand("cmd", {});
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.evidence).toContain("execution failed");
  });

  it("truncates evidence exceeding 4000 characters", async () => {
    const longOutput = "x".repeat(5000);
    simulateExec(null, longOutput, "");
    const result = await executeCommand("cmd", {});
    expect(result.status).toBe("PASS");
    expect(result.evidence.length).toBeLessThanOrEqual(4000 + "[truncated] ".length);
    expect(result.evidence).toContain("[truncated]");
  });

  it("uses resolved absolute bash path on Windows (F-05 fix)", async () => {
    // Pre-fix: passed `shell: "bash"` literal which Node's spawn cannot
    // resolve on Windows -> spawn bash ENOENT on every AC.
    // Post-fix: resolves to an absolute path via FORGE_BASH_PATH / `where bash`
    // / common Git Bash install paths.
    _resetWindowsBashPathCacheForTesting();
    mockedPlatform.mockReturnValue("win32" as ReturnType<typeof platform>);
    process.env.FORGE_BASH_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockedExistsSync.mockReturnValue(true);
    simulateExec(null, "", "");

    await executeCommand("echo test", {});

    expect(mockedExec).toHaveBeenCalledWith(
      "echo test",
      expect.objectContaining({
        shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      }),
      expect.any(Function),
    );

    delete process.env.FORGE_BASH_PATH;
    _resetWindowsBashPathCacheForTesting();
  });

  it("rejects with actionable error on Windows when bash cannot be resolved (F-05)", async () => {
    _resetWindowsBashPathCacheForTesting();
    mockedPlatform.mockReturnValue("win32" as ReturnType<typeof platform>);
    delete process.env.FORGE_BASH_PATH;
    mockedExistsSync.mockReturnValue(false);
    mockedExecSync.mockImplementation(() => {
      throw new Error("where: command failed");
    });

    await expect(executeCommand("echo test", {})).rejects.toThrow(
      /requires Git Bash on Windows.*FORGE_BASH_PATH/s,
    );
    // Critical: ensure the failure is loud (one rejection) NOT silent
    // (every AC returning INCONCLUSIVE with "spawn bash ENOENT").
    expect(mockedExec).not.toHaveBeenCalled();

    _resetWindowsBashPathCacheForTesting();
  });

  it("does not force bash shell on Linux", async () => {
    mockedPlatform.mockReturnValue("linux" as ReturnType<typeof platform>);
    simulateExec(null, "", "");
    await executeCommand("echo test", {});
    expect(mockedExec).toHaveBeenCalledWith(
      "echo test",
      expect.not.objectContaining({ shell: "bash" }),
      expect.any(Function),
    );
  });

  it("passes cwd and timeout options to exec", async () => {
    simulateExec(null, "", "");
    await executeCommand("cmd", { timeoutMs: 5000, cwd: "/tmp" });
    expect(mockedExec).toHaveBeenCalledWith(
      "cmd",
      expect.objectContaining({ timeout: 5000, cwd: "/tmp" }),
      expect.any(Function),
    );
  });

  it("concatenates stdout and stderr with newline", async () => {
    simulateExec(null, "out", "err");
    const result = await executeCommand("cmd", {});
    expect(result.evidence).toBe("out\nerr");
  });

  it("omits empty streams from evidence", async () => {
    simulateExec(null, "output", "");
    const result = await executeCommand("cmd", {});
    expect(result.evidence).toBe("output");
  });
});

describe("resolveWindowsBashPath (F-05 dogfood fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetWindowsBashPathCacheForTesting();
    delete process.env.FORGE_BASH_PATH;
  });

  afterEach(() => {
    delete process.env.FORGE_BASH_PATH;
    _resetWindowsBashPathCacheForTesting();
  });

  it("returns FORGE_BASH_PATH when env var is set and file exists", () => {
    process.env.FORGE_BASH_PATH = "D:\\msys64\\usr\\bin\\bash.exe";
    mockedExistsSync.mockImplementation(
      (p) => p === "D:\\msys64\\usr\\bin\\bash.exe",
    );

    expect(resolveWindowsBashPath()).toBe("D:\\msys64\\usr\\bin\\bash.exe");
    expect(mockedExecSync).not.toHaveBeenCalled(); // env var short-circuits `where`
  });

  it("throws if FORGE_BASH_PATH points at a non-existent file", () => {
    process.env.FORGE_BASH_PATH = "Z:\\does\\not\\exist\\bash.exe";
    mockedExistsSync.mockReturnValue(false);

    expect(() => resolveWindowsBashPath()).toThrow(
      /FORGE_BASH_PATH is set.*does not exist/,
    );
  });

  it("falls back to `where bash` when FORGE_BASH_PATH is unset", () => {
    mockedExecSync.mockReturnValue(
      "C:\\Program Files\\Git\\bin\\bash.exe\r\nC:\\Windows\\System32\\bash.exe\r\n",
    );
    mockedExistsSync.mockImplementation(
      (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe",
    );

    expect(resolveWindowsBashPath()).toBe(
      "C:\\Program Files\\Git\\bin\\bash.exe",
    );
    expect(mockedExecSync).toHaveBeenCalledWith(
      "where bash",
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("falls back to common Git Bash install paths when `where bash` fails", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("'where' is not recognized");
    });
    mockedExistsSync.mockImplementation(
      (p) => p === "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    );

    expect(resolveWindowsBashPath()).toBe(
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    );
  });

  it("throws actionable error when no resolution strategy succeeds", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    mockedExistsSync.mockReturnValue(false);

    expect(() => resolveWindowsBashPath()).toThrow(
      /requires Git Bash on Windows.*git-scm\.com\/download\/win.*FORGE_BASH_PATH/s,
    );
  });

  it("caches the first successful resolution (idempotent across calls)", () => {
    process.env.FORGE_BASH_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockedExistsSync.mockReturnValue(true);

    const first = resolveWindowsBashPath();
    delete process.env.FORGE_BASH_PATH;
    mockedExistsSync.mockReturnValue(false);
    const second = resolveWindowsBashPath();

    expect(second).toBe(first);
  });
});
