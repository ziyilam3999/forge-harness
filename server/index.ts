import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { planInputSchema, handlePlan } from "./tools/plan.js";
import { evaluateInputSchema, handleEvaluate } from "./tools/evaluate.js";
import { generateInputSchema, handleGenerate } from "./tools/generate.js";
import { coordinateInputSchema, handleCoordinate } from "./tools/coordinate.js";

const server = new McpServer({
  name: "forge",
  version: "0.3.0",
});

server.registerTool(
  "forge_plan",
  {
    title: "Forge Plan",
    description:
      "Transform intent into structured plans. Supports three document tiers: " +
      "master (vision → phases), phase (phase → stories with ACs), update (revise plan from implementation notes). " +
      "When documentTier is omitted, produces a standalone execution plan (backward compatible). Uses double-critique pattern.",
    inputSchema: planInputSchema,
    annotations: { readOnlyHint: true },
  },
  handlePlan
);

server.registerTool(
  "forge_evaluate",
  {
    title: "Forge Evaluate",
    description:
      "Run acceptance criteria shell commands for a story and produce a structured eval report with PASS/FAIL/INCONCLUSIVE per criterion.",
    inputSchema: evaluateInputSchema,
    annotations: { readOnlyHint: false },
  },
  handleEvaluate
);

server.registerTool(
  "forge_generate",
  {
    title: "Forge Generate",
    description:
      "Implement one story via GAN loop: implement, evaluate, fix, evaluate (max 3 rounds). Manages git branches per story.",
    inputSchema: generateInputSchema,
    annotations: { destructiveHint: true },
  },
  handleGenerate
);

server.registerTool(
  "forge_coordinate",
  {
    title: "Forge Coordinate",
    description:
      "Compose plan/generate/evaluate into dependency-ordered workflows. Reads execution-plan.json, dispatches stories, tracks progress, enforces budgets.",
    inputSchema: coordinateInputSchema,
    annotations: { destructiveHint: true },
  },
  handleCoordinate
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("forge: MCP server running on stdio");
}

main().catch((error) => {
  console.error("forge: fatal error", error);
  process.exit(1);
});
