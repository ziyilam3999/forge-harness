# Remaining TODO: BUG-DIV-CWD Fix + Architectural Split

**Plan:** `.ai-workspace/plans/2026-04-12-divergence-fix-and-arch-split.md` (double-critiqued, R24, finalized)
**Status:** Plan complete, implementation not started
**Date:** 2026-04-12

## Context (read this first)

- PR #148 merged (S7 divergence docs). S7 is complete.
- forge_coordinate is COMPLETE at v0.20.0, 541 tests
- BUG-DIV-CWD discovered: `server/tools/evaluate.ts` missing `cwd: input.projectPath` in TWO call sites (line ~177 story-mode, line ~350 divergence-mode)
- Architectural decision: session does LLM judgment, MCP does mechanical. Adding `reverseFindings` optional input to forge_evaluate divergence schema.

## TODO (in order)

### 1. Fix BUG-DIV-CWD (both call sites)
- `server/tools/evaluate.ts:177` — add `cwd: input.projectPath` to `evaluateStory` call in `handleStoryEval`
- `server/tools/evaluate.ts:350` — add `cwd: input.projectPath` to `evaluateStory` call in `handleDivergenceEval`
- Add regression test in `server/tools/divergence-cwd.test.ts`

### 2. Add `reverseFindings` input to forge_evaluate divergence schema
- Add Zod schema field under `// -- Divergence mode params --` after `projectPath`
- Add to `EvaluateInput` type
- Add handler branch BEFORE existing `if (input.projectPath)` block (lines 375-417)
- Validate all 5 ReverseDivergence fields: `id`, `description`, `location`, `classification` (enum), `alignsWithPrd` (boolean)
- Add 6 tests: valid input, invalid JSON, malformed shape, enum validation, empty array, both-provided precedence
- Total new tests: 7 (1 cwd + 6 reverseFindings), threshold >=548

### 3. Run reverse divergence emulation (session LLM analysis)
- Read these 3 files + PRD:
  - `server/tools/coordinate.ts`
  - `server/lib/coordinator.ts`
  - `server/types/coordinate-result.ts`
- Also read: `docs/forge-coordinate-prd.md`
- Identify implementation details NOT in PRD
- Quality gate: >=3 findings, >=2 classification values
- Produce structured `ReverseDivergence[]` JSON

### 4. Re-run forward divergence with fixed tool
- REQUIRES: `npm run build` THEN session restart (F54)
- Run forge_evaluate divergence on all 8 phase plans via MCP
- Expect 0 forward failures (mechanically validated)

### 5. Update divergence report
- Write `.ai-workspace/audits/2026-04-12-divergence-post-coordinate-v2.md`
- Combine mechanically-validated forward + session-emulated reverse
- Compare with baseline (93 -> 80 -> final)

### 6. Create GitHub issues
- OAuth 401 in MCP LLM calls (track platform limitation)
- Apply reverseFindings pattern to coherence mode

### 7. Ship PR via /ship
- Bundle: code fixes + tests + divergence report
- Branch: `fix/bug-div-cwd-and-reverse-findings`

## Key ACs (from plan)
- AC-01: `grep -n "cwd: input.projectPath" server/tools/evaluate.ts` returns 2 matches
- AC-02: Forward divergence 0 failures (after restart)
- AC-03: `grep "reverseFindings" server/tools/evaluate.ts` returns >=3 matches
- AC-04-06: reverseFindings tests (valid, invalid, malformed, enum, empty, precedence)
- AC-07: Reverse emulation >=3 findings, >=2 classifications
- AC-08: `npm test` exit 0, count >=541
- AC-09: Test count >=548

## Notes
- Step 4 requires session restart — cannot be done in same session as steps 1-3
- Steps 1-3 can be done before restart
- Step 3 (reverse emulation) can run in parallel with steps 1-2
