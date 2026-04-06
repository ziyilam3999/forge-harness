import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallClaudeResult } from "./anthropic.js";

// Mock the anthropic module
vi.mock("./anthropic.js", () => ({
  callClaude: vi.fn(),
}));

// Mock audit to avoid file I/O
vi.mock("./audit.js", () => {
  return {
    AuditLog: class MockAuditLog {
      log = vi.fn(async () => {});
      getFilePath = vi.fn(() => null);
    },
  };
});

const { callClaude } = await import("./anthropic.js");
const { RunContext, trackedCallClaude } = await import("./run-context.js");

const mockedCallClaude = vi.mocked(callClaude);

function makeResult(inputTokens: number, outputTokens: number): CallClaudeResult {
  return {
    text: '{"result": "ok"}',
    usage: { inputTokens, outputTokens },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RunContext", () => {
  it("bundles cost, progress, and audit", () => {
    const ctx = new RunContext({
      toolName: "forge_plan",
      stages: ["planner", "critic"],
    });

    expect(ctx.cost).toBeDefined();
    expect(ctx.progress).toBeDefined();
    expect(ctx.audit).toBeDefined();
    expect(ctx.toolName).toBe("forge_plan");
  });
});

describe("trackedCallClaude", () => {
  it("calls callClaude and records token usage", async () => {
    const ctx = new RunContext({
      toolName: "forge_plan",
      stages: ["planner"],
    });

    mockedCallClaude.mockResolvedValueOnce(makeResult(500, 200));

    const result = await trackedCallClaude(ctx, "planner", "planner", {
      system: "test",
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.usage.inputTokens).toBe(500);
    expect(ctx.cost.totalInputTokens).toBe(500);
    expect(ctx.cost.totalOutputTokens).toBe(200);
  });

  it("reports progress (begin + complete)", async () => {
    const ctx = new RunContext({
      toolName: "forge_plan",
      stages: ["planner", "critic"],
    });

    mockedCallClaude.mockResolvedValueOnce(makeResult(100, 50));

    await trackedCallClaude(ctx, "planner", "planner", {
      system: "test",
      messages: [{ role: "user", content: "test" }],
    });

    const results = ctx.progress.getResults();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("planner");
    expect(results[0].status).toBe("completed");
    expect(console.error).toHaveBeenCalledWith(
      "forge_plan: [1/2] planner...",
    );
  });

  it("marks progress as failed and re-throws on error", async () => {
    const ctx = new RunContext({
      toolName: "forge_plan",
      stages: ["planner"],
    });

    mockedCallClaude.mockRejectedValueOnce(new Error("API error"));

    await expect(
      trackedCallClaude(ctx, "planner", "planner", {
        system: "test",
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("API error");

    const results = ctx.progress.getResults();
    expect(results[0].status).toBe("failed");
  });

  it("logs audit entry on success", async () => {
    const ctx = new RunContext({
      toolName: "forge_plan",
      stages: ["planner"],
    });

    mockedCallClaude.mockResolvedValueOnce(makeResult(100, 50));

    await trackedCallClaude(ctx, "planner", "planner", {
      system: "test",
      messages: [{ role: "user", content: "test" }],
    });

    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "planner",
        agentRole: "planner",
        decision: "call_complete",
      }),
    );
  });

  it("logs audit entry on failure", async () => {
    const ctx = new RunContext({
      toolName: "forge_plan",
      stages: ["planner"],
    });

    mockedCallClaude.mockRejectedValueOnce(new Error("timeout"));

    try {
      await trackedCallClaude(ctx, "planner", "planner", {
        system: "test",
        messages: [{ role: "user", content: "test" }],
      });
    } catch {
      // expected
    }

    expect(ctx.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "planner",
        decision: "call_failed",
        reasoning: "timeout",
      }),
    );
  });

  it("accumulates cost across multiple tracked calls", async () => {
    const ctx = new RunContext({
      toolName: "forge_plan",
      stages: ["planner", "critic", "corrector"],
    });

    mockedCallClaude
      .mockResolvedValueOnce(makeResult(100, 50))
      .mockResolvedValueOnce(makeResult(200, 100))
      .mockResolvedValueOnce(makeResult(150, 75));

    await trackedCallClaude(ctx, "planner", "planner", {
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });
    await trackedCallClaude(ctx, "critic", "critic", {
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });
    await trackedCallClaude(ctx, "corrector", "corrector", {
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });

    expect(ctx.cost.totalInputTokens).toBe(450);
    expect(ctx.cost.totalOutputTokens).toBe(225);
    expect(ctx.progress.getResults()).toHaveLength(3);
  });
});
