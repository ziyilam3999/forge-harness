# Plan: AC Authoring Guidelines for Subprocess Safety

> **SUPERSEDED 2026-04-12** by `.ai-workspace/plans/2026-04-12-next-execution-plan.md` §Q0.5.
> Reason: Per hive-mind-persist P60 (Build for the Consumer, Not the Author), docs/ files built "for agents" have ~0% compliance. The rules belong in the prompt. This plan's `docs/ac-authoring-guide.md` output has been cut entirely; the rules now live in `server/lib/prompts/shared/ac-subprocess-rules.ts` (Q0.5/A2), imported by both `planner.ts` and `critic.ts` as a single source of truth. Do not execute this plan's checkpoint items — they have been replaced by Q0.5's A1/A2 architecture.


## ELI5

When forge_evaluate runs an AC command, it doesn't open a real terminal — it runs the command in a headless subprocess (like running something through a walkie-talkie instead of face-to-face). Some commands behave differently without a "real screen" (no TTY). We got bitten twice: once by vitest printing differently, once by grep waiting for input that never comes. This plan adds a short reference doc so future plan authors don't repeat the same mistakes.

## Context

- **F-55:** AC grep regex on vitest count-based output fails in non-TTY subprocess (format differs)
- **F-56:** `cmd | grep -q 'x' && ! grep -q 'y'` hangs forever — second grep has no stdin
- **Current state:** PRD has inline portability notes (grep flags, line 575) but no dedicated AC authoring guide
- **Executor:** `node:child_process.exec` with bash shell, no TTY, stdout/stderr captured, exit-code determines PASS/FAIL

## Scope

One new document + one PRD cross-reference. No code changes.

## Changes

### File 1: `docs/ac-authoring-guide.md` (new)

A focused reference for anyone writing AC `command` fields in phase plan JSON files. Sections:

1. **How AC commands execute** — 3-sentence summary of the executor: bash subprocess, no TTY, exit 0 = PASS, non-zero = FAIL, 30s timeout, stdout captured as evidence
2. **Rules** (6 rules, each with a Wrong/Right example pair per F8):
   - **R1: Exit code is king** — design commands where exit code alone determines pass/fail. Don't rely on stdout parsing when exit code suffices.
     - Wrong: `npx vitest run -t 'foo' 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'` (TTY-dependent format)
     - Right: `npx vitest run -t 'foo'` (vitest exits 0 on pass, 1 on fail) — BUT note vitest exits 0 when `-t` matches no tests, so pair with a match check when the test name pattern could miss
   - **R2: Capture before multi-grep** — never pipe to grep then `&&`/`||` to another grep. The second grep has no stdin.
     - Wrong: `cmd 2>&1 | grep -q 'passed' && ! grep -q 'failed'`
     - Right: `OUT=$(cmd 2>&1); echo "$OUT" | grep -q 'passed' && ! echo "$OUT" | grep -qE '[0-9]+ failed'`
   - **R3: No count-based regex on formatted output** — test runner summary lines vary by TTY, ANSI codes, locale, and version.
     - Wrong: `grep -qE 'Tests[[:space:]]+[5-9]|Tests[[:space:]]+[0-9]{2,}'`
     - Right: `grep -qE '[0-9]+ passed'` (looser match) or use `--reporter=json` for machine-readable output
   - **R4: Test your AC in subprocess context** — before shipping an AC, verify it works headless:
     - `node -e "require('child_process').execSync('YOUR_COMMAND', {stdio: 'pipe'})"`
     - If it works in terminal but fails here, it's TTY-dependent
   - **R5: Windows portability** — use `grep -n` (not `-rn`) for explicit file lists; use `-rn` for directory scans; avoid `rg` (not available on all CI); backslash-escape `|` in grep alternation or use `-E` flag
   - **R6: Timeout awareness** — default is 30s. Long-running commands (full test suite, builds) should be broken into focused `-t` filtered runs. If a command hangs, forge_evaluate kills it at 30s and reports FAIL.
3. **Quick reference table** — one-row-per-rule summary for scanning

### File 2: `docs/forge-coordinate-prd.md` (modify)

Add a single line in the AC conventions section (near line 575) pointing to the new guide:

```
For detailed AC command authoring rules (subprocess safety, TTY, Windows), see `docs/ac-authoring-guide.md`.
```

## Test Cases & AC

| # | AC | Binary check |
|---|-----|-------------|
| 1 | `docs/ac-authoring-guide.md` exists | `test -f docs/ac-authoring-guide.md` |
| 2 | Guide contains all 6 rules (R1-R6) | `grep -c '^.*R[1-6]:' docs/ac-authoring-guide.md` returns 6 |
| 3 | Each rule has a Wrong/Right example pair | `grep -c 'Wrong:' docs/ac-authoring-guide.md` returns ≥6 AND `grep -c 'Right:' docs/ac-authoring-guide.md` returns ≥6 |
| 4 | Guide mentions F-55 and F-56 by ID | `grep -q 'F-55' docs/ac-authoring-guide.md && grep -q 'F-56' docs/ac-authoring-guide.md` |
| 5 | PRD cross-references the guide | `grep -q 'ac-authoring-guide' docs/forge-coordinate-prd.md` |
| 6 | No code changes (docs only) | `git diff --name-only` shows only `.md` files |

## Checkpoint

- [ ] Write `docs/ac-authoring-guide.md`
- [ ] Add cross-reference in PRD
- [ ] Verify all 6 ACs pass
- [ ] Ship via `/ship`

Last updated: 2026-04-10
