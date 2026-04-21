/**
 * Shared source of truth for AC subprocess-safety rules (Q0.5/A1 + A2).
 *
 * Consumers:
 *   - `server/lib/prompts/planner.ts` -- embeds AC_SUBPROCESS_RULES_PROMPT.
 *   - `server/lib/prompts/critic.ts` -- embeds AC_SUBPROCESS_RULES_PROMPT +
 *     cites AC_LINT_RULES by id in findings (Q0.5/A2).
 *   - `server/validation/ac-lint.ts` -- mechanical lint at the primitive boundary.
 *   - `server/lib/lint-audit.ts` -- calls `getAcLintRulesHash()` for staleness check (Q0.5/A3-bis).
 *
 * Do NOT duplicate these patterns elsewhere -- import from here.
 */

import { createHash } from "node:crypto";

/**
 * Shared cwd-policy prose tokens (#345).
 *
 * Each constant holds exactly one canonical phrasing that appears in the
 * LLM-facing prompt AND is asserted in tests. Instead of duplicating the
 * phrase in both the prompt template and the test file, each site imports
 * the same constant by name -- a prompt reword now requires changing exactly
 * one line, and tests automatically follow. Five tokens total; they cover
 * the cwd-policy block's load-bearing phrases.
 *
 * NOTE: prettier may split long string literals across lines. These are
 * deliberately kept on a single line so the AC-8 filter regex
 * `AC_CWD_POLICY_[A-Z_]+[[:space:]]*=` matches the assignment form. Do not
 * reflow without updating the AC-8 check.
 */
// prettier-ignore
export const AC_CWD_POLICY_MARKER = "cwd is ALREADY the project root";
// prettier-ignore
export const AC_CWD_POLICY_BASENAME_TOKEN = "cd <project-basename>";
// prettier-ignore
export const AC_CWD_POLICY_WRONG_EXAMPLE = "cd my-project && npx tsc";
// prettier-ignore
export const AC_CWD_POLICY_RIGHT_EXAMPLE = "RIGHT: `npx tsc --noEmit`";
// prettier-ignore
export const AC_CWD_POLICY_PROVENANCE = "monday-bot/monday-bot/";

/**
 * Human-readable prompt block embedded into planner/critic system prompts.
 * ASCII-only per #344: no bytes outside 0x00-0x7F anywhere in this file. Use
 * `--` for emphasis dashes (not em-dash U+2014), and plain ASCII throughout.
 * Any future edit to the rule text must happen here only.
 */
export const AC_SUBPROCESS_RULES_PROMPT = `### AC Command Contract
AC commands execute inside node:child_process.exec() with bash shell.
Environment: no TTY, no stdin, stdout/stderr captured as evidence, 30s timeout.
Working directory: ${AC_CWD_POLICY_MARKER} (the forge_evaluate \`projectPath\`
argument). Write AC commands as if you are already inside that directory -- do NOT
prefix them with \`${AC_CWD_POLICY_BASENAME_TOKEN} && ...\`. That prefix is always wrong: the
project is already the cwd, so \`cd monday-bot && npm install\` looks for
\`${AC_CWD_POLICY_PROVENANCE}\` and fails. \`cd\` into *sub-directories* of the project
(\`cd packages/foo && ...\`) is fine when genuinely needed; the rule is specifically
against re-entering the project root.
  WRONG: \`${AC_CWD_POLICY_WRONG_EXAMPLE} --noEmit\`
  ${AC_CWD_POLICY_RIGHT_EXAMPLE}
Exit code 0 = PASS, non-zero = FAIL. Design commands accordingly:
- Prefer exit-code checks over stdout parsing:
  GOOD: \`npx vitest run -t 'budget'\` (exits 0 on pass)
  BAD:  \`npx vitest run -t 'budget' 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'\`
- Never pipe then && to another grep (second grep has no stdin, hangs forever):
  BAD:  \`cmd | grep -q 'x' && ! grep -q 'y'\`
  GOOD: \`OUT=$(cmd 2>&1); echo "$OUT" | grep -q 'x' && ! echo "$OUT" | grep -q 'y'\`
- No count-based regex on test runner summary lines (format is TTY-dependent).
- 30s timeout -- keep commands focused. Use -t filters for test suites instead of running all tests.`;

/**
 * Structured deny-list rules, consumed by `lintAcCommand` and cited by critic.
 *
 * Each rule carries `wrongExample` + `rightExample` so the critic can surface
 * concrete examples in its findings (Q0.5/A2 richer-scope payoff).
 */
export interface AcLintRule {
  /** Stable identifier, e.g. "F55-vitest-count-grep". */
  id: string;
  /** One-line human explanation. */
  description: string;
  /** Regex applied to the full AC command string. */
  pattern: RegExp;
  /** Severity -- only "suspect" for now (scope of A1/A2). */
  severity: "suspect";
  /** Concrete WRONG example that this rule flags. */
  wrongExample: string;
  /** Concrete RIGHT example that demonstrates the safe alternative. */
  rightExample: string;
}

