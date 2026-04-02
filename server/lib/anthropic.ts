import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-6-20250514";
const DEFAULT_MAX_TOKENS = 8192;

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
        "Set it in your shell before starting the MCP server: export ANTHROPIC_API_KEY=sk-...",
    );
  }

  client = new Anthropic({ apiKey });
  return client;
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
    // Validate that the response is parseable JSON
    extractJson(text); // throws if not valid
  }

  return { text, usage };
}
