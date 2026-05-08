import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * F6 (v0.40.5) — macOS Keychain service name for Claude Code's OAuth blob.
 *
 * CONTRACT: Keychain entry name pinned to "Claude Code-credentials" as of
 * Claude Code (macOS) on 2026-05-03 (cdat from macbook-monday's a9d0 host,
 * verified again in worktree probe 2026-05-08 — blob is JSON-encoded with
 * the same `claudeAiOauth.{accessToken,expiresAt}` shape as
 * `~/.claude/.credentials.json`).
 *
 * If Claude Code renames the entry in a future release, this constant must
 * follow; symptom would be silent fall-through to no-creds on macOS.
 *
 * EXPORTED so spec-generator.ts can use the same string for its emit-point
 * existence-check probe — single source-of-truth per F49 (no dual-locus
 * drift between the read in this file and the existence-check in
 * spec-generator.ts).
 */
export const KEYCHAIN_SERVICE_NAME = "Claude Code-credentials";
// Raised from 8192 → 32000 in v0.32.7 after monday-bot hit truncation on the
// planner call site (not just the corrector fixed in v0.32.6). Sonnet 4
// supports 64K output tokens; 32000 covers every full-plan/findings payload
// observed so far with headroom. Billing is per-token-used, so non-plan callers
// pay nothing extra — the raised ceiling just stops clipping premature.
const DEFAULT_MAX_TOKENS = 32000;

/** v0.35.1 AC-6 — credential-source provenance for the BUDGET widget marker. */
export type CredentialSource = "api-key" | "oauth" | "unknown";

/**
 * Detect which credential source `getClient()` *would* use on the next call,
 * without instantiating a client. Pure read of process.env and the
 * credentials file. Returns:
 *   - "api-key" when `ANTHROPIC_API_KEY` is set
 *   - "oauth"   when the OAuth token file is present and non-expired
 *   - "unknown" otherwise (no creds available)
 *
 * Used by the dashboard renderer to annotate the BUDGET widget with a
 * "Max plan — $0 actual" marker when the running MCP server resolved via
 * OAuth. The two paths mirror `getClient()` precedence exactly.
 */
export function getCredentialSource(): CredentialSource {
  if (process.env.ANTHROPIC_API_KEY) return "api-key";
  if (readOAuthToken() !== null) return "oauth";
  return "unknown";
}

/**
 * F6 (v0.40.5) — macOS Keychain fallback for the OAuth blob.
 *
 * macOS Claude Code stores the OAuth credentials in Keychain rather than on
 * disk (`~/.claude/.credentials.json` does not exist on a freshly-logged-in
 * Mac). When the file read fails AND we are on darwin, shell out to the
 * built-in `/usr/bin/security` utility and fetch the blob's password value
 * (the `-w` flag returns just the password, not the metadata wrapper).
 *
 * The returned blob is JSON-encoded with the same shape as the file would
 * have been (verified by worktree probe 2026-05-08 against macbook-monday's
 * cdat host) — caller does its own JSON.parse + validation.
 *
 * Returns the raw blob string on success, `null` on any failure (Keychain
 * locked, entry missing, ACL mismatch, prompt timeout, non-darwin platform).
 *
 * 2000ms timeout: failsafe for the worst-case modal-prompt hang. Cold ACL
 * lookups on M-series Macs are 30-150ms typical; 2000ms gives ~3x headroom
 * over the worst-observed pathological APFS case while staying below the
 * MCP-child user-perceived stall threshold.
 */
function readOAuthTokenFromKeychain(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const username = userInfo().username;
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE_NAME, "-a", username, "-w"],
      { encoding: "utf-8", timeout: 2000 },
    ).trim();
  } catch {
    // F45 escape: empty catch + null sentinel is defensible BECAUSE
    // spec-generator.ts emits a typed `spec-gen-creds-keychain-only`
    // warning when this null surfaces alongside a Keychain-entry-exists
    // probe (P44 loud-failure). Do NOT remove the C-side warning without
    // re-evaluating this catch.
    return null;
  }
}

