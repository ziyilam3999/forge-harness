# PR #175 Review (B1 smoke-test)

## Verdict

PASS

## Findings

### 1 minor — completeness invariant breaks if executor throws mid-sweep

File: `server/lib/smoke-runner.ts:148-171` (the `await executor(...)` call and surrounding try-less block)
The loop pushes exactly one entry per AC on both branches (skipped-suspect and normal), satisfying the documented invariant on the happy path. However, `await executor(ac.command, ...)` has no try/catch and the header comment explicitly says "let it throw". If `smokeExecute` rejects (e.g., win32 `resolveWindowsBashPath()` throw, or any unexpected future failure), `smokeTestPlan` rejects with a partially-filled `entries` array that silently violates the `entries.length === ac count` invariant advertised to callers. For B1 this is acceptable (the sidecar write happens in `handleSmokeTest` only on success), but a caller reading `report.entries` from a rejected promise via a wrapper would see the invariant lie. Suggest either (a) wrapping the executor call and pushing a synthetic `empty-evidence`/error entry on throw, or (b) tightening the JSDoc to state that rejection invalidates the invariant.

### 2 minor — invalid-but-present `smokeTimeoutMs` is treated as author consent

File: `server/lib/smoke-runner.ts:125-127` (`hadExplicitOverride` computation)
`hadExplicitOverride` is `ac.smokeTimeoutMs !== undefined && ac.smokeTimeoutMs !== null`. This means `smokeTimeoutMs: 0`, `smokeTimeoutMs: -5`, or `smokeTimeoutMs: NaN` all count as "author opted in to a larger budget" and suppress `timeoutRisk` on slow verdicts — even though `clampSmokeTimeoutMs` collapses all of them back to the 30s default. A typo like `smokeTimeoutMs: 0` gets the default budget AND loses the slow-verdict warning, the worst of both worlds. Review checklist explicitly flagged this as the judgment call. The safer interpretation is: only positive-finite values that actually survive clamping count as consent. Suggest computing `hadExplicitOverride` as `typeof ac.smokeTimeoutMs === "number" && Number.isFinite(ac.smokeTimeoutMs) && ac.smokeTimeoutMs > 0`. Not blocking, but the current behavior is a footgun.

### 3 minor — Windows warmup pegs the first plan AC, not the first spawned AC

File: `server/lib/smoke-runner.ts:131-137` (`isFirstAc` / `applyWindowsWarmup`)
`isFirstAc` is based on plan index (`acIndex === 0` for the very first AC in the first story). If that AC is lint-flagged and becomes `skipped-suspect`, no shell is spawned for it — but `isFirstAc` is consumed and discarded. The actual first spawn then happens on AC index 1, which pays the Windows cold-start but does NOT get the 800ms subtraction. Test 17 (PH-01 fixture) hits this exact pattern: AC01 is lint-skipped, AC02 is the first real spawn. On win32 CI, AC02's `elapsedMs` will be reported inclusive of cold-start. Only affects reporting accuracy in the specific "first AC lint-flagged on win32" case; AC02 is a hung verdict in test 17 so it doesn't break the assertion. Suggest tracking "first executed AC" rather than "first AC in plan" if the warmup subtraction is meant to correct for measurement bias.

### 4 cosmetic — stale rule-id reference in test comment

File: `server/lib/smoke-runner.test.ts:198` (test 9 comment)
Comment reads "the rule id isn't F55" but the rule is `F36-source-tree-grep`. Doesn't affect the test (it asserts `executor.toHaveBeenCalled()`), just a stale reference from an earlier draft. 1-line fix.

### 5 cosmetic — out-of-order import in evaluate.ts

File: `server/tools/evaluate.ts:22` (`import { writeFileSync } from "node:fs"` placed after a function definition)
The `writeFileSync` import is inserted between the `computeReverseFindingId` function and the rest of the imports. TypeScript/ES modules hoist imports so this is legal, but it's stylistically unusual and will trip future readers. Move to the top import block.

### 6 cosmetic — redundant `join()` wrapping a single path

File: `server/lib/smoke-runner.test.ts:364-366` (test 17 fixture path)
`join(fileURLToPath(new URL(...)))` — `join` with one argument is a no-op. Not wrong, just noisy. Drop the `join`.

### 7 cosmetic — tmp-file leak in smoke-gate-check.sh on early failure

File: `scripts/smoke-gate-check.sh:70-89`
`mktemp` creates `TMPMASTER`/`TMPHEAD` then `rm -f` at line 89. If any command between creation and the `rm` fails in a way that skips the `rm` (currently none, because there's no `set -e` and no early `exit`, but a future edit could regress this), the tmp files leak. Low-impact (OS cleans /tmp), but a `trap 'rm -f "$TMPMASTER" "$TMPHEAD"' EXIT` right after `mktemp` would make it robust to future refactors.

## Enhancements (optional future work, not blocking)

- Add a test for "plan with zero stories" and "story with zero ACs" — the completeness invariant is vacuously satisfied but no test pins the behavior; a future refactor could regress silently.
- Consider a `reason` field on `empty-evidence` / `hung` / `slow` verdicts (currently only `skipped-suspect` sets it). Authors debugging a smoke report would benefit from "hung after 2000ms budget" vs "exit 127 with no output".
- `classifySmokeResult` edge case worth documenting: `hungOnTimeout: true` AND `exitCode !== 0` AND `stdoutBytes === 0` correctly resolves to `hung` because the `hung` branch is checked first — but a comment pinning the precedence rationale in the function body (not just the JSDoc) would guard against a future "reorder for readability" refactor.
- `smokeExecute` could emit `signal` in the result to distinguish timeout-kill from external SIGKILL, but none of the current verdict rules care.
