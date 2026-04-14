/**
 * MCP surface smoke test.
 *
 * Spawns `node dist/index.js` as a subprocess, connects via the MCP stdio
 * client, and exercises the full transport stack end-to-end. Designed to
 * catch failure modes that vitest unit tests on `server/tools/*.ts` cannot
 * see by construction:
 *
 *   1. dist/ drift — dist/tools/*.js compiled from an older server/tools/*.ts
 *      than what is currently on disk. Symptom: client calls land on stub
 *      handlers that return "not yet implemented" strings.
 *   2. stdio framing / JSON-RPC serialization bugs in the transport glue.
 *   3. .mcp.json wiring mistakes (wrong command, wrong cwd, wrong entry).
 *
 * Incident driving this test: on 2026-04-09 a client Claude Code session
 * received Phase-0 "not yet implemented" stubs from forge_generate and
 * forge_plan despite server/tools/*.ts being fully implemented and unit-
 * tested — dist/ had not been rebuilt in ~2 days and no test exercised the
 * built artifact through the real MCP transport. See docs/primitive-backlog.md
 * §Build/Release Rigor for the full narrative.
 *
 * Per-tool expectation map
 * ────────────────────────
 * forge_plan, forge_evaluate, forge_generate
 *   MUST NOT return a body matching /not yet implemented/i and MUST return
 *   a non-empty body. These three are real handlers in source — any ghost
 *   string means dist/ is stale.
 *
 * forge_coordinate
 *   Source is still a legitimate pre-PH-01 stub ("not yet implemented. Phase
 *   4 required."). Exempt from the ghost-string assertion until PH-01 ships.
 *   When PH-01 flips this file, delete COORDINATE_STUB_EXEMPT and the
 *   `if (!COORDINATE_STUB_EXEMPT)` gate below — the exemption becomes a hard
 *   failure the moment the real coordinator lands.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

// TODO(PH-01 ship): delete this constant and the guarded assertion below.
const COORDINATE_STUB_EXEMPT = true;

const GHOST_PATTERN = /not yet implemented/i;
const CONNECT_TIMEOUT_MS = 10_000;

function bodyFromResult(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return content?.map((c) => c.text ?? "").join("\n") ?? "";
}

describe("MCP surface smoke", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const projectRoot = process.cwd();
    const serverPath = resolve(projectRoot, "dist", "index.js");

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      cwd: projectRoot,
      stderr: "pipe",
    });

    client = new Client(
      { name: "forge-smoke", version: "0.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
  }, CONNECT_TIMEOUT_MS);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it("lists all 6 forge tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "forge_coordinate",
      "forge_evaluate",
      "forge_generate",
      "forge_lint_refresh",
      "forge_plan",
      "forge_reconcile",
    ]);
  });

  it("forge_generate schema exposes more than the stub's single field (dist drift canary)", async () => {
    const { tools } = await client.listTools();
    const generate = tools.find((t) => t.name === "forge_generate");
    expect(generate).toBeDefined();
    const schema = generate!.inputSchema as { properties?: Record<string, unknown> };
    const propCount = Object.keys(schema.properties ?? {}).length;
    // The Phase-0 stub schema is `{ storyId }` — exactly one property.
    // The real schema has storyId, planJson, planPath, projectPath, evalReport,
    // iteration, maxIterations, previousScores, fileHashes, previousFileHashes,
    // baselineDiagnostics, prdContent, masterPlanContent, phasePlanContent
    // (14 fields). Anything below 5 is almost certainly a stale stub.
    expect(propCount).toBeGreaterThanOrEqual(5);
  });

  it.each([
    { name: "forge_plan" },
    { name: "forge_evaluate" },
    { name: "forge_generate" },
  ])("$name dispatches to a real (non-stub) handler", async ({ name }) => {
    // Call with empty input. Real handlers reject at Zod validation (before
    // any Claude API call or filesystem work) and return a validation error
    // body — non-empty and not a ghost string. A stale stub for these three
    // tools would either still return the ghost string or satisfy validation
    // trivially and return the ghost string; in both cases this assertion
    // catches it.
    let bodyText = "";
    try {
      const result = await client.callTool({ name, arguments: {} });
      bodyText = bodyFromResult(result);
    } catch (err) {
      // The MCP client throws on isError:true results in some SDK versions;
      // the thrown message is the body we want to inspect.
      bodyText = err instanceof Error ? err.message : String(err);
    }
    expect(bodyText.length).toBeGreaterThan(0);
    expect(bodyText).not.toMatch(GHOST_PATTERN);
  });

  it("forge_coordinate dispatches (stub exempt until PH-01 ships)", async () => {
    let bodyText = "";
    try {
      const result = await client.callTool({
        name: "forge_coordinate",
        arguments: { planPath: "nonexistent-smoke.json" },
      });
      bodyText = bodyFromResult(result);
    } catch (err) {
      bodyText = err instanceof Error ? err.message : String(err);
    }
    expect(bodyText.length).toBeGreaterThan(0);
    if (!COORDINATE_STUB_EXEMPT) {
      expect(bodyText).not.toMatch(GHOST_PATTERN);
    }
  });
});
