import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Anthropic SDK. After v0.32.8, callClaude uses
// `client.messages.stream(...).finalMessage()` rather than `messages.create(...)`.
// The mock's `stream` returns a handle whose `finalMessage` resolves to the same
// Message-shaped object the tests previously handed to `create`.
const mockStream = vi.fn();
// Retained as a tripwire: if any code path slips back to `messages.create(...)`,
// tests that assert `mockCreate` was never called will fail loudly.
const mockCreate = vi.fn();

// I8 (v0.40.x): callClaude now branches on `err instanceof Anthropic.AuthenticationError`.
// Expose a real, throwable class as a static on the default mock so production code's
// `instanceof` check succeeds for AC-G probe 2/3 and so unrelated paths fail through
// (e.g. instanceof check is `false` for `new Error(...)`).
class MockAuthenticationError extends Error {
  status = 401;
  constructor(message = "401 unauthorized") {
    super(message);
    this.name = "AuthenticationError";
  }
}

class MockAnthropic {
  messages = { stream: mockStream, create: mockCreate };
  static AuthenticationError = MockAuthenticationError;
}

vi.mock("@anthropic-ai/sdk", () => {
  return { default: MockAnthropic };
});

// I8 AC-G probe 1 needs to stub the credentials-file read. Hoist the mock so
// `anthropic.ts`'s top-level `import { readFileSync } from "node:fs"` resolves
// to this stub. Default behaviour throws ENOENT — tests that rely on creds
// override `mockReadFileSync.mockImplementationOnce(...)` per case.
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

// F6 (v0.40.5) — macOS Keychain fallback inside readOAuthToken() shells out
// to `/usr/bin/security` via `execFileSync`. Hoist a child_process mock so
// AC-D's seven new cases can stub it per-case (happy blob, throw, ETIMEDOUT,
// empty string, malformed JSON). Default: throws ENOENT — i.e. on non-darwin
// platforms or hosts without /usr/bin/security, the helper sees nothing.
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

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
  // Default: any unstubbed credential-file read throws ENOENT (matches a host
  // with no ~/.claude/.credentials.json). Tests that need OAuth fallback
  // override per-case with `mockReadFileSync.mockImplementationOnce(...)`.
  mockReadFileSync.mockReset();
  mockReadFileSync.mockImplementation(() => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  });
  // Default: Keychain probe throws (entry missing / non-darwin / no
  // /usr/bin/security). Tests that exercise the Keychain fallback override
  // per-case with `mockExecFileSync.mockImplementationOnce(...)`.
  mockExecFileSync.mockReset();
  mockExecFileSync.mockImplementation(() => {
    throw new Error("security: SecKeychainSearchCopyNext: The specified item could not be found");
  });
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  // Suite-scoped tripwire (#318): callClaude must never fall back to the
  // non-streaming `messages.create(...)` path — v0.32.8 flipped it to
  // streaming unconditionally because 32000-token predicted runtimes tripped
  // the SDK's 10-minute non-streaming ceiling. Hoisting this assertion to
  // `afterEach` means every test in the file enforces the invariant, not
  // just the one that asserts it today.
  expect(mockCreate).not.toHaveBeenCalled();
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
    // The `mockCreate` tripwire lives in the suite-scoped `afterEach` at the
    // top of this file (#347) — no need to duplicate it here.
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
      // Structured fields are the contract — the human-readable `message`
      // string is prose and is not asserted here (#316).
      expect(err.maxTokensLimit).toBe(8192);
      expect(err.outputChars).toBe(truncatedText.length);
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

