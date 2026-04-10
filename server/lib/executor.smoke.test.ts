/**
 * Integration smoke test for executor.ts — runs REAL child_process.exec
 * with NO mocks. Designed specifically to catch F-05 (Windows spawn bash
 * ENOENT) which the heavily-mocked executor.test.ts could not surface
 * because every prior test asserted "we passed shell: 'bash' to exec()"
 * (intent) instead of "exec() actually spawned a shell and ran a command"
 * (outcome).
 *
 * This file MUST NOT mock node:child_process, node:os, or node:fs.
 * If you find yourself adding mocks here, create a new file instead.
 *
 * The integration tests run on every platform in CI (ubuntu-latest +
 * windows-latest, both already in .github/workflows/ci.yml). On Windows,
 * the bash resolver path is exercised end-to-end. On Unix, the default
 * shell path is exercised end-to-end.
 */
import { describe, it, expect } from "vitest";
import { executeCommand } from "./executor.js";

describe("executor integration smoke (real exec, no mocks) — F-05 regression guard", () => {
  it("runs `echo` end-to-end and returns PASS with the echoed output", async () => {
    const result = await executeCommand("echo forge-smoke-ok", {});

    // The cryptic F-05 failure mode was: status=INCONCLUSIVE,
    // evidence="Command execution failed: spawn bash ENOENT". This
    // assertion would have flipped red on the broken Windows code path.
    expect(result.status).toBe("PASS");
    expect(result.evidence).toContain("forge-smoke-ok");
  });

  it("runs a bash-syntax command end-to-end (test -f && echo)", async () => {
    // This exercises the bash-wrapping behavior on Windows: `test -f`
    // and `&&` are bash-isms that would fail under cmd.exe but work
    // under any real bash invocation. On Unix it runs through the
    // default shell. On Windows it runs through the resolved Git Bash.
    // package.json is guaranteed to exist at the project root (cwd).
    const result = await executeCommand(
      "test -f package.json && echo file-exists",
      {},
    );

    expect(result.status).toBe("PASS");
    expect(result.evidence).toContain("file-exists");
  });

  it("returns FAIL (not INCONCLUSIVE) for a real non-zero exit code", async () => {
    // F-05 muddied the FAIL/INCONCLUSIVE distinction because every command
    // returned INCONCLUSIVE before even running. This test asserts the
    // verdict pipeline distinguishes "command ran and exited 1" (FAIL)
    // from "command could not be spawned" (INCONCLUSIVE).
    const result = await executeCommand("exit 1", {});

    expect(result.status).toBe("FAIL");
  });
});
