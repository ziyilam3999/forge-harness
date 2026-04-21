import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Structural audit test for issue #324.
 *
 * v0.32.7 raised `DEFAULT_MAX_TOKENS` from 8192 → 32000 in
 * `server/lib/anthropic.ts` so every LLM call site that rides the default
 * got the raise for free. Issue #324 asks whether `server/tools/evaluate.ts`
 * contains any *explicit* `maxTokens` override that would opt out of that
 * sweep (an override of, say, `maxTokens: 4096` would silently cap a
 * coherence / reverse / critic eval at the old low ceiling).
 *
 * Audit outcome (measured against master SHA 2de7e1d on 2026-04-20):
 * `server/tools/evaluate.ts` contains zero `maxTokens` / `max_tokens`
 * references. The companion file `server/lib/evaluator.ts` does not call
 * Claude at all (it is pure shell-command execution).
 *
 * This test locks that invariant in place: any future edit that introduces
 * an explicit `maxTokens` override in `evaluate.ts` fails CI with a diff
 * pointer to the regression. The intent is not to forbid max-token handling
 * forever — it is to force the next author who wants one to re-open the
 * audit conversation (see issue #324 for the decision trail).
 *
 * If a legitimate reason to add an explicit `maxTokens` override emerges:
 * 1. File a follow-up issue quoting #324.
 * 2. Update this test's expected count (or remove it) in the same PR.
 * 3. Re-justify the ceiling vs. `DEFAULT_MAX_TOKENS` in the CHANGELOG.
 */

const here = dirname(fileURLToPath(import.meta.url));
const evaluateSourcePath = join(here, "evaluate.ts");

/**
 * Read `evaluate.ts` with a human-readable guardrail for the case where the
 * audit target has been moved or deleted. Without this pre-check, the test
 * throws a raw `readFileSync` ENOENT, which obscures the actionable message
 * ("audit target missing — re-scope the audit") behind a stack trace.
 * Resolves issue #359.
 */
function readAuditTarget(): string {
  if (!existsSync(evaluateSourcePath)) {
    throw new Error(
      `audit target missing: ${evaluateSourcePath} does not exist. ` +
        `If evaluate.ts was intentionally moved or renamed, update this ` +
        `test's evaluateSourcePath accordingly and re-scope the audit ` +
        `(see issue #324 for the decision trail).`,
    );
  }
  return readFileSync(evaluateSourcePath, "utf8");
}

describe("evaluate.ts max_tokens audit (issue #324)", () => {
  it("contains zero maxTokens / max_tokens references", () => {
    const source = readAuditTarget();
    // Match the Anthropic SDK option shape (`<name>:`) rather than a bare
    // substring, so that prose mentions of maxTokens inside comments or
    // JSDoc do not trip the audit. Either camelCase (TS/JS option key) or
    // snake_case (SDK raw field) in option-shape position would opt the
    // call site out of the v0.32.7 DEFAULT_MAX_TOKENS = 32000 sweep.
    // Resolves issue #357.
    const pattern = /\bmaxTokens\s*:|\bmax_tokens\s*:/g;
    const matches = source.match(pattern) ?? [];
    expect(
      matches,
      `expected zero maxTokens: / max_tokens: option-shape references in evaluate.ts, found ${matches.length}`,
    ).toHaveLength(0);
  });

  it("still contains the trackedCallClaude sites the audit was scoped around", () => {
    // Sanity check: the audit premise is that evaluate.ts HAS LLM call sites
    // but NONE of them pass maxTokens. If someone ever refactors the LLM
    // calls out of this file entirely, the premise changes and we want the
    // test to visibly break so the audit can be re-scoped rather than
    // silently still-green on a now-empty file.
    const source = readAuditTarget();
    const callSites = source.match(/trackedCallClaude\(/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(1);
  });
});
