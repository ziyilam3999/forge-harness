# Plan: PH-02 Infrastructure Integration for forge_generate

## ELI5

forge_generate already knows how to build briefs and make stopping decisions (PH-01). Now we're giving it a diary (JSONL self-tracking), a progress bar (ProgressReporter), a receipt book (AuditLog), and a price tag (CostEstimate). If any of these tools break, forge_generate still does its job — the diary/progress/receipts are nice-to-haves, not gatekeepers.

## Architecture

### Current state (PH-01)
`assembleGenerateResult(input)` is a pure function: takes AssembleInput, returns GenerateResult. No side effects beyond scanCodebase file reads.

### Target state (PH-02)
Wrap with infrastructure in a new top-level entry point:

```
assembleGenerateResultWithContext(input) {
  startTime = Date.now()
  ctx = new RunContext({ toolName: 'forge_generate', ... })
  ctx.progress.begin(stageName)
  
  result = assembleGenerateResult(input)   // existing pure logic, unchanged
  
  ctx.progress.complete(stageName)
  result.costEstimate = computeCostEstimate(result, input)
  await ctx.audit.log({ action taken })
  await writeRunRecord(projectPath, { timestamp, storyId, ... })
  
  return result
}
```

Key principle: the existing `assembleGenerateResult` stays pure. Infrastructure is layered on top via a new wrapper function. This preserves all 46 existing tests unchanged.

### NFR-05: Graceful degradation
Every infrastructure call (audit, JSONL, cost) is wrapped in try/catch. Failures log to stderr and continue. The core `assembleGenerateResult` result is always returned.

## Stories

### PH02-US01: RunContext wiring
- Create `RunContext({ toolName: 'forge_generate', projectPath, stages: ['init'] or ['iterate'] })`
- `progress.begin('init'|'iterate')` before core logic, `.complete()` after
- `audit.log({ stage, agentRole: 'generator', decision: action, reasoning })` after result
- CostTracker wired but records $0 (no API calls)
- Audit file: `.forge/audit/forge_generate-*.jsonl`

### PH02-US02: JSONL self-tracking
- New helper: `writeRunRecord(projectPath, record)` → appends to `.forge/runs/data.jsonl`
- Record fields: `{ timestamp, storyId, iteration, action, score, durationMs }`
- `score`: from fixBrief.score if fix action, from evalReport if available, else null
- No projectPath → skip silently
- Write failure → console.error + continue

### PH02-US03: Cost estimation
- `computeCostEstimate(result, input)` → `CostEstimate`
- `briefTokens`: serialize brief/fixBrief/escalation to string, count chars / 4
- `projectedIterationCostUsd`: briefTokens * (Opus input $15/M + assume equal output) = briefTokens * $90/M
  - For Max users (default): $0
  - Add `isMaxUser?: boolean` to AssembleInput (default true)
- `projectedRemainingCostUsd`: projectedIterationCostUsd * (maxIterations - iteration)
- Failure → return undefined costEstimate, no error

## Test Cases & AC

### PH02-US01 tests
- `RunContext created with toolName 'forge_generate'`: call assembleGenerateResultWithContext, verify RunContext was constructed with correct toolName — **PASS: constructor called with 'forge_generate'**
- `ProgressReporter stage 'init' reported on init call`: verify progress.begin('init') called for iteration 0 — **PASS: begin('init') called**
- `ProgressReporter stage 'iterate' reported on fix call`: verify progress.begin('iterate') called for iteration > 0 — **PASS: begin('iterate') called**
- `AuditLog entry written with action`: verify audit.log called with decision matching result.action — **PASS: audit.log called with {decision: 'implement'}**
- `CostTracker records $0`: verify ctx.cost.totalCostUsd is 0 or null (no recordUsage calls) — **PASS: totalCostUsd === 0 or null**
- `Audit file created at .forge/audit/forge_generate-*.jsonl`: call with projectPath pointing to temp dir, verify file exists — **PASS: file matching glob exists**

### PH02-US02 tests
- `JSONL line written after call with projectPath`: call with projectPath, read data.jsonl, verify 1 line — **PASS: 1 line in file**
- `JSONL line contains required fields`: parse line, check timestamp, storyId, iteration, action, score, durationMs all present — **PASS: all 6 fields present**
- `JSONL append-only (multiple calls)`: call twice, verify 2 lines — **PASS: 2 lines**
- `No JSONL when projectPath not set`: call without projectPath, verify no file created — **PASS: no file at path**
- `JSONL write failure degrades gracefully`: mock appendFile to throw, verify result still returned — **PASS: result.action defined despite write failure**

### PH02-US03 tests
- `costEstimate.briefTokens computed as char_count/4`: build brief, measure char length, verify briefTokens ≈ length/4 — **PASS: briefTokens === Math.ceil(charCount/4)**
- `projectedIterationCostUsd based on Opus pricing (non-Max)`: set isMaxUser: false, verify cost > 0 — **PASS: cost > 0**
- `projectedRemainingCostUsd = perIteration * (max - current)`: verify math — **PASS: remaining === iteration * (max - current)**
- `Cost estimation graceful on failure`: mock JSON.stringify to throw for cost path, verify result returned without costEstimate — **PASS: result.action defined, costEstimate undefined**
- `For Max users, projectedIterationCostUsd is $0`: default call, verify cost === 0 — **PASS: projectedIterationCostUsd === 0**

## Checkpoint

- [ ] Write plan
- [ ] PH02-US01: Wire RunContext + progress + audit + cost tracker
- [ ] PH02-US02: JSONL self-tracking
- [ ] PH02-US03: Cost estimation
- [ ] All tests pass (326 existing + new)
- [ ] Ship as PR
- [ ] Post-ship updates (sessions plan, backlog, /coherent-plan)

Last updated: 2026-04-07T18:00:00+08:00
