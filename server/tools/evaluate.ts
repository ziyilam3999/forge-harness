import { z } from "zod";

export const evaluateInputSchema = {
  storyId: z.string().describe("Story ID to evaluate (e.g., US-01)"),
};

export async function handleEvaluate({ storyId }: { storyId: string }) {
  return {
    content: [
      {
        type: "text" as const,
        text: `forge_evaluate for "${storyId}": not yet implemented. Phase 2 required.`,
      },
    ],
  };
}
