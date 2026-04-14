# Q0.5 Task #34 — Lint debt fix + wire `npm run lint` into CI

## Context

Task #33 (`.ai-workspace/plans/2026-04-14-q05-q1-gitignore-design.md`, shipped v0.30.3 as PR #207) surfaced 40 pre-existing ESLint errors in `server/**` test files. That task's AC-11 had to be weakened mid-flight from "`npm run lint` exits 0" to "no NEW errors vs master" because the debt was outside its scope and bundling the fix would have been F7 "fix two things in one PR, break both."

The debt grew unchecked because **CI never runs `npm run lint`.** `.github/workflows/ci.yml` on master (v0.30.3) invokes only `npm ci --ignore-scripts`, `npm run build`, the dist-drift guard, `npm test`, and a commit-message validator. There is no lint step. Every PR that added an `any` in a test file quietly regressed the baseline with no signal.

This task fixes the debt AND closes the hole so it can't regrow. Both halves must land together — fixing the errors without wiring CI leaves the same gap open; wiring CI without fixing the errors reddens every future PR.

### Baseline (measured on origin/master @ v0.30.3, commit d9a3bf7)

- `npm run lint` exits non-zero with **40 errors, 0 warnings** across 10 files.
- Rule breakdown:
  - `@typescript-eslint/no-explicit-any` — 32 errors
  - `@typescript-eslint/no-this-alias` — 5 errors
  - `@typescript-eslint/no-unused-vars` — 2 errors
  - `@typescript-eslint/no-unsafe-function-type` — 1 error
- Files (10 total):
  - `server/lib/audit.ts` (1) — **not a test file, production source** (unused-var on `_entry` at line 74, `for await` iteration counter where the value is intentionally unused)
  - `server/lib/executor.test.ts` (1)
  - `server/lib/test-utils.ts` (3) — **not a `.test.ts` file, a shared helper**
  - `server/tools/coordinate.test.ts` (1)
  - `server/tools/divergence-cwd.test.ts` (3)
  - `server/tools/evaluate-critic.test.ts` (3)
  - `server/tools/evaluate.test.ts` (3)
  - `server/tools/plan.test.ts` (11)
  - `server/tools/three-tier-integration.test.ts` (8)
  - `server/validation/ac-lint.test.ts` (6)

### Why the mix matters

~80% of the debt is `no-explicit-any`, which can be mechanically converted to `unknown` + narrowing, or to proper types drawn from the surrounding fixtures. The remaining ~20% needs real judgment: `no-this-alias` implies a refactor to arrow functions or typed closures, `no-unsafe-function-type` means finding the real signature, and `no-unused-vars` means deleting or prefixing. A pure find-and-replace will leave 8 errors behind — the executor should not under-scope this as "swap `any` for `unknown`."

## Goal

Invariants that must hold when done:

1. `npm run lint` exits 0 on the PR branch. Every current error is fixed with real types or real refactors — **not** suppressed with file-level `/* eslint-disable */` or per-line `// eslint-disable-next-line`.
2. `npm test` still passes (no regression in test behavior caused by type tightening).
3. `npm run build` still passes.
4. `.github/workflows/ci.yml` invokes `npm run lint` as a required job step, so any future regression fails CI before merge.
5. The AC-11 contract promoted: after this lands, future PRs can hold the stronger "`npm run lint` exits 0" instead of the delta-based wording used in PR #207.

## Binary AC

Executor is done when ALL of these hold. Each is checkable with a single command.

- [ ] AC-1 — **Zero lint errors on the branch.** `npm run lint 2>&1 | tail -5 | grep -c "0 errors"` returns `1`, OR `npm run lint` exits 0. Either check is acceptable; executor picks the shape of the wrapper.
- [ ] AC-2 — **No blanket disables introduced.** `git diff origin/master...HEAD -- 'server/**/*.ts' | grep -cE '^\+.*eslint-disable'` returns `0`. (Disable comments may exist on master — delta against master must be zero new ones.)
- [ ] AC-3 — **Rule set unchanged.** `git diff origin/master...HEAD -- eslint.config.js .eslintrc* 2>&1 | wc -l` returns `0`. Do not weaken rule severities or add `ignorePatterns` to make the errors disappear.
- [ ] AC-4 — **CI runs lint.** `MSYS_NO_PATHCONV=1 git show HEAD:.github/workflows/ci.yml | grep -c 'npm run lint'` returns `≥ 1`.
- [ ] AC-5 — **CI lint step is required, not `continue-on-error`.** `MSYS_NO_PATHCONV=1 git show HEAD:.github/workflows/ci.yml | grep -A2 'npm run lint' | grep -c 'continue-on-error'` returns `0`.
- [ ] AC-6 — **Tests still pass.** `npm test` exits `0`.
- [ ] AC-7 — **Build still passes.** `npm run build` exits `0`.
- [ ] AC-8 — **No behavioral test changes.** `git diff origin/master...HEAD --stat -- 'server/**/*.test.ts' 'server/lib/test-utils.ts' | tail -1` shows only type-level changes. Reviewer spot-checks 3 random files and confirms assertions, fixtures, and control flow are unchanged — only type annotations. (Reviewer judgment AC; not automatable.)
- [ ] AC-9 — **CI green on the PR.** All required checks pass before merge, including the new lint step.
- [ ] AC-10 — **Error count moves to 0, not "fewer".** `npm run lint 2>&1 | grep -cE '^\s*[0-9]+:[0-9]+\s+error'` returns `0`. Belt-and-braces check against a subtle partial fix.

