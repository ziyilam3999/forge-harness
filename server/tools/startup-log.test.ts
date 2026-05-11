/**
 * v0.43.0 — AC-15 startup-log assertion.
 *
 * The MCP server emits ONE stderr line at module-load time describing which
 * spec-gen path is active. We spawn `node dist/index.js` with each env
 * config and capture stderr to assert the expected log line is present.
 *
 * Runs against the built `dist/` artefact — same path as the existing
 * `server/smoke/mcp-surface.test.ts` smoke. The CI build hook re-runs
 * `npm run build` before tests, so `dist/` is fresh.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const SERVER_PATH = resolve(process.cwd(), "dist", "index.js");
const STARTUP_TIMEOUT_MS = 5000;

/**
 * Spawn the MCP server with the given env, capture stderr until either the
 * `forge-harness: spec-gen via` line appears OR the timeout fires, then
 * terminate the child and return the captured stderr.
 */
function spawnAndCaptureStartupStderr(
  env: Record<string, string | undefined>,
): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let captured = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolveP(captured);
    }, STARTUP_TIMEOUT_MS);
    child.stderr.on("data", (chunk: Buffer) => {
      captured += chunk.toString("utf-8");
      // As soon as we see the marker, terminate — no point waiting longer.
      if (
        captured.includes("forge-harness: spec-gen via")
      ) {
        clearTimeout(timer);
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        resolveP(captured);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectP(err);
    });
  });
}

describe("v0.43.0 AC-15 — startup log", () => {
  it("default-on path (env unset) logs the caller-action directive line to stderr", async () => {
    const stderr = await spawnAndCaptureStartupStderr({
      FORGE_SPEC_CALLER_ACTION: undefined,
    });
    expect(stderr).toContain(
      "forge-harness: spec-gen via caller-action directive enabled (default since v0.43.0); opt back with FORGE_SPEC_CALLER_ACTION=0",
    );
  }, STARTUP_TIMEOUT_MS + 2000);

  it("legacy opt-out (FORGE_SPEC_CALLER_ACTION=0) logs the legacy in-MCP-synth line to stderr", async () => {
    const stderr = await spawnAndCaptureStartupStderr({
      FORGE_SPEC_CALLER_ACTION: "0",
    });
    expect(stderr).toContain(
      "forge-harness: spec-gen via legacy in-MCP synth (FORGE_SPEC_CALLER_ACTION=0)",
    );
  }, STARTUP_TIMEOUT_MS + 2000);
});
