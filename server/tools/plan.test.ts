import { describe, it, expect } from "vitest";
import { handlePlan } from "./plan.js";

describe("forge_plan placeholder", () => {
  it("returns not-implemented message with intent", async () => {
    const result = await handlePlan({ intent: "build a calculator" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("not yet implemented");
    expect(result.content[0].text).toContain("build a calculator");
  });
});