describe("callClaude — isMaxTokensStop fail-safe (#349)", () => {
  // Guards against SDK/runtime skew: if a future Anthropic SDK ships a new
  // `stop_reason` variant that slips past the TS exhaustiveness check at
  // build time (e.g. production runs a newer SDK than the one typed during
  // build), the `default` branch of `isMaxTokensStop` must treat it as NOT
  // the max_tokens variant — i.e. return `false` — rather than returning
  // the raw (truthy) string and tripping callClaude's truncation path.
  it("does NOT throw LLMOutputTruncatedError when stop_reason is an unknown future variant", async () => {
    mockStream.mockReturnValueOnce(
      streamHandle({
        content: [{ type: "text", text: "ok" }],
        // Cast to satisfy the stub shape; the SUT receives this value via
        // finalMessage() and must treat it as non-truncation.
        stop_reason: "some_future_variant_that_did_not_exist_at_build_time",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );

    const { callClaude, LLMOutputTruncatedError } = await import("./anthropic.js");

    // Expectation: callClaude returns normally rather than throwing. If the
    // default branch of isMaxTokensStop ever regresses to returning the raw
    // (truthy) stopReason, this assertion will fail because callClaude will
    // throw LLMOutputTruncatedError.
    await expect(
      callClaude({
        system: "s",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 8192,
      }),
    ).resolves.toMatchObject({ text: "ok" });

    // Defensive: if the above somehow resolved but also threw, make sure no
    // truncation error was surfaced.
    const { callClaude: callAgain } = await import("./anthropic.js");
    expect(callAgain).toBe(callClaude);
    expect(LLMOutputTruncatedError).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// I8 (v0.40.x) — defer to Claude Code's credentials file. AC-G probes.
// ───────────────────────────────────────────────────────────────────────────
//
// Plan: .ai-workspace/plans/2026-05-08-us-12-audit-followups-f5-i6-i7.md (I8).
//
// AC-G covers three observable behaviours:
//   1. No pre-emptive 5-min bail: a token with 30s of validity is USED, not
//      rejected. `getClient()` must not throw, and stderr must not carry the
//      old "expired or expiring soon, skipping" line.
//   2. 401 retry: when the SDK's first call rejects with an
//      `Anthropic.AuthenticationError`-shaped error and the second succeeds,
//      `callClaude` returns the second call's payload and the SDK is invoked
//      exactly twice.
//   3. Skip retry on API key: with `ANTHROPIC_API_KEY` set AND a first-401
//      stub, the original AuthenticationError propagates and the SDK is
//      invoked exactly once (re-reading a file you don't read can't help).
describe("I8 — getClient() does not pre-emptively bail on near-expiry tokens (AC-G probe 1)", () => {
  it("accepts an OAuth token with 30 seconds of validity remaining", async () => {
    // Force the OAuth fallback path by removing the API key for this test.
    delete process.env.ANTHROPIC_API_KEY;
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    // Token expires in 30 seconds — under the old 5-min bail this would have
    // been rejected with "expired or expiring soon, skipping". Strict-expiry
    // mode (post-I8) accepts it.
    const expiresAt = Date.now() + 30_000;
    mockReadFileSync.mockImplementationOnce(() =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "oauth-access-token-near-expiry",
          expiresAt,
        },
      }),
    );

    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { getClient } = await import("./anthropic.js");
      const client = getClient(); // Must NOT throw.
      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(MockAnthropic);

      // The legacy bail logged "OAuth token expired or expiring soon, skipping"
      // to stderr before returning null. After I8 there is no pre-emptive
      // rejection, so that line must never appear.
      const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0] ?? ""));
      expect(stderrCalls.some((line) => line.includes("expired or expiring soon"))).toBe(false);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("I8 — callClaude retries once on AuthenticationError (AC-G probe 2)", () => {
  it("retries on 401, returning the second call's payload after exactly two invocations", async () => {
    // Use the API-key branch is NOT what we want here — the retry guard skips
    // when ANTHROPIC_API_KEY is set. Force OAuth path so the retry runs.
    delete process.env.ANTHROPIC_API_KEY;
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    // Both `getClient()` calls inside `callClaude` will read the credentials
    // file; serve a valid token both times.
    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "oauth-access-token",
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      }),
    );

    // First stream() invocation: finalMessage() rejects with a 401-shaped
    // error. Second invocation: resolves normally with text "after-retry".
    mockStream
      .mockReturnValueOnce({
        finalMessage: () => Promise.reject(new MockAuthenticationError()),
      })
      .mockReturnValueOnce(
        streamHandle({
          content: [{ type: "text", text: "after-retry" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      );

    const { callClaude } = await import("./anthropic.js");

    const result = await callClaude({
      system: "s",
      messages: [{ role: "user", content: "u" }],
    });

    expect(result.text).toBe("after-retry");
    // Two-surface assertion (P64): producer (call count) + consumer (returned text).
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("propagates non-401 errors without retrying (e.g. APIConnectionError)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    mockReadFileSync.mockImplementation(() =>
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "oauth-access-token",
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      }),
    );

    // A non-AuthenticationError (e.g. plain TypeError) must NOT trigger the
    // 401 retry path — pass-through unchanged.
    const networkErr = new TypeError("connection reset");
    mockStream.mockReturnValueOnce({
      finalMessage: () => Promise.reject(networkErr),
    });

    const { callClaude } = await import("./anthropic.js");

    await expect(
      callClaude({
        system: "s",
        messages: [{ role: "user", content: "u" }],
      }),
    ).rejects.toBe(networkErr);

    expect(mockStream).toHaveBeenCalledTimes(1);
  });
});

describe("I8 — callClaude skips retry when ANTHROPIC_API_KEY is set (AC-G probe 3)", () => {
  it("propagates the original AuthenticationError without retrying", async () => {
    // ANTHROPIC_API_KEY is set by the suite-scoped beforeEach.
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-test-key");

    const authErr = new MockAuthenticationError("401 invalid key");
    mockStream.mockReturnValueOnce({
      finalMessage: () => Promise.reject(authErr),
    });

    const { callClaude } = await import("./anthropic.js");

    await expect(
      callClaude({
        system: "s",
        messages: [{ role: "user", content: "u" }],
      }),
    ).rejects.toBe(authErr);

    // No retry — file re-read can't help the API-key path.
    expect(mockStream).toHaveBeenCalledTimes(1);
  });
});

// ── F6 (v0.40.5) — macOS Keychain fallback in readOAuthToken() ──────────
//
// Plan: .ai-workspace/plans/2026-05-08-f6-i8-macos-keychain.md (AC-D).
//
// I8 (v0.40.4) assumed `~/.claude/.credentials.json` is the universal
// contract; on macOS Claude Code stores OAuth in Keychain. F6 adds a
// platform-conditional fallback: when the file read fails AND
// `process.platform === "darwin"`, shell out to `/usr/bin/security
// find-generic-password -s "Claude Code-credentials" -a $USER -w` and
// parse its stdout the same way the file would have been parsed.
//
// Tests use `Object.defineProperty(process, "platform", {...})` because
// direct assignment to `process.platform` is silently ignored on Node 20+
// (the property is read-only). Each test snapshots the original value in
// the inner block and restores it via `afterEach`.
describe("F6 — readOAuthToken() falls back to macOS Keychain on darwin (AC-D)", () => {
  const ORIGINAL_PLATFORM = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: ORIGINAL_PLATFORM,
      configurable: true,
    });
  });

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
  }

  /** Helper: build the JSON-encoded blob `security … -w` would print. */
  function keychainBlob(accessToken: string, expiresAt: number): string {
    return JSON.stringify({ claudeAiOauth: { accessToken, expiresAt } });
  }

  it("(i) darwin + Keychain returns valid JSON blob → getClient() uses the parsed token", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    setPlatform("darwin");
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    // File read fails (file absent on macOS). Keychain returns a valid blob.
    mockExecFileSync.mockImplementationOnce(() =>
      keychainBlob("oauth-from-keychain", Date.now() + 60 * 60 * 1000),
    );

    const { getClient } = await import("./anthropic.js");
    const client = getClient();
    expect(client).toBeDefined();
    expect(client).toBeInstanceOf(MockAnthropic);
    // Producer-side assertion: the security shell-out happened.
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    const callArgs = mockExecFileSync.mock.calls[0];
    expect(callArgs[0]).toBe("/usr/bin/security");
    expect(callArgs[1]).toContain("find-generic-password");
    expect(callArgs[1]).toContain("Claude Code-credentials");
    expect(callArgs[1]).toContain("-w");
  });

  it("(ii) darwin + Keychain execFileSync throws → readOAuthToken returns null (no crash)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    setPlatform("darwin");
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("security: SecKeychainSearchCopyNext: not found");
    });

    const { getClient } = await import("./anthropic.js");
    expect(() => getClient()).toThrow(/No API credentials found/);
    // Probe was attempted (consumer-side assertion).
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("(iii) linux/win32 platform → no security invocation observed", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    setPlatform("linux");
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    // File read fails (default ENOENT). On linux we MUST NOT shell out.
    const { getClient } = await import("./anthropic.js");
    expect(() => getClient()).toThrow(/No API credentials found/);
    expect(mockExecFileSync).not.toHaveBeenCalled();

    // Re-check on win32 for completeness.
    setPlatform("win32");
    resetClient();
    expect(() => getClient()).toThrow(/No API credentials found/);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("(iv) darwin + Keychain returns malformed JSON → null, no crash", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    setPlatform("darwin");
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    // Garbage that is NOT valid JSON.
    mockExecFileSync.mockImplementationOnce(() => "not-json-at-all-{{{");

    const { getClient } = await import("./anthropic.js");
    expect(() => getClient()).toThrow(/No API credentials found/);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("(v) darwin + execFileSync throws ETIMEDOUT → null, no crash", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    setPlatform("darwin");
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    mockExecFileSync.mockImplementationOnce(() => {
      const err = new Error("Command timed out") as NodeJS.ErrnoException;
      err.code = "ETIMEDOUT";
      throw err;
    });

    const { getClient } = await import("./anthropic.js");
    expect(() => getClient()).toThrow(/No API credentials found/);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("(vi) darwin + Keychain returns empty string → null, no crash", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    setPlatform("darwin");
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    // Empty / whitespace-only stdout (locked-but-listed Keychain edge case).
    mockExecFileSync.mockImplementationOnce(() => "   \n");

    const { getClient } = await import("./anthropic.js");
    expect(() => getClient()).toThrow(/No API credentials found/);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("(vii) darwin + Keychain returns valid blob → getCredentialSource() returns 'oauth' (BUDGET marker)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    setPlatform("darwin");
    const { resetClient } = await import("./anthropic.js");
    resetClient();

    mockExecFileSync.mockImplementationOnce(() =>
      keychainBlob("oauth-via-keychain", Date.now() + 60 * 60 * 1000),
    );

    const { getCredentialSource } = await import("./anthropic.js");
    expect(getCredentialSource()).toBe("oauth");
  });
});

// ── F6 — KEYCHAIN_SERVICE_NAME is exported from anthropic.ts ────────────
//
// F49 mitigation: spec-generator.ts imports the same constant for its
// existence-check probe so the service-name string lives at one
// source-of-truth. Test pins the export.
describe("F6 — KEYCHAIN_SERVICE_NAME export contract (F49 mitigation)", () => {
  it("exports the canonical Keychain service name as a string constant", async () => {
    const mod = await import("./anthropic.js");
    expect(mod.KEYCHAIN_SERVICE_NAME).toBe("Claude Code-credentials");
  });
});
