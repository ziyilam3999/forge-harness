import { z } from "zod";

export const coordinateInputSchema = {
  planPath: z.string().describe("Path to execution-plan.json"),
};

export async function handleCoordinate({ planPath }: { planPath: string }) {
  return {
    content: [
      {
        type: "text" as const,
        text: `forge_coordinate for "${planPath}": not yet implemented. Phase 4 required.`,
      },
    ],
  };
}
