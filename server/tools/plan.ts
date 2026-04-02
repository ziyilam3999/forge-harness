import { z } from "zod";

export const planInputSchema = {
  intent: z.string().describe("What to build — a PRD, description, or goal statement"),
};

export async function handlePlan({ intent }: { intent: string }) {
  return {
    content: [
      {
        type: "text" as const,
        text: `forge_plan for "${intent}": not yet implemented. Phase 1 required.`,
      },
    ],
  };
}
