/**
 * v0.40.2 AC-3b — `forge_declare_story` wakes the dashboard render loop.
 *
 * Gate predicate: in an empty cwd (no `.forge/` state) the loop must be
 * dormant at t=0 (no dashboard.html). After a `forge_declare_story` call
 * via the live MCP transport (StdioClientTransport), the loop must come
 * up and produce `<cwd>/.forge/dashboard.html` within one tick.
 *
 * The SDK transport is non-negotiable per the plan's P59 / F47 reasoning
 * — hand-rolled JSON-RPC framing was rejected because it pretends to test
 * the wire format without actually exercising it.
 *
 * Modeled on `server/smoke/mcp-surface.test.ts`, the existing live-transport
 * smoke test that ships in this repo.
 *
 * Pre-requisite: the MCP server's render-loop interval must NOT be the
 * production [15_000, 30_000] ms. We pass `FORGE_LOOP_FAST_INTERVAL_MS`
 * — but the production loop module does not honor that env var by design,
 * so the test waits 35s (one production tick at 30s + jitter slack). This
 * matches the AC-3b plan body's `setTimeout(35_000)` and keeps the test
 * exercising the real production cadence rather than a fast-test seam.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function main(): Promise<void> {
  const T = mkdtempSync(join(tmpdir(), "ac3b-"));
  const serverPath = resolve(process.cwd(), "dist", "index.js");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: T,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "ac3b", version: "0.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  // Pre-call dormancy assertion (P4 finding): prove the AC name's premise —
  // "empty cwd, then declare_story" — by confirming the dashboard is absent
  // BEFORE the wake signal. Without this, a regression that re-enables the
  // unconditional loop would pass AC-3b because the loop would render
  // regardless of the declare_story call.
  if (existsSync(join(T, ".forge/dashboard.html"))) {
    throw new Error("AC-3b FAIL: dashboard exists pre-wake (loop is not dormant)");
  }

  await client.callTool({
    name: "forge_declare_story",
    arguments: { storyId: "US-AC3B" },
  });

  // Wait > 30s for the next tick after the wake signal.
  await new Promise((r) => setTimeout(r, 35_000));

  await client.close();

  if (!existsSync(join(T, ".forge/dashboard.html"))) {
    throw new Error("AC-3b FAIL: dashboard not rendered after declare_story");
  }
  if (statSync(join(T, ".forge/dashboard.html")).size < 1024) {
    throw new Error("AC-3b FAIL: dashboard < 1KB (likely error stub)");
  }

  console.log("AC-3b PASS: dashboard rendered after forge_declare_story wake");

  // Best-effort cleanup of the temp dir.
  try {
    rmSync(T, { recursive: true, force: true });
  } catch {
    // ignore — OS will reap eventually
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