/**
 * Read the Claude OAuth access token. Tries `~/.claude/.credentials.json`
 * first (Linux / WSL / macOS-with-explicit-file); on darwin, falls back to
 * macOS Keychain (where current Claude Code stores OAuth — F6 fix in
 * v0.40.5).
 *
 * Returns null if neither source yields a usable token, the JSON is
 * malformed, or the token is *strictly* expired. Per I8 (2026-05-08), we
 * no longer pre-emptively reject tokens that are merely close to expiry —
 * Claude Code's main process refreshes the credential store just-in-time,
 * so deferring to the stored `expiresAt` strictly is correct. If a token
 * issued seconds-ago expires mid-call, the 401-retry path in `callClaude`
 * re-reads the source (which Claude Code may have refreshed) and retries
 * once.
 */
function readOAuthToken(): { accessToken: string; expiresAt: number } | null {
  let raw: string | null = null;
  try {
    const credPath = join(homedir(), ".claude", ".credentials.json");
    raw = readFileSync(credPath, "utf-8");
  } catch {
    // File absent / unreadable. On darwin, Claude Code stores OAuth in
    // Keychain instead — try that source before giving up.
    raw = readOAuthTokenFromKeychain();
  }

  if (raw === null || raw === "") return null;

  try {
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth as { accessToken?: unknown; expiresAt?: unknown } | undefined;
    if (typeof oauth?.accessToken !== "string" || typeof oauth?.expiresAt !== "number") return null;

    // Strict-expiry check: only reject tokens that are already past `expiresAt`.
    // The 5-min pre-emptive bail was removed in I8 (v0.40.x) — see plan
    // 2026-05-08-us-12-audit-followups-f5-i6-i7.md. Claude Code refreshes
    // the credential store just-in-time, so forge should defer to the
    // stored stamp rather than guess at when the refresh will happen.
    if (Date.now() > oauth.expiresAt) {
      return null;
    }

    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt };
  } catch {
    return null;
  }
}

/**
 * Reset any cached client state. Retained as a no-op-flavoured shim for
 * call-sites that historically reset the module-level singleton (notably the
 * test suite's `beforeEach`). After I8 (v0.40.x) `getClient()` no longer
 * memoizes — it re-reads the credentials file on every call — so there is
 * nothing to evict. Kept as an exported function to avoid churn at all
 * existing call-sites; its behaviour is now intentionally a no-op.
 */
export function resetClient(): void {
  // No-op: there is no cached client state to clear since I8 dropped the
  // module-level singleton. See `getClient()` below.
}

/**
 * Construct a fresh `Anthropic` client. Always re-reads the credentials file
 * (when falling back to OAuth) so concurrent Claude Code refreshes are picked
 * up on the very next call — no cache, no eviction window. Construction is
 * configuration-only (no network), so the per-call cost is negligible.
 *
 * Precedence (unchanged from prior behaviour):
 *   1. `ANTHROPIC_API_KEY` env var
 *   2. `~/.claude/.credentials.json` (Claude Code OAuth)
 */
export function getClient(): Anthropic {
  // 1. Try ANTHROPIC_API_KEY (works with direct API calls and CI)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return new Anthropic({ apiKey });
  }

  // 2. Fall back to Claude OAuth token (Claude Code Max subscription).
  //    The OAuth access token from ~/.claude/.credentials.json is accepted by the
  //    Anthropic SDK as authToken for direct API calls (no Claude Code proxy
  //    required). Works for Max-plan users who haven't set ANTHROPIC_API_KEY.
  //    Strict-expiry only — pre-emptive 5-min bail removed in I8.
  const oauthCreds = readOAuthToken();
  if (oauthCreds) {
    return new Anthropic({ authToken: oauthCreds.accessToken });
  }

  throw new Error(
    "No API credentials found. Either:\n" +
      "  1. Log in to Claude Code (OAuth token in ~/.claude/.credentials.json), or\n" +
      "  2. Set ANTHROPIC_API_KEY environment variable: export ANTHROPIC_API_KEY=sk-...",
  );
}

