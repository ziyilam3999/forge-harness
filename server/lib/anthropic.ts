import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 8192;

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
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken || !oauth?.expiresAt) return null;

    // Check expiry — reject if less than 5 minutes remaining
    const remainingMs = oauth.expiresAt - Date.now();
    if (remainingMs < 5 * 60 * 1000) {
      console.error("forge: OAuth token expired or expiring soon, skipping");
      return null;
    }

    return { accessToken: oauth.accessToken as string, expiresAt: oauth.expiresAt as number };
  } catch {
    return null;
  }
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
  usage: { inputTokens: number; outputTokens: number };
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
 */
export async function callClaude(options: CallClaudeOptions): Promise<CallClaudeResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: options.jsonMode
      ? options.system +
        "\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no preamble text, no trailing text. Just the JSON object."
      : options.system,
    messages: options.messages,
  });

  // Extract text from response content blocks
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  if (options.jsonMode) {
    const parsed = extractJson(text);
    return { text, parsed, usage };
  }

  return { text, usage };
}
