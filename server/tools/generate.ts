import { z } from "zod";

export const generateInputSchema = {
  storyId: z.string().describe("Story ID to implement (e.g., US-01)"),
};

export async function handleGenerate({ storyId }: { storyId: string }) {
  return {
    content: [
      {
        type: "text" as const,
        text: `forge_generate for "${storyId}": not yet implemented. Phase 3 required.`,
      },
    ],
  };
}
