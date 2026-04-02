import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:os", () => ({
  platform: vi.fn(() => "linux"),
}));

import { exec } from "node:child_process";
import { platform } from "node:os";
import { executeCommand } from "./executor.js";

const mockedExec = vi.mocked(exec);
const mockedPlatform = vi.mocked(platform);

function simulateExec(
  error: Error | null,
  stdout: string,
  stderr: string,
) {
  mockedExec.mockImplementationOnce((_cmd, _opts, callback) => {
    (callback as Function)(error, stdout, stderr);
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

  it("uses bash shell on Windows", async () => {
    mockedPlatform.mockReturnValue("win32" as ReturnType<typeof platform>);
    simulateExec(null, "", "");
    await executeCommand("echo test", {});
    expect(mockedExec).toHaveBeenCalledWith(
      "echo test",
      expect.objectContaining({ shell: "bash" }),
      expect.any(Function),
    );
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
