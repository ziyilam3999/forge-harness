/**
 * Shared source of truth for AC subprocess-safety rules (Q0.5/A2).
 *
 * Both `planner.ts` (generation-time embedding in the LLM prompt) and
 * `server/validation/ac-lint.ts` (mechanical lint at the primitive boundary)
 * import from this file. This prevents the rule-parity gap that let
 * PH01-US-06 ship with TTY-dependent greps — there is now exactly one place
 * where the rules live.
 *
 * `critic.ts` will also import from this file when Q0.5/A2 (critic-prompt
 * update) ships. That's a separate PR.
 *
 * Do NOT duplicate these patterns elsewhere — import from here.
 */

/**
 * Human-readable prompt block embedded into planner/critic system prompts.
 * This is the BYTE-IDENTICAL extraction of planner.ts:272-283's
 * "AC Command Contract" section. Any future edit to the rule text must
 * happen here and here only.
 */
export const AC_SUBPROCESS_RULES_PROMPT = `### AC Command Contract
AC commands execute inside node:child_process.exec() with bash shell.
Environment: no TTY, no stdin, stdout/stderr captured as evidence, 30s timeout.
Exit code 0 = PASS, non-zero = FAIL. Design commands accordingly:
- Prefer exit-code checks over stdout parsing:
  GOOD: \`npx vitest run -t 'budget'\` (exits 0 on pass)
  BAD:  \`npx vitest run -t 'budget' 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'\`
- Never pipe then && to another grep (second grep has no stdin, hangs forever):
  BAD:  \`cmd | grep -q 'x' && ! grep -q 'y'\`
  GOOD: \`OUT=$(cmd 2>&1); echo "$OUT" | grep -q 'x' && ! echo "$OUT" | grep -q 'y'\`
- No count-based regex on test runner summary lines (format is TTY-dependent).
- 30s timeout — keep commands focused. Use -t filters for test suites instead of running all tests.`;

/**
 * Structured deny-list rules, consumed by `lintAcCommand`.
 *
 * Each rule's `pattern` is anchored conservatively so it does NOT false-positive
 * on benign commands like `echo 'passed'` or `jq '.passed'`. The anchoring
 * strategy is: match only when the offending construct appears as a shell
 * token (word-boundary `grep`/`rg`) with the specific flag/argument shape
 * that produces the failure mode.
 */
export interface AcLintRule {
  /** Stable identifier, e.g. "F55-vitest-count-grep". */
  id: string;
  /** One-line human explanation. */
  description: string;
  /** Regex applied to the full AC command string. */
  pattern: RegExp;
  /** Severity — only "suspect" for now (scope of A1). */
  severity: "suspect";
}

export const AC_LINT_RULES: AcLintRule[] = [
  /**
   * F55 — count-based vitest summary grep.
   *
   * Wrong: `npx vitest run foo.test.ts 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'`
   * Right: `npx vitest run -t 'budget'` (relies on exit code, no stdout parsing)
   *
   * The vitest summary line "Tests  5 passed" is TTY-dependent; in
   * child_process.exec() (no TTY) the formatting or even the line itself
   * may be absent, so the grep silently returns "no match" (exit 1) and
   * the AC spuriously fails. We match the characteristic
   * `Tests[[:space:]]+<digit-range>` regex that F55 uses.
   */
  {
    id: "F55-vitest-count-grep",
    description:
      "count-based vitest summary grep (TTY-dependent; use exit-code -t filter instead)",
    pattern:
      /grep\s+-[a-zA-Z]*E[a-zA-Z]*\s+['"][^'"]*Tests\s*(?:\[\[:space:\]\]|\\s|\s)\+[^'"]*[0-9][^'"]*['"]/,
    severity: "suspect",
  },

  /**
   * F56 — multi-grep pipeline with `&&`.
   *
   * Wrong: `cmd | grep -q 'x' && ! grep -q 'y'`
   * Wrong: `cmd | grep -q 'x' && grep -q 'y'`
   * Right: `OUT=$(cmd 2>&1); echo "$OUT" | grep -q 'x' && ! echo "$OUT" | grep -q 'y'`
   *
   * The second grep in the `&&` chain has no stdin (the pipeline ended at
   * the first grep), so on a system with no TTY it blocks waiting for
   * stdin → hung process or spurious match depending on buffering.
   *
   * We require a pipe `|` before the first grep (so this is not a
   * standalone grep on a file argument) and a `&& ` then optional `!` then
   * another `grep -q` without an intervening `echo` / input source.
   */
  {
    id: "F56-multigrep-pipe",
    description:
      "multi-grep `&&` pipeline where the second grep has no stdin (hangs or false-passes)",
    pattern:
      /\|\s*grep\s+-[a-zA-Z]*q[a-zA-Z]*\s+['"][^'"]*['"]\s*&&\s*!?\s*grep\s+-[a-zA-Z]*q/,
    severity: "suspect",
  },

  /**
   * F56 variant — lone `grep -q 'passed'` / `grep -q 'failed'` on runner output.
   *
   * Wrong: `npx vitest run 2>&1 | grep -q 'passed'`
   * Wrong: `cmd | grep -q 'failed'`
   * Right: `npx vitest run -t 'foo'` (exit-code check)
   *
   * Matches a pipe-into-grep-q on the literal tokens `passed` or `failed`.
   * The benign case `echo 'passed'` is NOT matched because there's no
   * preceding pipe into the grep. `jq '.passed'` is NOT matched because
   * the tool name is `jq`, not `grep`.
   */
  {
    id: "F56-passed-grep",
    description:
      "lone `grep -q 'passed'/'failed'` on runner output (TTY-dependent summary line)",
    pattern:
      /\|\s*grep\s+-[a-zA-Z]*q[a-zA-Z]*\s+['"](?:passed|failed)['"]/,
    severity: "suspect",
  },

  /**
   * F36 — source-tree grep (recursive).
   *
   * Wrong: `grep -rn 'Redis' src/`
   * Wrong: `grep -n 'foo' server/lib/bar.ts server/lib/baz.ts`
   * Right: `curl localhost:3000/api | jq '.cache'` (observable behavior)
   *
   * ACs must not inspect source code — they verify observable behavior.
   * This matches both recursive `grep -rn` on a directory path AND the
   * PH01-US-06-AC04 pattern of enumerating individual files under
   * `src/` / `server/` / `lib/`.
   */
  {
    id: "F36-source-tree-grep",
    description:
      "grep inspecting source tree (src/, server/, lib/) instead of verifying observable behavior",
    pattern:
      /\bgrep\b[^\n;]*?(?:\s|["'])(?:src|server|lib)\/[A-Za-z0-9_\-./]*/,
    severity: "suspect",
  },

  /**
   * F36 — raw `rg` (ripgrep) invocation.
   *
   * Wrong: `rg 'class UserCache' server/`
   * Right: Use `grep` only for evidence-checking output, not source inspection.
   *
   * ripgrep is not guaranteed to be installed on the machine running the
   * AC (especially in lean CI containers). Plus — same source-inspection
   * anti-pattern as F36-source-tree-grep.
   *
   * Match `rg` as a standalone command token (start of line, after `|`,
   * after `;`, or after `&&`) followed by a flag or quoted pattern. We
   * reject leading-word matches like `rg` inside an identifier or path.
   */
  {
    id: "F36-raw-rg",
    description:
      "raw `rg` (ripgrep) invocation — portability risk; rg may not be installed",
    pattern: /(?:^|[|;&]\s*)rg\s+(?:-[a-zA-Z]|['"])/,
    severity: "suspect",
  },
];
