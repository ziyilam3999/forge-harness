/**
 * Shared test utilities for forge-harness integration tests.
 */

/**
 * Extract JSON from forge_plan output text.
 * Output format: "=== HEADER ===\n\n{json}\n\n=== NEXT SECTION ==="
 * The JSON is the first valid JSON object/array after the header.
 */
export function extractPlanJson(text: string): string {
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) throw new Error("No JSON found in output");

  let depth = 0;
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    if (depth === 0) return text.slice(jsonStart, i + 1);
  }
  throw new Error("Unbalanced JSON in output");
}

/**
 * Find a mock call whose first argument's messages contain ALL of the
 * specified content strings. Useful for identifying specific LLM calls
 * without relying on fragile index positions.
 */
export function findCallByContent<
  T = { messages: Array<{ content: string }> },
>(
  mockCalls: ReadonlyArray<readonly unknown[]>,
  contentMatches: string[],
): T {
  const match = mockCalls.find((call) => {
    const arg = call[0] as { messages?: Array<{ content?: unknown }> };
    const messages: Array<{ content?: unknown }> = arg?.messages ?? [];
    const text = messages
      .map((m) => (typeof m?.content === "string" ? m.content : ""))
      .join("\n");
    return contentMatches.every((s) => text.includes(s));
  });
  if (!match) {
    throw new Error(
      `No mock call found containing all of: ${contentMatches.join(", ")}`,
    );
  }
  return match[0] as T;
}
