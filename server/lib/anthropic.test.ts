import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Anthropic SDK. After v0.32.8, callClaude uses
// `client.messages.stream(...).finalMessage()` rather than `messages.create(...)`.
// The mock's `stream` returns a handle whose `finalMessage` resolves to the same
// Message-shaped object the tests previously handed to `create`.
const mockStream = vi.fn();
// Retained as a tripwire: if any code path slips back to `messages.create(...)`,
// tests that assert `mockCreate` was never called will fail loudly.
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { stream: mockStream, create: mockCreate };
    },
  };
});

/** Build a stream-handle stub whose `finalMessage()` resolves to `message`. */
function streamHandle(message: {
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}) {
  return { finalMessage: () => Promise.resolve(message) };
}

// Credentials path: force ANTHROPIC_API_KEY to be set so getClient() uses the
// env-var branch and never tries to read ~/.claude/.credentials.json from disk.
const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;

beforeEach(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-key";
  const { resetClient } = await import("./anthropic.js");
  resetClient();
  mockStream.mockReset();
  mockCreate.mockReset();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
});

describe("callClaude — transport (v0.32.8 streaming)", () => {
  it("calls messages.stream(...).finalMessage() — not messages.create()", async () => {
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );

    const { callClaude } = await import("./anthropic.js");

    await callClaude({ system: "s", messages: [{ role: "user", content: "u" }] });

    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("callClaude — truncation handling (v0.32.6 through streaming path)", () => {
  it("throws LLMOutputTruncatedError when finalMessage.stop_reason === 'max_tokens'", async () => {
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: '{"plan": {"stories": [{"id":"US-01","' }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 100, output_tokens: 8192 },
      }),
    );

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
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: truncatedText }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 100, output_tokens: 8192 },
      }),
    );

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
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: '{"ok": true}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    const { callClaude } = await import("./anthropic.js");

    const result = await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });
    expect(result.text).toBe('{"ok": true}');
    expect(result.usage.outputTokens).toBe(5);
  });

  it("does NOT throw when stop_reason is 'stop_sequence'", async () => {
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: "done." }],
        stop_reason: "stop_sequence",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );

    const { callClaude } = await import("./anthropic.js");

    const result = await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });
    expect(result.text).toBe("done.");
  });
});

describe("callClaude — max_tokens plumbing (v0.32.7 through streaming path)", () => {
  it("sends max_tokens=32000 to the SDK when caller does not pass maxTokens", async () => {
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );

    const { callClaude } = await import("./anthropic.js");

    await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });

    expect(mockStream).toHaveBeenCalledTimes(1);
    const sdkArgs = mockStream.mock.calls[0][0];
    expect(sdkArgs.max_tokens).toBe(32000);
  });

  it("explicit maxTokens override still wins over the default (regression positive)", async () => {
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );

    const { callClaude } = await import("./anthropic.js");

    await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 1024,
    });

    const sdkArgs = mockStream.mock.calls[0][0];
    expect(sdkArgs.max_tokens).toBe(1024);
  });
});