/**
 * Thrown when the LLM response was cut off because it hit the max_tokens ceiling.
 * The text that did come back is almost always malformed (truncated mid-string /
 * mid-token), so callers must not try to extractJson() it. Raise the maxTokens
 * on the call or shrink the request and retry.
 */
export class LLMOutputTruncatedError extends Error {
  readonly maxTokensLimit: number;
  readonly outputChars: number;
  constructor(maxTokensLimit: number, outputChars: number) {
    super(
      `LLM output truncated: stop_reason=max_tokens hit at limit ${maxTokensLimit}. ` +
        `Received ${outputChars} chars before cutoff. Raise maxTokens or shrink the prompt.`,
    );
    this.name = "LLMOutputTruncatedError";
    this.maxTokensLimit = maxTokensLimit;
    this.outputChars = outputChars;
  }
}

export interface CallClaudeOptions {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  jsonMode?: boolean;
  maxTokens?: number;
}

export interface CallClaudeResult {
  text: string;
  parsed?: unknown;
  /**
   * Token usage from the SDK's `response.usage`.
   *
   * `inputTokens` / `outputTokens` are always set. The two cache fields are
   * optional because the SDK returns them as `number | null` — they are only
   * populated when the request used prompt caching AND the SDK surfaced a
   * numeric value. Downstream cost/telemetry code should treat `undefined`
   * the same as zero.
   */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

/**
 * Narrowing helper for Anthropic's `stop_reason` union. Returns `true` iff
 * the caller is looking at the `"max_tokens"` variant, and — crucially —
 * enforces exhaustive handling of the full `StopReason` union at compile
 * time via the `never` fallthrough. If the SDK ships a new variant and this
 * switch is not updated, `tsc --noEmit` fails at the `never` assignment.
 *
 * The union is widened to accept `null` because `Message.stop_reason` is
 * typed `StopReason | null` on the response.
 */
function isMaxTokensStop(stopReason: Anthropic.StopReason | null): boolean {
  switch (stopReason) {
    case "max_tokens":
      return true;
    case "end_turn":
    case "stop_sequence":
    case "tool_use":
    case "pause_turn":
    case "refusal":
    case null:
      return false;
    default: {
      // Compile-time exhaustiveness guard — a new SDK variant will surface
      // here as a TS2322 "Type 'X' is not assignable to type 'never'".
      const _exhaustive: never = stopReason;
      // Runtime fail-safe (#349): if SDK/runtime skew slips an unknown
      // variant past TS (e.g. production runs against a newer SDK than the
      // one the build was typed against), treat it as NOT the max_tokens
      // variant. Returning the raw value would have been truthy on any
      // non-empty string and would have misfired callClaude's truncation
      // path, throwing `LLMOutputTruncatedError` for benign stops.
      void _exhaustive;
      return false;
    }
  }
}

/**
 * Extract JSON from an LLM response that may contain markdown fences or preamble.
 * Strategy: (1) try full parse, (2) extract between first {/[ and last }/], (3) throw.
 */
export function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to extraction
  }

  // Try extracting between braces or brackets
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let start: number;
  let end: number;

  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error(
      `Failed to extract JSON from response: no { or [ found. Response starts with: "${text.slice(0, 100)}"`,
    );
  }

  if (firstBracket === -1 || (firstBrace !== -1 && firstBrace < firstBracket)) {
    start = firstBrace;
    end = text.lastIndexOf("}");
  } else {
    start = firstBracket;
    end = text.lastIndexOf("]");
  }

  if (end <= start) {
    throw new Error(
      `Failed to extract JSON from response: unmatched brackets. Response starts with: "${text.slice(0, 100)}"`,
    );
  }

  const extracted = text.slice(start, end + 1);
  try {
    return JSON.parse(extracted);
  } catch (e) {
    throw new Error(
      `Failed to parse extracted JSON from response. ` +
        `Parse error: ${e instanceof Error ? e.message : String(e)}. ` +
        `Extracted text starts with: "${extracted.slice(0, 100)}"`,
    );
  }
}

