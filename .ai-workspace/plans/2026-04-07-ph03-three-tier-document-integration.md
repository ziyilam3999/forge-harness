# PH-03: Three-Tier Document Integration

## ELI5
When forge_generate builds a "brief" (instructions for Claude Code), it currently only knows about the codebase and the story. PH-03 teaches it about the **project's document hierarchy** — the PRD (why), master plan (what), and phase plan (how) — plus lets callers inject extra context files. Think of it as giving the brief assembler a bigger backpack of reference materials.

## Stories

### PH03-US01: Document Context (REQ-09)
- Add `prdContent`, `masterPlanContent`, `phasePlanContent` to `AssembleInput`
- Add `BuildBriefOptions` interface, pass as 4th param to `buildBrief`
- When any provided → `brief.documentContext = { prdContent, masterPlanContent, phasePlanContent }`
- When none provided → `brief.documentContext` is `undefined` (no error)
- `assembleGenerateResult` forwards the fields from `AssembleInput` to `buildBrief`

### PH03-US02: Context Injection (REQ-10)
- Add `contextFiles?: string[]` to `AssembleInput` and `BuildBriefOptions`
- `buildBrief` reads each file, collects contents into `brief.injectedContext`
- Missing files skipped with `console.warn` (not an error)
- Empty array / omitted → no injected context, no error

### PH03-US03: Lineage Pass-Through (REQ-11)
- Already implemented: `buildBrief` returns `lineage: story.lineage`
- Add dedicated test coverage to lock it down (with lineage, without lineage, pass-through not inference)

## Test Cases & AC

| ID | Test | Pass criteria |
|----|------|--------------|
| US01-T1 | Call `buildBrief` with `prdContent` set | `brief.documentContext.prdContent` equals input |
| US01-T2 | Call with all three doc fields | All three appear in `brief.documentContext` |
| US01-T3 | Call with no doc fields | `brief.documentContext` is `undefined` |
| US01-T4 | Call via `assembleGenerateResult` with doc fields | `result.brief.documentContext` populated |
| US02-T1 | Call `buildBrief` with `contextFiles` pointing to real files | `brief.injectedContext` contains file contents |
| US02-T2 | Call with a mix of existing and non-existent files | Existing read, missing skipped, warning logged |
| US02-T3 | Call with empty array | `brief.injectedContext` is `undefined` |
| US02-T4 | Call with no `contextFiles` | `brief.injectedContext` is `undefined` |
| US03-T1 | Story has lineage → `brief.lineage` matches | `brief.lineage` equals `story.lineage` |
| US03-T2 | Story has no lineage → `brief.lineage` absent | `brief.lineage` is `undefined` |
| US03-T3 | Lineage is pass-through only (value matches plan exactly) | Exact object equality |
| REGR-T1 | All 343 existing tests pass | `npx vitest run` exits 0 |

## Checkpoint
- [ ] PH03-US01: Document context implementation + tests
- [ ] PH03-US02: Context injection implementation + tests
- [ ] PH03-US03: Lineage pass-through tests
- [ ] Full test suite green (343 + new)
- [ ] Ship PR
- [ ] Update backlog and session plan

Last updated: 2026-04-07T00:00:00Z
