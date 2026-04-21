import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_MODEL = "claude-sonnet-4-6";
// Raised from 8192 → 32000 in v0.32.7 after monday-bot hit truncation on the
// planner call site (not just the corrector fixed in v0.32.6). Sonnet 4
// supports 64K output tokens; 32000 covers every full-plan/findings payload
// observed so far with headroom. Billing is per-token-used, so non-plan callers
// pay nothing extra — the raised ceiling just stops clipping premature.
const DEFAULT_MAX_TOKENS = 32000;

let client: Anthropic | null = null;
// Track the OAuth token's expiry so we can evict the cache before it goes stale.
let clientExpiresAt: number | null = null;

/**
 * Read the Claude OAuth access token from ~/.claude/.credentials.json.
 * Returns null if the file doesn't exist, is invalid, or the token is expired.
 */
function readOAuthToken(): { accessToken: string; expiresAt: number } | null {
  try {
    const credPath = join(homedir(), ".claude", ".credentials.json");
    const creds = JSON.parse(readFileSync(credPath, "utf-8"));
    const oauth = creds.claudeAiOauth as { accessToken?: unknown; expiresAt?: unknown } | undefined;
    if (typeof oauth?.accessToken !== "string" || typeof oauth?.expiresAt !== "number") return null;

    // Check expiry — reject if less than 5 minutes remaining
    const remainingMs = oauth.expiresAt - Date.now();
    if (remainingMs < 5 * 60 * 1000) {
      console.error("forge: OAuth token expired or expiring soon, skipping");
      return null;
    }

    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt };
  } catch {
    return null;
  }
}

/**
 * Reset the cached Anthropic client. Intended for tests and key/token
 * rotation scenarios where the module-level singleton needs to be
 * re-initialized with fresh credentials.
 */
export function resetClient(): void {
  client = null;
  clientExpiresAt = null;
}

export function getClient(): Anthropic {
  // Evict cache if the OAuth token is expiring within 5 minutes
  if (client && clientExpiresAt !== null && Date.now() >= clientExpiresAt - 5 * 60 * 1000) {
    client = null;
    clientExpiresAt = null;
  }
  if (client) return client;

  // 1. Try ANTHROPIC_API_KEY (works with direct API calls and CI)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    console.error("forge: using ANTHROPIC_API_KEY for auth");
    client = new Anthropic({ apiKey });
    clientExpiresAt = null;
    return client;
  }

  // 2. Fall back to Claude OAuth token (Claude Code Max subscription).
  //    Note: OAuth tokens only work when proxied through Claude Code's infrastructure.
  //    Direct API calls with OAuth return 401 "OAuth authentication is currently not supported."
  const oauthCreds = readOAuthToken();
  if (oauthCreds) {
    console.error("forge: using Claude OAuth token for auth");
    client = new Anthropic({ authToken: oauthCreds.accessToken });
    clientExpiresAt = oauthCreds.expiresAt;
    return client;
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
  const anthropic = getClient();
  const effectiveMaxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const stream = anthropic.messages.stream({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: effectiveMaxTokens,
    system: options.jsonMode
      ? options.system +
        "\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no preamble text, no trailing text. Just the JSON object."
      : options.system,
    messages: options.messages,
  });
  const response = await stream.finalMessage();

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