/**
 * Call Claude API with the given prompt. Handles JSON extraction when jsonMode is true.
 *
 * Uses `messages.stream(...).finalMessage()` unconditionally: the Anthropic SDK throws
 * "Streaming is required for operations that may take longer than 10 minutes" synchronously
 * when the predicted runtime of a non-streaming request exceeds 600s (v0.32.7's 32000
 * max_tokens tips the planner/corrector over this threshold). Streaming is explicitly safe
 * for short calls — no per-call overhead, same `Message` shape returned — so we flip the
 * whole helper rather than adding a fragile heuristic.
 */
export async function callClaude(options: CallClaudeOptions): Promise<CallClaudeResult> {
  const effectiveMaxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const streamArgs = {
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: effectiveMaxTokens,
    system: options.jsonMode
      ? options.system +
        "\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no preamble text, no trailing text. Just the JSON object."
      : options.system,
    messages: options.messages,
  };

  // I8 (v0.40.x): single-retry on 401 AuthenticationError.
  //
  // The OAuth access token in ~/.claude/.credentials.json is refreshed
  // just-in-time by Claude Code's main process. If forge's MCP child read
  // the file, started a stream, and Anthropic rejected the token mid-call
  // (because Claude Code refreshed in the meantime), re-reading the file
  // typically yields a fresh token. Reconstruct a brand-new client (which
  // re-reads the credentials file in its OAuth fallback path) and retry once.
  //
  // We DO NOT retry when ANTHROPIC_API_KEY is set: the file is not in play,
  // re-reading cannot help, and looping on a bad API key would only paper
  // over a misconfiguration. Let the original error propagate in that case.
  //
  // We DO NOT status-code-sniff: the SDK exposes `Anthropic.AuthenticationError`
  // (extends `APIError<401>`) precisely for this purpose. See SDK 0.82.0
  // `core/error.d.ts:36`. Other error kinds (APIConnectionError, RateLimitError,
  // overloaded, etc.) pass through unchanged — they have their own recovery
  // semantics that 401-retry would not help.
  let response: Anthropic.Message;
  try {
    response = await getClient().messages.stream(streamArgs).finalMessage();
  } catch (err) {
    const isAuthError = err instanceof Anthropic.AuthenticationError;
    const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
    if (!isAuthError || hasApiKey) {
      throw err;
    }
    // Fresh client — re-reads ~/.claude/.credentials.json on construction.
    response = await getClient().messages.stream(streamArgs).finalMessage();
  }

  // Extract text from response content blocks
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Detect truncation by max_tokens and throw, rather than returning text the
  // caller will fail to parse. Keeps silent-truncation bugs loud — see forge_plan
  // corrector crash (monday blocker, 2026-04-19, v0.32.6). Uses a typed
  // narrowing helper so a new SDK `stop_reason` variant surfaces at compile
  // time rather than silently slipping past this string-literal check.
  if (isMaxTokensStop(response.stop_reason)) {
    throw new LLMOutputTruncatedError(effectiveMaxTokens, text.length);
  }

  const usage: CallClaudeResult["usage"] = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  // Cache token counts are `number | null` in the SDK and only populated when
  // the request used prompt caching. Pass them through when present so
  // downstream telemetry can distinguish cache hits / creations from
  // cold-read input tokens (see #329 — v0.34.x cost surface will price these).
  if (response.usage.cache_creation_input_tokens != null) {
    usage.cacheCreationInputTokens = response.usage.cache_creation_input_tokens;
  }
  if (response.usage.cache_read_input_tokens != null) {
    usage.cacheReadInputTokens = response.usage.cache_read_input_tokens;
  }

  if (options.jsonMode) {
    const parsed = extractJson(text);
    return { text, parsed, usage };
  }

  return { text, usage };
}
