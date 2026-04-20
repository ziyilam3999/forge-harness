import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Anthropic SDK. getClient() constructs `new Anthropic(...)` and then
// calls `client.messages.create(...)`. We stub the whole module so the return
// value of `messages.create` is a plain object we control per-test.
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Credentials path: force ANTHROPIC_API_KEY to be set so getClient() uses the
// env-var branch and never tries to read ~/.claude/.credentials.json from disk.
const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

beforeEach(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-key";
  const { resetClient } = await import("./anthropic.js");
  resetClient();
  mockCreate.mockReset();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
});

describe("callClaude — truncation handling (v0.32.6)", () => {
  it("throws LLMOutputTruncatedError when response.stop_reason === 'max_tokens'", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"plan": {"stories": [{"id":"US-01","' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 100, output_tokens: 8192 },
    });

    const { callClaude, LLMOutputTruncatedError } = await import("./anthropic.js");

    await expect(
      callClaude({
        system: "you are a planner",
        messages: [{ role: "user", content: "plan a thing" }],
        maxTokens: 8192,
      }),
    ).rejects.toBeInstanceOf(LLMOutputTruncatedError);
  });

  it("LLMOutputTruncatedError carries the limit and output length", async () => {
    const truncatedText = '{"plan": {"stories": [{"id":"US-01","';
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: truncatedText }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 100, output_tokens: 8192 },
    });

    const { callClaude, LLMOutputTruncatedError } = await import("./anthropic.js");

    try {
      await callClaude({
        system: "s",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 8192,
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMOutputTruncatedError);
      const err = e as InstanceType<typeof LLMOutputTruncatedError>;
      expect(err.maxTokensLimit).toBe(8192);
      expect(err.outputChars).toBe(truncatedText.length);
      expect(err.message).toContain("max_tokens");
      expect(err.message).toContain("8192");
    }
  });

  it("does NOT throw when stop_reason is 'end_turn' (normal completion)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"ok": true}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const { callClaude } = await import("./anthropic.js");

    const result = await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });
    expect(result.text).toBe('{"ok": true}');
    expect(result.usage.outputTokens).toBe(5);
  });

  it("sends max_tokens=32000 to the SDK when caller does not pass maxTokens (v0.32.7 sweep)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    });

    const { callClaude } = await import("./anthropic.js");

    await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sdkArgs = mockCreate.mock.calls[0][0];
    expect(sdkArgs.max_tokens).toBe(32000);
  });

  it("explicit maxTokens override still wins over the default (regression positive)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    });

    const { callClaude } = await import("./anthropic.js");

    await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 1024,
    });

    const sdkArgs = mockCreate.mock.calls[0][0];
    expect(sdkArgs.max_tokens).toBe(1024);
  });

  it("does NOT throw when stop_reason is 'stop_sequence'", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "done." }],
      stop_reason: "stop_sequence",
      usage: { input_tokens: 10, output_tokens: 2 },
    });

    const { callClaude } = await import("./anthropic.js");

    const result = await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });
    expect(result.text).toBe("done.");
  });
});
