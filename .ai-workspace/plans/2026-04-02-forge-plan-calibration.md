# Forge Plan Calibration — Fix D1 & D2 Planner Prompt Deficiencies

## Context

During Phase 2 dogfooding, two forge_plan deficiencies were discovered during AC verification (not caught by the internal critic-corrector loop or external /double-critique):

- **D1 (MINOR):** AC command checks `includes('timeout')` but the code's evidence said "timed out" (since fixed to "Command timeout"). Root cause: the planner didn't verify the AC's assertion substring matches the code's actual output format.
- **D2 (MAJOR):** ACs that import from `./dist/` lack `npm run build &&` prefix. They depend on a stale build artifact and fail in a clean environment.

Both are systematic gaps in the planner prompt (`server/lib/prompts/planner.ts`). Fixing them prevents the same class of errors in Phase 3+.

## ELI5

The recipe-writing robot made two types of mistakes: (1) it wrote a test that checks for a word the code doesn't actually say, and (2) it wrote tests that need a compiled file but forgot to include the compile step. We're teaching the robot to not make these mistakes again.

---

## Changes

### File: `server/lib/prompts/planner.ts`

Add two new rules to the `### Acceptance Criteria Rules` section in `buildPlannerPrompt()`:

**Rule for D1 — Evidence format matching:**
```
- When an AC command checks the output/evidence of another command (e.g., `r.evidence.includes('...')`),
  the checked substring must exactly match what the code will produce. Do not assume wording —
  if the code says "timed out", the AC must check for "timed out", not "timeout".
```

**Rule for D2 — Build prerequisites:**
```
- If an AC command imports from a build output directory (e.g., `./dist/`, `./build/`),
  the command must include the build step as a prerequisite (e.g., `npm run build && node ...`).
  Without this, the AC fails in a clean environment where the build output doesn't exist.
```

### File: `server/lib/prompts/planner.test.ts` (if exists) or `server/tools/plan.test.ts`

Add two test cases verifying the new rules appear in the planner prompt output:
- Test that the prompt contains "build output directory" or equivalent guidance
- Test that the prompt contains "exactly match" or equivalent guidance for evidence checking

---

## Test Cases & AC

| AC | Description | Command |
|----|-------------|---------|
| AC-01 | Planner prompt contains build prerequisite rule | `grep -q 'build output' server/lib/prompts/planner.ts \|\| grep -q 'build step' server/lib/prompts/planner.ts && echo PASS` |
| AC-02 | Planner prompt contains evidence matching rule | `grep -q 'exactly match' server/lib/prompts/planner.ts \|\| grep -q 'exact.*match' server/lib/prompts/planner.ts && echo PASS` |
| AC-03 | TypeScript compiles | `npx tsc --noEmit && echo PASS` |
| AC-04 | All tests pass | `npx vitest run && echo PASS` |

---

## Checkpoint

- [x] Add D2 rule (build prerequisites) to planner prompt
- [x] Add D1 rule (evidence format matching) to planner prompt
- [x] Add 2 test cases verifying new rules in plan.test.ts
- [x] Verify AC-01 through AC-04 (all pass, 98 tests)
- [x] Ship as separate PR via `/ship` — PR #27 merged, released v0.4.1

Last updated: 2026-04-02T22:00+08:00
