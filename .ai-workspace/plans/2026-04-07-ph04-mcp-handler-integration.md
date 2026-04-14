# PH-04: MCP Handler, Registration, and Integration Tests

**Session:** lucky iris
**Date:** 2026-04-07
**Phase:** PH-04 (final phase of forge_generate)
**Prior:** PH-01 (PR #71, v0.13.0), PH-02 (PR #77, v0.14.0), PH-03 (PR #82, v0.15.0)

## ELI5

We built a smart helper (forge_generate) in three steps: first we taught it how to think (types + logic), then we plugged it into the monitoring system (infrastructure), then we gave it documents to read (three-tier docs). Now in this final step, we're putting a front door on it — connecting it to the MCP server so Claude Code can actually call it, and testing that everything works end-to-end.

## Approach

### US01: Expand Input Schema
- Replace the stub zod schema in `server/tools/generate.ts` with fields matching `AssembleInput`
- Fields: storyId (required), planJson, planPath, evalReport (as JSON string), iteration, maxIterations, previousScores, fileHashes, previousFileHashes, projectPath, baselineDiagnostics, isMaxUser, prdContent, masterPlanContent, phasePlanContent, contextFiles

### US02: Wire handleGenerate
- Parse input, deserialize evalReport from JSON string to object
- Call `assembleGenerateResultWithContext(input)` — the PH-02 infrastructure wrapper
- Return MCP-formatted response (JSON text content)
- Handle error: missing both planPath and planJson → isError response
- Update tool description in `index.ts` to reflect read-only brief assembler role
- Change `destructiveHint: true` to `readOnlyHint: true`

### US03: Integration Tests
- Full cycle test: init → fix → escalate (plateau after 3 identical scores)
- NFR-01: grep for callClaude in dependency chain
- NFR-02: init <5s, iteration <2s
- NFR-03: Windows path safety
- NFR-04: read-only (no file mutations)
- NFR-06: schemaVersion 3.0.0 accepted
- Error case: no plan provided

### US04: Dogfood
- Programmatically call handleGenerate with real plan data
- Document init, fix, and escalation results

## Test Cases & AC

1. `handleGenerate({storyId: "US-01", planJson: validPlan})` returns `action: "implement"` with brief — PASS/FAIL
2. `handleGenerate({storyId, planJson, evalReport: failReport, iteration: 1})` returns `action: "fix"` — PASS/FAIL
3. `handleGenerate({storyId, planJson, evalReport: failReport, previousScores: [0.5, 0.5, 0.5]})` returns `action: "escalate"` — PASS/FAIL
4. `handleGenerate({storyId: "US-01"})` (no plan) returns `isError: true` — PASS/FAIL
5. `grep -rn callClaude server/tools/generate.ts server/lib/generator.ts` finds zero matches — PASS/FAIL
6. Init call completes in <5s — PASS/FAIL
7. Fix iteration completes in <2s — PASS/FAIL
8. No colons in generated filenames — PASS/FAIL
9. Plan with schemaVersion 3.0.0 accepted — PASS/FAIL
10. `npx tsc --noEmit` succeeds — PASS/FAIL
11. `npm test` passes all tests — PASS/FAIL

## Checkpoint

- [x] Write plan file
- [x] US01: Expand generateInputSchema — 15 zod fields matching AssembleInput
- [x] US02: Wire handleGenerate + update index.ts — readOnlyHint, full description
- [x] US03: Integration tests — 23 tests covering init/fix/escalate/NFRs
- [x] US04: Dogfood report — all 3 paths verified with real plan
- [x] Full test suite passes — 383 tests, 0 failures, tsc clean
- [ ] Ship as PR
- [ ] Post-ship updates

Last updated: 2026-04-07T18:25:00Z
