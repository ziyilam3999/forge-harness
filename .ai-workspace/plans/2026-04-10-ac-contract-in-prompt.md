# Plan: AC Subprocess Contract in forge_plan Prompt

## ELI5

When forge_plan generates a plan, the LLM writes shell commands for each acceptance criterion. Those commands run in a headless subprocess (no screen, no keyboard). If the LLM doesn't know that, it writes commands that break. Fix: tell the LLM the rules right in the prompt, so it can't miss them.

## Context

- **F-55/F-56:** Two AC command patterns that break in forge_evaluate's subprocess (TTY-dependent output, stdin-less grep)
- **Current state:** No AC authoring rules exist anywhere forge_plan's LLM can see them
- **Root cause:** The AC subprocess contract is undocumented at the point of authorship (the prompt)
- **Anti-pattern match:** F2 — behavioral prose without consequences. A docs/ file is prose; a prompt injection is enforcement by construction

## Scope

One code change to `server/tools/plan.ts` — inject the AC subprocess contract into the plan generation prompt. No new files.

## Changes

### File 1: `server/tools/plan.ts` (modify)

Find the prompt assembly section where the LLM is instructed to generate stories with acceptance criteria. Add an `## AC Command Contract` block to the system/user prompt:

```
## AC Command Contract

AC commands execute inside `node:child_process.exec()` with bash shell.
Environment: no TTY, no stdin, stdout/stderr captured as evidence, 30s timeout.
Exit code 0 = PASS, non-zero = FAIL. Design commands accordingly:

1. Prefer exit-code checks over stdout parsing:
   GOOD: `npx vitest run -t 'budget'` (exits 0 on pass)
   BAD:  `npx vitest run -t 'budget' 2>&1 | grep -qE 'Tests[[:space:]]+[5-9]'`

2. Never pipe then && to another grep (second grep has no stdin, hangs forever):
   BAD:  `cmd | grep -q 'x' && ! grep -q 'y'`
   GOOD: `OUT=$(cmd 2>&1); echo "$OUT" | grep -q 'x' && ! echo "$OUT" | grep -q 'y'`

3. No count-based regex on test runner summary lines (format is TTY-dependent).

4. Use grep -n (not -rn) for explicit file lists; -rn for directory scans.
```

**Placement:** Immediately before or within the section that instructs the LLM to generate `acceptanceCriteria` arrays. The exact insertion point depends on the current prompt structure — read `server/tools/plan.ts` to find it.

### No other files

- ~~`docs/ac-authoring-guide.md`~~ — cut (no agent reads docs/ at authoring time)
- ~~PRD cross-reference~~ — cut (unnecessary)

## Test Cases & AC

| # | AC | Binary check |
|---|-----|-------------|
| 1 | Plan generation prompt contains "AC Command Contract" | `grep -q 'AC Command Contract' server/tools/plan.ts` |
| 2 | Prompt mentions no-TTY constraint | `grep -q 'no TTY' server/tools/plan.ts` |
| 3 | Prompt includes the captured-output pattern (GOOD example) | `grep -q 'OUT=\$(cmd' server/tools/plan.ts` |
| 4 | Prompt warns against pipe-then-&& pattern (BAD example) | `grep -q 'hangs forever' server/tools/plan.ts` |
| 5 | No new files created (prompt-only change) | No new files in `git diff --name-only` |
| 6 | Existing tests still pass | `npx vitest run` exits 0 |

## Checkpoint

- [x] Read `server/tools/plan.ts` to find prompt assembly point → prompts in `server/lib/prompts/planner.ts`
- [x] Insert AC Command Contract block → after existing AC rules, before mode-specific rules
- [x] Verify all 6 ACs pass → AC1-AC4 grep checks pass, AC5 no new files, AC6 444/444 tests
- [x] Ship via `/ship` → PR #134 merged, v0.17.1 released

Last updated: 2026-04-10
