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
      "Evaluate plans and implementations. Three modes: " +
      '"story" (default) runs AC shell commands for a story. ' +
      '"coherence" checks alignment between PRD, master plan, and phase plans (LLM-judged). ' +
      '"divergence" detects forward (AC failures) and reverse (unplanned capabilities) divergence.',
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
      "GAN loop controller and brief assembler. On init (no evalReport): returns a GenerationBrief with story, " +
      "codebase context, git branch, baseline check, and optional document context. On iteration (with evalReport): " +
      "returns a FixBrief with failing criteria and eval hints, or escalates (plateau, no-op, max-iterations, " +
      "inconclusive, baseline-failed). Read-only — never calls the Claude API or mutates project files.",
    inputSchema: generateInputSchema,
    annotations: { readOnlyHint: true },
  },
  handleGenerate
);

server.registerTool(
  "forge_coordinate",
  {
    title: "Forge Coordinate",
    description:
      "Fourth forge primitive: dependency-aware dispatch and phase transition brief assembler. " +
      "Reads execution-plan.json, classifies stories into 6 states (done/ready/ready-for-retry/failed/pending/dep-failed), " +
      "enforces budgets (advisory), returns PhaseTransitionBrief. Advisory mode only ($0, no LLM calls).",
    inputSchema: coordinateInputSchema,
    annotations: { readOnlyHint: true },
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