export const AC_LINT_RULES: AcLintRule[] = [
  {
    id: "F55-vitest-count-grep",
    description:
      "count-based vitest summary grep (TTY-dependent; use exit-code -t filter instead)",
    // Matches `grep -qE 'Tests[[:space:]]+[5-9]'` and digit-count variants.
    pattern:
      /grep\s+-[a-zA-Z]*E[a-zA-Z]*\s+['"][^'"]*Tests\s*(?:\[\[:space:\]\]|\\s|\s)\+[^'"]*[0-9][^'"]*['"]/,
    severity: "suspect",
    wrongExample:
      "npx vitest run foo.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'",
    rightExample: "npx vitest run -t 'budget'",
  },

  {
    id: "F56-multigrep-pipe",
    description:
      "multi-grep pipeline chained with `&&`/`||`/`;` where the second grep has no stdin (hangs or false-passes)",
    // Q0.5/A2 MINOR-4 fix: accept && | || | ; as the chain operator.
    pattern:
      /\|\s*grep\s+-[a-zA-Z]*q[a-zA-Z]*\s+['"][^'"]*['"]\s*(?:&&|\|\||;)\s*!?\s*grep\s+-[a-zA-Z]*q/,
    severity: "suspect",
    wrongExample: "cmd | grep -q 'x' && ! grep -q 'y'",
    rightExample:
      "OUT=$(cmd 2>&1); echo \"$OUT\" | grep -q 'x' && ! echo \"$OUT\" | grep -q 'y'",
  },

  {
    id: "F55-passed-grep",
    description:
      "lone `grep -q 'passed'/'failed'` on runner output (TTY-dependent summary line; includes unquoted + regex-alt forms)",
    // Q0.5/A2 MINOR-5 fix: also match `grep -qE 'passed|failed'`, unquoted
    // `grep -q passed`, and any quoted arg containing the bare word `passed`
    // or `failed`.
    pattern:
      /\|\s*grep\s+-[a-zA-Z]*q[a-zA-Z]*\s+(?:['"][^'"]*\b(?:passed|failed)\b[^'"]*['"]|(?:passed|failed)\b)/,
    severity: "suspect",
    wrongExample: "npx vitest run 2>&1 | grep -q 'passed'",
    rightExample: "npx vitest run -t 'foo'",
  },

  {
    id: "F36-source-tree-grep",
    description:
      "grep inspecting source tree (src/, server/, lib/) instead of verifying observable behavior",
    // Q0.5/A2 MAJOR-2 fix: structural anchoring. Require the path token to
    // appear as a DIRECT grep argument -- flags, optional quoted pattern,
    // then (src|server|lib)/path -- NOT as trailing text anywhere after grep.
    // This rejects benign chains like
    //   `grep -q 'ok' out.log && curl localhost/src/main.js`
    // (where `src/` is inside a URL, not a grep arg), while still matching
    //   `grep -n 'callClaude\|trackedCallClaude' server/lib/coordinator.ts`
    // (where `\|` appears inside a quoted grep pattern -- the OLD lazy
    //  `[^\n;]*?` span was too permissive and couldn't reject the &&/|| case).
    pattern:
      /\bgrep\b(?:\s+-[A-Za-z]+)*\s+(?:['"][^'"]*['"]\s+)?(?:src|server|lib)\/[A-Za-z0-9_\-./]*/,
    severity: "suspect",
    wrongExample: "grep -rn 'Redis' src/",
    rightExample: "curl localhost:3000/api | jq '.cache'",
  },

  {
    id: "F36-raw-rg",
    description:
      "raw `rg` (ripgrep) invocation -- portability risk and source-inspection anti-pattern",
    // Q0.5/A2 MINOR-3 fix: also match bare-word arguments
    // (`rg pattern server/`), not just quoted-or-flag forms. Negative
    // lookahead allows `rg --help` / `rg --version` through (those are
    // ergonomic probes, not source inspection). `rg` must be a standalone
    // command token (start-of-line, or after `|`/`;`/`&`).
    pattern: /(?:^|[|;&]\s*)rg\s+(?!--(?:help|version)\b)\S+/,
    severity: "suspect",
    wrongExample: "rg 'class UserCache' server/",
    rightExample: "curl localhost:3000/api/classes | jq '.UserCache'",
  },

  {
    id: "F57-cd-basename",
    description: `${AC_CWD_POLICY_BASENAME_TOKEN} && ... prefix (${AC_CWD_POLICY_MARKER}; re-entering produces basename/basename/ and fails)`,
    // Matches `cd <single-segment> && <cmd>` where the segment contains no
    // `/` -- that is, a project-root basename re-entry. Subdirectory cd
    // (`cd packages/foo && ...`) is fine and intentionally NOT flagged
    // because the path token contains a `/`. The pattern requires the cd
    // to be a standalone command token (start-of-line, or after `|`/`;`/`&`/`(`).
    pattern: /(?:^|[|;&(]\s*)cd\s+[A-Za-z0-9._-]+\s*&&\s*\S/,
    severity: "suspect",
    wrongExample: `${AC_CWD_POLICY_WRONG_EXAMPLE} --noEmit`,
    rightExample: "npx tsc --noEmit",
  },
];

/**
 * Q0.5/A3-bis -- Stable hash over the live rule surface. Used by `lint-audit`
 * to detect rule-set drift since an exemption was last reviewed. Cached for
 * the process lifetime: the underlying constants are module-frozen, so the
 * hash cannot change after the first call.
 */
let cachedHash: string | null = null;
export function getAcLintRulesHash(): string {
  if (cachedHash !== null) return cachedHash;
  const serializedRules = JSON.stringify(
    AC_LINT_RULES.map((r) => ({
      id: r.id,
      description: r.description,
      pattern: r.pattern.source,
      severity: r.severity,
      wrongExample: r.wrongExample,
      rightExample: r.rightExample,
    })),
  );
  cachedHash = createHash("sha256")
    .update(AC_SUBPROCESS_RULES_PROMPT)
    .update("\u0000")
    .update(serializedRules)
    .digest("hex");
  return cachedHash;
}

/** Test-only: reset the module-local hash cache. Prefixed with `__` so it is
 *  clearly not part of the production API. */
export function __resetAcLintRulesHashCache(): void {
  cachedHash = null;
}