## Out of scope

- Do not touch `server/**/*.ts` files that are NOT in the 10-file baseline list above. No drive-by fixes in production source. `server/lib/audit.ts` is the only production-source (non-test) file in the baseline — fix it per the Critical files hint and do not let it open a lane for other production edits.
- Do not rename, relocate, or delete any test file.
- Do not modify ESLint rule config (`eslint.config.js`, `.eslintrc*`, `tsconfig.json` lint-relevant fields).
- Do not add new test cases or change assertions.
- Do not bundle Q3 (F56→F55 rename), the `/delegate` skill build, or any other pending task.
- Do not force-push or rewrite history.

## Ordering constraints

The two halves (error fixes + CI wiring) must land in the same PR. Rationale: if CI wiring lands first, CI reddens; if fixes land first, the debt can regrow before CI catches up. One PR, executor picks commit shape (one commit or two is fine — the AC is the contract).

## Verification procedure

On the PR branch, reviewer runs:

```
npm ci
npm run build
npm test
npm run lint                                 # must exit 0
MSYS_NO_PATHCONV=1 git show HEAD:.github/workflows/ci.yml | grep 'npm run lint'  # must print ≥ 1 line
git diff origin/master...HEAD -- 'server/**/*.ts' | grep -cE '^\+.*eslint-disable'   # must print 0
git diff origin/master...HEAD -- eslint.config.js | wc -l   # must print 0
```

Reviewer then spot-checks 3 randomly chosen test files for AC-8 (type-only diff). If any assertion changed shape, kick back.

## Critical files

Guidance only — executor chooses the exact edits.

- `server/lib/audit.ts` — 1 `no-unused-vars` error at line 74 on `_entry` in a `for await (const _entry of dir)` iteration counter. The value is intentionally unused (the loop is counting iterations, not reading entries). Fix shape: replace `_entry` with `_` (which most `no-unused-vars` rule configs exempt), OR rewrite the loop to use a direct count (`for (let i = 0; ...)`) if `opendir` supports it cleanly. Both are one-line surgical fixes. Do NOT suppress with `eslint-disable` (AC-2 blocks that). Do NOT modify the rule config (AC-3 blocks that). This is the ONLY production-source edit permitted by this task — do not let it cascade into other drive-by fixes in `server/lib/`.
- `server/lib/executor.test.ts` — 1 `no-unsafe-function-type` error at line 36 (look at the actual signature of the function being passed; prefer `(...args: unknown[]) => unknown` or the real type from the production import).
- `server/lib/test-utils.ts` — 3 `no-explicit-any` errors at lines 29, 31. Shared helper; any type tightening here ripples into every test that imports it.
- `server/tools/coordinate.test.ts` — 1 `no-unused-vars` on `_cs` at line 294 (leading underscore suggests the lint rule is misconfigured to NOT exempt underscore-prefixed vars, OR the variable can just be deleted — executor picks).
- `server/tools/divergence-cwd.test.ts`, `evaluate-critic.test.ts`, `evaluate.test.ts`, `three-tier-integration.test.ts` — each has a `const self = this` pattern around line 55-75 (`no-this-alias`) plus `no-explicit-any` on the adjacent function signature. Refactoring these four together will likely share a common arrow-function pattern.
- `server/tools/plan.test.ts` — heaviest file (11 errors). `this`-alias at line 47, plus 10 `no-explicit-any` spread across lines 33-949. Executor should look for a shared fixture/helper type first — many of the `any`s are likely the same object shape.
- `server/validation/ac-lint.test.ts` — 6 `no-explicit-any` around fixture construction and a `linter` helper call.
- `.github/workflows/ci.yml` — add a `Lint` step (name: executor's choice) after the build step and before the test step, or in parallel — ordering is executor's call. Must not be `continue-on-error`.

## Checkpoint

- [x] Plan drafted (planner)
- [x] Baseline captured: 40 errors on v0.30.3 (done, see Context)
- [x] Plan amendment applied: file list corrected from 9 to 10 (added `server/lib/audit.ts`); root cause was planner tail-reading lint output on the first pass, caught by executor's first-pass re-enumeration (commit 2 on this branch, 2026-04-15)
- [ ] Brief delivered to lucky-iris on thread `q05-task34-lint-debt`
- [ ] Executor acks with dirty-worktree pre-flight + HEAD SHA + tool check
- [ ] AC-1..AC-8 pass locally on executor's branch
- [ ] AC-10 (belt-and-braces zero-count check) passes
- [ ] PR opened with `plan-refresh: no-op`
- [ ] AC-9 (CI green, including new lint step) passes
- [ ] Stateless review PASS
- [ ] Merged + released
- [ ] Plan updated to reflect shipped reality (planner, post-merge)
- [ ] q05/Q1 plan retroactively note: "AC-11 contract now promotable to `exits 0` on future PRs"

Last updated: 2026-04-15T00:30:00+08:00 — amended file list from 9 to 10 (added `server/lib/audit.ts`) per blocker thread q05-task34-lint-debt. Amendment rides executor's branch.
