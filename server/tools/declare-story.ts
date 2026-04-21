import { z } from "zod";
import { setDeclaration } from "../lib/declaration-store.js";

// ── Zod schema for MCP input ────────────────────────────────

export const declareStoryInputSchema = {
  storyId: z
    .string()
    .min(1, "storyId must be a non-empty string")
    .describe("Story identifier, e.g. 'US-03'. Required."),
  phaseId: z
    .string()
    .min(1, "phaseId must be a non-empty string")
    .optional()
    .describe("Phase identifier, e.g. 'PH-02'. Optional."),
};

type DeclareStoryInput = {
  storyId: string;
  phaseId?: string;
};

type McpResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ── Handler ─────────────────────────────────────────────────

/**
 * forge_declare_story — an agent declares "I am implementing storyId
 * (optionally within phaseId) from now on." Writes to the MCP server
 * process's module-level declaration store so forge_status can surface
 * the declaration in its `activeRun` field.
 *
 * Scenario A (monday-bot): closes the 55ms init-window gap between a
 * `forge_generate` start and the first `.forge/activity.json` flush,
 * where the dashboard and any sibling forge_status query would
 * otherwise see `activeRun.storyId === null`.
 *
 * Returns a simple ack body with the recorded declaration and the
 * declaration timestamp. Never writes to `.forge/`, never mutates
 * coordinator state, never calls an LLM.
 *
 * The declaration is process-scoped and NOT persisted to disk. It is
 * lost on MCP server restart — this is by design (matches monday-bot's
 * out-of-scope).
 */
export async function handleDeclareStory(input: DeclareStoryInput): Promise<McpResponse> {
  // Runtime validation belt-and-braces over Zod (Zod handles at MCP boundary,
  // but direct callers may bypass it).
  if (typeof input.storyId !== "string" || input.storyId.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "forge_declare_story error: storyId must be a non-empty string",
        },
      ],
      isError: true,
    };
  }
  if (input.phaseId !== undefined && (typeof input.phaseId !== "string" || input.phaseId.length === 0)) {
    return {
      content: [
        {
          type: "text",
          text: "forge_declare_story error: phaseId, when provided, must be a non-empty string",
        },
      ],
      isError: true,
    };
  }

  const declaration = setDeclaration(input.storyId, input.phaseId ?? null);

  const body = {
    kind: "declared" as const,
    storyId: declaration.storyId,
    phaseId: declaration.phaseId,
    declaredAt: declaration.declaredAt,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
  };
}
